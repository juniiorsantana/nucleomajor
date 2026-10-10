// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * A troca voluntária de WhatsApp na tela de Conexões.
 *
 * O que estes testes prendem: a tela nunca diz que trocou antes de o banco
 * dizer `applied`; a confirmação mostra o número inteiro que a pessoa
 * digitou; a recusa do servidor chega traduzida; e o que a tela esconde não
 * é proteção — quem barra é o banco, aqui representado pelo dublê.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gateway = {
  trocaEstado: vi.fn(),
  trocaIniciar: vi.fn(),
  trocaConfirmar: vi.fn(),
  trocaCancelar: vi.fn(),
  trocaRepetir: vi.fn(),
  trocaReenviar: vi.fn(),
};
vi.mock("../../../data/client", () => ({ api: { gateway } }));

const { TrocaDeWhatsApp } = await import("./TrocaDeWhatsApp");

const ORG = "org-major";
const CONEXAO = { connectionId: "8ee1e6d0-0000-4000-8000-000000000001", name: "WhatsApp principal" };
const daqui = (ms) => new Date(Date.now() + ms).toISOString();

let estadoAtual;
let raiz;
let container;

function estado(extra = {}) {
  return {
    mode: "direct",
    actorAllowed: true,
    sessionReleasedAt: null,
    request: null,
    identity: { last4: "8362", generation: 0 },
    runtime: { whatsappStatus: "connected", fresh: true, heartbeatAt: daqui(-5000) },
    ...extra,
  };
}

function pedido(extra = {}) {
  return {
    requestId: "pedido-1",
    kind: "change_number",
    status: "awaiting_confirmation",
    confirmationMethod: "direct",
    oldLast4: "8362",
    newLast4: "7777",
    mine: true,
    confirmUntil: daqui(10 * 60 * 1000),
    attemptsLeft: 5,
    sendsLeft: 3,
    confirmedAt: null,
    generation: null,
    appliedAt: null,
    remoteLogout: null,
    errorCode: null,
    commandStatus: null,
    ...extra,
  };
}

async function montar(aoMudar = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz.render(<TrocaDeWhatsApp organizationId={ORG} conexao={CONEXAO} aoMudar={aoMudar} />));
  await act(async () => {});
  return aoMudar;
}

const botao = (texto) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent.trim().includes(texto)) || null;

async function clicar(texto) {
  const alvo = botao(texto);
  if (!alvo) throw new Error(`botão "${texto}" não está na tela: ${container.textContent}`);
  await act(async () => alvo.click());
  await act(async () => {});
}

async function digitar(input, valor) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function enviarFormulario() {
  await act(async () => container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => {});
}

// Cada leitura devolve o estado do "banco" naquele momento.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  for (const fn of Object.values(gateway)) fn.mockReset();
  estadoAtual = estado();
  gateway.trocaEstado.mockImplementation(async () => estadoAtual);
});
afterEach(async () => {
  await act(async () => raiz?.unmount());
  container?.remove();
  vi.useRealTimers();
});

describe("a operação controlada da Major ('direct')", () => {
  it("troca de número: pede, confere o número inteiro, confirma e só diz pronto quando o banco diz applied", async () => {
    const aoMudar = await montar();
    expect(gateway.trocaEstado).toHaveBeenCalledWith({ organizationId: ORG, connectionId: CONEXAO.connectionId });
    // Recolhida até alguém abrir: a tela de conexões não grita.
    expect(container.textContent).not.toContain("Número novo");
    await clicar("Trocar ou desconectar o número");

    const campo = container.querySelector("input[type=tel]");
    await digitar(campo, "(65) 99999-7777");
    gateway.trocaIniciar.mockImplementation(async () => {
      estadoAtual = estado({ request: pedido() });
      return pedido({ repeated: false });
    });
    await enviarFormulario();

    expect(gateway.trocaIniciar).toHaveBeenCalledTimes(1);
    const chamada = gateway.trocaIniciar.mock.calls[0][0];
    expect(chamada).toMatchObject({
      organizationId: ORG,
      connectionId: CONEXAO.connectionId,
      tipo: "change_number",
      telefone: "5565999997777",
      importarHistorico: false,
    });
    expect(chamada.chave).toMatch(/^[0-9a-f-]{8,64}$/i);

    // A confirmação mostra o número inteiro e o que acontece com as conversas.
    expect(container.textContent).toContain("Trocar o WhatsApp desta conexão?");
    expect(container.textContent).toContain("+55 (65) 99999-7777");
    expect(container.textContent).toContain("Conversas, contatos e funil continuam aqui");

    gateway.trocaConfirmar.mockImplementation(async () => {
      estadoAtual = estado({ request: pedido({ status: "queued", confirmedAt: daqui(0), generation: 1, commandStatus: "pending" }) });
      return { confirmed: true };
    });
    await clicar("Trocar para o final 7777");
    expect(gateway.trocaConfirmar).toHaveBeenCalledWith({ organizationId: ORG, pedidoId: "pedido-1", codigo: null });

    // Na fila não é sucesso.
    expect(container.textContent).toContain("Trocando para o número final 7777");
    expect(container.textContent).toContain("Na fila da VPS");
    expect(container.textContent).not.toContain("Pronto para o número novo");
    expect(aoMudar).not.toHaveBeenCalled();

    // A VPS aplicou.
    estadoAtual = estado({
      sessionReleasedAt: daqui(0),
      runtime: { whatsappStatus: "whatsapp_disconnected", fresh: true },
      request: pedido({ status: "applied", confirmedAt: daqui(-3000), generation: 1, appliedAt: daqui(0), remoteLogout: true }),
    });
    await act(async () => vi.advanceTimersByTime(3000));
    await act(async () => {});
    expect(container.textContent).toContain("Pronto para o número novo, final 7777");
    expect(container.textContent).toContain("Conectar WhatsApp");
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("o duplo clique leva a mesma chave: o banco devolve o mesmo pedido", async () => {
    await montar();
    await clicar("Trocar ou desconectar o número");
    await digitar(container.querySelector("input[type=tel]"), "65999997777");
    gateway.trocaIniciar.mockImplementation(async () => pedido());
    const formulario = container.querySelector("form");
    await act(async () => {
      formulario.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      formulario.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
    const chaves = gateway.trocaIniciar.mock.calls.map(([args]) => args.chave);
    expect(chaves.length).toBeGreaterThanOrEqual(1);
    expect(new Set(chaves).size).toBe(1);
  });

  it("só desconectar: a confirmação diz o que sai e que nada mais sai pela conexão", async () => {
    await montar();
    await clicar("Trocar ou desconectar o número");
    const opcao = [...container.querySelectorAll("input[type=radio]")].find((r) => r.value === "disconnect");
    await act(async () => opcao.click());
    expect(container.querySelector("input[type=tel]")).toBeNull();
    gateway.trocaIniciar.mockImplementation(async () => {
      estadoAtual = estado({ request: pedido({ kind: "disconnect", newLast4: null }) });
      return pedido({ kind: "disconnect", newLast4: null });
    });
    await enviarFormulario();
    expect(gateway.trocaIniciar.mock.calls[0][0]).toMatchObject({ tipo: "disconnect", telefone: null, importarHistorico: false });
    expect(container.textContent).toContain("Desconectar o WhatsApp desta conexão?");
    expect(container.textContent).toContain("nada sai por esta conexão");
    expect(botao("Desconectar o final 8362")).not.toBeNull();
  });

  it("a recusa do servidor chega traduzida, nunca crua", async () => {
    await montar();
    await clicar("Trocar ou desconectar o número");
    await digitar(container.querySelector("input[type=tel]"), "65999997777");
    gateway.trocaIniciar.mockRejectedValue(Object.assign(new Error("direct connection change requires a platform administrator"), {
      motivo: "direct connection change requires a platform administrator",
    }));
    await enviarFormulario();
    expect(container.textContent).toContain("feita pela equipe do Núcleo Major");
    expect(container.textContent).not.toContain("platform administrator");
  });

  it("quem não é da equipe vê que a troca é com a equipe, sem formulário", async () => {
    estadoAtual = estado({ actorAllowed: false });
    await montar();
    await clicar("Trocar ou desconectar o número");
    expect(container.textContent).toContain("Nesta fase, a troca deste número é feita pela equipe do Núcleo Major.");
    expect(container.querySelector("form")).toBeNull();
  });

  it("sem liberação, a tela diz isso e não oferece nada", async () => {
    estadoAtual = estado({ mode: "off", actorAllowed: false });
    await montar();
    await clicar("Trocar ou desconectar o número");
    expect(container.textContent).toContain("ainda não foi liberada para esta conexão");
    expect(container.querySelector("form")).toBeNull();
  });

  it("o número que caiu sozinho não entra pela troca voluntária", async () => {
    estadoAtual = estado({ runtime: { whatsappStatus: "logged_out", fresh: true } });
    await montar();
    await clicar("Trocar ou desconectar o número");
    expect(container.textContent).toContain("precisa estar conectado");
    expect(container.querySelector("form")).toBeNull();
  });
});

describe("pedido em andamento e falhas recuperáveis", () => {
  it("um pedido na fila abre a seção sozinho e pode ser cancelado enquanto a VPS não pegou", async () => {
    estadoAtual = estado({
      runtime: { whatsappStatus: "connected", fresh: false },
      request: pedido({ status: "queued", confirmedAt: daqui(-1000), generation: 2, commandStatus: "pending" }),
    });
    await montar();
    expect(container.textContent).toContain("Trocando para o número final 7777");
    expect(container.textContent).toContain("A VPS não está respondendo");
    gateway.trocaCancelar.mockImplementation(async () => {
      estadoAtual = estado({ request: pedido({ status: "cancelled" }) });
      return { cancelled: true };
    });
    await clicar("Cancelar");
    expect(gateway.trocaCancelar).toHaveBeenCalledWith({ organizationId: ORG, pedidoId: "pedido-1" });
  });

  it("com a VPS aplicando, não há botão de cancelar", async () => {
    estadoAtual = estado({ request: pedido({ status: "running", confirmedAt: daqui(-1000), generation: 2, commandStatus: "claimed" }) });
    await montar();
    expect(container.textContent).toContain("A VPS está aplicando agora");
    expect(botao("Cancelar")).toBeNull();
  });

  it("a falha diz o motivo e oferece repetir sem confirmar de novo", async () => {
    estadoAtual = estado({
      request: pedido({ status: "failed", confirmedAt: daqui(-60 * 1000), generation: 2, errorCode: "bridge_offline" }),
    });
    await montar();
    expect(container.textContent).toContain("A troca de número não foi aplicada.");
    expect(container.textContent).toContain("A VPS não respondeu.");
    gateway.trocaRepetir.mockImplementation(async () => {
      estadoAtual = estado({ request: pedido({ status: "queued", confirmedAt: daqui(-60 * 1000), generation: 3, commandStatus: "pending" }) });
      return {};
    });
    await clicar("Tentar de novo");
    expect(gateway.trocaRepetir).toHaveBeenCalledWith({ organizationId: ORG, pedidoId: "pedido-1" });
    expect(container.textContent).toContain("Trocando para o número final 7777");
  });

  it("desconectado sem confirmação do WhatsApp: pede para remover o aparelho no celular antigo", async () => {
    estadoAtual = estado({
      sessionReleasedAt: daqui(-1000),
      runtime: { whatsappStatus: "whatsapp_disconnected", fresh: true },
      request: pedido({ kind: "disconnect", newLast4: null, status: "applied", confirmedAt: daqui(-5000), appliedAt: daqui(-1000), remoteLogout: false }),
    });
    await montar();
    expect(container.textContent).toContain("Desconectado em");
    expect(container.textContent).toContain("Aparelhos conectados");
    // Desconectada por escolha, dá para conectar outro número daqui.
    expect(container.querySelector("input[type=tel]")).not.toBeNull();
  });
});

describe("o desenho da liberação geral ('whatsapp_code')", () => {
  it("pede o código do WhatsApp antigo e diz quantas tentativas restam", async () => {
    estadoAtual = estado({ mode: "whatsapp_code", request: pedido({ confirmationMethod: "whatsapp_code" }) });
    await montar();
    expect(container.textContent).toContain("Confirme no WhatsApp final 8362");
    const campo = [...container.querySelectorAll("input")].find((i) => i.autocomplete === "one-time-code");
    await digitar(campo, "ab12-cd34");
    expect(campo.value).toBe("ab12cd34");
    gateway.trocaConfirmar.mockResolvedValue({ confirmed: false, result: "invalid-code", attemptsLeft: 4 });
    await clicar("Confirmar");
    expect(gateway.trocaConfirmar).toHaveBeenCalledWith({ organizationId: ORG, pedidoId: "pedido-1", codigo: "ab12cd34" });
    expect(container.textContent).toContain("Código incorreto. Restam 4 tentativas.");
  });

  it("o código que não chegou aparece com o motivo", async () => {
    estadoAtual = estado({
      mode: "whatsapp_code",
      request: pedido({ confirmationMethod: "whatsapp_code", errorCode: "confirmation-unsupported_command" }),
    });
    await montar();
    expect(container.textContent).toContain("O código não chegou ao WhatsApp antigo.");
  });
});
