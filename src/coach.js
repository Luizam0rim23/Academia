'use strict';

// Motor de recomendação: lê o histórico do Strava e define o treino do dia.

const {
  FOCOS, DIVISOES, NOMES_DIVISAO, GRUPOS, MODELOS, SUBSTITUICOES_PERNAS,
  NOMES_INTENSIDADE, prescrever,
} = require('./exercises');

const DIA_MS = 86400000;
const HORA_MS = 3600000;
const RECUPERACAO_MIN_H = 44;   // ~48 h de recuperação por grupo muscular
const HORAS_SEM_REGISTRO = 240; // teto usado quando o grupo nunca foi treinado

// ---------------------------------------------------------------- categorias
const CATEGORIAS = {
  WeightTraining: 'forca', Workout: 'forca', Crossfit: 'forca',
  HighIntensityIntervalTraining: 'condicionamento',
  Run: 'corrida', TrailRun: 'corrida', VirtualRun: 'corrida',
  Ride: 'ciclismo', VirtualRide: 'ciclismo', MountainBikeRide: 'ciclismo', GravelRide: 'ciclismo',
  EBikeRide: 'ciclismo', EMountainBikeRide: 'ciclismo', Velomobile: 'ciclismo', Handcycle: 'ciclismo',
  Swim: 'natacao',
  Walk: 'caminhada', Hike: 'trilha',
  Yoga: 'mobilidade', Pilates: 'mobilidade',
  Rowing: 'remo', VirtualRow: 'remo', Kayaking: 'remo', Canoeing: 'remo', StandUpPaddling: 'remo',
  Elliptical: 'cardio', StairStepper: 'cardio',
  Soccer: 'esporte', Tennis: 'esporte', Padel: 'esporte', Squash: 'esporte', Badminton: 'esporte',
  Pickleball: 'esporte', TableTennis: 'esporte', Basketball: 'esporte', Volleyball: 'esporte',
  RockClimbing: 'esporte', Surfing: 'esporte',
};

const NOMES_CATEGORIA = {
  forca: 'Musculação', corrida: 'Corrida', ciclismo: 'Ciclismo', natacao: 'Natação',
  caminhada: 'Caminhada', trilha: 'Trilha', mobilidade: 'Yoga / mobilidade',
  condicionamento: 'HIIT', esporte: 'Esporte', cardio: 'Cardio', remo: 'Remo', outro: 'Outro',
};

// Carga por minuto quando não há Relative Effort nem frequência cardíaca.
const FATOR_CARGA = {
  corrida: 1.3, condicionamento: 1.3, natacao: 1.1, remo: 1.1, esporte: 1.1, trilha: 1.0,
  ciclismo: 0.9, forca: 0.9, cardio: 0.9, caminhada: 0.35, mobilidade: 0.25, outro: 0.7,
};

// Participação dos membros inferiores por modalidade.
const FATOR_PERNAS = {
  corrida: 1.0, trilha: 0.8, esporte: 0.7, condicionamento: 0.6, ciclismo: 0.6, cardio: 0.5,
  remo: 0.4, caminhada: 0.25, natacao: 0.15, mobilidade: 0, outro: 0.3,
};

const categoria = (a) => CATEGORIAS[a.sport_type] || CATEGORIAS[a.type] || 'outro';

// ---------------------------------------------------------------- datas
function partesNoFuso(instante, tz) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instante))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}

function diaLocal(instante, tz) {
  const p = partesNoFuso(instante, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

// Instante (ms UTC) correspondente a "dia às hora:00" no fuso informado.
function instanteLocal(dia, hora, tz) {
  const [y, m, d] = dia.split('-').map(Number);
  const palpite = Date.UTC(y, m - 1, d, hora, 0, 0);
  const p = partesNoFuso(palpite, tz);
  const deslocamento = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - palpite;
  return palpite - deslocamento;
}

const diasEntre = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DIA_MS);
const somarDias = (dia, n) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);

function diaDaAtividade(a, tz) {
  if (a.start_date_local) return String(a.start_date_local).slice(0, 10);
  return diaLocal(Date.parse(a.start_date), tz);
}

// ---------------------------------------------------------------- foco de treinos de força
const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const PALAVRAS_CHAVE = {
  full: ['full body', 'fullbody', 'full', 'corpo inteiro', 'corpo todo'],
  upper: ['upper', 'superior', 'superiores', 'tronco'],
  lower: ['lower', 'inferior', 'inferiores'],
  legs: ['leg', 'legs', 'leg day', 'perna', 'pernas', 'quadriceps', 'posterior', 'posteriores', 'gluteo', 'gluteos', 'agachamento', 'squat', 'panturrilha'],
  push: ['push', 'empurrar', 'peito', 'peitoral', 'chest', 'triceps', 'ombro', 'ombros', 'shoulder', 'shoulders', 'supino'],
  pull: ['pull', 'puxar', 'costas', 'back', 'biceps', 'dorsal', 'dorsais', 'remada', 'barra fixa'],
};

function detectarFoco(nome) {
  const texto = ` ${normalizar(nome).replace(/[^a-z0-9]+/g, ' ')} `;
  const achados = new Set();
  for (const [foco, palavras] of Object.entries(PALAVRAS_CHAVE)) {
    if (palavras.some((p) => texto.includes(` ${p} `))) achados.add(foco);
  }
  if (achados.has('full')) return 'full';
  if (achados.has('upper')) return 'upper';
  if (achados.has('lower')) return 'lower';
  const superiores = achados.has('push') || achados.has('pull');
  if (superiores && achados.has('legs')) return 'full';
  if (achados.has('push') && achados.has('pull')) return 'upper';
  for (const f of ['legs', 'push', 'pull']) if (achados.has(f)) return f;
  return null;
}

function divisaoEfetiva(config) {
  if (config.split !== 'auto') return config.split;
  if (config.gymDaysPerWeek <= 3) return 'full';
  if (config.gymDaysPerWeek === 4) return 'upper_lower';
  return 'ppl';
}

function proximoNaOrdem(ordem, ultimo) {
  if (!ultimo || !FOCOS[ultimo]) return ordem[0];
  const i = ordem.indexOf(ultimo);
  if (i >= 0) return ordem[(i + 1) % ordem.length];
  const usados = new Set(FOCOS[ultimo].principais);
  return ordem.find((f) => !FOCOS[f].principais.some((g) => usados.has(g))) || ordem[0];
}

// Enriquecimento: categoria, dia local e foco (marcado > nome > inferido pela rotação).
function enriquecer(atividades, marcacoes, config) {
  const ordem = DIVISOES[divisaoEfetiva(config)];
  const lista = atividades
    .map((a) => ({ ...a, _cat: categoria(a), _dia: diaDaAtividade(a, config.timezone), _inicio: Date.parse(a.start_date) }))
    .filter((a) => Number.isFinite(a._inicio))
    .sort((x, y) => x._inicio - y._inicio);
  let ultimo = null;
  for (const a of lista) {
    if (a._cat !== 'forca') continue;
    const marcado = marcacoes[String(a.id)];
    if (marcado && FOCOS[marcado]) { a._foco = marcado; a._origemFoco = 'marcado'; }
    else if (a.focus && FOCOS[a.focus]) { a._foco = a.focus; a._origemFoco = 'projetado'; }
    else {
      const detectado = detectarFoco(a.name);
      if (detectado) { a._foco = detectado; a._origemFoco = 'nome'; }
      else { a._foco = proximoNaOrdem(ordem, ultimo); a._origemFoco = 'inferido'; }
    }
    if (a._foco !== 'outro') ultimo = a._foco;
  }
  return lista;
}

// ---------------------------------------------------------------- carga
function carga(a, config) {
  if (Number(a.suffer_score) > 0) return Number(a.suffer_score);
  const minutos = (Number(a.moving_time) || Number(a.elapsed_time) || 0) / 60;
  const cat = a._cat || categoria(a);
  const fc = Number(a.average_heartrate);
  if (fc && config.maxHr && config.maxHr > config.restHr) {
    const r = Math.min(1, Math.max(0, (fc - config.restHr) / (config.maxHr - config.restHr)));
    return minutos * r * 0.64 * Math.exp(1.92 * r);
  }
  return minutos * (FATOR_CARGA[cat] ?? 0.7);
}

function fatorPernas(a) {
  if (a._cat === 'forca') return FOCOS[a._foco]?.pernas ?? 0.3;
  return FATOR_PERNAS[a._cat] ?? 0.3;
}

function ehLongaDePernas(a) {
  const min = (Number(a.moving_time) || 0) / 60;
  if (a._cat === 'corrida') return min >= 70 || Number(a.distance) >= 12000;
  if (a._cat === 'ciclismo' || a._cat === 'trilha') return min >= 120;
  return false;
}

// ---------------------------------------------------------------- métricas
function calcularMetricas(lista, config, ref) {
  const hoje = diaLocal(ref, config.timezone);
  const itens = [];
  let historicoDias = 0;
  for (const a of lista) {
    const diasAtras = diasEntre(hoje, a._dia);
    if (diasAtras < 0) continue;
    historicoDias = Math.max(historicoDias, diasAtras);
    if (diasAtras > 42) continue;
    itens.push({ ...a, diasAtras, horasAtras: Math.max(0, (ref - a._inicio) / HORA_MS), carga: carga(a, config) });
  }

  const diario = Array.from({ length: 28 }, (_, i) => ({ dia: somarDias(hoje, -i), carga: 0, categorias: [] }));
  for (const a of itens) {
    if (a.diasAtras >= 28) continue;
    const d = diario[a.diasAtras];
    d.carga += a.carga;
    if (!d.categorias.includes(a._cat)) d.categorias.push(a._cat);
  }
  const soma = (de, ate) => diario.slice(de, ate).reduce((s, d) => s + d.carga, 0);
  const aguda = soma(0, 7);
  const cronica = soma(0, 28) / 4;
  const acwr = cronica > 0 ? aguda / cronica : null;

  const significativo = (d) => d.carga >= 20;
  let consecutivos = 0;
  for (let i = significativo(diario[0]) ? 0 : 1; i < 28 && significativo(diario[i]); i++) consecutivos++;

  let fadigaPernas = 0;
  for (const a of itens) {
    if (a.horasAtras > 96) continue;
    fadigaPernas += a.carga * fatorPernas(a) * Math.exp(-a.horasAtras / 30);
  }
  const nivelPernas = fadigaPernas >= 45 ? 'alta' : fadigaPernas >= 25 ? 'moderada' : 'baixa';

  const forca = itens.filter((a) => a._cat === 'forca');
  const gruposHoras = {};
  for (const g of Object.keys(GRUPOS)) gruposHoras[g] = null;
  for (const a of forca) {
    for (const g of FOCOS[a._foco]?.grupos || []) {
      if (gruposHoras[g] === null || a.horasAtras < gruposHoras[g]) gruposHoras[g] = a.horasAtras;
    }
  }

  const contagemFoco = {};
  for (const a of lista) if (a._cat === 'forca' && diasEntre(hoje, a._dia) > 0) contagemFoco[a._foco] = (contagemFoco[a._foco] || 0) + 1;

  // Padrão semanal: treino longo de pernas costuma ocorrer no dia seguinte?
  const longosAmanha = itens.filter((a) => [6, 13, 20, 27].includes(a.diasAtras) && ehLongaDePernas(a));
  const semanasLongas = new Set(longosAmanha.map((a) => a.diasAtras)).size;

  return {
    hoje,
    ref,
    historicoDias,
    diario,
    aguda,
    cronica,
    acwr,
    acwrConfiavel: historicoDias >= 21 && cronica >= 30,
    consecutivos,
    cargaOntem: diario[1].carga,
    cargaHoje: diario[0].carga,
    mediaDiaria: soma(0, 28) / 28,
    fadigaPernas,
    nivelPernas,
    gruposHoras,
    forcaHoje: forca.filter((a) => a.diasAtras === 0),
    sessoesForca7d: forca.filter((a) => a.diasAtras <= 6).length,
    ultimaForcaDias: forca.length ? Math.min(...forca.map((a) => a.diasAtras)) : null,
    ultimoFoco: forca.length ? forca[forca.length - 1]._foco : null,
    contagemFoco,
    amanhaLongo: semanasLongas >= 2,
    itens,
  };
}

// ---------------------------------------------------------------- decisão
const fmtHoras = (h) => (h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} dias`);
const fmtNum = (n, c = 2) => n.toFixed(c).replace('.', ',');

function avaliarFoco(foco, m) {
  const def = FOCOS[foco];
  const horas = def.principais.map((g) => (m.gruposHoras[g] === null ? HORAS_SEM_REGISTRO : Math.min(m.gruposHoras[g], HORAS_SEM_REGISTRO)));
  const horasMin = Math.min(...horas);
  let descanso = horas.reduce((s, h) => s + h, 0) / horas.length;
  let bloqueio = null;
  let pernasReduzidas = false;
  const avisos = [];

  if (horasMin < RECUPERACAO_MIN_H) {
    bloqueio = `${def.nome}: grupos principais treinados há ${fmtHoras(horasMin)} (recuperação mínima de 48 h).`;
  } else if (def.pernas >= 0.5) {
    if (m.nivelPernas === 'alta') {
      bloqueio = `${def.nome}: fadiga elevada de membros inferiores por atividades recentes (corrida, pedal ou treino de pernas).`;
    } else {
      if (m.nivelPernas === 'moderada') {
        pernasReduzidas = true;
        descanso -= 48;
        avisos.push('Fadiga moderada de membros inferiores: exercícios pesados de pernas substituídos e volume reduzido.');
      }
      if (m.amanhaLongo && def.pernas >= 1) {
        pernasReduzidas = true;
        descanso -= 100;
        avisos.push('Histórico indica treino longo de corrida ou pedal amanhã: pernas em versão leve para preservar o desempenho.');
      }
    }
  }
  return { foco, descanso, horasMin, bloqueio, pernasReduzidas, avisos };
}

function montarSessao(foco, variante, nivel, config, pernasReduzidas) {
  const ids = MODELOS[foco][variante];
  const exercicios = ids.map((id) => {
    if (pernasReduzidas && SUBSTITUICOES_PERNAS[id]) {
      const ex = prescrever(SUBSTITUICOES_PERNAS[id], nivel, config.goal);
      ex.obs = 'Substituto de menor impacto (fadiga de pernas).';
      return ex;
    }
    return prescrever(id, nivel, config.goal);
  });
  if (pernasReduzidas) {
    for (const ex of exercicios) if (ex.tipo === 'composto' && /agachamento|step|ponte|hip|leg/i.test(ex.nome)) ex.series = Math.max(2, ex.series - 1);
  }
  // remove duplicados gerados por substituição
  const vistos = new Set();
  const unicos = exercicios.filter((ex) => (vistos.has(ex.id) ? false : vistos.add(ex.id)));

  const minutosExercicio = (ex) => {
    if (ex.tipo === 'cardio') return parseInt(ex.reps, 10) || 20;
    if (ex.tipo === 'mobilidade') return ex.series * 1.5;
    return ex.series * (0.75 + ex.descansoSeg / 60);
  };
  const aquecimento = foco === 'descanso' ? 0 : 8;
  const total = () => aquecimento + unicos.reduce((s, ex) => s + minutosExercicio(ex), 0);
  while (total() > config.sessionMinutes && unicos.length > 4) {
    let i = unicos.map((ex) => ex.tipo).lastIndexOf('isolado');
    if (i < 0) i = unicos.length - 1;
    unicos.splice(i, 1);
  }
  return { exercicios: unicos, duracaoMin: Math.round(total() / 5) * 5 || 5 };
}

const AQUECIMENTO = {
  push: '5 min de cardio leve + rotação de ombros com elástico + 2 séries leves do primeiro exercício.',
  pull: '5 min de remo ou elíptico + ativação escapular (pull-apart com elástico) + 2 séries leves do primeiro exercício.',
  legs: '5 min de bicicleta + mobilidade de quadril e tornozelo + 2 a 3 séries progressivas do primeiro exercício.',
  lower: '5 min de bicicleta + mobilidade de quadril e tornozelo + 2 a 3 séries progressivas do primeiro exercício.',
  upper: '5 min de cardio leve + mobilidade de ombros e torácica + 2 séries leves do primeiro exercício.',
  full: '5 min de cardio leve + mobilidade geral (quadril, tornozelo, ombros) + séries leves dos dois primeiros exercícios.',
  recuperacao: 'Iniciar pelo cardio leve, mantendo conversa confortável (zona 2).',
  descanso: '',
};

const OBS_OBJETIVO = {
  hipertrofia: 'Progrida a carga quando atingir o topo da faixa de repetições em todas as séries com o RIR indicado.',
  forca: 'Nos compostos, acrescente 2,5 kg quando completar todas as séries e repetições com o RIR indicado.',
  corrida: 'Mantenha os treinos pesados de pernas a pelo menos 48 h de treinos longos ou intervalados de corrida.',
  saude: 'Priorize execução e amplitude; aumente a carga de forma gradual, sem chegar à falha.',
};

function decidir(lista, config, ref) {
  const m = calcularMetricas(lista, config, ref);
  const divisao = divisaoEfetiva(config);
  const ordem = DIVISOES[divisao];
  const motivos = [];
  const alertas = [];
  let foco = null;
  let pernasReduzidas = false;
  const pct = m.cronica > 0 ? Math.round((m.aguda / m.cronica - 1) * 100) : 0;

  // 1) Regras de descanso e recuperação
  if (m.consecutivos >= config.maxConsecutiveDays) {
    foco = 'descanso';
    motivos.push(`${m.consecutivos} dias consecutivos de atividade (limite configurado: ${config.maxConsecutiveDays}). Descanso para reduzir risco de sobrecarga.`);
  } else if (m.acwr !== null && m.acwrConfiavel && m.acwr > 1.5) {
    foco = 'recuperacao';
    motivos.push(`Carga dos últimos 7 dias ${pct}% acima da média semanal das últimas 4 semanas (relação ${fmtNum(m.acwr)}; faixa de risco acima de 1,50).`);
    alertas.push('Risco elevado de sobrecarga: evite treinos intensos até a relação aguda:crônica voltar para abaixo de 1,30.');
  } else if (m.sessoesForca7d >= config.gymDaysPerWeek) {
    foco = 'recuperacao';
    motivos.push(`Meta de ${config.gymDaysPerWeek} treinos de academia já cumprida nos últimos 7 dias (${m.sessoesForca7d} sessões).`);
  }

  // 2) Escolha do foco pela rotação e recuperação de cada grupo
  if (!foco) {
    const proximo = proximoNaOrdem(ordem, m.ultimoFoco);
    const posicao = (f) => (ordem.indexOf(f) - ordem.indexOf(proximo) + ordem.length) % ordem.length;
    const avaliados = ordem.map((f) => avaliarFoco(f, m));
    const elegiveis = avaliados.filter((a) => !a.bloqueio).sort((a, b) => b.descanso - a.descanso || posicao(a.foco) - posicao(b.foco));
    for (const a of avaliados) if (a.bloqueio) motivos.push(`Descartado — ${a.bloqueio}`);

    if (elegiveis.length) {
      const escolhido = elegiveis[0];
      foco = escolhido.foco;
      pernasReduzidas = escolhido.pernasReduzidas;
      const ref = escolhido.horasMin >= HORAS_SEM_REGISTRO ? 'sem registro recente' : `último estímulo há ${fmtHoras(escolhido.horasMin)}`;
      motivos.unshift(`Divisão ${NOMES_DIVISAO[divisao]}: ${FOCOS[foco].nome.toLowerCase()} é o foco com maior tempo de recuperação (${ref}).`);
      alertas.push(...escolhido.avisos);
    } else {
      const bloqueioPernas = avaliados.every((a) => a.bloqueio && /membros inferiores/.test(a.bloqueio));
      const superior = avaliarFoco('upper', m);
      if (bloqueioPernas && !superior.bloqueio) {
        foco = 'upper';
        motivos.unshift('Treino adaptado para membros superiores em razão da fadiga de pernas.');
      } else {
        foco = 'recuperacao';
        motivos.unshift('Nenhum grupo muscular principal está recuperado: sessão de recuperação ativa.');
      }
    }
  }

  // 3) Intensidade
  let nivel = 2;
  if (foco === 'recuperacao' || foco === 'descanso') {
    nivel = 0;
  } else {
    if (m.ultimaForcaDias === null) {
      nivel = 1;
      motivos.push('Sem treinos de academia no histórico: início com intensidade moderada.');
    } else if (m.ultimaForcaDias >= 10) {
      nivel = 1;
      motivos.push(`Último treino de academia há ${m.ultimaForcaDias} dias: sessão de readaptação com intensidade moderada.`);
    }
    if (m.acwr === null || !m.acwrConfiavel) {
      motivos.push('Histórico inferior a 3 semanas ou com pouca carga: a relação aguda:crônica ainda não é confiável.');
    } else if (m.acwr > 1.3) {
      nivel = Math.min(nivel, 1);
      motivos.push(`Relação aguda:crônica em ${fmtNum(m.acwr)} (atenção entre 1,30 e 1,50): manter cargas, sem progressão.`);
    } else if (m.acwr < 0.8) {
      motivos.push(`Relação aguda:crônica em ${fmtNum(m.acwr)}: carga recente abaixo da média, boa janela para progredir.`);
    } else {
      motivos.push(`Relação aguda:crônica em ${fmtNum(m.acwr)} (faixa ideal 0,80–1,30): progressão normal.`);
    }
    if (m.consecutivos >= 4) {
      nivel = Math.max(0, nivel - 1);
      motivos.push(`${m.consecutivos} dias consecutivos de atividade: intensidade reduzida em um nível.`);
    }
    if (m.cargaOntem > Math.max(80, 1.8 * m.mediaDiaria)) {
      nivel = Math.max(0, nivel - 1);
      motivos.push(`Carga de ontem elevada (${Math.round(m.cargaOntem)} contra média diária de ${Math.round(m.mediaDiaria)}): intensidade reduzida em um nível.`);
    }
  }

  const variante = (m.contagemFoco[foco] || 0) % 2 === 0 ? 'A' : 'B';
  const sessao = montarSessao(foco, variante, nivel, config, pernasReduzidas);
  const observacoes = [];
  if (!['recuperacao', 'descanso'].includes(foco)) {
    observacoes.push(OBS_OBJETIVO[config.goal]);
    observacoes.push(`Para leitura automática do foco, nomeie a atividade no Strava como "${FOCOS[foco].nome}".`);
  }
  if (foco === 'descanso') observacoes.push('Atividades opcionais e leves. Priorize sono, hidratação e alimentação.');

  return {
    data: m.hoje,
    foco,
    titulo: FOCOS[foco].nome,
    descricao: FOCOS[foco].descricao,
    intensidade: foco === 'descanso' ? 'Descanso' : NOMES_INTENSIDADE[nivel],
    nivel,
    variante,
    divisao,
    nomeDivisao: NOMES_DIVISAO[divisao],
    duracaoMin: sessao.duracaoMin,
    aquecimento: AQUECIMENTO[foco],
    exercicios: sessao.exercicios,
    motivos,
    alertas,
    observacoes,
    metricas: m,
  };
}

// ---------------------------------------------------------------- painel completo
function resumoMetricas(m) {
  let zona = 'indefinida';
  if (m.acwr !== null && m.acwrConfiavel) zona = m.acwr > 1.5 ? 'risco' : m.acwr > 1.3 ? 'atencao' : m.acwr < 0.8 ? 'baixa' : 'ideal';
  return {
    cargaAguda: Math.round(m.aguda),
    cargaCronica: Math.round(m.cronica),
    acwr: m.acwr === null ? null : Number(m.acwr.toFixed(2)),
    acwrConfiavel: m.acwrConfiavel,
    zonaAcwr: zona,
    consecutivos: m.consecutivos,
    fadigaPernas: Math.round(m.fadigaPernas),
    nivelPernas: m.nivelPernas,
    sessoesForca7d: m.sessoesForca7d,
    ultimaForcaDias: m.ultimaForcaDias,
    historicoDias: m.historicoDias,
    amanhaLongo: m.amanhaLongo,
    diario: m.diario.map((d) => ({ dia: d.dia, carga: Math.round(d.carga), categorias: d.categorias })).reverse(),
    grupos: Object.entries(GRUPOS).map(([id, nome]) => ({
      id, nome, horas: m.gruposHoras[id] === null ? null : Math.round(m.gruposHoras[id]),
    })),
  };
}

function sessaoProjetada(plano, ref) {
  if (plano.foco === 'descanso') return null;
  const recuperacao = plano.foco === 'recuperacao';
  return {
    id: `projecao-${ref}`,
    name: plano.titulo,
    type: recuperacao ? 'Yoga' : 'WeightTraining',
    sport_type: recuperacao ? 'Yoga' : 'WeightTraining',
    start_date: new Date(ref).toISOString(),
    moving_time: (recuperacao ? 30 : plano.duracaoMin) * 60,
    focus: recuperacao ? undefined : plano.foco,
  };
}

function construirPainel(atividades, config, marcacoes = {}, agora = Date.now()) {
  const tz = config.timezone;
  const hoje = diaLocal(agora, tz);
  const refHoje = Math.max(agora, instanteLocal(hoje, config.trainingHour, tz));
  let lista = enriquecer(atividades, marcacoes, config);

  const forcaHoje = lista.filter((a) => a._cat === 'forca' && a._dia === hoje);
  let referencia = 'hoje';
  let ref = refHoje;
  if (forcaHoje.length) {
    referencia = 'amanha';
    ref = instanteLocal(somarDias(hoje, 1), config.trainingHour, tz);
  }
  const plano = decidir(lista, config, ref);
  plano.referencia = referencia;
  plano.treinoHojeRegistrado = forcaHoje.map((a) => ({ nome: a.name, foco: a._foco }));

  // Projeção dos próximos dias (assumindo que o plano será cumprido)
  const projecao = [];
  let anterior = plano;
  let refAtual = ref;
  for (let i = 1; i <= 3; i++) {
    const s = sessaoProjetada(anterior, refAtual);
    if (s) lista = enriquecer([...lista.map(limparEnriquecimento), s], marcacoes, config);
    refAtual = instanteLocal(somarDias(diaLocal(refAtual, tz), 1), config.trainingHour, tz);
    anterior = decidir(lista, config, refAtual);
    projecao.push({ data: anterior.data, titulo: anterior.titulo, intensidade: anterior.intensidade, foco: anterior.foco });
  }

  const metricas = resumoMetricas(plano.metricas);
  delete plano.metricas;

  const recentes = enriquecer(atividades, marcacoes, config)
    .filter((a) => diasEntre(hoje, a._dia) <= 21)
    .reverse()
    .map((a) => ({
      id: String(a.id),
      data: a._dia,
      hora: String(a.start_date_local || '').slice(11, 16),
      nome: a.name,
      categoria: a._cat,
      tipo: NOMES_CATEGORIA[a._cat],
      duracaoMin: Math.round((Number(a.moving_time) || 0) / 60),
      distanciaKm: a.distance ? Number((a.distance / 1000).toFixed(1)) : null,
      carga: Math.round(carga(a, config)),
      foco: a._foco || null,
      nomeFoco: a._foco ? FOCOS[a._foco].nome : null,
      origemFoco: a._origemFoco || null,
    }));

  return { hoje, plano, projecao, metricas, recentes };
}

function limparEnriquecimento(a) {
  const copia = {};
  for (const [k, v] of Object.entries(a)) if (!k.startsWith('_')) copia[k] = v;
  return copia;
}

module.exports = {
  construirPainel,
  decidir,
  enriquecer,
  calcularMetricas,
  detectarFoco,
  divisaoEfetiva,
  categoria,
  carga,
  diaLocal,
  instanteLocal,
};
