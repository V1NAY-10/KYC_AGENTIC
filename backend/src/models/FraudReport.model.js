import mongoose from 'mongoose';

const FraudFlagSchema = new mongoose.Schema({
  type:        String,
  description: String,
  severity:    { type: String, enum: ['low', 'medium', 'high'] },
  field:       String,
  timestamp:   Date,
}, { _id: false });

const FraudReportSchema = new mongoose.Schema({
  sessionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  audioScore:   { type: Number, default: 0 },
  dataScore:    { type: Number, default: 0 },
  geoScore:     { type: Number, default: 0 },
  overallScore: { type: Number, default: 0 },
  riskLevel:    { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
  flags:        [FraudFlagSchema],
  geoAnalysis: {
    ipCity:      String,
    ipState:     String,
    statedCity:  String,
    statedState: String,
    distanceKm:  Number,
    isVPN:       Boolean,
    isProxy:     Boolean,
  },
  reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewNote:  String,
}, { timestamps: true });

export default mongoose.model('FraudReport', FraudReportSchema);
