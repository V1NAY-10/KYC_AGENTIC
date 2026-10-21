import { authUserId } from '../utils/authUser.js';
import express from 'express';
import { requireAuth } from '@clerk/express';
import { findOrCreateUser } from '../utils/userSync.js';

const router = express.Router();

router.post('/register-officer', requireAuth(), async (req, res) => {
  try {
    const clerkId = authUserId(req);
    if (!clerkId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await findOrCreateUser(clerkId, { name: 'Loan Officer' });
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
    const clerkId = authUserId(req);
    const user = await findOrCreateUser(clerkId);
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
