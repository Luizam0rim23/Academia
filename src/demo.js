'use strict';

// Gera um histórico fictício (modo DEMO=1) para avaliar o aplicativo sem conta no Strava.

function gerar(agora = Date.now()) {
  const semana = {
    1: { type: 'WeightTraining', name: 'Treino de peito e tríceps', min: 60 },
    2: { type: 'Run', name: 'Corrida leve', min: 40, km: 7, fc: 142 },
    3: { type: 'WeightTraining', name: 'Treino de musculação vespertino', min: 55 },
    4: { type: 'Run', name: 'Intervalado 6x800', min: 50, km: 9, fc: 158 },
    5: { type: 'WeightTraining', name: 'Leg day', min: 65 },
    6: { type: 'Run', name: 'Longão de sábado', min: 105, km: 18, fc: 148 },
  };
  const atividades = [];
  for (let d = 70; d >= 1; d--) {
    const data = new Date(agora - d * 86400000);
    const modelo = semana[data.getUTCDay()];
    if (!modelo || (d % 17 === 0)) continue;
    const inicio = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate(), 9, 30));
    const variacao = 0.85 + ((d * 37) % 30) / 100;
    const local = new Date(inicio.getTime() - 3 * 3600000).toISOString().replace(/\.\d+Z$/, 'Z');
    atividades.push({
      id: 900000 + d,
      name: modelo.name,
      type: modelo.type,
      sport_type: modelo.type,
      start_date: inicio.toISOString(),
      start_date_local: local,
      moving_time: Math.round(modelo.min * 60 * variacao),
      distance: modelo.km ? Math.round(modelo.km * 1000 * variacao) : 0,
      average_heartrate: modelo.fc || (modelo.type === 'WeightTraining' ? 118 : undefined),
    });
  }
  return atividades;
}

// Payload no formato dos apps de envio do Health Connect, com noite anterior curta para demonstração.
function gerarSaude(agora = Date.now()) {
  const sleep = [];
  const resting = [];
  const hrv = [];
  for (let d = 30; d >= 0; d--) {
    const dia = new Date(agora - d * 86400000);
    const fim = Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), 9, 40); // 06:40 em São Paulo
    const horas = d === 0 ? 6.3 : 6.6 + ((d * 53) % 17) / 10;
    const dur = Math.round(horas * 3600);
    const inicio = fim - (dur + 1200) * 1000;
    const fatias = [['STAGE_TYPE_LIGHT', 0.5], ['STAGE_TYPE_DEEP', 0.2], ['STAGE_TYPE_REM', 0.22], ['STAGE_TYPE_AWAKE', 0.08]];
    let t = inicio;
    const stages = fatias.map(([stage, f]) => {
      const seg = Math.round((dur + 1200) * f);
      const e = { stage, start_time: new Date(t).toISOString(), end_time: new Date(t + seg * 1000).toISOString(), duration_seconds: seg };
      t += seg * 1000;
      return e;
    });
    sleep.push({ session_end_time: new Date(fim).toISOString(), duration_seconds: dur + 1200, stages });
    resting.push({ bpm: d === 0 ? 54 : 51 + ((d * 7) % 4), time: new Date(fim + 600000).toISOString() });
    hrv.push({ rmssd_millis: d === 0 ? 49 : 55 + ((d * 11) % 9), time: new Date(fim - 3600000).toISOString() });
  }
  // Composição corporal (peso em leve queda), passos, respiração, SpO2 e o treino de hoje gravado pelo relógio.
  const weight = [], body_fat = [], lean_body_mass = [], respiratory_rate = [], oxygen_saturation = [], daily_totals = [];
  for (let d = 35; d >= 0; d -= 3) {
    const t = new Date(agora - d * 86400000).toISOString();
    weight.push({ kilograms: Number((81.2 + d * 0.012).toFixed(1)), time: t });
    body_fat.push({ percentage: Number((18.4 + d * 0.01).toFixed(1)), time: t });
    lean_body_mass.push({ kilograms: Number((66.2 + d * 0.004).toFixed(1)), time: t });
  }
  for (let d = 20; d >= 0; d--) {
    const noite = new Date(agora - d * 86400000 - 6 * 3600000).toISOString();
    respiratory_rate.push({ rate: 14.5 + ((d * 7) % 5) / 10, time: noite });
    oxygen_saturation.push({ percentage: 96 + ((d * 3) % 3), time: noite });
    const data = new Date(agora - d * 86400000).toISOString().slice(0, 10);
    if (d >= 1 && d <= 8) daily_totals.push({ date: data, steps: 5200 + ((d * 911) % 1500), distance_meters: 3900, active_calories: 310, total_calories: 2350 });
  }
  const inicioTreino = new Date(agora - 2 * 3600000);
  const exercise = [{ uuid: 'demo-forca-hoje', type: '70', name: 'strength_training', start_time: inicioTreino.toISOString(), end_time: new Date(inicioTreino.getTime() + 55 * 60000).toISOString(), duration_seconds: 3300, source: 'com.sec.android.app.shealth' }];
  return {
    timestamp: new Date(agora).toISOString(), app_version: 'demo', timezone: 'UTC', sequence: 1,
    sleep, resting_heart_rate: resting, heart_rate_variability: hrv,
    weight, body_fat, lean_body_mass, respiratory_rate, oxygen_saturation, daily_totals, exercise,
  };
}

module.exports = { gerar, gerarSaude };
