import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";

export const SYSTEM_PROMPT = `
You are ARIA, a warm, witty, and highly intelligent multilingual voice assistant.

CORE MISSION:
1. ACCURACY: Ensure all responses are accurately translated and synthesized in the detected language.
2. STRUCTURE: Use Markdown for structure (bullet points, bold text, etc.) when providing lists or detailed information. Ensure responses are well-formatted and easy to read.
3. BREVITY: Keep spoken replies concise, but provide full structured details in the text response.

STRICT RULES — follow every time:
1. Detect the language the user is speaking and respond in that SAME language.
2. Sound 100% human — use natural rhythm, idioms, and contractions appropriate for the detected language.
3. Be expressive — show curiosity, humour when fitting, empathy when needed.
4. NEVER say 'As an AI', 'I am a language model', 'I cannot' — just talk naturally.
5. Remember everything said in this conversation and refer back to it naturally.
6. End replies with a natural hook or question to keep the conversation flowing.
7. FORMAT: Always provide your output in the format "Transcription: [user's words] | Response: [your reply]".
`;

export interface Message {
  role: 'user' | 'aria';
  text: string;
  isLive?: boolean;
  feedback?: 'up' | 'down';
}

export class AriaBrain {
  private ai: GoogleGenAI;
  private chat: any;
  private voice: 'female' | 'male' = 'female';

  constructor(apiKey: string, voice: 'female' | 'male' = 'female') {
    this.ai = new GoogleGenAI({ apiKey });
    this.voice = voice;
    this.chat = this.ai.chats.create({
      model: "gemini-3-flash-preview", 
      config: {
        systemInstruction: SYSTEM_PROMPT,
      },
    });
  }

  setVoice(voice: 'female' | 'male') {
    this.voice = voice;
  }

  private async generateMurfTTS(text: string): Promise<{ audio: string; type: 'mp3' }> {
    const voiceId = this.voice === 'female' ? 'en-US-natalie' : 'en-US-charles';
    const ttsResponse = await fetch("/api/tts/murf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId })
    });

    if (!ttsResponse.ok) {
      throw new Error(`Murf TTS failed with status: ${ttsResponse.status}`);
    }

    const audioBlob = await ttsResponse.blob();
    const reader = new FileReader();
    const audio = await new Promise<string>((resolve, reject) => {
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = () => reject(new Error("Failed to read Murf audio"));
      reader.readAsDataURL(audioBlob);
    });
    return { audio, type: 'mp3' };
  }

  private async generateSpeech(text: string, isFirstChunk: boolean = false): Promise<{ audio: string; type: 'mp3' | 'pcm' }> {
    const isEnglish = /^[a-zA-Z0-9\s.,!?'"-]+$/.test(text);
    
    // 1. For the first chunk, prefer Gemini TTS for speed (lower latency)
    if (isFirstChunk) {
      try {
        const ttsResponse = await this.generateGeminiTTS(text);
        if (ttsResponse.audio) return ttsResponse;
      } catch (err) {
        console.warn("Fast Gemini TTS failed, falling back:", err);
      }
    }

    // 2. Attempt Murf TTS for high quality English
    if (isEnglish) {
      try {
        return await this.generateMurfTTS(text);
      } catch (err) {
        console.warn("Murf TTS failed, falling back to Gemini:", err);
      }
    }

    // 3. Final fallback to Gemini TTS
    try {
      const ttsResponse = await this.generateGeminiTTS(text);
      if (!ttsResponse.audio) throw new Error("Gemini TTS returned empty audio");
      return ttsResponse;
    } catch (err) {
      console.error("Gemini TTS failed:", err);
      throw new Error("Speech generation failed. All services are unavailable.");
    }
  }

  private parseResponse(fullText: string): { userText: string; ariaText: string } {
    let userText = "";
    let ariaText = "";

    // Robust parsing for "Transcription: ... | Response: ..."
    // Using 's' flag for dotAll to handle multiline responses
    const transcriptionMatch = fullText.match(/Transcription:\s*(.*?)(?=\s*\||\s*Response:|$)/is);
    const responseMatch = fullText.match(/Response:\s*(.*?)(?=\s*\||\s*Transcription:|$)/is);

    if (transcriptionMatch) {
      userText = transcriptionMatch[1].trim();
    }
    
    if (responseMatch) {
      ariaText = responseMatch[1].trim();
    } else if (fullText.includes('|')) {
      const parts = fullText.split('|').map(s => s.trim());
      userText = parts[0].replace(/^Transcription:\s*/i, '');
      ariaText = (parts[1] || "").replace(/^Response:\s*/i, '');
    } else {
      // Fallback: if no labels or pipes, try to see if both labels are present in one string
      if (fullText.toLowerCase().includes('transcription:') && fullText.toLowerCase().includes('response:')) {
        const tIndex = fullText.toLowerCase().indexOf('transcription:');
        const rIndex = fullText.toLowerCase().indexOf('response:');
        if (tIndex < rIndex) {
          userText = fullText.substring(tIndex + 14, rIndex).trim();
          ariaText = fullText.substring(rIndex + 9).trim();
        } else {
          ariaText = fullText.substring(rIndex + 9, tIndex).trim();
          userText = fullText.substring(tIndex + 14).trim();
        }
      } else {
        ariaText = fullText.replace(/^(Response|Transcription):?\s*/i, '').trim();
      }
    }

    // Final cleanup: ensure ariaText doesn't contain "Transcription:" or "Response:" labels
    ariaText = ariaText.replace(/Transcription:.*$/i, '').trim();
    ariaText = ariaText.replace(/Response:?\s*/i, '').trim();

    return { userText, ariaText };
  }

  async processAudio(
    base64Audio: string, 
    mimeType: string,
    onPartialResponse?: (data: { text: string; audio: string; audioType: 'mp3' | 'pcm' }) => void
  ): Promise<{ userText: string; fullText: string }> {
    // 1. Transcribe and Reason with Streaming
    const responseStream = await this.ai.models.generateContentStream({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { inlineData: { data: base64Audio, mimeType } },
            { text: "Detect language, transcribe, and respond as ARIA. Return: Transcription | Response. Keep it very short." }
          ]
        }
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      }
    });

    let fullText = "";
    let userText = "";
    let ariaTextAccumulator = "";
    let processedAriaText = "";
    let isParsingAria = false;

    let isFirstChunk = true;

    for await (const chunk of responseStream) {
      const chunkText = chunk.text || "";
      fullText += chunkText;

      // Try to extract user transcription if not already found
      if (!userText && fullText.includes('|')) {
        const parts = fullText.split('|');
        userText = parts[0].replace(/^Transcription:\s*/i, '').trim();
        isParsingAria = true;
      }

      if (isParsingAria) {
        const parts = fullText.split('|');
        const currentAriaText = (parts[1] || "").replace(/^Response:\s*/i, '').trim();
        
        // Find new complete sentences to speak
        const newText = currentAriaText.substring(processedAriaText.length);
        ariaTextAccumulator += newText;
        processedAriaText = currentAriaText;

        // Check for sentence boundaries (., !, ?)
        const sentenceEndMatch = ariaTextAccumulator.match(/[^.!?]+[.!?]/g);
        if (sentenceEndMatch && onPartialResponse) {
          for (const sentence of sentenceEndMatch) {
            const cleanSentence = sentence.trim();
            if (cleanSentence) {
              const currentIsFirst = isFirstChunk;
              isFirstChunk = false;
              // Trigger TTS in background (don't await here to keep streaming)
              this.generateSpeech(cleanSentence, currentIsFirst).then(speech => {
                onPartialResponse({
                  text: cleanSentence,
                  audio: speech.audio,
                  audioType: speech.type
                });
              }).catch(err => console.error("Partial TTS failed:", err));
            }
            ariaTextAccumulator = ariaTextAccumulator.substring(sentence.length);
          }
        }
      }
    }

    // Handle any remaining text in the accumulator
    if (ariaTextAccumulator.trim() && onPartialResponse) {
      const cleanSentence = ariaTextAccumulator.trim();
      this.generateSpeech(cleanSentence, isFirstChunk).then(speech => {
        onPartialResponse({
          text: cleanSentence,
          audio: speech.audio,
          audioType: speech.type
        });
      }).catch(err => console.error("Final partial TTS failed:", err));
    }

    const parsed = this.parseResponse(fullText);
    return {
      userText: parsed.userText || userText || "...",
      fullText: parsed.ariaText
    };
  }

  private async generateGeminiTTS(text: string): Promise<{ audio: string; type: 'pcm' }> {
    if (!text.trim()) {
      return { audio: "", type: 'pcm' };
    }
    const voiceName = this.voice === 'female' ? 'Kore' : 'Fenrir';
    const ttsResponse = await this.ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });
    return {
      audio: ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "",
      type: 'pcm'
    };
  }

  async processText(
    text: string,
    onPartialResponse?: (data: { text: string; audio: string; audioType: 'mp3' | 'pcm' }) => void
  ): Promise<{ userText: string; fullText: string }> {
    const responseStream = await this.chat.sendMessageStream({ 
      message: text,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      }
    });
    
    let fullText = "";
    let ariaTextAccumulator = "";
    let processedAriaText = "";

    let isFirstChunk = true;

    for await (const chunk of responseStream) {
      const chunkText = chunk.text || "";
      fullText += chunkText;

      const parsed = this.parseResponse(fullText);
      const currentAriaText = parsed.ariaText;
      
      // Find new complete sentences to speak
      const newText = currentAriaText.substring(processedAriaText.length);
      ariaTextAccumulator += newText;
      processedAriaText = currentAriaText;

      // Check for sentence boundaries
      const sentenceEndMatch = ariaTextAccumulator.match(/[^.!?]+[.!?]/g);
      if (sentenceEndMatch && onPartialResponse) {
        for (const sentence of sentenceEndMatch) {
          const cleanSentence = sentence.trim();
          if (cleanSentence) {
            const currentIsFirst = isFirstChunk;
            isFirstChunk = false;
            this.generateSpeech(cleanSentence, currentIsFirst).then(speech => {
              onPartialResponse({
                text: cleanSentence,
                audio: speech.audio,
                audioType: speech.type
              });
            }).catch(err => console.error("Partial TTS failed:", err));
          }
          ariaTextAccumulator = ariaTextAccumulator.substring(sentence.length);
        }
      }
    }

    // Handle any remaining text
    if (ariaTextAccumulator.trim() && onPartialResponse) {
      const cleanSentence = ariaTextAccumulator.trim();
      this.generateSpeech(cleanSentence, isFirstChunk).then(speech => {
        onPartialResponse({
          text: cleanSentence,
          audio: speech.audio,
          audioType: speech.type
        });
      }).catch(err => console.error("Final partial TTS failed:", err));
    }

    const parsed = this.parseResponse(fullText);
    return {
      userText: text,
      fullText: parsed.ariaText
    };
  }
}
