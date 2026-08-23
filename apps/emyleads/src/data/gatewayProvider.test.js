import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarOperacoesGateway } from "./gatewayProvider";

const CHAVE_CREDENCIAIS = "emyleads.gateway.credenciais";
const CHAVE_INSTALACAO = "emyleads.gateway.instalacao";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "99999999-9999-4999-8999-999999999999";
const CONN_A1 = "22222222-2222-4222-8222-222222222222";
const CONN_A2 = "33333333-3333-4333-8333-333333333333";
const INSTALACAO = "chrome-fixa-para-teste";

function resposta(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("gateway local multi-conexão", () => {
  let storage;

  beforeEach(() => {
    storage = { [CHAVE_INSTALACAO]: INSTALACAO };
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (key) => ({ [key]: storage[key] })),
          set: vi.fn(async (values) => Object.assign(storage, values)),
          remove: vi.fn(async (key) => {
            delete storage[key];
          }),
        },
      },
    };
    globalThis.fetch = vi.fn();
  });

  const credenciais = () => storage[CHAVE_CREDENCIAIS] || {};

  it("não consulta a rede antes do vínculo local", async () => {
    const operacoes = criarOperacoesGateway();

    await expect(operacoes["gateway.conexoes"]({ organizationId: ORG_A })).resolves.toMatchObject({
      vinculado: false,
      gateway: "nao-vinculado",
      conexoes: [],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("recusa operar sem workspace selecionado", async () => {
    const operacoes = criarOperacoesGateway();
    await expect(operacoes["gateway.conexoes"]({})).rejects.toMatchObject({
      codigo: "workspace-ausente",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("guarda a credencial indexada por organização, conexão e instalação", async () => {
    fetch
      .mockResolvedValueOnce(
        resposta(200, {
          token: "credencial-do-workspace",
          organizationId: ORG_A,
          connectionId: null,
          installationId: INSTALACAO,
        })
      )
      .mockResolvedValueOnce(resposta(200, { connections: [{ connectionId: CONN_A1 }] }));
    const operacoes = criarOperacoesGateway();

    const resultado = await operacoes["gateway.vincular"]({
      organizationId: ORG_A,
      code: " abcd-1234 ",
    });

    expect(Object.keys(credenciais())).toEqual([`${ORG_A}:*:${INSTALACAO}`]);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      cache: "no-store",
      body: JSON.stringify({ code: "ABCD-1234", installationId: INSTALACAO }),
    });
    expect(resultado).toMatchObject({ vinculado: true, gateway: "online" });
    expect(resultado.token).toBeUndefined();
  });

  it("distingue gateway desatualizado de código de outra empresa", async () => {
    // O gateway anterior devolve só { token }, sem escopo. Confundir isso com
    // "empresa errada" mandaria o operador procurar o erro no lugar errado.
    fetch.mockResolvedValueOnce(resposta(200, { success: true, token: "sem-escopo" }));
    const operacoes = criarOperacoesGateway();

    await expect(
      operacoes["gateway.vincular"]({ organizationId: ORG_A, code: "ABCD-1234" })
    ).rejects.toMatchObject({ codigo: "gateway-desatualizado" });
    expect(credenciais()).toEqual({});
  });

  it("recusa um código emitido para outra empresa", async () => {
    fetch.mockResolvedValueOnce(
      resposta(200, { token: "credencial-alheia", organizationId: ORG_B, installationId: INSTALACAO })
    );
    const operacoes = criarOperacoesGateway();

    await expect(
      operacoes["gateway.vincular"]({ organizationId: ORG_A, code: "ABCD-1234" })
    ).rejects.toMatchObject({ codigo: "bootstrap-outro-workspace" });
    expect(credenciais()).toEqual({});
  });

  it("uma credencial escopada à conexão já conta como vinculado", async () => {
    // O código de vínculo é emitido por conexão, então é ESTA a credencial que
    // o fluxo normal produz. Exigir a de organização fazia a tela dizer "não
    // vinculado" logo depois de um vínculo bem-sucedido, e o operador tentava
    // de novo com um código já consumido.
    storage[CHAVE_CREDENCIAIS] = { [`${ORG_A}:${CONN_A1}:${INSTALACAO}`]: "credencial-da-conexao" };
    fetch.mockResolvedValueOnce(resposta(200, { connections: [{ connectionId: CONN_A1 }] }));
    const operacoes = criarOperacoesGateway();

    const resultado = await operacoes["gateway.conexoes"]({ organizationId: ORG_A });

    expect(resultado).toMatchObject({ vinculado: true, gateway: "online" });
    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer credencial-da-conexao",
    });
  });

  it("prefere a credencial da organização à escopada ao listar", async () => {
    storage[CHAVE_CREDENCIAIS] = {
      [`${ORG_A}:${CONN_A1}:${INSTALACAO}`]: "credencial-da-conexao",
      [`${ORG_A}:*:${INSTALACAO}`]: "credencial-do-workspace",
    };
    fetch.mockResolvedValueOnce(resposta(200, { connections: [] }));
    const operacoes = criarOperacoesGateway();

    await operacoes["gateway.conexoes"]({ organizationId: ORG_A });

    // A de organização enxerga todas as conexões; a escopada, uma só.
    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer credencial-do-workspace",
    });
  });

  it("nunca usa a credencial de outra empresa", async () => {
    storage[CHAVE_CREDENCIAIS] = { [`${ORG_B}:*:${INSTALACAO}`]: "credencial-de-b" };
    const operacoes = criarOperacoesGateway();

    await expect(operacoes["gateway.conexoes"]({ organizationId: ORG_A })).resolves.toMatchObject({
      vinculado: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prefere a credencial da conexão à do workspace", async () => {
    storage[CHAVE_CREDENCIAIS] = {
      [`${ORG_A}:*:${INSTALACAO}`]: "credencial-do-workspace",
      [`${ORG_A}:${CONN_A1}:${INSTALACAO}`]: "credencial-da-conexao",
    };
    fetch.mockResolvedValueOnce(resposta(202, { connection: { status: "starting_pairing" } }));
    const operacoes = criarOperacoesGateway();

    await operacoes["gateway.parear"]({ organizationId: ORG_A, connectionId: CONN_A1 });

    expect(fetch.mock.calls[0][0]).toContain(`/connections/${CONN_A1}/pairing/start`);
    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer credencial-da-conexao",
    });
  });

  it("nem chega ao gateway quando não há credencial que alcance a conexão", async () => {
    storage[CHAVE_CREDENCIAIS] = { [`${ORG_A}:${CONN_A1}:${INSTALACAO}`]: "credencial-da-conexao" };
    const operacoes = criarOperacoesGateway();

    // Credencial de A1 não empresta escopo para A2, e a chamada nem sai: uma
    // requisição que só pode voltar 403 é ruído no log do gateway.
    await expect(
      operacoes["gateway.qr"]({ organizationId: ORG_A, connectionId: CONN_A2 })
    ).rejects.toMatchObject({ codigo: "gateway-nao-vinculado" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("traduz o 403 do gateway sem desvincular a máquina", async () => {
    storage[CHAVE_CREDENCIAIS] = { [`${ORG_A}:${CONN_A2}:${INSTALACAO}`]: "credencial-rescopada" };
    fetch.mockResolvedValueOnce(resposta(403, { error: "not authorized for this connection" }));
    const operacoes = criarOperacoesGateway();

    await expect(
      operacoes["gateway.qr"]({ organizationId: ORG_A, connectionId: CONN_A2 })
    ).rejects.toMatchObject({ codigo: "conexao-proibida" });

    // 403 é escopo errado, não credencial inválida: apagar o token aqui
    // desvincularia a máquina por causa de uma conexão que mudou de escopo.
    expect(credenciais()[`${ORG_A}:${CONN_A2}:${INSTALACAO}`]).toBe("credencial-rescopada");
  });

  it("descarta a credencial quando o gateway a rejeita", async () => {
    storage[CHAVE_CREDENCIAIS] = {
      [`${ORG_A}:*:${INSTALACAO}`]: "expirada",
      [`${ORG_B}:*:${INSTALACAO}`]: "de-outra-empresa",
    };
    fetch.mockResolvedValueOnce(resposta(401, { error: "unauthorized" }));
    const operacoes = criarOperacoesGateway();

    await expect(operacoes["gateway.conexoes"]({ organizationId: ORG_A })).resolves.toMatchObject({
      vinculado: false,
      gateway: "nao-autorizado",
    });
    expect(credenciais()[`${ORG_A}:*:${INSTALACAO}`]).toBeUndefined();
    expect(credenciais()[`${ORG_B}:*:${INSTALACAO}`]).toBe("de-outra-empresa");
  });

  it("gateway offline não vira sessão do WhatsApp desconectada", async () => {
    storage[CHAVE_CREDENCIAIS] = { [`${ORG_A}:*:${INSTALACAO}`]: "credencial" };
    fetch.mockRejectedValueOnce(new Error("connection refused"));
    const operacoes = criarOperacoesGateway();

    const resultado = await operacoes["gateway.conexoes"]({ organizationId: ORG_A });
    expect(resultado).toMatchObject({ vinculado: true, gateway: "offline", conexoes: [] });
  });

  it("trocar de workspace descarrega só as credenciais do anterior", async () => {
    storage[CHAVE_CREDENCIAIS] = {
      [`${ORG_A}:*:${INSTALACAO}`]: "credencial-a",
      [`${ORG_A}:${CONN_A1}:${INSTALACAO}`]: "credencial-a1",
      [`${ORG_B}:*:${INSTALACAO}`]: "credencial-b",
    };
    const operacoes = criarOperacoesGateway();

    await operacoes["gateway.descarregar"]({ organizationId: ORG_A });

    expect(Object.keys(credenciais())).toEqual([`${ORG_B}:*:${INSTALACAO}`]);
  });

  it("revogar uma conexão apaga só a credencial daquela conexão", async () => {
    storage[CHAVE_CREDENCIAIS] = {
      [`${ORG_A}:${CONN_A1}:${INSTALACAO}`]: "credencial-a1",
      [`${ORG_A}:${CONN_A2}:${INSTALACAO}`]: "credencial-a2",
    };
    fetch.mockResolvedValueOnce(resposta(200, { success: true, connectionId: CONN_A1 }));
    const operacoes = criarOperacoesGateway();

    await operacoes["gateway.revogar"]({ organizationId: ORG_A, connectionId: CONN_A1 });

    expect(Object.keys(credenciais())).toEqual([`${ORG_A}:${CONN_A2}:${INSTALACAO}`]);
  });
});

describe("transferência de conversa", () => {
  let storage;

  beforeEach(() => {
    storage = { [CHAVE_INSTALACAO]: INSTALACAO };
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (key) => ({ [key]: storage[key] })),
          set: vi.fn(async (values) => Object.assign(storage, values)),
          remove: vi.fn(async (key) => { delete storage[key]; }),
        },
      },
    };
    globalThis.fetch = vi.fn();
    storage[CHAVE_CREDENCIAIS] = { [`${ORG_A}:*:${INSTALACAO}`]: "credencial" };
  });

  const listar = (conexoes) => resposta(200, { connections: conexoes });

  it("resolve a conexão pelo número logado nesta aba", async () => {
    fetch
      .mockResolvedValueOnce(listar([
        { connectionId: CONN_A1, connection: { phoneMasked: "•••• 3855" } },
        { connectionId: CONN_A2, connection: { phoneMasked: "•••• 8362" } },
      ]))
      .mockResolvedValueOnce(resposta(200, { success: true, session: { owner: "ia" } }));
    const operacoes = criarOperacoesGateway();

    await operacoes["gateway.transferirConversa"]({
      organizationId: ORG_A,
      conexaoLast4: "8362",
      contato: "55 65 9343-8362",
      destino: "ia",
      motivo: "quer orçamento",
    });

    // A segunda chamada é a transferência, na conexão que casa com a aba.
    expect(fetch.mock.calls[1][0]).toContain(`/connections/${CONN_A2}/conversation`);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      contact: "556593438362",
      owner: "ia",
      reason: "quer orçamento",
    });
  });

  it("falha explicitamente quando nenhuma conexão casa com a aba", async () => {
    // Silenciar isto seria o pior caso: o cliente avisado de que alguém vai
    // atender, e o robô seguindo em frente.
    fetch.mockResolvedValueOnce(listar([
      { connectionId: CONN_A1, connection: { phoneMasked: "•••• 3855" } },
    ]));
    const operacoes = criarOperacoesGateway();

    await expect(
      operacoes["gateway.transferirConversa"]({
        organizationId: ORG_A,
        conexaoLast4: "8362",
        contato: "556599999999",
        destino: "humano",
      })
    ).rejects.toMatchObject({ codigo: "transferencia-sem-conexao" });
  });

  it("usa a única conexão quando a aba não reportou número", async () => {
    fetch
      .mockResolvedValueOnce(listar([{ connectionId: CONN_A1, connection: { phoneMasked: "•••• 8362" } }]))
      .mockResolvedValueOnce(resposta(200, { success: true }));
    const operacoes = criarOperacoesGateway();

    await operacoes["gateway.transferirConversa"]({
      organizationId: ORG_A,
      conexaoLast4: null,
      contato: "556599999999",
      destino: "humano",
    });

    expect(fetch.mock.calls[1][0]).toContain(`/connections/${CONN_A1}/conversation`);
  });

  it("recusa transferir contato sem telefone", async () => {
    const operacoes = criarOperacoesGateway();
    await expect(
      operacoes["gateway.transferirConversa"]({ organizationId: ORG_A, contato: "", destino: "ia" })
    ).rejects.toMatchObject({ codigo: "transferencia-sem-contato" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("controles do árbitro", () => {
  let storage;

  beforeEach(() => {
    storage = { [CHAVE_INSTALACAO]: INSTALACAO };
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (key) => ({ [key]: storage[key] })),
          set: vi.fn(async (values) => Object.assign(storage, values)),
          remove: vi.fn(async (key) => { delete storage[key]; }),
        },
      },
    };
    globalThis.fetch = vi.fn();
    storage[CHAVE_CREDENCIAIS] = { [`${ORG_A}:*:${INSTALACAO}`]: "credencial" };
  });

  const corpoDa = (chamada) => JSON.parse(fetch.mock.calls[chamada][1].body);

  it("envia o desafio de operador ao gateway, que o encaminha ao Bridge", async () => {
    storage[CHAVE_CREDENCIAIS] = { [`${ORG_A}:${CONN_A1}:${INSTALACAO}`]: "credencial" };
    fetch.mockResolvedValueOnce(resposta(200, { success: true }));
    const operacoes = criarOperacoesGateway();

    await operacoes["gateway.enviarCodigoOperador"]({
      organizationId: ORG_A,
      connectionId: CONN_A1,
      recipient: "+55 (66) 99964-0274",
      code: " abcd1234 ",
    });

    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:8090/api/operator-verification/send");
    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer credencial",
    });
    expect(corpoDa(0)).toEqual({
      organization_id: ORG_A,
      connection_id: CONN_A1,
      recipient: "5566999640274",
      code: "abcd1234",
    });
  });

  it("liga a IA da conexão e manda o dono padrão junto", async () => {
    fetch.mockResolvedValueOnce(resposta(200, { success: true, iaAtiva: true, donoPadrao: "ia" }));
    const operacoes = criarOperacoesGateway();

    await operacoes["gateway.automacao"]({
      organizationId: ORG_A,
      connectionId: CONN_A1,
      iaAtiva: true,
      defaultOwner: "ia",
    });

    expect(fetch.mock.calls[0][0]).toContain(`/connections/${CONN_A1}/automation`);
    expect(corpoDa(0)).toEqual({ iaAtiva: true, defaultOwner: "ia" });
  });

  it("desligar não manda dono padrão que ninguém escolheu", async () => {
    // `defaultOwner` ausente e `defaultOwner: null` são coisas diferentes para
    // o gateway: um preserva o que está lá, o outro seria rejeitado.
    fetch.mockResolvedValueOnce(resposta(200, { success: true, iaAtiva: false }));
    const operacoes = criarOperacoesGateway();

    await operacoes["gateway.automacao"]({ organizationId: ORG_A, connectionId: CONN_A1, iaAtiva: false });

    expect(corpoDa(0)).toEqual({ iaAtiva: false });
  });

  it("propaga a recusa do gateway em vez de fingir que ligou", async () => {
    fetch.mockResolvedValueOnce(resposta(400, { error: "iaAtiva is required" }));
    const operacoes = criarOperacoesGateway();

    await expect(
      operacoes["gateway.automacao"]({ organizationId: ORG_A, connectionId: CONN_A1, iaAtiva: true })
    ).rejects.toMatchObject({ codigo: "gateway-resposta", message: "iaAtiva is required" });
  });

  it("lê as sessões abertas pela conexão, sem resolver pela aba", async () => {
    fetch.mockResolvedValueOnce(resposta(200, { success: true, conversations: [], iaAtiva: true }));
    const operacoes = criarOperacoesGateway();

    await operacoes["gateway.resumoAtendimento"]({ organizationId: ORG_A, connectionId: CONN_A1 });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain(`/connections/${CONN_A1}/conversations`);
    expect(fetch.mock.calls[0][0]).not.toContain("closed=1");
  });

  it("pede as finalizadas quando a tela quer o histórico", async () => {
    fetch.mockResolvedValueOnce(resposta(200, { success: true, conversations: [] }));
    const operacoes = criarOperacoesGateway();

    await operacoes["gateway.resumoAtendimento"]({
      organizationId: ORG_A,
      connectionId: CONN_A1,
      abertas: false,
    });

    expect(fetch.mock.calls[0][0]).toContain("closed=1");
  });

  it("normaliza o telefone ao trocar o dono de uma conversa", async () => {
    fetch.mockResolvedValueOnce(resposta(200, { success: true, session: { owner: "humano" } }));
    const operacoes = criarOperacoesGateway();

    await operacoes["gateway.definirDonoConversa"]({
      organizationId: ORG_A,
      connectionId: CONN_A1,
      contato: "+55 (65) 9343-8362",
      dono: "humano",
      motivo: "assumido manualmente",
    });

    expect(corpoDa(0)).toEqual({
      contact: "556593438362",
      owner: "humano",
      reason: "assumido manualmente",
    });
  });

  it("recusa trocar dono de contato sem telefone, antes de chegar na rede", async () => {
    const operacoes = criarOperacoesGateway();
    await expect(
      operacoes["gateway.definirDonoConversa"]({
        organizationId: ORG_A,
        connectionId: CONN_A1,
        contato: "",
        dono: "ia",
      })
    ).rejects.toMatchObject({ codigo: "atendimento-sem-contato" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("encerra o atendimento no endpoint próprio", async () => {
    fetch.mockResolvedValueOnce(resposta(200, { success: true, session: { open: false } }));
    const operacoes = criarOperacoesGateway();

    await operacoes["gateway.encerrarAtendimento"]({
      organizationId: ORG_A,
      connectionId: CONN_A1,
      contato: "556593438362",
      motivo: "resolvido",
    });

    expect(fetch.mock.calls[0][0]).toContain(`/connections/${CONN_A1}/conversation/close`);
    expect(corpoDa(0)).toEqual({ contact: "556593438362", reason: "resolvido" });
  });

  it("acha a sessão do contato aberto na aba", async () => {
    fetch
      .mockResolvedValueOnce(resposta(200, {
        connections: [
          { connectionId: CONN_A1, connection: { phoneMasked: "•••• 3855" } },
          { connectionId: CONN_A2, connection: { phoneMasked: "•••• 8362" } },
        ],
      }))
      .mockResolvedValueOnce(resposta(200, {
        success: true,
        iaAtiva: true,
        donoPadrao: "ia",
        conversations: [
          { contact: "556599999999", owner: "bot" },
          { contact: "556593438362", owner: "humano" },
        ],
      }));
    const operacoes = criarOperacoesGateway();

    const status = await operacoes["gateway.statusConversaAtual"]({
      organizationId: ORG_A,
      contato: "55 65 9343-8362",
      conexaoLast4: "8362",
    });

    expect(status).toMatchObject({
      connectionId: CONN_A2,
      iaAtiva: true,
      donoPadrao: "ia",
      sessao: { owner: "humano" },
    });
  });

  it("devolve sessão nula quando o contato ainda não tem atendimento", async () => {
    // Sem sessão não é erro: é uma conversa que ninguém abriu ainda. A faixa
    // precisa distinguir isso de "não consegui consultar".
    fetch
      .mockResolvedValueOnce(resposta(200, {
        connections: [{ connectionId: CONN_A1, connection: { phoneMasked: "•••• 8362" } }],
      }))
      .mockResolvedValueOnce(resposta(200, { success: true, iaAtiva: false, conversations: [] }));
    const operacoes = criarOperacoesGateway();

    const status = await operacoes["gateway.statusConversaAtual"]({
      organizationId: ORG_A,
      contato: "556593438362",
      conexaoLast4: null,
    });

    expect(status).toMatchObject({ connectionId: CONN_A1, iaAtiva: false, sessao: null });
  });

  it("não inventa conexão quando há várias e a aba não reportou", async () => {
    fetch.mockResolvedValueOnce(resposta(200, {
      connections: [
        { connectionId: CONN_A1, connection: { phoneMasked: "•••• 3855" } },
        { connectionId: CONN_A2, connection: { phoneMasked: "•••• 8362" } },
      ],
    }));
    const operacoes = criarOperacoesGateway();

    await expect(
      operacoes["gateway.statusConversaAtual"]({
        organizationId: ORG_A,
        contato: "556593438362",
        conexaoLast4: null,
      })
    ).rejects.toMatchObject({ codigo: "transferencia-sem-conexao" });
  });
});
