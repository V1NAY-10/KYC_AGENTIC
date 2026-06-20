import mongoose from 'mongoose';

const ToolCallLogSchema = new mongoose.Schema({
  sessionId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Session', index: true },
  agentName:  String,
  toolName:   { type: String, required: true },

  // PII-sanitized copies of input/output (see piiSanitizer.middleware.js)
  input:      mongoose.Schema.Types.Mixed,
  output:     mongoose.Schema.Types.Mixed,

  durationMs: Number,
  success:    { type: Boolean, default: true },
  error:      String,
  timestamp:  { type: Date, default: Date.now },
}, { timestamps: false });

// Fast lookup by session, newest first
ToolCallLogSchema.index({ sessionId: 1, timestamp: -1 });

export default mongoose.model('ToolCallLog', ToolCallLogSchema);
