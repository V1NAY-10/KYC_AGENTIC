import express from 'express';
// import { requireAuth } from '@clerk/express';

const router = express.Router();

router.get('/:id', (req, res) => {
  res.json({ message: 'Get application route' });
});

router.get('/:id/status', (req, res) => {
  res.json({ message: 'Get application status route' });
});

export default router;
