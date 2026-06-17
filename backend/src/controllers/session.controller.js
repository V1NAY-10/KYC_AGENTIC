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

export const submitReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { extractedFields } = req.body;
    
    if (!extractedFields) {
      return res.status(400).json({ error: 'extractedFields is required' });
    }

    const session = await Session.findById(id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.clerkId !== req.auth.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // 1. Save the finalized edited fields
    session.extractedAnswers = extractedFields;
    
    // 2. Run the loan decision engine
    const { evaluateLoan } = await import('../services/ai/loanEngine.service.js');
    
    const decision = await evaluateLoan(
      extractedFields,
      session.fraudSignals || [],
      session.language
    );

    // Convert ruleFlags plain object → Map for Mongoose compatibility
    const decisionToSave = {
      ...decision,
      ruleFlags: new Map(Object.entries(decision.ruleFlags || {})),
      decidedAt: decision.decidedAt || new Date(),
    };
    
    session.loanDecision = decisionToSave;
    await session.save();

    console.log(`🏦 Loan decision finalized via review form: ${decision.decision} (score: ${decision.score})`);

    // 3. Create Application Document for Loan Officer Portal
    const Application = (await import('../models/Application.model.js')).default;
    
    // Find the loan amount and tenure if they exist
    const loanAmountField = extractedFields.find(f => f.key === 'LOAN_AMOUNT');
    const tenureField = extractedFields.find(f => f.key === 'LOAN_TENURE');
    const purposeField = extractedFields.find(f => f.key === 'LOAN_PURPOSE');

    const newApplication = new Application({
      sessionId: session._id,
      userId: session.userId,
      loanType: session.loanType || 'personal',
      status: 'under_review',
      loanAmount: loanAmountField ? parseFloat(loanAmountField.finalValue || loanAmountField.aiExtractedValue) || null : null,
      tenure: tenureField ? parseInt(tenureField.finalValue || tenureField.aiExtractedValue) || null : null,
      purpose: purposeField ? purposeField.finalValue || purposeField.aiExtractedValue : null,
    });
    
    await newApplication.save();
    
    console.log(`📄 Application created for review: ${newApplication.referenceNumber}`);

    // Do NOT return loan decision to client, just success.
    res.json({ 
      message: 'Application submitted successfully and is now under review',
      applicationRef: newApplication.referenceNumber
    });

  } catch (error) {
    console.error('Error submitting review:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
