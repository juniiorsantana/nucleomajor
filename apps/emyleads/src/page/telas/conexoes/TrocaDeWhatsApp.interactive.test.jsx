// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * Desconectar e trocar o número do WhatsApp, pelo cartão de Conexões.
 *
 * O desenho desde 11/10/2026: desconectar é uma ação só, e o número se
 * escolhe na hora de conectar de novo (o desta conexão, ou outro). Antes, as
 * duas coisas eram uma escolha só, feita antes de desconectar, e o dono da
 * Major desconectou, viu o QR do número antigo e só então trocou.
 *
 * O que estes testes prendem: a tela nunca diz que trocou antes de o banco
 * dizer `applied`; a confirmação mostra o número inteiro que a pessoa
 * digitou; o QR do número novo vem sozinho; e as recusas (do banco e da VPS)
 * chegam traduzidas. O que a tela esconde não é proteção: quem barra é o
 * banco, aqui representado pelo dublê.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gatewayApi = {
  conexoes: vi.fn(),
  resumoAtendimento: vi.fn(),
  prontidao: vi.fn(),
  qr: vi.fn(),
  parear: vi.fn(),
  ativarRealtime: vi.fn(),
  trocaEstado: vi.fn(),
  trocaIniciar: vi.fn(),
  trocaConfirmar: vi.fn(),
  trocaCancelar: vi.fn(),
  trocaRepetir: vi.fn(),
  trocaReenviar: vi.fn(),
};
const configApi = { ler: vi.fn() };
const organizacoesApi = { robos: vi.fn() };

vi.mock("../../../data/client", () => ({
  api: { gateway: gatewayApi, config: configApi, organizacoes: organizacoesApi },
}));

const { default: Conexoes } = await import("../Conexoes");

const ORG = "org-major";
const CONEXAO = "8ee1e6d0-0000-4000-8000-000000000001";
const organizacao = { id: ORG, name: "Núcleo Major", papel: "owner" };
const QR = { status: "awaiting_qr", imageData: "data:image/png;base64,QUJD" };
const daqui = (ms) => new Date(Date.now() + ms).toISOString();

/** A conexão como `api.gateway.conexoes` a devolve (o cartão). */
function conexao(status, extra = {}) {
  return {
    connectionId: CONEXAO,
    name: "WhatsApp principal (8362)",
    runtime: "online",
    host: "vps-nucleo",
    remoteManaged: true,
    expectedPhoneMasked: "•••• 8362",
    controlPlane: { heartbeat_at: daqui(-5000), fresh: true },
    connection: { status, phoneMasked: status === "connected" ? "•••• 8362" : null, updatedAt: daqui(0) },
    ...extra,
  };
}

/** A troca como o banco a devolve (`nucleo_connection_change_status`). */
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

// Desconectado pelo portal: a conexão está liberada e espera o número dela.
const LIBERADA = () => ({
  sessionReleasedAt: daqui(-60000),
  runtime: { whatsappStatus: "whatsapp_disconnected", fresh: true },
});

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

const desconexaoAplicada = (extra = {}) =>
  pedido({
    kind: "disconnect",
    newLast4: null,
    status: "applied",
    confirmedAt: daqui(-61000),
    generation: 1,
    appliedAt: daqui(-60000),
    remoteLogout: true,
    ...extra,
  });

let cartao;
let banco;
let container;
let root;

async function assentar() {
  for (let volta = 0; volta < 4; volta += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function montar() {
  await act(async () => {
    root.render(<Conexoes organizacao={organizacao} usuario={{ id: "u1", nome: "Ana" }} />);
  });
  await assentar();
}

async function passar(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await assentar();
}

const botoes = () => [...container.querySelectorAll("button")];
const botao = (texto) => botoes().find((b) => b.textContent.trim().includes(texto)) || null;
const botaoExato = (texto) => botoes().find((b) => b.textContent.trim() === texto) || null;

async function clicar(texto, { exato = false } = {}) {
  const alvo = exato ? botaoExato(texto) : botao(texto);
  if (!alvo) throw new Error(`botão "${texto}" não está na tela: ${container.textContent}`);
  await act(async () => alvo.click());
  await assentar();
}

async function escolher(titulo) {
  const opcao = [...container.querySelectorAll("label")].find((l) => l.textContent.includes(titulo));
  if (!opcao) throw new Error(`opção "${titulo}" não está na tela`);
  await act(async () => opcao.querySelector("input").click());
  await assentar();
}

async function digitar(input, valor) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function enviarEscolha() {
  await act(async () =>
    container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  await assentar();
}

/** Abre "Conectar WhatsApp", escolhe outro número e chega à conferência. */
async function irAteConferir(numero = "(65) 99999-7777") {
  await clicar("Conectar WhatsApp");
  await escolher("Outro número");
  await digitar(container.querySelector("input[type=tel]"), numero);
  await enviarEscolha();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  for (const fn of [...Object.values(gatewayApi), configApi.ler, organizacoesApi.robos]) fn.mockReset();
  cartao = conexao("connected");
  banco = estado();
  gatewayApi.conexoes.mockImplementation(async () => ({
    organizationId: ORG,
    vinculado: true,
    gateway: "cloud",
    conexoes: [cartao],
  }));
  gatewayApi.trocaEstado.mockImplementation(async () => banco);
  gatewayApi.resumoAtendimento.mockResolvedValue({
    iaAtiva: true,
    donoPadrao: "ia",
    abertas: { bot: 0, ia: 0, humano: 0 },
    conversations: [],
    remoteSummary: true,
  });
  gatewayApi.prontidao.mockResolvedValue(null);
  gatewayApi.qr.mockResolvedValue(null);
  gatewayApi.parear.mockResolvedValue({ status: "starting_pairing" });
  gatewayApi.ativarRealtime.mockResolvedValue(undefined);
  configApi.ler.mockResolvedValue(null);
  organizacoesApi.robos.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("o cartão", () => {
  it("o nome da conexão aparece sem o número, que tem linha própria", async () => {
    await montar();
    const titulo = container.querySelector("section:has(details) h2");
    expect(titulo.textContent).toBe("WhatsApp principal");
    expect(container.textContent).toContain("•••• 8362");
    // Uma chave de JSX sobrando vira texto na tela; já aconteceu.
    expect(titulo.closest("section").textContent).not.toMatch(/[{}]/);
  });

  it("a recusa do QR chega em português, nunca como o código da VPS", async () => {
    cartao = conexao("logged_out");
    banco = estado({ mode: "off", actorAllowed: false, runtime: { whatsappStatus: "logged_out", fresh: true } });
    gatewayApi.parear.mockRejectedValue(Object.assign(new Error("pairing_in_progress"), { codigo: "pareamento-recusado" }));
    await montar();
    await clicar("Conectar WhatsApp");
    expect(container.textContent).toContain("Já existe um QR aberto para esta conexão.");
    expect(container.textContent).not.toContain("pairing_in_progress");
  });
});

describe("desconectar", () => {
  it("é uma ação só: mostra o que acontece, pede e confirma em sequência, e não pergunta número", async () => {
    await montar();
    // Nada de escolher número antes de desconectar.
    expect(container.querySelector("input[type=tel]")).toBeNull();
    expect(container.textContent).not.toContain("Trocar por outro número");

    await clicar("Desconectar este WhatsApp");
    expect(container.textContent).toContain("Desconectar o WhatsApp final 8362?");
    expect(container.textContent).toContain("A IA e os fluxos param de responder");
    expect(container.textContent).toContain("dá para usar o mesmo número ou outro");
    expect(gatewayApi.trocaIniciar).not.toHaveBeenCalled();

    gatewayApi.trocaIniciar.mockImplementation(async () => {
      banco = estado({ request: pedido({ kind: "disconnect", newLast4: null }) });
      return pedido({ kind: "disconnect", newLast4: null, repeated: false });
    });
    gatewayApi.trocaConfirmar.mockImplementation(async () => {
      banco = estado({
        request: pedido({ kind: "disconnect", newLast4: null, status: "queued", confirmedAt: daqui(0), generation: 1, commandStatus: "pending" }),
      });
      return { confirmed: true };
    });
    await clicar("Desconectar", { exato: true });

    const chamada = gatewayApi.trocaIniciar.mock.calls[0][0];
    expect(chamada).toMatchObject({
      organizationId: ORG,
      connectionId: CONEXAO,
      tipo: "disconnect",
      telefone: null,
      importarHistorico: false,
    });
    expect(chamada.chave).toMatch(/^[0-9a-f-]{8,64}$/i);
    expect(gatewayApi.trocaConfirmar).toHaveBeenCalledWith({ organizationId: ORG, pedidoId: "pedido-1", codigo: null });
    // Na fila não é sucesso.
    expect(container.textContent).toContain("Desconectando o WhatsApp final 8362…");
    expect(container.textContent).toContain("Na fila da VPS");
    expect(botao("Desconectar este WhatsApp")).toBeNull();

    // A VPS aplicou, mas o sinal dela ainda diz "conectado": continua desconectando.
    banco = estado({ ...LIBERADA(), request: desconexaoAplicada({ appliedAt: daqui(0) }) });
    await passar(3000);
    expect(container.textContent).toContain("Já foi desconectado; o cartão atualiza em alguns segundos.");

    // O sinal virou: desconectado, e o caminho de volta é Conectar WhatsApp.
    cartao = conexao("whatsapp_disconnected");
    await passar(2500);
    expect(container.textContent).toContain("Desconectado em");
    expect(container.textContent).toContain("•••• 8362 · ainda não conectado");
    expect(botao("Conectar WhatsApp")).not.toBeNull();
    expect(botao("Desconectar este WhatsApp")).toBeNull();
  });

  it("sem confirmação do WhatsApp, pede para remover o aparelho no celular antigo", async () => {
    cartao = conexao("whatsapp_disconnected");
    banco = estado({ ...LIBERADA(), request: desconexaoAplicada({ remoteLogout: false }) });
    await montar();
    expect(container.textContent).toContain("Desconectado em");
    expect(container.textContent).toContain("Aparelhos conectados e remova o aparelho");
  });

  it("QR lido pelo celular errado depois de uma troca: o cartão diz como consertar, e o conserto é desconectar", async () => {
    cartao = conexao("identity_mismatch", {
      expectedPhoneMasked: "•••• 7777",
      connection: { status: "identity_mismatch", phoneMasked: "•••• 0000", expectedPhoneMasked: "•••• 7777", updatedAt: daqui(0) },
    });
    banco = estado({
      sessionReleasedAt: daqui(-60000),
      runtime: { whatsappStatus: "identity_mismatch", fresh: true },
      request: pedido({ status: "applied", appliedAt: daqui(-60000), confirmedAt: daqui(-61000), generation: 2 }),
    });
    await montar();
    expect(container.textContent).toContain("O QR foi lido pelo celular •••• 0000, mas esta conexão espera •••• 7777.");
    expect(container.textContent).not.toContain("Corrija pelo administrador");
    await clicar("Desconectar este WhatsApp");
    expect(container.textContent).toContain("Desconectar o WhatsApp final 0000?");
  });

  it("a recusa do banco aparece dentro do painel, traduzida, e o painel continua aberto", async () => {
    await montar();
    await clicar("Desconectar este WhatsApp");
    gatewayApi.trocaIniciar.mockRejectedValue(Object.assign(new Error("runtime is not online"), { motivo: "runtime is not online" }));
    await clicar("Desconectar", { exato: true });
    expect(container.textContent).toContain("A VPS desta conexão não está respondendo agora.");
    expect(container.textContent).not.toContain("runtime is not online");
    expect(container.textContent).toContain("Desconectar o WhatsApp final 8362?");
  });
});

describe("conectar de novo: o mesmo número ou outro", () => {
  it("depois de desconectar, Conectar WhatsApp pergunta qual número; o mesmo vai direto para o QR", async () => {
    cartao = conexao("whatsapp_disconnected");
    banco = estado({ ...LIBERADA(), request: desconexaoAplicada() });
    await montar();
    await clicar("Conectar WhatsApp");
    expect(gatewayApi.parear).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Qual WhatsApp você vai conectar?");
    expect(container.textContent).toContain("O número final 8362");

    gatewayApi.qr.mockResolvedValue(QR);
    await enviarEscolha();
    expect(gatewayApi.parear).toHaveBeenCalledWith({ organizationId: ORG, connectionId: CONEXAO, remoto: true });
    expect(gatewayApi.trocaIniciar).not.toHaveBeenCalled();
    expect(container.querySelector("img[alt*='QR Code']")).not.toBeNull();
    expect(container.textContent).not.toContain("Qual WhatsApp você vai conectar?");
  });

  it("outro número: confere o número inteiro, troca, e o QR do número novo aparece sozinho", async () => {
    cartao = conexao("whatsapp_disconnected");
    banco = estado({ ...LIBERADA(), request: desconexaoAplicada() });
    await montar();
    await irAteConferir();

    expect(container.textContent).toContain("Conectar o +55 (65) 99999-7777?");
    expect(container.textContent).toContain("Quem escrever para o final 8362 não chega mais ao portal.");
    expect(container.textContent).toContain("as antigas deste celular ficam de fora");

    gatewayApi.trocaIniciar.mockImplementation(async () => {
      banco = estado({ ...LIBERADA(), request: pedido() });
      return pedido({ repeated: false });
    });
    gatewayApi.trocaConfirmar.mockImplementation(async () => {
      banco = estado({ ...LIBERADA(), request: pedido({ status: "queued", confirmedAt: daqui(0), generation: 2, commandStatus: "pending" }) });
      return { confirmed: true };
    });
    await clicar("Confirmar e mostrar o QR");

    expect(gatewayApi.trocaIniciar.mock.calls[0][0]).toMatchObject({
      organizationId: ORG,
      connectionId: CONEXAO,
      tipo: "change_number",
      telefone: "5565999997777",
      importarHistorico: false,
    });
    expect(gatewayApi.trocaConfirmar).toHaveBeenCalledWith({ organizationId: ORG, pedidoId: "pedido-1", codigo: null });
    expect(container.textContent).toContain("Preparando a conexão para +55 (65) 99999-7777…");
    expect(container.textContent).toContain("O QR aparece aqui assim que terminar.");
    expect(gatewayApi.parear).not.toHaveBeenCalled();
    // Conectar agora pediria o QR do número que está saindo.
    expect(botao("Conectar WhatsApp")).toBeNull();

    // A VPS aplicou: a conexão espera o 7777, e o QR é pedido sem outro clique.
    banco = estado({
      ...LIBERADA(),
      identity: { last4: "7777", generation: 2 },
      request: pedido({ status: "applied", confirmedAt: daqui(-3000), generation: 2, appliedAt: daqui(0) }),
    });
    cartao = conexao("whatsapp_disconnected", { expectedPhoneMasked: "•••• 7777" });
    gatewayApi.qr.mockResolvedValue(QR);
    await passar(3000);
    expect(gatewayApi.parear).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img[alt*='QR Code']")).not.toBeNull();
    expect(container.textContent).toContain("do número final 7777");
    expect(container.textContent).toContain("Número trocado para o final 7777");
  });

  it("o duplo clique leva a mesma chave: o banco devolve o mesmo pedido", async () => {
    cartao = conexao("whatsapp_disconnected");
    banco = estado({ ...LIBERADA(), request: desconexaoAplicada() });
    await montar();
    await irAteConferir("65999997777");
    gatewayApi.trocaIniciar.mockImplementation(async () => pedido());
    gatewayApi.trocaConfirmar.mockResolvedValue({ confirmed: true });
    const alvo = botao("Confirmar e mostrar o QR");
    await act(async () => {
      alvo.click();
      alvo.click();
    });
    await assentar();
    const chaves = gatewayApi.trocaIniciar.mock.calls.map(([args]) => args.chave);
    expect(chaves.length).toBeGreaterThanOrEqual(1);
    expect(new Set(chaves).size).toBe(1);
  });

  it("o número desta conexão digitado como 'outro' volta com a explicação, e dá para corrigir", async () => {
    cartao = conexao("whatsapp_disconnected");
    banco = estado({ ...LIBERADA(), request: desconexaoAplicada() });
    await montar();
    await irAteConferir("(65) 99999-8362");
    gatewayApi.trocaIniciar.mockRejectedValue(Object.assign(new Error("same number: reconnect instead of changing"), {
      motivo: "same number: reconnect instead of changing",
    }));
    await clicar("Confirmar e mostrar o QR");
    expect(container.textContent).toContain("Esse já é o número desta conexão.");
    expect(container.textContent).not.toContain("reconnect instead");
    await clicar("Corrigir o número");
    expect(container.textContent).toContain("Qual WhatsApp você vai conectar?");
  });

  it("com o QR do número desta conexão na tela, dá para trocar o número dali mesmo", async () => {
    cartao = conexao("awaiting_qr");
    banco = estado({ sessionReleasedAt: daqui(-60000), runtime: { whatsappStatus: "awaiting_qr", fresh: true }, request: desconexaoAplicada() });
    gatewayApi.qr.mockResolvedValue(QR);
    await montar();
    expect(container.querySelector("img[alt*='QR Code']")).not.toBeNull();
    await clicar("Trocar o número");
    expect(container.textContent).toContain("Qual WhatsApp você vai conectar?");
    // Já aberto em "Outro número", e o QR antigo sai da frente.
    expect(container.querySelector("input[type=tel]")).not.toBeNull();
    expect(container.querySelector("img[alt*='QR Code']")).toBeNull();
  });

  it("o número que caiu sozinho volta pelo QR do mesmo número; outro número é com a equipe", async () => {
    cartao = conexao("logged_out");
    banco = estado({ runtime: { whatsappStatus: "logged_out", fresh: true } });
    await montar();
    expect(container.textContent).toContain("Para conectar outro número no lugar deste, fale com a equipe do Núcleo Major.");
    await clicar("Conectar WhatsApp");
    expect(gatewayApi.parear).toHaveBeenCalled();
    expect(container.textContent).not.toContain("Qual WhatsApp você vai conectar?");
  });
});

describe("quem pode", () => {
  it("sem liberação (os clientes, hoje): sem Desconectar, e o cartão diz com quem falar", async () => {
    banco = estado({ mode: "off", actorAllowed: false });
    await montar();
    expect(botao("Desconectar este WhatsApp")).toBeNull();
    expect(container.textContent).toContain("Para trocar o número deste WhatsApp, fale com a equipe do Núcleo Major.");
  });

  it("na liberação direta, quem não é da equipe da plataforma não desconecta", async () => {
    banco = estado({ actorAllowed: false });
    await montar();
    expect(botao("Desconectar este WhatsApp")).toBeNull();
    expect(container.textContent).toContain("Nesta fase, a troca deste número é feita pela equipe do Núcleo Major.");
  });
});

describe("pedido em andamento e falhas recuperáveis", () => {
  it("um pedido parado na fila aparece no cartão e pode ser cancelado enquanto a VPS não pegou", async () => {
    banco = estado({
      runtime: { whatsappStatus: "connected", fresh: false },
      request: pedido({ status: "queued", confirmedAt: daqui(-1000), generation: 2, commandStatus: "pending" }),
    });
    await montar();
    expect(container.textContent).toContain("Preparando a conexão para o número final 7777…");
    expect(container.textContent).toContain("A VPS não está respondendo");
    gatewayApi.trocaCancelar.mockImplementation(async () => {
      banco = estado({ request: pedido({ status: "cancelled" }) });
      return { cancelled: true };
    });
    await clicar("Cancelar", { exato: true });
    expect(gatewayApi.trocaCancelar).toHaveBeenCalledWith({ organizationId: ORG, pedidoId: "pedido-1" });
  });

  it("com a VPS aplicando, não há botão de cancelar", async () => {
    banco = estado({ request: pedido({ status: "running", confirmedAt: daqui(-1000), generation: 2, commandStatus: "claimed" }) });
    await montar();
    expect(container.textContent).toContain("A VPS está aplicando agora");
    expect(botaoExato("Cancelar")).toBeNull();
  });

  it("a falha diz o motivo; repetir uma troca também traz o QR sozinho no fim", async () => {
    cartao = conexao("whatsapp_disconnected");
    banco = estado({
      ...LIBERADA(),
      request: pedido({ status: "failed", confirmedAt: daqui(-60 * 1000), generation: 2, errorCode: "bridge_offline" }),
    });
    await montar();
    expect(container.textContent).toContain("A troca de número não foi aplicada.");
    expect(container.textContent).toContain("A VPS não respondeu.");

    gatewayApi.trocaRepetir.mockImplementation(async () => {
      banco = estado({
        ...LIBERADA(),
        request: pedido({ status: "queued", confirmedAt: daqui(-60 * 1000), generation: 3, commandStatus: "pending" }),
      });
      return {};
    });
    await clicar("Tentar de novo");
    expect(gatewayApi.trocaRepetir).toHaveBeenCalledWith({ organizationId: ORG, pedidoId: "pedido-1" });
    expect(container.textContent).toContain("Preparando a conexão para o número final 7777…");

    banco = estado({
      ...LIBERADA(),
      request: pedido({ status: "applied", confirmedAt: daqui(-60 * 1000), generation: 3, appliedAt: daqui(0) }),
    });
    cartao = conexao("whatsapp_disconnected", { expectedPhoneMasked: "•••• 7777" });
    await passar(3000);
    expect(gatewayApi.parear).toHaveBeenCalledTimes(1);
  });
});

describe("o desenho da liberação geral ('whatsapp_code')", () => {
  it("pede o código do WhatsApp antigo e diz quantas tentativas restam", async () => {
    banco = estado({ mode: "whatsapp_code", request: pedido({ confirmationMethod: "whatsapp_code" }) });
    await montar();
    expect(container.textContent).toContain("Confirme no WhatsApp final 8362");
    const campo = [...container.querySelectorAll("input")].find((i) => i.autocomplete === "one-time-code");
    await digitar(campo, "ab12-cd34");
    expect(campo.value).toBe("ab12cd34");
    gatewayApi.trocaConfirmar.mockResolvedValue({ confirmed: false, result: "invalid-code", attemptsLeft: 4 });
    await clicar("Confirmar", { exato: true });
    expect(gatewayApi.trocaConfirmar).toHaveBeenCalledWith({ organizationId: ORG, pedidoId: "pedido-1", codigo: "ab12cd34" });
    expect(container.textContent).toContain("Código incorreto. Restam 4 tentativas.");
  });

  it("o código que não chegou aparece com o motivo", async () => {
    banco = estado({
      mode: "whatsapp_code",
      request: pedido({ confirmationMethod: "whatsapp_code", errorCode: "confirmation-unsupported_command" }),
    });
    await montar();
    expect(container.textContent).toContain("O código não chegou ao WhatsApp antigo.");
  });
});
