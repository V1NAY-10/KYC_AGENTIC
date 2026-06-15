import mongoose from 'mongoose';

const KYCFieldSchema = new mongoose.Schema({
  key:               { type: String, required: true },
  label:             String,
  section:           { type: String, enum: ['personal', 'financial', 'loan'] },
  aiExtractedValue:  mongoose.Schema.Types.Mixed,
  userCorrectedValue: mongoose.Schema.Types.Mixed, // null if not edited
  finalValue:        mongoose.Schema.Types.Mixed,
  confidence:        { type: Number, min: 0, max: 1 },
  source:            { type: String, enum: ['verbal', 'ocr', 'both'] },
  isFlagged:         { type: Boolean, default: false },
  isEdited:          { type: Boolean, default: false },
  isLocked:          { type: Boolean, default: false },
  editedAt:          Date,
}, { _id: false });

const KYCFormSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fields:    [KYCFieldSchema],
  editCount: { type: Number, default: 0 },
  status:    { type: String, enum: ['draft', 'confirmed'], default: 'draft' },
  confirmedAt: Date,
}, { timestamps: true });

export default mongoose.model('KYCForm', KYCFormSchema);
