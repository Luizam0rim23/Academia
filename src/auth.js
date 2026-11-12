'use strict';

// Controle de acesso: senha única do aplicativo, sessão em cookie assinado (HMAC) e limite de tentativas.
const crypto = require('crypto');
const env = require('./env');
const store = require('./store');

const DURACAO_SESSAO_MS = 30 * 86400000;
const MAX_TENTATIVAS = 5;
const JANELA_TENTATIVAS_MS = 15 * 60000;

function segredo() {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  let s = store.ler('segredo', null);
  if (!s) {
    s = { valor: crypto.randomBytes(32).toString('hex') };
    store.gravar('segredo', s);
  }
  return s.valor;
}

const SEGREDO = segredo();
const hmac = (v) => crypto.createHmac('sha256', SEGREDO).update(v).digest('base64url');
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();

function lerCookies(req) {
  const saida = {};
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) saida[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return saida;
}

function cookie(nome, valor, maxAgeSeg) {
  const attrs = [`${nome}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeg}`];
  if (env.HTTPS) attrs.push('Secure');
  return attrs.join('; ');
}

function protecaoAtiva() {
  return Boolean(env.APP_PASSWORD);
}

function senhaCorreta(senha) {
  return protecaoAtiva() && crypto.timingSafeEqual(sha(senha), sha(env.APP_PASSWORD));
}

function cookieSessao() {
  const exp = String(Date.now() + DURACAO_SESSAO_MS);
  return cookie('sessao', `${exp}.${hmac(exp)}`, DURACAO_SESSAO_MS / 1000);
}

const cookieEncerrarSessao = () => cookie('sessao', '', 0);

function sessaoValida(req) {
  if (!protecaoAtiva()) return true;
  const valor = lerCookies(req).sessao || '';
  const [exp, assinatura] = valor.split('.');
  if (!exp || !assinatura) return false;
  const esperado = Buffer.from(hmac(exp));
  const recebido = Buffer.from(assinatura);
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido) && Number(exp) > Date.now();
}

// --- limite de tentativas de login por IP
const tentativas = new Map();

function ipDe(req) {
  if (env.TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'desconhecido';
}

function bloqueado(req) {
  const t = tentativas.get(ipDe(req));
  if (!t) return false;
  if (Date.now() > t.ate) { tentativas.delete(ipDe(req)); return false; }
  return t.n >= MAX_TENTATIVAS;
}

function registrarFalha(req) {
  const ip = ipDe(req);
  const t = tentativas.get(ip);
  if (!t || Date.now() > t.ate) tentativas.set(ip, { n: 1, ate: Date.now() + JANELA_TENTATIVAS_MS });
  else t.n++;
}

const limparFalhas = (req) => tentativas.delete(ipDe(req));

// --- state do OAuth (proteção contra CSRF no retorno do Strava)
function novoEstadoOAuth() {
  const state = crypto.randomBytes(16).toString('hex');
  return { state, cookie: cookie('oauth_state', state, 600) };
}

function estadoOAuthValido(req, state) {
  const salvo = lerCookies(req).oauth_state || '';
  return Boolean(state) && salvo.length === state.length && crypto.timingSafeEqual(Buffer.from(salvo), Buffer.from(state));
}

const cookieLimparOAuth = () => cookie('oauth_state', '', 0);

function segredoCronValido(req, url) {
  if (!env.CRON_SECRET) return false;
  const informado = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('chave') || '';
  return crypto.timingSafeEqual(sha(informado), sha(env.CRON_SECRET));
}

function tokenSaudeValido(req) {
  if (!env.HEALTH_WEBHOOK_TOKEN) return false;
  const informado = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.headers['x-api-key'] || '');
  return crypto.timingSafeEqual(sha(informado), sha(env.HEALTH_WEBHOOK_TOKEN));
}

module.exports = {
  tokenSaudeValido,
  protecaoAtiva, senhaCorreta, cookieSessao, cookieEncerrarSessao, sessaoValida,
  bloqueado, registrarFalha, limparFalhas,
  novoEstadoOAuth, estadoOAuthValido, cookieLimparOAuth, segredoCronValido,
};
