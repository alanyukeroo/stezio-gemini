import React, { useRef, useEffect, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Pose, Results, POSE_LANDMARKS, Options } from '@mediapipe/pose';
import HeartSoundVisualizer from './HeartSoundVisualizer';
import { StandaloneLiveListen } from './HeartSoundVisualizer';
import { StezioVoiceAssistant } from './StezioVoiceAssistant';
import { useGeminiLive } from '../hooks/useGeminiLive';

// --- Configuration & Types ---

// Based on user feedback, 5 seconds is too short. Increasing to 15 seconds.
const RECORDING_DURATION_MS = 15000; 
const LOCKING_DURATION_MS = 2000;    
const LOCK_DISTANCE_THRESHOLD = 50;  // Increased from 50 to 150 for looser precision lock
const DEFAULT_BRIGHTNESS_THRESHOLD = 240;    // Matches Python script

type ListeningPoint = {
  id: string;
  name: string;
  xOffset: number; 
  yOffset: number;
  instruction: string;
};

type ExamType = 'cardiac' | 'lung';

// Cardiac Protocol — offsets relative to chest center, in shoulder-width units
// xOffset: positive = patient's right, negative = patient's left
// yOffset: positive = below shoulder center
const CARDIAC_PROTOCOL: ListeningPoint[] = [
  { id: 'aortic',    name: '1. Aortic (Right 2nd IC)',          xOffset:  0.10, yOffset: 0.25, instruction: "It is on YOUR RIGHT SIDE, upper chest (Aortic)." },
  { id: 'pulmonic',  name: '2. Pulmonic (Left 2nd IC)',         xOffset: -0.10, yOffset: 0.25, instruction: "It is on YOUR LEFT SIDE, upper chest (Pulmonic)." },
  { id: 'erbs',      name: "3. Erb's Point (Left 3rd IC)",      xOffset: -0.08, yOffset: 0.38, instruction: "It is on YOUR LEFT SIDE, mid-chest (Erb's Point)." },
  { id: 'tricuspid', name: '4. Tricuspid (Left Lower Sternal)', xOffset: -0.05, yOffset: 0.52, instruction: "It is on YOUR LEFT SIDE, lower center chest (Tricuspid)." },
  { id: 'mitral',    name: '5. Mitral (Apex)',                  xOffset: -0.28, yOffset: 0.62, instruction: "It is on YOUR LEFT SIDE, under the chest muscle (Mitral)." },
];

// Lung Anterior Protocol — zigzag bilateral comparison pattern
// 8 points on anterior chest, ordered for left-right comparison
const LUNG_PROTOCOL: ListeningPoint[] = [
  { id: 'lung_r_upper',  name: '1. Right Upper Chest',       xOffset:  0.28, yOffset: 0.15, instruction: "YOUR UPPER RIGHT side." },
  { id: 'lung_l_upper',  name: '2. Left Upper Chest',        xOffset: -0.28, yOffset: 0.15, instruction: "YOUR UPPER LEFT side." },
  { id: 'lung_l_mid_m',  name: '3. Left Mid-Chest (Medial)',  xOffset: -0.12, yOffset: 0.35, instruction: "YOUR MIDDLE LEFT side, near center." },
  { id: 'lung_r_mid_m',  name: '4. Right Mid-Chest (Medial)', xOffset:  0.12, yOffset: 0.35, instruction: "YOUR MIDDLE RIGHT side, near center." },
  { id: 'lung_r_lower',  name: '5. Right Lower Chest',       xOffset:  0.25, yOffset: 0.55, instruction: "YOUR LOWER RIGHT side." },
  { id: 'lung_l_lower',  name: '6. Left Lower Chest',        xOffset: -0.25, yOffset: 0.55, instruction: "YOUR LOWER LEFT side." },
  { id: 'lung_l_mid_l',  name: '7. Left Mid-Chest (Lateral)', xOffset: -0.42, yOffset: 0.35, instruction: "YOUR FAR LEFT side." },
  { id: 'lung_r_mid_l',  name: '8. Right Mid-Chest (Lateral)',xOffset:  0.42, yOffset: 0.35, instruction: "YOUR FAR RIGHT side." },
];

const PROTOCOLS: Record<ExamType, ListeningPoint[]> = {
  cardiac: CARDIAC_PROTOCOL,
  lung: LUNG_PROTOCOL,
};

type AppState = 'PREPARATION' | 'CALIBRATING' | 'MODE_SELECT' | 'SEARCHING' | 'LOCKING' | 'RECORDING' | 'REVIEW' | 'SUMMARY' | 'LIVE_LISTEN';

  export default function ARRecorder() {
    // Voice AI Assistant Hook
      const { isConnected, isCopilotActive, toggleCopilot, startCopilot, sendVideoFrame, sendTextMessage } = useGeminiLive('wss://stezio-websocket-server-1027799228986.us-central1.run.app');
    const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);       
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null); 
  
  // Logic State
  const stateRef = useRef<AppState>('PREPARATION');
  const lightPosRef = useRef<{x: number, y: number, isBlinking: boolean} | null>(null);
  const targetPosRef = useRef<{x: number, y: number} | null>(null);

  // Calibration Refs
  const calibrationStartTimeRef = useRef<number | null>(null);
  const calibrationStatusRef = useRef<{isReady: boolean, msg: string}>({isReady: false, msg: "Step into the frame..."});
  
  // Blink Detection Refs (New Algorithm: Bright + Change)
  const prevFrameGrayRef = useRef<Uint8Array | null>(null); // Store previous frame grayscale
  const lastKnownLightPosRef = useRef<{x: number, y: number} | null>(null);
  const lastBlinkTimeRef = useRef<number>(0);
  const debugBrightnessRef = useRef<number>(0); 
  const maskImageDataRef = useRef<ImageData | null>(null);

  const lockStartTimeRef = useRef<number | null>(null);
  const recordingStartTimeRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Audio Visualization Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  // React State for UI
  const [appState, setAppState] = useState<AppState>('PREPARATION');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [progress, setProgress] = useState(0); 
  const [sessionData, setSessionData] = useState<any[]>([]); 
  const [feedbackMsg, setFeedbackMsg] = useState("Align the BLINKING light");
  const [showDebugMask, setShowDebugMask] = useState(false);
  const [threshold, setThreshold] = useState(DEFAULT_BRIGHTNESS_THRESHOLD);
  const [reviewVolume, setReviewVolume] = useState(1.0);
  const reviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const reviewAudioCtxRef = useRef<AudioContext | null>(null);
  const reviewGainNodeRef = useRef<GainNode | null>(null);
  const reviewSourceCreatedRef = useRef<boolean>(false);

  // Audio Feedback Ref
  const lastSpokenMsgRef = useRef<string>("");
  const voicesReadyRef = useRef(false);

// TTS Toggle (Hidden and Off by default)
    const [ttsEnabled, setTtsEnabled] = useState(false);
    const ttsEnabledRef = useRef(false);

  // Exam Type
  const [examType, setExamType] = useState<ExamType>('cardiac');
  const examTypeRef = useRef<ExamType>('cardiac');
  const lastInstructedTargetRef = useRef<string>('');
  const lastModeSelectGreetRef = useRef<boolean>(false);

  const activeProtocol = PROTOCOLS[examType];
  const currentTarget = activeProtocol[currentStepIndex];

  // Preload Chrome voices (they load async)
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) voicesReadyRef.current = true;
    };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, []);

  // Helper: Chrome-safe speak with keep-alive & retry
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const speak = useCallback((text: string) => {
      // Disable local browser TTS if Gemini Copilot is actively handling audio
      if (isCopilotActive || !ttsEnabledRef.current) return;
    if (lastSpokenMsgRef.current === text) return;

    // Always cancel previous to flush Chrome's stuck queue
    window.speechSynthesis.cancel();
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    lastSpokenMsgRef.current = text;

    const createUtterance = () => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      // Pick a local English voice explicitly (Chrome needs this)
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const localEnglish = voices.find(v => v.lang.startsWith('en') && v.localService);
        const anyEnglish = voices.find(v => v.lang.startsWith('en'));
        utterance.voice = localEnglish || anyEnglish || voices[0];
      }
      return utterance;
    };

    // Small delay lets Chrome flush the cancel before speaking
    setTimeout(() => {
      const utterance = createUtterance();

      // Chrome keep-alive: pause/resume every 10s to prevent 15s timeout kill
      utterance.onstart = () => {
        keepAliveRef.current = setInterval(() => {
          if (window.speechSynthesis.speaking) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
          }
        }, 10000);
      };

      const cleanup = () => {
        if (keepAliveRef.current) {
          clearInterval(keepAliveRef.current);
          keepAliveRef.current = null;
        }
      };

      utterance.onend = cleanup;

      utterance.onerror = (event) => {
        cleanup();
        // Retry once on interrupted/canceled (common Chrome glitch)
        if (event.error === 'interrupted' || event.error === 'canceled') {
          setTimeout(() => {
            window.speechSynthesis.cancel();
            const retry = createUtterance();
            retry.onend = () => {};
            retry.onerror = () => console.warn('TTS retry failed');
            window.speechSynthesis.speak(retry);
          }, 100);
        }
      };

      window.speechSynthesis.speak(utterance);
    }, 50);
  }, []);

  // Update feedback handler to handle both UI text and Speech
  const setFeedback = useCallback((msg: string, shouldSpeak: boolean = false) => {
      setFeedbackMsg(msg);
        
        // If Gemini is active, send the command silently to Gemini as text instruction
        // so Gemini knows what the user needs to do and can speak it natively.
        if (isCopilotActive && shouldSpeak) {
            sendTextMessage(`UI Status Update: "${msg}". Please guide the user briefly. Use only 1 short sentence.`);
        } else if (shouldSpeak) {
            speak(msg);
        }
    }, [speak, isCopilotActive, sendTextMessage]);

    // Copilot Onboarding Logic: Ask the user to confirm their hardware is ready
    useEffect(() => {
        if (appState === 'MODE_SELECT' && isCopilotActive) {
            if (!lastModeSelectGreetRef.current) {
                lastModeSelectGreetRef.current = true;
                sendTextMessage("We are at the menu! Enthusiastically greet the user. Ask them if they have successfully turned ON their digital stethoscope and if its LED light is blinking. Wait for them to say YES. After they agree, politely ask them to click either 'Cardiac Exam' or 'Lung Exam' on the screen.");
            }
        } else if (appState === 'PREPARATION') {
            lastModeSelectGreetRef.current = false; // Reset if they go back
        }
    }, [appState, isCopilotActive, sendTextMessage]);

    // Copilot Anatomical Logic: Guide the user when they start searching for a specific spot
    useEffect(() => {
        if (appState === 'SEARCHING' && isCopilotActive) {
            if (lastInstructedTargetRef.current !== currentTarget.name) {
                lastInstructedTargetRef.current = currentTarget.name;
                sendTextMessage(`User is now SEARCHING for ${currentTarget.name}. Give them verbal positioning instructions based EXACTLY on this fact: ${currentTarget.instruction}. Keep it to 1 concise sentence. DO NOT read the word 'instruction' aloud.`);
            }
        } else if (appState === 'MODE_SELECT' || appState === 'PREPARATION') {
             lastInstructedTargetRef.current = ''; // Reset on new exam
        }
    }, [appState, currentTarget.name, currentTarget.instruction, isCopilotActive, sendTextMessage]);

  useEffect(() => {
    // FIX: Workaround for React StrictMode unmount/remount issue with MediaPipe WASM.
    let isMounted = true;

    const pose = new Pose({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
      },
    });

    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    pose.onResults((results) => {
        if (!isMounted) return;
        onPoseResults(results);
    });

    // Start the Vision Loop
    let animationFrameId: number;
    let framesCounter = 0;
    
    const loop = async () => {
      if (!isMounted) return;

      try {
        if (
          webcamRef.current &&
          webcamRef.current.video &&
          webcamRef.current.video.readyState === 4
        ) {
          const video = webcamRef.current.video;
          
          // A. Send to MediaPipe (Async-ish, but we await)
          await pose.send({ image: video });

          // B. Run Light Detection (Sync)
          detectLightSource(video);

          // C. Update Game Logic / State Machine
          updateInteractionLogic();

          // D. Send Video frames to Gemini Live (throttle to reduce bandwidth, e.g., ~1 FPS)
          if (isCopilotActive && framesCounter % 30 === 0) {
            const screenshot = webcamRef.current.getScreenshot();
            if (screenshot) {
              sendVideoFrame(screenshot);
            }
          }
          framesCounter++;
        }
      } catch (err) {
        // Suppress WASM interruption errors when unmounting
        if (isMounted) console.error(err);
      }

      if (isMounted) {
        animationFrameId = requestAnimationFrame(loop);
      }
    };

    loop();

    return () => {
      isMounted = false;
      cancelAnimationFrame(animationFrameId);
      try {
        pose.close();
      } catch (e) {
        // Ignore close errors
      }
    };
  }, [currentStepIndex, threshold, showDebugMask, isCopilotActive, sendVideoFrame]); // Re-init loop if dependency changes


  // --- 2. Vision Algorithm A: Body Anchors (MediaPipe) ---
  const onPoseResults = (results: Results) => {
    if (!results.poseLandmarks || !canvasRef.current || !webcamRef.current?.video) return;

    const canvas = canvasRef.current;
    const video = webcamRef.current.video;
    
    // Match canvas size to video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Calculate Chest Geometry
    const leftShoulder = results.poseLandmarks[POSE_LANDMARKS.LEFT_SHOULDER];
    const rightShoulder = results.poseLandmarks[POSE_LANDMARKS.RIGHT_SHOULDER];
    const nose = results.poseLandmarks[POSE_LANDMARKS.NOSE];
    
    // --- PREPARATION / MODE_SELECT / LIVE_LISTEN LOGIC ---
    if (stateRef.current === 'PREPARATION' || stateRef.current === 'MODE_SELECT' || stateRef.current === 'LIVE_LISTEN') {
        return; // Don't process pose or draw overlay
    }

    // --- CALIBRATION LOGIC ---
    if (stateRef.current === 'CALIBRATING') {
        if (!leftShoulder || !rightShoulder || !nose) {
            calibrationStatusRef.current = { isReady: false, msg: "Please step into the frame" };
        } else {
            // Use raw coordinates (0-1) for resolution-independent checking
            const rawShoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
            const rawCenterX = (leftShoulder.x + rightShoulder.x) / 2;
            
            let isReady = false;
            let msg = "";

            if (rawShoulderWidth < 0.25) {
                msg = "Too far. Move closer.";
            } else if (rawShoulderWidth > 0.75) {
                msg = "Too close. Move back.";
            } else if (rawCenterX < 0.4 || rawCenterX > 0.6) {
                msg = "Please center yourself.";
            } else if (nose.y < 0.1 || leftShoulder.y > 0.8) {
                msg = "Adjust camera height.";
            } else {
                msg = "Perfect! Hold still...";
                isReady = true;
            }

            // DO NOT continually overwrite the state if we are currently holding still & counting down
            if (calibrationStatusRef.current.isReady && isReady) {
               // keep the existing message which might have the countdown appended by updateInteractionLogic
               calibrationStatusRef.current.isReady = true;
            } else {
               calibrationStatusRef.current = { isReady, msg };
            }
        }
        
        drawOverlay(ctx, 0, 0); // Render calibration overlay
        return; // Skip drawing targets until calibrated
    }

    // We mirror the video, so "Left Shoulder" in data is user's left, 
    // but on mirrored screen it appears on the right.
    // Let's rely on raw coordinates (0-1) and scale to canvas.
    
    const lsX = canvas.width - (leftShoulder.x * canvas.width); // Correct Mirroring
    const lsY = leftShoulder.y * canvas.height;
    const rsX = canvas.width - (rightShoulder.x * canvas.width); // Correct Mirroring
    const rsY = rightShoulder.y * canvas.height;

    // Chest Center & Scale
    const chestCenterX = (lsX + rsX) / 2;
    const chestCenterY = (lsY + rsY) / 2;
    const shoulderWidth = Math.abs(lsX - rsX); // Unit of measurement

    // 2. Determine Current Target Position
    // We flip the xOffset direction because of the mirror effect if needed, 
    // or we assume the offsets are defined for the User's perspective.
    // If user's Heart is on THEIR left:
    // Left Shoulder (on screen right) --- Right Shoulder (on screen left)
    // We calculate offset relative to center.
    
    // xOffset: positive is patient's left. In mirror view (canvas):
    // Patient's Left Shoulder (lsX) is on the LEFT side of the screen?
    // Wait.
    // Input Video: Normal. User's Left is on Screen Right.
    // Canvas CSS Mirror: Screen Right visual becomes Screen Left visual.
    // IF we remove CSS Mirror: User's Left remains Screen Right.
    // User raises Left Hand -> Screen shows hand on Right side.
    // This is weird for user. They want a mirror.
    // SO we MUST mirror the coordinates: x' = width - x.
    // If we do that, lsX (User Left) becomes Screen Left. Correct. 
    
    // xOffset polarity:
    // If 0.2 (Patient Left), we want to move towards lsX.
    // Since lsX is now on Left (e.g. 100px) and Center is 300px.
    // We want to subtract from Center? Or Add?
    // Let's assume standard grid: 0 is Left.
    // Patient Left is smaller X. 
    // Patient Right is larger X.
    // So positive Offset (Left) should be negative X relative to center?
    // Actually, let's keep it simple: Offset logic depends on how we defined it.
    // Let's invert the offset sign if needed. For now assume xOffset + means +X (Screen Right).
    
    const targetX = chestCenterX + (currentTarget.xOffset * shoulderWidth); 
    const targetY = chestCenterY + (currentTarget.yOffset * shoulderWidth);


    targetPosRef.current = { x: targetX, y: targetY };

    // 3. Render Interaction UI (Canvas Overlay)
    drawOverlay(ctx, targetX, targetY);
  };

  // --- 3. Vision Algorithm B: Light Tracker (Differential) ---
  const detectLightSource = (video: HTMLVideoElement) => {
    if (!hiddenCanvasRef.current) return;
    
    // Downscale for performance
    const w = 320; 
    const h = 240;
    
    const hCanvas = hiddenCanvasRef.current;
    if (hCanvas.width !== w) { hCanvas.width = w; hCanvas.height = h; }
    
    const ctx = hCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // Initialize Previous Frame Buffer if needed
    if (!prevFrameGrayRef.current || prevFrameGrayRef.current.length !== w * h) {
        prevFrameGrayRef.current = new Uint8Array(w * h);
    }
    const prevGray = prevFrameGrayRef.current;

    let sumX = 0;
    let sumY = 0;
    let count = 0;
    let maxBrightness = 0;
    
    // Create buffer for Mask if needed
    let maskData: Uint8ClampedArray | null = null;
    if (showDebugMask) {
        maskData = new Uint8ClampedArray(data.length); 
    }

    // A. PIXEL LOOP
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i+1];
      const b = data[i+2];
      const brightness = (r + g + b) / 3;

      const pixelIndex = i / 4;
      const prevB = prevGray[pixelIndex];
      const diff = Math.abs(brightness - prevB);

      // Store current brightness for next frame
      prevGray[pixelIndex] = brightness;

      // Logic: Bright (> threshold) AND Changed (> 50)
      // ROI Filter: Ignore top 20% (Ceiling Lights)
      const yRaw = Math.floor(pixelIndex / w);
      
      let pixelPassed = false;

      if (yRaw >= h * 0.2) { // ROI Check
          if (brightness > maxBrightness) maxBrightness = brightness;

          if (brightness > threshold && diff > 30) {
            const x = pixelIndex % w; 
            sumX += x; 
            sumY += yRaw;
            count++;
            pixelPassed = true;
          }
      }

      // Generate Mask
      if (maskData) {
          if (pixelPassed) {
             maskData[i] = 0; maskData[i+1] = 255; maskData[i+2] = 0; maskData[i+3] = 255; // Green
          } else {
             maskData[i] = 0; maskData[i+1] = 0; maskData[i+2] = 0; maskData[i+3] = 255; // Black
          }
      }
    }

    if (maskData) {
        maskImageDataRef.current = new ImageData(maskData as any, w, h);
    } else {
        maskImageDataRef.current = null;
    }

    // Expose for DEBUG UI
    debugBrightnessRef.current = Math.round(maxBrightness);

    // B. TRACKING & PERSISTENCE
    const now = Date.now();
    let currentPos: {x: number, y: number} | null = null;
    
    if (count > 5) { // Found moving/blinking light
        // 1. Calculate raw centroid (0-1 range relative to small canvas)
        const rawCX = sumX / count;
        const rawCY = sumY / count;
        
        // 2. Scale up to full video size
        const videoX = rawCX * (video.videoWidth / w);
        const videoY = rawCY * (video.videoHeight / h);

        // 3. Mirror the X coordinate for the Display (since we mirror the view)
        const finalX = video.videoWidth - videoX; 
        const finalY = videoY;

        currentPos = { x: finalX, y: finalY };
        
        lastKnownLightPosRef.current = currentPos;
        lastBlinkTimeRef.current = now;
        
        // Instant Lock
        lightPosRef.current = { ...currentPos, isBlinking: true };

    } else {
        // C. PERSISTENCE (Hold position for 3s if lost)
        // If we saw it recently (< 3000ms), keep returning valid pos.
        // This handles the "OFF" phase of the blink (1000ms off).
        if (lastKnownLightPosRef.current && (now - lastBlinkTimeRef.current < 3000)) {
            lightPosRef.current = { ...lastKnownLightPosRef.current, isBlinking: true };
        } else {
            lightPosRef.current = null;
        }
    }
  };

  // --- 4. State Machine & Interaction Logic ---
  const updateInteractionLogic = () => {
    const now = Date.now();
    const currentState = stateRef.current;
    
    // 0. Handle Preparation / Mode Select / Live Listen Phase
    if (currentState === 'PREPARATION' || currentState === 'MODE_SELECT' || currentState === 'LIVE_LISTEN') {
        return;
    }

    // 1. Handle Calibration Phase
    if (currentState === 'CALIBRATING') {
        const calStatus = calibrationStatusRef.current;
        if (calStatus.isReady) {
            if (!calibrationStartTimeRef.current) {
                calibrationStartTimeRef.current = now;
                setFeedback(calStatus.msg, true); // Speak: "Perfect, hold still"
            } else if (now - calibrationStartTimeRef.current > 3000) {
                // Done calibrating! Move to searching.
                stateRef.current = 'SEARCHING';
                setAppState('SEARCHING');
                calibrationStartTimeRef.current = null;
                setFeedback("Started. Align the BLINKING light with the target.", false); // Audio handled by SEARCHING useEffect
            } else {
                const timeLeft = Math.ceil(3 - (now - calibrationStartTimeRef.current)/1000);
                setFeedback(`${calStatus.msg} (${timeLeft}s)`, false); // Don't speak countdown spam
            }
        } else {
            calibrationStartTimeRef.current = null;
            // Speak calibration correction (e.g. "Too close, move back")
            setFeedback(calStatus.msg, true); 
        }
        return; // Don't run the rest of the targeting logic
    }

    const light = lightPosRef.current;
    const target = targetPosRef.current;

    // Safety: If tracking lost completely
    if (!light || !target) {
        if (currentState === 'LOCKING') {
            stateRef.current = 'SEARCHING';
            setAppState('SEARCHING');
            lockStartTimeRef.current = null;
        }
        return;
    }

    const dx = light.x - target.x;
    const dy = light.y - target.y;
    const distance = Math.sqrt(dx*dx + dy*dy);

    switch (currentState) {
      case 'SEARCHING':
        let msg = "Align the light with the circle.";
        if (!light.isBlinking) msg = "Light detected but not blinking.";
        
        if (distance < LOCK_DISTANCE_THRESHOLD) {
            if (light.isBlinking) {
                stateRef.current = 'LOCKING';
                setAppState('LOCKING');
                lockStartTimeRef.current = now;
                setFeedback("Target locked. Hold still!", true);
            } else {
                setFeedback("Make it blink to start!", true);
            }
        } else {
            // Only speak if they are reasonably far off to avoid spam
            setFeedback(msg, distance > 200); 
        }
        break;

      case 'LOCKING':
        // Hysteresis: Double the threshold once locked to prevent jitter
        if (distance > LOCK_DISTANCE_THRESHOLD * 2) { 
          stateRef.current = 'SEARCHING';
          setAppState('SEARCHING');
          lockStartTimeRef.current = null;
          setProgress(0);
          setFeedback("Lock lost. Please re-align.", true);
        } 
        else if (lockStartTimeRef.current && (now - lockStartTimeRef.current > LOCKING_DURATION_MS)) {
            startRecording();
            stateRef.current = 'RECORDING';
            setAppState('RECORDING');
            recordingStartTimeRef.current = now;
            setFeedback("Recording started. Breathe normally.", true);
        } 
        else if (lockStartTimeRef.current) {
            const p = ((now - lockStartTimeRef.current) / LOCKING_DURATION_MS) * 100;
            setProgress(Math.min(p, 100));
        }
        break;

      case 'RECORDING':
         if (recordingStartTimeRef.current && (now - recordingStartTimeRef.current > RECORDING_DURATION_MS)) {
             // We trigger Stop. The state transition to 'REVIEW' happens in onStop callback.
             // Prevent multiple calls
             if (mediaRecorderRef.current?.state === 'recording') {
                 stopRecording();
             }
         }
         // Update Progress
         else if (recordingStartTimeRef.current) {
             const p = ((now - recordingStartTimeRef.current) / RECORDING_DURATION_MS) * 100;
             setProgress(Math.min(p, 100));
         }
         
         // Drift Warning (Also using doubled threshold for consistency)
         if (distance > LOCK_DISTANCE_THRESHOLD * 2) {
             setFeedback("WARNING: You are drifting too far!", true);
         } else {
             // Quietly update text without speaking every frame
             setFeedback("Recording...", false);
             // Ensure warning stops if they correct themselves
             if (lastSpokenMsgRef.current !== "Recording started. Breathe normally.") {
                 lastSpokenMsgRef.current = "Recording started. Breathe normally."; // Reset 
             }
         }
         break;
    }
  };

  // --- 5. MediaRecorder Helpers ---
  const startRecording = useCallback(async () => { // Async now
    try {
        // 1. Request a dedicated Audio Stream (Separate from Video)
        // This ensures the 'muted' video preview doesn't silence our recording on macOS/Safari
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        let mimeType = 'audio/webm;codecs=opus'; 
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            console.log("webm not supported, trying mp4");
            mimeType = 'audio/mp4'; 
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                 mimeType = ''; // Fallback
            }
        }
        
        const options = mimeType ? { mimeType } : undefined;
        const recorder = new MediaRecorder(audioStream, options);
        
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];
        
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunksRef.current.push(event.data);
            }
        };

        recorder.start(100); 
        console.log("Recording started with dedicated stream");

        // --- SETUP VISUALIZATION ---
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioCtx = new AudioContextClass();
            const analyser = audioCtx.createAnalyser();
            const source = audioCtx.createMediaStreamSource(audioStream);
            
            source.connect(analyser);
            analyser.fftSize = 256; // 128 data points
            analyser.smoothingTimeConstant = 0.5;

            audioContextRef.current = audioCtx;
            analyserRef.current = analyser;
            dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
        } catch (err) {
            console.error("Audio Context Init Failed:", err);
        }

    } catch (e) {
        console.error("Mic access failed", e);
        setFeedbackMsg("Mic Error! Check Permissions.");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        const recorder = mediaRecorderRef.current;
        
        recorder.onstop = () => {
             // Stop the tracks to release the mic
             recorder.stream.getTracks().forEach(track => track.stop());

             // Cleanup Visualizer
             if (audioContextRef.current) {
                 audioContextRef.current.close().catch(e => console.error(e));
                 audioContextRef.current = null;
                 analyserRef.current = null;
             }

             stateRef.current = 'REVIEW';
             setAppState('REVIEW');
             setProgress(100);
             
             // Detect blob type again
             const type = recorder.mimeType || 'audio/webm'; // Default 
             const blob = new Blob(audioChunksRef.current, { type });
             console.log(`Recording finished. Size: ${blob.size}, Type: ${type}`);
        };

        recorder.stop();
    }
  }, []);

  const handleSaveAndNext = () => {
      // Push ref blob to state
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const newEntry = {
          location: currentTarget.name,
          blob: blob,
          timestamp: new Date().toISOString()
      };
      
      setSessionData(prev => [...prev, newEntry]);
      
      // Reset
      if (currentStepIndex < activeProtocol.length - 1) {
          setCurrentStepIndex(prev => prev + 1);
          setAppState('SEARCHING');
          stateRef.current = 'SEARCHING';
          setProgress(0);
          setFeedbackMsg("Success! Next location.");
      } else {
          setAppState('SUMMARY');
          stateRef.current = 'SUMMARY';
          setFeedbackMsg("Exam Complete! Review your recordings.");
      }
  };

  const handleRetake = () => {
      setAppState('SEARCHING');
      stateRef.current = 'SEARCHING';
      setProgress(0);
      setFeedbackMsg("Retrying...");
      audioChunksRef.current = [];
  };

  // --- 6. Drawing Helpers ---
  const drawOverlay = (ctx: CanvasRenderingContext2D, targetX: number, targetY: number) => {
      // Clear
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      // --- NEW: Draw Mask if Debug Mode ---
      const mask = maskImageDataRef.current;
      if (showDebugMask && mask) {
          // Put the mask data onto a temp canvas first to scale it up?
          // Or draw directly. But mask is 320x240 (small). ctx is 1280x720.
          // Using putImageData doesn't scale.
          // Solution: Draw small mask to temp canvas (or reuse hiddenCanvas), then drawImage scaled.
          // Actually, we can just use the hiddenCanvas!
          
          // Note: hiddenCanvas already contains the RAW VIDEO frame from detectLightSource drawImage().
          // Wait, we populated `maskData` but didn't put it back into hiddenCanvas.
          // Let's put it into hiddenCanvas context.
          
          const hCtx = hiddenCanvasRef.current?.getContext('2d');
          if (hCtx && mask) {
              hCtx.putImageData(mask, 0, 0);
              
              // Now draw scaled up on main canvas
              // We removed CSS mirror from Main Canvas to fix Text/Logic.
              // So we must manually mirror this image to match the video background.
              ctx.save();
              ctx.translate(ctx.canvas.width, 0);
              ctx.scale(-1, 1);
              ctx.drawImage(hiddenCanvasRef.current!, 0, 0, ctx.canvas.width, ctx.canvas.height);
              ctx.restore();
          }
      }

      const state = stateRef.current;

      // --- CALIBRATION SILHOUETTE ---
      if (state === 'CALIBRATING') {
          const calStatus = calibrationStatusRef.current;
          const w = ctx.canvas.width;
          const h = ctx.canvas.height;
          
          ctx.beginPath();
          // Silhouette parameters
          const centerX = w / 2;
          const headY = h * 0.45; // Moved down from 0.3
          const headRadius = w * 0.08; // Based on width, roughly 16% of screen
          
          // Head
          ctx.arc(centerX, headY, headRadius, 0, Math.PI * 2);
          
          // Shoulders
          const shoulderY = h * 0.65; // Moved down 
          const shoulderWidth = w * 0.25; // Half of total shoulder width (0.5 target)
          const torsoBottom = h * 0.95;
          
          ctx.moveTo(centerX - headRadius*0.5, shoulderY);
          ctx.quadraticCurveTo(centerX - shoulderWidth, shoulderY, centerX - shoulderWidth, torsoBottom);
          
          ctx.moveTo(centerX + headRadius*0.5, shoulderY);
          ctx.quadraticCurveTo(centerX + shoulderWidth, shoulderY, centerX + shoulderWidth, torsoBottom);

          ctx.lineWidth = 6;
          ctx.setLineDash([15, 15]);
          ctx.strokeStyle = calStatus.isReady ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 255, 0, 0.8)'; 
          ctx.stroke();
          ctx.setLineDash([]);
          
          // On-screen bold instruction
          ctx.fillStyle = calStatus.isReady ? '#00FF00' : 'white';
          ctx.font = "bold 32px monospace";
          ctx.textAlign = "center";
          ctx.shadowColor = "black";
          ctx.shadowBlur = 4;
          ctx.fillText(calStatus.msg, centerX, h * 0.15);
          ctx.shadowBlur = 0; // reset
          
          return; // Skip rest of debug drawing
      }

      // Draw Target (The "Hole")
      
      if (state === 'SEARCHING') {
          ctx.beginPath();
          ctx.arc(targetX, targetY, LOCK_DISTANCE_THRESHOLD, 0, 2 * Math.PI);
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'yellow';
          ctx.setLineDash([10, 10]); // Dashed
          ctx.stroke();
      } else if (state === 'LOCKING') {
          ctx.beginPath();
          ctx.arc(targetX, targetY, LOCK_DISTANCE_THRESHOLD, 0, 2 * Math.PI);
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'white';
          ctx.setLineDash([]); // Solid
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.fill();
          ctx.stroke();
      } else if (state === 'RECORDING') {
           // --- CIRCULAR PROGRESS TIMER ---
           const start = recordingStartTimeRef.current || 0;
           const elapsed = Date.now() - start;
           const duration = RECORDING_DURATION_MS;
           // Limit progress 0-1
           const p = Math.min(Math.max(elapsed / duration, 0), 1);
           const remaining = Math.max(Math.ceil((duration - elapsed) / 1000), 0);

           const radius = LOCK_DISTANCE_THRESHOLD; // ~50px

           // 1. Background Ring (Track)
           ctx.beginPath();
           ctx.arc(targetX, targetY, radius, 0, 2 * Math.PI);
           ctx.lineWidth = 8;
           ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
           ctx.stroke();

           // 2. Progress Arc (Green)
           // Start at -90deg (Top)
           const startAngle = -Math.PI / 2;
           const endAngle = startAngle + (2 * Math.PI * p);

           ctx.beginPath();
           ctx.arc(targetX, targetY, radius, startAngle, endAngle);
           ctx.lineWidth = 8;
           ctx.strokeStyle = '#00FF00'; // Green
           ctx.lineCap = 'round';
           ctx.stroke();

           // 3. Inner Fill
           ctx.beginPath();
           ctx.arc(targetX, targetY, radius - 4, 0, 2 * Math.PI);
           ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
           ctx.fill();

           // --- 4. WAVEFORM VISUALIZATION ---
           if (analyserRef.current && dataArrayRef.current) {
               // Cast to any to bypass strict type check for SharedArrayBuffer issue
               analyserRef.current.getByteTimeDomainData(dataArrayRef.current as any);
               const data = dataArrayRef.current;
               
               // Draw inside the circle (radius - 10 padding)
               const vRadius = radius - 10;
               
               ctx.beginPath();
               ctx.lineWidth = 2;
               ctx.strokeStyle = '#00FF00'; // Green Wave
               
               const sliceWidth = (vRadius * 2) / data.length;
               let xPos = targetX - vRadius;
               
               for(let i = 0; i < data.length; i++) {
                   const v = data[i] / 128.0; // 1.0 is minimal, 2.0 is max? No. Silence is 128 (v=1.0).
                   // Data is 0..255. 128 is center.
                   // v goes from 0 to ~2.
                   
                   // Map v (0..2) to Y (-vRadius/2 to +vRadius/2) to keep it contained
                   const yOffset = (v - 1) * (vRadius * 0.8); 
                   const yPos = targetY + yOffset;
                   
                   if(i === 0) ctx.moveTo(xPos, yPos);
                   else ctx.lineTo(xPos, yPos);
                   
                   xPos += sliceWidth;
               }
               ctx.stroke();
           } else {
               // Fallback if no audio data yet: Timer Text
               // We can show both? The wave might obscure the text.
               // Let's float the text ABOVE the circle if wave is active.
           }

           // 4. Timer Text (Seconds) -> MOVED UP
           // If wave is present, text might be hard to read.
           // Let's put text slightly above center or overlapping?
           // Or put the text on TOP?
           
           ctx.fillStyle = 'white';
           ctx.font = "bold 24px monospace";
           ctx.textAlign = "center";
           ctx.textBaseline = "middle";
           // Draw timer at top of circle (inside)
           ctx.fillText(remaining.toString(), targetX, targetY - radius/2 - 5);

           // 5. Small Label
           ctx.font = "10px monospace";
           ctx.fillStyle = '#00FF00';
           ctx.fillText("REC", targetX, targetY + radius/2 + 5);
      }

      // DEBUG: Show Raw Detection & Blink Status
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(10, 10, 350, 110);
      
      const debugB = debugBrightnessRef.current;
      ctx.fillStyle = debugB > threshold ? '#00FF00' : 'white';
      ctx.font = "14px monospace";
      ctx.fillText(`Light Level: ${debugB} / ${threshold}`, 20, 30);
      ctx.fillText(`Tracking: ${lightPosRef.current ? (lightPosRef.current.isBlinking ? "LOCKED (Blinking)" : "WAITING (Static)") : "SEARCHING"}`, 20, 50);

      // Instructions
      ctx.fillStyle = '#AAAAAA';
      ctx.font = "12px monospace";
      if (!showDebugMask) {
        ctx.fillText("[Toggle Mask] to see what robot sees", 20, 70);
        ctx.fillText("[Click Light] to set threshold", 20, 90);
      } else {
        ctx.fillText("Mask Mode: GREEN = Visible Target", 20, 70);
        ctx.fillText("Click background to reset", 20, 90);
      }

      if (lightPosRef.current) {
          const { x, y, isBlinking } = lightPosRef.current;
          
          // Draw Crosshair
          ctx.beginPath();
          ctx.moveTo(x - 20, y);
          ctx.lineTo(x + 20, y);
          ctx.moveTo(x, y - 20);
          ctx.lineTo(x, y + 20);
          ctx.strokeStyle = isBlinking ? '#00FF00' : '#FFA500'; // Green if locked/blinking, Orange if static
          ctx.lineWidth = isBlinking ? 4 : 2;
          ctx.setLineDash([]);
          ctx.stroke();

          // Draw Label
          ctx.fillStyle = isBlinking ? '#00FF00' : '#FFA500'; 
          ctx.font = "16px monospace";
          ctx.fillText(isBlinking ? "BLINK DETECTED" : "STATIC LIGHT", x + 25, y);
      } else {
          // Show "Scanning" text if nothing found
          ctx.fillStyle = 'white';
          
          if (debugB > 200 && debugB < threshold) {
              ctx.fillText("Environment too bright? Or Light too dim?", 20, 70);
          } else if (debugB < 50) {
             ctx.fillText("Room is dark (Good). Turn on LED.", 20, 70);
          }
      }
  };

  // --- Render ---
  return (
    <div 
      className="relative w-full h-screen bg-neutral-900 flex flex-col items-center justify-center overflow-hidden"
    >
      <StezioVoiceAssistant 
        isActive={isCopilotActive} 
        onToggle={toggleCopilot} 
        isConnected={isConnected} 
      />
      
      {/* 1. Header / HUD */}
      <div className="absolute top-4 left-0 right-0 z-20 flex flex-col items-center pointer-events-none">
          <h2 className="text-white text-xl font-bold tracking-wide uppercase">{currentTarget.name}</h2>
          <div className="bg-black/50 px-4 py-2 rounded-full mt-2 backdrop-blur">
            <span className={`font-mono text-sm ${appState === 'RECORDING' ? 'text-red-500 animate-pulse' : 'text-gray-200'}`}>
                {feedbackMsg}
            </span>
          </div>
          
          <button 
             className="mt-4 pointer-events-auto bg-blue-600 hover:bg-blue-500 text-white px-4 py-1 rounded text-xs font-mono"
             onClick={(e) => { e.stopPropagation(); setShowDebugMask(!showDebugMask); }}
          >
             {showDebugMask ? "HIDE DEBUG MASK" : "SHOW DEBUG MASK"}
          </button>
      </div>

      {/* 2. Layers: Webcam -> Canvas -> UI */}
      <div className="relative aspect-video w-full max-w-4xl border-2 border-neutral-700 rounded-xl overflow-hidden shadow-2xl bg-black">
          
          {/* Layer A: Webcam (Mirrored) */}
          <Webcam
            ref={webcamRef}
            className="absolute inset-0 w-full h-full object-cover transform -scale-x-100" // Mirror CSS
            audio={true} // We need audio stream
            muted={true} // Mute playback to prevent feedback, but stream audio is preserved
            width={1280}
            height={720}
            videoConstraints={{
                width: 1280,
                height: 720,
                facingMode: "user"
            }}
          />

          {/* Layer B: AR Canvas (No Mirror CSS - We mirror coordinates in logic) */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />

      </div>

      {/* Hidden processing canvas */}
      <canvas ref={hiddenCanvasRef} className="hidden" />

      {/* 0a. Mode Select Modal */}
      {appState === 'MODE_SELECT' && (
          <div className="absolute inset-0 z-50 bg-black/95 backdrop-blur flex items-center justify-center overflow-y-auto">
              <div className="bg-white text-black p-8 rounded-2xl max-w-lg w-full shadow-2xl m-4">
                  <h3 className="text-3xl font-bold mb-2 text-gray-900">Choose a Mode</h3>
                  <p className="mb-6 text-gray-500 text-lg">What would you like to do?</p>
                  
                  {/* TTS Toggle */}
                  <div className="hidden items-center justify-between mb-6 p-4 bg-gray-50 rounded-xl">
                      <div className="flex items-center gap-3">
                          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M6.5 8.8l4.7-3.5c.7-.5 1.6-.1 1.6.8v11.8c0 .9-.9 1.3-1.6.8l-4.7-3.5H3.2c-.7 0-1.2-.5-1.2-1.2v-4c0-.7.5-1.2 1.2-1.2h3.3z" />
                          </svg>
                          <span className="text-gray-700 font-medium">Voice Guidance (TTS)</span>
                      </div>
                      <button
                          onClick={() => {
                              const next = !ttsEnabled;
                              setTtsEnabled(next);
                              ttsEnabledRef.current = next;
                              if (!next) window.speechSynthesis.cancel();
                          }}
                          className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${
                              ttsEnabled ? 'bg-blue-600' : 'bg-gray-300'
                          }`}
                      >
                          <span
                              className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
                                  ttsEnabled ? 'translate-x-5' : 'translate-x-0'
                              }`}
                          />
                      </button>
                  </div>

                  <div className="space-y-4">
                      <button 
                          className="w-full p-6 bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 hover:border-blue-400 rounded-xl transition-all text-left group"
                          onClick={() => {
                              setExamType('cardiac');
                              examTypeRef.current = 'cardiac';
                              setCurrentStepIndex(0);
                              setSessionData([]);
                              stateRef.current = 'CALIBRATING';
                              setAppState('CALIBRATING');
                              setFeedback("Step into the frame for calibration.", true);
                          }}
                      >
                          <div className="flex items-center gap-4">
                              <div className="w-14 h-14 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
                                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                  </svg>
                              </div>
                              <div>
                                  <h4 className="text-xl font-bold text-gray-900 group-hover:text-blue-700">Cardiac Exam</h4>
                                  <p className="text-sm text-gray-500 mt-1">Record heart sounds at 5 auscultation points guided by AR</p>
                              </div>
                          </div>
                      </button>

                      <button 
                          className="w-full p-6 bg-purple-50 hover:bg-purple-100 border-2 border-purple-200 hover:border-purple-400 rounded-xl transition-all text-left group"
                          onClick={() => {
                              setExamType('lung');
                              examTypeRef.current = 'lung';
                              setCurrentStepIndex(0);
                              setSessionData([]);
                              stateRef.current = 'CALIBRATING';
                              setAppState('CALIBRATING');
                              setFeedback("Step into the frame for calibration.", true);
                          }}
                      >
                          <div className="flex items-center gap-4">
                              <div className="w-14 h-14 bg-purple-600 rounded-xl flex items-center justify-center shrink-0">
                                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                                  </svg>
                              </div>
                              <div>
                                  <h4 className="text-xl font-bold text-gray-900 group-hover:text-purple-700">Lung Exam</h4>
                                  <p className="text-sm text-gray-500 mt-1">Record lung sounds at 8 anterior auscultation points with bilateral comparison</p>
                              </div>
                          </div>
                      </button>

                      <button 
                          className="w-full p-6 bg-green-50 hover:bg-green-100 border-2 border-green-200 hover:border-green-400 rounded-xl transition-all text-left group"
                          onClick={() => {
                              stateRef.current = 'LIVE_LISTEN';
                              setAppState('LIVE_LISTEN');
                          }}
                      >
                          <div className="flex items-center gap-4">
                              <div className="w-14 h-14 bg-green-600 rounded-xl flex items-center justify-center shrink-0">
                                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m-4 0h8m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                  </svg>
                              </div>
                              <div>
                                  <h4 className="text-xl font-bold text-gray-900 group-hover:text-green-700">Live Listen</h4>
                                  <p className="text-sm text-gray-500 mt-1">Hear yourself in real-time through the stethoscope with waveform visualization</p>
                              </div>
                          </div>
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* 0b. Live Listen Full Screen */}
      {appState === 'LIVE_LISTEN' && (
          <StandaloneLiveListen
            onBack={() => {
              stateRef.current = 'MODE_SELECT';
              setAppState('MODE_SELECT');
            }}
          />
      )}

      {/* 0c. Preparation Modal */}
      {appState === 'PREPARATION' && (
          <div className="absolute inset-0 z-50 bg-black/95 backdrop-blur flex items-center justify-center overflow-y-auto">
              <div className="bg-white text-black p-8 rounded-2xl max-w-xl w-full shadow-2xl m-4">
                  <h3 className="text-3xl font-bold mb-4 text-blue-600">Before We Begin</h3>
                  <p className="mb-6 text-gray-600 text-lg">Please prepare for the examination by checking these requirements:</p>
                  
                  <ul className="space-y-6 mb-8 text-lg">
                       <li className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                           <div className="text-3xl">👕</div>
                           <div><strong>Clothing:</strong> Wear a thin shirt or expose your chest for clear acoustics.</div>
                       </li>
                       <li className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                           <div className="text-3xl">🪑</div>
                           <div><strong>Position:</strong> Sit facing the camera, about 2 feet back. Your head and shoulders should be visible.</div>
                       </li>
                       <li className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                           <div className="text-3xl">🔦</div>
                           <div><strong>Device Setup:</strong> Turn on your Stezio device and ensure the LED marker is blinking.</div>
                       </li>
                       <li className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                           <div className="text-3xl">🤫</div>
                           <div><strong>Environment:</strong> Keep the room as quiet as possible.</div>
                       </li>
                  </ul>

                  <button 
                      className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xl transition-all shadow-lg transform hover:scale-[1.02]"
                      onClick={() => {
                          setAppState('MODE_SELECT');
                          stateRef.current = 'MODE_SELECT';
                          startCopilot(); // Auto-start the AI Voice session when user clicks
                      }}
                  >
                      I'm Ready to Start
                  </button>
              </div>
          </div>
      )}

      {/* 3. Progress Ring / Feedback */}
      {(appState === 'LOCKING') && (
          <div className="absolute bottom-12 w-64 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-100 ease-linear bg-white`}
                style={{ width: `${progress}%` }}
              />
          </div>
      )}

      {/* 4. Review Modal (Intermediate) */}
      {appState === 'REVIEW' && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur flex items-center justify-center">
              <div className="bg-white text-black p-8 rounded-2xl max-w-md w-full shadow-xl">
                  <h3 className="text-2xl font-bold mb-4">Reading Captured</h3>
                  <p className="mb-6 text-gray-600">You successfully captured the {currentTarget.name}.</p>
                  
                  {/* Immediate Playback Preview with Volume (GainNode for true amplification) */}
                  <div className="mb-6 p-4 bg-gray-100 rounded-lg space-y-3">
                      <audio
                        ref={(el) => {
                          if (el && el !== reviewAudioRef.current) {
                            reviewAudioRef.current = el;
                            reviewSourceCreatedRef.current = false;
                          }
                        }}
                        controls
                        crossOrigin="anonymous"
                        src={audioChunksRef.current.length > 0 ? URL.createObjectURL(new Blob(audioChunksRef.current, {type: 'audio/webm'})) : ''}
                        className="w-full"
                        onPlay={() => {
                          if (reviewAudioRef.current && !reviewSourceCreatedRef.current) {
                            const ctx = new AudioContext();
                            const source = ctx.createMediaElementSource(reviewAudioRef.current);
                            const gain = ctx.createGain();
                            gain.gain.value = reviewVolume;
                            source.connect(gain);
                            gain.connect(ctx.destination);
                            reviewAudioCtxRef.current = ctx;
                            reviewGainNodeRef.current = gain;
                            reviewSourceCreatedRef.current = true;
                          }
                        }}
                      />
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider shrink-0">Volume</label>
                        <input
                          type="range"
                          min="0" max="2" step="0.1"
                          value={reviewVolume}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setReviewVolume(v);
                            if (reviewGainNodeRef.current) reviewGainNodeRef.current.gain.value = v;
                          }}
                          className="flex-1 h-2 accent-blue-600"
                        />
                        <span className="text-sm font-mono text-gray-700 w-12 text-right">{Math.round(reviewVolume * 100)}%</span>
                      </div>
                  </div>

                  <div className="flex gap-4">
                      <button 
                        onClick={handleRetake}
                        className="flex-1 py-3 px-4 rounded-lg bg-gray-200 hover:bg-gray-300 font-semibold transition"
                      >
                          Retake
                      </button>
                      <button 
                        onClick={handleSaveAndNext}
                        className="flex-1 py-3 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold transition shadow-lg"
                      >
                          {currentStepIndex < activeProtocol.length - 1 ? 'Save & Next' : 'Finish Exam'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* 5. Summary - Full-Screen Sound Visualizer */}
      {appState === 'SUMMARY' && (
          <HeartSoundVisualizer 
            sessionData={sessionData}
            examType={examType}
            onBack={() => {
              // Go back to last recording review if needed
              setAppState('REVIEW');
              stateRef.current = 'REVIEW';
            }}
            onSubmit={() => alert("Submitting to processing pipeline...")}
          />
      )}
    </div>
  );
}
