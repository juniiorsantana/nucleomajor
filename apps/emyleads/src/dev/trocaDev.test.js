import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CODIGO_DA_BANCADA, CONEXAO_DA_TROCA, conexaoDaTrocaInicial, criarTrocaDev } from "./trocaDev";

/**
 * A bancada mostra ao dono o caminho inteiro da troca sem número real. Se a
 * simulação divergir do contrato (migration 20261012100000), a bancada passa
 * a ensinar uma tela que não existe — estes testes prendem as mesmas regras.
 */
function montar(busca = "") {
  let conexao = conexaoDaTrocaInicial();
  const troca = criarTrocaDev({
    ler: () => conexao,
    gravar: (mudanca) => { conexao = { ...conexao, ...mudanca }; },
    parametros: new URLSearchParams(busca),
  });
  const op = (nome, args = {}) => troca.operacoes[nome]({ connectionId: CONEXAO_DA_TROCA, ...args });
  return { troca, op, conexao: () => conexao, parear: () => {
    conexao = { ...conexao, connection: { status: "awaiting_qr" } };
    troca.simularLeituraDoQr();
  } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("troca na bancada", () => {
  it("A conectado → desconectado → B esperado → QR → B conectado", async () => {
    const { op, conexao, parear } = montar();
    const pedido = await op("gateway.trocaIniciar", { tipo: "change_number", telefone: "(65) 99999-7777", chave: "chave-1" });
    expect(pedido.status).toBe("awaiting_confirmation");
    expect((await op("gateway.trocaIniciar", { tipo: "change_number", telefone: "(65) 99999-7777", chave: "chave-1" })).repeated).toBe(true);

    await op("gateway.trocaConfirmar", { pedidoId: pedido.requestId });
    expect((await op("gateway.trocaEstado")).request.status).toBe("queued");
    await vi.advanceTimersByTimeAsync(1500);
    expect((await op("gateway.trocaEstado")).request.status).toBe("running");
    await vi.advanceTimersByTimeAsync(2500);
    const aplicado = await op("gateway.trocaEstado");
    expect(aplicado.request.status).toBe("applied");
    expect(aplicado.request.remoteLogout).toBe(true);
    expect(aplicado.sessionReleasedAt).not.toBeNull();
    expect(conexao().connection.status).toBe("whatsapp_disconnected");
    expect(conexao().expectedPhoneMasked).toBe("•••• 7777");

    parear();
    await vi.advanceTimersByTimeAsync(6000);
    expect(conexao().connection.status).toBe("connected");
    expect(conexao().connection.phoneMasked).toBe("•••• 7777");
    expect((await op("gateway.trocaEstado")).sessionReleasedAt).toBeNull();
  });

  it("recusa como o banco: sem liberação, sem ser da equipe, mesmo número com o nono dígito", async () => {
    await expect(montar("troca=off").op("gateway.trocaIniciar", { tipo: "disconnect" }))
      .rejects.toThrow("connection change is not enabled");
    await expect(montar("troca-equipe=nao").op("gateway.trocaIniciar", { tipo: "disconnect" }))
      .rejects.toThrow("requires a platform administrator");
    await expect(montar().op("gateway.trocaIniciar", { tipo: "change_number", telefone: "65 99999-8362" }))
      .rejects.toThrow("same number");
  });

  it("a VPS fora na primeira vez: falha, e o repetir aplica", async () => {
    const { op } = montar("troca-vps=fora");
    const pedido = await op("gateway.trocaIniciar", { tipo: "disconnect" });
    await op("gateway.trocaConfirmar", { pedidoId: pedido.requestId });
    await vi.advanceTimersByTimeAsync(4000);
    const falhou = await op("gateway.trocaEstado");
    expect(falhou.request.status).toBe("failed");
    expect(falhou.request.errorCode).toBe("bridge_offline");
    await op("gateway.trocaRepetir", { pedidoId: pedido.requestId });
    await vi.advanceTimersByTimeAsync(4000);
    const aplicado = await op("gateway.trocaEstado");
    expect(aplicado.request.status).toBe("applied");
    expect(aplicado.request.generation).toBe(2);
  });

  it("a VPS calada: nada começa; a VPS que cai depois deixa o pedido na fila, cancelável", async () => {
    const calada = montar("troca-runtime=fora");
    await expect(calada.op("gateway.trocaIniciar", { tipo: "disconnect" })).rejects.toThrow("runtime is not online");
    expect((await calada.op("gateway.trocaEstado")).runtime.fresh).toBe(false);

    const { op } = montar("troca-runtime=cai");
    const pedido = await op("gateway.trocaIniciar", { tipo: "disconnect" });
    await op("gateway.trocaConfirmar", { pedidoId: pedido.requestId });
    await vi.advanceTimersByTimeAsync(10000);
    const parado = await op("gateway.trocaEstado");
    expect(parado.request.status).toBe("queued");
    expect(parado.request.commandStatus).toBe("pending");
    expect(parado.runtime.fresh).toBe(false);
    expect((await op("gateway.trocaCancelar", { pedidoId: pedido.requestId })).cancelled).toBe(true);
  });

  it("trocar depois de desconectar: sem sessão, não há desligamento a confirmar (remoteLogout nulo)", async () => {
    const { op } = montar();
    const desconectar = await op("gateway.trocaIniciar", { tipo: "disconnect" });
    await op("gateway.trocaConfirmar", { pedidoId: desconectar.requestId });
    await vi.advanceTimersByTimeAsync(4000);
    const trocar = await op("gateway.trocaIniciar", { tipo: "change_number", telefone: "65999997777" });
    await op("gateway.trocaConfirmar", { pedidoId: trocar.requestId });
    await vi.advanceTimersByTimeAsync(4000);
    const estado = await op("gateway.trocaEstado");
    expect(estado.request.status).toBe("applied");
    expect(estado.request.remoteLogout).toBeNull();
  });

  it("o QR lido por outro número bloqueia o envio", async () => {
    const { op, conexao, parear } = montar("troca-qr=outro");
    const pedido = await op("gateway.trocaIniciar", { tipo: "change_number", telefone: "65999997777" });
    await op("gateway.trocaConfirmar", { pedidoId: pedido.requestId });
    await vi.advanceTimersByTimeAsync(4000);
    parear();
    await vi.advanceTimersByTimeAsync(6000);
    expect(conexao().connection.status).toBe("identity_mismatch");
    expect(conexao().connection.sendBlocked).toBe(true);
    // Continua liberada: dá para trocar de novo ou desconectar.
    expect((await op("gateway.trocaEstado")).sessionReleasedAt).not.toBeNull();
  });

  it("no modo com código, só o código da bancada confirma", async () => {
    const { op } = montar("troca=whatsapp_code");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const pedido = await op("gateway.trocaIniciar", { tipo: "disconnect" });
    const errado = await op("gateway.trocaConfirmar", { pedidoId: pedido.requestId, codigo: "00000000" });
    expect(errado).toMatchObject({ confirmed: false, result: "invalid-code", attemptsLeft: 4 });
    const certo = await op("gateway.trocaConfirmar", { pedidoId: pedido.requestId, codigo: CODIGO_DA_BANCADA.toUpperCase() });
    expect(certo.confirmed).toBe(true);
  });
});
