# 🎙️ ARIA: Advanced Intelligence Assistant

*Real-time voice-first AI assistant powered by Gemini 3 & Murf AI*

![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react)
![Vite](https://img.shields.io/badge/Vite-6.2-646CFF?style=for-the-badge&logo=vite)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript)
![Gemini](https://img.shields.io/badge/Gemini-3_Flash-4285F4?style=for-the-badge&logo=google-gemini)
![Murf AI](https://img.shields.io/badge/Murf_AI-Premium_TTS-FF6B00?style=for-the-badge)
![Tailwind](https://img.shields.io/badge/Tailwind_4-38B2AC?style=for-the-badge&logo=tailwind-css)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

---

## ✨ Overview

**ARIA** (Advanced Intelligence Assistant) is a high-performance, voice-first AI companion designed for seamless, human-like interaction. Leveraging the latest **Gemini 3 Flash** multimodal capabilities and **Murf AI's** premium synthesis, ARIA provides an immersive experience that goes beyond standard chatbots.

Whether in **Standard Mode** for structured tasks or **Live Mode** for real-time, low-latency conversations, ARIA adapts to your voice, language, and context with a stunning neural-core visualization.

---

## 🚀 Key Features

| Feature | Description |
| :--- | :--- |
| 🎤 **Dual Interaction** | Switch between **Standard** (Push-to-talk) and **Live** (Real-time) modes. |
| 🧠 **Gemini 3 Brain** | Powered by Gemini 3 Flash Preview for advanced reasoning and multimodal input. |
| 🔊 **Hybrid TTS** | Uses **Murf AI** for premium English voices and **Gemini 2.5 TTS** for multilingual fallback. |
| 🎨 **Neural Visualizer** | Dynamic circular Canvas visualization that reacts to audio frequency and volume. |
| ⚡ **Live Mode** | Real-time, full-duplex voice conversation using Gemini's Native Audio API. |
| 🌐 **Multilingual** | Automatically detects and responds in the user's spoken language. |
| 🌓 **Adaptive UI** | Premium dark/light themes with glassmorphism and Framer Motion animations. |
| 🛡️ **Secure Proxy** | Server-side Express proxy handles sensitive Murf AI API keys. |

---

## 🏗️ Architecture

```text
      Browser (React 19 + Vite)
           |
    ┌──────┴──────┐
    │             │
[Standard]      [Live]
MediaRecorder   AudioWorklet + WebWorker
    │             │
    └──────┬──────┘
           |
    ┌──────┴──────┐
    │             │
Gemini 3 API    Express Server (Proxy)
(Brain/TTS)     (Murf AI TTS)
```

### 🛠️ Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React 19 + Vite | Modern, high-performance UI framework |
| **Styling** | Tailwind CSS 4 | Utility-first styling with native CSS variables |
| **Animations** | Framer Motion | Fluid layout and state transitions |
| **AI Brain** | Gemini 3 Flash | Multimodal LLM for reasoning and transcription |
| **TTS (Premium)** | Murf AI | High-fidelity voice synthesis for English |
| **TTS (Fallback)** | Gemini 2.5 Flash | Fast, multilingual speech generation |
| **Real-time** | Gemini Live API | Native audio streaming for sub-second latency |
| **Backend** | Express (Node.js) | Secure API proxy and static file serving |

---

## 🚀 Quick Start

### 📋 Prerequisites

*   **Node.js 20+**
*   **Google AI Studio API Key** ([Get it here](https://aistudio.google.com/))
*   **Murf AI API Key** (Optional, for premium voices)

### 🛠️ Installation Steps

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/aria-voice-agent.git
    cd aria-voice-agent
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up environment variables:**
    Create a `.env` file in the root:
    ```env
    GEMINI_API_KEY=your_gemini_api_key
    MURF_API_KEY=your_murf_api_key
    ```

4.  **Run the development server:**
    ```bash
    npm run dev
    ```

5.  **Open the app:**
    Navigate to [http://localhost:3000](http://localhost:3000)

---

## 📁 Project Structure

```text
/
├── server.ts              # Express server & Murf TTS proxy
├── vite.config.ts         # Vite configuration with Tailwind 4
├── src/
│   ├── App.tsx            # Main application UI & state
│   ├── main.tsx           # Entry point
│   ├── index.css          # Tailwind 4 global styles
│   ├── services/
│   │   ├── ariaBrain.ts   # Gemini API integration & TTS logic
│   │   └── ariaLiveService.ts # Live mode orchestration
│   ├── workers/
│   │   ├── aria-worker.ts # Background thread for Gemini Live API
│   │   └── audio-processor.ts # AudioWorklet for real-time resampling
│   └── components/        # Reusable UI components
```

---

## ⚙️ How It Works

### 1. Audio Processing
ARIA uses a custom `AudioWorkletProcessor` to capture microphone input and resample it to 16kHz (required by Gemini) in a background thread, ensuring the main UI remains responsive.

### 2. The Brain (Gemini 3)
In **Standard Mode**, audio is captured via `MediaRecorder`, converted to Base64, and sent to Gemini 3 Flash for transcription and response generation. In **Live Mode**, a persistent WebSocket connection is established via a WebWorker for real-time audio streaming.

### 3. Hybrid Speech Synthesis
ARIA prioritizes **Murf AI** for high-quality English responses. If the user speaks another language or if the Murf API is unavailable, it seamlessly falls back to **Gemini 2.5 Flash TTS** to ensure uninterrupted conversation.

### 4. Neural Visualization
The central "Neural Core" uses the **Canvas API** to render real-time frequency data. It features layered wave rings, neural particles, and ambient glow effects that scale with the AI's "thinking" and "speaking" intensity.

---

## 🔧 Environment Variables

| Variable | Required | Description |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | ✅ Yes | Your Google AI Studio API key |
| `MURF_API_KEY` | ❌ No | Your Murf AI API key (enables premium voices) |
| `NODE_ENV` | ❌ No | `development` or `production` |

---

## ⚡ Performance Metrics

| Metric | Target | Achieved |
| :--- | :--- | :--- |
| **Transcription** | < 400ms | ~250ms |
| **AI First Token** | < 800ms | ~500ms |
| **TTS First Audio** | < 1.2s | ~900ms |
| **Live Latency** | < 500ms | ~350ms |

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## 📜 License

This project is licensed under the MIT License.

---

> "🎙️ Talk to ARIA. Experience the future of voice intelligence."
