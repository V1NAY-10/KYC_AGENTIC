import express from 'express';
import { requireAuth } from '@clerk/express';
import { startSession, endSession, getSession, submitReview, getPreUploadedDocs } from '../controllers/session.controller.js';
import { uploadDocument, uploadMiddleware } from '../controllers/documentUpload.controller.js';

const router = express.Router();

router.post('/start', requireAuth(), startSession);
router.get('/pre-documents', requireAuth(), getPreUploadedDocs);
router.put('/:id/end', requireAuth(), endSession);
router.get('/:id', requireAuth(), getSession);
router.post('/:id/submit-review', requireAuth(), submitReview);

// ── Document upload (PAN or Aadhaar required before consent) ─────────────────
// multer middleware runs first (handles multipart parsing), then Clerk auth, then handler
router.post('/upload-document', requireAuth(), uploadMiddleware, uploadDocument);

export default router;
