# syntax=docker/dockerfile:1

# Debian-based slim (glibc) so better-sqlite3 uses prebuilt binaries; build tools
# present as a fallback if it must compile from source.
# node:24 — remix@3 requires node >=24.3.0 (engines); node:22 only warns.
FROM node:24-slim

WORKDIR /app

# curl for the healthcheck; build deps as a fallback for native modules
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install deps first (layer caching). tsx runs TS at runtime, so keep ALL deps.
COPY package.json package-lock.json ./
RUN npm ci

# tsconfig.json is REQUIRED at runtime: tsx/esbuild reads jsxImportSource:"remix/ui"
# from it to compile JSX to the Remix runtime (without it JSX falls back to
# React.createElement and the views crash).
COPY tsconfig.json ./
COPY *.ts ./
COPY app ./app
COPY public ./public
COPY styles ./styles

# Precompile Tailwind/DaisyUI -> public/static/app.css before first paint (no FOUC).
RUN npm run build:css

# SQLite data directory (mounted as a volume in production)
RUN mkdir -p /data

ENV NODE_ENV=production
ENV DB_PATH=/data/eat.db
ENV PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["npm", "run", "serve"]
