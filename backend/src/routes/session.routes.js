import express from 'express';
import { requireAuth } from '@clerk/express';
import { startSession, endSession, getSession, submitReview } from '../controllers/session.controller.js';
import { uploadDocument, uploadMiddleware } from '../controllers/documentUpload.controller.js';

const router = express.Router();

router.post('/start', requireAuth(), startSession);
router.put('/:id/end', requireAuth(), endSession);
router.get('/:id', requireAuth(), getSession);
router.post('/:id/submit-review', requireAuth(), submitReview);

// ── Document upload (optional step before consent) ────────────────────────────
// multer middleware runs first (handles multipart parsing), then Clerk auth, then handler
router.post('/upload-document', requireAuth(), uploadMiddleware, uploadDocument);

export default router;
