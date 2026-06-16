import Application from '../models/Application.model.js';
import Session from '../models/Session.model.js';

export const getApplications = async (req, res) => {
  try {
    const applications = await Application.find()
      .populate('userId', 'name email')
      .sort({ createdAt: -1 });

    res.json({ applications });
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
      .populate('sessionId'); // populates the session which has all the details

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json({ application });
  } catch (error) {
    console.error('Error fetching application:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateApplicationDecision = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, officerNote, officerDecision } = req.body;
    
    // req.user is populated by isOfficer middleware
    const officerId = req.user._id;

    const application = await Application.findById(id);

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (status) application.status = status;
    if (officerNote !== undefined) application.officerNote = officerNote;
    if (officerDecision !== undefined) application.officerDecision = officerDecision;
    
    application.officerId = officerId;
    application.decisionAt = new Date();

    await application.save();

    res.json({ 
      message: 'Application updated successfully',
      application 
    });

  } catch (error) {
    console.error('Error updating application:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
