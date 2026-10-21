import { authUserId } from '../utils/authUser.js';
import User from '../models/User.model.js';
import Application from '../models/Application.model.js';

/**
 * GET /applications/mine — the signed-in applicant's own applications, newest first.
 * Only applicant-safe fields: no loan score, fraud signals or internal notes.
 */
export const getMyApplications = async (req, res) => {
  try {
    const user = await User.findOne({ clerkId: authUserId(req) });
    if (!user) return res.json({ applications: [] });

    const applications = await Application.find({ userId: user._id })
      .sort({ submittedAt: -1 })
      .populate('sessionId', 'language documents.docType')
      .lean();

    res.json({
      applications: applications.map(app => ({
        id:              app._id,
        referenceNumber: app.referenceNumber,
        loanType:        app.loanType,
        loanAmount:      app.loanAmount ?? null,
        tenure:          app.tenure ?? null,
        purpose:         app.purpose ?? null,
        status:          app.status,
        submittedAt:     app.submittedAt,
        decisionAt:      app.decisionAt ?? null,
        documents:       (app.sessionId?.documents || []).map(d => d.docType),
      })),
    });
  } catch (error) {
    console.error('Error fetching applicant applications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
