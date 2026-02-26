#!/usr/bin/env node
/**
 * deploy-listener.js — GitHub webhook receiver for SurfaBabe auto-deploy
 * Listens on port 9002, validates GitHub signature, triggers deploy.sh
 */

import http from 'http';
import crypto from 'crypto';
import { exec } from 'child_process';

const PORT = 9002;
const SECRET = '31c2427fb8c00ad6564ea3d1e99ed7375f172bca';
const DEPLOY_SCRIPT = '/root/projects/SurfaBabe/scripts/deploy.sh';

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    // Validate GitHub signature
    const sig = req.headers['x-hub-signature-256'];
    if (SECRET && sig) {
      const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
      if (sig !== expected) {
        console.log(`${new Date().toISOString()} — Bad signature from ${req.socket.remoteAddress}`);
        res.writeHead(401);
        res.end('Bad signature');
        return;
      }
    }

    const event = req.headers['x-github-event'];
    console.log(`${new Date().toISOString()} — GitHub event: ${event}`);

    if (event === 'push') {
      exec(DEPLOY_SCRIPT, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) console.error('Deploy failed:', err.message);
        else console.log('Deploy complete');
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"deploying"}');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ignored"}');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SurfaBabe deploy webhook listening on 127.0.0.1:${PORT}`);
});
