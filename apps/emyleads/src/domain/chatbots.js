import { TIPOS_CONDICAO } from "./regras.js";
import { uid } from "./types.js";

export const TIPOS_PASSO = {
  enviarMensagem: "enviar_mensagem",
  editarEtiquetas: "editar_etiquetas",
  // Transferem o atendimento: o fluxo entrega a conversa a outro dono e sai de
  // cena. São terminais por natureza — depois de passar para a IA ou para uma
  // pessoa, não faz sentido o chatbot continuar mandando mensagem.
  transferir: "transferir",
};

/** Para quem o bloco de transferência entrega a conversa. */
export const DESTINOS_TRANSFERENCIA = {
  ia: "ia",
  humano: "humano",
};

export const ehTransferencia = (passo) => passo?.tipo === TIPOS_PASSO.transferir;

/**
 * Quantas saídas cada tipo de bloco tem, e como elas se chamam.
 *
 * O tipo declara a própria aridade em vez de o validador do grafo carregar uma
 * regra global. Hoje isso só formaliza o que já era verdade — transferir já era
 * terminal, o resto já tinha uma saída só —, mas é por aqui que um bloco de
 * condição entra amanhã declarando `["sim", "nao"]`, sem que a validação
 * precise aprender o que é uma condição.
 */
export const SAIDAS_DO_PASSO = {
  [TIPOS_PASSO.enviarMensagem]: ["padrao"],
  [TIPOS_PASSO.editarEtiquetas]: ["padrao"],
  // Terminal: depois de entregar a conversa, quem continua é o novo dono.
  [TIPOS_PASSO.transferir]: [],
};

/** Lista vazia para tipo desconhecido — um bloco que não se sabe o que é não continua o fluxo. */
export const saidasDoPasso = (passo) => SAIDAS_DO_PASSO[passo?.tipo] || [];

const instanteValido = (valor) => (Number.isFinite(valor) ? valor : Date.now());

export function criarPasso(tipo, partial = {}) {
  if (tipo === TIPOS_PASSO.enviarMensagem) {
    return { id: uid(), tipo, texto: "", ...partial };
  }
  if (tipo === TIPOS_PASSO.editarEtiquetas) {
    return { id: uid(), tipo, adicionar: [], remover: [], ...partial };
  }
  if (tipo === TIPOS_PASSO.transferir) {
    // `humano` como padrão de propósito: transferir para uma pessoa é sempre
    // seguro. Passar para a IA é que precisa ser uma escolha.
    return { id: uid(), tipo, destino: DESTINOS_TRANSFERENCIA.humano, motivo: "", ...partial };
  }
  throw new Error(`Tipo de passo desconhecido: ${tipo}.`);
}

export function criarChatbot(partial = {}) {
  const instante = instanteValido(partial.criadoEm);
  const { agora: _agora, ...dados } = partial;
  return {
    id: uid(),
    nome: "Novo chatbot",
    ativo: true,
    condicoes: [],
    passos: [],
    execucoes: 0,
    ultimaExecucaoEm: null,
    criadoEm: instante,
    atualizadoEm: instante,
    ...dados,
  };
}

export function primeiraMensagem(chatbot) {
  return chatbot?.passos?.find((passo) => passo.tipo === TIPOS_PASSO.enviarMensagem)?.texto || null;
}

/** Tags que podem ser aplicadas antes da primeira mensagem. */
export function etiquetasExecutaveis(chatbot) {
  const etiquetas = new Set();
  for (const passo of chatbot?.passos || []) {
    if (passo.tipo === TIPOS_PASSO.enviarMensagem) break;
    if (passo.tipo !== TIPOS_PASSO.editarEtiquetas) continue;
    for (const id of passo.remover || []) etiquetas.delete(id);
    for (const id of passo.adicionar || []) etiquetas.add(id);
  }
  return [...etiquetas];
}

export function chatbotsPadrao(agora = Date.now()) {
  return [
    criarChatbot({
      id: "boas-vindas-primeira",
      nome: "Boas-vindas",
      ativo: true,
      condicoes: [{ tipo: TIPOS_CONDICAO.primeiraConversa }],
      passos: [
        criarPasso(TIPOS_PASSO.enviarMensagem, {
          id: "boas-vindas-mensagem",
          texto: "Oi {nome}! Tudo bem? Vi que essa é nossa primeira conversa por aqui — em que posso ajudar?",
        }),
      ],
      criadoEm: agora,
      atualizadoEm: agora,
    }),
  ];
}
