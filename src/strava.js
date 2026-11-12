'use strict';

// Integração com a API do Strava: OAuth, renovação de token e leitura de atividades.
const env = require('./env');
const store = require('./store');

const API = 'https://www.strava.com/api/v3';
const OAUTH = 'https://www.strava.com/oauth';
const ESCOPO = 'read,activity:read_all';
const JANELA_INICIAL_DIAS = 120;
const RETENCAO_DIAS = 180;
const REVISAO_DIAS = 3; // reprocessa os últimos dias para captar edições e exclusões

const CAMPOS = [
  'id', 'name', 'type', 'sport_type', 'start_date', 'start_date_local', 'timezone',
  'moving_time', 'elapsed_time', 'distance', 'total_elevation_gain', 'average_heartrate',
  'max_heartrate', 'suffer_score', 'average_speed', 'kilojoules', 'trainer', 'manual',
];

class ErroStrava extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.status = status;
  }
}

function configurado() {
  return Boolean(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET);
}

function urlAutorizacao(state) {
  const p = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${env.BASE_URL}/auth/strava/callback`,
    approval_prompt: 'auto',
    scope: ESCOPO,
    state,
  });
  return `${OAUTH}/authorize?${p}`;
}

async function requisicao(url, opcoes = {}) {
  let resp;
  try {
    resp = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    throw new ErroStrava(`Falha de comunicação com o Strava: ${e.message}`, 0);
  }
  if (resp.status === 429) throw new ErroStrava('Limite de requisições do Strava atingido. Nova tentativa na próxima sincronização.', 429);
  if (resp.status === 401) throw new ErroStrava('Autorização do Strava inválida ou revogada. Conecte a conta novamente.', 401);
  if (!resp.ok) throw new ErroStrava(`Strava respondeu com erro ${resp.status}.`, resp.status);
  return resp.json();
}

async function token(params) {
  return requisicao(`${OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, ...params }),
  });
}

async function trocarCodigo(codigo) {
  const r = await token({ code: codigo, grant_type: 'authorization_code' });
  const atleta = r.athlete || {};
  store.gravar('tokens', {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    expires_at: r.expires_at,
    athlete: { id: atleta.id, firstname: atleta.firstname, lastname: atleta.lastname },
  });
  return atleta;
}

async function tokenDeAcesso() {
  const t = store.ler('tokens', null);
  if (!t) throw new ErroStrava('Conta do Strava não conectada.', 401);
  if (t.expires_at - 300 > Date.now() / 1000) return t.access_token;
  const r = await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  store.gravar('tokens', { ...t, access_token: r.access_token, refresh_token: r.refresh_token, expires_at: r.expires_at });
  return r.access_token;
}

async function listarAtividades(depoisDe) {
  const acesso = await tokenDeAcesso();
  const todas = [];
  for (let pagina = 1; pagina <= 20; pagina++) {
    const url = `${API}/athlete/activities?after=${depoisDe}&per_page=200&page=${pagina}`;
    const lote = await requisicao(url, { headers: { Authorization: `Bearer ${acesso}` } });
    todas.push(...lote);
    if (lote.length < 200) break;
  }
  return todas.map((a) => Object.fromEntries(CAMPOS.filter((c) => a[c] !== undefined).map((c) => [c, a[c]])));
}

async function sincronizar({ completa = false } = {}) {
  const existentes = store.ler('atividades', []);
  const agora = Date.now();
  let desde;
  if (completa || !existentes.length) {
    desde = agora - JANELA_INICIAL_DIAS * 86400000;
  } else {
    const ultima = Math.max(...existentes.map((a) => Date.parse(a.start_date)));
    desde = Math.min(ultima, agora) - REVISAO_DIAS * 86400000;
  }
  const novas = await listarAtividades(Math.floor(desde / 1000));

  // Substitui integralmente a janela reprocessada (capta edições e exclusões).
  const limiteRetencao = agora - RETENCAO_DIAS * 86400000;
  const mapa = new Map();
  for (const a of existentes) {
    const t = Date.parse(a.start_date);
    if (t < desde && t >= limiteRetencao) mapa.set(String(a.id), a);
  }
  const idsAntes = new Set(existentes.map((a) => String(a.id)));
  let inseridas = 0;
  for (const a of novas) {
    if (!idsAntes.has(String(a.id))) inseridas++;
    mapa.set(String(a.id), a);
  }
  const resultado = [...mapa.values()].sort((a, b) => Date.parse(a.start_date) - Date.parse(b.start_date));
  store.gravar('atividades', resultado);
  return { lidas: novas.length, novas: inseridas, total: resultado.length };
}

async function desconectar() {
  const t = store.ler('tokens', null);
  if (t) {
    try {
      await requisicao(`${OAUTH}/deauthorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: t.access_token }),
      });
    } catch {
      // A revogação remota é melhor esforço; os dados locais são removidos de qualquer forma.
    }
  }
  store.remover('tokens');
  store.remover('atividades');
}

function atleta() {
  return store.ler('tokens', null)?.athlete || null;
}

module.exports = { configurado, urlAutorizacao, trocarCodigo, sincronizar, desconectar, atleta, ErroStrava, ESCOPO };
