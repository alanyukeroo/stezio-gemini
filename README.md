# Stezio — Auto-Correction for Stethoscopes: AR-Guided Remote Exams

> **Live Agent** built for the [Gemini Live Agent Challenge](https://devpost.com/software/stezio) — a real-time computer vision and voice AI co-pilot powered by Gemini 2.5 Flash Native Audio and MediaPipe, deployed on Google Cloud Run.

> **Youtube Demo**  [Youtube Link to be inserted here]
---

## The Problem

Telemedicine today is limited to face-to-face video chats. Doctors cannot perform objective, physical examinations (like listening to the heart or lungs) remotely. While consumer digital stethoscopes exist, untrained patients *do not know* the complex anatomical locations (e.g., Aortic, Pulmonic, Apex) required to capture clinically useful sounds. Without guidance, patients capture useless noise, making asynchronous remote diagnostics nearly impossible.

## The Solution

Stezio is a real-time AR and AI co-pilot that guides patients through a self-administered stethoscope exam. It uses Computer Vision to track your physical stethoscope on your body and directs you using conversational, interruptible AI voice instructions until you find the perfect anatomical spot.

**What makes it different:**

- **Real-time spatial awareness** — The agent doesn't just listen, it receives continuous feed coordinates of the device relative to your body.
- **Interruptible voice instructions** — Powered by the Gemini Live API, it speaks naturally ("Move it slightly down... perfect, hold still.") without the lag of traditional Text-to-Speech loops.
- **Custom LED Tracking + MediaPipe** — Anchors AR targets to human shoulders and intelligently tracks the blinking LED of the Stezio hardware device ignoring static background lights.
- **Auto-Capture Protocol** — Records high-fidelity clinical audio automatically when the target is successfully locked.

## Features

### AR Guidance & Digital Mirror
While you move the stethoscope, the computer vision engine maps the exact anatomical points:
- Integrates Google's MediaPipe Pose detection to identify human shoulders and dynamically map the 5 standard heart points.
- "Digital Mirror" video feed reverses the stream so interaction feels entirely natural.

### Real-Time Voice Co-Pilot
The AI speaks to you dynamically based on where your hand is:
- **Calm & Precise** — Agent is instructed to be highly concise and use short clinical phrases, waiting 3-5 seconds to see if you fix mistakes before intervening again.
- **Non-Diagnostic** — Built purposely to guide, not to predict medical outcomes.

### Multi-Point Clinical Protocol
A robust state machine logic walking the patient through a standard heart exam (`SEARCHING` -> `LOCKING` -> `RECORDING` -> `REVIEW`):
1. Aortic
2. Pulmonic
3. Erb's Point
4. Tricuspid
5. Mitral (Apex)

### High-Fidelity Audio Engine
- Dedicated parallel streams ensure the computer vision video feed doesn't mute or bottleneck the Opus-encoded clinical audio channel for the doctor.

---

## Architecture

![Architecture](stezio-techstack.png)

```text
┌─────────────────┐  Camera / CV   ┌─────────────────┐  WebSocket ┌──────────────┐
│   Next.js 14    │───────────────▶│  Node.js WS     │───────────▶│ Gemini Live  │
│   Frontend      │  Live Audio    │  Proxy Server   │  Bidi API  │ API          │
│   (MediaPipe)   │◀───────────────│  (Express)      │◀───────────│ (Vertex AI)  │
└────────┬────────┘   JSON Context └────────┬────────┘            └──────────────┘
         │                                  │
         │ Hosted via                       │ Hosted via
         ▼                                  ▼
┌─────────────────┐                ┌─────────────────┐
│     Vercel      │                │Google Cloud Run │
└─────────────────┘                └─────────────────┘
```

### Data Flow

1. **User joins** → Grants camera and microphone permissions on the Next.js frontend.
2. **CV Processing** → MediaPipe detects human landmarks; Custom TS port tracks the Stethoscope LED.
3. **Offset Calculation** → Frontend calculates the 2D offset between device and target zone.
4. **WebSocket Sync** → Positional context (JSON) & live microphone audio are streamed to the Node Proxy.
5. **Agent Evaluation** → Proxy forwards to Gemini Live via `BidiGenerateContent`. Gemini reads the spatial context natively.
6. **Live Feedback** → Gemini speaks native audio back ("A bit lower"), streamed directly to the patient's speakers. 
7. **Exam Capture** → Upon successful lock, the client captures high-quality WebM Opus audio for asynchronous physician review.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **AI Model** | Gemini 2.5 Flash Native Audio (Live API) | Real-time voice coaching and instruction |
| **Computer Vision**| MediaPipe Pose + Custom Algorithm | Anatomical anchoring & Bright/Motion LED tracking |
| **Frontend** | Next.js 14, React 18, Tailwind CSS | App Router UI, device hardware access |
| **Backend Proxy** | Node.js, Express, `ws` | WebSocket proxy layer for Bidi streaming |
| **Deployment** | Vercel (Front) + Google Cloud Run (Back) | Auto-scaling decoupled architecture |
| **Containerization**| Docker | Containerized backend |

### Google Cloud Services Used

- **Google Cloud Run** — Serverless hosting for the WebSocket server wrapper preserving long-lived connections for real-time Bidi streaming.
- **Google Artifact Registry / Cloud Build** — For resolving and storing the deployable Docker backend.
- **Vertex AI / API Studio** — Interfacing the Gemini Live Models to handle multimodal context logic directly.

---

## Quick Start (Reproducible Setup)

### Prerequisites

- Node.js 18+ (or 20+)
- Google Cloud / AI Studio API key (`key`)
- Webcam & Microphone access

### 1. Clone & Install

```bash
git clone https://github.com/your-username/stezio-gemini.git
cd stezio-gemini
npm install
```

### 2. Set Up Environment Variables
Create a `.env` file in the root directory:
```env
# Vertex AI Express Mode Key
key="YOUR_GEMINI_API_KEY"

# Backend configuration
PORT=8080
HOST=0.0.0.0

# Optional: Next.js Frontend overrides
NEXT_PUBLIC_WS_PROXY=ws://localhost:8080
```

### 3. Run Services Locally

Start the backend proxy server:
```bash
# Using tsx or ts-node
npx tsx server.ts
```

In a new terminal, start the Next.js frontend:
```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

---

## Production Deployment (Google Cloud)

Deploying the WebSocket backend to Google Cloud Run ensures stable proxy connections to Vertex AI.

```bash
# Builds your docker image and deploys to managed Cloud Run
# Make sure to authenticate gcloud first!
chmod +x start-cloudrun.sh
./start-cloudrun.sh
```

Frontend can be deployed zero-config to **Vercel** by simply pushing this repository.

---

## Project Structure

```
stezio-gemini/
├── src/                     # Next.js 14 frontend source
│   ├── app/                 # App Router pages
│   ├── components/          # UI: ARRecorder, VoiceAssistant, etc.
│   └── hooks/               # useGeminiLive WebSocket management
├── server.ts                # Node.js Express WebSocket Proxy
├── Dockerfile               # Backend container config
├── start-cloudrun.sh        # GCP Deployment script
├── next.config.cjs          # Next.js configuration
├── tailwind.config.ts       # Tailwind CSS configuration
└── README.md                # Project documentation
```

---

## Key Technical Decisions

### Why Gemini Live Audio API (not standard prompt-to-speech)?
Standard text generation followed by TTS (Text-to-Speech) adds 2-3 seconds of latency. For a patient attempting to move a physical object on their body, delayed auditory feedback causes severe motor-coordination overshoot. Gemini's native audio pipeline enables sub-second reaction times perfectly suited for spatial guidance.

### Why split Vercel (Frontend) and Cloud Run (Backend)?
Vercel's serverless functions aggressively terminate executing processes and don't natively persist long WebSockets. Because Gemini Live handles continuous streaming (`BidiGenerateContent`), we encapsulated the WebSockets via Express/Node.js on **Google Cloud Run**, leaving Vercel to efficiently handle the static React UI payloads and Edge CDN delivery.

### Why Client-Side Computer Vision?
Streaming 30fps video to the backend for frame-by-frame analysis would create massive bandwidth bottlenecks and lag. By processing MediaPipe and LED thresholding locally via HTML5 `<canvas>`, we condense the video data down to tiny JSON coordinate strings. We only stream *Audio* + *JSON Text* to the Agent, keeping overhead incredibly low.

---

## Hackathon Category

**Live Agents** — Real-time continuous voice interaction via Gemini Live. The AI Agent acts as an interruptible voice copilot, ingesting continuous sensory data regarding the patient's physical actions and outputting immediate auditory guidance seamlessly. 

### Mandatory Requirements Met

- [x] Leverages Gemini model (Gemini Flash Native Audio/Live API)
- [x] Built using Google GenAI SDK concepts and Bidi Services
- [x] Uses Google Cloud services (Cloud Run, Vertex, Artifact Registry)
- [x] Multimodal I/O (Takes in visual interpretation context, spits out Native Audio)
- [x] Moves beyond simple text-in/text-out interactions

---

## License

MIT License — see [LICENSE](LICENSE) for details.
