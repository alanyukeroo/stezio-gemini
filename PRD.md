# Product Requirement Document (PRD): Stezio Web Application

| Metadata | Details |
| :--- | :--- |
| **Version** | 1.1 |
| **Status** | Draft |
| **Platform** | Web (Responsive Desktop & Mobile Browser) |
| **Last Updated** | February 2, 2026 |

---

## 1. Executive Summary
Stezio is the "Autocorrect" for Stethoscopes—a secure, web-based application designed to bridge the gap between remote patients and physicians. It enables patients to perform clinical-grade self-exams using an AR-guided interface and allows physicians to asynchronously review these high-fidelity audio recordings for diagnosis.

### Core Value Proposition
*   **For Patients:** Removes anxiety and technical error from home monitoring via AR guidance and real-time signal quality checks.
*   **For Physicians:** Provides trusted, "clean" clinical audio asynchronously, eliminating the need for live, low-quality video calls for auscultation.

---

## Post-Usability Testing Updates Tracker (March 2026)

Based on recent user feedback, the following system refinements are tracked here:

- [x] **3-c (Face ID Style Distance Guidance):** Added a pre-exam "Calibration" phase with a silhouette marker to ensure the user is centered and at the correct distance before starting.
- [x] **4-a (Recording Duration):** Increased `RECORDING_DURATION_MS` from 5 seconds to 15 seconds to provide sufficient audio for physicians.
- [x] **3-a (Pre-exam Instructions):** Add a "Preparation" checklist screen before the camera activates (e.g., "Wear thin clothes", "Turn on LED").
- [x] **3-b (Hysteresis/Jitter Fix):** Make target locking "sticky". Once the user enters the `LOCKING` state, increase the `LOCK_DISTANCE_THRESHOLD` so minor hand tremors don't break the lock.
- [x] **3-d (Accessibility - Audio Cues):** Add Text-to-Speech (TTS) commands so patients don't have to read small text while holding the device.
- [x] **4-d (More Locations, Optional):** Expand the `PROTOCOL` list to include additional locations (e.g., Lung bases) if requested.

---

## 2. Scope & Timeline

### 2.1 In Scope (MVP)
*   **Patient Portal:** Secure login, hardware setup/permissions, AR-guided exam interface (Camera + Audio), real-time AI signal validation, and secure recording upload.
*   **Physician Dashboard:** Secure login, patient list management, triage/inbox view, clinical audio playback with visualization (phonocardiogram) and filters.
*   **Infrastructure:** Secure storage (HIPAA compliant), basic user management.

### 2.2 Out of Scope (Phase 1)
*   Automated AI Disease Diagnosis (Diagnostic decisions remain with the human physician).
*   Billing & Insurance Integration.
*   EMR Integration (Epic, Cerner, etc.).
*   Live Video Tele-consultation (Synchronous video).
*   Native Mobile Apps (iOS/Android) – Web only for MVP.

---

## 3. User Personas

| Persona | Role | Demographics | Goals | Pain Points |
| :--- | :--- | :--- | :--- | :--- |
| **Martha (The Patient)** | User | 65-80 years old, limited tech literacy, potential motor tremors. | Wants to "get it right" without bothering family. Wants reassurance that the doctor heard her heart. | Confused by complex menus. Doesn't know anatomy. Anxious about holding the device correctly. |
| **Dr. Evans (The Physician)** | Reviewer | 35-55 years old, High-volume cardiologist or GP. | Wants to make decisive triage decisions in <30 seconds per file. Requires clear, noise-free audio. | Wasted time reviewing bad audio. "Scratchy" recordings. Disconnected workflows. |

---

## 4. Functional Requirements

### 4.1 Module A: Patient Portal (Home Exam)

| ID | Feature | Description | Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **FR-P-01** | **Device Check & Permissions** | App detects browser compatibility and requests Camera/Microphone access. | - Must prompt user to select "Stezio Adapter" if multiple inputs exist.<br>- Block access if browser is unsupported (e.g., IE11). |
| **FR-P-02** | **AR Assisted Navigation** | "The Digital Mirror" - Shows user's webcam feed with overlaid instructions. | - Live video feed must be mirrored.<br>- AR Target Zone (chest outline/circle) displayed over video.<br>- Visual states: "Searching" (Yellow/Dotted) vs. "Aligned" (Solid White). |
| **FR-P-03** | **Real-Time Signal Validation** | Algorithms monitor volume and Signal-to-Noise Ratio (SNR) instantly. | - **Bad Signal:** Red indicator + Tooltip ("Press harder").<br>- **Good Signal:** Green indicator.<br>- System prevents recording if signal is consistently red. |
| **FR-P-04** | **Auto-Capture Logic** | Smart recording trigger to reduce user error. | - Recording starts automatically after 3 continuous seconds of "Green" signal.<br>- Records exactly 15 seconds of audio.<br>- No manual "Record" button required in flow. |
| **FR-P-05** | **Review & Submit** | Simple playback and submission flow. | - User can play back the 15s clip.<br>- "Send to Doctor" button uploads file.<br>- Success animation confirms upload immediately. |
| **FR-P-06** | **Multimodal Live AI Assistant (Stezio Voice Co-Pilot)** | Interactive AI agent that guides the patient in real time using camera and microphone input. | - System sends continuous stream of video/audio to the Gemini Live API.<br>- AI gives real-time voice instructions (e.g., "Move the stethoscope a bit to the left.").<br>- Patient can interrupt the AI (e.g., "Wait a second" halts speech).<br>- AI visually confirms hardware status (blink detection) and tracks stethoscope position on the chest. |

### 4.2 Module B: Physician Dashboard

| ID | Feature | Description | Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **FR-D-01** | **Inbox & Triage** | List view of patient submissions. | - Sortable by Date, Urgency, and Patient Name.<br>- Status indicators: "New", "Reviewed", "Retake Requested". |
| **FR-D-02** | **AI Quality Tagging** | Pre-processing of audio files before doctor review. | - Auto-tag files as "High Quality" or "Low Quality/Noisy" based on SNR analysis. |
| **FR-D-03** | **Clinical Audio Player** | Advanced player for diagnostic listening. | - **Visualizer:** Phonocardiogram (waveform) display synced to audio.<br>- **Speed Control:** 0.5x, 1x, 2x playback options.<br>- **Looping:** Ability to loop a specific segment of the 15s clip. |
| **FR-D-04** | **Frequency Filters** | Digital filters to isolate heart vs. lung sounds. | - **Bell Mode:** Low-pass filter (simulate bell) for heart sounds.<br>- **Diaphragm Mode:** High-pass filter for lung/breath sounds. |

---

## 5. Non-Functional Requirements

### 5.1 Performance
*   **Latency:** Audio visualization on patient side must be <100ms to feel "real-time". Voice-to-voice response time must be under 1 second so the conversation feels natural.
*   **Audio Quality:** Recordings stored as uncompressed WAV or high-bitrate MP3 (min 192kbps).
*   **Upload Speed:** 15s clip must upload in <5 seconds on standard 4G/LTE connection.

### 5.2 Security & Compliance (HIPAA)
*   **Data Encryption:** AES-256 for data at rest. TLS 1.3 for data in transit.
*   **Authentication:** Multi-Factor Authentication (MFA) or Passwordless Magic Links for patients.
*   **Zero-Footprint:** No patient audio data deemed "PHI" permanently stored in browser cache/local storage.
*   **API Security:** The Gemini API key must stay hidden. All AI communication must go through a secure backend server instead of the React frontend.

### 5.3 Compatibility
*   **Browsers:** Chrome (v90+), Safari (v14+), Edge.
*   **Devices:** Desktop/Laptop Webcams, Mobile Browsers (iOS Safari, Android Chrome).

---

## 6. User Interface Guidelines

### 6.1 Patient Flow
1.  **Login:** Enter secure code / Magic Link.
2.  **Setup:** "Connect Stezio" -> "Allow Camera/Mic" -> "Sound Check".
3.  **Exam:**
    *   *Visual:* Large live video feed.
    *   *Overlay:* Semi-transparent torso guide.
    *   *Feedback:* Traffic light system (Red/Yellow/Green) for signal quality.
4.  **Success:** "Recording Complete" -> "Sending..." -> "Done!".

### 6.2 Physician Flow
1.  **Dashboard:** Grid/List of incoming cases.
2.  **Review Mode:**
    *   Waveform dominates the screen.
    *   Filter toggles clearly visible at bottom.
    *   "Mark as Reviewed" or "Request Retake" sticky footer.

---

## 7. Success Metrics (KPIs)

*   **First-Time Success Rate:** >80% of users capture a "Green Light" signal on their first attempt.
*   **Audio Rejection Rate:** <5% of submissions marked as "Unusable" by physicians.
*   **Time-to-Capture:** Average session time (Login to Upload) < 2 minutes.

---

## 8. Technology Stack

### 8.1 The Core (Frontend Framework)
*   **Next.js (React):** Industry standard. Handles routing easily and hosts perfectly on Vercel.
*   **TypeScript:** Mandatory for medical data safety and hardware logic (audio/video streams) to prevent bugs.
*   **Tailwind CSS:** Fastest way to build a clean, "clinical" looking UI without custom CSS.

### 8.2 AR & Camera Logic ("The Digital Mirror")
*   **MediaPipe Pose (Google):** Runs entirely in-browser. Detects shoulders/chest landmarks for accurate "Target Zone" anchoring.
*   **React-Webcam:** Simple integration for handling camera permissions and video streams.

### 8.3 Audio Engine (Signal Validation)
*   **Web Audio API:** Native browser API used for:
    *   Microphone input capture.
    *   Real-time waveform visualization (Oscilloscope).
    *   Frequency analysis (FFT) for signal quality checks.
*   **Meyda.js (Optional):** Simplifies extraction of audio features (e.g., "Loudness", "Spectral Flatness") for the Quality Check logic.

### 8.4 Backend (Database & Storage)
*   **Supabase:** Open-source Firebase alternative.
    *   **Auth:** HIPAA-compliant login (Email/Magic Link).
    *   **Database:** PostgreSQL (Structured and reliable).
    *   **Storage:** Secure buckets for storing .wav audio files.

### 8.5 Hosting
*   **Vercel:** Optimized hosting platform for Next.js applications.

### 8.6 AI Engine & Proxy
*   **Google Gemini Multimodal Live API (Vertex AI):** The main intelligence engine that processes real-time video and audio to provide voice guidance.
*   **Backend Proxy (Google Cloud Run / Node.js):** A secure server to protect the Gemini API keys and manage the connection between the web application and Google servers.

### Summary: The "Stezio Stack"

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Frontend** | Next.js + TypeScript | Standard, fast, type-safe ecosystem. |
| **Styling** | Tailwind CSS | Rapid, consistent UI development. |
| **AR/Vision** | MediaPipe Pose | Accurate in-browser body landmark detection. |
| **Audio** | Web Audio API | Low-latency signal processing and visualization. |
| **Backend** | Supabase | Integrated Auth, DB, and File Storage. |
| **Hosting** | Vercel | Seamless CI/CD and deployment. |
| **AI Engine** | Google Gemini Live | Real-time multimodal voice and visual guidance. |
| **AI Proxy** | Google Cloud Run / Node.js | Secure backend for managing API keys and connections. |

---

## 9. AI Persona & Conversational Guidelines

### 9.1 AI Persona: Stezio Voice Co-Pilot
*   **Role:** An incredibly patient, supportive, and articulate AI guide focused entirely on the proper placement and stability of the digital stethoscope.
*   **Tone:** Calm, clear, professional, and patient.
*   **Pacing:** It allows for comfortable human reaction times. If interrupted, it yields immediately.
*   **Strict Prohibitions:** The AI is **strictly forbidden from giving medical advice, interpreting sounds, or formulating a diagnosis.** Its sole function is to facilitate the physical acquisition of high-quality stethoscope audio for the human physician to analyze later.