/**
 * O botão "Analisar conversa" (migration 20261002100000): as contas e os
 * textos que a tela mostra, fora do componente para serem testados.
 *
 * Quem analisa é o Agente Analista na VPS (o Claude numa segunda conta). O
 * banco guarda o pedido, o crédito e o resultado; a tela só pede, acompanha,
 * aplica as sugestões que o dono aceitar e salva na ficha.
 */

export const TIPOS_DE_ANALISE = [
  {
    chave: "comercial",
    nome: "Comercial",
    descricao: "Temperatura, objeções, o que faltou para avançar e o próximo passo da venda.",
  },
  {
    chave: "atendimento",
    nome: "Atendimento",
    descricao: "Se o contato foi bem atendido, o que ficou sem resposta e o risco de insatisfação.",
  },
];

export const NOME_DO_TIPO = Object.fromEntries(TIPOS_DE_ANALISE.map((tipo) => [tipo.chave, tipo.nome]));

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

export const semCreditos = (creditos) =>
  Boolean(creditos) && creditos.limit != null && (Number(creditos.left) || 0) <= 0;

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
  nao_avaliado: "Ainda não avaliável",
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

/** Data e hora do formulário num instante; incompleto, nada. */
export function instanteDoPrazo({ data, hora }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || "") || !/^\d{2}:\d{2}$/.test(hora || "")) return null;
  const instante = new Date(`${data}T${hora}:00`);
  return Number.isNaN(instante.getTime()) ? null : instante;
}
