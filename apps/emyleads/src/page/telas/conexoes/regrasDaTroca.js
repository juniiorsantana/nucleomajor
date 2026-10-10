/**
 * A troca voluntária de WhatsApp, do lado da tela: em que fase está, o que
 * pode ser feito agora e o que dizer.
 *
 * Quem decide é o banco (`nucleo_connection_change_*`, migration
 * 20261012100000). Estas funções só traduzem o estado que ele devolve:
 * esconder um botão aqui é conforto, não proteção. Sem React e sem imports,
 * para os testes e a bancada lerem as mesmas regras que a tela.
 */

export const FASES_DA_TROCA = Object.freeze({
  CARREGANDO: "carregando",
  // Nada liberado para esta conexão.
  INDISPONIVEL: "indisponivel",
  // Liberada só para a equipe da plataforma (a operação controlada).
  SO_EQUIPE: "so-equipe",
  // Liberada, mas agora não dá: VPS calada ou WhatsApp caído sozinho.
  BLOQUEADA: "bloqueada",
  ESCOLHER: "escolher",
  CONFIRMAR: "confirmar",
  AGUARDANDO_OUTRA_PESSOA: "aguardando-outra-pessoa",
  APLICANDO: "aplicando",
});

// Uma confirmação vale por 24 h para repetir sem confirmar de novo.
const JANELA_DE_REPETICAO_MS = 24 * 60 * 60 * 1000;

const instante = (valor) => (valor ? new Date(valor).getTime() : 0);

/**
 * Por que não dá para começar agora, ou `null` se dá.
 *
 * Voluntário é com o WhatsApp de pé, ou logo depois de uma liberação
 * voluntária (desconectou e agora conecta outro número). O número que caiu
 * sozinho vai para outro caminho, que ainda não existe.
 */
export function motivoParaNaoComecar(estado) {
  if (!estado || estado.mode === "off") return "indisponivel";
  if (!estado.actorAllowed) return "so-equipe";
  const runtime = estado.runtime;
  if (!runtime || !runtime.fresh) return "vps-fora";
  if (runtime.whatsappStatus === "connected") return null;
  if (estado.mode === "direct" && estado.sessionReleasedAt) return null;
  return "whatsapp-fora";
}

/**
 * A fase da troca nesta conexão.
 *
 * `ultimo` é o pedido mais recente que já terminou (aplicado, falhou,
 * expirou), para a tela contar o desfecho junto da fase. `bloqueio` diz por
 * que não dá para começar outro.
 */
export function faseDaTroca(estado, agora = Date.now()) {
  if (!estado) return { fase: FASES_DA_TROCA.CARREGANDO, pedido: null, ultimo: null, bloqueio: null };
  const pedido = estado.request || null;
  const bloqueio = motivoParaNaoComecar(estado);

  // Um pedido em andamento manda na tela mesmo se a liberação vencer: quem
  // pediu precisa ver o desfecho e poder cancelar.
  if (pedido && (pedido.status === "queued" || pedido.status === "running")) {
    return { fase: FASES_DA_TROCA.APLICANDO, pedido, ultimo: null, bloqueio };
  }
  if (pedido && pedido.status === "awaiting_confirmation" && instante(pedido.confirmUntil) > agora) {
    return {
      fase: pedido.mine ? FASES_DA_TROCA.CONFIRMAR : FASES_DA_TROCA.AGUARDANDO_OUTRA_PESSOA,
      pedido,
      ultimo: null,
      bloqueio,
    };
  }

  const ultimo = pedido && ["applied", "failed", "expired"].includes(pedido.status) ? pedido : null;
  const fase = {
    indisponivel: FASES_DA_TROCA.INDISPONIVEL,
    "so-equipe": FASES_DA_TROCA.SO_EQUIPE,
    "vps-fora": FASES_DA_TROCA.BLOQUEADA,
    "whatsapp-fora": FASES_DA_TROCA.BLOQUEADA,
  }[bloqueio] || FASES_DA_TROCA.ESCOLHER;
  return { fase, pedido: null, ultimo, bloqueio };
}

/** Repetir sem confirmar de novo: falhou ou venceu na fila, há menos de 24 h. */
export function podeRepetir(pedido, estado, agora = Date.now()) {
  return Boolean(
    pedido
      && ["failed", "expired"].includes(pedido.status)
      && pedido.confirmedAt
      && agora - instante(pedido.confirmedAt) < JANELA_DE_REPETICAO_MS
      && estado?.mode === pedido.confirmationMethod
      && estado?.actorAllowed
  );
}

/** Cancelar só enquanto a VPS não pegou: depois disso a ação pode estar em curso. */
export function podeCancelar(pedido) {
  if (!pedido) return false;
  if (pedido.status === "awaiting_confirmation") return true;
  return pedido.status === "queued" && pedido.commandStatus !== "claimed";
}

const TEXTOS_DO_BLOQUEIO = {
  indisponivel: "A troca de número ainda não foi liberada para esta conexão. Fale com a equipe do Núcleo Major.",
  "so-equipe": "Nesta fase, a troca deste número é feita pela equipe do Núcleo Major.",
  "vps-fora": "A VPS desta conexão não está respondendo agora. A troca começa quando ela voltar.",
  "whatsapp-fora": "Para trocar ou desconectar, o WhatsApp desta conexão precisa estar conectado. Se o número caiu ou foi banido, fale com a equipe do Núcleo Major.",
};

export function textoDoBloqueio(bloqueio) {
  return TEXTOS_DO_BLOQUEIO[bloqueio] || "";
}

// As frases do banco (`raise exception`) que a tela sabe traduzir.
const RECUSAS = [
  ["connection change is not enabled", TEXTOS_DO_BLOQUEIO.indisponivel],
  ["requires a platform administrator", TEXTOS_DO_BLOQUEIO["so-equipe"]],
  ["organization management required", "Só o dono ou um administrador da empresa pode trocar o número."],
  ["runtime credentials cannot", "Esta credencial não pode trocar o número."],
  ["subscription is not active", "A assinatura da empresa não está ativa."],
  ["connection is not available", "Esta conexão não está disponível para esta empresa."],
  ["runtime is not online", "A VPS desta conexão não está respondendo agora. Tente de novo em alguns minutos."],
  ["old whatsapp is not connected", TEXTOS_DO_BLOQUEIO["whatsapp-fora"]],
  ["invalid phone", "Número inválido. Digite com DDD, por exemplo (65) 99999-7777."],
  ["same number", "Esse já é o número desta conexão. Para conectá-lo de novo, use Conectar WhatsApp."],
  ["too many change requests", "Muitas tentativas na última hora. Espere um pouco antes de tentar de novo."],
  ["a confirmed change is already in progress", "Já existe uma troca confirmada em andamento nesta conexão."],
  ["another change is in progress", "Já existe outra troca em andamento nesta conexão."],
  ["policy changed", "A liberação desta conexão mudou no meio do caminho. Comece de novo."],
  ["only the requester", "Só quem pediu a troca pode confirmar ou reenviar o código."],
  ["confirmation is too old", "A confirmação tem mais de 24 horas. Comece uma troca nova."],
  ["identity changed since", "O número desta conexão mudou desde a confirmação. Comece uma troca nova."],
  ["cannot be retried", "Este pedido não pode ser repetido."],
  ["code send limit reached", "O código já foi enviado três vezes. Comece de novo."],
  ["wait before resending", "Espere 30 segundos para pedir outro código."],
  ["not confirmed by code", "Esta troca não usa código."],
  ["is not awaiting confirmation", "Este pedido não está mais esperando confirmação."],
  ["change request not found", "O pedido não foi encontrado. Recarregue a página."],
  ["change kind is invalid", "Escolha entre trocar o número e só desconectar."],
  ["needs a request key", "Não foi possível identificar o pedido. Recarregue a página."],
];

/** A recusa do banco em português. O texto cru nunca vai para a tela. */
export function mensagemDaRecusa(erro) {
  const texto = String(erro?.motivo || erro?.message || erro || "");
  for (const [trecho, frase] of RECUSAS) {
    if (texto.includes(trecho)) return frase;
  }
  return "Não foi possível concluir agora. Tente de novo em instantes.";
}

// Os motivos que o runtime e o gatilho gravam no pedido.
const MOTIVOS = {
  bridge_offline: "A VPS não respondeu.",
  bridge_unavailable: "A VPS não respondeu.",
  stale_generation: "Um pedido mais novo já tinha sido aplicado.",
  "stale-generation": "Um pedido mais novo já tinha sido aplicado.",
  session_control_unsupported: "A VPS ainda não tem esta função: falta implantar a versão nova.",
  session_release_failed: "A VPS não conseguiu desconectar o WhatsApp.",
  unexpected_bridge_result: "A VPS respondeu algo inesperado.",
  "unexpected-result": "A VPS respondeu algo inesperado.",
  connection_not_registered: "Esta conexão não está registrada na VPS.",
  invalid_payload: "O pedido chegou incompleto na VPS.",
  unsupported_command: "A VPS ainda não reconhece este pedido.",
  unexpected: "A VPS falhou ao aplicar.",
  expired: "O pedido venceu na fila: a VPS ficou fora do ar.",
  "identity-changed": "O número desta conexão mudou durante o pedido.",
};

export function motivoDoPedido(codigo) {
  const limpo = String(codigo || "");
  if (!limpo) return "";
  if (limpo.startsWith("confirmation-")) {
    const causa = MOTIVOS[limpo.slice("confirmation-".length)];
    return `O código não chegou ao WhatsApp antigo.${causa ? ` ${causa}` : ""}`;
  }
  return MOTIVOS[limpo] || "A troca não foi aplicada.";
}

/** O que a confirmação respondeu quando não confirmou. */
export function mensagemDaConfirmacao(resposta) {
  if (!resposta || resposta.confirmed) return "";
  switch (resposta.result) {
    case "invalid-code": {
      const restantes = Number(resposta.attemptsLeft ?? 0);
      return restantes > 0
        ? `Código incorreto. ${restantes === 1 ? "Resta 1 tentativa" : `Restam ${restantes} tentativas`}.`
        : "Código incorreto. As tentativas acabaram: comece de novo.";
    }
    case "expired":
      return "O prazo de 10 minutos para confirmar acabou. Comece de novo.";
    case "too-many-attempts":
      return "As tentativas acabaram. Comece de novo.";
    case "identity-changed":
      return "O número desta conexão mudou durante o pedido. Comece de novo.";
    case "not-awaiting-confirmation":
      return "Este pedido não está mais esperando confirmação.";
    default:
      return "Não foi possível confirmar.";
  }
}

export function textoDaFila(pedido, runtimeFresh) {
  if (!runtimeFresh) {
    return "A VPS não está respondendo. O pedido espera até 24 horas; enquanto ela não pegar, dá para cancelar.";
  }
  if (pedido?.commandStatus === "claimed" || pedido?.status === "running") {
    return "A VPS está aplicando agora. Não feche esta tela.";
  }
  return "Na fila da VPS. Leva alguns segundos.";
}

/**
 * O número como o banco vai lê-lo: só dígitos, com o 55 quando faltar (10 ou
 * 11 dígitos são DDD + número brasileiro). Mesma regra da RPC.
 */
export function normalizarTelefone(texto) {
  const digitos = String(texto || "").replace(/\D/g, "");
  return digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
}

export function telefoneValido(digitos) {
  return /^[1-9][0-9]{9,14}$/.test(String(digitos || ""));
}

/** `5565999997777` vira `+55 (65) 99999-7777`, para conferir antes de confirmar. */
export function telefoneLegivel(digitos) {
  const limpo = String(digitos || "").replace(/\D/g, "");
  if (limpo.startsWith("55") && (limpo.length === 12 || limpo.length === 13)) {
    const numero = limpo.slice(4);
    return `+55 (${limpo.slice(2, 4)}) ${numero.slice(0, -4)}-${numero.slice(-4)}`;
  }
  return limpo ? `+${limpo}` : "";
}
