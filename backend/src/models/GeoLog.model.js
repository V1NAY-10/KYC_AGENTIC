import mongoose from 'mongoose';

const GeoLogSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  clerkId:    { type: String },
  sessionId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  ip:         String,
  city:       String,
  state:      String,
  country:    String,
  isp:        String,
  org:        String,
  isVPN:      Boolean,
  isProxy:    Boolean,
  isTor:      Boolean,
  statedCity: String,
  statedState: String,
  distanceKm: Number,
  riskLevel:  String,
  timestamp:  { type: Date, default: Date.now }
}, { timestamps: false });

export default mongoose.model('GeoLog', GeoLogSchema);
