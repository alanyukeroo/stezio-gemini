import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Hook to manage a WebSocket connection to the Stezio backend proxy
 * interacting with the Gemini Multimodal Live API.
 */
export function useGeminiLive(proxyUrl: string = 'wss://stezio-websocket-server-1027799228986.us-central1.run.app') {
  const [isConnected, setIsConnected] = useState(false);
  const [isCopilotActive, setIsCopilotActive] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  
  // Audio playback
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Audio capture
  const streamRef = useRef<MediaStream | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000, // Gemini expects 16kHz
      });
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const connect = useCallback(async () => {
    if (wsRef.current) return;

    try {
      initAudioContext();
      
      const ws = new WebSocket(proxyUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Connected to Gemini Proxy');
        setIsConnected(true);
      };

      ws.onclose = () => {
        console.log('Disconnected from Gemini Proxy');
        setIsConnected(false);
        setIsCopilotActive(false);
        stopAudioCapture();
        wsRef.current = null;
      };

      ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
      };

      ws.onmessage = async (event) => {
        // Handle incoming binary audio / JSON data from Gemini via proxy
        const data = event.data;
        if (typeof data === 'string') {
          try {
            const parsed = JSON.parse(data);
            if (parsed.serverContent && parsed.serverContent.modelTurn) {
              const parts = parsed.serverContent.modelTurn.parts;
              for (const part of parts) {
                if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
                    playAudio(part.inlineData.data);
                }
              }
            }
          } catch (e) {
            console.error('Error parsing Gemini message:', e);
          }
        } else if (data instanceof Blob || data instanceof ArrayBuffer) {
           // Handle direct binary relay depending on how the proxy is configured
        }
      };
    } catch (e) {
      console.error("Failed to connect", e);
    }
  }, [proxyUrl]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopAudioCapture();
    setIsConnected(false);
    setIsCopilotActive(false);
  }, []);

  // Audio playback queue to prevent glitching overlapping audio frames
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const nextStartTimeRef = useRef<number>(0);

  const processAudioQueue = async () => {
      if (audioQueueRef.current.length === 0 || !audioContextRef.current) {
          return;
      }
      
      const audioCtx = audioContextRef.current;
      
      // If the queue has items, schedule them in the future to ensure seamless playback without gaps
      while (audioQueueRef.current.length > 0) {
          const float32Array = audioQueueRef.current.shift()!;
          const audioBuffer = audioCtx.createBuffer(1, float32Array.length, 24000);
          audioBuffer.getChannelData(0).set(float32Array);

          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioCtx.destination);
          
          const currentTime = audioCtx.currentTime;
          
          // If the next start time is in the past, it means we underflowed (audio stopped).
          // Add a tiny buffer (0.05s) to let a few chunks arrive before starting to prevent stuttering.
          if (nextStartTimeRef.current < currentTime) {
              nextStartTimeRef.current = currentTime + 0.05;
          }
          
          // Schedule playback
          source.start(nextStartTimeRef.current);
          
          // Advance the schedule cursor by the duration of this buffer
          nextStartTimeRef.current += audioBuffer.duration;
      }
  };

  const playAudio = async (base64Audio: string) => {
     // Decode Base64 to ArrayBuffer
     const binaryString = window.atob(base64Audio);
     const len = binaryString.length;
     const bytes = new Uint8Array(len);
     for (let i = 0; i < len; i++) {
         bytes[i] = binaryString.charCodeAt(i);
     }
     
     // 16-bit PCM to Float32 conversion
     const int16Array = new Int16Array(bytes.buffer);
     const float32Array = new Float32Array(int16Array.length);
     for (let i = 0; i < int16Array.length; i++) {
         float32Array[i] = int16Array[i] / 32768.0;
     }

     audioQueueRef.current.push(float32Array);
     processAudioQueue();
  };

  const startAudioCapture = async () => {
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      initAudioContext();
      
      const audioCtx = audioContextRef.current!;
      audioSourceRef.current = audioCtx.createMediaStreamSource(streamRef.current);
      
      // Node used to extract raw PCM data
      audioProcessorRef.current = audioCtx.createScriptProcessor(4096, 1, 1);
      
      audioSourceRef.current.connect(audioProcessorRef.current);
      audioProcessorRef.current.connect(audioCtx.destination);
      
      audioProcessorRef.current.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        
        const inputData = e.inputBuffer.getChannelData(0); // Float32
        
        // Convert Float32 to Int16 for Gemini
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Send via WebSocket (JSON wrapper)
        const uint8Array = new Uint8Array(pcm16.buffer);
        const chars = [];
        for (let i = 0; i < uint8Array.length; i++) {
            chars.push(String.fromCharCode(uint8Array[i]));
        }
        const base64Audio = btoa(chars.join(''));
        wsRef.current.send(JSON.stringify({
            realtimeInput: {
                mediaChunks: [{
                    mimeType: "audio/pcm;rate=16000",
                    data: base64Audio
                }]
            }
        }));
      };
      
      setIsCopilotActive(true);
    } catch (e) {
      console.error("Failed to start audio capture:", e);
    }
  };

  const stopAudioCapture = () => {
    try {
        if (audioSourceRef.current) {
            audioSourceRef.current.disconnect();
        }
        if (audioProcessorRef.current) {
            audioProcessorRef.current.disconnect();
        }
    } catch (error) {
        console.warn('Silent detach of audio nodes:', error);
    }
    
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }
    setIsCopilotActive(false);
      nextStartTimeRef.current = 0; // Reset audio scheduling cursor
    };
    
    // Method to send visual frames
    const sendVideoFrame = (base64Jpeg: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !isCopilotActive) return;
        
        // Data URL format: "data:image/jpeg;base64,..."
        const b64Data = base64Jpeg.split(',')[1];
        
        if (b64Data) {
            wsRef.current.send(JSON.stringify({
              realtimeInput: {
                  mediaChunks: [{
                      mimeType: "image/jpeg",
                      data: b64Data
                  }]
              }
          }));
        }
    };

  // Method to send text prompts directly into the conversation
  const sendTextMessage = (text: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !isCopilotActive) return;
      wsRef.current.send(JSON.stringify({
          clientContent: {
              turns: [{
                  role: "user",
                  parts: [{ text: text }]
              }],
              turnComplete: true
          }
      }));
  };

  const toggleCopilot = () => {
      if (isCopilotActive) {
          stopAudioCapture();
          disconnect();
      } else {
          connect().then(() => startAudioCapture());
      }
  };

  const startCopilot = () => {
      if (!isCopilotActive && !isConnected) {
          connect().then(() => startAudioCapture());
      }
  };

  // Cleanup
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isCopilotActive,
    toggleCopilot,
    startCopilot,
    sendVideoFrame,
    sendTextMessage
  };
}