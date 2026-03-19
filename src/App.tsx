import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { Mic, Square, Loader2, Volume2, Trash2, Settings, Info, Play, Pause, SkipForward, Sun, Moon, Sparkles, User, Bot, History, ThumbsUp, ThumbsDown } from 'lucide-react';
import { AriaBrain, Message, SYSTEM_PROMPT } from './services/ariaBrain';
import { AriaLiveService } from './services/ariaLiveService';

export default function App() {
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [silenceProgress, setSilenceProgress] = useState(0); // 0 to 1
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [selectedVoice, setSelectedVoice] = useState<'female' | 'male'>(() => {
    const saved = localStorage.getItem('aria_voice_preference');
    return (saved === 'male' || saved === 'female') ? saved : 'female';
  });
  const [showHistory, setShowHistory] = useState(false);
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState('Ready — tap mic to speak');
  const [error, setError] = useState<string | null>(null);
  
  const audioQueueRef = useRef<{ buffer: AudioBuffer; type: 'mp3' | 'pcm' }[]>([]);
  const isPlayingQueueRef = useRef(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const brainRef = useRef<AriaBrain | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const silenceStartRef = useRef<number | null>(null);
  const prevRmsRef = useRef<number>(0);
  const liveServiceRef = useRef<AriaLiveService | null>(null);
  const SILENCE_THRESHOLD = 15; // Slightly more sensitive
  const SILENCE_DURATION = 1500; // 1.5 seconds of silence (reduced from 3s for faster response)

  useEffect(() => {
    localStorage.setItem('aria_voice_preference', selectedVoice);
  }, [selectedVoice]);

  useEffect(() => {
    document.body.className = theme;
    
    // Initialize ARIA Brain with API Key
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && !brainRef.current) {
      brainRef.current = new AriaBrain(apiKey, selectedVoice);
    } else if (brainRef.current) {
      brainRef.current.setVoice(selectedVoice);
    }

    // Initialize Live Service
    if (apiKey && !liveServiceRef.current) {
      liveServiceRef.current = new AriaLiveService({
        onUserTranscription: (text) => {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'user' && last.isLive) {
              return [...prev.slice(0, -1), { ...last, text }];
            }
            return [...prev, { role: 'user', text, isLive: true }];
          });
        },
        onTranscription: (text) => {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'aria' && last.isLive) {
              return [...prev.slice(0, -1), { ...last, text: last.text + text }];
            }
            return [...prev, { role: 'aria', text, isLive: true }];
          });
        },
        onStatusChange: (status) => {
          if (status === 'connected') setStatus('Live — ARIA is listening');
          else if (status === 'connecting') setStatus('Connecting to Neural Core...');
          else if (status === 'error') setStatus('Connection Error');
          else setStatus('Ready');
        },
        onError: (err) => showError(err),
        onInterrupted: () => {
          setStatus('Interrupted');
          setTimeout(() => setStatus('Live'), 1000);
        },
        onSpeakingChange: (isSpeaking) => {
          setIsSpeaking(isSpeaking);
        }
      });
    }

    return () => {
      liveServiceRef.current?.disconnect();
    };
  }, [theme, selectedVoice]);

  useEffect(() => {
    // Scroll to bottom of chat
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const showError = (message: string) => {
    setError(message);
    setTimeout(() => setError(null), 5000);
  };

  const startVisualizer = (stream: MediaStream | AudioNode | AnalyserNode, isRecordingMode = false) => {
    if (stream instanceof AnalyserNode) {
      analyserRef.current = stream;
    } else {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const ctx = audioContextRef.current;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256; 
      analyser.smoothingTimeConstant = 0.85;
      analyserRef.current = analyser;

      let source: AudioNode;
      if (stream instanceof MediaStream) {
        source = ctx.createMediaStreamSource(stream);
      } else {
        source = stream;
      }
      
      source.connect(analyser);
    }

    const analyser = analyserRef.current!;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const timeDataArray = new Uint8Array(bufferLength);
    silenceStartRef.current = null;

    const draw = () => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current;
      const canvasCtx = canvas.getContext('2d');
      if (!canvasCtx) return;

      animationFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      analyser.getByteTimeDomainData(timeDataArray);

      // Silence Detection Logic
      if (isRecordingMode) {
        const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
        if (average < SILENCE_THRESHOLD) {
          if (!silenceStartRef.current) {
            silenceStartRef.current = Date.now();
            setSilenceProgress(0);
          } else {
            const elapsed = Date.now() - silenceStartRef.current;
            const progress = Math.min(elapsed / SILENCE_DURATION, 1);
            setSilenceProgress(progress);
            
            if (elapsed > SILENCE_DURATION) {
              stopRecording();
              return;
            }
          }
        } else {
          silenceStartRef.current = null;
          setSilenceProgress(0);
        }
      }

      // Circular Visualization Logic
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const baseRadius = 60; 
      
      // Calculate overall volume (RMS)
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const val = (timeDataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / bufferLength);
      const volumeScale = Math.min(rms * 3.0, 1.8);

      const goldColor = theme === 'dark' ? '212, 175, 55' : '184, 134, 11';

      // 1. Draw Ambient Inner Glow
      const innerGlow = canvasCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, baseRadius + 80 * volumeScale);
      innerGlow.addColorStop(0, `rgba(${goldColor}, ${0.2 * volumeScale})`);
      innerGlow.addColorStop(1, 'transparent');
      canvasCtx.fillStyle = innerGlow;
      canvasCtx.beginPath();
      canvasCtx.arc(centerX, centerY, baseRadius + 80 * volumeScale, 0, Math.PI * 2);
      canvasCtx.fill();

      // 2. Draw Concentric Wave Rings
      const drawWaveRing = (scale: number, opacity: number, lineWidth: number, speed: number, offset: number, freqInfluence: number = 0.5) => {
        canvasCtx.beginPath();
        canvasCtx.lineWidth = lineWidth;
        canvasCtx.strokeStyle = `rgba(${goldColor}, ${opacity * (0.4 + volumeScale * 0.6)})`;
        canvasCtx.globalAlpha = 1;
        
        const time = Date.now() * 0.001 * speed;

        for (let i = 0; i <= bufferLength; i++) {
          const angle = (i / bufferLength) * Math.PI * 2;
          const freqValue = dataArray[i % bufferLength] / 255;
          const timeValue = (timeDataArray[i % bufferLength] - 128) / 128;
          
          const value = freqValue * freqInfluence + Math.abs(timeValue) * (1 - freqInfluence);
          
          const waveAmplitude = 30 * scale * volumeScale;
          const organicMovement = Math.sin(angle * 5 + time + offset) * 10 * volumeScale;
          const r = baseRadius + (value * waveAmplitude) + organicMovement;
          
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;

          if (i === 0) {
            canvasCtx.moveTo(x, y);
          } else {
            canvasCtx.lineTo(x, y);
          }
        }
        canvasCtx.closePath();
        canvasCtx.stroke();
      };

      // Draw four layers of waves for more complexity
      canvasCtx.shadowBlur = 20 * volumeScale;
      canvasCtx.shadowColor = `rgba(${goldColor}, 0.5)`;
      
      drawWaveRing(1.6, 0.15, 1, 1.2, 0, 0.7);
      drawWaveRing(1.1, 0.4, 2, 0.9, Math.PI, 0.5);
      drawWaveRing(0.8, 0.7, 1.5, 1.5, Math.PI / 2, 0.3);
      drawWaveRing(0.5, 0.9, 1, 2.0, Math.PI * 1.5, 0.1);
      
      canvasCtx.shadowBlur = 0;

      // 3. Draw "Neural Particles" and Network Effect
      if (volumeScale > 0.1) {
        const particleCount = Math.floor(volumeScale * 20);
        const particles: {x: number, y: number, size: number}[] = [];
        
        for (let i = 0; i < particleCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const distance = baseRadius + Math.random() * 120 * volumeScale;
          const px = centerX + Math.cos(angle) * distance;
          const py = centerY + Math.sin(angle) * distance;
          const size = Math.random() * 3 * volumeScale;
          
          particles.push({x: px, y: py, size});
          
          canvasCtx.fillStyle = `rgba(${goldColor}, ${0.4 + Math.random() * 0.4})`;
          canvasCtx.beginPath();
          canvasCtx.arc(px, py, size, 0, Math.PI * 2);
          canvasCtx.fill();
        }

        // Draw connections between nearby particles
        if (volumeScale > 0.5) {
          canvasCtx.strokeStyle = `rgba(${goldColor}, ${0.1 * volumeScale})`;
          canvasCtx.lineWidth = 0.5;
          for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
              const dx = particles[i].x - particles[j].x;
              const dy = particles[i].y - particles[j].y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < 50 * volumeScale) {
                canvasCtx.beginPath();
                canvasCtx.moveTo(particles[i].x, particles[i].y);
                canvasCtx.lineTo(particles[j].x, particles[j].y);
                canvasCtx.stroke();
              }
            }
          }
        }
      }

      prevRmsRef.current = rms;
    };

    draw();
  };


  const stopVisualizer = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (canvasRef.current) {
      const canvasCtx = canvasRef.current.getContext('2d');
      canvasCtx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const startRecording = async () => {
    if (isLiveMode) {
      if (!liveServiceRef.current) return;
      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("API Key missing");
        
        await liveServiceRef.current.connect(apiKey, SYSTEM_PROMPT, selectedVoice);
        await liveServiceRef.current.startRecording();
        
        const analyser = liveServiceRef.current.getAnalyser();
        if (analyser) {
          startVisualizer(analyser);
        }

        setIsRecording(true);
        setStatus('Live — Listening...');
      } catch (err) {
        showError("Failed to start live session");
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        processAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStatus('Listening...');
      startVisualizer(stream, true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setStatus('Error');
      showError('Microphone access denied. Please check your browser permissions.');
    }
  };

  const stopRecording = () => {
    if (isLiveMode) {
      liveServiceRef.current?.stopRecording();
      setIsRecording(false);
      setStatus('Live — Standby');
      return;
    }

    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      setIsProcessing(true);
      setSilenceProgress(0);
      setStatus('Thinking...');
      stopVisualizer();
    }
  };

  const processAudio = async (blob: Blob) => {
    if (!brainRef.current) return;

    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        
        // Clear previous queue
        audioQueueRef.current = [];
        isPlayingQueueRef.current = false;
        if (audioSourceRef.current) {
          audioSourceRef.current.stop();
          audioSourceRef.current = null;
        }

        const result = await brainRef.current!.processAudio(
          base64Audio, 
          blob.type,
          (partial) => {
            // This callback is triggered as soon as a sentence is ready
            queueAudio(partial.audio, partial.audioType);
          }
        );
        
        setMessages(prev => [
          ...prev, 
          { role: 'user', text: result.userText },
          { role: 'aria', text: result.fullText }
        ]);
        setIsProcessing(false);
      };
    } catch (err) {
      console.error('Error processing audio:', err);
      setIsProcessing(false);
      setStatus('Error');
      showError(err instanceof Error ? err.message : 'Failed to process audio');
    }
  };

  const handleTextSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || isProcessing || !brainRef.current) return;

    const text = inputText.trim();
    setInputText('');
    setIsProcessing(true);
    setStatus('Thinking...');

    // Clear previous queue
    audioQueueRef.current = [];
    isPlayingQueueRef.current = false;
    if (audioSourceRef.current) {
      audioSourceRef.current.stop();
      audioSourceRef.current = null;
    }

    try {
      const result = await brainRef.current.processText(
        text,
        (partial) => {
          queueAudio(partial.audio, partial.audioType);
        }
      );
      
      setMessages(prev => [
        ...prev, 
        { role: 'user', text: result.userText },
        { role: 'aria', text: result.fullText }
      ]);
      setIsProcessing(false);
    } catch (err) {
      console.error('Error processing text:', err);
      setIsProcessing(false);
      setStatus('Error');
      showError(err instanceof Error ? err.message : 'Failed to process text');
    }
  };

  const queueAudio = async (base64Audio: string, audioType: 'mp3' | 'pcm') => {
    if (!base64Audio) return;

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;

      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      let audioBuffer: AudioBuffer;
      if (audioType === 'pcm') {
        const int16Data = new Int16Array(bytes.buffer);
        const float32Data = new Float32Array(int16Data.length);
        for (let i = 0; i < int16Data.length; i++) {
          float32Data[i] = int16Data[i] / 32768.0;
        }
        audioBuffer = ctx.createBuffer(1, float32Data.length, 24000);
        audioBuffer.getChannelData(0).set(float32Data);
      } else {
        audioBuffer = await ctx.decodeAudioData(bytes.buffer);
      }

      audioQueueRef.current.push({ buffer: audioBuffer, type: audioType });
      if (!isPlayingQueueRef.current) {
        playNextInQueue();
      }
    } catch (err) {
      console.error("Error queuing audio:", err);
    }
  };

  const playNextInQueue = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingQueueRef.current = false;
      setIsSpeaking(false);
      setStatus('Ready — tap mic to speak');
      stopVisualizer();
      return;
    }

    isPlayingQueueRef.current = true;
    setIsSpeaking(true);
    setStatus('ARIA is speaking...');
    
    const { buffer } = audioQueueRef.current.shift()!;
    const ctx = audioContextRef.current!;
    
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    audioSourceRef.current = source;
    
    startVisualizer(source);

    source.onended = () => {
      playNextInQueue();
    };
    source.start();
  };

  const togglePause = async () => {
    if (!audioContextRef.current) return;
    
    if (audioContextRef.current.state === 'running') {
      await audioContextRef.current.suspend();
      setIsPaused(true);
      setStatus('ARIA is paused');
    } else if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
      setIsPaused(false);
      setStatus('ARIA is speaking...');
    }
  };

  const skipPlayback = () => {
    if (audioSourceRef.current) {
      audioSourceRef.current.stop();
      audioSourceRef.current = null;
      setIsPaused(false);
      setIsSpeaking(false);
      setStatus('Ready');
      stopVisualizer();
    }
  };

  const playResponse = async (base64Audio: string, audioType: 'mp3' | 'pcm') => {
    if (!base64Audio) {
      setStatus('Ready');
      return;
    }

    // Ensure context is resumed if it was suspended
    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    setIsPaused(false);
    setIsSpeaking(true);
    setStatus('ARIA is speaking...');

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      let audioBuffer: AudioBuffer;

      try {
        if (audioType === 'pcm') {
          const int16Data = new Int16Array(bytes.buffer);
          const float32Data = new Float32Array(int16Data.length);
          for (let i = 0; i < int16Data.length; i++) {
            float32Data[i] = int16Data[i] / 32768.0;
          }
          audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
          audioBuffer.getChannelData(0).set(float32Data);
        } else {
          audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer);
        }
      } catch (decodeErr) {
        throw new Error("Failed to decode audio response.");
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      audioSourceRef.current = source;
      
      // Visualize playback
      startVisualizer(source);

      source.onended = () => {
        if (audioSourceRef.current === source) {
          setIsSpeaking(false);
          setIsPaused(false);
          setStatus('Ready — tap mic to speak');
          stopVisualizer();
          audioSourceRef.current = null;
        }
      };
      source.start();
    } catch (err) {
      console.error('Error playing audio:', err);
      setIsSpeaking(false);
      setIsPaused(false);
      setStatus('Error');
      showError(err instanceof Error ? err.message : 'Playback failed');
      stopVisualizer();
      audioSourceRef.current = null;
    }
  };

  const clearChat = () => {
    setMessages([]);
    setStatus('Chat cleared');
    setTimeout(() => setStatus('Ready — tap mic to speak'), 2000);
  };

  const handleFeedback = (index: number, type: 'up' | 'down') => {
    setMessages(prev => prev.map((msg, i) => {
      if (i === index) {
        return { ...msg, feedback: msg.feedback === type ? undefined : type };
      }
      return msg;
    }));
  };

  return (
    <div className={`flex h-screen w-full overflow-hidden font-sans transition-colors duration-500 ${theme === 'light' ? 'bg-white text-gray-900' : 'bg-ink text-white'}`}>
      {/* Sidebar - History */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            className="fixed inset-y-0 left-0 z-50 w-72 glass-premium border-r border-white/10 p-6 flex flex-col"
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-sm font-bold tracking-widest uppercase opacity-50">History</h2>
              <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <History size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-4">
              {messages.length === 0 ? (
                <p className="text-xs opacity-30 italic">No recent interactions</p>
              ) : (
                messages.filter(m => m.role === 'user').map((m, i) => (
                  <div key={i} className="p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 cursor-pointer transition-all">
                    <p className="text-xs line-clamp-2 opacity-70">{m.text}</p>
                  </div>
                ))
              )}
            </div>
            <div className="mt-auto pt-6 border-t border-white/5">
              <button 
                onClick={() => setMessages([])}
                className="flex items-center space-x-2 text-xs opacity-50 hover:opacity-100 transition-opacity text-red-400"
              >
                <Trash2 size={14} />
                <span>Clear all history</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative">
        {/* Toast Notification */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -20, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: -20, x: '-50%' }}
              className="fixed top-24 left-1/2 z-[100] px-4 py-2 rounded-lg bg-red-500/90 text-white text-xs font-medium shadow-lg backdrop-blur-md flex items-center space-x-2"
            >
              <Info size={14} />
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <header className="h-20 px-8 flex items-center justify-between z-40">
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => setShowHistory(true)}
              className="p-2 hover:bg-white/5 rounded-full transition-colors opacity-60 hover:opacity-100"
            >
              <History size={20} />
            </button>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold tracking-[0.3em] uppercase opacity-40">ARIA v2.5 Online</span>
            </div>
          </div>

          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2 bg-white/5 rounded-full p-1 border border-white/10">
              <button 
                onClick={() => {
                  setIsLiveMode(false);
                  liveServiceRef.current?.disconnect();
                }}
                className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase transition-all ${!isLiveMode ? 'bg-gold text-ink shadow-lg' : 'opacity-40'}`}
              >
                Standard
              </button>
              <button 
                onClick={() => setIsLiveMode(true)}
                className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase transition-all ${isLiveMode ? 'bg-emerald-500 text-white shadow-lg' : 'opacity-40'}`}
              >
                Live
              </button>
            </div>

            <div className="flex items-center space-x-3">
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-gold">Neural Core</span>
                <span className="text-[9px] opacity-40 uppercase tracking-widest">Multilingual Active</span>
              </div>
              <div className="w-8 h-8 rounded-full glass flex items-center justify-center relative">
                <div className="absolute inset-0 rounded-full bg-gold/20 animate-ping" />
                <div className="w-2 h-2 rounded-full bg-gold shadow-[0_0_10px_rgba(212,175,55,0.8)]" />
              </div>
            </div>
            <button 
              onClick={toggleTheme}
              className="p-2 hover:bg-white/5 rounded-full transition-colors opacity-60 hover:opacity-100"
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            
            <div className="flex items-center bg-white/5 rounded-full p-1 border border-white/10">
              <button 
                onClick={() => setSelectedVoice('female')}
                className={`px-3 py-1 rounded-full text-[9px] font-bold tracking-widest uppercase transition-all ${selectedVoice === 'female' ? 'bg-gold/20 text-gold' : 'opacity-40'}`}
              >
                Female
              </button>
              <button 
                onClick={() => setSelectedVoice('male')}
                className={`px-3 py-1 rounded-full text-[9px] font-bold tracking-widest uppercase transition-all ${selectedVoice === 'male' ? 'bg-gold/20 text-gold' : 'opacity-40'}`}
              >
                Male
              </button>
            </div>

            <button className="p-2 hover:bg-white/5 rounded-full transition-colors opacity-60 hover:opacity-100">
              <Settings size={20} />
            </button>
          </div>
        </header>

        {/* Chat Area */}
        <motion.div 
          animate={{ 
            opacity: (isRecording || isSpeaking) ? 0.1 : 1,
            scale: (isRecording || isSpeaking) ? 0.98 : 1,
            filter: (isRecording || isSpeaking) ? 'blur(10px)' : 'blur(0px)'
          }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
          className="flex-1 overflow-y-auto scrollbar-hide px-8 pb-40 pt-4"
        >
          <div className="max-w-3xl mx-auto space-y-12">
            {messages.length === 0 ? (
              <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-6">
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="w-20 h-20 rounded-3xl glass-premium flex items-center justify-center shadow-2xl"
                >
                  <Sparkles size={40} className="text-gold" />
                </motion.div>
                <div className="space-y-2">
                  <h1 className="text-3xl font-light tracking-tight">How can I assist you today?</h1>
                  <p className="text-sm opacity-40 max-w-sm mx-auto leading-relaxed">
                    I'm ARIA, your advanced intelligence assistant. I can help with research, creative tasks, or just a friendly conversation.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 w-full max-w-md pt-8">
                  {['"What\'s the latest in AI?"', '"Write a poem about stars"', '"Explain quantum physics"', '"Plan a 3-day trip"'].map((suggestion, i) => (
                    <button 
                      key={i}
                      className="p-4 rounded-2xl glass hover:bg-white/5 text-left text-xs opacity-60 hover:opacity-100 transition-all border-white/5"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex space-x-4 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse space-x-reverse' : 'flex-row'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-gold/10 text-gold' : 'glass-premium text-white'}`}>
                      {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                    </div>
                    <div className="space-y-2">
                    <div className={`p-4 rounded-[24px] text-sm leading-relaxed markdown-body ${
                        msg.role === 'user' 
                          ? 'bg-gold/10 border border-gold/20 text-gold-light' 
                          : 'glass-premium border-white/5'
                      }`}>
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                      </div>
                      <div className="text-[10px] opacity-20 font-mono flex items-center space-x-2">
                        <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {msg.role === 'aria' && <span className="flex items-center space-x-1"><Sparkles size={8} /> <span>AI Generated</span></span>}
                      </div>
                      {msg.role === 'aria' && (
                        <div className="flex items-center space-x-2 pt-1">
                          <button 
                            onClick={() => handleFeedback(idx, 'up')}
                            className={`p-1.5 rounded-lg transition-all ${msg.feedback === 'up' ? 'bg-emerald-500/20 text-emerald-500' : 'opacity-20 hover:opacity-100 hover:bg-white/5'}`}
                          >
                            <ThumbsUp size={12} />
                          </button>
                          <button 
                            onClick={() => handleFeedback(idx, 'down')}
                            className={`p-1.5 rounded-lg transition-all ${msg.feedback === 'down' ? 'bg-red-500/20 text-red-500' : 'opacity-20 hover:opacity-100 hover:bg-white/5'}`}
                          >
                            <ThumbsDown size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
        </motion.div>

        {/* Voice Active Overlay */}
        <AnimatePresence>
          {(isRecording || isSpeaking) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 pointer-events-none z-20 flex flex-col items-center justify-center"
            >
              {/* Immersive Background Blur/Dim */}
              <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-ink/20 to-ink/80" />
              
              {/* Central "Neural Core" Visualizer for Voice Priority */}
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                className="relative w-96 h-96 flex items-center justify-center"
              >
                {/* Ambient Glow Layers */}
                <motion.div 
                  className="absolute inset-0 rounded-full bg-gold/10 blur-[100px] animate-breathe"
                />
                <motion.div 
                  animate={{ 
                    scale: isRecording ? [1, 1.15, 1] : 1,
                    opacity: isRecording ? [0.1, 0.3, 0.1] : 0.1
                  }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-10 rounded-full bg-gold/5 blur-[60px]"
                />
                
                {/* Floating Neural Particles */}
                <div className="absolute inset-0">
                  {[...Array(12)].map((_, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0 }}
                      animate={{ 
                        opacity: [0, 0.4, 0],
                        scale: [0.5, 1, 0.5],
                        x: [0, (Math.random() - 0.5) * 200],
                        y: [0, (Math.random() - 0.5) * 200]
                      }}
                      transition={{ 
                        duration: 4 + Math.random() * 4,
                        repeat: Infinity,
                        delay: Math.random() * 4,
                        ease: "easeInOut"
                      }}
                      className="absolute left-1/2 top-1/2 w-1 h-1 bg-gold rounded-full blur-[1px]"
                    />
                  ))}
                </div>

                <div className="relative z-10 text-center space-y-6">
                  <motion.div
                    animate={{ y: [0, -10, 0] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    className="flex flex-col items-center"
                  >
                    <span className="text-gold/60 font-medium tracking-[1em] uppercase text-[10px] glow-text mb-2">
                      Neural Core Active
                    </span>
                    <h2 className="text-white text-3xl font-light tracking-tight">
                      {isRecording ? 'Listening...' : 'Aria is speaking'}
                    </h2>
                  </motion.div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Interaction Bar */}
        <div className={`absolute bottom-0 inset-x-0 h-80 bg-gradient-to-t ${theme === 'light' ? 'from-white via-white/95' : 'from-ink via-ink/95'} to-transparent pointer-events-none z-30`} />
        
        <div className="absolute bottom-12 inset-x-0 flex flex-col items-center z-40 pointer-events-none">
          <div className="w-full max-w-2xl px-8 pointer-events-auto flex flex-col items-center space-y-8">
            
            {/* Mic and Visualizer Area - Positioned Above Input */}
            <div className="relative flex items-center justify-center">
              {/* Visualizer Waves - Centered around mic */}
              <AnimatePresence>
                {(isRecording || isSpeaking) && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="absolute inset-[-60px] flex items-center justify-center pointer-events-none"
                  >
                    <canvas 
                      ref={canvasRef} 
                      className="w-full h-full opacity-60"
                      width={400}
                      height={400}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Silence Progress Ring */}
              {isRecording && silenceProgress > 0 && (
                <div className="absolute inset-[-12px] rounded-full pointer-events-none">
                  <svg className="w-full h-full rotate-[-90deg]" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(212, 175, 55, 0.05)" strokeWidth="1.5" />
                    <motion.circle
                      cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="1.5"
                      strokeDasharray="301.6" 
                      animate={{ strokeDashoffset: 301.6 - (silenceProgress * 301.6) }}
                      className="text-gold/60 transition-all duration-300"
                    />
                  </svg>
                </div>
              )}

              {/* Playback Controls - Floating around mic */}
              <AnimatePresence>
                {isSpeaking && (
                  <>
                    <motion.button
                      initial={{ opacity: 0, scale: 0.5, x: 0 }}
                      animate={{ opacity: 1, scale: 1, x: -80 }}
                      exit={{ opacity: 0, scale: 0.5, x: 0 }}
                      onClick={togglePause}
                      className="absolute p-3 rounded-full glass hover:bg-white/10 text-white/60 hover:text-white shadow-xl"
                    >
                      {isPaused ? <Play size={20} /> : <Pause size={20} />}
                    </motion.button>
                    <motion.button
                      initial={{ opacity: 0, scale: 0.5, x: 0 }}
                      animate={{ opacity: 1, scale: 1, x: 80 }}
                      exit={{ opacity: 0, scale: 0.5, x: 0 }}
                      onClick={skipPlayback}
                      className="absolute p-3 rounded-full glass hover:bg-white/10 text-white/60 hover:text-white shadow-xl"
                    >
                      <SkipForward size={20} />
                    </motion.button>
                  </>
                )}
              </AnimatePresence>

              {/* Main Mic Button */}
              <motion.button
                layout
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                className={`relative rounded-full flex items-center justify-center transition-all duration-500 border group z-10
                  ${isRecording ? 'w-32 h-32 bg-red-500/10 border-red-500/40 shadow-[0_0_80px_rgba(239,68,68,0.3)]' : 
                    isProcessing ? 'w-28 h-28 bg-gold/10 border-gold/40' : 
                    isSpeaking ? 'w-28 h-28 bg-white/5 border-white/20 shadow-[0_0_60px_rgba(255,255,255,0.08)]' : 
                    'w-28 h-28 bg-white/[0.02] border-white/10 hover:border-gold/40 hover:bg-gold/5 active:scale-95'}`}
              >
                {isRecording && (
                  <motion.div 
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="absolute inset-0 rounded-full bg-red-500/10"
                  />
                )}
                
                {isRecording ? <Square fill="currentColor" className="text-red-500" size={32} /> : 
                 isProcessing ? <Loader2 className="animate-spin text-gold" size={40} /> : 
                 isSpeaking ? <Volume2 className="text-white" size={40} /> : 
                 <Mic className="text-white/40 group-hover:text-gold transition-colors" size={40} />}
              </motion.button>
            </div>

            {/* Text Input - Positioned Below Mic */}
            <motion.div 
              layout
              className="w-full glass-premium rounded-[32px] p-2 flex items-center shadow-2xl border-white/5 overflow-hidden"
            >
              <form onSubmit={handleTextSubmit} className="flex-1 relative flex items-center">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Ask ARIA anything..."
                  disabled={isProcessing || isRecording}
                  className="w-full bg-transparent py-4 px-8 text-sm focus:outline-none transition-all placeholder:opacity-20 disabled:opacity-50 font-medium tracking-wide"
                />
                <AnimatePresence>
                  {inputText.trim() && !isProcessing && !isRecording && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.8, x: 10 }}
                      animate={{ opacity: 1, scale: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.8, x: 10 }}
                      type="submit"
                      className="mr-2 p-2.5 bg-gold text-ink rounded-full hover:scale-105 active:scale-95 transition-all shadow-lg shadow-gold/20"
                    >
                      <SkipForward size={18} className="rotate-[-90deg]" />
                    </motion.button>
                  )}
                </AnimatePresence>
              </form>
            </motion.div>

            {/* Status Label */}
            <AnimatePresence mode="wait">
              <motion.span 
                key={status}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="text-[10px] font-bold tracking-[0.6em] uppercase opacity-20"
              >
                {isRecording && silenceProgress > 0.3 ? 'Silence detected' : status}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
