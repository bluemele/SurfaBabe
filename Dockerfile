FROM node:20-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install app dependencies
COPY package.json ./
RUN npm install

# Copy app files
COPY index.js server.js scheduler.js knowledge.js orders.js db.js schema.sql CLAUDE.md ./

# Copy knowledge base and scripts
COPY knowledge/ ./knowledge/
COPY scripts/ ./scripts/

# Create data directories
RUN mkdir -p auth data data/orders logs media

EXPOSE 3002

CMD ["sh", "-c", "cp /tmp/.gitconfig-host /root/.gitconfig 2>/dev/null; cp /tmp/.git-credentials-host /root/.git-credentials 2>/dev/null; exec node index.js"]
