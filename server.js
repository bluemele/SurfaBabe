/**
 * server.js — Simplified HTTP API for SurfAgent
 *
 * Endpoints:
 * - GET /health — health check
 * - POST /api/send — send message to any chat (requires token)
 */

import express from 'express';

const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || '';
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3002');
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

export function startServer(sockRef, sendResponse) {
  const app = express();

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
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', bot: 'SurfAgent', uptime: Math.floor(process.uptime()) });
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
