import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { connectDB } from './src/config/db.js';
import { registerSocketHandlers } from './src/websocket/socketHandler.js';
import { geoCaptureMiddleware } from './src/middleware/geoCapture.middleware.js';
import { clerkMiddleware } from '@clerk/express';

// Routes
import sessionRoutes from './src/routes/session.routes.js';
import kycRoutes from './src/routes/kyc.routes.js';
import applicationRoutes from './src/routes/application.routes.js';
import adminRoutes from './src/routes/admin.routes.js';
import webhookRoutes from './src/routes/webhook.routes.js';
import authRoutes from './src/routes/auth.routes.js';

const app = express();
const httpServer = createServer(app);

// ─── Socket.IO ───────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});
registerSocketHandlers(io);

// ─── Global Middleware ────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}));

// Webhook route needs raw body — must come BEFORE express.json()
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(clerkMiddleware());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Geo capture — runs on every API request, logs IP + location
app.use('/api/', geoCaptureMiddleware);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

app.use('/api/sessions', sessionRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);

// ─── 404 + Error Handler ─────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

app.use((err, _req, res, _next) => {
  console.error('[Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8000;

connectDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔌 Socket.IO ready`);
    console.log(`🌍 CORS allowed for: ${process.env.CLIENT_URL}`);
  });
});
