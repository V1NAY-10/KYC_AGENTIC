import Session from '../models/Session.model.js';
import User from '../models/User.model.js';

export const startSession = async (req, res) => {
  try {
    const clerkId = req.auth.userId;
    if (!clerkId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { language, loanType, consentData } = req.body;

    // Find the user in our DB linked to this clerkId
    let user = await User.findOne({ clerkId });
    if (!user) {
      // Create user on the fly if webhook hasn't synced (useful for local dev)
      user = await User.create({
        clerkId: clerkId,
        email: `${clerkId}@local.dev`,
        name: 'Local Test User',
      });
    }

    // Get geo data from middleware if available
    const geoData = req.geoData || {};
    const ipAddress = req.clientIp || req.ip;

    const newSession = new Session({
      userId: user._id,
      clerkId,
      language: language || 'en',
      loanType: loanType || 'personal',
      status: 'active',
      agentState: 'GREETING',
      consentData: {
        ...consentData,
        ip: ipAddress,
        confirmedAt: new Date(),
      },
      ipAddress,
      geoData,
      startTime: new Date()
    });

    await newSession.save();

    res.status(201).json({ 
      message: 'Session started', 
      sessionId: newSession._id 
    });

  } catch (error) {
    console.error('Error starting session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const endSession = async (req, res) => {
  try {
    const { id } = req.params;
    const session = await Session.findById(id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Ensure user owns session
    if (session.clerkId !== req.auth.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    session.status = 'completed';
    session.endTime = new Date();
    await session.save();

    // Trigger form extraction logic asynchronously here (to be done in Week 4)

    res.json({ message: 'Session ended successfully' });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSession = async (req, res) => {
  try {
    const { id } = req.params;
    const session = await Session.findById(id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.clerkId !== req.auth.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({ session });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
