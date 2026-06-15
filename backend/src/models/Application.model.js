import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const ApplicationSchema = new mongoose.Schema({
  referenceNumber: { type: String, unique: true, default: () => `LN-${new Date().getFullYear()}-${uuidv4().slice(0,5).toUpperCase()}` },
  sessionId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kycFormId:  { type: mongoose.Schema.Types.ObjectId, ref: 'KYCForm' },
  loanType:   { type: String, default: 'personal' },
  loanAmount: Number,
  tenure:     Number, // months
  purpose:    String,
  status: {
    type: String,
    enum: ['submitted', 'under_review', 'approved', 'conditional', 'docs_requested', 'rejected'],
    default: 'submitted',
  },
  officerId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  officerNote:     String,
  officerDecision: String,
  decisionAt:      Date,
  submittedAt:     { type: Date, default: Date.now },
}, { timestamps: true });

export default mongoose.model('Application', ApplicationSchema);
