/**
 * OCR Document Tool — Placeholder for future Tesseract.js integration.
 *
 * HOW TO ACTIVATE (when ready):
 *   1. npm install tesseract.js
 *   2. Uncomment the Tesseract block below
 *   3. Zero changes needed in any agent — the ToolRegistry handles the rest.
 *      DocumentAgent.js will automatically detect and use this tool via:
 *        this.tools.hasTool('ocr_document')
 *
 * Tesseract.js is:
 *   - Completely free and open source
 *   - Runs locally (no external API calls)
 *   - Supports English + Hindi (hin+eng language pack)
 */
export const ocrTool = {
  name: 'ocr_document',
  description: 'Extracts text from a document image using OCR. Currently returns placeholder — activate Tesseract.js when ready.',
  parameters: {
    imageBuffer:  { type: 'object', description: 'Image buffer (JPEG/PNG)' },
    language:     { type: 'string', description: 'Language: "en" or "hi"' },
    documentType: { type: 'string', description: 'Document type: "aadhaar", "pan", "passport"' },
  },

  execute: async ({ imageBuffer, language = 'en', documentType = 'unknown' }) => {
    // ── FUTURE OCR IMPLEMENTATION ──────────────────────────────────────────
    // Uncomment when adding Tesseract.js:
    //
    // import { createWorker } from 'tesseract.js';
    // const worker = await createWorker(language === 'hi' ? 'hin+eng' : 'eng');
    // const { data: { text, confidence } } = await worker.recognize(imageBuffer);
    // await worker.terminate();
    // return {
    //   text,
    //   confidence:   confidence / 100,   // Normalize to 0.0–1.0
    //   documentType,
    //   status:       'success',
    //   wordCount:    text.split(/\s+/).length,
    // };
    // ─────────────────────────────────────────────────────────────────────

    return {
      text:         null,
      confidence:   0,
      documentType,
      status:       'ocr_not_configured',
      message:      'OCR not yet enabled. Using verbal document confirmation.',
    };
  },
};
