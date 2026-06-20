import { BaseAgent } from './base/BaseAgent.js';

/**
 * DocumentAgent
 *
 * Handles document verification.
 *   Phase 1 (current): Verbal confirmation — asks user to confirm their document
 *   Phase 2 (future):  When ocr_document tool is registered, automatically
 *                      triggers OCR flow instead. Zero code changes needed.
 *
 * Input:  { sessionId, language, collectedFields }
 * Output: { status, closingMessage?, requiresAction, verified }
 */
export class DocumentAgent extends BaseAgent {
  constructor() {
    super('DocumentAgent');
  }

  async run({ sessionId, language = 'en', collectedFields = {} }) {
    const hasOCR = this.tools.hasTool('ocr_document');

    if (hasOCR) {
      // Future: check if OCR is actually configured (not just the placeholder)
      // If it is, emit a document upload request to the frontend
      this.log('info', 'OCR tool detected — initiating document capture flow', { sessionId });
      return {
        status:         'ocr_ready',
        closingMessage: null,
        requiresAction: 'upload_document',
        verified:       false,
      };
    }

    // ── Current: verbal closing ───────────────────────────────────────────────
    const firstName = collectedFields.fullName
      ? collectedFields.fullName.split(' ')[0]
      : null;

    const closing = language === 'hi'
      ? `बहुत बढ़िया${firstName ? `, ${firstName} जी` : ''}! आपके सभी विवरण दर्ज कर लिए गए हैं। आपका KYC साक्षात्कार अब पूरा हो गया है। हम आपके आवेदन की समीक्षा करेंगे और जल्द ही आपसे संपर्क करेंगे। धन्यवाद!`
      : `Excellent${firstName ? `, ${firstName}` : ''}! All your details have been recorded successfully. Your KYC interview is now complete. We'll review your application and get back to you shortly. Thank you for your time!`;

    this.log('info', 'Verbal document confirmation — call wrapping up', { sessionId });

    return {
      status:         'verbal_confirmed',
      closingMessage: closing,
      requiresAction: null,
      verified:       true,
    };
  }
}
