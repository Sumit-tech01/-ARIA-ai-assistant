import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Murf TTS Proxy Endpoint
  app.post("/api/tts/murf", async (req, res) => {
    const { text, voiceId = "en-US-natalie" } = req.body;
    const apiKey = process.env.MURF_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "MURF_API_KEY not configured on server" });
    }

    try {
      const response = await fetch("https://api.murf.ai/v1/speech/generate", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          voiceId,
          format: "MP3",
          sampleRate: 24000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Murf API Error Response:", errorText);
        let errorMessage = errorText;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorJson.error || errorText;
        } catch (e) {}
        return res.status(response.status).json({ error: errorMessage });
      }

      const data = await response.json();
      const audioUrl = data.audioFile;

      // Fetch the actual audio file
      const audioResponse = await fetch(audioUrl);
      const audioBuffer = await audioResponse.buffer();

      res.set("Content-Type", "audio/mpeg");
      res.send(audioBuffer);
    } catch (error) {
      console.error("Murf TTS Error:", error);
      res.status(500).json({ error: "Internal server error during TTS generation" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
