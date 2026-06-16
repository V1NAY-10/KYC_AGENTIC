import User from '../models/User.model.js';

export const isOfficer = async (req, res, next) => {
  try {
    const clerkId = req.auth?.userId;
    if (!clerkId) {
      return res.status(401).json({ error: 'Unauthorized: No clerkId found' });
    }

    const user = await User.findOne({ clerkId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role !== 'officer' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Officer role required' });
    }

    // Attach user to req for convenience in later handlers
    req.user = user;
    next();
  } catch (error) {
    console.error('Role check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
