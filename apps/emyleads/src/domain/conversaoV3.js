/**
 * Conversão de um fluxo v2 (linear) para o formato com caminhos (v3) — Etapa 11.
 *
 * A conversão estrutural é a mesma que o editor faz ao abrir um v2 com a
 * função `fluxos_ramificados` (`criarGrafoInicial` em `page/telas/chatbotFlow.js`):
 * os destinos escondidos da IA (`retornoPassoId`, `falhaPassoId`) viram as
 * saídas Sucesso e Falha, e o primeiro salvamento grava o v3. Esta função a
 * faz sem tela, para o SQL do dono converter empresa por empresa
 * (`scripts/fluxos/converter-v2-para-v3.mjs`).
 *
 * ## Só converte o que continua fazendo a mesma coisa
 *
 * Os dois executores NÃO leem o mesmo fluxo do mesmo jeito. O linear
 * (`chatbot_runtime._plan`, na VPS) manda no máximo UMA mensagem, aplica só as
 * etiquetas de antes dela e entrega a conversa à primeira transferência depois
 * dela; o resto do caminho é ignorado. O v3 percorre o caminho inteiro. Um v2
 * com duas mensagens passaria a mandar as duas.
 *
 * Por isso, depois de montar o v3, a função compara os efeitos dos dois
 * executores (mensagens, blocos de etiqueta aplicados e destino final) e
 * RECUSA, com o motivo, o fluxo cujo comportamento mudaria. Recusa também:
 *
 *   * transferência para a IA: no v2 a IA fica com a conversa; no v3 ela
 *     trabalha por um objetivo e devolve o fluxo (Sucesso/Falha). Não há
 *     equivalente — o dono refaz à mão;
 *   * o que o banco recusaria (`problemaParaOServidor`, espelho de
 *     `private.flow_validate`);
 *   * bloco que o plano da empresa não libera (`bloqueioDoFluxo`, a lista da
 *     Etapa 10), quando `recursos` é passado.
 *
 * Fim solto (a última mensagem sem nada depois): no v2 o fluxo termina ali; no
 * v3 toda saída precisa de destino, então ganha um bloco "Encerrar".
 *
 * Pura e idempotente: um v3 volta como está (`estado: "ja_v3"`).
 */

import { NO_CONDICOES, NO_ENTRADA, SAIDA_PADRAO, conexoesDoChatbot, validarGrafo, VERSAO_CANVAS_RAMIFICADO } from "./chatbotGrafo.js";
import { DESTINOS_TRANSFERENCIA, TIPOS_PASSO } from "./chatbots.js";
import { problemaParaOServidor } from "./fluxoNoServidor.js";
import { bloqueioDoFluxo } from "./funcoesDosBlocos.js";

/** O id do "Encerrar" que a conversão acrescenta no fim solto. */
export const ID_DO_FIM_CONVERTIDO = "fim_convertido";

/** Os tipos que o editor v2 sabe montar. Qualquer outro já é do v3. */
const TIPOS_DO_V2 = new Set([
  TIPOS_PASSO.enviarMensagem,
  TIPOS_PASSO.editarEtiquetas,
  TIPOS_PASSO.transferir,
  TIPOS_PASSO.encerrar,
]);

/** No v3 o destino da IA é o mapa; os campos escondidos do v2 saem do bloco. */
export const semDestinosEscondidos = (passo) =>
  passo.tipo === TIPOS_PASSO.transferir ? { ...passo, retornoPassoId: null, falhaPassoId: null } : passo;

/**
 * As ligações Sucesso/Falha que os destinos escondidos da IA viram ao abrir um
 * v2 no formato com caminhos. Só acrescenta onde a saída ainda está livre.
 */
export function ligacoesDosDestinosEscondidos(passos = [], conexoes = [], ids = new Set()) {
  const novas = [];
  for (const passo of passos) {
    for (const [saida, campo] of [["sucesso", "retornoPassoId"], ["falha", "falhaPassoId"]]) {
      const alvo = passo[campo];
      const ocupada = [...conexoes, ...novas].some((c) => c.source === passo.id && (c.saida || SAIDA_PADRAO) === saida);
      if (alvo && ids.has(alvo) && alvo !== passo.id && !ocupada) novas.push({ source: passo.id, saida, target: alvo });
    }
  }
  return novas;
}

/**
 * O que o executor LINEAR faz com o fluxo, sem olhar o contato: espelho de
 * `_path` + `_plan` (`whatsapp-assistant/chatbot_runtime.py`).
 */
export function efeitosDoLinear(definicao) {
  const passos = (Array.isArray(definicao?.passos) ? definicao.passos : []).filter((p) => p && typeof p === "object");
  const porId = new Map(passos.filter((p) => p.id).map((p) => [String(p.id), p]));
  const gravadas = Array.isArray(definicao?.canvas?.conexoes) ? definicao.canvas.conexoes : [];
  let caminho = [];
  if (!gravadas.length) {
    for (const passo of passos) {
      caminho.push(passo);
      if (passo.tipo === TIPOS_PASSO.transferir) break;
    }
  } else {
    const saidas = new Map(gravadas.map((c) => [`${c.source}:${c.saida || SAIDA_PADRAO}`, String(c.target || "")]));
    let atual = saidas.get(`${NO_CONDICOES}:${SAIDA_PADRAO}`);
    const vistos = new Set();
    while (atual && porId.has(atual) && !vistos.has(atual)) {
      vistos.add(atual);
      const passo = porId.get(atual);
      caminho.push(passo);
      if (passo.tipo === TIPOS_PASSO.transferir || passo.tipo === TIPOS_PASSO.encerrar) break;
      atual = saidas.get(`${atual}:${SAIDA_PADRAO}`);
    }
  }
  const mensagens = [];
  const etiquetas = [];
  let transferencia = null;
  for (let indice = 0; indice < caminho.length; indice += 1) {
    const passo = caminho[indice];
    if (passo.tipo === TIPOS_PASSO.transferir) {
      transferencia = passo.destino || null;
      break;
    }
    if (passo.tipo === TIPOS_PASSO.enviarMensagem) {
      const texto = String(passo.texto || "").trim();
      if (texto) mensagens.push(texto);
      transferencia = caminho.slice(indice + 1).find((item) => item.tipo === TIPOS_PASSO.transferir)?.destino || null;
      break;
    }
    if (passo.tipo === TIPOS_PASSO.editarEtiquetas) etiquetas.push(String(passo.id));
  }
  return { mensagens, etiquetas, transferencia };
}

/**
 * O que o executor v3 faz com um fluxo SEM caminhos de decisão (o que sai de
 * um v2): segue a saída padrão até transferir, encerrar ou o fim.
 */
export function efeitosDoV3Linear(definicao) {
  const passos = Array.isArray(definicao?.passos) ? definicao.passos : [];
  const porId = new Map(passos.map((p) => [String(p.id), p]));
  const saidas = new Map((definicao?.canvas?.conexoes || []).map((c) => [`${c.source}:${c.saida || SAIDA_PADRAO}`, String(c.target)]));
  const mensagens = [];
  const etiquetas = [];
  let transferencia = null;
  let atual = saidas.get(`${NO_CONDICOES}:${SAIDA_PADRAO}`);
  const vistos = new Set();
  while (atual && porId.has(atual) && !vistos.has(atual)) {
    vistos.add(atual);
    const passo = porId.get(atual);
    if (passo.tipo === TIPOS_PASSO.transferir) {
      transferencia = passo.destino || null;
      break;
    }
    if (passo.tipo === TIPOS_PASSO.encerrar) break;
    if (passo.tipo === TIPOS_PASSO.enviarMensagem) mensagens.push(String(passo.texto || "").trim());
    if (passo.tipo === TIPOS_PASSO.editarEtiquetas) etiquetas.push(String(passo.id));
    atual = saidas.get(`${atual}:${SAIDA_PADRAO}`);
  }
  return { mensagens, etiquetas, transferencia };
}

const recusa = (motivo, detalhe) => ({ estado: "recusado", motivo, detalhe });

/**
 * Converte a `definition` de um chatbot. Devolve:
 *
 *   * `{ estado: "ja_v3" }` — nada a fazer;
 *   * `{ estado: "convertido", definicao }` — a definição v3, com o mesmo efeito;
 *   * `{ estado: "recusado", motivo, detalhe }` — e o porquê, em português.
 *
 * `recursos` (opcional) são as funções da empresa (`{ chatbots: true, ... }`).
 */
export function converterParaV3(definicao, { recursos = null } = {}) {
  if (Number(definicao?.canvas?.versao) === VERSAO_CANVAS_RAMIFICADO) return { estado: "ja_v3" };
  const originais = Array.isArray(definicao?.passos) ? definicao.passos : [];
  if (!originais.length) return recusa("sem_blocos", "O fluxo não tem nenhum bloco.");
  const estranho = originais.find((passo) => !TIPOS_DO_V2.has(passo?.tipo));
  if (estranho) return recusa("bloco_do_v3", `O bloco de tipo “${estranho?.tipo}” não existe no formato antigo.`);
  if (originais.some((passo) => passo.tipo === TIPOS_PASSO.transferir && passo.destino === DESTINOS_TRANSFERENCIA.ia))
    return recusa(
      "transferir_para_ia",
      "No formato antigo a IA fica com a conversa; no novo ela trabalha por um objetivo e devolve o fluxo. Refaça o bloco da IA no editor.",
    );

  const passos = originais.map((passo) => semDestinosEscondidos({ ...passo }));
  const ids = new Set([NO_ENTRADA, NO_CONDICOES, ...passos.map((passo) => passo.id)]);
  const conexoes = conexoesDoChatbot({ passos: originais, canvas: definicao.canvas })
    .filter((conexao) => ids.has(conexao.source) && ids.has(conexao.target));
  conexoes.push(...ligacoesDosDestinosEscondidos(originais, conexoes, ids));

  // Fim solto: a saída padrão do último bloco do caminho não vai a lugar nenhum.
  const saidaLivre = (id) => !conexoes.some((c) => c.source === id && (c.saida || SAIDA_PADRAO) === SAIDA_PADRAO);
  const soltos = passos.filter((passo) =>
    [TIPOS_PASSO.enviarMensagem, TIPOS_PASSO.editarEtiquetas].includes(passo.tipo)
    && conexoes.some((c) => c.target === passo.id)
    && saidaLivre(passo.id));
  if (soltos.length) {
    if (ids.has(ID_DO_FIM_CONVERTIDO)) return recusa("id_ocupado", `Já existe um bloco “${ID_DO_FIM_CONVERTIDO}”.`);
    passos.push({ id: ID_DO_FIM_CONVERTIDO, tipo: TIPOS_PASSO.encerrar });
    for (const passo of soltos) conexoes.push({ source: passo.id, saida: SAIDA_PADRAO, target: ID_DO_FIM_CONVERTIDO });
  }

  const validacao = validarGrafo(passos, conexoes, { versao: VERSAO_CANVAS_RAMIFICADO });
  if (validacao.erro) return recusa("desenho_invalido", validacao.erro);

  // As posições do mapa ficam; o "Encerrar" novo entra à direita do último.
  const nos = Array.isArray(definicao.canvas?.nos) ? definicao.canvas.nos.map((no) => ({ ...no })) : [];
  if (soltos.length && nos.length) {
    const ultimo = nos.reduce((maior, no) => (Number(no.x) > Number(maior.x) ? no : maior), nos[0]);
    nos.push({ id: ID_DO_FIM_CONVERTIDO, x: Number(ultimo.x) + 380, y: Number(ultimo.y) || 176 });
  }

  const nova = {
    ...definicao,
    passos: validacao.passos,
    canvas: {
      ...(definicao.canvas || {}),
      versao: VERSAO_CANVAS_RAMIFICADO,
      nos,
      conexoes: conexoes.map(({ source, saida, target }) => ({ source, saida: saida || SAIDA_PADRAO, target })),
    },
  };

  const problema = problemaParaOServidor(nova);
  if (problema) return recusa("servidor_recusaria", problema);
  if (recursos) {
    const cadeado = bloqueioDoFluxo(nova, recursos);
    if (cadeado) return recusa("plano_nao_libera", cadeado);
  }

  const antes = efeitosDoLinear(definicao);
  const depois = efeitosDoV3Linear(nova);
  const diferencas = [];
  if (JSON.stringify(antes.mensagens) !== JSON.stringify(depois.mensagens))
    diferencas.push(`mensagens: hoje ${antes.mensagens.length}, depois ${depois.mensagens.length}`);
  if (JSON.stringify(antes.etiquetas) !== JSON.stringify(depois.etiquetas))
    diferencas.push(`etiquetas: hoje ${antes.etiquetas.length} bloco(s), depois ${depois.etiquetas.length}`);
  if (antes.transferencia !== depois.transferencia)
    diferencas.push(`destino: hoje ${antes.transferencia || "nenhum"}, depois ${depois.transferencia || "nenhum"}`);
  if (diferencas.length)
    return recusa("comportamento_muda", `O executor novo faria outra coisa (${diferencas.join("; ")}). Revise no editor e salve.`);

  return { estado: "convertido", definicao: nova };
}
