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

// Aceita token Bearer (HC Webhook e outros) ou assinatura HMAC-SHA256 do corpo
// no cabeçalho X-Signature: sha256=<hex> (Life Dashboard Companion), usando o mesmo segredo.
// corpos: corpo bruto (Buffer ou texto) ou lista de candidatos (ex.: compactado e descompactado).
// Retorna { ok, motivo } para registro de diagnóstico (nunca inclui valores secretos).
function verificarSaude(req, corpos = '') {
  const segredoSaude = env.HEALTH_WEBHOOK_TOKEN.trim();
  if (!segredoSaude) return { ok: false, motivo: 'HEALTH_WEBHOOK_TOKEN não configurado no servidor' };
  const assinatura = String(req.headers['x-signature'] || '').trim().toLowerCase();
  if (assinatura) {
    if (!/^sha256=[0-9a-f]{64}$/.test(assinatura)) return { ok: false, motivo: 'cabeçalho X-Signature em formato inesperado' };
    const confere = (Array.isArray(corpos) ? corpos : [corpos]).filter((c) => c !== undefined && c !== null).some((c) => {
      const esperado = `sha256=${crypto.createHmac('sha256', segredoSaude).update(c).digest('hex')}`;
      return crypto.timingSafeEqual(sha(assinatura), sha(esperado));
    });
    return confere ? { ok: true } : { ok: false, motivo: 'assinatura HMAC não confere: o segredo informado no app de envio é diferente do HEALTH_WEBHOOK_TOKEN (copie novamente pelo botão Copiar segredo)' };
  }
  const informado = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.headers['x-api-key'] || '');
  if (!informado) return { ok: false, motivo: 'requisição sem X-Signature nem Authorization: informe o segredo de assinatura no app de envio' };
  return crypto.timingSafeEqual(sha(informado.trim()), sha(segredoSaude))
    ? { ok: true }
    : { ok: false, motivo: 'token Bearer não confere com HEALTH_WEBHOOK_TOKEN' };
}

const tokenSaudeValido = (req, corpos = '') => verificarSaude(req, corpos).ok;

module.exports = {
  tokenSaudeValido,
  verificarSaude,
  protecaoAtiva, senhaCorreta, cookieSessao, cookieEncerrarSessao, sessaoValida,
  bloqueado, registrarFalha, limparFalhas,
  novoEstadoOAuth, estadoOAuthValido, cookieLimparOAuth, segredoCronValido,
};
