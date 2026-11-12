'use strict';

const store = require('./store');

const PADRAO = {
  gymDaysPerWeek: 4,          // meta de treinos de academia por semana
  split: 'auto',              // auto | ppl | upper_lower | full
  goal: 'hipertrofia',        // hipertrofia | forca | corrida | saude
  sessionMinutes: 60,         // duração-alvo da sessão
  trainingHour: 18,           // horário habitual do treino (hora local)
  syncHour: 5,                // horário da sincronização diária (hora local)
  maxConsecutiveDays: 6,      // dias seguidos de atividade antes de exigir descanso
  maxHr: null,                // FC máxima (opcional, melhora o cálculo de carga)
  restHr: 60,                 // FC de repouso
  timezone: 'America/Sao_Paulo',
};

const OPCOES = {
  split: ['auto', 'ppl', 'upper_lower', 'full'],
  goal: ['hipertrofia', 'forca', 'corrida', 'saude'],
};

function inteiro(v, min, max, padrao) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : padrao;
}

function fusoValido(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function sanitizar(entrada = {}, base = PADRAO) {
  const s = { ...PADRAO, ...base };
  const e = entrada || {};
  if ('gymDaysPerWeek' in e) s.gymDaysPerWeek = inteiro(e.gymDaysPerWeek, 1, 7, s.gymDaysPerWeek);
  if ('split' in e && OPCOES.split.includes(e.split)) s.split = e.split;
  if ('goal' in e && OPCOES.goal.includes(e.goal)) s.goal = e.goal;
  if ('sessionMinutes' in e) s.sessionMinutes = inteiro(e.sessionMinutes, 20, 150, s.sessionMinutes);
  if ('trainingHour' in e) s.trainingHour = inteiro(e.trainingHour, 0, 23, s.trainingHour);
  if ('syncHour' in e) s.syncHour = inteiro(e.syncHour, 0, 23, s.syncHour);
  if ('maxConsecutiveDays' in e) s.maxConsecutiveDays = inteiro(e.maxConsecutiveDays, 2, 14, s.maxConsecutiveDays);
  if ('restHr' in e) s.restHr = inteiro(e.restHr, 30, 110, s.restHr);
  if ('maxHr' in e) s.maxHr = e.maxHr === null || e.maxHr === '' ? null : inteiro(e.maxHr, 120, 230, s.maxHr);
  if ('timezone' in e && typeof e.timezone === 'string' && fusoValido(e.timezone)) s.timezone = e.timezone;
  return s;
}

function obter() {
  return sanitizar(store.ler('config', {}), PADRAO);
}

function atualizar(entrada) {
  const novo = sanitizar(entrada, obter());
  store.gravar('config', novo);
  return novo;
}

module.exports = { obter, atualizar, sanitizar, PADRAO, OPCOES };
