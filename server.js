/**
 * server.js — Simplified HTTP API for SurfaBabe
 *
 * Endpoints:
 * - GET /health — health check
 * - POST /api/send — send message to any chat (requires token)
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { dbHealthCheck } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || '';
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3002');
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

export function startServer(sockRef, sendResponse) {
  const app = express();

  // Serve static website from public/
  app.use(express.static(join(__dirname, 'public')));

  app.use(express.json({ limit: '1mb' }));

  // Bearer token auth
  function requireToken(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!WEBHOOK_TOKEN || token !== WEBHOOK_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  // Health check
  app.get('/health', async (_req, res) => {
    const dbStatus = await dbHealthCheck();
    res.json({
      status: 'ok',
      bot: 'SurfaBabe',
      uptime: Math.floor(process.uptime()),
      db: dbStatus,
    });
  });

  // Send message
  app.post('/api/send', requireToken, async (req, res) => {
    try {
      const { to, text } = req.body;
      const jid = to === 'admin' ? ADMIN_JID : to;
      if (!jid || !text) {
        return res.status(400).json({ error: 'Missing to or text' });
      }
      await sendResponse(sockRef.sock, jid, text);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
    console.log(`HTTP API listening on port ${WEBHOOK_PORT}`);
  });

  return app;
}
