import express from 'express';
import { requireAuth } from '@clerk/express';
import { startSession, endSession, getSession } from '../controllers/session.controller.js';

const router = express.Router();

router.post('/start', requireAuth(), startSession);
router.put('/:id/end', requireAuth(), endSession);
router.get('/:id', requireAuth(), getSession);

export default router;
