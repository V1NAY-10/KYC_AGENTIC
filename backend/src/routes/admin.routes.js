import express from 'express';
// import { requireAuth } from '@clerk/express';

const router = express.Router();

router.get('/applications', (req, res) => {
  res.json({ message: 'List applications route' });
});

router.get('/applications/:id', (req, res) => {
  res.json({ message: 'Get application details route' });
});

router.put('/applications/:id/decision', (req, res) => {
  res.json({ message: 'Officer decision route' });
});

router.get('/fraud/:sessionId', (req, res) => {
  res.json({ message: 'Get fraud report route' });
});

export default router;
