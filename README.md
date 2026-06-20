# Aria — AI-Powered KYC Loan Onboarding System

> An agentic, end-to-end video KYC (Know Your Customer) platform that interviews loan applicants via an AI video call, extracts all required data, detects fraud, assesses creditworthiness, and presents a comprehensive intelligence report to loan officers — all without any manual data entry.

---

## 📸 Screenshots

| Onboarding Flow | AI Interview | Officer Portal |
|---|---|---|
| Document upload → Consent → Video Call → Review | Real-time AI agent collects all KYC fields via voice | Full intelligence dashboard with fraud score, geo risk, AI summary |

---

## 🧠 What is This?

Traditional KYC requires applicants to fill lengthy forms manually. Aria replaces that with a **conversational AI video interview**. The system:

1. Asks the applicant questions verbally (speech-to-text → LLM → text-to-speech)
2. Extracts all loan application data from their spoken answers
3. Detects fraud signals in real time (velocity, inconsistencies, geo anomalies)
4. Generates an AI credit assessment + interview intelligence report
5. Presents everything to a Loan Officer on a structured portal for a final decision

---

## 🚀 Tech Stack

### Frontend

| Layer | Technology |
|---|---|
| Framework | **Next.js 14** (App Router, TypeScript) |
| Auth | **Clerk** (OAuth, JWT, role-based) |
| State | **Zustand** |
| Styling | Vanilla CSS + CSS custom properties |
| Real-time | **Socket.io-client** |
| Media | Web Speech API (STT), Web Speech Synthesis API (TTS), MediaDevices (webcam) |
| HTTP | **Axios** |

### Backend

| Layer | Technology |
|---|---|
| Runtime | **Node.js v22** (ES Modules) |
| Framework | **Express.js** |
| Auth | **Clerk Express SDK** (`requireAuth`, JWT verification) |
| Database | **MongoDB** via **Mongoose** |
| Cache / Queue | **Redis** (ioredis) — session pre-upload cache, rate limiting |
| Real-time | **Socket.io** |
| AI / LLM | **Google Gemini** (`gemini-2.0-flash`, `gemini-1.5-pro`) |
| Speech-to-Text | **Google Cloud Speech-to-Text** |
| File Storage | **Cloudinary** (document uploads — PAN, Aadhaar) |
| Geo / IP | **ipapi.co** (IP geolocation + VPN/proxy detection) |
| File Watch (dev) | `node --watch` |

### Infrastructure

| | |
|---|---|
| Monorepo | `frontend/` + `backend/` co-located |
| Version Control | Git / GitHub |
| Environment | `.env` files per service |

---

## 📁 Project Structure

```
KYC_Video/
├── frontend/              # Next.js 14 App
│   ├── src/
│   │   ├── app/           # Next.js App Router pages
│   │   │   ├── page.tsx               # Landing page
│   │   │   ├── onboard/               # Applicant onboarding flow
│   │   │   │   ├── language/          # Step 1 — pick language
│   │   │   │   ├── documents/         # Step 2 — upload docs (pre-consent)
│   │   │   │   ├── consent/           # Step 3 — digital consent form
│   │   │   │   ├── setup/             # Step 4 — system check (mic/cam)
│   │   │   │   ├── call/              # Step 5 — live AI interview
│   │   │   │   └── review/            # Step 6 — review & submit form
│   │   │   ├── admin/                 # Loan Officer portal
│   │   │   │   ├── page.tsx           # Applications list
│   │   │   │   └── applications/[id]  # Full intelligence report per app
│   │   │   ├── sign-in/               # Clerk auth pages
│   │   │   ├── sign-up/
│   │   │   └── officer-signup/        # Officer account creation
│   │   ├── components/
│   │   │   ├── onboarding/            # Reusable onboarding components
│   │   │   │   ├── DocumentUpload.tsx
│   │   │   │   ├── ConsentForm.tsx
│   │   │   │   ├── LanguagePicker.tsx
│   │   │   │   ├── ProgressStepper.tsx
│   │   │   │   └── SystemCheck.tsx
│   │   │   ├── WebcamFeed.tsx         # Webcam with animated ring
│   │   │   ├── WaveformVisualizer.tsx # Audio waveform animation
│   │   │   └── SessionTimeout.tsx     # Idle session warning
│   │   ├── hooks/
│   │   │   ├── useSpeechRecognition.ts
│   │   │   └── useSpeechSynthesis.ts
│   │   ├── store/
│   │   │   └── useAppStore.ts         # Zustand global state
│   │   ├── lib/
│   │   │   └── api.ts                 # Axios instance
│   │   └── middleware.ts              # Clerk route protection
│
├── backend/               # Express.js API + Agent System
│   ├── server.js          # Entry point — bootstraps Express + Socket.io
│   ├── src/
│   │   ├── agents/        # AI Agent layer (multi-agent system)
│   │   │   ├── PlannerAgent.js        # Master orchestrator (most complex)
│   │   │   ├── ConversationAgent.js   # Drives the dialogue
│   │   │   ├── IdentityAgent.js       # Validates name, DOB, PAN
│   │   │   ├── FraudAgent.js          # Real-time fraud detection
│   │   │   ├── CreditAgent.js         # Financial analysis
│   │   │   ├── DocumentAgent.js       # Document handling
│   │   │   ├── ComplianceAgent.js     # Regulatory checks
│   │   │   ├── DecisionAgent.js       # Final loan recommendation
│   │   │   └── base/                  # BaseAgent class
│   │   ├── config/
│   │   │   ├── db.js                  # MongoDB connection
│   │   │   ├── redis.js               # Redis singleton (lazy connect)
│   │   │   └── llm.js                 # Gemini client config
│   │   ├── controllers/
│   │   │   ├── session.controller.js  # Start/get/submit sessions
│   │   │   ├── admin.controller.js    # Officer portal endpoints
│   │   │   ├── auth.controller.js     # User sync with Clerk
│   │   │   ├── documentUpload.controller.js  # Cloudinary + Redis upload
│   │   │   └── kyc.controller.js      # KYC form management
│   │   ├── memory/        # Agent memory subsystem
│   │   │   ├── WorkingMemory.js       # In-call state (fields, flags, turns)
│   │   │   ├── EpisodicMemory.js      # Conversation history
│   │   │   ├── SemanticMemory.js      # Domain knowledge / rules
│   │   │   └── DecisionMemory.js      # Past decisions / patterns
│   │   ├── middleware/
│   │   │   ├── geoCapture.middleware.js     # Captures IP + geo on every request
│   │   │   ├── piiSanitizer.middleware.js   # Strips PII from logs
│   │   │   ├── promptInjectionGuard.js      # Blocks prompt injection attacks
│   │   │   └── role.middleware.js            # Officer/Admin role check
│   │   ├── models/        # Mongoose schemas
│   │   │   ├── Session.model.js       # Core — interview session
│   │   │   ├── Application.model.js   # Loan application (created post-interview)
│   │   │   ├── User.model.js          # User linked to Clerk
│   │   │   ├── KYCForm.model.js       # Structured form output
│   │   │   ├── AgentTrace.model.js    # Audit trail of agent decisions
│   │   │   ├── AgentPlan.model.js     # Agent planning logs
│   │   │   ├── FraudReport.model.js   # Fraud signal records
│   │   │   ├── AuditLog.model.js      # System audit log
│   │   │   ├── GeoLog.model.js        # Geo/IP log per request
│   │   │   └── ToolCallLog.model.js   # Tool usage logs
│   │   ├── routes/
│   │   │   ├── session.routes.js      # /api/sessions/*
│   │   │   ├── admin.routes.js        # /api/admin/* (officer protected)
│   │   │   ├── auth.routes.js         # /api/auth/*
│   │   │   ├── kyc.routes.js          # /api/kyc/*
│   │   │   ├── application.routes.js  # /api/applications/*
│   │   │   └── webhook.routes.js      # /api/webhooks/clerk
│   │   ├── services/
│   │   │   ├── agent.service.js       # Agent registry + orchestration helper
│   │   │   ├── cloudinary.service.js  # Upload buffer → Cloudinary
│   │   │   ├── ai/
│   │   │   │   ├── llm.service.js           # Gemini chat wrapper
│   │   │   │   ├── stt.service.js           # Google STT wrapper
│   │   │   │   ├── extraction.service.js    # Field extraction from transcript
│   │   │   │   ├── loanEngine.service.js    # Credit rules + LLM assessment
│   │   │   │   ├── callOrchestrator.js      # Socket event → agent pipeline
│   │   │   │   └── interviewSummary.service.js  # Post-call AI summary
│   │   │   └── geo/                   # Geo/IP enrichment service
│   │   ├── tools/                     # Agent tool functions
│   │   ├── orchestrator/              # High-level orchestration logic
│   │   └── websocket/
│   │       └── socketHandler.js       # Socket.io event handlers
│
└── README.md
```

---

## 🔄 Complete Application Flow

```
User lands on /
        ↓
[STEP 1] Language Selection (/onboard/language)
  → Picks Hindi or English, stored in Zustand

[STEP 2] Document Upload (/onboard/documents)  ← BEFORE consent
  → Uploads PAN / Aadhaar (optional)
  → Files → Cloudinary → metadata cached in Redis (TTL 2hr)
  → Cloudinary URLs saved to localStorage for review page display

[STEP 3] Consent Form (/onboard/consent)
  → Digital consent signed (name + timestamp)
  → POST /api/sessions (startSession)
      → Creates Session in MongoDB
      → Pulls pre-uploaded docs from Redis → attaches to Session.documents[]
      → Captures IP + Geo data
      → Returns sessionId

[STEP 4] System Check (/onboard/setup)
  → Tests mic, camera, browser compatibility

[STEP 5] Video Interview (/onboard/call)
  → Socket.io connect → emit call:join {sessionId}
  → Agent speaks question (Web TTS)
  → User responds (Web STT → audio blob → call:audio)
  → Backend: STT → PlannerAgent → field extraction → next question
  → Real-time fraud checks on every turn
  → On completion: call:complete → session data → sessionStorage
  → Async: AI interview summary generated from Session.transcript[]

[STEP 6] Review Form (/onboard/review)
  → Shows all extracted fields in a PDF-style form
  → Displays uploaded document thumbnails (from localStorage)
  → Applicant can edit any field
  → POST /api/sessions/:id/submit-review
      → Runs loan decision engine (rules + LLM)
      → Creates Application document in MongoDB
      → Application stores loanAmount, tenure, purpose

[OFFICER PORTAL] /admin
  → Lists all Applications with amount from Session fallback
  → Click Review → /admin/applications/:id
      → Loads full intelligence report
      → Panel 1: Applicant + Loan Details (real name from extractedAnswers)
      → Panel 2: Full KYC Fields grid with confidence bars
      → Panel 3: Documents + verification status
      → Panel 4: AI Loan Assessment (score, strengths, risks, conditions)
      → Panel 5: AI Interview Summary (tone, observations, risk notes)
      → Panel 6: Fraud Intelligence gauge + signals
      → Panel 7: IP & Geo Risk (VPN/proxy/Tor detection)
      → Officer submits final decision (approved / conditional / rejected)
```

---

## 🤖 Multi-Agent Architecture

The backend uses a **multi-agent system** where each agent is a specialist:

| Agent | Responsibility |
|---|---|
| **PlannerAgent** | Master orchestrator — drives the state machine, dispatches to specialist agents, triggers async tasks post-call |
| **ConversationAgent** | Manages dialogue flow, decides next question based on current state |
| **IdentityAgent** | Validates identity fields (name, DOB, PAN format checks) |
| **FraudAgent** | Detects fraud signals — velocity, inconsistency, reprompt count, geo anomalies |
| **CreditAgent** | Analyses financial data (income, EMI burden, employment tenure) |
| **DocumentAgent** | Handles document metadata and cross-verification |
| **ComplianceAgent** | Regulatory and data quality checks |
| **DecisionAgent** | Synthesises all agent outputs into a recommendation |

### Memory System

| Memory | Purpose |
|---|---|
| **WorkingMemory** | In-call state: collected fields, confidence scores, fraud flags, turn count |
| **EpisodicMemory** | Sequential conversation history |
| **SemanticMemory** | Domain knowledge — PAN format rules, income benchmarks |
| **DecisionMemory** | Historical decision patterns for learning |

---

## 🛡️ Security Features

- **Clerk JWT auth** on all protected routes
- **Role-based access** — `isOfficer` middleware guards all `/admin` routes
- **Prompt injection guard** middleware — blocks adversarial inputs
- **PII sanitizer** middleware — strips sensitive data from logs
- **IP + Geo capture** on every session — VPN/Proxy/Tor detection
- **Fraud signal system** — real-time multi-dimensional fraud scoring
- **Redis TTL** on pre-session document cache (2 hour expiry)

---

## 🗄️ Database Schema (Key Models)

### Session
The central data store — one per interview call.
```
Session {
  userId, clerkId, loanType, language, status
  transcript[]       ← full Q&A history
  collectedAnswers   ← Map of field → value
  extractedAnswers[] ← structured field objects with confidence
  fraudSignals[]     ← real-time fraud events
  documents[]        ← PAN, Aadhaar (Cloudinary URLs + verification)
  interviewSummary   ← AI-generated post-call report
  loanDecision       ← credit score + decision + LLM assessment
  fraudScore         ← 0-100 aggregate score
  geoData            ← city, country, ISP, VPN/proxy flags
  ipAddress
  consentData        ← signed name, IP, timestamp
}
```

### Application
Created after the applicant submits the review form.
```
Application {
  referenceNumber    ← e.g. LN-2026-8A3F2
  sessionId          ← links back to Session
  userId
  loanType, loanAmount, tenure, purpose
  status             ← submitted → under_review → approved/rejected
  officerDecision, officerNote, decisionAt
}
```

---

## ⚙️ Environment Variables

### Backend (`backend/.env`)
```env
PORT=8000
MONGODB_URI=mongodb+srv://...
CLERK_SECRET_KEY=sk_...
CLERK_PUBLISHABLE_KEY=pk_...
GEMINI_API_KEY=AIza...
GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json
CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
REDIS_URL=redis://localhost:6379
```

### Frontend (`frontend/.env.local`)
```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

---

## 🏃 Running Locally

```bash
# 1. Clone
git clone https://github.com/V1NAY-10/KYC_AGENTIC.git
cd KYC_Video

# 2. Install backend deps
cd backend && npm install

# 3. Install frontend deps
cd ../frontend && npm install

# 4. Set up .env files (see above)

# 5. Start backend (terminal 1)
cd backend && npm run dev

# 6. Start frontend (terminal 2)
cd frontend && npm run dev

# App runs at: http://localhost:3000
# API runs at: http://localhost:8000
```

> **Redis required locally**: Install Redis and ensure it's running on port 6379.
> **Google Cloud credentials** required for Speech-to-Text.

---

## 📜 API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/sync` | Clerk | Sync Clerk user to MongoDB |
| POST | `/api/sessions` | Clerk | Start new KYC session |
| GET | `/api/sessions/:id` | Clerk | Get session by ID |
| POST | `/api/sessions/:id/submit-review` | Clerk | Submit final form + run loan engine |
| POST | `/api/sessions/upload-document` | Clerk | Upload PAN/Aadhaar to Cloudinary |
| GET | `/api/admin/applications` | Officer | List all applications |
| GET | `/api/admin/applications/:id/detail` | Officer | Full intelligence report |
| PUT | `/api/admin/applications/:id/decision` | Officer | Save officer decision |
| POST | `/api/webhooks/clerk` | Public | Clerk user lifecycle webhooks |

### Socket.io Events

| Event | Direction | Description |
|---|---|---|
| `call:join` | Client → Server | Join call room with sessionId |
| `call:audio` | Client → Server | Send audio blob for STT processing |
| `call:agent-response` | Server → Client | Agent's next question + state |
| `call:user-transcript` | Server → Client | STT transcript of user's answer |
| `call:complete` | Server → Client | Interview done, sends extracted fields |
| `call:error` | Server → Client | Error during processing |

---

## 🧪 Key Design Decisions

1. **Documents before consent** — uploads cached in Redis, not a session. Session picks them up on creation.
2. **Async AI summary** — interview summary generation is non-blocking. It runs after `call:complete` is emitted to the client so the UI transitions immediately.
3. **Dual-key field lookup** — PlannerAgent stores fields as camelCase (`loanAmount`) but the extraction service uses SCREAMING_SNAKE (`LOAN_AMOUNT`). All lookups handle both formats.
4. **Transcript as source of truth** — summary generation reads from `Session.transcript[]` directly, not from an in-memory episodic store.
5. **Session → Application split** — Session holds all raw interview data. Application is the officer-facing record with clean loan fields. Amount is resolved from Session as fallback if Application record is incomplete.
