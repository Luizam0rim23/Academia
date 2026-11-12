'use strict';

// Orquestra a sincronização: execução única por vez, agenda diária e registro de estado.
const env = require('./env');
const store = require('./store');
const strava = require('./strava');
const settings = require('./settings');
const demo = require('./demo');
const { diaLocal, instanteLocal } = require('./coach');

let emAndamento = null;

function estado() {
  return store.ler('estado', { ultimaSync: null, resultado: null, erro: null });
}

function conectado() {
  return env.DEMO || Boolean(store.ler('tokens', null));
}

async function executar(origem = 'manual', opcoes = {}) {
  if (emAndamento) return emAndamento;
  emAndamento = (async () => {
    const inicio = Date.now();
    try {
      let resultado;
      if (env.DEMO) {
        const atividades = demo.gerar();
        store.gravar('atividades', atividades);
        require('./saude').registrarWebhook(demo.gerarSaude());
        resultado = { lidas: atividades.length, novas: 0, total: atividades.length };
      } else {
        resultado = await strava.sincronizar(opcoes);
      }
      store.gravar('estado', { ultimaSync: new Date().toISOString(), resultado, erro: null, origem });
      console.log(`[sync] ${origem}: ${resultado.lidas} lidas, ${resultado.novas} novas, ${resultado.total} no total (${Date.now() - inicio} ms)`);
      return { ok: true, ...resultado };
    } catch (e) {
      const anterior = estado();
      store.gravar('estado', { ...anterior, erro: e.message, erroEm: new Date().toISOString(), origem });
      console.error(`[sync] ${origem}: falha — ${e.message}`);
      return { ok: false, erro: e.message };
    } finally {
      emAndamento = null;
    }
  })();
  return emAndamento;
}

function horasDesdeUltima() {
  const { ultimaSync } = estado();
  return ultimaSync ? (Date.now() - Date.parse(ultimaSync)) / 3600000 : Infinity;
}

// Sincroniza se os dados estiverem desatualizados (usado ao abrir o painel).
async function garantirAtualizado(maxHoras = 12, limiteMs = 15000) {
  if (!conectado() || horasDesdeUltima() < maxHoras) return;
  await Promise.race([executar('abertura'), new Promise((r) => setTimeout(r, limiteMs))]);
}

function iniciarAgenda() {
  const verificar = () => {
    if (!conectado()) return;
    const cfg = settings.obter();
    const agora = Date.now();
    const agendado = instanteLocal(diaLocal(agora, cfg.timezone), cfg.syncHour, cfg.timezone);
    if (agora < agendado) return;
    const { ultimaSync, erroEm } = estado();
    if (ultimaSync && Date.parse(ultimaSync) >= agendado) return;
    // Após falha, aguarda 30 minutos antes de nova tentativa (respeita limites da API).
    if (erroEm && agora - Date.parse(erroEm) < 30 * 60000) return;
    executar('agenda diária');
  };
  setTimeout(() => {
    if (conectado() && horasDesdeUltima() > 20) executar('inicialização');
  }, 3000).unref();
  setInterval(verificar, 60000).unref();
}

module.exports = { executar, estado, conectado, garantirAtualizado, iniciarAgenda };
