import { TIPOS_CONDICAO } from "./regras.js";
import { uid } from "./types.js";

export const TIPOS_PASSO = {
  enviarMensagem: "enviar_mensagem",
  editarEtiquetas: "editar_etiquetas",
  condicao: "condicao",
  encerrar: "encerrar",
  // Transferem o atendimento: o fluxo entrega a conversa a outro dono e sai de
  // cena. São terminais por natureza — depois de passar para a IA ou para uma
  // pessoa, não faz sentido o chatbot continuar mandando mensagem.
  transferir: "transferir",
  // Etapa 6 (migration 20260926120000): o fluxo pergunta e espera a resposta.
  // "Pedir para escolher" tem uma saída por opção, mais "não entendeu";
  // "Pedir para digitar" guarda o que o contato escreveu numa variável.
  perguntar: "perguntar",
  coletar: "coletar",
  // Etapa 8 (migration 20260926160000): o fluxo espera um prazo e segue
  // sozinho. Saídas `respondeu` (o contato escreveu antes) e `sem_resposta`.
  aguardar: "aguardar",
};

/**
 * Como o fluxo começa (Etapa 7). `mensagem` e `palavra` são avaliados a cada
 * mensagem do contato; os outros chegam pela fila da VPS, disparados pelo
 * banco (etiqueta aplicada, negócio que mudou de etapa, lead de campanha) ou
 * por alguém da equipe (manual). Só existem no formato com caminhos.
 */
export const TIPOS_GATILHO = {
  mensagem: "mensagem",
  palavra: "palavra",
  manual: "manual",
  etiqueta: "etiqueta",
  etapa: "etapa",
  campanha: "campanha",
};

/** Os gatilhos que não dependem de uma mensagem do contato. */
export const GATILHOS_SEM_MENSAGEM = new Set([
  TIPOS_GATILHO.manual, TIPOS_GATILHO.etiqueta, TIPOS_GATILHO.etapa, TIPOS_GATILHO.campanha,
]);

export const gatilhoDo = (chatbot) =>
  chatbot?.gatilho && typeof chatbot.gatilho === "object" ? chatbot.gatilho : { tipo: TIPOS_GATILHO.mensagem };

/** Id de opção no formato que o banco aceita: `^[a-z0-9_-]{1,40}$`. */
export const novoIdDeOpcao = () => `op-${Math.random().toString(36).slice(2, 8)}`;

/** Unidades do bloco "Aguardar" e o teto de cada uma (o banco confere igual). */
export const UNIDADES_DE_ESPERA = {
  minutos: { rotulo: "minutos", maximo: 1440 },
  horas: { rotulo: "horas", maximo: 720 },
  dias: { rotulo: "dias", maximo: 30 },
};

/** No máximo 10 esperas num fluxo: o freio da insistência. */
export const MAXIMO_DE_ESPERAS = 10;

/** "24 horas", "1 dia", "30 minutos". */
export function textoDaEspera(passo) {
  const quantidade = Number(passo?.duracao) || 0;
  const unidade = passo?.unidade;
  if (unidade === "dias") return `${quantidade} ${quantidade === 1 ? "dia" : "dias"}`;
  if (unidade === "minutos") return `${quantidade} ${quantidade === 1 ? "minuto" : "minutos"}`;
  return `${quantidade} ${quantidade === 1 ? "hora" : "horas"}`;
}

/** Nomes que já são do contato e não podem virar variável de resposta. */
export const VARIAVEIS_RESERVADAS = new Set(["nome", "empresa"]);

/** Para quem o bloco de transferência entrega a conversa. */
export const DESTINOS_TRANSFERENCIA = {
  ia: "ia",
  humano: "humano",
};

export const ALVOS_IA = {
  recepcao: "reception",
  skill: "skill",
  campanha: "campaign",
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
  [TIPOS_PASSO.condicao]: ["sim", "nao"],
  [TIPOS_PASSO.encerrar]: [],
  // Terminal: depois de entregar a conversa, quem continua é o novo dono.
  [TIPOS_PASSO.transferir]: [],
};

/** Como cada saída aparece no cartão e nas mensagens de erro. */
export const ROTULOS_SAIDA = {
  padrao: "Próximo",
  sim: "Sim",
  nao: "Não",
  sucesso: "Sucesso",
  falha: "Falha",
  nao_resolvido: "Não entendeu",
  respondeu: "Respondeu",
  sem_resposta: "Não respondeu",
};

/** Lista vazia para tipo desconhecido — um bloco que não se sabe o que é não continua o fluxo. */
export const saidasDoPasso = (passo) => {
  if (passo?.tipo === TIPOS_PASSO.transferir)
    return passo.destino === DESTINOS_TRANSFERENCIA.ia ? ["sucesso", "falha"] : [];
  if (passo?.tipo === TIPOS_PASSO.perguntar)
    return [...(passo.opcoes || []).map((opcao) => opcao.id), "nao_resolvido"];
  if (passo?.tipo === TIPOS_PASSO.coletar) return ["padrao", "nao_resolvido"];
  if (passo?.tipo === TIPOS_PASSO.aguardar) return ["respondeu", "sem_resposta"];
  return SAIDAS_DO_PASSO[passo?.tipo] || [];
};

/** O nome de uma saída no cartão: a opção da pergunta, ou o rótulo fixo. */
export const rotuloDaSaida = (passo, saida) => {
  if (passo?.tipo === TIPOS_PASSO.perguntar) {
    const opcao = (passo.opcoes || []).find((item) => item.id === saida);
    if (opcao) return String(opcao.rotulo || "").trim() || "Opção sem nome";
  }
  if (passo?.tipo === TIPOS_PASSO.coletar && saida === "padrao") return "Respondeu";
  if (passo?.tipo === TIPOS_PASSO.coletar && saida === "nao_resolvido") return "Não respondeu";
  return ROTULOS_SAIDA[saida] || saida;
};

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
    // `objetivoIa` é o que a IA precisa conseguir para o fluxo seguir por
    // "sucesso". O servidor recusa transferência para IA sem ele.
    return {
      id: uid(), tipo, destino: DESTINOS_TRANSFERENCIA.humano, motivo: "",
      alvoIa: ALVOS_IA.recepcao, skillId: null, campanhaId: null, objetivoIa: "",
      retornoPassoId: null, falhaPassoId: null, ...partial,
    };
  }
  if (tipo === TIPOS_PASSO.condicao) {
    return { id: uid(), tipo, expressao: [], ...partial };
  }
  if (tipo === TIPOS_PASSO.encerrar) {
    return { id: uid(), tipo, ...partial };
  }
  if (tipo === TIPOS_PASSO.perguntar) {
    return {
      id: uid(), tipo, texto: "", tentativas: 2, prazoHoras: 24,
      opcoes: [
        { id: novoIdDeOpcao(), rotulo: "", sinonimos: [] },
        { id: novoIdDeOpcao(), rotulo: "", sinonimos: [] },
      ],
      ...partial,
    };
  }
  if (tipo === TIPOS_PASSO.coletar) {
    return { id: uid(), tipo, texto: "", variavel: "resposta", prazoHoras: 24, ...partial };
  }
  if (tipo === TIPOS_PASSO.aguardar) {
    return { id: uid(), tipo, duracao: 24, unidade: "horas", ...partial };
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
