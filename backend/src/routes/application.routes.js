import express from 'express';
import { requireAuth } from '@clerk/express';
import { getMyApplications } from '../controllers/application.controller.js';

const router = express.Router();

// Must stay above /:id so "mine" isn't treated as an application id
router.get('/mine', requireAuth(), getMyApplications);

router.get('/:id', (req, res) => {
  res.json({ message: 'Get application route' });
});

router.get('/:id/status', (req, res) => {
  res.json({ message: 'Get application status route' });
});

export default router;
