import Application from '../models/Application.model.js';
import Session from '../models/Session.model.js';
import AgentTrace from '../models/AgentTrace.model.js';
import User from '../models/User.model.js';

export const getApplications = async (req, res) => {
  try {
    const applications = await Application.find()
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    // ── Enrich each application with session data when fields are missing ─────
    const enriched = await Promise.all(applications.map(async (app) => {
      // If the application already has all fields, return as-is
      if (app.loanAmount) return app;

      // Otherwise load the session and try to extract from extractedAnswers
      try {
        const session = await Session.findById(app.sessionId)
          .select('extractedAnswers collectedAnswers')
          .lean();

        if (!session) return app;

        const fields = session.extractedAnswers || [];
        const findField = (...keys) => fields.find(f => keys.includes(f.key));
        const fieldValue = (field) => field ? (field.finalValue || field.aiExtractedValue || null) : null;

        const loanAmountField = findField('LOAN_AMOUNT', 'loanAmount');
        const tenureField     = findField('LOAN_TENURE', 'loanTenure', 'tenure');
        const purposeField    = findField('LOAN_PURPOSE', 'loanPurpose', 'purpose');
        const nameField       = findField('IDENTITY_NAME', 'fullName', 'name');

        // Also resolve real name from collectedAnswers map
        let realName = fieldValue(nameField);
        if (!realName && session.collectedAnswers) {
          const ca = session.collectedAnswers;
          realName = ca['fullName'] || ca['IDENTITY_NAME'] || ca['name'] || null;
        }

        return {
          ...app,
          loanAmount: app.loanAmount || parseFloat(fieldValue(loanAmountField)) || null,
          tenure:     app.tenure     || parseInt(fieldValue(tenureField))       || null,
          purpose:    app.purpose    || fieldValue(purposeField),
          // Patch the populated userId object with the real name
          userId: app.userId
            ? { ...app.userId, name: realName || app.userId.name }
            : app.userId,
        };
      } catch (_) {
        return app;
      }
    }));

    res.json({ applications: enriched });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getApplicationById = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await Application.findById(id)
      .populate('userId', 'name email')
      .populate('sessionId');

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json({ application });
  } catch (error) {
    console.error('Error fetching application:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /admin/applications/:id/detail
 *
 * Returns the full loan officer intelligence report for an application:
 *   - Applicant profile
 *   - All extracted KYC fields
 *   - Uploaded documents + verification status
 *   - IP / Geo risk data
 *   - Fraud signals + score
 *   - AI-generated interview summary
 *   - Agent trace count (audit depth)
 *   - Current decision
 */
export const getApplicationDetail = async (req, res) => {
  try {
    const { id } = req.params;

    // Load application + populate user
    const application = await Application.findById(id).populate('userId', 'name email clerkId');
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Load full session
    const session = await Session.findById(application.sessionId).lean();
    if (!session) {
      return res.status(404).json({ error: 'Session not found for this application' });
    }

    // ── Dual-key field helper (same pattern as submitReview) ─────────────────
    const fields = session.extractedAnswers || [];
    const findField = (...keys) => fields.find(f => keys.includes(f.key));
    const fieldValue = (field) => field ? (field.finalValue || field.aiExtractedValue || null) : null;

    // Extract real name from interview (first from extractedAnswers, then collectedAnswers)
    const nameField = findField('IDENTITY_NAME', 'fullName', 'name');
    let realName = fieldValue(nameField);
    if (!realName && session.collectedAnswers) {
      // collectedAnswers is a Map stored as object in lean()
      const ca = session.collectedAnswers;
      realName = ca['fullName'] || ca['IDENTITY_NAME'] || ca['name'] || null;
    }

    // Loan fields: prefer Application record, fall back to extractedAnswers
    const loanAmountField = findField('LOAN_AMOUNT', 'loanAmount');
    const tenureField     = findField('LOAN_TENURE',  'loanTenure', 'tenure');
    const purposeField    = findField('LOAN_PURPOSE', 'loanPurpose', 'purpose');

    const loanAmount = application.loanAmount || parseFloat(fieldValue(loanAmountField)) || null;
    const tenure     = application.tenure     || parseInt(fieldValue(tenureField))       || null;
    const purpose    = application.purpose    || fieldValue(purposeField);

    // Count agent traces (audit depth indicator)
    const traceCount = await AgentTrace.countDocuments({ sessionId: session._id });

    // Compute call duration
    const durationSeconds = session.startTime && session.endTime
      ? Math.round((new Date(session.endTime) - new Date(session.startTime)) / 1000)
      : session.interviewSummary?.durationSeconds || 0;

    // Derive geo risk level
    const geo = session.geoData || {};
    const geoRiskLevel =
      geo.isVPN || geo.isProxy || geo.isTor ? 'high' :
      geo.country && geo.country !== 'IN'    ? 'medium' : 'low';

    // Fraud risk level
    const fraudScore = session.fraudScore || 0;
    const fraudRiskLevel =
      fraudScore >= 60 ? 'high' :
      fraudScore >= 30 ? 'medium' : 'low';

    res.json({
      application: {
        _id:             application._id,
        referenceNumber: application.referenceNumber,
        status:          application.status,
        loanType:        application.loanType,
        loanAmount,
        tenure,
        purpose,
        createdAt:       application.createdAt,
        officerNote:     application.officerNote     || null,
        officerDecision: application.officerDecision || null,
        decisionAt:      application.decisionAt      || null,
      },

      applicant: {
        _id:     application.userId?._id,
        // Use the KYC-extracted name first; fall back to User record only if not available
        name:    realName || application.userId?.name || 'Unknown',
        email:   application.userId?.email,
        clerkId: application.userId?.clerkId,
      },

      session: {
        _id:        session._id,
        language:   session.language,
        startTime:  session.startTime,
        endTime:    session.endTime,
        durationSeconds,
        turnCount:  session.interviewSummary?.totalTurns || (session.transcript?.length || 0),
        traceCount,
      },

      kycFields:   fields,
      consentData: session.consentData || {},

      documents: (session.documents || []).map(doc => ({
        docType:          doc.docType,
        cloudUrl:         doc.cloudUrl,
        fileName:         doc.fileName,
        mimeType:         doc.mimeType,
        uploadedAt:       doc.uploadedAt,
        verified:         doc.verified,
        verificationNote: doc.verificationNote || 'Not verified',
      })),

      geoRisk: {
        ipAddress: session.ipAddress   || 'Unknown',
        city:      geo.city            || 'Unknown',
        state:     geo.state           || 'Unknown',
        country:   geo.country         || 'Unknown',
        isp:       geo.isp             || 'Unknown',
        isVPN:     geo.isVPN           || false,
        isProxy:   geo.isProxy         || false,
        isTor:     geo.isTor           || false,
        riskLevel: geoRiskLevel,
      },

      fraudIntelligence: {
        score:     fraudScore,
        riskLevel: fraudRiskLevel,
        signals:   session.fraudSignals || [],
      },

      interviewSummary: session.interviewSummary || null,
      loanDecision:     session.loanDecision     || null,
    });

  } catch (error) {
    console.error('Error fetching application detail:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateApplicationDecision = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, officerNote, officerDecision } = req.body;
    
    const officerId = req.user._id;

    const application = await Application.findById(id);

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (status)                         application.status          = status;
    if (officerNote !== undefined)      application.officerNote     = officerNote;
    if (officerDecision !== undefined)  application.officerDecision = officerDecision;
    
    application.officerId  = officerId;
    application.decisionAt = new Date();

    await application.save();

    res.json({ message: 'Application updated successfully', application });

  } catch (error) {
    console.error('Error updating application:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
