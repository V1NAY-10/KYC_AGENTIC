import express from 'express';
import { clerkWebhookHandler } from '../controllers/webhook.controller.js';

const router = express.Router();

// The body MUST be raw buffer for Svix verification
// This is configured in server.js before express.json()
router.post('/clerk', clerkWebhookHandler);

export default router;
