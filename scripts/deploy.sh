#!/bin/bash
# deploy.sh — Auto-deploy SurfaBabe on git push
# Called by GitHub webhook via deploy-listener.js
set -e

PROJECT_DIR="/root/projects/SurfaBabe"
LOG="/root/projects/SurfaBabe/logs/deploy.log"

echo "$(date -Is) — Deploy triggered" >> "$LOG"

cd "$PROJECT_DIR"

# Pull latest
git pull origin main >> "$LOG" 2>&1

# Rebuild and restart
docker compose up -d --build >> "$LOG" 2>&1

echo "$(date -Is) — Deploy complete" >> "$LOG"
