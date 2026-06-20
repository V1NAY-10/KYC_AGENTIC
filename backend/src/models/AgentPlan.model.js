import mongoose from 'mongoose';

const GoalSchema = new mongoose.Schema({
  id:          String,
  status:      { type: String, enum: ['pending', 'active', 'completed', 'skipped', 'failed'], default: 'pending' },
  startedAt:   Date,
  completedAt: Date,
}, { _id: false });

const AgentPlanSchema = new mongoose.Schema({
  sessionId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true, unique: true },

  // Full ordered goal list with statuses
  goals:       [GoalSchema],
  activeGoal:  String,

  // What still needs to be collected
  missingFields: [String],

  // Planner's strategy description (from LLM reasoning)
  questionStrategy:       String,
  estimatedTurnsLeft:     Number,

  // How many times the plan was revised mid-session
  planRevisions:          { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model('AgentPlan', AgentPlanSchema);
