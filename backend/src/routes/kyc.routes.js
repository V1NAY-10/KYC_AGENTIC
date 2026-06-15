import express from 'express';
// import { requireAuth } from '@clerk/express';

const router = express.Router();

router.post('/extract', (req, res) => {
  res.json({ message: 'Extract KYC route' });
});

router.get('/:sessionId', (req, res) => {
  res.json({ message: 'Get KYC form route' });
});

router.put('/:sessionId/field', (req, res) => {
  res.json({ message: 'Edit KYC field route' });
});

router.post('/:sessionId/confirm', (req, res) => {
  res.json({ message: 'Confirm KYC form route' });
});

export default router;
