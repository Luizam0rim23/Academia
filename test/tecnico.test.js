'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'treino-tecnico-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const saude = require('../src/saude');
const store = require('../src/store');
const tecnico = require('../src/tecnico');
const { construirPainel, instanteLocal, diaLocal } = require('../src/coach');
const { sanitizar, PADRAO } = require('../src/settings');

const TZ = 'America/Sao_Paulo';
const AGORA = instanteLocal('2026-11-12', 20, TZ);
const cfg = (extra = {}) => sanitizar(extra, PADRAO);
const iso = (diasAtras, hora) => new Date(instanteLocal(diaLocal(AGORA - diasAtras * 86400000, TZ), hora, TZ)).toISOString();

function strava(diasAtras, tipo, nome, minutos, hora = 7) {
  const dia = diaLocal(AGORA - diasAtras * 86400000, TZ);
  return { id: 7000 + diasAtras * 10 + hora, name: nome, type: tipo, sport_type: tipo, start_date: iso(diasAtras, hora), start_date_local: `${dia}T${String(hora).padStart(2, '0')}:00:00Z`, moving_time: minutos * 60, elapsed_time: minutos * 60 };
}

function montar(payload, atividades, config = cfg()) {
  store.remover('saude');
  saude.registrarWebhook(payload, AGORA);
  const dados = saude.ler();
  const todas = [...atividades, ...saude.atividadesDoRelogio(dados, atividades, config.timezone)];
  const painel = construirPainel(todas, config, {}, AGORA, dados);
  painel.tecnico = tecnico.analisar(painel, dados, config, AGORA);
  return painel;
}

test('treino de hoje gravado só pelo relógio é reconhecido e o plano passa para amanhã', () => {
  const p = montar({
    exercise: [{ uuid: 'x1', type: '70', name: 'strength_training', start_time: iso(0, 18), end_time: iso(0, 19), duration_seconds: 3600, source: 'com.sec.android.app.shealth' }],
  }, [strava(2, 'WeightTraining', 'Peito e tríceps', 60)], cfg({ split: 'ppl', gymDaysPerWeek: 5 }));
  assert.equal(p.plano.referencia, 'amanha');
  const hoje = p.recentes.find((a) => a.data === '2026-11-12');
  assert.equal(hoje.fonte, 'Samsung Health');
  assert.equal(hoje.categoria, 'forca');
  assert.ok(p.tecnico.achados.some((a) => a.titulo === 'Treino de hoje registrado' && a.texto.includes('Samsung Health')));
});

test('sessão do relógio que coincide com atividade do Strava não é duplicada; gravadas pelo Strava são ignoradas', () => {
  const p = montar({
    exercise: [
      { uuid: 'c1', type: '56', name: 'running', start_time: iso(1, 7), end_time: iso(1, 8), duration_seconds: 3600, source: 'com.sec.android.app.shealth' },
      { uuid: 'c2', type: '56', name: 'running', start_time: iso(3, 7), end_time: iso(3, 8), duration_seconds: 3600, source: 'com.strava' },
      { uuid: 'c3', type: '79', name: 'walking', start_time: iso(1, 12), end_time: new Date(Date.parse(iso(1, 12)) + 180000).toISOString(), duration_seconds: 180, source: 'com.sec.android.app.shealth' },
    ],
  }, [strava(1, 'Run', 'Corrida', 60)]);
  assert.equal(p.recentes.filter((a) => a.categoria === 'corrida').length, 1);
  assert.equal(p.recentes.filter((a) => a.categoria === 'caminhada').length, 0, 'sessões menores que 5 min são ignoradas');
});

test('hipertrofia com peso em queda gera ação sobre ingestão calórica', () => {
  // Hoje 80,0 kg; 28 dias atrás 81,2 kg (queda de 0,3 kg/semana).
  const weight = [0, 7, 14, 21, 28].map((d, i) => ({ kilograms: 80 + i * 0.3, time: iso(d, 7) }));
  const p = montar({ weight }, [strava(1, 'WeightTraining', 'Pernas', 60)], cfg({ goal: 'hipertrofia' }));
  const a = p.tecnico.achados.find((x) => x.titulo === 'Peso em queda com objetivo de ganho');
  assert.ok(a, JSON.stringify(p.tecnico.achados.map((x) => x.titulo)));
  assert.equal(a.nivel, 'acao');
  assert.match(a.texto, /128–176 g de proteína/);
  assert.ok(p.tecnico.indicadores.some((i) => i.rotulo === 'Peso' && i.valor === '80,0 kg'));
});

test('poucos passos geram ação; respiração elevada no sono reduz a intensidade', () => {
  const daily_totals = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ date: diaLocal(AGORA - d * 86400000, TZ), steps: 4000 }));
  const respiratory_rate = [];
  for (let d = 20; d >= 0; d--) respiratory_rate.push({ rate: d === 0 ? 18.5 : 15, time: iso(d, 3) });
  const p = montar({ daily_totals, respiratory_rate }, [strava(2, 'WeightTraining', 'Superiores', 60), strava(9, 'WeightTraining', 'Inferiores', 60)]);
  assert.ok(p.tecnico.achados.some((a) => a.titulo === 'Pouca atividade diária' && a.nivel === 'acao'));
  assert.ok(p.plano.motivos.some((m) => m.startsWith('Frequência respiratória no sono')));
  assert.ok(p.tecnico.achados.some((a) => a.titulo === 'Respiração no sono acima do habitual'));
});

test('resumo em texto contém plano, atividades e achados', () => {
  const p = montar({}, [strava(1, 'WeightTraining', 'Pernas', 60)]);
  assert.match(p.tecnico.resumoTexto, /RESUMO DE TREINO E SAÚDE — 2026-11-12/);
  assert.match(p.tecnico.resumoTexto, /Plano de hoje/);
  assert.match(p.tecnico.resumoTexto, /Achados do aplicativo/);
});

test('sessão genérica do relógio marcada pelo usuário passa a contar como musculação', () => {
  store.remover('saude');
  saude.registrarWebhook({ exercise: [{ uuid: 'g1', type: '0', name: 'other_workout', start_time: iso(0, 18), end_time: iso(0, 19), duration_seconds: 3600, source: 'com.sec.android.app.shealth' }] }, AGORA);
  const dados = saude.ler();
  const relogio = saude.atividadesDoRelogio(dados, [], TZ);
  const config = cfg({ split: 'ppl', gymDaysPerWeek: 5 });
  const sem = construirPainel(relogio, config, {}, AGORA, dados);
  assert.equal(sem.recentes[0].categoria, 'outro');
  assert.equal(sem.plano.referencia, 'hoje');
  const com = construirPainel(relogio, config, { [relogio[0].id]: 'pull' }, AGORA, dados);
  assert.equal(com.recentes[0].categoria, 'forca');
  assert.equal(com.recentes[0].foco, 'pull');
  assert.equal(com.plano.referencia, 'amanha');
});
