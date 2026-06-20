import mongoose from 'mongoose';

const ToolCallSummarySchema = new mongoose.Schema({
  toolName:   String,
  success:    Boolean,
  durationMs: Number,
}, { _id: false });

const AgentTraceSchema = new mongoose.Schema({
  sessionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
  turn:         { type: Number, required: true },

  // What the Planner reasoned (LLM output summary)
  plannerReasoning:    String,

  // Which agents ran this turn
  agentsInvoked:       [String],

  // Tool calls that happened
  toolCallsMade:       [ToolCallSummarySchema],

  // What was extracted this turn
  fieldsExtracted:     { type: Map, of: mongoose.Schema.Types.Mixed },

  // Per-field confidence this turn
  confidenceScores:    { type: Map, of: Number },

  // Fraud signals raised this turn
  fraudSignalsRaised:  [mongoose.Schema.Types.Mixed],

  // Goal state this turn
  activeGoal:          String,
  nextGoal:            String,

  // Lightweight snapshot of working memory for replay
  workingMemorySnapshot: mongoose.Schema.Types.Mixed,

  timestamp:           { type: Date, default: Date.now },
}, { timestamps: false });

// Fast lookup: all traces for a session in order
AgentTraceSchema.index({ sessionId: 1, turn: 1 });

export default mongoose.model('AgentTrace', AgentTraceSchema);
