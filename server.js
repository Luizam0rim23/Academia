'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const env = require('./src/env');
const store = require('./src/store');
const settings = require('./src/settings');
const auth = require('./src/auth');
const strava = require('./src/strava');
const sync = require('./src/sync');
const { construirPainel } = require('./src/coach');
const { FOCOS_MARCAVEIS, FOCOS, NOMES_DIVISAO } = require('./src/exercises');

// ------------------------------------------------------------- validação de inicialização
if (!env.DEMO) {
  const faltando = [];
  if (!env.APP_PASSWORD) faltando.push('APP_PASSWORD');
  if (!strava.configurado()) faltando.push('STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET');
  if (faltando.length) {
    console.error(`Configuração incompleta. Defina as variáveis: ${faltando.join(', ')} (veja .env.example).`);
    process.exit(1);
  }
}

// ------------------------------------------------------------- utilitários HTTP
const PUBLICO = path.join(__dirname, 'public');
const ESTATICOS = {
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/login.js': ['login.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
};
const LIVRES = new Set(['/login.js', '/style.css', '/icon.svg', '/manifest.webmanifest']);

const CABECALHOS_SEGURANCA = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

function enviar(res, status, corpo, cabecalhos = {}) {
  res.writeHead(status, { ...CABECALHOS_SEGURANCA, ...cabecalhos });
  res.end(corpo);
}

const json = (res, status, obj, cab = {}) =>
  enviar(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cab });

const redirecionar = (res, destino, cab = {}) => enviar(res, 303, '', { Location: destino, ...cab });

function arquivo(res, nome, tipo) {
  fs.readFile(path.join(PUBLICO, nome), (erro, dados) => {
    if (erro) return enviar(res, 404, 'Não encontrado');
    enviar(res, 200, dados, { 'Content-Type': tipo, 'Cache-Control': 'no-cache' });
  });
}

function lerCorpo(req, limite = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (c) => {
      tamanho += c.length;
      if (tamanho > limite) { reject(new Error('Corpo da requisição excede o limite.')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

async function lerJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    const e = new Error('Content-Type deve ser application/json.');
    e.status = 415;
    throw e;
  }
  try {
    return JSON.parse(await lerCorpo(req) || '{}');
  } catch {
    const e = new Error('JSON inválido.');
    e.status = 400;
    throw e;
  }
}

// ------------------------------------------------------------- painel
function montarPainel() {
  const config = settings.obter();
  const atividades = store.ler('atividades', []);
  const marcacoes = store.ler('marcacoes', {});
  const conectado = sync.conectado();
  const base = {
    demo: env.DEMO,
    conectado,
    atleta: env.DEMO ? { firstname: 'Demonstração' } : strava.atleta(),
    protecao: auth.protecaoAtiva(),
    estadoSync: sync.estado(),
    config,
    opcoes: {
      focos: FOCOS_MARCAVEIS.map((id) => ({ id, nome: FOCOS[id].nome })),
      divisoes: NOMES_DIVISAO,
    },
  };
  if (!conectado) return base;
  return { ...base, ...construirPainel(atividades, config, marcacoes) };
}

// ------------------------------------------------------------- rotas
async function rotear(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const caminho = url.pathname;
  const metodo = req.method;

  if (caminho === '/healthz') return json(res, 200, { ok: true });

  if (metodo === 'GET' && LIVRES.has(caminho)) return arquivo(res, ...ESTATICOS[caminho]);

  if (caminho === '/login') {
    if (!auth.protecaoAtiva()) return redirecionar(res, '/');
    if (metodo === 'GET') return arquivo(res, 'login.html', 'text/html; charset=utf-8');
    if (metodo === 'POST') {
      if (auth.bloqueado(req)) return redirecionar(res, '/login?erro=bloqueado');
      const dados = new URLSearchParams(await lerCorpo(req));
      if (auth.senhaCorreta(dados.get('senha') || '')) {
        auth.limparFalhas(req);
        return redirecionar(res, '/', { 'Set-Cookie': auth.cookieSessao() });
      }
      auth.registrarFalha(req);
      return redirecionar(res, '/login?erro=senha');
    }
  }

  // Sincronização disparada por agendador externo (opcional, para hospedagens que hibernam).
  if (caminho === '/cron/sync' && (metodo === 'POST' || metodo === 'GET')) {
    if (!auth.segredoCronValido(req, url)) return json(res, 401, { erro: 'Não autorizado.' });
    return json(res, 200, await sync.executar('agendador externo'));
  }

  // ---- a partir daqui, apenas com sessão válida
  if (!auth.sessaoValida(req)) {
    if (caminho.startsWith('/api/')) return json(res, 401, { erro: 'Sessão expirada. Entre novamente.' });
    return redirecionar(res, '/login');
  }

  if (metodo === 'GET' && caminho === '/') return arquivo(res, 'index.html', 'text/html; charset=utf-8');
  if (metodo === 'GET' && ESTATICOS[caminho]) return arquivo(res, ...ESTATICOS[caminho]);

  if (metodo === 'POST' && caminho === '/logout') {
    return redirecionar(res, auth.protecaoAtiva() ? '/login' : '/', { 'Set-Cookie': auth.cookieEncerrarSessao() });
  }

  if (metodo === 'GET' && caminho === '/auth/strava') {
    if (env.DEMO) return redirecionar(res, '/');
    const { state, cookie } = auth.novoEstadoOAuth();
    return redirecionar(res, strava.urlAutorizacao(state), { 'Set-Cookie': cookie });
  }

  if (metodo === 'GET' && caminho === '/auth/strava/callback') {
    const limpar = { 'Set-Cookie': auth.cookieLimparOAuth() };
    if (url.searchParams.get('error')) return redirecionar(res, '/?strava=negado', limpar);
    if (!auth.estadoOAuthValido(req, url.searchParams.get('state'))) return redirecionar(res, '/?strava=estado', limpar);
    const escopo = url.searchParams.get('scope') || '';
    if (!/activity:read/.test(escopo)) return redirecionar(res, '/?strava=escopo', limpar);
    try {
      await strava.trocarCodigo(url.searchParams.get('code') || '');
      await sync.executar('conexão', { completa: true });
      return redirecionar(res, '/?strava=ok', limpar);
    } catch (e) {
      console.error(`[oauth] ${e.message}`);
      return redirecionar(res, '/?strava=falha', limpar);
    }
  }

  if (metodo === 'GET' && caminho === '/api/painel') {
    await sync.garantirAtualizado();
    return json(res, 200, montarPainel());
  }

  if (metodo === 'POST' && caminho === '/api/sync') {
    await lerJson(req);
    const r = await sync.executar('manual');
    return json(res, r.ok ? 200 : 502, { ...r, painel: montarPainel() });
  }

  if (metodo === 'PUT' && caminho === '/api/config') {
    settings.atualizar(await lerJson(req));
    return json(res, 200, montarPainel());
  }

  if (metodo === 'PUT' && caminho === '/api/foco') {
    const { id, foco } = await lerJson(req);
    const marcacoes = store.ler('marcacoes', {});
    if (!id || typeof id !== 'string' || id.length > 30) return json(res, 400, { erro: 'Atividade inválida.' });
    if (foco === null || foco === '') delete marcacoes[id];
    else if (FOCOS_MARCAVEIS.includes(foco)) marcacoes[id] = foco;
    else return json(res, 400, { erro: 'Foco inválido.' });
    store.gravar('marcacoes', marcacoes);
    return json(res, 200, montarPainel());
  }

  if (metodo === 'POST' && caminho === '/api/desconectar') {
    await lerJson(req);
    if (!env.DEMO) await strava.desconectar();
    store.remover('estado');
    return json(res, 200, montarPainel());
  }

  return enviar(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
}

const servidor = http.createServer((req, res) => {
  rotear(req, res).catch((e) => {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    if (!res.headersSent) json(res, status, { erro: status >= 500 ? 'Erro interno.' : e.message });
  });
});

servidor.listen(env.PORT, () => {
  console.log(`Treino Strava em ${env.BASE_URL} (porta ${env.PORT})${env.DEMO ? ' — MODO DEMONSTRAÇÃO' : ''}`);
  if (env.DEMO && !auth.protecaoAtiva()) console.warn('Atenção: sem APP_PASSWORD, o acesso está aberto (aceitável apenas em demonstração).');
  if (env.DEMO) sync.executar('demonstração');
  sync.iniciarAgenda();
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    servidor.close(() => process.exit(0));
    servidor.closeIdleConnections();
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
