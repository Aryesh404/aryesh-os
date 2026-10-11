# Start with Node.js 22 on Alpine Linux (minimal, ~5MB base OS)
FROM node:22-alpine

# Install native build tools (needed for @node-rs/argon2 binary)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package manifests first (Docker cache optimisation)
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json                 ./apps/api/
COPY packages/contracts/package.json      ./packages/contracts/
COPY packages/db/package.json             ./packages/db/
COPY packages/domain/package.json         ./packages/domain/
COPY packages/core/package.json           ./packages/core/
COPY packages/intelligence/package.json   ./packages/intelligence/

# Install all workspace dependencies
RUN npm ci

# Copy source code
COPY apps/api     ./apps/api
COPY packages     ./packages

EXPOSE 4317

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=4317
ENV DATABASE_URL=file:/data/aryesh.db

# Start using tsx (same as npm run start in apps/api)
CMD ["node_modules/.bin/tsx", "apps/api/src/index.ts"]
