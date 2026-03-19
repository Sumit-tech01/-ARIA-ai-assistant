import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

let session: any = null;

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT':
      const { apiKey, model, systemInstruction, voiceName } = payload;
      const ai = new GoogleGenAI({ apiKey });
      
      try {
        session = await ai.live.connect({
          model: model || "gemini-2.5-flash-native-audio-preview-12-2025",
          callbacks: {
            onopen: () => {
              console.log("Gemini Live Session Opened");
              self.postMessage({ type: 'OPEN' });
            },
            onmessage: async (message: any) => {
              console.log("Gemini Live Message:", message);
              const serverContent = message.serverContent;
              if (serverContent) {
                if (serverContent.modelTurn?.parts) {
                  for (const part of serverContent.modelTurn.parts) {
                    if (part.inlineData) {
                      console.log("Received AUDIO part from Gemini");
                      self.postMessage({ 
                        type: 'AUDIO', 
                        payload: part.inlineData.data 
                      });
                    }
                    if (part.text) {
                      console.log("Received TEXT part from Gemini:", part.text);
                      self.postMessage({ 
                        type: 'TRANSCRIPTION', 
                        payload: part.text 
                      });
                    }
                  }
                }

                if (serverContent.userTurn?.parts) {
                  for (const part of serverContent.userTurn.parts) {
                    if (part.text) {
                      console.log("User Transcription:", part.text);
                      self.postMessage({ 
                        type: 'USER_TRANSCRIPTION', 
                        payload: part.text 
                      });
                    }
                  }
                }

                if (serverContent.interrupted) {
                  console.log("Gemini Session Interrupted");
                  self.postMessage({ type: 'INTERRUPTED' });
                }
              }
            },
            onerror: (error) => {
              console.error("Gemini Live Error:", error);
              self.postMessage({ type: 'ERROR', payload: error.message });
            },
            onclose: () => {
              console.log("Gemini Live Session Closed");
              self.postMessage({ type: 'CLOSE' });
            }
          },
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || "Zephyr" } },
            },
            systemInstruction: systemInstruction || "You are ARIA, a helpful assistant.",
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        });
      } catch (err: any) {
        console.error("Gemini Live Init Error:", err);
        self.postMessage({ type: 'ERROR', payload: err.message });
      }
      break;

    case 'AUDIO_INPUT':
      if (session) {
        // console.log("Sending AUDIO_INPUT to Gemini, size:", payload.length);
        session.sendRealtimeInput({
          audio: { data: payload, mimeType: 'audio/pcm;rate=16000' }
        });
      } else {
        console.warn("Attempted to send AUDIO_INPUT but session is null");
      }
      break;

    case 'CLOSE':
      if (session) {
        session.close();
        session = null;
      }
      break;
  }
};
