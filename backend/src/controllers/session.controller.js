import { authUserId } from '../utils/authUser.js';
import Session from '../models/Session.model.js';
import User from '../models/User.model.js';
import Application from '../models/Application.model.js';
import { getRedis } from '../config/redis.js';
import { lookupIP } from '../services/geo/ipLookup.service.js';
import { panValidationTool } from '../tools/panValidation.tool.js';
import { aadhaarValidationTool } from '../tools/aadhaarValidation.tool.js';
import { withSessionLock } from '../utils/sessionLock.js';

// At least ONE of these must be uploaded before a KYC call can start
export const ID_DOC_TYPES = ['pan', 'aadhaar'];

export const startSession = async (req, res) => {
  try {
    const clerkId = authUserId(req);
    if (!clerkId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { language, loanType, consentData } = req.body;

    // ── Pre-uploaded docs from Redis — a PAN or Aadhaar card is mandatory ────
    const redis    = getRedis();
    const redisKey = `docs:${clerkId}`;
    let preUploadedDocs = [];
    try {
      const cachedDocs = await redis.get(redisKey);
      if (cachedDocs) preUploadedDocs = JSON.parse(cachedDocs).filter(d => ID_DOC_TYPES.includes(d.docType));
    } catch (redisErr) {
      console.error('[startSession] Redis doc fetch failed:', redisErr.message);
      return res.status(503).json({ error: 'Could not verify your uploaded documents. Please try again in a moment.' });
    }

    if (preUploadedDocs.length === 0) {
      return res.status(400).json({
        error: 'Please upload your PAN card or Aadhaar card before starting the interview.',
        code:  'ID_DOCUMENT_REQUIRED',
      });
    }

    // Find the user in our DB linked to this clerkId
    let user = await User.findOne({ clerkId });
    if (!user) {
      user = await User.create({
        clerkId: clerkId,
        email: `${clerkId}@local.dev`,
        name: 'Local Test User',
      });
    }

    // geoCapture middleware resolves asynchronously, so look up here when it hasn't landed yet
    const ipAddress = req.clientIp || req.ip;
    const geo = req.geoData || await lookupIP(ipAddress);
    const geoData = geo?.status === 'success' || geo?.status === 'local'
      ? { city: geo.city, state: geo.state, country: geo.country, isp: geo.isp, isVPN: geo.isVPN, isProxy: geo.isProxy, isTor: geo.isTor }
      : {};

    const newSession = new Session({
      userId: user._id,
      clerkId,
      language:  language === 'hi' ? 'hi' : 'en',
      loanType:  loanType  || 'personal',
      status:    'active',
      agentState: 'GREETING',
      consentData: {
        signedName: consentData?.signedName,
        userAgent:  consentData?.userAgent,
        ip:          ipAddress,
        confirmedAt: new Date(),
      },
      ipAddress,
      geoData,
      startTime: new Date(),
      documents: preUploadedDocs,  // attach pre-uploaded docs
    });

    await newSession.save();

    // Consume the cached docs only once the session holding them is saved
    redis.del(redisKey).catch(err => console.warn('[startSession] Redis doc cleanup failed:', err.message));
    console.log(`[startSession] Attached ${preUploadedDocs.length} ID document(s) to session ${newSession._id}`);

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

/** GET /sessions/pre-documents — ID documents uploaded for the next session (survives page refresh). */
export const getPreUploadedDocs = async (req, res) => {
  try {
    const cached = await getRedis().get(`docs:${authUserId(req)}`);
    const docs = cached ? JSON.parse(cached) : [];
    res.json({
      documents: docs.map(({ docType, cloudUrl, fileName, mimeType }) => ({ docType, cloudUrl, fileName, mimeType })),
    });
  } catch (error) {
    console.error('Error fetching pre-uploaded docs:', error);
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
    if (session.clerkId !== authUserId(req)) {
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

    if (session.clerkId !== authUserId(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({ session });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Merge the applicant's review-page edits onto the server's copy of the fields.
 * Only values can change — keys, labels and AI confidence stay server-owned.
 */
function mergeReviewEdits(serverFields, clientFields) {
  if (!serverFields?.length) return clientFields; // legacy sessions without a server copy

  const edits = new Map((clientFields || []).filter(f => f?.key).map(f => [f.key, f]));
  return serverFields.map(field => {
    const edit = edits.get(field.key);
    if (!edit) return field;
    const next = edit.finalValue === '' || edit.finalValue === undefined ? null : edit.finalValue;
    const prev = field.finalValue ?? null;
    if (String(next ?? '').trim() === String(prev ?? '').trim()) return field;
    return { ...field, finalValue: next, isEdited: true };
  });
}

/**
 * Validates the PAN / Aadhaar on the final form: at least one valid ID is required.
 * Normalizes PAN and masks Aadhaar in place. Returns field errors (empty = ok).
 */
async function validateGovtIds(fields) {
  const errors = {};
  const pan     = fields.find(f => f.key === 'panNumber');
  const aadhaar = fields.find(f => f.key === 'aadhaarNumber');
  const hasValue = (f) => f && f.finalValue !== null && String(f.finalValue).trim() !== '';

  if (hasValue(pan)) {
    const res = await panValidationTool.execute({ pan: String(pan.finalValue) });
    if (res.valid) pan.finalValue = res.cleaned;
    else errors.panNumber = res.message;
  }
  if (hasValue(aadhaar)) {
    const res = await aadhaarValidationTool.execute({ aadhaar: String(aadhaar.finalValue) });
    if (res.valid) aadhaar.finalValue = res.masked;
    else errors.aadhaarNumber = res.message;
  }

  const anyValid = (hasValue(pan) && !errors.panNumber) || (hasValue(aadhaar) && !errors.aadhaarNumber);
  if (!anyValid && !errors.panNumber && !errors.aadhaarNumber) {
    errors.govtId = 'Please provide your PAN number or Aadhaar number.';
  }

  // One valid ID is enough — don't block on an optional, empty alternative
  if (anyValid) {
    if (!hasValue(pan)) delete errors.panNumber;
    if (!hasValue(aadhaar)) delete errors.aadhaarNumber;
  }
  return errors;
}

export const submitReview = async (req, res) => {
  const { id } = req.params;
  const { extractedFields } = req.body;

  if (!Array.isArray(extractedFields)) {
    return res.status(400).json({ error: 'extractedFields is required' });
  }

  try {
    // Serialized per session — a double-click can never create two applications
    const result = await withSessionLock(id, async () => {
      const session = await Session.findById(id);

      if (!session) return { status: 404, body: { error: 'Session not found' } };
      if (session.clerkId !== authUserId(req)) return { status: 403, body: { error: 'Forbidden' } };
      if (session.status !== 'completed') {
        return { status: 409, body: { error: 'The interview is not complete yet.' } };
      }

      // Idempotent: a retried submit returns the application already created
      const existing = await Application.findOne({ sessionId: session._id });
      if (existing) {
        return { status: 200, body: { message: 'Application already submitted', applicationRef: existing.referenceNumber } };
      }

      const fields = mergeReviewEdits(session.extractedAnswers, extractedFields).map(f => ({ ...f }));

      const idErrors = await validateGovtIds(fields);
      if (Object.keys(idErrors).length > 0) {
        return { status: 422, body: { error: Object.values(idErrors)[0], fieldErrors: idErrors, code: 'INVALID_GOVT_ID' } };
      }

      // 1. Save the finalized edited fields
      session.extractedAnswers = fields;

      // 2. Run the loan decision engine
      const { evaluateLoan } = await import('../services/ai/loanEngine.service.js');

      const decision = await evaluateLoan(
        fields,
        session.fraudSignals || [],
        session.language
      );

      // Convert ruleFlags plain object → Map for Mongoose compatibility
      session.loanDecision = {
        ...decision,
        ruleFlags: new Map(Object.entries(decision.ruleFlags || {})),
        decidedAt: decision.decidedAt || new Date(),
      };
      await session.save();

      console.log(`🏦 Loan decision finalized via review form: ${decision.decision} (score: ${decision.score})`);

      // 3. Create Application Document for Loan Officer Portal
      // ── Dual-key field lookup: handles both PlannerAgent camelCase keys
      //    (e.g. loanAmount) and the extraction service SCREAMING_SNAKE keys
      //    (e.g. LOAN_AMOUNT). This prevents blank dashes in the officer portal.
      const findField  = (...keys) => fields.find(f => keys.includes(f.key));
      const fieldValue = (field) => field ? (field.finalValue || field.aiExtractedValue || null) : null;

      const loanAmountField = findField('LOAN_AMOUNT', 'loanAmount');
      const tenureField     = findField('LOAN_TENURE',  'loanTenure', 'tenure');
      const purposeField    = findField('LOAN_PURPOSE', 'loanPurpose', 'purpose');

      const newApplication = await Application.create({
        sessionId:  session._id,
        userId:     session.userId,
        loanType:   session.loanType || 'personal',
        status:     'under_review',
        loanAmount: parseFloat(fieldValue(loanAmountField)) || null,
        tenure:     parseInt(fieldValue(tenureField))       || null,
        purpose:    fieldValue(purposeField),
      });

      console.log(`📄 Application created for review: ${newApplication.referenceNumber}`);

      // Do NOT return loan decision to client, just success.
      return {
        status: 200,
        body: {
          message: 'Application submitted successfully and is now under review',
          applicationRef: newApplication.referenceNumber,
        },
      };
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Error submitting review:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
