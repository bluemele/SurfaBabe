#!/bin/bash
# deploy-listener.sh — Lightweight HTTP listener for GitHub webhooks
# Listens on port 9002, validates signature, triggers deploy.sh
#
# Usage: nohup /root/projects/SurfAgent/scripts/deploy-listener.sh &
# Or run via systemd (see surfagent-deploy.service)

PORT=9002
SECRET="31c2427fb8c00ad6564ea3d1e99ed7375f172bca"
DEPLOY_SCRIPT="/root/projects/SurfAgent/scripts/deploy.sh"
LOG="/root/projects/SurfAgent/logs/webhook.log"

mkdir -p "$(dirname "$LOG")"

echo "$(date -Is) — Webhook listener starting on port $PORT" >> "$LOG"

while true; do
  # Use socat to handle one HTTP request at a time
  RESPONSE=$(socat -T5 TCP-LISTEN:$PORT,reuseaddr,fork SYSTEM:'
    read -r REQUEST_LINE
    METHOD=$(echo "$REQUEST_LINE" | cut -d" " -f1)

    # Read headers
    CONTENT_LENGTH=0
    SIG=""
    EVENT=""
    while IFS= read -r HEADER; do
      HEADER=$(echo "$HEADER" | tr -d "\r")
      [ -z "$HEADER" ] && break
      case "$HEADER" in
        Content-Length:*|content-length:*) CONTENT_LENGTH=$(echo "$HEADER" | cut -d" " -f2) ;;
        X-Hub-Signature-256:*|x-hub-signature-256:*) SIG=$(echo "$HEADER" | cut -d" " -f2) ;;
        X-GitHub-Event:*|x-github-event:*) EVENT=$(echo "$HEADER" | cut -d" " -f2) ;;
      esac
    done

    # Read body
    BODY=""
    if [ "$CONTENT_LENGTH" -gt 0 ] 2>/dev/null; then
      BODY=$(dd bs=1 count=$CONTENT_LENGTH 2>/dev/null)
    fi

    # Validate signature
    if [ -n "'"$SECRET"'" ] && [ -n "$SIG" ]; then
      EXPECTED="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "'"$SECRET"'" | cut -d" " -f2)"
      if [ "$SIG" != "$EXPECTED" ]; then
        echo -en "HTTP/1.1 401 Unauthorized\r\nContent-Length: 14\r\n\r\n{\"error\":\"bad\"}"
        exit 0
      fi
    fi

    # Only deploy on push events
    if [ "$EVENT" = "push" ]; then
      nohup '"$DEPLOY_SCRIPT"' >/dev/null 2>&1 &
      echo -en "HTTP/1.1 200 OK\r\nContent-Length: 15\r\n\r\n{\"status\":\"ok\"}"
    else
      echo -en "HTTP/1.1 200 OK\r\nContent-Length: 19\r\n\r\n{\"status\":\"ignored\"}"
    fi
  ' 2>> "$LOG")
done
