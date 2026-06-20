import Session from '../models/Session.model.js';
import User from '../models/User.model.js';
import { getRedis } from '../config/redis.js';

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
      user = await User.create({
        clerkId: clerkId,
        email: `${clerkId}@local.dev`,
        name: 'Local Test User',
      });
    }

    // Get geo data from middleware if available
    const geoData   = req.geoData  || {};
    const ipAddress = req.clientIp || req.ip;

    // ── Pull pre-uploaded docs from Redis ────────────────────────────────────
    let preUploadedDocs = [];
    try {
      const redis = getRedis();
      const redisKey    = `docs:${clerkId}`;
      const cachedDocs  = await redis.get(redisKey);
      if (cachedDocs) {
        preUploadedDocs = JSON.parse(cachedDocs);
        await redis.del(redisKey); // consume once
        console.log(`[startSession] Attached ${preUploadedDocs.length} pre-uploaded doc(s) to new session`);
      }
    } catch (redisErr) {
      console.warn('[startSession] Redis doc fetch failed (non-fatal):', redisErr.message);
    }

    const newSession = new Session({
      userId: user._id,
      clerkId,
      language:  language  || 'en',
      loanType:  loanType  || 'personal',
      status:    'active',
      agentState: 'GREETING',
      consentData: {
        ...consentData,
        ip:          ipAddress,
        confirmedAt: new Date(),
      },
      ipAddress,
      geoData,
      startTime: new Date(),
      documents: preUploadedDocs,  // attach pre-uploaded docs
    });

    await newSession.save();

    res.status(201).json({ 
      message:   'Session started', 
      sessionId: newSession._id,
      docsAttached: preUploadedDocs.length,
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

    // ── Dual-key field lookup: handles both PlannerAgent camelCase keys
    //    (e.g. loanAmount) and the extraction service SCREAMING_SNAKE keys
    //    (e.g. LOAN_AMOUNT). This prevents blank dashes in the officer portal.
    const findField = (...keys) => extractedFields.find(f => keys.includes(f.key));
    const fieldValue = (field) => field ? (field.finalValue || field.aiExtractedValue || null) : null;

    const loanAmountField = findField('LOAN_AMOUNT', 'loanAmount');
    const tenureField     = findField('LOAN_TENURE',  'loanTenure', 'tenure');
    const purposeField    = findField('LOAN_PURPOSE', 'loanPurpose', 'purpose');
    const nameField       = findField('IDENTITY_NAME', 'fullName', 'name');

    const newApplication = new Application({
      sessionId:  session._id,
      userId:     session.userId,
      loanType:   session.loanType || 'personal',
      status:     'under_review',
      loanAmount: parseFloat(fieldValue(loanAmountField)) || null,
      tenure:     parseInt(fieldValue(tenureField))       || null,
      purpose:    fieldValue(purposeField),
    });
    
    await newApplication.save();
    
    console.log(`📄 Application created for review: ${newApplication.referenceNumber}`);
    console.log(`   Name: ${fieldValue(nameField)} | Amount: ₹${fieldValue(loanAmountField)} | Tenure: ${fieldValue(tenureField)}m`);

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
