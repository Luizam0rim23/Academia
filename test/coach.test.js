'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { construirPainel, detectarFoco, instanteLocal, diaLocal } = require('../src/coach');
const { sanitizar, PADRAO } = require('../src/settings');
const demo = require('../src/demo');

const TZ = 'America/Sao_Paulo';
// Quinta-feira, 12/11/2026, 08:00 em São Paulo
const AGORA = instanteLocal('2026-11-12', 8, TZ);
const cfg = (extra = {}) => sanitizar(extra, PADRAO);

let seq = 1;
function atividade(diasAtras, tipo, nome, minutos, extra = {}) {
  const dia = diaLocal(AGORA - diasAtras * 86400000, TZ);
  const hora = extra.hora ?? 7;
  const inicio = instanteLocal(dia, hora, TZ);
  return {
    id: seq++,
    name: nome,
    type: tipo,
    sport_type: tipo,
    start_date: new Date(inicio).toISOString(),
    start_date_local: `${dia}T${String(hora).padStart(2, '0')}:00:00Z`,
    moving_time: minutos * 60,
    distance: extra.km ? extra.km * 1000 : 0,
    ...extra,
  };
}

test('detecta foco pelo nome da atividade', () => {
  assert.equal(detectarFoco('Treino de Peito e Tríceps'), 'push');
  assert.equal(detectarFoco('Costas + bíceps'), 'pull');
  assert.equal(detectarFoco('LEG DAY'), 'legs');
  assert.equal(detectarFoco('Upper body'), 'upper');
  assert.equal(detectarFoco('Treino inferiores'), 'lower');
  assert.equal(detectarFoco('Peito, costas e pernas'), 'full');
  assert.equal(detectarFoco('Morning Weight Training'), null);
  assert.equal(detectarFoco('Feedback session'), null);
});

test('instanteLocal respeita o fuso horário', () => {
  assert.equal(new Date(instanteLocal('2026-11-12', 8, TZ)).toISOString(), '2026-11-12T11:00:00.000Z');
});

test('sem histórico: corpo inteiro moderado (meta de 3 dias)', () => {
  const p = construirPainel([], cfg({ gymDaysPerWeek: 3 }), {}, AGORA);
  assert.equal(p.plano.foco, 'full');
  assert.equal(p.plano.intensidade, 'Moderada');
  assert.ok(p.plano.exercicios.length >= 4);
});

test('PPL: segue a rotação pelo grupo há mais tempo sem estímulo', () => {
  const atividades = [
    atividade(5, 'WeightTraining', 'Pernas', 60),
    atividade(3, 'WeightTraining', 'Peito e tríceps', 60),
    atividade(2, 'WeightTraining', 'Costas e bíceps', 60),
  ];
  const p = construirPainel(atividades, cfg({ split: 'ppl', gymDaysPerWeek: 5 }), {}, AGORA);
  assert.equal(p.plano.foco, 'legs');
});

test('corrida longa ontem bloqueia treino de pernas', () => {
  const atividades = [
    atividade(6, 'WeightTraining', 'Peito', 60),
    atividade(5, 'WeightTraining', 'Costas', 60),
    atividade(9, 'WeightTraining', 'Pernas', 60),
    atividade(1, 'Run', 'Longão', 120, { km: 21 }),
  ];
  const p = construirPainel(atividades, cfg({ split: 'ppl', gymDaysPerWeek: 5 }), {}, AGORA);
  assert.notEqual(p.plano.foco, 'legs');
  assert.ok(['push', 'pull'].includes(p.plano.foco));
  assert.ok(p.plano.motivos.some((m) => m.includes('membros inferiores')));
});

test('dias consecutivos acima do limite exigem descanso', () => {
  const atividades = [1, 2, 3, 4, 5, 6].map((d) => atividade(d, 'Run', 'Corrida', 45, { km: 8 }));
  const p = construirPainel(atividades, cfg({ maxConsecutiveDays: 6 }), {}, AGORA);
  assert.equal(p.plano.foco, 'descanso');
});

test('treino de academia já registrado hoje: recomenda o dia seguinte', () => {
  const atividades = [atividade(0, 'WeightTraining', 'Peito e tríceps', 60, { hora: 6 })];
  const p = construirPainel(atividades, cfg({ split: 'ppl', gymDaysPerWeek: 5 }), {}, AGORA);
  assert.equal(p.plano.referencia, 'amanha');
  assert.equal(p.plano.data, '2026-11-13');
  assert.notEqual(p.plano.foco, 'push');
});

test('marcação manual prevalece sobre o nome', () => {
  const a = atividade(1, 'WeightTraining', 'Treino de musculação', 60);
  const p = construirPainel([a], cfg({ split: 'ppl', gymDaysPerWeek: 5 }), { [a.id]: 'pull' }, AGORA);
  const r = p.recentes.find((x) => x.id === String(a.id));
  assert.equal(r.foco, 'pull');
  assert.equal(r.origemFoco, 'marcado');
  assert.notEqual(p.plano.foco, 'pull');
});

test('pico de carga (ACWR > 1,5) leva a recuperação ativa', () => {
  const atividades = [];
  for (let d = 8; d <= 30; d += 3) atividades.push(atividade(d, 'Run', 'Leve', 30, { km: 5 }));
  for (let d = 1; d <= 4; d++) atividades.push(atividade(d, 'Run', 'Forte', 90, { km: 16 }));
  const p = construirPainel(atividades, cfg(), {}, AGORA);
  assert.ok(p.metricas.acwr > 1.5);
  assert.equal(p.plano.foco, 'recuperacao');
});

test('respeita a duração-alvo da sessão', () => {
  const p = construirPainel([], cfg({ gymDaysPerWeek: 5, sessionMinutes: 35 }), {}, AGORA);
  assert.ok(p.plano.exercicios.length >= 4);
  assert.ok(p.plano.exercicios.length < 6);
});

test('histórico de demonstração gera painel completo', () => {
  const p = construirPainel(demo.gerar(AGORA), cfg(), {}, AGORA);
  assert.equal(p.metricas.diario.length, 28);
  assert.equal(p.projecao.length, 3);
  assert.ok(p.plano.motivos.length > 0);
  assert.ok(p.recentes.length > 0);
});

test('configurações inválidas são descartadas', () => {
  const c = sanitizar({ gymDaysPerWeek: 99, split: 'xyz', timezone: 'Lua/Base', maxHr: '' });
  assert.equal(c.gymDaysPerWeek, PADRAO.gymDaysPerWeek);
  assert.equal(c.split, 'auto');
  assert.equal(c.timezone, PADRAO.timezone);
  assert.equal(c.maxHr, null);
});
