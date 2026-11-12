'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  let painel = null;

  // ------------------------------------------------------------ utilitários
  function el(tag, attrs, ...filhos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) n.append(f instanceof Node ? f : String(f));
    return n;
  }
  const limpar = (n) => { n.replaceChildren(); return n; };

  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const SEMANA_LONGA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const dataDe = (iso) => new Date(`${iso}T12:00:00Z`);
  const fmtData = (iso) => { const d = dataDe(iso); return `${SEMANA[d.getUTCDay()]}, ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`; };
  const fmtDataLonga = (iso) => { const d = dataDe(iso); return `${SEMANA_LONGA[d.getUTCDay()]}, ${d.getUTCDate()} de ${['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][d.getUTCMonth()]}`; };
  const fmtDescanso = (s) => (!s ? '—' : s >= 120 && s % 60 === 0 ? `${s / 60} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ''}`.trim() : `${s} s`);
  const fmtHoras = (h) => (h === null ? 'sem registro' : h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`);
  const fmtNum = (n, c = 2) => Number(n).toFixed(c).replace('.', ',');

  function fmtRelativo(iso) {
    if (!iso) return 'nunca';
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    if (min < 1440) return `há ${Math.round(min / 60)} h`;
    return `há ${Math.round(min / 1440)} dias`;
  }

  function aviso(texto, erro) {
    const a = $('aviso');
    a.textContent = texto;
    a.className = erro ? 'aviso erro' : 'aviso';
    a.hidden = !texto;
  }

  async function api(metodo, caminho, corpo) {
    const resp = await fetch(caminho, {
      method: metodo,
      headers: corpo !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      credentials: 'same-origin',
    });
    if (resp.status === 401) { location.href = '/login'; throw new Error('Sessão expirada.'); }
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok && !dados.painel) throw new Error(dados.erro || `Erro ${resp.status}`);
    return dados;
  }

  // ------------------------------------------------------------ armazenamento local (marcação de exercícios)
  const chaveProgresso = () => `treino:${painel.plano.data}:${painel.plano.foco}:${painel.plano.variante}`;
  function lerProgresso() {
    try { return new Set(JSON.parse(localStorage.getItem(chaveProgresso()) || '[]')); } catch { return new Set(); }
  }
  function gravarProgresso(set) {
    try { localStorage.setItem(chaveProgresso(), JSON.stringify([...set])); } catch { /* sem persistência local */ }
  }

  // ------------------------------------------------------------ renderização
  function renderizar(p) {
    painel = p;
    $('btn-sync').hidden = !p.conectado;
    $('btn-desconectar').hidden = !p.conectado || p.demo;
    $('form-sair').hidden = !p.protecao;
    $('atleta').textContent = p.atleta ? `Conta: ${[p.atleta.firstname, p.atleta.lastname].filter(Boolean).join(' ')}` : '';
    renderizarStatus(p);

    $('conectar').hidden = p.conectado;
    $('painel').hidden = !p.conectado;
    if (!p.conectado) { $('data-hoje').textContent = ''; return; }

    $('data-hoje').textContent = fmtDataLonga(p.hoje);
    renderizarPlano(p.plano);
    renderizarMotivos(p.plano);
    renderizarIndicadores(p.metricas, p.config);
    renderizarProjecao(p.projecao);
    renderizarGrupos(p.metricas.grupos);
    renderizarGrafico(p.metricas.diario);
    renderizarAtividades(p.recentes, p.opcoes.focos);
    preencherConfig(p.config);
  }

  function renderizarStatus(p) {
    const s = p.estadoSync || {};
    let texto = p.demo ? 'Modo demonstração' : p.conectado ? `Sincronizado ${fmtRelativo(s.ultimaSync)}` : 'Strava não conectado';
    if (p.conectado && !p.demo) texto += ` · diária às ${String(p.config.syncHour).padStart(2, '0')}h`;
    $('status-sync').textContent = texto;
    if (s.erro && p.conectado) aviso(`Última sincronização falhou: ${s.erro}`, true);
  }

  function renderizarPlano(pl) {
    $('plano-referencia').textContent = pl.referencia === 'amanha' ? `Próximo treino — ${fmtData(pl.data)}` : `Treino de hoje — ${fmtData(pl.data)}`;
    $('plano-titulo').textContent = pl.titulo;
    $('plano-descricao').textContent = pl.descricao;

    const selos = limpar($('plano-selos'));
    selos.append(el('span', { class: `selo ${pl.intensidade.toLowerCase()}` }, `Intensidade: ${pl.intensidade}`));
    selos.append(el('span', { class: 'selo' }, `Duração estimada: ${pl.duracaoMin} min`));
    if (!['recuperacao', 'descanso'].includes(pl.foco)) {
      selos.append(el('span', { class: 'selo' }, `Variação ${pl.variante}`));
      selos.append(el('span', { class: 'selo' }, pl.nomeDivisao));
    }

    const reg = $('plano-registrado');
    reg.hidden = !pl.treinoHojeRegistrado.length;
    reg.textContent = pl.treinoHojeRegistrado.length
      ? `Treino de hoje já registrado no Strava (${pl.treinoHojeRegistrado.map((t) => t.nome).join(', ')}). Abaixo, a recomendação para o próximo dia.`
      : '';

    const alertas = limpar($('plano-alertas'));
    for (const a of pl.alertas) alertas.append(el('p', { class: 'alerta' }, a));

    const aq = limpar($('plano-aquecimento'));
    aq.hidden = !pl.aquecimento;
    if (pl.aquecimento) aq.append(el('strong', {}, 'Aquecimento: '), pl.aquecimento);

    const feitos = lerProgresso();
    const corpo = limpar($('plano-exercicios'));
    pl.exercicios.forEach((ex, i) => {
      const id = `ex-${i}`;
      const linha = el('tr', { class: feitos.has(i) ? 'feito' : '' },
        el('td', {}, el('input', {
          type: 'checkbox', id, checked: feitos.has(i), 'aria-label': `Concluído: ${ex.nome}`,
          onchange: (e) => {
            const s = lerProgresso();
            if (e.target.checked) s.add(i); else s.delete(i);
            gravarProgresso(s);
            linha.classList.toggle('feito', e.target.checked);
            atualizarProgresso();
          },
        })),
        el('td', {}, el('label', { for: id }, ex.nome), ex.obs ? el('span', { class: 'obs' }, ex.obs) : null),
        el('td', { 'data-rotulo': 'Séries' }, ex.series > 1 || ex.tipo !== 'cardio' ? `${ex.series} × ${ex.reps}` : ex.reps),
        el('td', { 'data-rotulo': 'Descanso' }, fmtDescanso(ex.descansoSeg)),
        el('td', { 'data-rotulo': 'RIR' }, ex.rir || '—'),
      );
      corpo.append(linha);
    });
    atualizarProgresso();

    const obs = limpar($('plano-observacoes'));
    for (const o of pl.observacoes) obs.append(el('li', {}, o));
  }

  function atualizarProgresso() {
    const total = painel.plano.exercicios.length;
    const feitos = [...lerProgresso()].filter((i) => i < total).length;
    $('plano-progresso').textContent = `${feitos} de ${total} exercícios concluídos. RIR = repetições em reserva ao final da série.`;
  }

  function renderizarMotivos(pl) {
    const lista = limpar($('motivos'));
    for (const m of pl.motivos) {
      const descartado = m.startsWith('Descartado');
      lista.append(el('li', { class: descartado ? 'descartado' : '' }, m));
    }
  }

  function renderizarIndicadores(m, cfg) {
    const zonas = { ideal: 'faixa ideal', baixa: 'abaixo da média', atencao: 'atenção', risco: 'risco de sobrecarga', indefinida: 'histórico insuficiente' };
    const itens = [
      { rotulo: 'Carga 7 dias', valor: m.cargaAguda, sub: `média semanal: ${m.cargaCronica}` },
      { rotulo: 'Relação aguda:crônica', valor: m.acwr === null ? '—' : fmtNum(m.acwr), sub: zonas[m.zonaAcwr], classe: m.zonaAcwr },
      { rotulo: 'Fadiga de pernas', valor: m.nivelPernas.charAt(0).toUpperCase() + m.nivelPernas.slice(1), sub: `índice ${m.fadigaPernas}`, classe: `${m.nivelPernas}-fadiga` },
      { rotulo: 'Dias consecutivos', valor: m.consecutivos, sub: `limite: ${cfg.maxConsecutiveDays}` },
      { rotulo: 'Academia em 7 dias', valor: `${m.sessoesForca7d}/${cfg.gymDaysPerWeek}`, sub: 'sessões / meta' },
      { rotulo: 'Último treino de academia', valor: m.ultimaForcaDias === null ? '—' : m.ultimaForcaDias === 0 ? 'Hoje' : `${m.ultimaForcaDias} d`, sub: m.amanhaLongo ? 'treino longo previsto amanhã' : 'dias atrás' },
    ];
    const dl = limpar($('indicadores'));
    for (const i of itens) {
      dl.append(el('div', { class: `indicador ${i.classe || ''}` }, el('dt', {}, i.rotulo), el('dd', {}, String(i.valor), el('small', {}, i.sub))));
    }
  }

  function renderizarProjecao(proj) {
    const ol = limpar($('projecao'));
    for (const p of proj) ol.append(el('li', {}, el('span', {}, `${fmtData(p.data)} — ${p.titulo}`), el('span', {}, p.intensidade)));
  }

  function renderizarGrupos(grupos) {
    const ul = limpar($('grupos'));
    for (const g of grupos) {
      const pct = g.horas === null ? 100 : Math.min(100, Math.round((g.horas / 48) * 100));
      ul.append(el('li', { class: g.horas !== null && g.horas < 48 ? 'recuperando' : '' },
        el('span', {}, g.nome),
        el('span', { class: 'tempo' }, fmtHoras(g.horas)),
        el('span', { class: 'barra-grupo', 'aria-hidden': 'true' }, el('span', { style: null }, '')),
      ));
      ul.lastChild.querySelector('.barra-grupo span').style.width = `${pct}%`;
    }
  }

  function renderizarGrafico(diario) {
    const ns = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
    const L = 560, A = 170, m = { t: 8, r: 6, b: 22, l: 30 };
    const max = Math.max(50, ...diario.map((d) => d.carga));
    const escala = Math.ceil(max / 50) * 50;
    const svg = svgEl('svg', { viewBox: `0 0 ${L} ${A}`, preserveAspectRatio: 'none' });
    const ah = A - m.t - m.b, lw = (L - m.l - m.r) / diario.length;
    for (let i = 0; i <= 2; i++) {
      const v = (escala / 2) * i, y = m.t + ah - (v / escala) * ah;
      svg.append(svgEl('line', { x1: m.l, x2: L - m.r, y1: y, y2: y, class: 'grade-linha' }));
      const t = svgEl('text', { x: m.l - 4, y: y + 3, 'text-anchor': 'end', class: 'eixo' }); t.textContent = v; svg.append(t);
    }
    diario.forEach((d, i) => {
      const h = (d.carga / escala) * ah;
      const hoje = i === diario.length - 1;
      const classe = `barra${hoje ? ' hoje' : d.categorias.includes('forca') ? ' forca' : ''}`;
      const r = svgEl('rect', { x: m.l + i * lw + 1.5, y: m.t + ah - h, width: Math.max(1, lw - 3), height: Math.max(0, h), rx: 2, class: classe });
      const title = document.createElementNS(ns, 'title'); title.textContent = `${fmtData(d.dia)}: carga ${d.carga}`; r.append(title);
      svg.append(r);
      if (i % 7 === 6 || hoje) {
        const t = svgEl('text', { x: m.l + i * lw + lw / 2, y: A - 6, 'text-anchor': 'middle', class: 'eixo' });
        t.textContent = hoje ? 'hoje' : `${dataDe(d.dia).getUTCDate()}/${dataDe(d.dia).getUTCMonth() + 1}`;
        svg.append(t);
      }
    });
    const g = limpar($('grafico'));
    g.setAttribute('aria-label', `Carga diária dos últimos 28 dias; máximo de ${Math.max(...diario.map((d) => d.carga))}.`);
    g.append(svg);
    const leg = limpar($('legenda'));
    const item = (cor, texto) => { const i = el('i', {}); i.style.background = cor; return el('span', {}, i, texto); };
    leg.append(item('var(--barra-forca)', 'Dia com musculação'), item('var(--barra)', 'Outras atividades'), item('var(--barra-hoje)', 'Hoje'));
  }

  function renderizarAtividades(lista, focos) {
    const corpo = limpar($('atividades'));
    if (!lista.length) {
      corpo.append(el('tr', {}, el('td', { colspan: 7, class: 'sutil' }, 'Nenhuma atividade nos últimos 21 dias.')));
      return;
    }
    const origens = { nome: 'pelo nome', inferido: 'inferido pela rotação', marcado: 'marcado manualmente' };
    for (const a of lista) {
      let celulaFoco = el('td', { class: 'sutil vazio' }, '—');
      if (a.categoria === 'forca') {
        const sel = el('select', {
          'aria-label': `Foco de ${a.nome}`,
          onchange: async (e) => {
            try {
              e.target.disabled = true;
              renderizar(await api('PUT', '/api/foco', { id: a.id, foco: e.target.value || null }));
              aviso('Foco atualizado. Recomendação recalculada.');
            } catch (err) { aviso(err.message, true); e.target.disabled = false; }
          },
        }, el('option', { value: '' }, 'Automático'), focos.map((f) => el('option', { value: f.id, selected: a.origemFoco === 'marcado' && a.foco === f.id }, f.nome)));
        celulaFoco = el('td', { class: 'foco' }, sel, el('span', { class: 'origem' }, `${a.nomeFoco} (${origens[a.origemFoco] || ''})`));
      }
      corpo.append(el('tr', {},
        el('td', {}, `${fmtData(a.data)}${a.hora ? ` ${a.hora}` : ''}`),
        el('td', { class: 'nome' }, a.nome),
        el('td', {}, a.tipo),
        el('td', { class: 'num' }, `${a.duracaoMin} min`),
        el('td', { class: a.distanciaKm ? 'num' : 'num vazio' }, a.distanciaKm ? `${fmtNum(a.distanciaKm, 1)} km` : '—'),
        el('td', { class: 'num', 'data-rotulo': 'Carga' }, a.carga),
        celulaFoco,
      ));
    }
  }

  function preencherConfig(cfg) {
    const f = $('form-config');
    if (f.contains(document.activeElement)) return;
    for (const [k, v] of Object.entries(cfg)) if (f.elements[k]) f.elements[k].value = v === null ? '' : v;
  }

  // ------------------------------------------------------------ eventos
  $('btn-sync').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = 'Sincronizando…';
    try {
      const r = await api('POST', '/api/sync', {});
      renderizar(r.painel);
      if (r.ok) aviso(`Sincronização concluída: ${r.lidas} atividades lidas, ${r.novas} novas.`);
      else aviso(`Falha na sincronização: ${r.erro}`, true);
    } catch (err) { aviso(err.message, true); }
    b.disabled = false;
    b.textContent = 'Sincronizar agora';
  });

  $('form-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(e.currentTarget));
    try {
      document.activeElement.blur();
      renderizar(await api('PUT', '/api/config', dados));
      aviso('Configurações salvas. Recomendação recalculada.');
    } catch (err) { aviso(err.message, true); }
  });

  $('btn-desconectar').addEventListener('click', async () => {
    if (!confirm('Desconectar a conta do Strava? O acesso será revogado e as atividades armazenadas neste servidor serão apagadas.')) return;
    try { renderizar(await api('POST', '/api/desconectar', {})); aviso('Conta do Strava desconectada.'); } catch (err) { aviso(err.message, true); }
  });

  const retornoStrava = {
    ok: ['Conta do Strava conectada. Histórico sincronizado.', false],
    negado: ['Autorização cancelada no Strava.', true],
    escopo: ['É necessário autorizar a leitura das atividades (inclusive privadas) para gerar as recomendações.', true],
    estado: ['Falha de validação no retorno do Strava. Tente conectar novamente.', true],
    falha: ['Não foi possível concluir a conexão com o Strava. Verifique as credenciais do aplicativo.', true],
  };

  async function iniciar() {
    const r = new URLSearchParams(location.search).get('strava');
    $('painel').hidden = true;
    try {
      renderizar(await api('GET', '/api/painel'));
      if (r && retornoStrava[r]) aviso(...retornoStrava[r]);
      if (r) history.replaceState(null, '', '/');
    } catch (err) {
      aviso(`Não foi possível carregar o painel: ${err.message}`, true);
    }
  }

  // Atualiza ao voltar para a aba (ex.: app aberto no celular desde o dia anterior).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && painel && painel.hoje) {
      api('GET', '/api/painel').then(renderizar).catch(() => {});
    }
  });

  iniciar();
})();
