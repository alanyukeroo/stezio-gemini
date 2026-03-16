import React, { useRef, useEffect, useState, useCallback } from 'react';

// --- Types ---
type RecordingData = {
  location: string;
  blob: Blob;
  timestamp: string;
};

type WaveformData = {
  location: string;
  timestamp: string;
  audioBuffer: AudioBuffer | null;
  samples: Float32Array | null;
  blobUrl: string;
  isDecoded: boolean;
};

type ExamType = 'cardiac' | 'lung';

type Props = {
  sessionData: RecordingData[];
  examType?: ExamType;
  onBack?: () => void;
  onSubmit?: () => void;
};

type ActiveTab = 'recordings' | 'live';

// --- Waveform Canvas Component ---
function WaveformCanvas({ 
  samples, 
  duration,
  isPlaying,
  playbackProgress,
  color = '#1a1a2e',
  height = 120,
}: { 
  samples: Float32Array | null;
  duration: number;
  isPlaying: boolean;
  playbackProgress: number;
  color?: string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !samples) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High DPI scaling
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const centerY = h / 2;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Draw grid lines (subtle)
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    for (let y = 0; y < h; y += h / 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // Vertical grid lines (time markers)
    const timeStep = w / (duration > 0 ? Math.ceil(duration) : 15);
    for (let x = 0; x < w; x += timeStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Center line
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(w, centerY);
    ctx.stroke();

    // Draw waveform
    const step = Math.floor(samples.length / w) || 1;
    
    ctx.beginPath();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = color;

    for (let i = 0; i < w; i++) {
      const sampleIndex = Math.floor((i / w) * samples.length);
      
      // Get min/max in this pixel's sample range for better visualization  
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step && sampleIndex + j < samples.length; j++) {
        const val = samples[sampleIndex + j];
        if (val < min) min = val;
        if (val > max) max = val;
      }
      
      // Amplify for visibility (heart sounds can be quiet)
      const amplify = 2.5;
      const yMin = centerY + (min * amplify * centerY);
      const yMax = centerY + (max * amplify * centerY);
      
      ctx.moveTo(i, Math.max(0, yMax));
      ctx.lineTo(i, Math.min(h, yMin));
    }
    ctx.stroke();

    // Draw playback progress line
    if (isPlaying && playbackProgress > 0) {
      const progressX = playbackProgress * w;
      ctx.beginPath();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.moveTo(progressX, 0);
      ctx.lineTo(progressX, h);
      ctx.stroke();
    }

  }, [samples, isPlaying, playbackProgress, color, height, duration]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height: `${height}px` }}
    />
  );
}


// --- Main Visualizer Component ---
export default function HeartSoundVisualizer({ sessionData, examType = 'cardiac', onBack, onSubmit }: Props) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('recordings');
  const [waveforms, setWaveforms] = useState<WaveformData[]>([]);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [playbackProgress, setPlaybackProgress] = useState<number[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const audioRefs = useRef<(HTMLAudioElement | null)[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  // Decode all audio blobs on mount
  useEffect(() => {
    const decodeAll = async () => {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();

      const decoded: WaveformData[] = await Promise.all(
        sessionData.map(async (data) => {
          const blobUrl = URL.createObjectURL(data.blob);
          try {
            const arrayBuffer = await data.blob.arrayBuffer();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            const samples = audioBuffer.getChannelData(0); // Mono channel
            return {
              location: data.location,
              timestamp: data.timestamp,
              audioBuffer,
              samples,
              blobUrl,
              isDecoded: true,
            };
          } catch (e) {
            console.error(`Failed to decode ${data.location}:`, e);
            return {
              location: data.location,
              timestamp: data.timestamp,
              audioBuffer: null,
              samples: null,
              blobUrl,
              isDecoded: false,
            };
          }
        })
      );

      audioCtx.close();
      setWaveforms(decoded);
      setPlaybackProgress(new Array(decoded.length).fill(0));
    };

    if (sessionData.length > 0) {
      decodeAll();
    }

    return () => {
      // Cleanup blob URLs
      waveforms.forEach(w => URL.revokeObjectURL(w.blobUrl));
    };
  }, [sessionData]);

  // Playback progress tracking
  const updateProgress = useCallback(() => {
    if (playingIndex !== null && audioRefs.current[playingIndex]) {
      const audio = audioRefs.current[playingIndex]!;
      if (!audio.paused && audio.duration > 0) {
        setPlaybackProgress(prev => {
          const next = [...prev];
          next[playingIndex] = audio.currentTime / audio.duration;
          return next;
        });
      }
    }
    animationFrameRef.current = requestAnimationFrame(updateProgress);
  }, [playingIndex]);

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(updateProgress);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [updateProgress]);

  const handlePlay = (index: number) => {
    // Stop any currently playing
    audioRefs.current.forEach((audio, i) => {
      if (audio && i !== index) {
        audio.pause();
        audio.currentTime = 0;
      }
    });

    const audio = audioRefs.current[index];
    if (!audio) return;

    if (playingIndex === index && !audio.paused) {
      audio.pause();
      setPlayingIndex(null);
    } else {
      audio.currentTime = 0;
      audio.play();
      setPlayingIndex(index);
    }
  };

  const handleAudioEnded = (index: number) => {
    setPlayingIndex(null);
    setPlaybackProgress(prev => {
      const next = [...prev];
      next[index] = 0;
      return next;
    });
  };

  // Auscultation point colors for differentiation
  const pointColors: Record<string, string> = {
    'aortic': '#dc2626',
    'pulmonic': '#2563eb', 
    'erbs': '#7c3aed',
    'tricuspid': '#059669',
    'mitral': '#d97706',
  };

  const getColorForLocation = (location: string): string => {
    const key = Object.keys(pointColors).find(k => location.toLowerCase().includes(k));
    return key ? pointColors[key] : '#1a1a2e';
  };

  const getIdForLocation = (location: string): string => {
    if (location.toLowerCase().includes('aortic')) return 'A';
    if (location.toLowerCase().includes('pulmonic')) return 'P';
    if (location.toLowerCase().includes('erb')) return 'E';
    if (location.toLowerCase().includes('tricuspid')) return 'T';
    if (location.toLowerCase().includes('mitral')) return 'M';
    return '?';
  };

  const formatDuration = (buffer: AudioBuffer | null): string => {
    if (!buffer) return '--:--';
    const secs = Math.floor(buffer.duration);
    return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
  };

  const selectedWaveform = selectedIndex !== null ? waveforms[selectedIndex] : null;

  // Stop recordings playback when switching tabs
  const handleTabSwitch = (tab: ActiveTab) => {
    if (tab !== 'recordings') {
      audioRefs.current.forEach(audio => {
        if (audio) { audio.pause(); audio.currentTime = 0; }
      });
      setPlayingIndex(null);
    }
    setActiveTab(tab);
  };

  return (
    <div className="absolute inset-0 z-50 bg-gray-50 flex flex-col overflow-hidden">
      
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
          <div>
            <h1 className="text-lg font-bold text-gray-900">{examType === 'lung' ? 'Lung Exam' : 'Cardiac Exam'}</h1>
            <p className="text-xs text-gray-500">
              {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              {' · '}
              {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-green-700 bg-green-100 px-3 py-1 rounded-full">
            {waveforms.length} / {waveforms.length} Captured
          </span>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-white border-b border-gray-200 px-6 flex shrink-0">
        <button
          onClick={() => handleTabSwitch('recordings')}
          className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'recordings'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            Recordings
          </span>
        </button>
        <button
          onClick={() => handleTabSwitch('live')}
          className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'live'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m-4 0h8m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            Live Listen
          </span>
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'recordings' ? (
        /* ===== RECORDINGS TAB ===== */
        <RecordingsTab
          waveforms={waveforms}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          playingIndex={playingIndex}
          playbackProgress={playbackProgress}
          handlePlay={handlePlay}
          handleAudioEnded={handleAudioEnded}
          audioRefs={audioRefs}
          getColorForLocation={getColorForLocation}
          getIdForLocation={getIdForLocation}
          formatDuration={formatDuration}
          pointColors={pointColors}
        />
      ) : (
        /* ===== LIVE LISTEN TAB ===== */
        <LiveListenTab sessionData={sessionData} waveforms={waveforms} />
      )}

      {/* Bottom Action Bar */}
      <div className="bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
        <button
          onClick={onBack}
          className="px-5 py-2.5 text-gray-600 hover:text-gray-800 font-medium text-sm transition-colors"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 text-gray-500 hover:text-gray-700 font-medium text-sm border border-gray-300 rounded-lg transition-colors"
          >
            Discard
          </button>
          <button
            onClick={onSubmit || (() => alert("Submitting to processing pipeline..."))}
            className="px-8 py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold text-sm rounded-lg shadow-md transition-all hover:shadow-lg"
          >
            Submit Exam
          </button>
        </div>
      </div>
    </div>
  );
}


// --- Recordings Tab Component ---
function RecordingsTab({
  waveforms, selectedIndex, setSelectedIndex, playingIndex, playbackProgress,
  handlePlay, handleAudioEnded, audioRefs,
  getColorForLocation, getIdForLocation, formatDuration, pointColors,
}: {
  waveforms: WaveformData[];
  selectedIndex: number | null;
  setSelectedIndex: (i: number) => void;
  playingIndex: number | null;
  playbackProgress: number[];
  handlePlay: (i: number) => void;
  handleAudioEnded: (i: number) => void;
  audioRefs: React.MutableRefObject<(HTMLAudioElement | null)[]>;
  getColorForLocation: (loc: string) => string;
  getIdForLocation: (loc: string) => string;
  formatDuration: (buf: AudioBuffer | null) => string;
  pointColors: Record<string, string>;
}) {
  const selectedWaveform = selectedIndex !== null ? waveforms[selectedIndex] : null;
  const [playbackVolume, setPlaybackVolume] = useState(1.0);
  const playbackAudioCtxRef = useRef<AudioContext | null>(null);
  const playbackGainNodeRef = useRef<GainNode | null>(null);
  const playbackSourcesCreated = useRef<Set<number>>(new Set());

  // Setup GainNode for selected audio element when it plays
  const ensureGainNode = useCallback((index: number) => {
    const audio = audioRefs.current[index];
    if (!audio || playbackSourcesCreated.current.has(index)) {
      // Just update gain value if already connected
      if (playbackGainNodeRef.current) {
        playbackGainNodeRef.current.gain.value = playbackVolume;
      }
      return;
    }
    // Create or reuse AudioContext
    if (!playbackAudioCtxRef.current) {
      playbackAudioCtxRef.current = new AudioContext();
    }
    const ctx = playbackAudioCtxRef.current;
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    gain.gain.value = playbackVolume;
    source.connect(gain);
    gain.connect(ctx.destination);
    playbackGainNodeRef.current = gain;
    playbackSourcesCreated.current.add(index);
  }, [audioRefs, playbackVolume]);

  // Apply volume change to active GainNode
  useEffect(() => {
    if (playbackGainNodeRef.current) {
      playbackGainNodeRef.current.gain.value = playbackVolume;
    }
  }, [playbackVolume]);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: Waveform Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {waveforms.map((wf, idx) => {
            const color = getColorForLocation(wf.location);
            const id = getIdForLocation(wf.location);
            const isSelected = selectedIndex === idx;
            const isCurrentlyPlaying = playingIndex === idx;

            return (
              <div
                key={idx}
                className={`
                  bg-white rounded-xl border-2 transition-all cursor-pointer
                  ${isSelected ? 'border-blue-500 shadow-lg' : 'border-gray-200 hover:border-gray-300 hover:shadow-md'}
                `}
                onClick={() => setSelectedIndex(idx)}
              >
                {/* Row Header */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: color }}
                    >
                      {id}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-gray-900">{wf.location}</h3>
                      <p className="text-xs text-gray-400">
                        {new Date(wf.timestamp).toLocaleTimeString()} · {formatDuration(wf.audioBuffer)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handlePlay(idx); }}
                      className={`
                        w-9 h-9 rounded-full flex items-center justify-center transition-all
                        ${isCurrentlyPlaying 
                          ? 'bg-red-100 text-red-600 hover:bg-red-200' 
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
                      `}
                    >
                      {isCurrentlyPlaying ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <rect x="6" y="4" width="4" height="16" rx="1" />
                          <rect x="14" y="4" width="4" height="16" rx="1" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Waveform */}
                <div className="px-2 py-1">
                  <WaveformCanvas
                    samples={wf.samples}
                    duration={wf.audioBuffer?.duration || 15}
                    isPlaying={isCurrentlyPlaying}
                    playbackProgress={playbackProgress[idx] || 0}
                    color={color}
                    height={isSelected ? 140 : 90}
                  />
                </div>

                {/* Hidden audio element */}
                <audio
                  ref={(el) => { audioRefs.current[idx] = el; }}
                  src={wf.blobUrl}
                  onEnded={() => handleAudioEnded(idx)}
                  onPlay={() => ensureGainNode(idx)}
                  preload="auto"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Detail Panel */}
      <div className="w-80 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
        {selectedWaveform ? (
          <>
            <div className="p-5 border-b border-gray-100">
              <div className="flex items-center gap-3 mb-3">
                <div 
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                  style={{ backgroundColor: getColorForLocation(selectedWaveform.location) }}
                >
                  {getIdForLocation(selectedWaveform.location)}
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">{selectedWaveform.location}</h3>
                  <p className="text-xs text-gray-500">
                    {new Date(selectedWaveform.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Recording Details</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Duration</span>
                    <span className="font-medium text-gray-900">{formatDuration(selectedWaveform.audioBuffer)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Sample Rate</span>
                    <span className="font-medium text-gray-900">
                      {selectedWaveform.audioBuffer ? `${selectedWaveform.audioBuffer.sampleRate} Hz` : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Channels</span>
                    <span className="font-medium text-gray-900">
                      {selectedWaveform.audioBuffer ? selectedWaveform.audioBuffer.numberOfChannels : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Status</span>
                    <span className="font-medium text-green-600 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Captured
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Waveform Detail</h4>
                <div className="bg-gray-50 rounded-lg p-2 border border-gray-200">
                  <WaveformCanvas
                    samples={selectedWaveform.samples}
                    duration={selectedWaveform.audioBuffer?.duration || 15}
                    isPlaying={playingIndex === selectedIndex!}
                    playbackProgress={playbackProgress[selectedIndex!] || 0}
                    color={getColorForLocation(selectedWaveform.location)}
                    height={160}
                  />
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Playback</h4>
                <button
                  onClick={() => handlePlay(selectedIndex!)}
                  className={`
                    w-full py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all
                    ${playingIndex === selectedIndex
                      ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
                      : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'}
                  `}
                >
                  {playingIndex === selectedIndex ? (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                      </svg>
                      Pause
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      Play Recording
                    </>
                  )}
                </button>
                <div className="mt-3">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6a7 7 0 010 14m0-14a7 7 0 000 14m6.364-11.364A9 9 0 0121 12a9 9 0 01-2.636 6.364" />
                    </svg>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.01"
                      value={playbackVolume}
                      onChange={(e) => setPlaybackVolume(parseFloat(e.target.value))}
                      className="flex-1 h-1.5 accent-blue-600"
                    />
                    <span className="text-xs font-mono text-gray-500 w-10 text-right">
                      {Math.round(playbackVolume * 100)}%
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Auscultation Map</h4>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 relative">
                  <HeartDiagram 
                    activePoint={getIdForLocation(selectedWaveform.location)} 
                    colors={pointColors}
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              <p className="font-medium text-sm">Select a recording</p>
              <p className="text-xs mt-1">Click on a waveform to see details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// --- Live Visualizer Canvas (real-time waveform) ---
function LiveVisualizerCanvas({ analyser, color = '#2563eb', height = 200 }: {
  analyser: AnalyserNode | null;
  color?: string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Match canvas size to container
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
      }

      const w = rect.width;
      const h = rect.height;

      analyser.getByteTimeDomainData(dataArray);

      // Background
      ctx.fillStyle = '#f9fafb';
      ctx.fillRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 0.5;
      for (let y = 0; y < h; y += h / 8) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let x = 0; x < w; x += w / 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // Center line
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Waveform
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.beginPath();

      const sliceWidth = w / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Frequency bars (bottom overlay, subtle)
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freqData);
      const barCount = 64;
      const barWidth = w / barCount;
      const step = Math.floor(freqData.length / barCount);
      
      for (let i = 0; i < barCount; i++) {
        const val = freqData[i * step];
        const barH = (val / 255) * (h * 0.3);
        ctx.fillStyle = `${color}22`; // Very transparent
        ctx.fillRect(i * barWidth, h - barH, barWidth - 1, barH);
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [analyser, color, height]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg border border-gray-200"
      style={{ height: `${height}px` }}
    />
  );
}


// --- Live Listen Tab ---
function LiveListenTab({ sessionData, waveforms }: { sessionData: RecordingData[], waveforms: WaveformData[] }) {
  const [isListening, setIsListening] = useState(false);
  const [delay, setDelay] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [selectedRecording, setSelectedRecording] = useState<number | null>(null);
  const [isPlayingRecording, setIsPlayingRecording] = useState(false);

  // Audio nodes refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const delayNodeRef = useRef<DelayNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // For recording playback visualization
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  const playbackSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const [liveAnalyser, setLiveAnalyser] = useState<AnalyserNode | null>(null);
  const [playbackAnalyser, setPlaybackAnalyser] = useState<AnalyserNode | null>(null);

  // Update volume in real-time
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
  }, [volume]);

  // Update delay in real-time
  useEffect(() => {
    if (delayNodeRef.current) {
      delayNodeRef.current.delayTime.value = delay;
    }
  }, [delay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
      stopPlaybackVis();
    };
  }, []);

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);

      const delayNode = audioCtx.createDelay(5.0);
      delayNode.delayTime.value = delay;

      const gainNode = audioCtx.createGain();
      gainNode.gain.value = volume;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.5;

      source.connect(delayNode);
      delayNode.connect(analyser);
      analyser.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      audioCtxRef.current = audioCtx;
      sourceRef.current = source;
      delayNodeRef.current = delayNode;
      gainNodeRef.current = gainNode;
      analyserRef.current = analyser;
      streamRef.current = stream;

      setLiveAnalyser(analyser);
      setIsListening(true);
    } catch (err) {
      console.error('Mic access failed:', err);
    }
  };

  const stopListening = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    if (sourceRef.current) sourceRef.current.disconnect();
    if (delayNodeRef.current) delayNodeRef.current.disconnect();
    if (analyserRef.current) analyserRef.current.disconnect();
    if (gainNodeRef.current) gainNodeRef.current.disconnect();
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
    }

    audioCtxRef.current = null;
    sourceRef.current = null;
    delayNodeRef.current = null;
    gainNodeRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;

    setLiveAnalyser(null);
    setIsListening(false);
  };

  const startPlaybackVis = (idx: number) => {
    stopPlaybackVis();
    
    const wf = waveforms[idx];
    if (!wf || !wf.blobUrl) return;

    const audio = new Audio(wf.blobUrl);
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioCtx();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;

    const source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    playbackAudioRef.current = audio;
    playbackCtxRef.current = audioCtx;
    playbackAnalyserRef.current = analyser;
    playbackSourceRef.current = source;

    setPlaybackAnalyser(analyser);
    setSelectedRecording(idx);
    setIsPlayingRecording(true);

    audio.play();
    audio.onended = () => {
      setIsPlayingRecording(false);
    };
  };

  const stopPlaybackVis = () => {
    if (playbackAudioRef.current) {
      playbackAudioRef.current.pause();
      playbackAudioRef.current = null;
    }
    if (playbackSourceRef.current) playbackSourceRef.current.disconnect();
    if (playbackAnalyserRef.current) playbackAnalyserRef.current.disconnect();
    if (playbackCtxRef.current) {
      playbackCtxRef.current.close().catch(() => {});
    }
    playbackCtxRef.current = null;
    playbackAnalyserRef.current = null;
    playbackSourceRef.current = null;
    setPlaybackAnalyser(null);
    setIsPlayingRecording(false);
  };

  const pointColors: Record<string, string> = {
    'aortic': '#dc2626', 'pulmonic': '#2563eb', 'erbs': '#7c3aed',
    'tricuspid': '#059669', 'mitral': '#d97706',
  };

  const getColorForLoc = (loc: string) => {
    const key = Object.keys(pointColors).find(k => loc.toLowerCase().includes(k));
    return key ? pointColors[key] : '#2563eb';
  };
  const getIdForLoc = (loc: string): string => {
    if (loc.toLowerCase().includes('aortic')) return 'A';
    if (loc.toLowerCase().includes('pulmonic')) return 'P';
    if (loc.toLowerCase().includes('erb')) return 'E';
    if (loc.toLowerCase().includes('tricuspid')) return 'T';
    if (loc.toLowerCase().includes('mitral')) return 'M';
    return '?';
  };

  const delayOptions = [
    { value: 0, label: 'No Delay' },
    { value: 0.5, label: '0.5 sec' },
    { value: 1, label: '1 sec' },
    { value: 2, label: '2 sec' },
    { value: 3, label: '3 sec' },
  ];

  const volumeOptions = [
    { value: 0.1, label: '10%' }, { value: 0.2, label: '20%' }, { value: 0.3, label: '30%' },
    { value: 0.4, label: '40%' }, { value: 0.5, label: '50%' }, { value: 0.6, label: '60%' },
    { value: 0.7, label: '70%' }, { value: 0.8, label: '80%' }, { value: 0.9, label: '90%' },
    { value: 1.0, label: '100%' }, { value: 1.2, label: '120%' }, { value: 1.5, label: '150%' },
    { value: 2.0, label: '200%' },
  ];

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: Live Mic + Visualizer */}
      <div className="flex-1 overflow-y-auto p-6">
        
        {/* Live Listen Section */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${isListening ? 'bg-red-500 animate-pulse' : 'bg-gray-300'}`} />
              <h3 className="font-bold text-gray-900">Live Microphone</h3>
              {isListening && <span className="text-xs text-red-600 font-medium bg-red-50 px-2 py-0.5 rounded-full">LIVE</span>}
            </div>
            <button
              onClick={isListening ? stopListening : startListening}
              className={`
                px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 transition-all
                ${isListening
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'}
              `}
            >
              {isListening ? (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="4" width="12" height="16" rx="2" />
                  </svg>
                  Stop Listening
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m-4 0h8m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  Start Listening
                </>
              )}
            </button>
          </div>

          {/* Controls */}
          <div className="px-6 py-4 flex items-center gap-6 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Delay</label>
              <select
                value={delay}
                onChange={(e) => setDelay(parseFloat(e.target.value))}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                {delayOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Volume</label>
              <select
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                {volumeOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-gray-400">
                {isListening ? 'Hearing through speakers' : 'Mic inactive'}
              </span>
            </div>
          </div>

          {/* Live Waveform */}
          <div className="p-4">
            {isListening && liveAnalyser ? (
              <LiveVisualizerCanvas analyser={liveAnalyser} color="#2563eb" height={200} />
            ) : (
              <div className="w-full rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center" style={{ height: 200 }}>
                <div className="text-center text-gray-400">
                  <svg className="w-10 h-10 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m-4 0h8m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  <p className="text-sm font-medium">Press "Start Listening" to hear yourself</p>
                  <p className="text-xs mt-1">Audio will play through your speakers with optional delay</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recording Playback Section */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="font-bold text-gray-900">Play Recordings with Visualization</h3>
            <p className="text-xs text-gray-500 mt-1">Select a recording to play it with a live waveform display</p>
          </div>

          <div className="p-4">
            {/* Recording selector chips */}
            <div className="flex flex-wrap gap-2 mb-4">
              {waveforms.map((wf, idx) => {
                const color = getColorForLoc(wf.location);
                const id = getIdForLoc(wf.location);
                const isActive = selectedRecording === idx;

                return (
                  <button
                    key={idx}
                    onClick={() => {
                      if (isPlayingRecording && selectedRecording === idx) {
                        stopPlaybackVis();
                      } else {
                        startPlaybackVis(idx);
                      }
                    }}
                    className={`
                      flex items-center gap-2 px-4 py-2 rounded-full border-2 text-sm font-semibold transition-all
                      ${isActive && isPlayingRecording
                        ? 'border-red-400 bg-red-50 text-red-700'
                        : isActive
                        ? 'border-gray-400 bg-gray-100 text-gray-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'}
                    `}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: color }}
                    >
                      {id}
                    </div>
                    <span className="hidden sm:inline">{wf.location.replace(/^\d+\.\s*/, '')}</span>
                    {isActive && isPlayingRecording && (
                      <svg className="w-3.5 h-3.5 text-red-500 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Playback Visualization */}
            {isPlayingRecording && playbackAnalyser ? (
              <LiveVisualizerCanvas
                analyser={playbackAnalyser}
                color={selectedRecording !== null ? getColorForLoc(waveforms[selectedRecording]?.location || '') : '#2563eb'}
                height={180}
              />
            ) : (
              <div className="w-full rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center" style={{ height: 180 }}>
                <p className="text-sm text-gray-400">Select a recording above to visualize it</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Info Panel */}
      <div className="w-72 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto p-5 space-y-6">
        {/* Tips */}
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">How to Use</h4>
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex gap-2">
              <span className="text-blue-500 font-bold shrink-0">1.</span>
              <p>Press <strong>Start Listening</strong> to hear live audio through your speakers.</p>
            </div>
            <div className="flex gap-2">
              <span className="text-blue-500 font-bold shrink-0">2.</span>
              <p>Adjust <strong>delay</strong> and <strong>volume</strong> to your preference.</p>
            </div>
            <div className="flex gap-2">
              <span className="text-blue-500 font-bold shrink-0">3.</span>
              <p>Click a <strong>recording chip</strong> to replay with live visualization.</p>
            </div>
          </div>
        </div>

        <hr className="border-gray-200" />

        {/* Audio Settings Info */}
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Audio Settings</h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Echo Cancel</span>
              <span className="font-medium text-orange-600">Off</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Noise Suppress</span>
              <span className="font-medium text-orange-600">Off</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Auto Gain</span>
              <span className="font-medium text-orange-600">Off</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Audio processing is disabled for raw, unfiltered heart sound playback.
            </p>
          </div>
        </div>

        <hr className="border-gray-200" />

        {/* Quick Status */}
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Status</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="text-gray-600">Microphone: {isListening ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${isPlayingRecording ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`} />
              <span className="text-gray-600">Playback: {isPlayingRecording ? 'Playing' : 'Idle'}</span>
            </div>
          </div>
        </div>

        <hr className="border-gray-200" />

        {/* Auscultation Map */}
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Auscultation Map</h4>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <HeartDiagram
              activePoint={selectedRecording !== null && waveforms[selectedRecording]
                ? getIdForLoc(waveforms[selectedRecording].location) 
                : ''}
              colors={pointColors}
            />
          </div>
        </div>
      </div>
    </div>
  );
}


// --- Heart Diagram Mini Component ---
function HeartDiagram({ activePoint, colors }: { activePoint: string; colors: Record<string, string> }) {
  const points = [
    { id: 'A', label: 'Aortic', x: 65, y: 22, colorKey: 'aortic' },
    { id: 'P', label: 'Pulmonic', x: 35, y: 22, colorKey: 'pulmonic' },
    { id: 'E', label: "Erb's", x: 35, y: 42, colorKey: 'erbs' },
    { id: 'T', label: 'Tricuspid', x: 40, y: 68, colorKey: 'tricuspid' },
    { id: 'M', label: 'Mitral', x: 25, y: 78, colorKey: 'mitral' },
  ];

  return (
    <svg viewBox="0 0 100 100" className="w-full h-auto">
      {/* Simple torso outline */}
      <ellipse cx="50" cy="55" rx="30" ry="40" fill="none" stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="4 4" />
      
      {/* Heart outline */}
      <path 
        d="M50 35 C50 25, 35 20, 35 32 C35 45, 50 55, 50 55 C50 55, 65 45, 65 32 C65 20, 50 25, 50 35Z" 
        fill="none" 
        stroke="#e5e7eb" 
        strokeWidth="1"
      />

      {/* Points */}
      {points.map(pt => {
        const isActive = pt.id === activePoint;
        const color = colors[pt.colorKey] || '#999';
        return (
          <g key={pt.id}>
            {/* Pulse ring for active */}
            {isActive && (
              <circle 
                cx={pt.x} cy={pt.y} r="6" 
                fill="none" stroke={color} strokeWidth="1" opacity="0.4"
              >
                <animate attributeName="r" from="4" to="8" dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.6" to="0" dur="1.5s" repeatCount="indefinite" />
              </circle>
            )}
            <circle 
              cx={pt.x} cy={pt.y} r={isActive ? 4 : 3} 
              fill={isActive ? color : '#d1d5db'} 
              stroke="white" strokeWidth="1.5"
            />
            <text 
              x={pt.x + 7} y={pt.y + 1} 
              fontSize="5" 
              fill={isActive ? color : '#9ca3af'}
              fontWeight={isActive ? 'bold' : 'normal'}
              dominantBaseline="middle"
            >
              {pt.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}


// --- Standalone Live Listen (exported for use outside summary) ---
export function StandaloneLiveListen({ onBack }: { onBack: () => void }) {
  const [isListening, setIsListening] = useState(false);
  const [delay, setDelay] = useState(0);
  const [volume, setVolume] = useState(1.0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const delayNodeRef = useRef<DelayNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [liveAnalyser, setLiveAnalyser] = useState<AnalyserNode | null>(null);

  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = volume;
  }, [volume]);

  useEffect(() => {
    if (delayNodeRef.current) delayNodeRef.current.delayTime.value = delay;
  }, [delay]);

  useEffect(() => {
    return () => { stopListening(); };
  }, []);

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const delayNode = audioCtx.createDelay(5.0);
      delayNode.delayTime.value = delay;
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = volume;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.5;

      source.connect(delayNode);
      delayNode.connect(analyser);
      analyser.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      audioCtxRef.current = audioCtx;
      sourceRef.current = source;
      delayNodeRef.current = delayNode;
      gainNodeRef.current = gainNode;
      analyserRef.current = analyser;
      streamRef.current = stream;

      setLiveAnalyser(analyser);
      setIsListening(true);
    } catch (err) {
      console.error('Mic access failed:', err);
    }
  };

  const stopListening = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (sourceRef.current) sourceRef.current.disconnect();
    if (delayNodeRef.current) delayNodeRef.current.disconnect();
    if (analyserRef.current) analyserRef.current.disconnect();
    if (gainNodeRef.current) gainNodeRef.current.disconnect();
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
    audioCtxRef.current = null;
    sourceRef.current = null;
    delayNodeRef.current = null;
    gainNodeRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
    setLiveAnalyser(null);
    setIsListening(false);
  };

  const delayOptions = [
    { value: 0, label: 'No Delay' }, { value: 0.5, label: '0.5s' },
    { value: 1, label: '1s' }, { value: 2, label: '2s' }, { value: 3, label: '3s' },
  ];
  const volumeOptions = [
    { value: 0.1, label: '10%' }, { value: 0.2, label: '20%' }, { value: 0.3, label: '30%' },
    { value: 0.5, label: '50%' }, { value: 0.7, label: '70%' }, { value: 1.0, label: '100%' },
    { value: 1.5, label: '150%' }, { value: 2.0, label: '200%' },
  ];

  return (
    <div className="absolute inset-0 z-50 bg-gray-50 flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => { stopListening(); onBack(); }}
            className="text-gray-500 hover:text-gray-800 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Live Listen</h1>
            <p className="text-xs text-gray-500">Real-time stethoscope audio with visualization</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isListening && (
            <span className="text-xs font-medium text-red-700 bg-red-100 px-3 py-1 rounded-full animate-pulse">
              LIVE
            </span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
        {/* Controls Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm w-full max-w-3xl">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${isListening ? 'bg-red-500 animate-pulse' : 'bg-gray-300'}`} />
              <h3 className="font-bold text-gray-900">Microphone</h3>
            </div>
            <button
              onClick={isListening ? stopListening : startListening}
              className={`px-6 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2 transition-all ${
                isListening
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              {isListening ? (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="4" width="12" height="16" rx="2" />
                  </svg>
                  Stop
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m-4 0h8m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  Start Listening
                </>
              )}
            </button>
          </div>

          {/* Delay & Volume */}
          <div className="px-6 py-3 flex items-center gap-6 bg-gray-50/50">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Delay</label>
              <select
                value={delay}
                onChange={(e) => setDelay(parseFloat(e.target.value))}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {delayOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Volume</label>
              <select
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {volumeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="ml-auto text-xs text-gray-400">
              Echo cancel: Off · Noise suppress: Off · Auto gain: Off
            </div>
          </div>
        </div>

        {/* Visualizer */}
        <div className="w-full max-w-3xl">
          {isListening && liveAnalyser ? (
            <LiveVisualizerCanvas analyser={liveAnalyser} color="#059669" height={280} />
          ) : (
            <div className="w-full rounded-xl border-2 border-dashed border-gray-300 bg-white flex flex-col items-center justify-center gap-3" style={{ height: 280 }}>
              <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m-4 0h8m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <p className="text-gray-400 font-medium">Press "Start Listening" to hear yourself</p>
              <p className="text-gray-300 text-sm">Audio will play through your speakers with live visualization</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom */}
      <div className="bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
        <button
          onClick={() => { stopListening(); onBack(); }}
          className="px-5 py-2.5 text-gray-600 hover:text-gray-800 font-medium text-sm"
        >
          ← Back to Menu
        </button>
      </div>
    </div>
  );
}
