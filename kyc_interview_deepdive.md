# 🎙️ KYC Video — Complete Interview Deep-Dive

> **Your project in one sentence:** An AI-powered, voice-first KYC onboarding system where an LLM agent (Aria) conducts a real-time loan interview, extracts structured data from natural speech, runs multi-dimensional fraud checks, and feeds a complete intelligence report to a loan officer portal — all in a single seamless flow.

---

## 🗺️ Full Architecture at a Glance

```
Browser (Next.js 14 + TypeScript)
   │
   ├── Clerk (Auth)        → User identity, JWT
   ├── Zustand             → Global state (language, sessionId)
   ├── localStorage        → Cloudinary URLs for doc display
   ├── Web Speech API      → Browser-native TTS (Aria speaks)
   ├── MediaRecorder API   → Captures mic audio → sends blob to backend
   └── Socket.io-client    → Real-time bidirectional comms
           │
           │ WebSocket (ws://)
           ▼
Express.js Server (Node.js ESM)
   │
   ├── Helmet + Rate Limiter         → Security layer
   ├── Clerk Middleware              → JWT verification
   ├── GeoCapture Middleware         → IP → city/ISP/VPN detection
   ├── REST Routes                   → /api/sessions, /api/applications...
   └── Socket.IO Handler             → call:join, call:audio, call:transcript
           │
           ▼
   PlannerAgent (O-R-P-A-E-U-R loop)
   │
   ├── IdentityAgent      → LLM field extraction from transcript
   ├── FraudAgent         → Geo + behavioral fraud (async)
   ├── CreditAgent        → Rules + EMI calc + LLM credit score
   ├── ConversationAgent  → Generates next natural-language question
   ├── ComplianceAgent    → Final gate before call ends
   ├── DocumentAgent      → Document verification
   └── DecisionAgent      → Final decision merge
           │
   ┌───────┼───────────────────────────────┐
   │       │                               │
Redis  MongoDB Atlas                  Cloudinary
(WorkingMemory)  (Sessions,          (KYC docs CDN)
                  Applications,
                  AuditLogs,
                  GeoLogs)
           │
     Groq API
   ├── LLaMA (llm.service.js)  → All extraction/reasoning
   └── Whisper-large-v3 (stt.service.js) → Audio → text
```

---

## 🔐 STEP 0 — Landing Page `/`

**What happens:** User lands, sees the Aria splash screen.

**Auth (Clerk):**
- Why Clerk? It handles JWT issuance, session management, social login, and webhook-based user sync in one SDK. Saves ~2 weeks of building auth from scratch.
- `@clerk/nextjs` wraps the whole app in `ClerkProvider` from `layout.tsx`.
- `@clerk/express` on the backend verifies JWTs via `clerkMiddleware()` + `req.auth.userId`.
- Webhooks (`/api/webhooks`) use **Svix** (Clerk's official webhook library) to receive user creation/deletion events and sync them to MongoDB.

---

## 🌐 STEP 1 — Language Selection `/onboard/language`

**What happens:** User picks English or Hindi.

**Technology: Zustand**
```typescript
// useAppStore.ts
export const useAppStore = create<AppState>((set) => ({
  language: null,
  sessionId: null,
  setLanguage: (lang) => set({ language: lang }),
  setSessionId: (id) => set({ sessionId: id }),
}));
```

**Why Zustand over Redux?**
- Zero boilerplate — no actions, reducers, or dispatch
- Works perfectly for small cross-page state (just `language` + `sessionId`)
- Supports React 18's concurrent features natively
- Bundle size: ~1KB vs Redux Toolkit's ~40KB

**Why store language globally?**
- The backend AI agent (Aria) needs the language at every turn — on socket events (`call:join`), on `startSession`, and inside `PlannerAgent.greet()` to generate either Hindi or English opening.
- The WebTTS voice selection also depends on this.

---

## 📄 STEP 2 — Document Upload `/onboard/documents`

**What happens:** User optionally uploads PAN card / Aadhaar image. This happens BEFORE the session is even created.

### Why upload documents BEFORE consent?
The documents are physically uploaded to Cloudinary immediately, but they're **cached in Redis** under `docs:{clerkId}` with a 2-hour TTL. They don't touch MongoDB yet. When the session is created in Step 3, the controller **pulls from Redis and attaches** to the session:

```javascript
// session.controller.js — startSession()
const redisKey = `docs:${clerkId}`;
const cachedDocs = await redis.get(redisKey);
if (cachedDocs) {
  preUploadedDocs = JSON.parse(cachedDocs);
  await redis.del(redisKey); // consume once — no duplicates
}
```

**Why this pattern?**
1. If the user abandons after uploading docs but before consenting, no orphaned session is created in MongoDB
2. The Redis TTL (2 hours) auto-cleans abandoned uploads
3. The Cloudinary upload is the slow operation (~2–5s) — doing it eagerly makes the consent → interview path feel instant

### Cloudinary — Why?
```javascript
// cloudinary.service.js
const readable = new Readable();
readable.push(buffer);
readable.push(null);
readable.pipe(uploadStream); // Stream buffer directly — no temp file
```
- **No disk I/O:** multer stores file in memory, we pipe buffer directly to Cloudinary's upload_stream. Critical for Render/Vercel environments with no writable disk.
- **CDN delivery:** Documents are served from Cloudinary's global CDN for the review page thumbnails
- **publicId retention:** Stored so we can delete documents if the session is cancelled

### Multer — Why?
- Handles multipart/form-data parsing in Express
- `memoryStorage()` keeps the file in RAM, not disk — consistent with our streaming approach

### localStorage for Review Page
After upload, Cloudinary URLs are saved to `localStorage`. On the Review page, these are read back to display document thumbnails. This avoids an extra API round-trip just for display.

### Tesseract.js — Browser OCR
`tesseract.js` (client-side) is bundled in the frontend to run OCR on uploaded documents in-browser before upload — extracts visible text as a sanity check. This runs entirely on the client, no server cost.

### face-api.js — Face Detection
Used for liveness/presence detection during the call page. Runs TensorFlow.js models entirely in the browser.

---

## ✍️ STEP 3 — Consent Form `/onboard/consent`

**What happens:** User types their name and agrees to terms. This triggers `POST /api/sessions` which **creates the session in MongoDB**.

### startSession Controller
```javascript
// session.controller.js
const newSession = new Session({
  userId: user._id,      // MongoDB ObjectId
  clerkId,               // Clerk's external ID (for JWT verification)
  language,
  loanType,
  status: 'active',
  agentState: 'GREETING',
  consentData: {
    signedName: consentData.signedName,
    ip: ipAddress,
    confirmedAt: new Date(),
  },
  geoData,               // From GeoCapture middleware
  documents: preUploadedDocs, // Pulled from Redis!
});
```

### GeoCapture Middleware
```javascript
// geoCapture.middleware.js — runs on EVERY /api/ request
const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
lookupIP(ip).then(geoData => {
  req.geoData = geoData; // city, state, country, ISP, isVPN, isProxy, isTor
  GeoLog.create({ ... }); // saved to MongoDB GeoLog collection
});
next(); // Non-blocking — doesn't wait for IP lookup
```

**Why capture geo at consent?**
- We need the user's real location at the start of the session for fraud cross-referencing later
- If they claim "I live in Mumbai" but their IP resolves to Dehradun via a VPN, that's a fraud signal
- `x-forwarded-for` header reading is essential because Render/Vercel put apps behind a reverse proxy

### Session Model — MongoDB Schema
The Session document is the **single source of truth** for the entire onboarding journey:
- `transcript[]` — full conversation history
- `extractedAnswers[]` — AI-extracted KYC fields with confidence scores
- `fraudScore` + `fraudSignals[]` — fraud intelligence
- `interviewSummary` — AI-generated post-call analysis
- `loanDecision` — rules + LLM credit decision
- `documents[]` — Cloudinary references with verification status
- `geoData` — IP intelligence at consent time

**Why MongoDB over PostgreSQL?**
- Each session has a **variable-length transcript** and **mixed-shape extracted fields**
- Fraud signals, geo data, interview summaries are all nested documents — MongoDB's flexible schema fits perfectly
- Mongoose provides ODM validation with `.lean()` for read-heavy paths

---

## 🔧 STEP 4 — System Check `/onboard/setup`

**What happens:** Browser tests microphone, camera, and compatibility.

- Uses `getUserMedia()` API — requests browser permission for mic + camera
- Checks codec support: `MediaRecorder.isTypeSupported('audio/webm;codecs=opus')`
- Tests `window.SpeechSynthesis` for TTS availability
- **Why test first?** Safari has partial WebRTC support; some corporate firewalls block WebSocket. Failing early gives a clear error rather than a mysterious silent interview.

---

## 🎤 STEP 5 — Video Interview `/onboard/call`

This is the **core of the entire system**.

### 5a. Socket.IO Connection
```javascript
// Frontend connects
const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });
socket.emit('call:join', { sessionId, language });
```

**Why Socket.IO over raw WebSocket?**
- **Auto-fallback:** `transports: ['websocket', 'polling']` — if WebSocket is blocked (corporate proxies), it falls back to HTTP long-polling automatically
- **Room-based emit:** `io.to(sessionId).emit(...)` lets the backend broadcast to a specific client by sessionId without maintaining your own connection registry
- **Auto-reconnect:** Socket.IO handles disconnects and reconnects transparently

**Events used:**

| Event | Direction | Purpose |
|-------|-----------|---------|
| `call:join` | Client → Server | Start/resume session |
| `call:audio` | Client → Server | Raw audio blob |
| `call:transcript` | Client → Server | Pre-transcribed text (browser STT) |
| `call:silence` | Client → Server | User went silent |
| `call:agent-response` | Server → Client | AI question + state |
| `call:user-transcript` | Server → Client | What Whisper heard |
| `call:complete` | Server → Client | Interview done, extracted fields |
| `call:error` | Server → Client | Error state |

### 5b. Web TTS — Aria Speaks
```javascript
// Frontend: when call:agent-response arrives
const utterance = new SpeechSynthesisUtterance(result.question);
utterance.lang = language === 'hi' ? 'hi-IN' : 'en-US';
utterance.voice = getVoice(language);
window.speechSynthesis.speak(utterance);
```

**Why browser TTS over ElevenLabs/Google TTS?**
- **Zero latency:** Browser TTS is instantaneous — no HTTP round-trip
- **Zero cost:** No API calls per utterance
- **Trade-off:** Voice quality is inconsistent across browsers/OS (improvement candidate)

### 5c. MediaRecorder — Capturing User Audio
```javascript
// Frontend records audio in chunks
const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
recorder.ondataavailable = (e) => chunks.push(e.data);
recorder.onstop = () => {
  const blob = new Blob(chunks, { type: 'audio/webm' });
  socket.emit('call:audio', { audio: Buffer.from(buffer), sessionId });
};
```

**Why WebM/Opus?**
- Opus codec has the best compression for speech — ~50% smaller than PCM
- WebM is the native format for MediaRecorder in Chrome/Firefox
- Groq Whisper accepts webm directly

### 5d. Whisper STT — Server-Side Transcription
```javascript
// stt.service.js
const file = await toFile(audioBuffer, 'audio.webm', { type: 'audio/webm' });
const response = await groq.audio.transcriptions.create({
  file,
  model: 'whisper-large-v3',
  language: language === 'hi' ? 'hi' : 'en',
});
```

**Why Groq Whisper over Google STT / AWS Transcribe?**
- **Speed:** Groq's LPU chips run Whisper-large-v3 in ~200ms — industry-leading
- **Accuracy for Indian accents:** Whisper-large-v3 has strong multilingual training including Hindi
- **Cost:** Groq has a generous free tier; much cheaper than Google STT at scale
- **Same SDK:** The `openai` npm package works with Groq's API (OpenAI-compatible endpoint)

### 5e. PlannerAgent — The Brain (O-R-P-A-E-U-R Loop)

```
OBSERVE  → Read Redis working memory (fields collected, fraud score, turn count)
REASON   → LLM or fast-path decides: which field to target? run fraud? credit check?
PLAN     → Decide which agents to run, sync vs async
ACT      → IdentityAgent extracts field, ConversationAgent generates question
EVALUATE → Did extraction succeed? Confidence >= 0.60? Valid?
UPDATE   → Write extracted value to Redis working memory
REPLAN   → If failed → probe same field; if all done → ComplianceAgent → close
```

**Why this loop pattern vs. a fixed state machine?**
- **Traditional approach:** Fixed state machine (GREETING → NAME → DOB → PAN → ...) — rigid, breaks if user volunteers info out of order
- **Agentic approach:** LLM decides the BEST next question given what's already been collected. If user says "I'm Rahul Sharma, 28 years old from Mumbai", the agent skips ALL THREE questions automatically.

**Fast-path optimization (critical for latency):**
```javascript
// PlannerAgent._reason()
if (wm.turnCount <= 2 || wm.missingFields.length > 8) {
  // Skip LLM REASON call — just use sequential field order
  return { targetField: wm.missingFields[0], agentsToRun: ['identity', 'conversation'] };
}
```
Early turns skip the LLM REASON call entirely. Saves ~300ms per turn for the first 2 questions.

**Prompt Injection Guard — runs FIRST, before any LLM:**
```javascript
// promptInjectionGuard.js patterns:
// "ignore previous instructions", "act as", "jailbreak", "DAN", "system prompt"
// If detected → log fraud signal (score +80) + replay last question
const injectionCheck = detectPromptInjection(transcript);
if (!injectionCheck.safe) {
  await this.workingMemory.addFraudSignal(sessionId, { type: 'PROMPT_INJECTION_DETECTED' });
  return { question: lastMsg.text, isReprompt: true }; // never escalates to LLM
}
```

### 5f. IdentityAgent — Field Extraction
```javascript
// Sends structured prompt to Groq LLaMA:
// "Extract fullName from: 'My name is Rahul Kumar Sharma'"
// Returns:
//   primaryExtraction: { value: "Rahul Kumar Sharma", confidence: 0.95 }
//   additionalExtractions: [{ field: "dateOfBirth", value: "...", confidence: 0.70 }]
```

**Multi-field extraction:** A single answer like "I'm Rahul, 30 years old, working at TCS for 2 years" fills `fullName`, `dateOfBirth`, `employerName`, and `employmentYears` in ONE shot via `additionalExtractions[]`.

**Field-specific validation:**
- `panNumber` → `panValidationTool` (regex: `^[A-Z]{5}[0-9]{4}[A-Z]{1}$`) — 100% local, no API needed
- `dateOfBirth` → validates age is 18–80 years
- `monthlyIncome` → flags if > ₹1 crore/month as suspicious

### 5g. FraudAgent — Runs ASYNC (Fire and Forget)
```javascript
// PlannerAgent
if (runFraudAsync) {
  this._runFraudAsync(sessionId, wm, transcript, session.geoData)
    .catch(err => this.log('error', 'Async FraudAgent crashed', { ... }));
  // Does NOT await — user gets their next question immediately
}
```

**Why async?** Fraud analysis takes ~1–2 seconds (LLM call + geo scoring). Running synchronously would block every user response. Fire-and-forget means zero latency impact.

**Fraud dimensions:**
1. **Geo fraud:** IP city/state vs. stated address mismatch
2. **Data fraud:** LLM checks for contradictions, implausible values, round-number income fraud
3. **Prompt injection:** Regex-based (instant, no LLM)

**Fraud scoring from SemanticMemory (knowledge base):**

| Signal | Weight |
|--------|--------|
| `TOR_DETECTED` | 70 |
| `PROMPT_INJECTION_DETECTED` | 80 |
| `PROXY_DETECTED` | 50 |
| `PAN_INVALID` | 40 |
| `CONTRADICTION_DETECTED` | 45 |
| `VPN_DETECTED` | 35 |
| `CITY_MISMATCH` | 20 |

Score is cumulative, capped at 100. Score >= 60 = high risk.

### 5h. CreditAgent.quickAssess() — Mid-Call (No LLM)
When both `monthlyIncome` and `loanAmount` are collected, a **lightweight rule check** runs synchronously:
- Income < ₹15,000/month → `LOW_INCOME` flag
- Loan-to-income ratio > 24× → `HIGH_LTI_RATIO` flag

These early flags accumulate so the officer portal already has signals before the call ends.

### 5i. The Four Memory Tiers

| Memory | Technology | Purpose |
|--------|-----------|---------|
| **WorkingMemory** | Redis (TTL: 4hr) | Active session state: collected fields, fraud score, turn count, missing fields |
| **EpisodicMemory** | Redis / Session.transcript[] | Conversation history (last 6 turns for LLM context) |
| **SemanticMemory** | In-memory JS object (startup) | Static knowledge: required fields, credit thresholds, fraud weights, planner goals |
| **DecisionMemory** | MongoDB AgentTrace | Full audit trail: every agent invoked, every field extracted per turn |

**Why Redis for WorkingMemory?**
- Sub-millisecond reads — critical when reading/writing on every socket event
- Survives server restarts (unlike a JS `Map`)
- Auto-TTL cleans dead sessions without a cron job
- Works horizontally across multiple server instances — stateless backend

**Why in-memory for SemanticMemory?**
- It's purely static domain knowledge (field definitions, fraud weights) — never changes at runtime
- Zero network cost, zero latency — instant reads from any agent

### 5j. Call Completion
When `wm.missingFields.length === 0`:
1. **ComplianceAgent** final gate check (all required fields present? fraud not critical?)
2. Aria speaks personalized closing message ("Excellent, Rahul! All details recorded...")
3. `Session.status = 'completed'` saved to MongoDB
4. `io.to(sessionId).emit('call:complete', { extractedFields })` → frontend navigates to Review
5. **Interview Summary generated ASYNC** → non-blocking, user already on Review page

---

## 📋 STEP 6 — Review Form `/onboard/review`

**What happens:** User sees all AI-extracted fields, can edit any field, then submits.

### submitReview Controller
```javascript
// POST /api/sessions/:id/submit-review

// 1. Save finalized (possibly edited) fields
session.extractedAnswers = extractedFields;

// 2. Run Loan Decision Engine (Rules + LLM)
const decision = await evaluateLoan(extractedFields, session.fraudSignals, session.language);
session.loanDecision = decision;

// 3. Create Application for Officer Portal
const newApplication = new Application({
  sessionId: session._id,
  loanAmount: fieldValue(loanAmountField),
  tenure: fieldValue(tenureField),
  purpose: fieldValue(purposeField),
  status: 'under_review',
});
```

### Loan Decision Engine — Two-Stage Hybrid

**Stage 1 — Deterministic Rules (fast, no LLM, auditable):**
- Income < ₹15,000 → **hard reject** (LLM not called — saves cost)
- Loan/Income ratio > 24× → **hard reject**
- EMI burden > 50% of income → **manual review** condition
- Employment < 6 months → **manual review** condition
- High fraud signals → **hard reject**

**Stage 2 — LLM Holistic Assessment (if not hard-rejected):**
```
"Income ₹45,000. Loan ₹8,00,000 for home renovation.
 Employment: 3 years at Infosys. Existing EMI ₹12,000."
→ { creditScore: 72, recommendation: "approved",
    keyStrengths: ["stable employment", "productive loan purpose"],
    keyRisks: ["EMI burden 26% of income"] }
```

**Why rules + LLM hybrid instead of pure LLM?**
- Hard rules are instant, explainable, and auditable (financial regulators require explainability)
- LLM catches nuanced signals rules miss (govt job vs. freelancer at same income)
- Rules are a safety net if the LLM hallucinates an approval

---

## 🏛️ OFFICER PORTAL `/admin`

**Auth:** `role.middleware.js` checks `req.auth` Clerk claims for `officer` role.

**Intelligence panels:**
- Panel 1: Real applicant name (from `extractedAnswers`) + loan details
- Panel 2: KYC fields grid with confidence bars (yellow < 75%, green ≥ 75%)
- Panel 3: Document thumbnails + Cloudinary verification status
- Panel 4: AI Loan Assessment — score, strengths, risks, conditions
- Panel 5: Interview Summary — tone, observations, risk notes
- Panel 6: Fraud gauge + all signals with severity
- Panel 7: IP & Geo intelligence — VPN/proxy/Tor, city comparison

**Officer final decision:** `approved` / `conditional` / `rejected` → Application document.

---

## 🔁 TECHNOLOGY CHOICES — WHY EACH ONE

| Technology | Why chosen |
|-----------|-----------|
| **Next.js 14** | App Router, Server Components, TypeScript, Vercel-native deployment |
| **Zustand** | ~1KB, zero boilerplate, perfect for minimal cross-page state |
| **Socket.IO** | Auto-fallback to polling, built-in rooms, auto-reconnect |
| **Groq LLaMA** | LPU hardware = 10-25× faster than GPU inference, OpenAI-compatible SDK |
| **Groq Whisper-large-v3** | Best-in-class speed (~200ms), strong Hindi support, same Groq account |
| **MongoDB** | Flexible schema for variable transcripts + nested fraud/geo documents |
| **Redis (ioredis)** | Sub-ms reads for active session state, TTL auto-cleanup |
| **Cloudinary** | CDN delivery, stream-upload (no disk), publicId for deletion |
| **Clerk** | Full auth stack in one SDK — JWT, webhooks, roles, social login |
| **Helmet + Rate Limiter** | Industry-standard Express security headers + brute-force protection |
| **BullMQ** | Job queuing that survives restarts (unlike setTimeout/Promise) |
| **Zod** | Runtime schema validation (TypeScript only catches at compile time) |
| **PDFKit** | Server-side PDF generation, no external service needed |
| **Multer** | memoryStorage() → buffer → Cloudinary stream, no disk writes |
| **Svix** | Clerk's official webhook signature verification library |
| **Tesseract.js** | Browser OCR — runs client-side, zero server cost |
| **face-api.js** | Browser TensorFlow — liveness detection, zero server cost |

---

## 📈 SCALABILITY DISCUSSION

### Current Constraints
1. Socket.IO rooms are in-memory — one Node process owns a session's connection
2. `call:audio` Whisper transcription blocks the event loop per request
3. Single MongoDB Atlas instance for all reads and writes

### Scaling Path

**Step 1 — Socket.IO Redis Adapter (horizontal scaling):**
```javascript
import { createAdapter } from '@socket.io/redis-adapter';
io.adapter(createAdapter(pubClient, subClient));
// Now 10 Node pods can all serve the same sessionId through Redis pub/sub
```

**Step 2 — BullMQ Worker Pool for Audio:**
```
call:audio event → enqueue job → Whisper worker pool (N workers) → emit result back
// Main process stays responsive; workers handle compute
```

**Step 3 — MongoDB Atlas Read Replicas:**
- Officer portal queries (read-heavy) → secondary replicas
- All writes → primary
- Atlas search indexes for application filtering

**Step 4 — CDN Frontend:**
- Deploy Next.js to Vercel — edge-cached static assets globally

### Improvement Roadmap

| Area | Current | Future |
|------|---------|--------|
| **TTS Voice** | Browser Web Speech (inconsistent) | ElevenLabs / Google Neural TTS (branded voice) |
| **STT Fallback** | No fallback if Groq down | Deepgram or Azure Speech as secondary |
| **Document OCR** | Tesseract.js browser (slow) | Google Vision API / AWS Textract (accurate) |
| **PAN Verification** | Regex format only | NSDL API (real holder name verification) |
| **Aadhaar** | Stored, not verified | DigiLocker API integration |
| **Fraud ML** | Rules + LLM heuristics | Train classifier on historical decision data |
| **Languages** | Hindi + English | Tamil, Telugu, Marathi (Whisper supports all) |
| **TTS Streaming** | Full response then speak | Stream tokens → TTS chunks (feels live) |
| **Agent Memory** | Redis TTL simple | Vector DB (Pinecone) for cross-session patterns |
| **Audit Compliance** | AgentTrace collection | Immutable audit log for RBI compliance |
| **Officer ML** | Manual decisions | Learn from officer decisions → auto-scoring |

---

## 🔒 SECURITY LAYERS

1. **Helmet.js** — HTTP security headers (HSTS, CSP, X-Frame-Options, XSS protection)
2. **Rate Limiter** — 100 requests / 15 minutes per IP on all `/api/` routes
3. **CORS Whitelist** — Only specific origins in `CLIENT_URL` env var
4. **Clerk JWT** — Every protected API call verifies server-side
5. **Role Middleware** — Officer routes gated behind Clerk role claim
6. **Prompt Injection Guard** — Screens every transcript before any LLM sees it
7. **PII Sanitizer** — Strips PAN/Aadhaar from server logs
8. **Webhook Signature Verification** — Svix validates Clerk webhook HMAC
9. **Cloudinary Security** — Files tagged + typed, not publicly listed
10. **Redis TTL** — Auto-expires abandoned session data (no data hoarding)

---

## ❓ LIKELY INTERVIEW QUESTIONS & ANSWERS

**Q: Why did you not use WebRTC for the audio?**
> WebRTC is peer-to-peer, optimized for browser-to-browser video. Our use case is browser-to-server audio streaming. `MediaRecorder + Socket.IO` is simpler, more controllable, and doesn't require STUN/TURN server infrastructure.

**Q: What happens if the Groq API goes down mid-interview?**
> `BaseAgent.callLLM()` has automatic retry with exponential backoff (0ms → 1s → 3s, 3 attempts). If all retries fail, it falls back to deterministic sequential field ordering — no LLM needed. The interview degrades gracefully rather than crashing.

**Q: How do you prevent a user from submitting the same session twice?**
> `submitReview` checks `session.clerkId !== req.auth.userId` for ownership. The Application document is created only once — a subsequent submit overwrites `extractedAnswers` on the same session rather than creating duplicates.

**Q: What's your confidence threshold for field extraction?**
> `confidence >= 0.60` is the minimum to accept a field. Fields below `0.75` (from `SemanticMemory.fieldMeta`) are flagged as `isFlagged: true`, shown with yellow indicators on the review form and officer portal, and trigger a `manual_review` condition in the loan engine.

**Q: How does the multi-language interview work technically?**
> User picks `'en'` or `'hi'` in Step 1 → stored in Zustand → flows to: `startSession` body → `Session.language` → `PlannerAgent.greet()` generates language-specific greeting → `ConversationAgent` prompts in that language → Whisper STT gets `language: 'hi'` hint → Web TTS sets `utterance.lang = 'hi-IN'` or `'en-US'`.

**Q: Is the fraud detection real-time or batch?**
> Real-time but non-blocking. `FraudAgent` fires async on turns where fraud signals exceed threshold or contradictions are suspected. Score accumulates in Redis per turn. Final score is persisted to MongoDB at `call:complete`. The officer portal shows the total accumulated score.

**Q: How do you handle session resume if the user disconnects?**
> In `socketHandler.js call:join`, we check `Session.transcript` for an existing agent message. If found, we replay it without any LLM call — the user picks up where they left off. `WorkingMemory` in Redis (4hr TTL) still knows which fields are missing.

**Q: Why does document upload happen before consent?**
> Design choice for UX and data cleanliness. Cloudinary upload is the slowest step (~2-5s). Doing it eagerly before consent means the consent → interview path is instant. If the user abandons after upload but before consent, no orphaned MongoDB Session is created — the Redis key just TTL-expires after 2 hours.

---

## 📊 DATA FLOW SUMMARY TABLE

| Stage | Data Created | Where Stored | Why |
|-------|-------------|-------------|-----|
| Language selection | `language: 'hi'/'en'` | Zustand | Cross-page state, tiny |
| Document upload | File buffer | Cloudinary (image CDN) | CDN delivery, no server disk |
| Doc metadata | `{ url, docType, fileName }` | Redis `docs:{clerkId}` TTL 2hr | Pre-consent, auto-expiry |
| Consent | Session document | MongoDB | Permanent record |
| IP/Geo | City, ISP, VPN flags | MongoDB GeoLog + Session.geoData | Fraud evidence |
| Interview audio | WebM blob | Groq (transcribed, discarded) | Ephemeral, privacy |
| Transcripts | `Session.transcript[]` | MongoDB | Audit trail |
| Working state | Fields, scores, turn count | Redis TTL 4hr | Fast live access |
| Agent traces | Every decision per turn | MongoDB AgentTrace | Full observability |
| Extracted fields | `Session.extractedAnswers[]` | MongoDB | Source of truth for review |
| Interview summary | Tone, observations, risks | MongoDB Session.interviewSummary | Officer intel |
| Loan decision | Score, reasons, conditions | MongoDB Session.loanDecision | Compliance record |
| Application | Loan terms, status | MongoDB Application | Officer review queue |
| Cloudinary URLs | Document thumbnails | localStorage | Review page display only |
