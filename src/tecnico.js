'use strict';

// Análise do técnico: consolida treino, recuperação, composição corporal e atividade diária
// em achados priorizados e em um resumo em texto para consulta externa.
const { porDia, mediana } = require('./saude');

const DIA_MS = 86400000;
const somarDias = (dia, n) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const fmt = (n, c = 1) => Number(n).toFixed(c).replace('.', ',');
const fmtH = (seg) => { const m = Math.round(seg / 60); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };

const OBJETIVOS = { hipertrofia: 'hipertrofia', forca: 'força', corrida: 'endurance (ciclismo/corrida)', saude: 'saúde e condicionamento' };

// Série temporal { iso: valor } → tendência linear nos últimos `dias` (kg/semana e % do valor atual por semana).
function tendencia(serie, agora, dias = 42) {
  const pontos = Object.entries(serie || {})
    .map(([t, v]) => [Date.parse(t), v])
    .filter(([t]) => Number.isFinite(t) && t >= agora - dias * DIA_MS && t <= agora + DIA_MS)
    .sort((a, b) => a[0] - b[0]);
  if (!pontos.length) return null;
  const atual = pontos[pontos.length - 1][1];
  const base = { atual, n: pontos.length, desde: null, porSemana: null, pctSemana: null };
  if (pontos.length < 3 || pontos[pontos.length - 1][0] - pontos[0][0] < 14 * DIA_MS) return base;
  const xs = pontos.map(([t]) => (t - pontos[0][0]) / (7 * DIA_MS));
  const ys = pontos.map(([, v]) => v);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const varx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const porSemana = varx ? cov / varx : 0;
  return { ...base, desde: new Date(pontos[0][0]).toISOString().slice(0, 10), porSemana, pctSemana: (porSemana / atual) * 100 };
}

// Regularidade do horário de dormir (desvio-padrão, em minutos) nas últimas 7 noites.
function regularidadeSono(dados, agora, tz) {
  const inicios = Object.values(dados.sono || {})
    .filter((s) => s.duracaoSeg >= 3 * 3600 && Date.parse(s.fim) >= agora - 7.5 * DIA_MS)
    .map((s) => {
      const inicio = Date.parse(s.fim) - s.duracaoSeg * 1000;
      const p = {};
      for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(inicio)) p[type] = value;
      const min = Number(p.hour) * 60 + Number(p.minute);
      return min < 12 * 60 ? min + 24 * 60 : min; // madrugada conta após a meia-noite
    });
  if (inicios.length < 4) return null;
  const media = inicios.reduce((a, b) => a + b, 0) / inicios.length;
  const dp = Math.sqrt(inicios.reduce((s, v) => s + (v - media) ** 2, 0) / inicios.length);
  const h = Math.floor(media / 60) % 24;
  return { desvioMin: Math.round(dp), horarioMedio: `${String(h).padStart(2, '0')}:${String(Math.round(media % 60)).padStart(2, '0')}`, noites: inicios.length };
}

function analisar(painel, saude, config, agora = Date.now()) {
  const achados = [];
  const add = (nivel, titulo, texto) => achados.push({ nivel, titulo, texto });
  const hoje = painel.hoje;
  const m = painel.metricas;
  const rec = painel.recuperacao;
  const dias = saude ? porDia(saude, config.timezone) : null;

  // 1) Treino de hoje
  const hojeAtiv = painel.recentes.filter((a) => a.data === hoje);
  const forcaHoje = hojeAtiv.filter((a) => a.categoria === 'forca');
  if (forcaHoje.length) {
    const a = forcaHoje[0];
    const inferido = a.origemFoco === 'inferido';
    add('positivo', 'Treino de hoje registrado',
      `${a.nome} (${a.duracaoMin} min, fonte: ${a.fonte}). Foco considerado: ${a.nomeFoco}${inferido ? ' — inferido pela rotação; confirme na tabela de atividades se estiver diferente' : ''}. Próximo treino recomendado: ${painel.plano.titulo} (${painel.plano.intensidade.toLowerCase()}).`);
  } else if (hojeAtiv.length) {
    add('info', 'Atividade de hoje registrada', `${hojeAtiv.map((a) => `${a.tipo} ${a.duracaoMin} min`).join(', ')}. O treino de academia recomendado já considera essa carga.`);
  }

  // 2) Aderência à meta de treinos (4 semanas)
  const sessoes28 = painel.recentesForca28 ?? null;
  if (sessoes28 !== null) {
    const meta = config.gymDaysPerWeek * 4;
    const pct = Math.round((sessoes28 / meta) * 100);
    if (pct < 60) add('acao', 'Frequência de academia abaixo da meta', `${sessoes28} de ${meta} treinos previstos nas últimas 4 semanas (${pct}%). Priorize constância: treinos mais curtos (35–40 min) contam mais que sessões longas esporádicas.`);
    else if (pct >= 90) add('positivo', 'Constância', `${sessoes28} de ${meta} treinos nas últimas 4 semanas (${pct}% da meta).`);
    else add('info', 'Frequência de academia', `${sessoes28} de ${meta} treinos nas últimas 4 semanas (${pct}% da meta).`);
  }

  // 3) Grupos musculares sem estímulo há mais de 7 dias
  const atrasados = m.grupos.filter((g) => ['peito', 'costas', 'pernas', 'ombros'].includes(g.id) && (g.horas === null || g.horas > 7 * 24));
  if (atrasados.length && m.ultimaForcaDias !== null && m.ultimaForcaDias < 10) {
    add('atencao', 'Grupos com baixa frequência', `${atrasados.map((g) => g.nome.toLowerCase()).join(', ')} sem estímulo há mais de 7 dias. Para ${OBJETIVOS[config.goal]}, o ideal é ao menos 2 estímulos por semana por grupo.`);
  }

  // 4) Carga de treino
  if (m.zonaAcwr === 'risco') add('acao', 'Pico de carga', `Relação aguda:crônica em ${fmt(m.acwr, 2)}: carga da semana muito acima do habitual. Reduza volume por 3 a 5 dias.`);
  else if (m.zonaAcwr === 'atencao') add('atencao', 'Carga elevada', `Relação aguda:crônica em ${fmt(m.acwr, 2)}. Mantenha cargas, sem progressão, até voltar para a faixa 0,80–1,30.`);

  // 5) Sono
  if (rec && rec.media7Seg !== null) {
    const falta = rec.metaSeg - rec.media7Seg;
    if (falta > 3600) add('acao', 'Sono insuficiente', `Média de ${fmtH(rec.media7Seg)} por noite nos últimos 7 dias, ${fmtH(falta)} abaixo da meta. Sono curto reduz ganho de força e massa e aumenta risco de lesão. Antecipe o horário de dormir em 30–45 min.`);
    else if (falta > 1800) add('atencao', 'Sono abaixo da meta', `Média de ${fmtH(rec.media7Seg)} por noite (meta ${fmtH(rec.metaSeg)}).`);
    else add('positivo', 'Sono adequado', `Média de ${fmtH(rec.media7Seg)} por noite nos últimos 7 dias.`);
  }
  const reg = saude ? regularidadeSono(saude, agora, config.timezone) : null;
  if (reg && reg.desvioMin > 60) add('atencao', 'Horário de dormir irregular', `Início do sono varia ±${reg.desvioMin} min em torno de ${reg.horarioMedio}. Regularidade de horário melhora a qualidade do sono e a recuperação.`);

  // 6) Marcadores de recuperação
  if (rec && rec.fcRepouso && rec.fcRepouso.base !== null && rec.fcRepouso.valor - rec.fcRepouso.base >= 5) {
    add('acao', 'FC de repouso elevada', `${rec.fcRepouso.valor} bpm contra base de ${rec.fcRepouso.base} bpm. Se persistir por 2 a 3 dias, reduza a carga da semana.`);
  }
  if (rec && rec.vfc && rec.vfc.base !== null && rec.vfc.valor / rec.vfc.base <= 0.85) {
    add('atencao', 'VFC abaixo do habitual', `${rec.vfc.valor} ms contra base de ${rec.vfc.base} ms: sistema nervoso ainda em recuperação.`);
  }
  if (rec && rec.respiracao && rec.respiracao.base !== null && rec.respiracao.valor - rec.respiracao.base >= 2) {
    add('acao', 'Respiração no sono acima do habitual', `${fmt(rec.respiracao.valor)} rpm contra base de ${fmt(rec.respiracao.base)} rpm: pode indicar início de infecção. Observe sintomas antes de treinar forte.`);
  }

  // 7) Composição corporal (balança/relógio)
  const indicadores = [];
  if (saude) {
    const peso = tendencia(saude.corpo.peso, agora);
    const gordura = tendencia(saude.corpo.gordura, agora);
    const magra = tendencia(saude.corpo.massaMagra, agora);
    const variacao = (t, un) => (t && t.porSemana !== null ? `${t.porSemana >= 0 ? '+' : ''}${fmt(t.porSemana, 2)} ${un}/sem.` : 'tendência após 14 dias');
    if (peso) indicadores.push({ rotulo: 'Peso', valor: `${fmt(peso.atual)} kg`, sub: variacao(peso, 'kg') });
    if (gordura) indicadores.push({ rotulo: 'Gordura corporal', valor: `${fmt(gordura.atual)}%`, sub: variacao(gordura, 'p.p.') });
    if (magra) indicadores.push({ rotulo: 'Massa magra', valor: `${fmt(magra.atual)} kg`, sub: variacao(magra, 'kg') });

    if (peso && peso.pctSemana !== null) {
      const p = peso.pctSemana;
      const ganhoMagra = magra && magra.porSemana !== null && magra.porSemana > 0.05;
      const proteina = `${Math.round(peso.atual * 1.6)}–${Math.round(peso.atual * 2.2)} g de proteína por dia`;
      if (['hipertrofia', 'forca'].includes(config.goal)) {
        if (p < -0.15 && !ganhoMagra) add('acao', 'Peso em queda com objetivo de ganho', `Peso caindo ${fmt(Math.abs(peso.porSemana), 2)} kg/semana. Para ${OBJETIVOS[config.goal]}, ingestão calórica provavelmente insuficiente: acrescente cerca de 250–300 kcal/dia e mantenha ${proteina}.`);
        else if (p > 0.75) add('atencao', 'Ganho de peso acelerado', `+${fmt(peso.porSemana, 2)} kg/semana (${fmt(p, 2)}%/sem.). Acima de ~0,5%/semana tende a aumentar gordura; reduza levemente o superávit.`);
        else if (p >= 0.1) add('positivo', 'Ritmo de ganho adequado', `+${fmt(peso.porSemana, 2)} kg/semana, compatível com ganho de massa. Mantenha ${proteina}.`);
        else if (ganhoMagra) add('positivo', 'Recomposição corporal', `Peso estável com massa magra subindo ${fmt(magra.porSemana, 2)} kg/semana.`);
        else add('atencao', 'Peso estável', `Sem variação relevante de peso. Para ${OBJETIVOS[config.goal]}, considere superávit leve (+150–250 kcal/dia) e ${proteina}.`);
      } else if (p > 0.4) {
        add('atencao', 'Peso em alta', `+${fmt(peso.porSemana, 2)} kg/semana. Se não for intencional, revise a ingestão calórica.`);
      }
    }
    if (gordura || magra) add('info', 'Medições de bioimpedância', 'Para comparações confiáveis, meça sempre nas mesmas condições: ao acordar, em jejum, após ir ao banheiro e antes de treinar.');

    // 8) Atividade diária (passos)
    const passos = [];
    for (let i = 1; i <= 7; i++) { const d = saude.diario[somarDias(hoje, -i)]; if (d && d.passos) passos.push(d.passos); }
    if (passos.length >= 4) {
      const media = Math.round(passos.reduce((a, b) => a + b, 0) / passos.length);
      indicadores.push({ rotulo: 'Passos (média 7 dias)', valor: media.toLocaleString('pt-BR'), sub: 'meta 7.000–10.000' });
      if (media < 6000) add('acao', 'Pouca atividade diária', `Média de ${media.toLocaleString('pt-BR')} passos/dia. Caminhadas curtas ao longo do dia (meta 7.000–8.000) melhoram recuperação, composição corporal e saúde cardiovascular sem prejudicar o treino.`);
      else if (media >= 10000) add('positivo', 'Boa atividade diária', `Média de ${media.toLocaleString('pt-BR')} passos/dia.`);
    }

    // 9) Capacidade aeróbica e oxigenação
    const vo2 = tendencia(saude.vo2max, agora, 90);
    if (vo2) indicadores.push({ rotulo: 'VO2 máx.', valor: fmt(vo2.atual), sub: 'ml/kg/min' });
    if (dias) {
      const ultimas = Object.entries(dias.spo2).filter(([d]) => d > somarDias(hoje, -8)).map(([, v]) => v);
      const spo2 = ultimas.length >= 3 ? mediana(ultimas) : NaN;
      if (Number.isFinite(spo2)) indicadores.push({ rotulo: 'SpO2 no sono (7 dias)', valor: `${Math.round(spo2)}%`, sub: spo2 < 94 ? 'abaixo do esperado' : 'normal' });
    }
  }

  // 10) Qualidade dos dados recebidos do relógio
  if (saude && saude.ultimoRecebimento) {
    if (!Object.keys(saude.exercicios || {}).length) add('atencao', 'Treinos do relógio não estão chegando', 'Nenhuma sessão de exercício do Samsung Health foi recebida. Verifique: Conexão Saúde → Permissões de apps → Samsung Health (gravar Exercício) e Life Dashboard Companion (ler Exercício); em seguida reenvie o histórico. Enquanto isso, a frequência de academia aparece subestimada.');
    const noites = dias ? Object.keys(dias.sono).filter((d) => d > somarDias(hoje, -8)).length : 0;
    if (noites > 0 && noites < 4) add('atencao', 'Histórico de sono incompleto', `Apenas ${noites} noite(s) recebida(s) nos últimos 7 dias. Use o relógio para dormir e confira a permissão de Sono do Samsung Health na Conexão Saúde.`);
  }

  if (!achados.some((a) => a.nivel === 'acao' || a.nivel === 'atencao')) add('positivo', 'Sem pontos de atenção', 'Treino, recuperação e rotina dentro do esperado. Siga o plano do dia.');

  const ordem = { acao: 0, atencao: 1, positivo: 2, info: 3 };
  achados.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
  return { achados, indicadores, resumoTexto: resumoTexto(painel, saude, config, achados, indicadores, dias) };
}

// Resumo em texto simples, para colar em uma conversa com um assistente ou profissional.
function resumoTexto(painel, saude, config, achados, indicadores, dias) {
  const l = [];
  const p = painel.plano;
  l.push(`RESUMO DE TREINO E SAÚDE — ${painel.hoje}`);
  l.push(`Objetivo: ${OBJETIVOS[config.goal]}; meta de ${config.gymDaysPerWeek} treinos/semana; divisão ${p.nomeDivisao}; sessão de ${config.sessionMinutes} min; meta de sono ${String(config.sleepTargetHours).replace('.', ',')} h.`);
  l.push('');
  l.push(`Plano ${p.referencia === 'amanha' ? 'de amanhã' : 'de hoje'}: ${p.titulo} — intensidade ${p.intensidade}, ~${p.duracaoMin} min.`);
  for (const ex of p.exercicios) l.push(`  - ${ex.nome}: ${ex.series} x ${ex.reps}${ex.rir ? `, RIR ${ex.rir}` : ''}`);
  l.push('');
  const m = painel.metricas;
  l.push(`Carga: 7 dias ${m.cargaAguda}, média semanal ${m.cargaCronica}, relação aguda:crônica ${m.acwr === null ? 'n/d' : fmt(m.acwr, 2)}; dias consecutivos ${m.consecutivos}; fadiga de pernas ${m.nivelPernas}; academia em 7 dias ${m.sessoesForca7d}.`);
  l.push('Atividades (14 dias):');
  for (const a of painel.recentes.filter((x) => x.data > somarDias(painel.hoje, -14))) {
    l.push(`  - ${a.data} ${a.tipo}: ${a.nome}, ${a.duracaoMin} min${a.distanciaKm ? `, ${fmt(a.distanciaKm)} km` : ''}${a.nomeFoco ? `, foco ${a.nomeFoco}` : ''} (${a.fonte})`);
  }
  if (dias) {
    l.push('Sono (7 noites):');
    for (let i = 6; i >= 0; i--) {
      const d = somarDias(painel.hoje, -i);
      const s = dias.sono[d];
      if (s) l.push(`  - ${d}: ${fmtH(s.dormidoSeg)}${s.comEstagios ? ` (profundo ${fmtH(s.profundoSeg)}, REM ${fmtH(s.remSeg)})` : ''}${dias.fcRepouso[d] ? `; FC repouso ${Math.round(dias.fcRepouso[d])}` : ''}${dias.vfc[d] ? `; VFC ${Math.round(dias.vfc[d])} ms` : ''}`);
    }
  }
  if (indicadores.length) l.push(`Indicadores: ${indicadores.map((i) => `${i.rotulo} ${i.valor} (${i.sub})`).join('; ')}.`);
  l.push('');
  l.push('Achados do aplicativo:');
  for (const a of achados) l.push(`  - [${a.nivel}] ${a.titulo}: ${a.texto}`);
  return l.join('\n');
}

module.exports = { analisar, tendencia, regularidadeSono };
