import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

/**
 * Cloudinary configuration.
 * CLOUDINARY_URL format:  cloudinary://API_KEY:API_SECRET@CLOUD_NAME
 * The SDK auto-parses this when CLOUDINARY_URL is set in the environment.
 */
cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL });

/**
 * Upload a file buffer to Cloudinary and return the secure URL.
 *
 * Why stream instead of temp file?
 *   - multer stores files in memory (no disk I/O)
 *   - We pipe the buffer directly to Cloudinary's upload_stream
 *   - Works in serverless / containerised environments with no writable disk
 *
 * @param {Buffer} buffer       - File buffer from multer (req.file.buffer)
 * @param {string} folder       - Cloudinary folder, e.g. 'kyc-documents'
 * @param {string} resourceType - 'image' | 'raw' (use 'raw' for PDFs)
 * @param {string} [publicId]   - Optional custom public ID
 * @returns {Promise<{ url: string, publicId: string }>}
 */
export function uploadToCloudinary(buffer, folder = 'kyc-documents', resourceType = 'image', publicId) {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder,
      resource_type: resourceType,
      // Flag documents as private so they're not publicly browsable
      type: 'upload',
      // Auto-tag for easy filtering in Cloudinary dashboard
      tags: ['kyc', folder],
    };

    if (publicId) uploadOptions.public_id = publicId;

    const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
      if (error) {
        console.error('[Cloudinary] Upload error:', error.message);
        reject(new Error(`Cloudinary upload failed: ${error.message}`));
      } else {
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    });

    // Convert Buffer to readable stream and pipe
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
}

/**
 * Delete a file from Cloudinary by public ID.
 * Used if a user removes a document or session is cancelled.
 */
export async function deleteFromCloudinary(publicId, resourceType = 'image') {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    console.error('[Cloudinary] Delete error:', err.message);
    // Non-blocking — don't rethrow
  }
}
