import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema({
  sessionId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  event:      { type: String, required: true }, // e.g. FIELD_EDITED, CALL_STATE_CHANGE, OFFICER_DECISION
  data:       mongoose.Schema.Types.Mixed,
  source:     { type: String, enum: ['agent', 'user', 'officer', 'system'], default: 'system' },
  timestamp:  { type: Date, default: Date.now },
}, { timestamps: false });

// Index for fast lookups by session
AuditLogSchema.index({ sessionId: 1, timestamp: -1 });

export default mongoose.model('AuditLog', AuditLogSchema);
