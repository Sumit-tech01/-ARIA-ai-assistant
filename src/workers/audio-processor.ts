// src/workers/audio-processor.ts
/// <reference lib="dom" />

class AudioProcessor extends (globalThis as any).AudioWorkletProcessor {
  private buffer: Float32Array;
  private bufferSize: number;
  private bufferIndex: number;
  private targetSampleRate: number = 16000;
  private sourceSampleRate: number;
  private resampleRatio: number;
  private lastSample: number = 0;
  private resampleOffset: number = 0;

  constructor() {
    super();
    this.sourceSampleRate = (globalThis as any).sampleRate;
    this.resampleRatio = this.sourceSampleRate / this.targetSampleRate;
    this.bufferSize = 2048; 
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    
    console.log(`AudioProcessor initialized: sourceRate=${this.sourceSampleRate}, targetRate=${this.targetSampleRate}, ratio=${this.resampleRatio}`);
  }

  process(inputs: Float32Array[][]) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      
      for (let i = 0; i < channelData.length; i++) {
        this.resampleOffset += 1.0;
        
        if (this.resampleOffset >= this.resampleRatio) {
          const currentSample = channelData[i];
          
          // Simple linear interpolation between last and current for better quality
          const fraction = (this.resampleOffset - this.resampleRatio) / 1.0;
          const interpolated = this.lastSample + (currentSample - this.lastSample) * (1 - fraction);
          
          this.buffer[this.bufferIndex++] = interpolated;
          
          if (this.bufferIndex >= this.bufferSize) {
            const int16Buffer = new Int16Array(this.bufferSize);
            for (let j = 0; j < this.bufferSize; j++) {
              const s = Math.max(-1, Math.min(1, this.buffer[j]));
              int16Buffer[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            
            this.port.postMessage(int16Buffer.buffer, [int16Buffer.buffer]);
            this.bufferIndex = 0;
          }
          
          this.resampleOffset -= this.resampleRatio;
        }
        
        this.lastSample = channelData[i];
      }
    }
    return true;
  }
}

(globalThis as any).registerProcessor('audio-processor', AudioProcessor);
