'use strict';

const path = require('path');

// Carrega um arquivo .env simples (CHAVE=valor), sem dependências externas.
function carregarDotEnv() {
  const fs = require('fs');
  const arquivo = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(arquivo)) return;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

carregarDotEnv();

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

module.exports = {
  PORT,
  BASE_URL,
  HTTPS: BASE_URL.startsWith('https://'),
  DEMO: process.env.DEMO === '1',
  STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID || '',
  STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET || '',
  APP_PASSWORD: process.env.APP_PASSWORD || '',
  SESSION_SECRET: process.env.SESSION_SECRET || '',
  CRON_SECRET: process.env.CRON_SECRET || '',
  HEALTH_WEBHOOK_TOKEN: process.env.HEALTH_WEBHOOK_TOKEN || '',
  TRUST_PROXY: process.env.TRUST_PROXY === '1',
  DATA_DIR: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
};
