# Production image for the backend. Any container host (Railway, Fly.io,
# Render, ...) can run it. The SQLite database must live on a persistent
# volume — point PICKLE_DB_PATH at it (e.g. /data/data.sqlite).
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
CMD ["node", "server.js"]
