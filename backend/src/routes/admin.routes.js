import express from 'express';
import { requireAuth } from '@clerk/express';
import { isOfficer } from '../middleware/role.middleware.js';
import { 
  getApplications, 
  getApplicationById,
  getApplicationDetail,
  updateApplicationDecision 
} from '../controllers/admin.controller.js';

const router = express.Router();

// Protect all admin routes
router.use(requireAuth(), isOfficer);

router.get('/applications',                        getApplications);
router.get('/applications/:id',                    getApplicationById);
router.get('/applications/:id/detail',             getApplicationDetail);  // ← full intelligence report
router.put('/applications/:id/decision',           updateApplicationDecision);

// Future implementation
router.get('/fraud/:sessionId', (req, res) => {
  res.json({ message: 'Get fraud report route' });
});

export default router;
