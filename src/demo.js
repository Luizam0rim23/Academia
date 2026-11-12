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

module.exports = { gerar };
