'use strict';

// Dados de saúde (sono, FC de repouso, VFC) recebidos do celular via Health Connect
// (app "HC Webhook") ou registrados manualmente na página.
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
  return { sono: {}, fcRepouso: {}, vfc: {}, manual: {}, ultimoRecebimento: null, origem: null };
}

function ler() {
  return { ...vazio(), ...store.ler('saude', {}) };
}

function podar(dados, agora = Date.now()) {
  const limite = agora - RETENCAO_DIAS * DIA_MS;
  for (const chave of ['sono', 'fcRepouso', 'vfc']) {
    for (const k of Object.keys(dados[chave])) if (Date.parse(k) < limite) delete dados[chave][k];
  }
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
    const ms = Number(v.rmssd_millis ?? v.avg);
    if (!Number.isFinite(t) || !(ms > 0 && ms < 400)) continue;
    dados.vfc[new Date(t).toISOString()] = ms;
    contagem.vfc++;
  }

  dados.ultimoRecebimento = new Date(agora).toISOString();
  dados.origem = `Health Connect${payload.app_version ? ` (HC Webhook ${String(payload.app_version).slice(0, 20)})` : ''}`;
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
  const fcRepouso = agrupar(dados.fcRepouso, (vs) => Math.min(...vs));
  const vfc = agrupar(dados.vfc, (vs) => vs.reduce((a, b) => a + b, 0) / vs.length);
  return { sono, fcRepouso, vfc };
}

const mediana = (vs) => {
  const o = [...vs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

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
  if (sinaisFisiologicos >= 1) reducaoNivel += 1;
  if (deltaFc !== null && deltaFc >= 10) alertas.push('FC de repouso muito acima do habitual. Se houver sintomas (febre, dor de garganta, mal-estar), não treine.');

  // Combinação crítica: sono ruim + marcadores alterados
  if ((noite && noite.dormidoSeg < 6 * 3600 && sinaisFisiologicos >= 1) || sinaisFisiologicos >= 2) {
    forcarRecuperacao = true;
    alertas.push('Sono insuficiente e/ou marcadores fisiológicos alterados: treino substituído por recuperação ativa.');
  }

  return {
    disponivel: Boolean(noite || media7 !== null || fc.valor !== null || hrv.valor !== null),
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
      historico: Array.from({ length: 14 }, (_, i) => {
        const d = somarDias(hoje, i - 13);
        return { dia: d, dormidoSeg: dias.sono[d]?.dormidoSeg ?? null };
      }),
    },
  };
}

module.exports = { ler, registrarWebhook, registrarManual, avaliar, porDia, tipoEstagio, resumirSessao };
