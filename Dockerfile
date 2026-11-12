FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "server.js"]
