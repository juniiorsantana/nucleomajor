import { describe, expect, it } from "vitest";
import {
  FASES_DA_TROCA,
  faseDaTroca,
  mensagemDaConfirmacao,
  mensagemDaRecusa,
  motivoDoPedido,
  motivoParaNaoComecar,
  normalizarTelefone,
  podeCancelar,
  podeRepetir,
  telefoneLegivel,
  telefoneValido,
  textoDaFila,
} from "./regrasDaTroca";

const AGORA = Date.parse("2026-10-10T15:00:00Z");
const daqui = (ms) => new Date(AGORA + ms).toISOString();

function estado(extra = {}) {
  return {
    mode: "direct",
    actorAllowed: true,
    sessionReleasedAt: null,
    request: null,
    identity: { last4: "8362" },
    runtime: { whatsappStatus: "connected", fresh: true },
    ...extra,
  };
}

const pedido = (extra = {}) => ({
  requestId: "p1",
  kind: "change_number",
  status: "awaiting_confirmation",
  confirmationMethod: "direct",
  oldLast4: "8362",
  newLast4: "7777",
  mine: true,
  confirmUntil: daqui(5 * 60 * 1000),
  confirmedAt: null,
  commandStatus: null,
  ...extra,
});

describe("faseDaTroca", () => {
  it("sem estado ainda, carregando", () => {
    expect(faseDaTroca(null, AGORA).fase).toBe(FASES_DA_TROCA.CARREGANDO);
  });

  it("sem liberação, indisponível; liberada só para a equipe, so-equipe", () => {
    expect(faseDaTroca(estado({ mode: "off", actorAllowed: false }), AGORA).fase).toBe(FASES_DA_TROCA.INDISPONIVEL);
    expect(faseDaTroca(estado({ actorAllowed: false }), AGORA).fase).toBe(FASES_DA_TROCA.SO_EQUIPE);
  });

  it("conectado e liberado, escolher", () => {
    const leitura = faseDaTroca(estado(), AGORA);
    expect(leitura.fase).toBe(FASES_DA_TROCA.ESCOLHER);
    expect(leitura.bloqueio).toBeNull();
  });

  it("VPS calada ou WhatsApp caído sozinho bloqueiam", () => {
    expect(faseDaTroca(estado({ runtime: { whatsappStatus: "connected", fresh: false } }), AGORA).bloqueio).toBe("vps-fora");
    expect(faseDaTroca(estado({ runtime: null }), AGORA).bloqueio).toBe("vps-fora");
    const caiu = faseDaTroca(estado({ runtime: { whatsappStatus: "logged_out", fresh: true } }), AGORA);
    expect(caiu.fase).toBe(FASES_DA_TROCA.BLOQUEADA);
    expect(caiu.bloqueio).toBe("whatsapp-fora");
  });

  it("desconectado por escolha, a operação direta deixa conectar outro número; o modo com código não", () => {
    const liberada = { sessionReleasedAt: daqui(-60000), runtime: { whatsappStatus: "whatsapp_disconnected", fresh: true } };
    expect(faseDaTroca(estado(liberada), AGORA).fase).toBe(FASES_DA_TROCA.ESCOLHER);
    expect(motivoParaNaoComecar(estado({ ...liberada, mode: "whatsapp_code" }))).toBe("whatsapp-fora");
  });

  it("um pedido na fila manda na tela, mesmo com a liberação vencida", () => {
    const naFila = faseDaTroca(estado({ mode: "off", actorAllowed: false, request: pedido({ status: "queued" }) }), AGORA);
    expect(naFila.fase).toBe(FASES_DA_TROCA.APLICANDO);
    expect(naFila.pedido.requestId).toBe("p1");
    expect(faseDaTroca(estado({ request: pedido({ status: "running" }) }), AGORA).fase).toBe(FASES_DA_TROCA.APLICANDO);
  });

  it("aguardando confirmação: minha, de outra pessoa, ou vencida", () => {
    expect(faseDaTroca(estado({ request: pedido() }), AGORA).fase).toBe(FASES_DA_TROCA.CONFIRMAR);
    expect(faseDaTroca(estado({ request: pedido({ mine: false }) }), AGORA).fase).toBe(FASES_DA_TROCA.AGUARDANDO_OUTRA_PESSOA);
    const vencida = faseDaTroca(estado({ request: pedido({ confirmUntil: daqui(-1000) }) }), AGORA);
    expect(vencida.fase).toBe(FASES_DA_TROCA.ESCOLHER);
    expect(vencida.ultimo).toBeNull();
  });

  it("o desfecho do último pedido acompanha a fase", () => {
    const aplicado = pedido({ status: "applied", appliedAt: daqui(-1000) });
    const leitura = faseDaTroca(estado({ request: aplicado, sessionReleasedAt: daqui(-1000) }), AGORA);
    expect(leitura.fase).toBe(FASES_DA_TROCA.ESCOLHER);
    expect(leitura.ultimo.status).toBe("applied");
    expect(leitura.pedido).toBeNull();
  });
});

describe("repetir e cancelar", () => {
  const falhou = pedido({ status: "failed", confirmedAt: daqui(-60 * 60 * 1000), errorCode: "bridge_offline" });

  it("repete o que falhou há menos de 24 h, sob a mesma liberação", () => {
    expect(podeRepetir(falhou, estado(), AGORA)).toBe(true);
    expect(podeRepetir({ ...falhou, confirmedAt: daqui(-25 * 60 * 60 * 1000) }, estado(), AGORA)).toBe(false);
    expect(podeRepetir(falhou, estado({ mode: "whatsapp_code" }), AGORA)).toBe(false);
    expect(podeRepetir(falhou, estado({ actorAllowed: false }), AGORA)).toBe(false);
    expect(podeRepetir({ ...falhou, confirmedAt: null }, estado(), AGORA)).toBe(false);
  });

  it("cancela só antes de a VPS pegar", () => {
    expect(podeCancelar(pedido())).toBe(true);
    expect(podeCancelar(pedido({ status: "queued", commandStatus: "pending" }))).toBe(true);
    expect(podeCancelar(pedido({ status: "queued", commandStatus: "claimed" }))).toBe(false);
    expect(podeCancelar(pedido({ status: "running" }))).toBe(false);
    expect(podeCancelar(null)).toBe(false);
  });

  it("a fila conta se a VPS está respondendo", () => {
    expect(textoDaFila(pedido({ status: "queued" }), false)).toContain("não está respondendo");
    expect(textoDaFila(pedido({ status: "running" }), true)).toContain("aplicando agora");
    expect(textoDaFila(pedido({ status: "queued", commandStatus: "pending" }), true)).toContain("Na fila");
  });
});

describe("o que dizer", () => {
  it("traduz a recusa do banco e nunca mostra o texto cru", () => {
    expect(mensagemDaRecusa(new Error("direct connection change requires a platform administrator")))
      .toBe("Nesta fase, a troca deste número é feita pela equipe do Núcleo Major.");
    expect(mensagemDaRecusa({ motivo: "old whatsapp is not connected" })).toContain("precisa estar conectado");
    expect(mensagemDaRecusa(new Error("same number: reconnect instead of changing"))).toContain("Conectar WhatsApp");
    const desconhecida = mensagemDaRecusa(new Error("relation x does not exist at character 42"));
    expect(desconhecida).toBe("Não foi possível concluir agora. Tente de novo em instantes.");
  });

  it("traduz o motivo gravado no pedido", () => {
    expect(motivoDoPedido("bridge_offline")).toBe("A VPS não respondeu.");
    expect(motivoDoPedido("stale-generation")).toContain("mais novo");
    expect(motivoDoPedido("confirmation-unsupported_command")).toContain("não chegou ao WhatsApp antigo");
    expect(motivoDoPedido("algo-novo")).toBe("A troca não foi aplicada.");
    expect(motivoDoPedido("")).toBe("");
  });

  it("diz quantas tentativas restam", () => {
    expect(mensagemDaConfirmacao({ confirmed: false, result: "invalid-code", attemptsLeft: 3 })).toBe("Código incorreto. Restam 3 tentativas.");
    expect(mensagemDaConfirmacao({ confirmed: false, result: "invalid-code", attemptsLeft: 1 })).toBe("Código incorreto. Resta 1 tentativa.");
    expect(mensagemDaConfirmacao({ confirmed: false, result: "expired" })).toContain("10 minutos");
    expect(mensagemDaConfirmacao({ confirmed: true })).toBe("");
  });
});

describe("telefone", () => {
  it("normaliza como a RPC: DDD + número ganham o 55", () => {
    expect(normalizarTelefone("(65) 99999-7777")).toBe("5565999997777");
    expect(normalizarTelefone("+55 65 9999-7777")).toBe("556599997777");
    expect(telefoneValido(normalizarTelefone("(65) 99999-7777"))).toBe(true);
    expect(telefoneValido(normalizarTelefone("123"))).toBe(false);
  });

  it("mostra o número inteiro para conferir antes de confirmar", () => {
    expect(telefoneLegivel("5565999997777")).toBe("+55 (65) 99999-7777");
    expect(telefoneLegivel("556599997777")).toBe("+55 (65) 9999-7777");
    expect(telefoneLegivel("14155550100")).toBe("+14155550100");
  });
});
