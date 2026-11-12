'use strict';

// Biblioteca de exercícios, focos de treino, divisões e regras de prescrição.

const GRUPOS = {
  peito: 'Peito',
  costas: 'Costas',
  ombros: 'Ombros',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  pernas: 'Quadríceps e posteriores',
  gluteos: 'Glúteos',
  core: 'Core',
};

// pernas: envolvimento de membros inferiores (0 = nenhum, 1 = total)
const FOCOS = {
  push: { nome: 'Empurrar', descricao: 'Peito, ombros e tríceps', grupos: ['peito', 'ombros', 'triceps'], principais: ['peito', 'ombros', 'triceps'], pernas: 0.1 },
  pull: { nome: 'Puxar', descricao: 'Costas e bíceps', grupos: ['costas', 'biceps'], principais: ['costas', 'biceps'], pernas: 0.1 },
  legs: { nome: 'Pernas', descricao: 'Quadríceps, posteriores, glúteos e panturrilhas', grupos: ['pernas', 'gluteos', 'core'], principais: ['pernas', 'gluteos'], pernas: 1 },
  upper: { nome: 'Membros superiores', descricao: 'Peito, costas, ombros e braços', grupos: ['peito', 'costas', 'ombros', 'biceps', 'triceps'], principais: ['peito', 'costas', 'ombros'], pernas: 0.1 },
  lower: { nome: 'Membros inferiores', descricao: 'Quadríceps, posteriores, glúteos e core', grupos: ['pernas', 'gluteos', 'core'], principais: ['pernas', 'gluteos'], pernas: 1 },
  full: { nome: 'Corpo inteiro', descricao: 'Principais grupos musculares em uma sessão', grupos: ['peito', 'costas', 'ombros', 'pernas', 'gluteos', 'core'], principais: ['peito', 'costas', 'pernas'], pernas: 0.5 },
  outro: { nome: 'Outro / funcional', descricao: 'Sessão não classificada', grupos: [], principais: [], pernas: 0.4 },
  recuperacao: { nome: 'Recuperação ativa', descricao: 'Mobilidade, core e cardio leve', grupos: ['core'], principais: [], pernas: 0 },
  descanso: { nome: 'Descanso', descricao: 'Dia sem treino estruturado', grupos: [], principais: [], pernas: 0 },
};

const FOCOS_MARCAVEIS = ['push', 'pull', 'legs', 'upper', 'lower', 'full', 'outro'];

const DIVISOES = {
  ppl: ['push', 'pull', 'legs'],
  upper_lower: ['upper', 'lower'],
  full: ['full'],
};

const NOMES_DIVISAO = {
  ppl: 'Empurrar / Puxar / Pernas',
  upper_lower: 'Superiores / Inferiores',
  full: 'Corpo inteiro',
};

// tipo: composto | isolado | core | mobilidade | cardio
// pesadoPernas: exercício substituído quando há fadiga de membros inferiores
const EXERCICIOS = {
  supino_reto: { nome: 'Supino reto com barra', tipo: 'composto' },
  supino_inclinado_barra: { nome: 'Supino inclinado com barra', tipo: 'composto' },
  supino_inclinado_halter: { nome: 'Supino inclinado com halteres', tipo: 'composto' },
  desenvolvimento_halter: { nome: 'Desenvolvimento com halteres', tipo: 'composto' },
  desenvolvimento_militar: { nome: 'Desenvolvimento militar com barra', tipo: 'composto' },
  crucifixo_maquina: { nome: 'Crucifixo na máquina (peck deck)', tipo: 'isolado' },
  elevacao_lateral: { nome: 'Elevação lateral com halteres', tipo: 'isolado' },
  elevacao_lateral_polia: { nome: 'Elevação lateral na polia', tipo: 'isolado' },
  triceps_corda: { nome: 'Tríceps na polia com corda', tipo: 'isolado' },
  triceps_frances: { nome: 'Tríceps francês com halter', tipo: 'isolado' },
  triceps_testa: { nome: 'Tríceps testa', tipo: 'isolado' },
  mergulho: { nome: 'Mergulho em paralelas (ou no banco)', tipo: 'composto' },
  barra_fixa: { nome: 'Barra fixa (ou puxada frontal)', tipo: 'composto' },
  puxada_frontal: { nome: 'Puxada frontal pegada aberta', tipo: 'composto' },
  remada_curvada: { nome: 'Remada curvada com barra', tipo: 'composto' },
  remada_baixa: { nome: 'Remada baixa com triângulo', tipo: 'composto' },
  remada_unilateral: { nome: 'Remada unilateral com halter', tipo: 'composto' },
  pulldown: { nome: 'Pulldown com braços estendidos', tipo: 'isolado' },
  face_pull: { nome: 'Face pull na polia', tipo: 'isolado' },
  crucifixo_inverso: { nome: 'Crucifixo inverso', tipo: 'isolado' },
  rosca_direta: { nome: 'Rosca direta com barra', tipo: 'isolado' },
  rosca_martelo: { nome: 'Rosca martelo', tipo: 'isolado' },
  rosca_scott: { nome: 'Rosca Scott', tipo: 'isolado' },
  rosca_inclinada: { nome: 'Rosca inclinada com halteres', tipo: 'isolado' },
  agachamento_livre: { nome: 'Agachamento livre', tipo: 'composto', pesadoPernas: true },
  levantamento_terra: { nome: 'Levantamento terra', tipo: 'composto', pesadoPernas: true },
  stiff: { nome: 'Stiff (levantamento terra romeno)', tipo: 'composto', pesadoPernas: true },
  leg_press: { nome: 'Leg press 45°', tipo: 'composto', pesadoPernas: true },
  agachamento_bulgaro: { nome: 'Agachamento búlgaro', tipo: 'composto', pesadoPernas: true },
  avanco: { nome: 'Avanço (passada) com halteres', tipo: 'composto', pesadoPernas: true },
  hip_thrust: { nome: 'Hip thrust', tipo: 'composto' },
  cadeira_extensora: { nome: 'Cadeira extensora', tipo: 'isolado' },
  mesa_flexora: { nome: 'Mesa flexora', tipo: 'isolado' },
  cadeira_flexora: { nome: 'Cadeira flexora', tipo: 'isolado' },
  cadeira_abdutora: { nome: 'Cadeira abdutora', tipo: 'isolado' },
  panturrilha_pe: { nome: 'Panturrilha em pé', tipo: 'isolado' },
  panturrilha_sentado: { nome: 'Panturrilha sentado', tipo: 'isolado' },
  agachamento_goblet: { nome: 'Agachamento goblet (carga leve)', tipo: 'composto' },
  ponte_gluteo: { nome: 'Ponte de glúteo', tipo: 'isolado' },
  panturrilha_excentrica: { nome: 'Panturrilha excêntrica unilateral', tipo: 'isolado' },
  step_up: { nome: 'Subida no banco (step-up) leve', tipo: 'composto' },
  prancha: { nome: 'Prancha frontal', tipo: 'core', reps: '30–45 s' },
  prancha_lateral: { nome: 'Prancha lateral', tipo: 'core', reps: '20–30 s/lado' },
  abdominal_polia: { nome: 'Abdominal na polia', tipo: 'core', reps: '12–15' },
  abdominal_infra: { nome: 'Abdominal infra (elevação de pernas)', tipo: 'core', reps: '10–15' },
  dead_bug: { nome: 'Dead bug', tipo: 'core', reps: '8–10/lado' },
  pallof: { nome: 'Pallof press', tipo: 'core', reps: '10/lado' },
  bird_dog: { nome: 'Bird dog', tipo: 'core', reps: '8–10/lado' },
  copenhagen: { nome: 'Prancha Copenhagen', tipo: 'core', reps: '15–20 s/lado' },
  mob_quadril: { nome: 'Mobilidade de quadril 90/90', tipo: 'mobilidade', reps: '60–90 s' },
  mob_toracica: { nome: 'Mobilidade torácica (rotação em quatro apoios)', tipo: 'mobilidade', reps: '8–10/lado' },
  mob_tornozelo: { nome: 'Mobilidade de tornozelo na parede', tipo: 'mobilidade', reps: '10/lado' },
  alongamento_posterior: { nome: 'Alongamento de posteriores e flexores do quadril', tipo: 'mobilidade', reps: '45–60 s/lado' },
  rolo: { nome: 'Liberação miofascial com rolo (pernas e costas)', tipo: 'mobilidade', reps: '5–8 min' },
  cardio_leve: { nome: 'Bicicleta ou elíptico em ritmo leve (zona 2)', tipo: 'cardio', reps: '20–30 min' },
  caminhada: { nome: 'Caminhada leve', tipo: 'cardio', reps: '20–40 min' },
};

const MODELOS = {
  push: {
    A: ['supino_reto', 'desenvolvimento_halter', 'supino_inclinado_halter', 'elevacao_lateral', 'triceps_corda', 'triceps_frances'],
    B: ['supino_inclinado_barra', 'desenvolvimento_militar', 'crucifixo_maquina', 'elevacao_lateral_polia', 'mergulho', 'triceps_testa'],
  },
  pull: {
    A: ['barra_fixa', 'remada_curvada', 'remada_baixa', 'face_pull', 'rosca_direta', 'rosca_martelo'],
    B: ['puxada_frontal', 'remada_unilateral', 'pulldown', 'crucifixo_inverso', 'rosca_scott', 'rosca_inclinada'],
  },
  legs: {
    A: ['agachamento_livre', 'stiff', 'leg_press', 'cadeira_extensora', 'mesa_flexora', 'panturrilha_pe', 'prancha'],
    B: ['levantamento_terra', 'agachamento_bulgaro', 'hip_thrust', 'cadeira_flexora', 'cadeira_abdutora', 'panturrilha_sentado', 'abdominal_polia'],
  },
  upper: {
    A: ['supino_reto', 'remada_curvada', 'desenvolvimento_halter', 'puxada_frontal', 'rosca_direta', 'triceps_corda'],
    B: ['supino_inclinado_halter', 'barra_fixa', 'remada_baixa', 'elevacao_lateral', 'rosca_martelo', 'triceps_frances'],
  },
  lower: {
    A: ['agachamento_livre', 'stiff', 'cadeira_extensora', 'mesa_flexora', 'panturrilha_pe', 'prancha_lateral'],
    B: ['levantamento_terra', 'leg_press', 'avanco', 'hip_thrust', 'panturrilha_sentado', 'abdominal_infra'],
  },
  full: {
    A: ['agachamento_livre', 'supino_reto', 'remada_curvada', 'desenvolvimento_halter', 'stiff', 'prancha'],
    B: ['leg_press', 'supino_inclinado_halter', 'puxada_frontal', 'hip_thrust', 'elevacao_lateral', 'abdominal_polia'],
  },
  recuperacao: {
    A: ['cardio_leve', 'mob_quadril', 'mob_toracica', 'mob_tornozelo', 'dead_bug', 'bird_dog', 'pallof', 'alongamento_posterior'],
    B: ['cardio_leve', 'rolo', 'mob_quadril', 'mob_toracica', 'prancha_lateral', 'dead_bug', 'alongamento_posterior'],
  },
  descanso: {
    A: ['caminhada', 'mob_quadril', 'mob_toracica', 'alongamento_posterior'],
    B: ['caminhada', 'rolo', 'mob_tornozelo', 'alongamento_posterior'],
  },
};

// Substituições quando há fadiga de membros inferiores.
const SUBSTITUICOES_PERNAS = {
  agachamento_livre: 'agachamento_goblet',
  levantamento_terra: 'ponte_gluteo',
  stiff: 'ponte_gluteo',
  leg_press: 'step_up',
  agachamento_bulgaro: 'step_up',
  avanco: 'step_up',
};

// Repetições e descanso (segundos) por objetivo.
const PRESCRICAO = {
  hipertrofia: { composto: { reps: '6–10', descanso: 120 }, isolado: { reps: '10–15', descanso: 75 } },
  forca: { composto: { reps: '3–5', descanso: 180 }, isolado: { reps: '8–12', descanso: 90 } },
  corrida: { composto: { reps: '5–8', descanso: 120 }, isolado: { reps: '12–15', descanso: 60 } },
  saude: { composto: { reps: '8–12', descanso: 90 }, isolado: { reps: '12–15', descanso: 60 } },
};

// Séries por intensidade: [leve, moderada, forte]
const SERIES = {
  composto: [2, 3, 4],
  isolado: [2, 3, 3],
  core: [2, 3, 3],
  mobilidade: [1, 2, 2],
  cardio: [1, 1, 1],
};

const RIR = ['3–4', '2–3', '1–2'];
const NOMES_INTENSIDADE = ['Leve', 'Moderada', 'Forte'];

function prescrever(id, nivel, objetivo) {
  const ex = EXERCICIOS[id];
  const regra = PRESCRICAO[objetivo] || PRESCRICAO.hipertrofia;
  const base = regra[ex.tipo];
  const series = SERIES[ex.tipo][nivel];
  const descanso = base ? base.descanso : ex.tipo === 'core' ? 45 : 0;
  return {
    id,
    nome: ex.nome,
    tipo: ex.tipo,
    series,
    reps: ex.reps || (base ? base.reps : ''),
    descansoSeg: descanso,
    rir: base ? RIR[nivel] : null,
    pesadoPernas: !!ex.pesadoPernas,
  };
}

module.exports = {
  GRUPOS,
  FOCOS,
  FOCOS_MARCAVEIS,
  DIVISOES,
  NOMES_DIVISAO,
  EXERCICIOS,
  MODELOS,
  SUBSTITUICOES_PERNAS,
  NOMES_INTENSIDADE,
  prescrever,
};
