# Aria KYC — Complete Technical Deep Dive

> This document is a comprehensive explanation of every layer of the system — written for a technical interview. Covers frontend architecture, backend architecture, data flow, agent system, memory model, security, and key design decisions.

---

# PART 1 — FRONTEND

## Overview

The frontend is a **Next.js 14 application** using the **App Router** (not Pages Router). It is written in TypeScript. It has two distinct user-facing portals:

1. **Applicant Onboarding Flow** (`/onboard/*`) — a 6-step wizard guiding the applicant through the loan application process
2. **Loan Officer Admin Portal** (`/admin/*`) — a dashboard for bank employees to review applications

Authentication is handled entirely by **Clerk**, which provides OAuth, magic links, and JWT verification out of the box.

---

## Frontend File Structure

```
frontend/
├── src/
│   ├── app/                          ← Next.js App Router
│   │   ├── layout.tsx                ← Root layout (ClerkProvider wraps everything)
│   │   ├── globals.css               ← Global design tokens and CSS
│   │   ├── page.tsx                  ← Landing page (/)
│   │   │
│   │   ├── onboard/
│   │   │   ├── layout.tsx            ← Shared layout for all onboard steps (progress stepper)
│   │   │   ├── language/page.tsx     ← Step 1: Language selection
│   │   │   ├── documents/page.tsx    ← Step 2: Document upload (before consent)
│   │   │   ├── consent/page.tsx      ← Step 3: Digital consent form
│   │   │   ├── setup/page.tsx        ← Step 4: Camera + mic system check
│   │   │   ├── call/page.tsx         ← Step 5: Live AI video interview
│   │   │   └── review/page.tsx       ← Step 6: Review + submit form
│   │   │
│   │   ├── admin/
│   │   │   ├── page.tsx              ← Applications list dashboard
│   │   │   └── applications/
│   │   │       └── [id]/page.tsx     ← Officer intelligence report (dynamic route)
│   │   │
│   │   ├── officer-signup/page.tsx   ← Officer account creation page
│   │   ├── sign-in/[[...sign-in]]/   ← Clerk sign-in (catch-all route)
│   │   └── sign-up/[[...sign-up]]/   ← Clerk sign-up
│   │
│   ├── components/
│   │   ├── onboarding/
│   │   │   ├── LanguagePicker.tsx    ← Language selection UI
│   │   │   ├── DocumentUpload.tsx    ← File upload with drag-and-drop + preview
│   │   │   ├── ConsentForm.tsx       ← Digital consent with signature field
│   │   │   ├── ProgressStepper.tsx   ← Visual step indicator (1-6)
│   │   │   └── SystemCheck.tsx       ← Mic/camera permission + test
│   │   ├── WebcamFeed.tsx            ← getUserMedia webcam component + animated ring
│   │   ├── WaveformVisualizer.tsx    ← Real-time audio waveform via AnalyserNode
│   │   └── SessionTimeout.tsx        ← Idle warning banner
│   │
│   ├── hooks/
│   │   ├── useSpeechRecognition.ts   ← Wraps Web Speech API + audio capture
│   │   └── useSpeechSynthesis.ts     ← Wraps SpeechSynthesis API (TTS)
│   │
│   ├── store/
│   │   └── useAppStore.ts            ← Zustand global state (language, sessionId)
│   │
│   ├── lib/
│   │   └── api.ts                    ← Axios instance (base URL, credentials)
│   │
│   └── middleware.ts                 ← Clerk route protection middleware
```

---

## Onboarding Flow — Step by Step

### Step 1: Language Selection (`/onboard/language`)
**Component**: `LanguagePicker.tsx`  
User picks English or Hindi. Choice stored in **Zustand** (`useAppStore`). Affects:
- TTS language (`hi-IN` or `en-US`)
- STT language
- UI text on key pages

---

### Step 2: Document Upload (`/onboard/documents`)
**Component**: `DocumentUpload.tsx`  
This step happens **before consent** — there is no session yet.

**Flow**:
1. User drags/clicks to upload PAN card and/or Aadhaar card
2. File is validated (type: JPG/PNG/WebP/PDF, size: ≤5MB)
3. A local `URL.createObjectURL()` preview is generated for images
4. File is posted via `multipart/form-data` to `POST /api/sessions/upload-document` (no sessionId in the body)
5. On success, the cloud URL + preview + filename is saved to **`localStorage["kyc_pre_docs"]`**
6. User clicks "Continue" → navigates to `/onboard/consent`

The upload itself is handled by the backend's `documentUpload.controller.js` which stores the Cloudinary URL in **Redis** under `docs:{clerkUserId}` with a 2-hour TTL.

**Why Redis here?** There is no Session yet at this point. The session is only created when the user agrees to the consent form. Redis is used as a temporary holding area.

---

### Step 3: Consent Form (`/onboard/consent`)
**Component**: `ConsentForm.tsx`

User reads the terms and types their name as a digital signature.

On "I Agree":
1. Calls `POST /api/sessions` (the `startSession` backend handler)
2. Backend creates a new `Session` document in MongoDB
3. Backend reads `docs:{clerkUserId}` from Redis → attaches those documents to `Session.documents[]`
4. Redis key is deleted
5. Backend also captures the user's IP and geo data (via `geoCapture` middleware)
6. Returns `{ sessionId }`
7. `sessionId` is stored in **Zustand** and navigates to `/onboard/setup`

---

### Step 4: System Check (`/onboard/setup`)
**Component**: `SystemCheck.tsx`

Runs browser feature detection:
- `navigator.mediaDevices.getUserMedia` — requests mic + camera permission
- Checks browser compatibility for Web Speech API
- Shows green/red indicators for each check
- User confirms → navigates to `/onboard/call`

---

### Step 5: Live AI Interview (`/onboard/call`)
**File**: `app/onboard/call/page.tsx`

This is the most complex page.

**UI Layout**:
- Left (60%): Webcam feed with animated speaking/listening ring
- Right (40%): Agent panel — Aria's speech bubble, user transcript, progress steps, end call button

**Real-time Architecture**:
```
Client                            Server (Socket.io)
  |                                    |
  |-- emit('call:join', sessionId) --> |
  |                                    |-- PlannerAgent starts
  |<-- emit('call:agent-response') --- |  (Aria speaks first question)
  |                                    |
  |-- [User speaks — STT captures] --> |
  |-- emit('call:audio', audioBlob)--> |  (audio → STT → LLM → next question)
  |<-- emit('call:user-transcript') -- |  (real-time transcript)
  |<-- emit('call:agent-response') --- |  (next question)
  |          ... repeats ...           |
  |<-- emit('call:complete') --------- |  (all fields collected)
  |                                    |
  → sessionStorage.kycReviewData = data
  → navigate to /onboard/review
```

**Hooks used**:
- `useSpeechRecognition` — captures microphone audio via `MediaRecorder` API, sends chunks to server
- `useSpeechSynthesis` — plays agent's text response via browser's `SpeechSynthesisUtterance`

**Progress tracker**: 11 CALL_STEPS constants define the interview stages. As the server sends `state` on each response, the UI updates the progress bar.

**Silence detection**: After the agent speaks, a 7-second silence timer starts. If the user doesn't speak, it auto-submits.

---

### Step 6: Review Form (`/onboard/review`)
**File**: `app/onboard/review/page.tsx`

**What it shows**:
1. **Uploaded Documents panel** — reads `localStorage["kyc_pre_docs"]` — shows image thumbnails or PDF icons for pre-uploaded docs. No upload box (removed by design — uploads happen at step 2 only)
2. **KYC Fields** — three sections: Personal Info, Financial Details, Loan Details. Each field shows the AI-extracted value with a confidence indicator dot
3. Each field is editable — clicking "Edit" shows an inline input
4. Low-confidence fields are flagged with a yellow "LOW CONF" badge

**On Submit**:
- `POST /api/sessions/:id/submit-review` with `{ extractedFields }` array
- Backend runs the loan decision engine
- Creates an `Application` document
- Returns success → shows "Application Submitted!" screen
- `localStorage["kyc_pre_docs"]` is cleared

---

## Admin / Officer Portal

### Applications List (`/admin/page.tsx`)

Fetches `GET /api/admin/applications` (officer-only route).

Shows a table with:
- Reference number
- Applicant name (resolved from `extractedAnswers` on the backend, not the User model)
- Loan type badge
- Amount in ₹ (Indian locale `en-IN` formatting)
- Submitted date + relative time
- Status badge (In Review / Approved / Rejected / Conditional)
- "Review →" link to detail page

Filter tabs: All / Pending / Approved / Rejected

---

### Intelligence Report (`/admin/applications/[id]/page.tsx`)

Fetches `GET /api/admin/applications/:id/detail`.

**7 panels rendered**:

| Panel | Data source |
|---|---|
| 👤 Applicant & Loan Details | `applicant.name` (from extractedAnswers) + `application.{loanAmount,tenure,purpose}` |
| 📋 Extracted KYC Data | `kycFields[]` — full grid with confidence bars per field |
| 📄 Documents & Verification | `documents[]` — cloud URL link + verified/unverified badge |
| 🏦 AI Loan Assessment | `loanDecision` — score gauge, strengths, risks, conditions |
| 🤖 AI Interview Summary | `interviewSummary` — tone, observations, risk notes, recommendation |
| 🛡️ Fraud Intelligence | `fraudIntelligence` — score gauge + signal list |
| 📍 IP & Geo Risk | `geoRisk` — IP, city, ISP, VPN/Proxy/Tor chips |

**Score Gauge**: A custom SVG circle with `strokeDashoffset` animation. The color interpolates green→yellow→red based on the score.

**Officer Decision**: Sticky panel with status dropdown + officer note textarea + Save button. Calls `PUT /api/admin/applications/:id/decision`.

---

## State Management

**Zustand** (`useAppStore.ts`):
```ts
{
  language: 'en' | 'hi' | null
  sessionId: string | null
  setLanguage: (lang) => void
  setSessionId: (id) => void
  reset: () => void
}
```

Why Zustand over Redux: lightweight, no boilerplate, works seamlessly with Next.js SSR hydration.

**localStorage**:
- `kyc_pre_docs` — pre-uploaded document metadata for display on review page

**sessionStorage**:
- `kycReviewData` — `{ sessionId, extractedFields }` passed from call page to review page via sessionStorage (avoids re-fetching)

---

## Auth — Clerk

Every page under `/admin` is protected by Clerk's middleware in `middleware.ts`. The middleware:
1. Reads the JWT from the request (cookie or Authorization header)
2. Verifies with Clerk's public key
3. Redirects to `/sign-in` if not authenticated

The `useAuth()` hook gives: `{ isLoaded, isSignedIn, getToken, userId }`. `getToken()` returns a short-lived JWT that is sent as `Authorization: Bearer <token>` with all API calls.

---

---

# PART 2 — BACKEND

## Overview

The backend is an **Express.js** application running on **Node.js v22** using **ES Modules** (`"type": "module"` in `package.json`). It combines:
- A REST API
- A Socket.io real-time server
- A multi-agent AI system

---

## Entry Point — `server.js`

```
1. Import express, http, socket.io
2. Connect to MongoDB (db.js)
3. Mount REST routes
4. Attach Socket.io to HTTP server
5. Register Socket.io handlers (socketHandler.js)
6. Listen on PORT (default 8000)
```

---

## Backend File Structure

```
backend/
├── server.js                         ← Entry point
└── src/
    ├── agents/                       ← The multi-agent AI layer
    │   ├── base/
    │   │   └── BaseAgent.js          ← Abstract agent class (log, trace, tool methods)
    │   ├── PlannerAgent.js           ← Master orchestrator (largest file ~500 lines)
    │   ├── ConversationAgent.js      ← Dialogue management
    │   ├── IdentityAgent.js          ← Identity validation
    │   ├── FraudAgent.js             ← Fraud detection
    │   ├── CreditAgent.js            ← Financial analysis
    │   ├── DocumentAgent.js          ← Document handling
    │   ├── ComplianceAgent.js        ← Regulatory checks
    │   └── DecisionAgent.js          ← Final recommendation
    │
    ├── config/
    │   ├── db.js                     ← mongoose.connect()
    │   ├── redis.js                  ← ioredis singleton (lazy connect, retry strategy)
    │   └── llm.js                    ← GoogleGenerativeAI client
    │
    ├── controllers/                  ← Request handlers (business logic)
    │   ├── session.controller.js     ← startSession, getSession, submitReview
    │   ├── admin.controller.js       ← getApplications, getApplicationDetail, updateDecision
    │   ├── auth.controller.js        ← syncUser (Clerk → MongoDB)
    │   ├── documentUpload.controller.js ← Cloudinary upload + Redis/MongoDB routing
    │   └── kyc.controller.js         ← KYC form CRUD
    │
    ├── memory/                       ← 4-layer agent memory system
    │   ├── WorkingMemory.js          ← Short-term, in-call state (Map in memory)
    │   ├── EpisodicMemory.js         ← Conversation history (ordered entries)
    │   ├── SemanticMemory.js         ← Domain knowledge (rules, schemas)
    │   └── DecisionMemory.js         ← Past decision patterns
    │
    ├── middleware/
    │   ├── geoCapture.middleware.js  ← Runs on every request, enriches req.geoData
    │   ├── piiSanitizer.middleware.js← Strips PAN, Aadhaar from logs
    │   ├── promptInjectionGuard.js   ← Regex + heuristic injection detection
    │   └── role.middleware.js        ← isOfficer, isAdmin role checks
    │
    ├── models/                       ← Mongoose schemas
    │   ├── Session.model.js          ← Core (transcript, answers, fraud, documents, summary)
    │   ├── Application.model.js      ← Loan application record
    │   ├── User.model.js             ← Clerk-linked user
    │   ├── KYCForm.model.js          ← Structured KYC output
    │   ├── AgentTrace.model.js       ← Per-agent decision log
    │   ├── AgentPlan.model.js        ← Agent planning log
    │   ├── FraudReport.model.js      ← Fraud signal records
    │   ├── AuditLog.model.js         ← System-wide audit
    │   ├── GeoLog.model.js           ← IP/geo per session
    │   └── ToolCallLog.model.js      ← Tool usage audit
    │
    ├── routes/                       ← Route definitions (thin layer — just attaches handlers)
    │   ├── session.routes.js
    │   ├── admin.routes.js
    │   ├── auth.routes.js
    │   ├── kyc.routes.js
    │   ├── application.routes.js
    │   └── webhook.routes.js
    │
    ├── services/
    │   ├── agent.service.js          ← Agent registry, spawning
    │   ├── cloudinary.service.js     ← Buffer → Cloudinary upload helper
    │   ├── ai/
    │   │   ├── llm.service.js        ← Gemini chat wrapper (system prompt, JSON mode)
    │   │   ├── stt.service.js        ← Google STT audio → text
    │   │   ├── extraction.service.js ← LLM field extraction from transcript turn
    │   │   ├── loanEngine.service.js ← Rules engine + LLM credit assessment
    │   │   ├── callOrchestrator.js   ← Socket event → agent pipeline
    │   │   └── interviewSummary.service.js ← Post-call summary generation
    │   └── geo/
    │       └── geo.service.js        ← ipapi.co fetch + enrichment
    │
    ├── tools/                        ← Agent-callable tools (search, calc, etc.)
    ├── orchestrator/                 ← High-level orchestration helpers
    └── websocket/
        └── socketHandler.js         ← Socket.io event registration
```

---

## REST API Routes

### `session.routes.js` — `/api/sessions`

| Method | Path | Handler | Auth |
|---|---|---|---|
| POST | `/` | `startSession` | Clerk |
| GET | `/:id` | `getSession` | Clerk |
| POST | `/:id/submit-review` | `submitReview` | Clerk |
| POST | `/upload-document` | `uploadDocument` | Clerk |

**`startSession`** flow:
1. Find or create User in MongoDB from `req.auth.userId` (Clerk ID)
2. Read Redis `docs:{clerkId}` — pull pre-uploaded documents
3. Create `Session` document with: userId, clerkId, language, loanType, documents[], geoData, ipAddress, consentData
4. Delete Redis key
5. Return `{ sessionId }`

**`submitReview`** flow:
1. Load session, verify ownership
2. Save `extractedFields` array to `session.extractedAnswers`
3. Run `evaluateLoan(extractedFields, fraudSignals, language)` → returns decision object
4. Save `loanDecision` to session
5. Create `Application` document — dual-key lookup for `loanAmount` (handles both `loanAmount` and `LOAN_AMOUNT` field key formats)
6. Return `{ applicationRef }`

---

### `admin.routes.js` — `/api/admin` (Officer protected)

| Method | Path | Handler |
|---|---|---|
| GET | `/applications` | `getApplications` |
| GET | `/applications/:id` | `getApplicationById` |
| GET | `/applications/:id/detail` | `getApplicationDetail` |
| PUT | `/applications/:id/decision` | `updateApplicationDecision` |

**`getApplications`** — enriches each application with session data:
- If `application.loanAmount` is null, loads `Session.extractedAnswers` and resolves from both `LOAN_AMOUNT` and `loanAmount` key formats
- Resolves real applicant name from `extractedAnswers` (not the `User.name` which is a Clerk fallback)

**`getApplicationDetail`** — returns the full intelligence bundle:
- Resolves real name from `session.extractedAnswers` → `session.collectedAnswers` → `User.name` (fallback chain)
- Resolves loan fields with `Application` preferred, `extractedAnswers` as fallback
- Joins `AgentTrace` count for audit depth
- Computes geo risk level dynamically

---

## The Agent System (Multi-Agent Architecture)

### BaseAgent

Every agent extends `BaseAgent`. Provides:
- `log(level, message, meta)` — structured logging with agent context
- `trace(sessionId, data)` — writes an `AgentTrace` to MongoDB for audit
- `callTool(name, args)` — executes a registered tool function

---

### PlannerAgent — The Brain (~500 lines)

`PlannerAgent` is a **finite state machine** that drives the entire interview.

**States** (interview stages):
```
GREETING
→ IDENTITY_NAME
→ IDENTITY_DOB
→ IDENTITY_ADDRESS
→ IDENTITY_PAN
→ FINANCIAL_INCOME
→ FINANCIAL_EMPLOYER
→ FINANCIAL_TENURE
→ FINANCIAL_EXISTING_EMI
→ LOAN_AMOUNT
→ LOAN_PURPOSE
→ LOAN_TENURE
→ CALL_COMPLETE
```

**On each audio turn**:
1. Receives audio blob from Socket.io
2. Sends to STT → get transcript
3. Sanitizes for prompt injection
4. Passes to `ConversationAgent` for response generation
5. Updates `WorkingMemory` (stores field value + confidence)
6. Runs `FraudAgent` (checks for inconsistencies, reprompts, velocity anomalies)
7. Runs `IdentityAgent` / `CreditAgent` / `ComplianceAgent` as appropriate to current state
8. Calls `extraction.service.js` to extract structured field from the user's response
9. If extraction confidence ≥ threshold → advance state; else → reprompt
10. Emits `call:agent-response` to client with next question

**On CALL_COMPLETE**:
1. Compiles all fields from WorkingMemory into `extractedFields` array
2. Updates `Session.status = 'completed'`, saves `endTime`
3. Emits `call:complete` to client with `{ sessionId, extractedFields }`
4. Fires `_generateSummaryAsync(sessionId)` — non-blocking async task

**`_generateSummaryAsync`**:
```js
// Reads transcript directly from Session.transcript[] in MongoDB
const sessionDoc = await Session.findById(sessionId).select('transcript startTime geoData').lean();
const turns = sessionDoc.transcript.map(t => ({ role, text, timestamp }));

// Calls Gemini with full transcript context
const summary = await generateInterviewSummary({
  transcript, collectedFields, confidenceMap, fraudSignals,
  turnCount, durationSeconds, geoData, language
});

// Saves interviewSummary to Session
await Session.findByIdAndUpdate(sessionId, { interviewSummary: summary });
```

---

### ConversationAgent

Drives question phrasing. Given a state and WorkingMemory context, generates the next question. Handles:
- First-time questions vs. reprompts (rephrases if confidence was low)
- Language — sends in Hindi if `language === 'hi'`
- Friendly tone calibration

---

### FraudAgent

Runs on every turn. Checks:
- **Velocity**: is the user answering too fast? (possible scripted answers)
- **Reprompt count**: if a field needed >2 reprompts → flag
- **Income vs loan ratio**: catches unrealistic requests in real time
- **Geo anomaly**: non-Indian IP → medium risk flag
- **VPN/Proxy/Tor**: automatic high-risk flag

Each signal is stored as a `FraudSignal` in `WorkingMemory.fraudSignals[]` and later saved to `Session.fraudSignals[]`.

**FraudScore** = sum of weighted signal severities (low=5, medium=15, high=30), capped at 100.

---

### IdentityAgent

When state is in `IDENTITY_*`:
- Validates PAN format (regex: `/^[A-Z]{5}[0-9]{4}[A-Z]$/`)
- Validates DOB is reasonable (not in future, applicant age ≥ 21)
- Validates address is not too short

---

### CreditAgent

When state is in `FINANCIAL_*` or `LOAN_*`:
- Checks income is above minimum (₹15,000/month)
- Checks EMI burden ratio (existing EMI / income ≤ 50%)
- Flags if loan amount > 24× monthly income

---

### LoanEngine Service (`loanEngine.service.js`)

Runs when the applicant submits the review form. Two phases:

**Phase 1: Rule Engine**
```
1. Income < ₹15,000 → hard reject
2. Loan/Income ratio > 24× → hard reject
3. EMI burden > 50% → manual review
4. Employment < 6 months → manual review + condition
5. Low-confidence fields → manual review
6. High fraud signals → hard reject
```

**Phase 2: LLM Assessment (if not hard-rejected)**
Sends a structured prompt to Gemini with:
- The full applicant profile (key → value map)
- Rule engine flags
- Asks for: `creditScore (0-100)`, `recommendation`, `keyStrengths`, `keyRisks`, `additionalConditions`, `summary`

Returns JSON. Merged with rule engine output. Final `decision` = LLM recommendation unless rules force `manual_review`.

---

### InterviewSummary Service (`interviewSummary.service.js`)

Called asynchronously after `call:complete`. Sends the full transcript to Gemini with a structured prompt asking for:

```json
{
  "overallTone": "cooperative | hesitant | evasive",
  "totalTurns": 22,
  "durationSeconds": 173,
  "highConfidenceFields": ["fullName", "monthlyIncome"],
  "lowConfidenceFields": ["loanPurpose"],
  "keyObservations": [
    "Applicant answered income questions promptly",
    "Slight hesitation on employment duration"
  ],
  "riskNotes": ["VPN connection detected"],
  "recommendedAction": "Proceed with standard verification"
}
```

This populates `Session.interviewSummary`.

---

## Memory System (4 Layers)

### WorkingMemory
- **Scope**: Per call, in-memory (JavaScript Map/Object, not persisted during call)
- **Stores**: `collectedFields`, `confidenceMap`, `fraudSignals`, `turnCount`, `fraudScore`, `language`
- **Persisted to MongoDB** only at `CALL_COMPLETE`

### EpisodicMemory
- **Scope**: Per session, sequential
- **Stores**: Ordered Q&A pairs (role: agent/user, text, timestamp)
- **Use**: Conversation context for ConversationAgent to generate coherent follow-ups
- **Note**: `Session.transcript[]` is the persistent store; EpisodicMemory is the in-call abstraction

### SemanticMemory
- **Scope**: Global, static
- **Stores**: Domain rules (PAN format, income thresholds, employment rules), question templates per state/language
- **Use**: `PlannerAgent` consults this to know what to ask and how to validate

### DecisionMemory
- **Scope**: Persistent, cross-session
- **Stores**: Past loan decisions with outcomes
- **Use**: Pattern learning — not fully implemented but scaffolded for future ML integration

---

## Middleware Stack

Every request passes through these in order:

### 1. `geoCapture.middleware.js`
Calls `ipapi.co` (free geo API) with the request's IP address. Enriches `req.geoData`:
```js
req.geoData = { city, state, country, isp, isVPN, isProxy, isTor }
req.clientIp = ip
```

### 2. `piiSanitizer.middleware.js`
Intercepts `res.json()` and strips PII patterns from response bodies in non-production environments. Patterns: PAN (regex), Aadhaar (12 digits), phone numbers.

### 3. `promptInjectionGuard.js`
Applied to all routes that send user input to LLMs. Checks for:
- Known injection phrases (`ignore previous instructions`, `jailbreak`, etc.)
- Abnormally long strings (>5000 chars)
- Base64 encoded payloads
Returns 400 if injection detected.

### 4. `role.middleware.js`
```js
export const isOfficer = (req, res, next) => {
  if (!req.auth?.sessionClaims?.publicMetadata?.role?.includes('officer')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};
```
Clerk sets `publicMetadata.role` on the user object. Officers are assigned this metadata in the Clerk dashboard or via the officer-signup flow.

---

## Database Models

### Session (Central model — most important)

```js
SessionSchema = {
  userId:           ObjectId (ref: User)
  clerkId:          String
  loanType:         String          // 'personal'
  language:         'en' | 'hi'
  status:           'active' | 'completed' | 'abandoned' | 'flagged'
  agentState:       String          // current PlannerAgent state

  transcript: [{
    role:      'agent' | 'user'
    text:      String
    state:     String               // which stage this turn was in
    timestamp: Date
  }]

  extractedAnswers: [Mixed]         // final field objects from review form
  collectedAnswers: Map<String, Mixed>  // live field → value during call

  fraudSignals: [{
    type, description, severity ('low'|'medium'|'high'), field, timestamp
  }]

  documents: [{
    docType:          'pan' | 'aadhaar' | 'passport'
    cloudUrl:         String
    publicId:         String        // for Cloudinary deletion
    fileName:         String
    mimeType:         String
    uploadedAt:       Date
    verified:         Boolean
    verificationNote: String
  }]

  interviewSummary: {
    overallTone, totalTurns, durationSeconds,
    highConfidenceFields[], lowConfidenceFields[],
    keyObservations[], riskNotes[], recommendedAction, generatedAt
  }

  loanDecision: {
    decision:   'approved'|'conditional'|'rejected'|'manual_review'
    score:      Number (0-100)
    reasons:    [String]
    conditions: [String]
    ruleFlags:  Map
    decidedAt:  Date
  }

  consentData: { signedName, ip, userAgent, confirmedAt }
  ipAddress:   String
  geoData:     { city, state, country, isp, isVPN, isProxy, isTor }
  fraudScore:  Number (0-100)
  startTime:   Date
  endTime:     Date
}
```

### Application

```js
ApplicationSchema = {
  referenceNumber: String    // e.g. "LN-2026-8F3A2"
  sessionId:       ObjectId (ref: Session)
  userId:          ObjectId (ref: User)
  loanType:        String
  loanAmount:      Number
  tenure:          Number    // months
  purpose:         String
  status:          'submitted'|'under_review'|'approved'|'conditional'|'docs_requested'|'rejected'
  officerId:       ObjectId
  officerNote:     String
  officerDecision: String
  decisionAt:      Date
  submittedAt:     Date
}
```

---

## Socket.io Real-Time Layer

### `socketHandler.js`

```js
io.on('connection', (socket) => {

  socket.on('call:join', async ({ sessionId, language }) => {
    // 1. Join socket room for this session
    socket.join(sessionId);
    // 2. Load session from MongoDB
    // 3. Create WorkingMemory for session
    // 4. Instantiate PlannerAgent
    // 5. Agent emits first greeting question
  });

  socket.on('call:audio', async ({ audio, sessionId }) => {
    // 1. Pass audio Buffer to PlannerAgent
    // 2. PlannerAgent: STT → extract → respond
    // 3. Emit 'call:agent-response' with next question
  });

  socket.on('disconnect', () => {
    // Clean up working memory for disconnected session
  });

});
```

---

## Redis Usage

**Connection**: Lazy singleton via `getRedis()`. Uses `ioredis` with:
- Retry strategy: exponential backoff (50ms → 2000ms)
- `enableOfflineQueue: true` — queues commands while reconnecting
- `lazyConnect: true` — doesn't connect until first command

**Data stored in Redis**:
| Key | TTL | Content |
|---|---|---|
| `docs:{clerkId}` | 2 hours | JSON array of pre-uploaded doc metadata |

---

## AI Services (Gemini)

### `llm.service.js`
Thin wrapper around `@google/generative-ai`:
```js
export async function chat({ systemPrompt, userMessage, json = false }) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userMessage }] }],
    generationConfig: json ? { responseMimeType: 'application/json' } : {}
  });
  return json ? JSON.parse(result.response.text()) : result.response.text();
}
```

### `extraction.service.js`
Given a user utterance and the current field being collected, asks Gemini to extract the field value:
- Returns `{ value, confidence (0-1), isValid }`
- Low confidence → PlannerAgent reprompts

### `stt.service.js`
Sends audio buffer to Google Cloud Speech-to-Text:
- Language: `en-IN` or `hi-IN` based on session language
- Returns transcript string

---

## Document Upload Flow (Deep Dive)

```
POST /api/sessions/upload-document
    ↓
multer middleware (memoryStorage, 5MB limit, type filter)
    ↓
uploadDocument handler:
  1. Read file buffer from req.file
  2. docType from req.body (pan | aadhaar)
  3. sessionId from req.body (null if pre-session)
  4. Upload buffer to Cloudinary (image/ or raw/ depending on mimeType)
  5a. IF sessionId exists:
      → Find Session, verify ownership
      → Cross-verify PAN: if verbal PAN matches filename → verified = true
      → Session.findByIdAndUpdate({ $push: { documents: docRecord } })
  5b. IF no sessionId (pre-consent):
      → redis.get(`docs:${userId}`)
      → Append/replace docType in array
      → redis.set(`docs:${userId}`, JSON.stringify(docs), 'EX', 7200)
  6. Return { success, url, docType, fileName }
```

---

## Key Design Decisions (Interview-Ready)

### 1. Why Socket.io instead of WebRTC?
The AI processes audio server-side (Google STT requires audio chunks). WebRTC would require server-side media relay (TURN/STUN) adding significant infrastructure. Socket.io lets us send audio blobs directly to the Node server where STT runs. The webcam is local-only (not streamed to server) — only audio goes to the server.

### 2. Why Zustand and not Redux?
Zustand is a fraction of the bundle size, zero boilerplate, and integrates trivially with Next.js. The global state here is minimal: just `language` and `sessionId`. Redux would be overkill.

### 3. Why Redis for pre-session document cache?
At the time of document upload, there is no session yet. We need a temporary, automatically-expiring store. Redis is perfect: set TTL = 2 hours, auto-evicts if user abandons. When session starts, data is pulled and session takes ownership.

### 4. Why store transcript in MongoDB, not just in-memory?
`PlannerAgent._generateSummaryAsync` runs asynchronously after the call ends. By then, the in-memory state may be cleared. MongoDB is the durable store. The AI summary service reads directly from `Session.transcript[]`.

### 5. Dual-key field lookup pattern
The extraction service and PlannerAgent evolved independently — one using `LOAN_AMOUNT` (SCREAMING_SNAKE) and one using `loanAmount` (camelCase). Rather than refactoring everywhere, a `findField(...keys)` helper checks all possible key names in one pass.

### 6. Non-blocking async summary
`_generateSummaryAsync` is called with no `await`. The call:complete event is emitted to the client first, so the review page loads immediately. The AI summary (which takes 2-5 seconds) is generated in the background and stored in MongoDB.

### 7. Why Clerk for auth?
Clerk handles the most painful parts of auth — email verification, OAuth providers, JWT management, public metadata for roles. The alternative (Passport.js + session management) would add weeks of work. Clerk's `requireAuth()` middleware integrates cleanly with Express.

---

## Critical Data Flow Summary

```
[Pre-upload] → Cloudinary + Redis (docs:{userId})
                    ↓
[startSession] → Session created → Redis docs pulled → Session.documents[]
                    ↓
[call:join] → WorkingMemory created → PlannerAgent starts
                    ↓
[call:audio × N] → STT → PlannerAgent → extract field → WorkingMemory
                    ↓ (each turn also runs FraudAgent)
                    ↓
[CALL_COMPLETE] → WorkingMemory → Session saved → call:complete emitted
                    ↓ (async, non-blocking)
             interviewSummary generated ← Session.transcript[] ← Gemini
                    ↓
[submitReview] → loanEngine (rules + Gemini) → Application created
                    ↓
[GET /admin/.../detail] → Session + Application + AgentTrace joined → intelligence report
```
