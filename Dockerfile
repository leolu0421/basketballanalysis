# Railway (or any Docker host) build — unlike Vercel, this runs as a
# persistent process with ffmpeg + python3 installed, which video analysis
# (scripts/*.py) needs. See README's "Deploying to Railway" section.
FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      curl \
      unzip \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp needs a JS runtime to decipher some YouTube signatures — deno is
# the one it looks for by default.
RUN curl -fsSL https://deno.land/install.sh | sh \
    && mv /root/.deno/bin/deno /usr/local/bin/deno

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt yt-dlp

COPY . .

RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Runs on every deploy/restart: syncs the DB schema (needs DATABASE_URL,
# set as a Railway environment variable — see README), then starts the
# server. next start reads the PORT env var automatically, which Railway
# sets for you.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm start"]
