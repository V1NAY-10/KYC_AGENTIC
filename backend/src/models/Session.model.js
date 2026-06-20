import mongoose from 'mongoose';

const FraudSignalSchema = new mongoose.Schema({
  type:        String,
  description: String,
  severity:    { type: String, enum: ['low', 'medium', 'high'] },
  field:       String,
  timestamp:   { type: Date, default: Date.now },
}, { _id: false });

const TranscriptEntrySchema = new mongoose.Schema({
  role:      { type: String, enum: ['agent', 'user'] },
  text:      String,
  state:     String,
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

// ── Uploaded KYC documents (pre-consent or review page) ─────────────────────
const DocumentSchema = new mongoose.Schema({
  docType:          { type: String, enum: ['pan', 'aadhaar', 'passport'], required: true },
  cloudUrl:         String,   // Cloudinary secure URL
  publicId:         String,   // Cloudinary public ID (for deletion)
  fileName:         String,
  mimeType:         String,
  uploadedAt:       { type: Date, default: Date.now },
  // Cross-verification against verbal answer
  verified:         { type: Boolean, default: false },
  verificationNote: String,   // e.g. "PAN matches verbal answer"
}, { _id: false });

const SessionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  clerkId:   { type: String, required: true },
  loanType:  { type: String, default: 'personal' },
  language:  { type: String, enum: ['en', 'hi'], default: 'en' },
  status:    { type: String, enum: ['active', 'completed', 'abandoned', 'flagged'], default: 'active' },
  agentState: { type: String, default: 'GREETING' },

  transcript:       [TranscriptEntrySchema],
  extractedAnswers: [mongoose.Schema.Types.Mixed],
  collectedAnswers: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  fraudSignals:     [FraudSignalSchema],

  // Uploaded KYC documents (linked from pre-consent upload or review page)
  documents: [DocumentSchema],

  // AI-generated interview intelligence (populated after call:complete)
  interviewSummary: {
    overallTone:          String,  // 'cooperative' | 'hesitant' | 'evasive'
    totalTurns:           Number,
    durationSeconds:      Number,
    highConfidenceFields: [String],
    lowConfidenceFields:  [String],
    keyObservations:      [String],
    riskNotes:            [String],
    recommendedAction:    String,
    generatedAt:          Date,
  },

  // Loan decisioning output
  loanDecision: {
    decision:      { type: String, enum: ['approved', 'conditional', 'rejected', 'manual_review'] },
    score:         Number,
    reasons:       [String],
    conditions:    [String],
    ruleFlags:     { type: Map, of: mongoose.Schema.Types.Mixed },
    decidedAt:     Date,
  },

  // Consent
  consentData: {
    signedName:  String,
    ip:          String,
    userAgent:   String,
    confirmedAt: Date,
  },

  // Geo
  ipAddress: String,
  geoData: {
    city:    String,
    state:   String,
    country: String,
    isp:     String,
    isVPN:   Boolean,
    isProxy: Boolean,
    isTor:   Boolean,
  },

  // Fraud score (aggregated from FraudAgent)
  fraudScore: { type: Number, default: 0 },

  startTime: { type: Date, default: Date.now },
  endTime:   Date,
}, { timestamps: true });

export default mongoose.model('Session', SessionSchema);
