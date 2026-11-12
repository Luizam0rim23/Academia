'use strict';

// Dados de saúde (sono, FC de repouso, VFC) recebidos do celular via Health Connect
// (apps Life Dashboard Companion ou HC Webhook) ou registrados manualmente na página.
const store = require('./store');

const RETENCAO_DIAS = 90;
const DIA_MS = 86400000;

// ---------------------------------------------------------------- datas (sem depender do coach)
function diaLocal(instante, tz) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instante))) p[type] = value;
  return `${p.year}-${p.month}-${p.day}`;
}
const somarDias = (dia, n) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);

// ---------------------------------------------------------------- armazenamento
function vazio() {
  return {
    sono: {}, fcRepouso: {}, vfc: {}, manual: {},
    spo2: {}, respiracao: {}, tempPele: {}, vo2max: {},           // séries por instante (ISO)
    corpo: { peso: {}, gordura: {}, massaMagra: {}, tmb: {} },     // composição corporal por instante (ISO)
    diario: {},                                                    // totais diários (passos, distância, calorias)
    exercicios: {},                                                // sessões de exercício do Health Connect
    ultimoRecebimento: null, origem: null,
  };
}

const RETENCAO_CORPO_DIAS = 400;

function ler() {
  const base = vazio();
  const salvo = store.ler('saude', {});
  return { ...base, ...salvo, corpo: { ...base.corpo, ...(salvo.corpo || {}) } };
}

function podar(dados, agora = Date.now()) {
  const limite = agora - RETENCAO_DIAS * DIA_MS;
  for (const chave of ['sono', 'fcRepouso', 'vfc', 'spo2', 'respiracao', 'tempPele', 'vo2max']) {
    for (const k of Object.keys(dados[chave])) if (Date.parse(k) < limite) delete dados[chave][k];
  }
  const limiteCorpo = agora - RETENCAO_CORPO_DIAS * DIA_MS;
  for (const serie of Object.values(dados.corpo)) {
    for (const k of Object.keys(serie)) if (Date.parse(k) < limiteCorpo) delete serie[k];
  }
  for (const [k, e] of Object.entries(dados.exercicios)) if (Date.parse(e.inicio) < limite) delete dados.exercicios[k];
  for (const k of Object.keys(dados.diario)) if (Date.parse(`${k}T12:00:00Z`) < limite) delete dados.diario[k];
  for (const k of Object.keys(dados.manual)) if (Date.parse(`${k}T12:00:00Z`) < limite) delete dados.manual[k];
  return dados;
}

// ---------------------------------------------------------------- estágios do sono
// Health Connect: 0 desconhecido, 1 acordado, 2 dormindo, 3 fora da cama, 4 leve, 5 profundo, 6 REM, 7 acordado na cama.
const ESTAGIOS_NUM = { 0: 'desconhecido', 1: 'acordado', 2: 'dormindo', 3: 'fora', 4: 'leve', 5: 'profundo', 6: 'rem', 7: 'acordado' };

function tipoEstagio(valor) {
  const texto = String(valor ?? '').trim();
  if (/^\d+$/.test(texto)) return ESTAGIOS_NUM[Number(texto)] || 'desconhecido';
  const s = texto.toLowerCase();
  if (/out.?of.?bed|fora/.test(s)) return 'fora';
  if (/awake|acordado|wake/.test(s)) return 'acordado';
  if (/deep|profundo/.test(s)) return 'profundo';
  if (/\brem\b|_rem$|^rem/.test(s)) return 'rem';
  if (/light|leve/.test(s)) return 'leve';
  if (/sleep|dormindo/.test(s)) return 'dormindo';
  return 'desconhecido';
}

const ACORDADO = new Set(['acordado', 'fora']);

function resumirSessao(s) {
  const fim = Date.parse(s.session_end_time || s.end_time);
  const duracao = Number(s.duration_seconds) || 0;
  if (!Number.isFinite(fim) || duracao <= 0 || duracao > 24 * 3600) return null;
  const r = { fim: new Date(fim).toISOString(), duracaoSeg: duracao, dormidoSeg: duracao, profundoSeg: 0, remSeg: 0, leveSeg: 0, acordadoSeg: 0, comEstagios: false };
  const estagios = Array.isArray(s.stages) ? s.stages : [];
  if (estagios.length) {
    r.comEstagios = true;
    r.dormidoSeg = 0;
    for (const e of estagios) {
      const seg = Number(e.duration_seconds) || Math.max(0, (Date.parse(e.end_time) - Date.parse(e.start_time)) / 1000) || 0;
      const tipo = tipoEstagio(e.stage);
      if (ACORDADO.has(tipo)) { r.acordadoSeg += seg; continue; }
      r.dormidoSeg += seg;
      if (tipo === 'profundo') r.profundoSeg += seg;
      else if (tipo === 'rem') r.remSeg += seg;
      else if (tipo === 'leve') r.leveSeg += seg;
    }
    if (r.dormidoSeg === 0) r.dormidoSeg = Math.max(0, duracao - r.acordadoSeg);
  }
  return r;
}

// ---------------------------------------------------------------- recebimento (webhook)
function registrarWebhook(payload, agora = Date.now()) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const e = new Error('Payload inválido.');
    e.status = 400;
    throw e;
  }
  const dados = ler();
  const contagem = { sono: 0, fcRepouso: 0, vfc: 0 };

  for (const s of Array.isArray(payload.sleep) ? payload.sleep : []) {
    const r = resumirSessao(s);
    if (!r) continue;
    dados.sono[r.fim] = r;
    contagem.sono++;
  }
  for (const f of Array.isArray(payload.resting_heart_rate) ? payload.resting_heart_rate : []) {
    const t = Date.parse(f.time);
    const bpm = Number(f.bpm ?? f.avg);
    if (!Number.isFinite(t) || !(bpm >= 25 && bpm <= 150)) continue;
    dados.fcRepouso[new Date(t).toISOString()] = bpm;
    contagem.fcRepouso++;
  }
  for (const v of Array.isArray(payload.heart_rate_variability) ? payload.heart_rate_variability : []) {
    const t = Date.parse(v.time);
    const ms = Number(v.rmssd_millis ?? v.heart_rate_variability_millis ?? v.avg);
    if (!Number.isFinite(t) || !(ms > 0 && ms < 400)) continue;
    dados.vfc[new Date(t).toISOString()] = ms;
    contagem.vfc++;
  }

  // Séries por instante: [chave do payload, campo, faixa válida, destino]
  const series = [
    ['oxygen_saturation', 'percentage', [70, 100], dados.spo2, 'spo2'],
    ['respiratory_rate', 'rate', [4, 40], dados.respiracao, 'respiracao'],
    ['skin_temperature', 'delta_celsius', [-5, 5], dados.tempPele, 'tempPele'],
    ['vo2_max', 'vo2_ml_per_min_per_kg', [10, 95], dados.vo2max, 'vo2max'],
    ['weight', 'kilograms', [25, 300], dados.corpo.peso, 'peso'],
    ['body_fat', 'percentage', [2, 70], dados.corpo.gordura, 'gordura'],
    ['lean_body_mass', 'kilograms', [15, 200], dados.corpo.massaMagra, 'massaMagra'],
    ['basal_metabolic_rate', 'kilocalories_per_day', [600, 5000], dados.corpo.tmb, 'tmb'],
  ];
  for (const [chave, campo, [min, max], destino, nome] of series) {
    for (const r of Array.isArray(payload[chave]) ? payload[chave] : []) {
      const t = Date.parse(r.time);
      const v = Number(r[campo] ?? r.avg);
      if (!Number.isFinite(t) || !Number.isFinite(v) || v < min || v > max) continue;
      destino[new Date(t).toISOString()] = v;
      contagem[nome] = (contagem[nome] || 0) + 1;
    }
  }

  // Totais diários (o dia corrente chega como total parcial; prevalece o maior valor).
  for (const d of Array.isArray(payload.daily_totals) ? payload.daily_totals : []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date || ''))) continue;
    const atual = dados.diario[d.date] || {};
    const maior = (a, b) => (Number.isFinite(Number(b)) ? Math.max(Number(a) || 0, Number(b)) : a);
    dados.diario[d.date] = {
      passos: maior(atual.passos, d.steps),
      distanciaM: maior(atual.distanciaM, d.distance_meters),
      calAtivas: maior(atual.calAtivas, d.active_calories),
      calTotais: maior(atual.calTotais, d.total_calories),
    };
    contagem.dias = (contagem.dias || 0) + 1;
  }

  // Sessões de exercício (relógio / Samsung Health). As gravadas pelo próprio Strava são ignoradas (já vêm pela API).
  for (const e of Array.isArray(payload.exercise) ? payload.exercise : []) {
    const inicio = Date.parse(e.start_time);
    const fim = Date.parse(e.end_time);
    if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) continue;
    if (/strava/i.test(String(e.source || ''))) continue;
    const chave = String(e.uuid || `${e.start_time}|${e.type}`).slice(0, 80);
    dados.exercicios[chave] = {
      inicio: new Date(inicio).toISOString(),
      fim: new Date(fim).toISOString(),
      duracaoSeg: Number(e.duration_seconds) > 0 ? Number(e.duration_seconds) : Math.round((fim - inicio) / 1000),
      tipo: String(e.type ?? ''),
      nome: String(e.name || '').slice(0, 60),
      titulo: String(e.title || '').slice(0, 120),
      fonte: String(e.source || '').slice(0, 80),
    };
    contagem.exercicios = (contagem.exercicios || 0) + 1;
  }

  dados.ultimoRecebimento = new Date(agora).toISOString();
  const app = payload.sequence !== undefined || payload.daily_totals !== undefined ? 'Life Dashboard Companion' : 'HC Webhook';
  dados.origem = `Health Connect (${app}${payload.app_version ? ` ${String(payload.app_version).slice(0, 20)}` : ''})`;
  store.gravar('saude', podar(dados, agora));
  return contagem;
}

// ---------------------------------------------------------------- registro manual
function registrarManual({ data, horas, qualidade }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) {
    const e = new Error('Data inválida.');
    e.status = 400;
    throw e;
  }
  const dados = ler();
  if (horas === null || horas === '' || horas === undefined) {
    delete dados.manual[data];
  } else {
    const h = Number(horas);
    if (!(h >= 0 && h <= 16)) {
      const e = new Error('Horas de sono devem estar entre 0 e 16.');
      e.status = 400;
      throw e;
    }
    const q = Number(qualidade);
    dados.manual[data] = { dormidoSeg: Math.round(h * 3600), qualidade: q >= 1 && q <= 5 ? Math.round(q) : null };
  }
  store.gravar('saude', podar(dados));
}

// ---------------------------------------------------------------- consolidação diária
// A noite é atribuída ao dia em que o sono termina (horário local).
// Sessões sobrepostas (mesma noite registrada por mais de uma fonte, ou sessão editada e reenviada)
// são consolidadas: prevalece a que tem estágios e, depois, a de maior duração. Cochilos sem sobreposição somam.
function semSobreposicao(sessoes) {
  const ordenadas = sessoes
    .map((s) => ({ ...s, _fim: Date.parse(s.fim), _inicio: Date.parse(s.fim) - s.duracaoSeg * 1000 }))
    .sort((a, b) => a._inicio - b._inicio);
  const grupos = [];
  for (const s of ordenadas) {
    const g = grupos[grupos.length - 1];
    if (g && s._inicio < g.fim) { g.itens.push(s); g.fim = Math.max(g.fim, s._fim); } else grupos.push({ fim: s._fim, itens: [s] });
  }
  return grupos.map((g) => g.itens.sort((a, b) => (b.comEstagios - a.comEstagios) || (b.duracaoSeg - a.duracaoSeg))[0]);
}

const mediana = (vs) => {
  const o = [...vs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

function porDia(dados, tz) {
  const sono = {};
  for (const s of semSobreposicao(Object.values(dados.sono))) {
    const dia = diaLocal(Date.parse(s.fim), tz);
    const d = sono[dia] || (sono[dia] = { dormidoSeg: 0, profundoSeg: 0, remSeg: 0, leveSeg: 0, sessoes: 0, comEstagios: false, origem: 'automatico' });
    d.dormidoSeg += s.dormidoSeg;
    d.profundoSeg += s.profundoSeg;
    d.remSeg += s.remSeg;
    d.leveSeg += s.leveSeg;
    d.sessoes++;
    d.comEstagios = d.comEstagios || s.comEstagios;
  }
  for (const [dia, m] of Object.entries(dados.manual)) {
    sono[dia] = { dormidoSeg: m.dormidoSeg, profundoSeg: 0, remSeg: 0, leveSeg: 0, sessoes: 1, comEstagios: false, origem: 'manual', qualidade: m.qualidade };
  }
  const agrupar = (mapa, reducao) => {
    const dias = {};
    for (const [t, v] of Object.entries(mapa)) (dias[diaLocal(Date.parse(t), tz)] ||= []).push(v);
    return Object.fromEntries(Object.entries(dias).map(([d, vs]) => [d, reducao(vs)]));
  };
  const media = (vs) => vs.reduce((a, b) => a + b, 0) / vs.length;
  const fcRepouso = agrupar(dados.fcRepouso, (vs) => Math.min(...vs));
  const vfc = agrupar(dados.vfc, media);
  // Leituras noturnas: deslocamento de 12 h para que 23h e 6h pertençam à mesma noite (dia em que ela termina).
  const agruparNoite = (mapa, reducao) => {
    const dias = {};
    for (const [t, v] of Object.entries(mapa)) (dias[diaLocal(Date.parse(t) + 12 * 3600000, tz)] ||= []).push(v);
    return Object.fromEntries(Object.entries(dias).map(([d, vs]) => [d, reducao(vs)]));
  };
  const spo2 = agruparNoite(dados.spo2 || {}, media);
  const respiracao = agruparNoite(dados.respiracao || {}, (vs) => mediana(vs));
  const tempPele = agruparNoite(dados.tempPele || {}, media);
  return { sono, fcRepouso, vfc, spo2, respiracao, tempPele };
}


// Valor do dia (ou do dia anterior) comparado com a linha de base dos 28 dias anteriores.
function comparar(serie, hoje, reducaoBase) {
  let dia = hoje;
  let valor = serie[hoje];
  if (valor === undefined) { dia = somarDias(hoje, -1); valor = serie[dia]; }
  const base = [];
  for (let i = 1; i <= 28; i++) {
    const d = somarDias(dia, -i);
    if (serie[d] !== undefined) base.push(serie[d]);
  }
  if (valor === undefined) return { valor: null, base: base.length >= 5 ? reducaoBase(base) : null, dia: null };
  return { valor, dia, base: base.length >= 5 ? reducaoBase(base) : null };
}

const fmtH = (seg) => {
  const min = Math.round(seg / 60);
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
};

// ---------------------------------------------------------------- avaliação da recuperação
function avaliar(dados, hoje, config) {
  const dias = porDia(dados, config.timezone);
  const meta = config.sleepTargetHours * 3600;
  const motivos = [];
  const alertas = [];
  let reducaoNivel = 0;
  let forcarRecuperacao = false;

  const noite = dias.sono[hoje] || null;
  const anteriores = [];
  for (let i = 1; i <= 7; i++) {
    const d = dias.sono[somarDias(hoje, -i)];
    if (d) anteriores.push(d.dormidoSeg);
  }
  const media7 = anteriores.length >= 3 ? anteriores.reduce((a, b) => a + b, 0) / anteriores.length : null;
  const debito7 = media7 === null ? null : Math.max(0, (meta - media7) * 7);

  const fc = comparar(dias.fcRepouso, hoje, mediana);
  const hrv = comparar(dias.vfc, hoje, (vs) => vs.reduce((a, b) => a + b, 0) / vs.length);
  const deltaFc = fc.valor !== null && fc.base !== null ? fc.valor - fc.base : null;
  const deltaVfc = hrv.valor !== null && hrv.base !== null ? (hrv.valor / hrv.base - 1) : null;

  // Sono da última noite
  let reducaoSono = 0;
  if (noite) {
    const h = noite.dormidoSeg / 3600;
    if (h < 5) {
      reducaoSono = 1;
      motivos.push(`Sono da última noite: ${fmtH(noite.dormidoSeg)} (abaixo de 5 h): intensidade reduzida em um nível.`);
      alertas.push('Sono muito curto: evite cargas máximas e exercícios técnicos complexos hoje.');
    } else if (h < 6) {
      reducaoSono = 1;
      motivos.push(`Sono da última noite: ${fmtH(noite.dormidoSeg)} (abaixo de 6 h): intensidade reduzida em um nível.`);
    } else if (noite.dormidoSeg < meta - 1800) {
      motivos.push(`Sono da última noite: ${fmtH(noite.dormidoSeg)}, abaixo da meta de ${fmtH(meta)}; sem ajuste isolado.`);
    } else {
      motivos.push(`Sono da última noite: ${fmtH(noite.dormidoSeg)} (meta de ${fmtH(meta)} atendida).`);
    }
    if (noite.qualidade && noite.qualidade <= 2) {
      reducaoSono = 1;
      motivos.push(`Qualidade do sono informada como ${noite.qualidade}/5: intensidade reduzida em um nível.`);
    }
  } else {
    motivos.push('Sono da última noite não recebido: recomendação calculada sem o fator sono.');
  }
  if (!reducaoSono && debito7 !== null && debito7 >= 5 * 3600) {
    reducaoSono = 1;
    motivos.push(`Débito de sono acumulado em 7 dias: ${fmtH(debito7)} (média de ${fmtH(media7)} por noite): intensidade reduzida em um nível.`);
  }
  reducaoNivel += reducaoSono;

  // Marcadores fisiológicos (FC de repouso e VFC)
  let sinaisFisiologicos = 0;
  if (deltaFc !== null) {
    if (deltaFc >= 5) {
      sinaisFisiologicos++;
      motivos.push(`FC de repouso ${Math.round(fc.valor)} bpm, ${Math.round(deltaFc)} bpm acima da linha de base (${Math.round(fc.base)} bpm): sinal de recuperação incompleta, estresse ou início de doença.`);
    } else {
      motivos.push(`FC de repouso ${Math.round(fc.valor)} bpm, dentro da linha de base (${Math.round(fc.base)} bpm).`);
    }
  }
  if (deltaVfc !== null) {
    const pct = Math.round(deltaVfc * 100);
    if (deltaVfc <= -0.15) {
      sinaisFisiologicos++;
      motivos.push(`VFC (RMSSD) ${Math.round(hrv.valor)} ms, ${Math.abs(pct)}% abaixo da linha de base (${Math.round(hrv.base)} ms): recuperação reduzida.`);
    } else {
      motivos.push(`VFC (RMSSD) ${Math.round(hrv.valor)} ms, ${pct >= 0 ? `${pct}% acima` : `${Math.abs(pct)}% abaixo`} da linha de base (${Math.round(hrv.base)} ms).`);
    }
  }
  const resp = comparar(dias.respiracao, hoje, mediana);
  const deltaResp = resp.valor !== null && resp.base !== null ? resp.valor - resp.base : null;
  if (deltaResp !== null) {
    if (deltaResp >= 2) {
      sinaisFisiologicos++;
      motivos.push(`Frequência respiratória no sono ${resp.valor.toFixed(1).replace('.', ',')} rpm, ${deltaResp.toFixed(1).replace('.', ',')} acima da linha de base: possível início de infecção ou recuperação incompleta.`);
    } else {
      motivos.push(`Frequência respiratória no sono dentro da linha de base (${resp.valor.toFixed(1).replace('.', ',')} rpm).`);
    }
  }
  const pele = dias.tempPele[hoje] ?? dias.tempPele[somarDias(hoje, -1)];
  if (pele !== undefined && pele >= 0.5) {
    sinaisFisiologicos++;
    motivos.push(`Temperatura da pele ${pele.toFixed(1).replace('.', ',')} °C acima do habitual durante o sono.`);
  }
  const spo2 = dias.spo2[hoje] ?? null;
  if (spo2 !== null && spo2 < 93) alertas.push(`Saturação de oxigênio média no sono de ${Math.round(spo2)}%. Se for recorrente ou houver sintomas, procure avaliação médica (a medição do relógio tem margem de erro).`);
  if (sinaisFisiologicos >= 1) reducaoNivel += 1;
  if (deltaFc !== null && deltaFc >= 10) alertas.push('FC de repouso muito acima do habitual. Se houver sintomas (febre, dor de garganta, mal-estar), não treine.');

  // Combinação crítica: sono ruim + marcadores alterados
  if ((noite && noite.dormidoSeg < 6 * 3600 && sinaisFisiologicos >= 1) || sinaisFisiologicos >= 2) {
    forcarRecuperacao = true;
    alertas.push('Sono insuficiente e/ou marcadores fisiológicos alterados: treino substituído por recuperação ativa.');
  }

  return {
    disponivel: Boolean(noite || media7 !== null || fc.valor !== null || hrv.valor !== null),
    sinaisFisiologicos,
    reducaoNivel: Math.min(2, reducaoNivel),
    forcarRecuperacao,
    motivos,
    alertas,
    resumo: {
      noite: noite ? { dormidoSeg: noite.dormidoSeg, profundoSeg: noite.profundoSeg, remSeg: noite.remSeg, leveSeg: noite.leveSeg, comEstagios: noite.comEstagios, origem: noite.origem, qualidade: noite.qualidade || null } : null,
      metaSeg: meta,
      media7Seg: media7 === null ? null : Math.round(media7),
      debito7Seg: debito7 === null ? null : Math.round(debito7),
      fcRepouso: fc.valor === null ? null : { valor: Math.round(fc.valor), base: fc.base === null ? null : Math.round(fc.base), dia: fc.dia },
      vfc: hrv.valor === null ? null : { valor: Math.round(hrv.valor), base: hrv.base === null ? null : Math.round(hrv.base), dia: hrv.dia },
      respiracao: resp.valor === null ? null : { valor: Number(resp.valor.toFixed(1)), base: resp.base === null ? null : Number(resp.base.toFixed(1)) },
      spo2: spo2 === null ? null : Math.round(spo2),
      historico: Array.from({ length: 14 }, (_, i) => {
        const d = somarDias(hoje, i - 13);
        return { dia: d, dormidoSeg: dias.sono[d]?.dormidoSeg ?? null };
      }),
    },
  };
}

// ---------------------------------------------------------------- sessões de exercício do relógio
function tipoStrava(e) {
  const n = `${e.nome} ${e.titulo}`.toLowerCase();
  const c = e.tipo;
  if (['70', '81', '13'].includes(c) || /strength|weight|calisthenic|lifting|muscula|gym|academia/.test(n)) return 'WeightTraining';
  if (['56', '57'].includes(c) || /running|\brun\b|corrida/.test(n)) return 'Run';
  if (['8', '9'].includes(c) || /bik|cycl|pedal|bicicleta|spinning/.test(n)) return 'Ride';
  if (c === '79' || /walk|caminhada/.test(n)) return 'Walk';
  if (c === '37' || /hik|trilha/.test(n)) return 'Hike';
  if (['73', '74'].includes(c) || /swim|nata/.test(n)) return 'Swim';
  if (['83', '48', '71'].includes(c) || /yoga|pilates|stretch|alonga/.test(n)) return 'Yoga';
  if (c === '36' || /interval|hiit/.test(n)) return 'HighIntensityIntervalTraining';
  if (c === '25' || /ellipt/.test(n)) return 'Elliptical';
  if (c === '54' || /rowing|remo/.test(n)) return 'Rowing';
  if (['68', '69'].includes(c) || /stair|escada/.test(n)) return 'StairStepper';
  return 'Other';
}

const NOMES_RELOGIO = {
  WeightTraining: 'Musculação', Run: 'Corrida', Ride: 'Ciclismo', Walk: 'Caminhada', Hike: 'Trilha', Swim: 'Natação',
  Yoga: 'Yoga / alongamento', HighIntensityIntervalTraining: 'HIIT', Elliptical: 'Elíptico', Rowing: 'Remo',
  StairStepper: 'Escada', Other: 'Exercício',
};

function localISO(instante, tz) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instante))) p[type] = value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`;
}

const sobrepoe = (a0, a1, b0, b1) => {
  const inter = Math.min(a1, b1) - Math.max(a0, b0);
  return Math.abs(a0 - b0) <= 20 * 60000 || inter >= 0.5 * Math.min(a1 - a0, b1 - b0);
};

// Converte sessões do Health Connect em atividades no formato do Strava, sem duplicar o que já veio pelo Strava.
function atividadesDoRelogio(dados, atividadesStrava, tz) {
  const strava = atividadesStrava.map((a) => {
    const i = Date.parse(a.start_date);
    return [i, i + (Number(a.elapsed_time || a.moving_time) || 0) * 1000];
  });
  const sessoes = Object.entries(dados.exercicios || {})
    .map(([chave, e]) => ({ chave, ...e, _i: Date.parse(e.inicio), _f: Date.parse(e.fim) }))
    .filter((e) => e.duracaoSeg >= 300 && !strava.some(([i, f]) => sobrepoe(e._i, e._f, i, f)))
    .sort((a, b) => b.duracaoSeg - a.duracaoSeg);
  const aceitas = [];
  for (const e of sessoes) if (!aceitas.some((x) => sobrepoe(e._i, e._f, x._i, x._f))) aceitas.push(e);
  return aceitas.map((e) => {
    const tipo = tipoStrava(e);
    return {
      id: `hc-${require('crypto').createHash('sha1').update(e.chave).digest('hex').slice(0, 12)}`,
      name: e.titulo || NOMES_RELOGIO[tipo],
      type: tipo,
      sport_type: tipo,
      start_date: e.inicio,
      start_date_local: localISO(e._i, tz),
      moving_time: e.duracaoSeg,
      elapsed_time: e.duracaoSeg,
      distance: 0,
      fonte: /shealth|samsung/i.test(e.fonte) ? 'Samsung Health' : 'Relógio',
    };
  });
}

module.exports = { ler, registrarWebhook, registrarManual, avaliar, porDia, tipoEstagio, resumirSessao, atividadesDoRelogio, mediana };
