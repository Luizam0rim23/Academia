'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const env = require('./src/env');
const store = require('./src/store');
const settings = require('./src/settings');
const auth = require('./src/auth');
const strava = require('./src/strava');
const sync = require('./src/sync');
const { construirPainel } = require('./src/coach');
const saude = require('./src/saude');
const tecnico = require('./src/tecnico');
const { FOCOS_MARCAVEIS, FOCOS, NOMES_DIVISAO } = require('./src/exercises');

// ------------------------------------------------------------- validação de inicialização
if (!env.DEMO) {
  const faltando = [];
  // Senha dispensável apenas quando o servidor aceita conexões somente do próprio aparelho.
  if (!env.APP_PASSWORD && !env.SOMENTE_LOCAL) faltando.push('APP_PASSWORD');
  // As credenciais do Strava podem vir do .env, do cadastro na página ou de um backup importado.
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

function lerCorpoBuffer(req, limite) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (c) => {
      tamanho += c.length;
      if (tamanho > limite) { reject(Object.assign(new Error('Corpo da requisição excede o limite.'), { status: 413 })); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
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

async function lerJson(req, limite) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    const e = new Error('Content-Type deve ser application/json.');
    e.status = 415;
    throw e;
  }
  try {
    return JSON.parse(await lerCorpo(req, limite) || '{}');
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
    stravaConfigurado: env.DEMO || strava.configurado(),
    modoLocal: env.SOMENTE_LOCAL,
    atleta: env.DEMO ? { firstname: 'Demonstração' } : strava.atleta(),
    protecao: auth.protecaoAtiva(),
    estadoSync: sync.estado(),
    config,
    saudeIntegracao: {
      webhookAtivo: Boolean(env.HEALTH_WEBHOOK_TOKEN),
      url: env.SOMENTE_LOCAL ? `http://127.0.0.1:${env.PORT}/api/saude/webhook` : (env.WEBHOOK_URL || `${env.BASE_URL}/api/saude/webhook`),
      // O segredo é exibido (para cópia) no modo local ou quando a página exige senha; o painel só é servido a sessões válidas.
      token: (env.SOMENTE_LOCAL || auth.protecaoAtiva()) && env.HEALTH_WEBHOOK_TOKEN ? env.HEALTH_WEBHOOK_TOKEN : undefined,
      ultimoRecebimento: saude.ler().ultimoRecebimento,
      origem: saude.ler().origem,
    },
    opcoes: {
      focos: FOCOS_MARCAVEIS.map((id) => ({ id, nome: FOCOS[id].nome })),
      divisoes: NOMES_DIVISAO,
    },
  };
  if (!conectado) return base;
  const dadosSaude = saude.ler();
  // Atividades do Strava + sessões do relógio (Samsung Health via Health Connect) sem duplicidade.
  const todas = [...atividades, ...saude.atividadesDoRelogio(dadosSaude, atividades, config.timezone)];
  const painel = construirPainel(todas, config, marcacoes, Date.now(), dadosSaude);
  painel.tecnico = tecnico.analisar(painel, dadosSaude, config);
  return { ...base, ...painel };
}

// ------------------------------------------------------------- espelho (resumo em pasta sincronizada)
let agendaEspelho = null;
function atualizarEspelho(atrasoMs = 20000) {
  if (!env.RESUMO_DIR) return;
  clearTimeout(agendaEspelho);
  agendaEspelho = setTimeout(() => {
    try {
      const p = montarPainel();
      if (!p.tecnico) return;
      fs.mkdirSync(env.RESUMO_DIR, { recursive: true });
      const carimbo = new Date().toLocaleString('pt-BR', { timeZone: p.config.timezone });
      // Gravação direta (sem renomear): a pasta pode estar em uso pelo cliente de sincronização.
      fs.writeFileSync(path.join(env.RESUMO_DIR, 'resumo-treino.txt'), `${p.tecnico.resumoTexto}\n\nAtualizado em ${carimbo}.\n`);
      const dados = {
        atualizadoEm: new Date().toISOString(), hoje: p.hoje, config: p.config, plano: p.plano, projecao: p.projecao,
        metricas: p.metricas, recuperacao: p.recuperacao, analise: { achados: p.tecnico.achados, indicadores: p.tecnico.indicadores },
        atividades: p.recentes,
      };
      fs.writeFileSync(path.join(env.RESUMO_DIR, 'dados-treino.json'), JSON.stringify(dados, null, 1));
      console.log(`[espelho] resumo gravado em ${env.RESUMO_DIR}`);
    } catch (e) {
      console.error(`[espelho] falha ao gravar resumo: ${e.message}`);
    }
  }, atrasoMs);
}
sync.definirAoConcluir(() => atualizarEspelho(1000));

// ------------------------------------------------------------- exportação / importação (migração entre aparelhos)
const ARQUIVOS_MIGRAVEIS = ['atividades', 'tokens', 'strava-app', 'saude', 'config', 'marcacoes', 'estado'];

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

  // Recebimento de dados de saúde do celular (Health Connect via Life Dashboard Companion ou HC Webhook).
  if (caminho === '/api/saude/webhook' && metodo === 'POST') {
    const bruto = await lerCorpoBuffer(req, 32 * 1024 * 1024);
    // Envios grandes podem chegar compactados (gzip/deflate); a assinatura é aceita sobre o corpo bruto ou o descompactado.
    let texto = bruto;
    const codificacao = String(req.headers['content-encoding'] || '').toLowerCase();
    try {
      if (codificacao.includes('gzip') || (bruto[0] === 0x1f && bruto[1] === 0x8b)) texto = zlib.gunzipSync(bruto, { maxOutputLength: 128 * 1024 * 1024 });
      else if (codificacao.includes('deflate')) texto = zlib.inflateSync(bruto, { maxOutputLength: 128 * 1024 * 1024 });
    } catch {
      console.warn('[saude] 400: corpo compactado inválido');
      return json(res, 400, { erro: 'Corpo compactado inválido.' });
    }
    const verificacao = auth.verificarSaude(req, texto === bruto ? [bruto] : [bruto, texto]);
    if (!verificacao.ok) {
      console.warn(`[saude] 401: ${verificacao.motivo} (cabeçalhos recebidos: ${Object.keys(req.headers).join(', ')}; ${bruto.length} bytes${codificacao ? `, ${codificacao}` : ''})`);
      return json(res, 401, { erro: 'Não autorizado.', motivo: verificacao.motivo });
    }
    let corpo;
    try { corpo = JSON.parse(texto.toString('utf8') || '{}'); } catch {
      console.warn('[saude] 400: JSON inválido');
      return json(res, 400, { erro: 'JSON inválido.' });
    }
    const contagem = saude.registrarWebhook(corpo);
    atualizarEspelho();
    console.log(`[saude] recebidos: ${contagem.sono} sessões de sono, ${contagem.fcRepouso} FC repouso, ${contagem.vfc} VFC`);
    return json(res, 200, { ok: true, ...contagem });
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
    if (!strava.configurado()) return redirecionar(res, '/?strava=semapp');
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
    atualizarEspelho();
    return json(res, 200, montarPainel());
  }

  if (metodo === 'PUT' && caminho === '/api/foco') {
    const { id, foco } = await lerJson(req);
    const marcacoes = store.ler('marcacoes', {});
    if (!id || typeof id !== 'string' || id.length > 40) return json(res, 400, { erro: 'Atividade inválida.' });
    if (foco === null || foco === '') delete marcacoes[id];
    else if (FOCOS_MARCAVEIS.includes(foco)) marcacoes[id] = foco;
    else return json(res, 400, { erro: 'Foco inválido.' });
    store.gravar('marcacoes', marcacoes);
    atualizarEspelho();
    return json(res, 200, montarPainel());
  }

  if (metodo === 'PUT' && caminho === '/api/strava/app') {
    if (strava.credenciais()?.origem === 'ambiente') return json(res, 409, { erro: 'Credenciais definidas no servidor (.env).' });
    const { clientId, clientSecret } = await lerJson(req);
    strava.salvarCredenciais(clientId, clientSecret);
    return json(res, 200, { ok: true });
  }

  if (metodo === 'PUT' && caminho === '/api/saude/sono') {
    saude.registrarManual(await lerJson(req));
    return json(res, 200, montarPainel());
  }

  if (metodo === 'GET' && caminho === '/api/exportar') {
    const pacote = { formato: 'treino-do-dia/1', exportadoEm: new Date().toISOString(), arquivos: {} };
    for (const nome of ARQUIVOS_MIGRAVEIS) {
      const conteudo = store.ler(nome, undefined);
      if (conteudo !== undefined) pacote.arquivos[nome] = conteudo;
    }
    const nomeArquivo = `treino-do-dia-backup-${new Date().toISOString().slice(0, 10)}.json`;
    return enviar(res, 200, JSON.stringify(pacote), {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
    });
  }

  if (metodo === 'POST' && caminho === '/api/importar') {
    const pacote = await lerJson(req, 64 * 1024 * 1024);
    if (!pacote || pacote.formato !== 'treino-do-dia/1' || typeof pacote.arquivos !== 'object') return json(res, 400, { erro: 'Arquivo de backup inválido.' });
    const importados = [];
    for (const nome of ARQUIVOS_MIGRAVEIS) {
      if (pacote.arquivos[nome] === undefined) continue;
      store.gravar(nome, pacote.arquivos[nome]);
      importados.push(nome);
    }
    console.log(`[importacao] ${importados.join(', ')}`);
    atualizarEspelho(1000);
    return json(res, 200, { ok: true, importados, painel: montarPainel() });
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

servidor.listen(env.PORT, env.HOST, () => {
  console.log(`Treino Strava em ${env.BASE_URL} (porta ${env.PORT})${env.SOMENTE_LOCAL ? ' — acesso restrito a este aparelho' : ''}${env.DEMO ? ' — MODO DEMONSTRAÇÃO' : ''}`);
  if (env.HEALTH_WEBHOOK_TOKEN && env.HEALTH_WEBHOOK_TOKEN.length < 24) console.warn('Atenção: HEALTH_WEBHOOK_TOKEN curto. Use ao menos 24 caracteres aleatórios.');
  if (env.DEMO && !auth.protecaoAtiva()) console.warn('Atenção: sem APP_PASSWORD, o acesso está aberto (aceitável apenas em demonstração).');
  if (env.DEMO) sync.executar('demonstração');
  sync.iniciarAgenda();
  atualizarEspelho(5000);
  // Atualização periódica do espelho (o "hoje" muda à meia-noite mesmo sem novos dados).
  setInterval(() => atualizarEspelho(1000), 3 * 3600000).unref();
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    servidor.close(() => process.exit(0));
    servidor.closeIdleConnections();
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
