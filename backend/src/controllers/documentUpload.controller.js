import multer from 'multer';
import { getAuth } from '@clerk/express';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { getRedis } from '../config/redis.js';

/**
 * Document Upload Controller
 *
 * POST /sessions/upload-document
 *
 * Accepts a single file (multipart/form-data, field name: "document")
 * and optional fields: docType ('pan' | 'aadhaar'), sessionId.
 *
 * Flow:
 *   BEFORE session (pre-consent upload):
 *     → Upload to Cloudinary
 *     → Store metadata in Redis: docs:{userId}  (TTL 2 hours)
 *
 *   AFTER session started (review page upload):
 *     → Upload to Cloudinary
 *     → Push directly into Session.documents[] in MongoDB
 *     → Run basic cross-verification vs verbal answers
 */

// ── multer: memory storage, 5MB limit ────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    ALLOWED.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG, PNG, WebP, and PDF files are accepted.'));
  },
});

export const uploadMiddleware = upload.single('document');

// ── Upload handler ────────────────────────────────────────────────────────────
export async function uploadDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file received. Ensure field name is "document".' });
    }

    const docType   = req.body?.docType  || 'unknown';
    const sessionId = req.body?.sessionId || null;
    const { userId } = getAuth(req);

    // Upload to Cloudinary
    const folder       = `kyc-documents/${userId}`;
    const publicId     = `${docType}-${Date.now()}`;
    const resourceType = req.file.mimetype === 'application/pdf' ? 'raw' : 'image';

    const { url, publicId: finalPublicId } = await uploadToCloudinary(
      req.file.buffer, folder, resourceType, publicId,
    );

    const docRecord = {
      docType,
      cloudUrl:   url,
      publicId:   finalPublicId,
      fileName:   req.file.originalname,
      mimeType:   req.file.mimetype,
      uploadedAt: new Date(),
      verified:   false,
      verificationNote: null,
    };

    if (sessionId) {
      // ── Session exists: push into MongoDB Session directly ─────────────────
      const Session = (await import('../models/Session.model.js')).default;
      const session = await Session.findById(sessionId);

      if (session && session.clerkId === userId) {
        // Cross-verify PAN if it's a PAN card upload
        if (docType === 'pan' && session.collectedAnswers?.get('pan')) {
          const verbalPAN = String(session.collectedAnswers.get('pan')).toUpperCase().trim();
          // Simple heuristic: check if verbal PAN is in the filename (user often names files with their PAN)
          const nameMatch = req.file.originalname.toUpperCase().includes(verbalPAN);
          docRecord.verified         = nameMatch;
          docRecord.verificationNote = nameMatch
            ? `PAN ${verbalPAN} appears consistent with document`
            : `Manual verification required — PAN could not be auto-matched`;
        }

        await Session.findByIdAndUpdate(sessionId, {
          $push: { documents: docRecord },
        });
        console.log(`[DocumentUpload] ${docType} saved to session ${sessionId}`);
      }
    } else {
      // ── Pre-session: cache in Redis for 2 hours ────────────────────────────
      const redis = getRedis();
      const redisKey = `docs:${userId}`;
      const existing = await redis.get(redisKey);
      const docs     = existing ? JSON.parse(existing) : [];
      // Replace same docType if re-uploaded
      const filtered = docs.filter(d => d.docType !== docType);
      filtered.push(docRecord);
      await redis.set(redisKey, JSON.stringify(filtered), 'EX', 7200); // 2hr TTL
      console.log(`[DocumentUpload] ${docType} cached in Redis for user ${userId}`);
    }

    return res.json({
      success:  true,
      url,
      publicId: finalPublicId,
      docType,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
    });

  } catch (err) {
    console.error('[uploadDocument] Error:', err.message);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 5MB.' });
    }
    return res.status(500).json({ error: err.message || 'Document upload failed. Please try again.' });
  }
}
