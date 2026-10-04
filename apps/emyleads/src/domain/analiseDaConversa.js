/**
 * O botão "Analisar conversa" (migration 20261002100000): as contas e os
 * textos que a tela mostra, fora do componente para serem testados.
 *
 * Quem analisa é o Agente Analista na VPS (o Claude numa segunda conta). O
 * banco guarda o pedido, o crédito e o resultado; a tela só pede, acompanha,
 * aplica as sugestões que o dono aceitar e salva na ficha.
 */

// Desde 04/10/2026 (migration 20261010100000): Atendimento (o vendedor), Lead
// (se o lead vale a pena) e Completa (os dois e o veredito do cruzamento, 2
// créditos). "Comercial" saiu do menu; as análises comerciais antigas
// continuam abrindo com o nome delas.
export const TIPOS_DE_ANALISE = [
  {
    chave: "atendimento",
    nome: "Atendimento",
    descricao: "A gente atendeu bem? A nota do vendedor: avanço, diagnóstico, objeção, fechamento, follow-up.",
    creditos: 1,
  },
  {
    chave: "lead",
    nome: "Lead",
    descricao: "Esse lead vale a pena? A nota do lead: necessidade, intenção, prazo, quem decide, engajamento.",
    creditos: 1,
  },
  {
    chave: "completa",
    nome: "Completa",
    etiqueta: "as duas + veredito",
    descricao: "As duas notas e o cruzamento: o lead é bom e a gente está fazendo o certo com ele? Uma lista só do que fazer agora.",
    creditos: 2,
  },
];

export const NOME_DO_TIPO = {
  comercial: "Comercial",
  ...Object.fromEntries(TIPOS_DE_ANALISE.map((tipo) => [tipo.chave, tipo.nome])),
};

/** Quantos créditos o tipo usa: a Completa, 2; o resto, 1. */
export const creditosDoTipo = (chave) => TIPOS_DE_ANALISE.find((tipo) => tipo.chave === chave)?.creditos || 1;

/** O título do relatório: "Análise de atendimento", "Análise do lead", "Análise completa". */
export function tituloDaAnalise(chave) {
  if (chave === "atendimento") return "Análise de atendimento";
  if (chave === "lead") return "Análise do lead";
  if (chave === "completa") return "Análise completa";
  return "Análise comercial";
}

/** Pedido na fila ou o analista lendo: a tela continua perguntando. */
export const emAndamento = (situacao) => situacao === "pending" || situacao === "running";

const MOTIVOS = {
  analysis_account_missing: "A conta de análise ainda não foi conectada na VPS.",
  analysis_disabled: "A análise está desligada no WhatsApp desta empresa.",
  analysis_queue_full: "Há muitas análises na fila agora. Tente de novo em alguns minutos.",
  analysis_invalid_response: "O analista devolveu uma resposta fora do formato. Tente de novo.",
  expired: "A análise não terminou a tempo. Confira se o WhatsApp está conectado e tente de novo.",
  model_quota_exhausted: "O limite de uso do analista acabou por agora. Tente mais tarde.",
  model_rate_limited: "O analista está ocupado. Tente de novo em alguns minutos.",
  model_timeout: "A análise demorou demais. Tente de novo.",
  model_auth_unavailable: "A conta de análise precisa ser conectada de novo na VPS.",
};

/** O motivo de uma análise que falhou, em português. O crédito sempre volta. */
export function motivoDaFalha(codigo) {
  return MOTIVOS[codigo] || "A análise não pôde ser feita. Tente de novo.";
}

const dataCurta = (valor) => {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
};

/**
 * `{ limit, used, left, cycleStart, renewsAt }` do banco, em texto: "12 de 30
 * · renova 15/10". Limite nulo é ilimitado. Sem dados (banco antes da
 * migration), vazio.
 */
export function creditosEmTexto(creditos) {
  if (!creditos) return "";
  if (creditos.limit == null) return "Análises ilimitadas";
  const renova = dataCurta(creditos.renewsAt);
  const saldo = `${Math.max(0, Number(creditos.left) || 0)} de ${Number(creditos.limit) || 0} análises`;
  return renova ? `${saldo} · renova ${renova}` : saldo;
}

export const semCreditos = (creditos, precisa = 1) =>
  Boolean(creditos) && creditos.limit != null && (Number(creditos.left) || 0) < precisa;

/** A resposta das RPCs de pedido e de andamento, com os nomes da tela. */
export function analiseDoBanco(dados) {
  if (!dados) return null;
  return {
    id: dados.analysisId || dados.id || "",
    tipo: dados.kind || "",
    situacao: dados.status || "pending",
    motivo: dados.errorCode || dados.error_code || "",
    resultado: dados.result && Object.keys(dados.result).length ? dados.result : null,
    pedidaEm: dados.requestedAt || dados.requested_at || null,
    concluidaEm: dados.completedAt || dados.completed_at || null,
    salvaEm: dados.savedAt || dados.saved_at || null,
    creditos: dados.credits || null,
    // Analysis Schema v1: o relatório agregado (analysis.v1) que o banco monta
    // e a nota do atendimento. Na lista, a nota vem da coluna; o relatório só
    // vem pela consulta de andamento.
    relatorio: dados.report || null,
    notaDoAtendimento: dados.serviceScore ?? dados.service_score ?? null,
    // Na lista, a cobertura vem das notas gravadas (scores.atendimento).
    coberturaDoAtendimento: coberturaDaNota(dados.scores?.atendimento && {
      score: dados.scores.atendimento.score,
      evaluated_weight: dados.scores.atendimento.evaluatedWeight,
      max_weight: dados.scores.atendimento.maxWeight,
    })?.porcento ?? null,
    // A linha do tempo (20261005100000): as mensagens que o analista leu, só
    // com o instante e o lado. Vem só pela consulta de andamento.
    linhaDoTempo: dados.timeline || null,
  };
}

/**
 * Quando vence a tarefa ou o compromisso sugerido: `prazoDias` dias depois de
 * hoje, às 9h. Zero é hoje — e, se as 9h já passaram, daqui a uma hora, para
 * não nascer atrasado.
 */
export function prazoDaSugestao(prazoDias, agora = new Date()) {
  const dias = Math.max(0, Math.min(30, Number(prazoDias) || 0));
  const data = new Date(agora);
  data.setDate(data.getDate() + dias);
  data.setHours(9, 0, 0, 0);
  if (data.getTime() <= agora.getTime()) return new Date(agora.getTime() + 60 * 60 * 1000);
  return data;
}

const igual = (a, b) => String(a || "").trim().toLocaleLowerCase("pt-BR") === String(b || "").trim().toLocaleLowerCase("pt-BR");

/** A etapa do funil com o nome sugerido, ou nada. */
export const etapaPeloNome = (estagios, nome) => (estagios || []).find((etapa) => igual(etapa.nome, nome)) || null;

/** A etiqueta da empresa com o nome sugerido, ou nada (aí ela é criada). */
export const etiquetaPeloNome = (etiquetas, nome) => (etiquetas || []).find((tag) => igual(tag.nome, nome)) || null;

export const ROTULO_DA_SUGESTAO = {
  etapa: "Mover para a etapa",
  etiqueta: "Adicionar a etiqueta",
  tarefa: "Criar a tarefa",
  compromisso: "Agendar",
};

/**
 * Por que uma sugestão não pode ser aplicada agora, ou vazio se pode. O
 * analista já tira o que não cabe (etapa que não existe, tarefa sem contato),
 * mas o contato pode ter mudado desde a análise.
 */
export function impedimentoDaSugestao(sugestao, { contato, negocio, estagios, etiquetas }) {
  if (sugestao.tipo === "etapa") {
    if (!negocio) return "Sem negócio aberto com este contato.";
    const etapa = etapaPeloNome(estagios, sugestao.valor);
    if (!etapa) return "Essa etapa não existe mais no funil.";
    if (etapa.id === negocio.stageId) return "O negócio já está nesta etapa.";
    return "";
  }
  if (!contato) return "Crie o lead antes.";
  if (sugestao.tipo === "etiqueta") {
    const tag = etiquetaPeloNome(etiquetas, sugestao.valor);
    if (tag && (contato.tags || []).includes(tag.id)) return "O contato já tem esta etiqueta.";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Analysis Schema v1 (ANALYSIS_SCHEMA_V1_NUCLEO_MAJOR.md): o relatório.
// A nota vem pronta do banco; aqui só se escolhe como mostrá-la.
// ---------------------------------------------------------------------------

export const RELATORIO_V1 = "analysis_report.v1";

/** O diagnóstico no formato v1 (análises antigas seguem no formato anterior). */
export const ehRelatorioV1 = (resultado) => resultado?.schema_version === RELATORIO_V1;

export const ROTULO_DO_ESTADO = {
  bom: "Bom",
  atencao: "Atenção",
  ruim: "Ruim",
  critico: "Crítico",
  nao_avaliado: "Não avaliado",
};

export const TOM_DO_ESTADO = { bom: "success", atencao: "warning", ruim: "danger", critico: "danger", nao_avaliado: "faint" };

export const NOME_DO_CRITERIO = {
  responsiveness: "Responsividade",
  discovery: "Descoberta",
  conversation_coherence: "Coerência",
  communication_adaptation: "Adaptação",
  qualification: "Qualificação",
  playbook_adherence: "Playbook",
  next_step: "Próximo passo",
  follow_up: "Follow-up",
};

// O nome por extenso, na tabela do computador. O banco manda o nome do
// esquema ("Coerência da condução"); estes são os da tela.
export const NOME_LONGO_DO_CRITERIO = {
  responsiveness: "Responsividade",
  discovery: "Descoberta",
  conversation_coherence: "Coerência da conversa",
  communication_adaptation: "Adaptação da comunicação",
  qualification: "Qualificação",
  playbook_adherence: "Aderência ao playbook",
  next_step: "Próximo passo",
  follow_up: "Follow-up",
};

// O estado de negócio diz mais que "crítico" ou "bom" nestes dois critérios.
const ROTULO_DO_VALOR = {
  next_step: {
    ficou_em_aberto: "Ficou em aberto",
    avancou_com_acao: "Avançou",
    aguardando_acao_do_lead: "Aguardando o lead",
    desqualificado_com_motivo: "Desqualificado",
  },
  follow_up: { overdue: "Vencido", done: "Feito" },
};

export const ROTULO_DA_ACAO = {
  reply: "Usar mensagem sugerida",
  create_follow_up: "Criar follow-up",
  schedule_meeting: "Agendar",
  create_task: "Criar tarefa",
};

export const ROTULO_DA_PRIORIDADE = { alta: "Prioridade alta", media: "Prioridade média", baixa: "Prioridade baixa" };

export const ROTULO_DO_ALERTA = {
  conversation_left_open: "Conversa ficou em aberto",
  playbook_violation: "Fora do playbook",
  overdue_follow_up: "Follow-up vencido",
  repeated_communication_mismatch: "Comunicação desalinhada",
  premature_solution: "Solução precipitada",
  critical_information_ignored: "Informação importante ignorada",
};

const numeroCurto = (valor) =>
  Number.isInteger(valor) ? String(valor) : Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** "9/15", ou "—" quando o critério ainda não é avaliável (nunca zero). */
export function pontosDoCriterio(criterio) {
  if (!criterio || criterio.points_awarded == null) return "—";
  return `${numeroCurto(criterio.points_awarded)}/${numeroCurto(criterio.weight)}`;
}

/** O rótulo da nota que o banco montou; sem nota, "Ainda não avaliável". */
export function notaEmTexto(atendimento) {
  if (!atendimento || atendimento.score == null) return "Ainda não avaliável";
  return atendimento.label || `${atendimento.score}/100`;
}

/** Os critérios que mais pesaram: os que perderam pontos, do maior peso perdido. */
export function criteriosComPerda(criterios = []) {
  return criterios
    .filter((c) => c.points_awarded != null && c.points_awarded < c.weight)
    .sort((a, b) => b.weight - b.points_awarded - (a.weight - a.points_awarded));
}

const doisDigitos = (n) => String(n).padStart(2, "0");

/**
 * O prazo de uma ação para o formulário: data e hora separadas. Data sem
 * hora (o analista não inventa precisão) deixa a hora vazia, para a pessoa
 * escolher antes de salvar.
 */
export function prazoDaAcao(dueAt) {
  const texto = String(dueAt || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return { data: texto, hora: "" };
  const instante = new Date(texto);
  if (!texto || Number.isNaN(instante.getTime())) return { data: "", hora: "" };
  return {
    data: `${instante.getFullYear()}-${doisDigitos(instante.getMonth() + 1)}-${doisDigitos(instante.getDate())}`,
    hora: `${doisDigitos(instante.getHours())}:${doisDigitos(instante.getMinutes())}`,
  };
}

/** O prazo de uma ação para ler: "07/10" ou "07/10, 10:00"; sem prazo, vazio. */
export function prazoEmTexto(dueAt) {
  const { data, hora } = prazoDaAcao(dueAt);
  if (!data) return "";
  const [, mes, dia] = data.split("-");
  return hora ? `${dia}/${mes}, ${hora}` : `${dia}/${mes}`;
}

/** Data e hora do formulário num instante; incompleto, nada. */
export function instanteDoPrazo({ data, hora }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || "") || !/^\d{2}:\d{2}$/.test(hora || "")) return null;
  const instante = new Date(`${data}T${hora}:00`);
  return Number.isNaN(instante.getTime()) ? null : instante;
}

// Abaixo disto, a nota aparece esmaecida e com o aviso de que ainda não é
// conclusiva. Na v1 a responsividade nunca entra (máximo de 90% de peso), por
// isso o corte não pode ser 100%.
export const COBERTURA_CONCLUSIVA = 50;

/**
 * Quanto do peso da nota já foi avaliado: "10% dos critérios avaliados". A
 * nota continua normalizada; a cobertura diz o quanto ela é conclusiva.
 */
export function coberturaDaNota(atendimento) {
  if (!atendimento || atendimento.score == null || !atendimento.max_weight) return null;
  const porcento = Math.round((100 * (Number(atendimento.evaluated_weight) || 0)) / Number(atendimento.max_weight));
  return { porcento, conclusiva: porcento >= COBERTURA_CONCLUSIVA };
}

// "#43", "(#46,#48)", "(#73 e #75)": o número interno da mensagem não aparece
// no texto. Ele só existe para virar o link "Ver evidência". Vale também para
// as análises gravadas antes do runtime limpar isso sozinho.
const NUMERO_INTERNO = /\s*\(\s*#\d+(?:\s*(?:,|e|\/|-)\s*#?\d+)*\s*\)|\s*#\d+\b/g;

export function semNumerosInternos(texto) {
  return String(texto || "").replace(NUMERO_INTERNO, "").replace(/\s{2,}/g, " ").trim();
}

// ---------------------------------------------------------------------------
// O relatório visual: os critérios em ordem, a faixa dos 100 pontos, as
// etapas do mapa e a linha do tempo. Só arrumação para a tela: a nota, os
// estados e os pontos vêm prontos do banco.
// ---------------------------------------------------------------------------

/** O rótulo do estado de um critério: "Ficou em aberto", "Atenção", "Não avaliado". */
export function rotuloDoCriterio(criterio) {
  if (!criterio) return "";
  if (criterio.status === "nao_avaliado" || criterio.points_awarded == null) return ROTULO_DO_ESTADO.nao_avaliado;
  return ROTULO_DO_VALOR[criterio.key]?.[criterio.state] || ROTULO_DO_ESTADO[criterio.status] || criterio.status;
}

/** O tom do critério para a cor: success, warning, danger ou faint. */
export const tomDoCriterio = (criterio) =>
  criterio?.points_awarded == null ? "faint" : TOM_DO_ESTADO[criterio.status] || "faint";

/**
 * Por que o critério ficou assim. O motivo é do diagnóstico; critério não
 * avaliado não tem motivo do Analista, então a tela diz por que ficou de fora.
 */
export function motivoDoCriterio(criterio) {
  const motivo = semNumerosInternos(criterio?.reason);
  if (motivo) return motivo;
  if (criterio?.points_awarded != null) return "";
  if (criterio?.key === "responsiveness") return "Fica fora da v1: a régua de tempo ainda não foi definida.";
  if (criterio?.key === "follow_up") return "Nenhum follow-up vencido para avaliar.";
  return "Sem dado suficiente para avaliar.";
}

const perdidos = (c) => Number(c.weight) - Number(c.points_awarded);

/**
 * Os critérios na ordem de leitura: primeiro os que mais perderam pontos, e
 * os não avaliados no fim (do maior peso para o menor). Peso zero (objeções,
 * dentro do playbook) não entra.
 */
export function criteriosEmOrdem(criterios = []) {
  const comPeso = criterios.filter((c) => Number(c.weight) > 0);
  const avaliados = comPeso.filter((c) => c.points_awarded != null);
  const fora = comPeso.filter((c) => c.points_awarded == null);
  return [
    ...avaliados.sort((a, b) => perdidos(b) - perdidos(a) || Number(b.weight) - Number(a.weight)),
    ...fora.sort((a, b) => Number(b.weight) - Number(a.weight)),
  ];
}

/**
 * A faixa dos 100 pontos: um pedaço por critério, do tamanho do peso. `ganho`
 * é a parte cheia (0 a 100); critério não avaliado vem sem ganho e listrado.
 */
export function faixaDosPontos(criterios = []) {
  return criteriosEmOrdem(criterios).map((c) => ({
    key: c.key,
    peso: Number(c.weight),
    avaliado: c.points_awarded != null,
    ganho: c.points_awarded == null ? null : Math.round((100 * Number(c.points_awarded)) / Number(c.weight)),
    tom: tomDoCriterio(c),
  }));
}

/** "6 de 8 critérios" e "45 de 80 pontos": o que a nota já cobre. */
export function contaDaNota(atendimento) {
  const criterios = (atendimento?.criteria || []).filter((c) => Number(c.weight) > 0);
  const avaliados = criterios.filter((c) => c.points_awarded != null);
  const pontos = avaliados.reduce((soma, c) => soma + Number(c.points_awarded), 0);
  return {
    avaliados: avaliados.length,
    total: criterios.length,
    pontos: Math.round(pontos * 10) / 10,
    pesoAvaliado: Number(atendimento?.evaluated_weight) || 0,
  };
}

// O mapa da conversa: cada etapa é um critério, na ordem em que a conversa
// costuma andar. Coerência e responsividade atravessam a conversa toda e não
// viram etapa. O follow-up vem depois, tracejado.
export const ETAPAS_DA_CONVERSA = [
  { chave: "abertura", nome: "Abertura", criterio: "communication_adaptation", prefixo: "adaptação" },
  { chave: "descoberta", nome: "Descoberta", criterio: "discovery" },
  { chave: "qualificacao", nome: "Qualificação", criterio: "qualification" },
  { chave: "proposta", nome: "Proposta", criterio: "playbook_adherence", prefixo: "playbook" },
  { chave: "proximo_passo", nome: "Próximo passo", criterio: "next_step" },
  { chave: "follow_up", nome: "Follow-up", criterio: "follow_up", depois: true },
];

/**
 * As etapas com o estado de cada uma. `marca` vai na etapa do gargalo:
 * "parou aqui!" quando a conversa ficou em aberto, senão "o gargalo está
 * aqui". Sem critério no gargalo, nenhuma marca.
 */
export function etapasDaConversa(criterios = [], gargalo = null) {
  const porChave = Object.fromEntries(criterios.map((c) => [c.key, c]));
  return ETAPAS_DA_CONVERSA.map((etapa) => {
    const criterio = porChave[etapa.criterio] || null;
    const avaliado = criterio?.points_awarded != null;
    const detalhe = avaliado ? `${rotuloDoCriterio(criterio).toLocaleLowerCase("pt-BR")} · ${pontosDoCriterio(criterio)}` : "não avaliado";
    const noGargalo = Boolean(gargalo?.criterion) && gargalo.criterion === etapa.criterio;
    return {
      ...etapa,
      avaliado,
      tom: criterio ? tomDoCriterio(criterio) : "faint",
      forte: criterio?.status === "critico",
      detalhe: etapa.prefixo && avaliado ? `${etapa.prefixo}: ${detalhe}` : detalhe,
      nota: criterio && avaliado ? motivoDoCriterio(criterio) : "",
      marca: noGargalo ? (criterio?.state === "ficou_em_aberto" ? "parou aqui!" : "o gargalo está aqui") : "",
    };
  });
}

// ---------------------------------------------------------------- a linha do tempo

const FUSO = "America/Sao_Paulo";
const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
// Daqui para cima a espera pela equipe vira pausa marcada na linha. É só
// destaque visual: a responsividade não entra na nota da v1.
export const PAUSA_LONGA_MS = HORA;

/** "25 min", "3h10", "2h", "1 dia", "3 dias". */
export function duracaoEmTexto(ms) {
  const minutos = Math.max(0, Math.round(ms / MINUTO));
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 24 * 60) {
    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    return resto ? `${horas}h${String(resto).padStart(2, "0")}` : `${horas}h`;
  }
  const dias = Math.floor(minutos / (24 * 60));
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

const diaDe = (ms) => new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO });
const horaDe = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });

/** "26/09 10:02": o instante na hora de Brasília. */
export const instanteEmTexto = (ms) => `${diaDe(ms)} ${horaDe(ms)}`;

const TOM_DO_ALERTA = { conversation_left_open: "danger", critical_information_ignored: "danger" };

const cortar = (texto, teto) => {
  const limpo = semNumerosInternos(texto);
  return limpo.length > teto ? `${limpo.slice(0, teto - 1).trimEnd()}…` : limpo;
};

/**
 * A linha do tempo da conversa, pronta para desenhar.
 *
 * As mensagens ficam lado a lado, uma casa por mensagem; a virada de dia
 * ganha uma casa a mais, e a espera longa pela equipe ganha duas, com o
 * rótulo do tempo. Se a conversa estava parada havia mais de uma hora quando
 * foi analisada, o fim da linha mostra há quanto tempo. `x` vai de 2 a 98
 * (porcento da largura).
 *
 * As mensagens citadas pelo diagnóstico ganham legenda: a do alerta, se um
 * alerta as cita, senão o trecho entre aspas.
 */
export function linhaDoTempo(timeline, alertas = []) {
  const brutas = (timeline?.messages || []).filter((m) => m && m.id && !Number.isNaN(new Date(m.at).getTime()));
  if (!brutas.length) return null;
  const ate = new Date(timeline.until).getTime();

  const alertaDa = {};
  for (const alerta of alertas || []) {
    for (const id of alerta.evidence_message_ids || []) {
      if (!alertaDa[id]) alertaDa[id] = alerta;
    }
  }

  let casa = 0;
  let esperaDesde = null; // a primeira mensagem do cliente ainda sem resposta da equipe
  const mensagens = [];
  const pausas = [];
  const dias = [];
  brutas.forEach((bruta, indice) => {
    const em = new Date(bruta.at).getTime();
    const lado = bruta.fromMe ? "equipe" : "cliente";
    if (indice > 0) {
      const anterior = mensagens[indice - 1];
      casa += 1;
      // A pausa vem antes da virada de dia: a linha do dia fica colada na
      // mensagem que abre o dia, não no meio da espera.
      const virou = diaDe(em) !== diaDe(anterior.em);
      if (lado === "equipe" && esperaDesde != null && em - esperaDesde >= PAUSA_LONGA_MS) {
        pausas.push({ casaDe: anterior.casa, casaAte: casa + 2, duracao: em - esperaDesde, desde: esperaDesde, ate: em });
        casa += 2;
      }
      if (virou) {
        dias.push({ casa, rotulo: diaDe(em) });
        casa += 1;
      }
    }
    if (lado === "cliente" && esperaDesde == null) esperaDesde = em;
    if (lado === "equipe") esperaDesde = null;
    const alerta = alertaDa[bruta.id] || null;
    const citada = bruta.snippet != null || Boolean(alerta);
    mensagens.push({
      id: bruta.id,
      em,
      casa,
      lado,
      autor: bruta.author || "",
      citada,
      tom: alerta ? TOM_DO_ALERTA[alerta.code] || "warning" : citada ? "accent" : null,
      legenda: alerta ? ROTULO_DO_ALERTA[alerta.code] || alerta.code : bruta.snippet ? `“${cortar(bruta.snippet, 34)}”` : "",
      trecho: bruta.snippet ? cortar(bruta.snippet, 90) : "",
    });
  });

  const ultima = mensagens[mensagens.length - 1];
  const parada = Number.isFinite(ate) && ate - ultima.em >= PAUSA_LONGA_MS ? { duracao: ate - ultima.em, ate } : null;
  // A parada no fim ocupa cerca de um quinto da linha.
  const casas = Math.max(1, casa + (parada ? Math.max(3, Math.round(casa / 4)) : 0));
  const x = (n) => (mensagens.length === 1 && !parada ? 50 : 2 + (96 * n) / casas);

  return {
    mensagens: mensagens.map((m) => ({ ...m, x: x(m.casa) })),
    pausas: pausas.map((p) => ({ ...p, x1: x(p.casaDe), x2: x(p.casaAte), rotulo: `${duracaoEmTexto(p.duracao)} até a equipe responder` })),
    dias: dias.map((d) => ({ ...d, x: x(d.casa) })),
    parada: parada && { ...parada, x1: x(ultima.casa) + 1.5, rotulo: `${duracaoEmTexto(parada.duracao)} parada` },
    inicio: mensagens[0].em,
    fim: ultima.em,
    total: mensagens.length,
  };
}

/**
 * Os momentos da conversa, para a lista do celular: as mensagens citadas, as
 * esperas longas e a parada do fim, em ordem.
 */
export function momentosDaConversa(linha) {
  if (!linha) return [];
  const momentos = [
    ...linha.mensagens
      .filter((m) => m.citada)
      .map((m) => ({
        tipo: "mensagem",
        id: m.id,
        em: m.em,
        lado: m.lado,
        tom: m.tom,
        texto: m.tom !== "accent" ? m.legenda : m.trecho ? `“${m.trecho}”` : m.legenda,
      })),
    // A pausa entra logo depois da mensagem que ficou esperando.
    ...linha.pausas.map((p) => ({ tipo: "pausa", em: p.desde + 1, texto: p.rotulo })),
  ].sort((a, b) => a.em - b.em);
  if (linha.parada) momentos.push({ tipo: "parada", em: linha.parada.ate, texto: linha.parada.rotulo });
  return momentos;
}

/** "10 mensagens, de 26/09 a 27/09": o pedaço da conversa que foi lido. */
export function periodoDaLinha(linha) {
  if (!linha) return "";
  const de = diaDe(linha.inicio);
  const ate = diaDe(linha.fim);
  const quantas = linha.total === 1 ? "1 mensagem" : `${linha.total} mensagens`;
  return de === ate ? `${quantas}, em ${de}` : `${quantas}, de ${de} a ${ate}`;
}

/** O resumo da análise em texto simples, para copiar e mandar. */
export function resumoParaCopiar({ nome, relatorio }) {
  const atendimento = relatorio?.atendimento_score;
  const diagnostico = relatorio?.diagnosis || {};
  const cobertura = coberturaDaNota(atendimento);
  const linhas = [`Análise do atendimento${nome ? ` · ${nome}` : ""}`];
  linhas.push(
    cobertura
      ? `Nota: ${atendimento.score}/100 — ${cobertura.porcento}% dos critérios avaliados${cobertura.conclusiva ? "" : " (ainda não conclusiva)"}`
      : `Nota: ${notaEmTexto(atendimento)}`
  );
  if (diagnostico.summary) linhas.push("", semNumerosInternos(diagnostico.summary));
  if (diagnostico.main_bottleneck?.title) linhas.push("", `Gargalo: ${semNumerosInternos(diagnostico.main_bottleneck.title)}`);
  const acoes = diagnostico.what_to_do_now || [];
  if (acoes.length) {
    linhas.push("", "O que fazer agora:");
    acoes.forEach((acao, i) => linhas.push(`${i + 1}. ${semNumerosInternos(acao.title || acao.instruction)}`));
  }
  if (diagnostico.suggested_message?.applicable && diagnostico.suggested_message.text) {
    linhas.push("", "Mensagem sugerida:", diagnostico.suggested_message.text);
  }
  return linhas.join("\n");
}
