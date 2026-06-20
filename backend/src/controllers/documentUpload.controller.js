import multer from 'multer';
import { requireAuth, getAuth } from '@clerk/express';
import { uploadToCloudinary } from '../services/cloudinary.service.js';

/**
 * Document Upload Controller
 *
 * POST /sessions/upload-document
 *
 * Accepts a single file (multipart/form-data, field name: "document")
 * and a docType body field ('pan' | 'aadhaar' | 'passport').
 *
 * Flow:
 *   1. multer validates & holds file in memory (no disk write)
 *   2. We validate file type / size again server-side (client checks can be bypassed)
 *   3. Upload to Cloudinary under kyc-documents/sessionId folder
 *   4. Return { url, docType, publicId }
 *
 * The sessionId is read from the Clerk JWT so users can only upload to their own session.
 * If they haven't started a session yet, we store the upload temporarily under their userId.
 */

// ── multer: memory storage, 5MB limit ────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (ALLOWED.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, WebP, and PDF files are accepted.'));
    }
  },
});

// ── Multer middleware (exported so router can use it) ─────────────────────────
export const uploadMiddleware = upload.single('document');

// ── Upload handler ────────────────────────────────────────────────────────────
export async function uploadDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file received. Ensure field name is "document".' });
    }

    const docType = req.body?.docType || 'unknown';
    const { userId } = getAuth(req);

    // Put each user's docs in their own Cloudinary folder for easy management
    const folder    = `kyc-documents/${userId}`;
    const publicId  = `${docType}-${Date.now()}`;

    // PDFs are resource_type 'raw' in Cloudinary; images are 'image'
    const resourceType = req.file.mimetype === 'application/pdf' ? 'raw' : 'image';

    const { url, publicId: finalPublicId } = await uploadToCloudinary(
      req.file.buffer,
      folder,
      resourceType,
      publicId,
    );

    console.log(`[DocumentUpload] ${docType} uploaded for user ${userId}: ${url}`);

    return res.json({
      success:   true,
      url,
      publicId:  finalPublicId,
      docType,
      fileName:  req.file.originalname,
      mimeType:  req.file.mimetype,
      sizeBytes: req.file.size,
    });

  } catch (err) {
    console.error('[uploadDocument] Error:', err.message);

    // multer-specific errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 5MB.' });
    }

    return res.status(500).json({ error: err.message || 'Document upload failed. Please try again.' });
  }
}
