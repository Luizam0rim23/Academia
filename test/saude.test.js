'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'treino-saude-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const saude = require('../src/saude');
const store = require('../src/store');
const { construirPainel, instanteLocal, diaLocal } = require('../src/coach');
const { sanitizar, PADRAO } = require('../src/settings');

const TZ = 'America/Sao_Paulo';
const AGORA = instanteLocal('2026-11-12', 8, TZ);
const cfg = (extra = {}) => sanitizar(extra, PADRAO);
const H = 3600;

// Payload no formato do HC Webhook: noites com fim às 06:30 locais.
function payload({ ultimaNoiteH = 7.5, fcHoje = 52, vfcHoje = 60, noites = 21 } = {}) {
  const sleep = [], resting_heart_rate = [], heart_rate_variability = [];
  for (let d = noites; d >= 0; d--) {
    const dia = diaLocal(AGORA - d * 86400000, TZ);
    const fim = instanteLocal(dia, 6, TZ) + 30 * 60000;
    const h = d === 0 ? ultimaNoiteH : 7.5;
    sleep.push({ session_end_time: new Date(fim).toISOString(), duration_seconds: Math.round(h * H) });
    resting_heart_rate.push({ bpm: d === 0 ? fcHoje : 52, time: new Date(fim + 600000).toISOString() });
    heart_rate_variability.push({ rmssd_millis: d === 0 ? vfcHoje : 60, time: new Date(fim - H * 1000).toISOString() });
  }
  return { timestamp: new Date(AGORA).toISOString(), app_version: '1.9.32', sleep, resting_heart_rate, heart_rate_variability };
}

function receber(p) {
  store.remover('saude');
  saude.registrarWebhook(p, AGORA);
  return saude.ler();
}

const historicoForca = () => [1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 26].map((d, i) => {
  const dia = diaLocal(AGORA - d * 86400000, TZ);
  return {
    id: 5000 + i, name: ['Superiores', 'Inferiores'][i % 2], type: 'WeightTraining',
    start_date: new Date(instanteLocal(dia, 18, TZ)).toISOString(), start_date_local: `${dia}T18:00:00Z`, moving_time: 3600,
  };
});

test('interpreta estágios do Health Connect (texto e número)', () => {
  assert.equal(saude.tipoEstagio('STAGE_TYPE_DEEP'), 'profundo');
  assert.equal(saude.tipoEstagio('REM'), 'rem');
  assert.equal(saude.tipoEstagio('AWAKE_IN_BED'), 'acordado');
  assert.equal(saude.tipoEstagio('OUT_OF_BED'), 'fora');
  assert.equal(saude.tipoEstagio(4), 'leve');
  assert.equal(saude.tipoEstagio('5'), 'profundo');
});

test('sessão com estágios desconta períodos acordado', () => {
  const r = saude.resumirSessao({
    session_end_time: '2026-11-12T09:30:00Z', duration_seconds: 8 * H,
    stages: [
      { stage: 'STAGE_TYPE_LIGHT', duration_seconds: 4 * H },
      { stage: 'STAGE_TYPE_DEEP', duration_seconds: 1.5 * H },
      { stage: 'STAGE_TYPE_REM', duration_seconds: 1.5 * H },
      { stage: 'STAGE_TYPE_AWAKE', duration_seconds: 1 * H },
    ],
  });
  assert.equal(r.dormidoSeg, 7 * H);
  assert.equal(r.profundoSeg, 1.5 * H);
});

test('webhook ignora valores inválidos e não duplica reenvios', () => {
  const p = payload();
  p.resting_heart_rate.push({ bpm: 999, time: 'x' });
  store.remover('saude');
  saude.registrarWebhook(p, AGORA);
  saude.registrarWebhook(p, AGORA);
  const d = saude.ler();
  assert.equal(Object.keys(d.sono).length, 22);
  assert.equal(Object.keys(d.fcRepouso).length, 22);
});

test('sessões sobrepostas da mesma noite não são somadas; cochilo é somado', () => {
  const dados = receber(payload());
  const fimNoite = instanteLocal('2026-11-12', 6, TZ) + 45 * 60000; // outra fonte, mesma noite
  const fimCochilo = instanteLocal('2026-11-12', 14, TZ);
  saude.registrarWebhook({ sleep: [
    { session_end_time: new Date(fimNoite).toISOString(), duration_seconds: 7 * H },
    { session_end_time: new Date(fimCochilo).toISOString(), duration_seconds: 0.5 * H },
  ] }, AGORA);
  const p = construirPainel([], cfg(), {}, AGORA, saude.ler());
  assert.ok(dados);
  assert.equal(p.recuperacao.noite.dormidoSeg, 8 * H); // 7,5 h (maior sessão) + 0,5 h de cochilo
});

test('payload inválido é rejeitado', () => {
  assert.throws(() => saude.registrarWebhook([1, 2]), /inválido/);
});

test('sono adequado e marcadores normais não alteram a intensidade', () => {
  const dados = receber(payload());
  const p = construirPainel(historicoForca(), cfg(), {}, AGORA, dados);
  assert.equal(p.plano.intensidade, 'Forte');
  assert.ok(p.plano.motivos.some((m) => m.includes('meta de 7 h 30 min atendida')));
  assert.equal(p.recuperacao.noite.dormidoSeg, 7.5 * H);
});

test('sono abaixo de 6 h reduz a intensidade em um nível', () => {
  const dados = receber(payload({ ultimaNoiteH: 5.5 }));
  const p = construirPainel(historicoForca(), cfg(), {}, AGORA, dados);
  assert.equal(p.plano.intensidade, 'Moderada');
});

test('VFC baixa reduz a intensidade', () => {
  const dados = receber(payload({ vfcHoje: 45 }));
  const p = construirPainel(historicoForca(), cfg(), {}, AGORA, dados);
  assert.equal(p.plano.intensidade, 'Moderada');
  assert.ok(p.plano.motivos.some((m) => m.startsWith('VFC')));
});

test('sono curto com FC de repouso elevada força recuperação ativa', () => {
  const dados = receber(payload({ ultimaNoiteH: 5, fcHoje: 60 }));
  const p = construirPainel(historicoForca(), cfg(), {}, AGORA, dados);
  assert.equal(p.plano.foco, 'recuperacao');
});

test('registro manual substitui o dado automático da data', () => {
  receber(payload());
  saude.registrarManual({ data: '2026-11-12', horas: 4.5, qualidade: 2 });
  const p = construirPainel(historicoForca(), cfg(), {}, AGORA, saude.ler());
  assert.equal(p.recuperacao.noite.origem, 'manual');
  assert.equal(p.recuperacao.noite.dormidoSeg, 4.5 * H);
  assert.equal(p.plano.intensidade, 'Moderada');
  assert.throws(() => saude.registrarManual({ data: '2026-11-12', horas: 30 }), /entre 0 e 16/);
});

test('sem dados de saúde a recomendação segue apenas o Strava', () => {
  const p = construirPainel(historicoForca(), cfg(), {}, AGORA, null);
  assert.equal(p.recuperacao, null);
  assert.equal(p.plano.intensidade, 'Forte');
});
