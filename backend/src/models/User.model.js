import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  // Clerk owns auth — we only store app-specific data linked via clerkId
  clerkId: { type: String, required: true, unique: true, index: true },
  name:    { type: String, required: true },
  email:   { type: String, required: true, unique: true, lowercase: true },
  language: { type: String, enum: ['en', 'hi'], default: 'en' },
  role:    { type: String, enum: ['user', 'officer', 'admin'], default: 'user' },
}, { timestamps: true });

export default mongoose.model('User', UserSchema);
