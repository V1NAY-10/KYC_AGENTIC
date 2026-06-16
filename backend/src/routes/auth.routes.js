import express from 'express';
import { requireAuth } from '@clerk/express';
import User from '../models/User.model.js';

const router = express.Router();

router.post('/register-officer', requireAuth(), async (req, res) => {
  try {
    const clerkId = req.auth.userId;
    if (!clerkId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let user = await User.findOne({ clerkId });
    if (!user) {
      // Create user if not exists
      user = new User({
        clerkId,
        email: `${clerkId}@temp.com`, // Usually synced by webhook
        name: 'Officer User',
      });
    }

    user.role = 'officer';
    await user.save();

    res.json({ message: 'Successfully registered as Loan Officer', user });
  } catch (error) {
    console.error('Error registering officer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', requireAuth(), async (req, res) => {
  try {
    const clerkId = req.auth.userId;
    const user = await User.findOne({ clerkId });
    if (!user) {
      return res.status(404).json({ error: 'User not found in local DB' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
