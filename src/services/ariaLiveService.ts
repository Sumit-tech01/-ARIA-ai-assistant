// src/services/ariaLiveService.ts
export interface AriaLiveCallbacks {
  onTranscription?: (text: string) => void;
  onUserTranscription?: (text: string) => void;
  onInterrupted?: () => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: 'idle' | 'connecting' | 'connected' | 'error') => void;
  onSpeakingChange?: (isSpeaking: boolean) => void;
}

export class AriaLiveService {
  private worker: Worker | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private nextPlayTime: number = 0;
  private isRecording: boolean = false;
  private callbacks: AriaLiveCallbacks;
  private status: 'idle' | 'connecting' | 'connected' | 'error' = 'idle';

  constructor(callbacks: AriaLiveCallbacks) {
    this.callbacks = callbacks;
  }

  private isSpeaking: boolean = false;
  private speakingTimer: any = null;

  private setStatus(status: 'idle' | 'connecting' | 'connected' | 'error') {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  private setSpeaking(isSpeaking: boolean) {
    if (this.isSpeaking === isSpeaking) return;
    this.isSpeaking = isSpeaking;
    this.callbacks.onSpeakingChange?.(isSpeaking);
  }

  private resetSpeakingTimer() {
    this.setSpeaking(true);
    if (this.speakingTimer) clearTimeout(this.speakingTimer);
    this.speakingTimer = setTimeout(() => {
      this.setSpeaking(false);
      this.speakingTimer = null;
    }, 1500); // Reset after 1.5s of silence
  }

  private connectPromise: { resolve: () => void; reject: (err: string) => void } | null = null;

  private analyser: AnalyserNode | null = null;

  async connect(apiKey: string, systemInstruction: string, voice: 'female' | 'male' = 'female') {
    if (this.status === 'connected') return;
    
    this.setStatus('connecting');

    return new Promise<void>((resolve, reject) => {
      this.connectPromise = { resolve, reject };

      // 1. Initialize Worker
      this.worker = new Worker(new URL('../workers/aria-worker.ts', import.meta.url), { type: 'module' });
      
      this.worker.onmessage = async (event) => {
        const { type, payload } = event.data;

        switch (type) {
          case 'OPEN':
            this.setStatus('connected');
            this.connectPromise?.resolve();
            this.connectPromise = null;
            break;
          case 'AUDIO':
            this.resetSpeakingTimer();
            this.playAudioChunk(payload);
            break;
          case 'TRANSCRIPTION':
            this.resetSpeakingTimer();
            this.callbacks.onTranscription?.(payload);
            break;
          case 'USER_TRANSCRIPTION':
            this.callbacks.onUserTranscription?.(payload);
            break;
          case 'INTERRUPTED':
            this.stopPlayback();
            this.callbacks.onInterrupted?.();
            break;
          case 'ERROR':
            this.setStatus('error');
            this.callbacks.onError?.(payload);
            this.connectPromise?.reject(payload);
            this.connectPromise = null;
            break;
          case 'CLOSE':
            this.setStatus('idle');
            break;
        }
      };

      const voiceName = voice === 'female' ? 'Kore' : 'Fenrir';

      this.worker.postMessage({
        type: 'INIT',
        payload: {
          apiKey,
          systemInstruction,
          voiceName
        }
      });

      // 2. Initialize Audio Context
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.85;
        // Do NOT connect analyser to destination to avoid mic echo
        // this.analyser.connect(this.audioContext.destination);

        this.audioContext.audioWorklet.addModule(new URL('../workers/audio-processor.ts', import.meta.url))
          .catch(err => {
            this.setStatus('error');
            this.callbacks.onError?.("Failed to load audio processor");
            this.connectPromise?.reject("Failed to load audio processor");
            this.connectPromise = null;
          });
      }
    });
  }

  async startRecording() {
    if (!this.audioContext || this.status !== 'connected' || !this.analyser) return;

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const source = this.audioContext.createMediaStreamSource(this.stream);
    
    // Connect input to analyser for visualization
    source.connect(this.analyser);

    this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    this.workletNode.port.onmessage = (event) => {
      const buffer = event.data;
      const base64 = this.arrayBufferToBase64(buffer);
      this.worker?.postMessage({ type: 'AUDIO_INPUT', payload: base64 });
    };

    source.connect(this.workletNode);
    this.isRecording = true;
  }

  getAnalyser() {
    return this.analyser;
  }

  getStream() {
    return this.stream;
  }

  stopRecording() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.isRecording = false;
  }

  private playAudioChunk(base64: string) {
    if (!this.audioContext) return;

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 0x8000;
    }

    const buffer = this.audioContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser!);
    source.connect(this.audioContext.destination);

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
    };

    const startTime = Math.max(this.audioContext.currentTime, this.nextPlayTime);
    source.start(startTime);
    this.nextPlayTime = startTime + buffer.duration;
  }

  private stopPlayback() {
    this.activeSources.forEach(s => {
      try { s.stop(); } catch (e) {}
    });
    this.activeSources.clear();
    this.nextPlayTime = 0;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  disconnect() {
    this.stopRecording();
    this.worker?.postMessage({ type: 'CLOSE' });
    this.worker = null;
    this.audioContext?.close();
    this.audioContext = null;
    this.setStatus('idle');
  }
}
