import { describe, expect, it, vi } from "vitest";
import { variantesBR } from "../lib/phone.js";
import { criarOperacoesConversasWeb } from "./conversasProvider.js";
import { RELEITURA_COMPLETA_MS, SOBREPOSICAO_MS } from "./sincronia.js";
import { WORKSPACE_KEY } from "./storage.js";

/**
 * A sincronia por delta contra um banco falso que segue o contrato da seção 4
 * do plano da escala (19/10/2026): `changed_at` nas duas tabelas e a RPC
 * `nucleo_conversation_list(target_organization, changed_since, max_rows)`,
 * que devolve a conversa que mudou OU cujo contato mudou, já com o contato.
 * O banco de verdade está sendo feito em paralelo; esta bancada é o contrato.
 */

const ORG = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";
const ORG_B = "7d7a7c2e-1111-4a4a-9b9b-222233334444";
const CONEXAO = "0f2a1b6c-9d3e-4f18-a5c7-2b8e6d4a1c90";
const T0 = Date.parse("2026-10-20T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const t = (valor) => (valor ? new Date(valor).getTime() : NaN);

function casar(contatos, telefone) {
  const formas = new Set(variantesBR(telefone));
  return contatos.find((c) => !c.deleted_at && variantesBR(c.phone).some((f) => formas.has(f))) || null;
}

function criarBanco({ relogio }) {
  const db = { conversas: [], contatos: [], mensagens: [] };
  const opcoes = { rpc: "existe", semColunaDeAlteracao: false };
  const rpcs = [];
  const consultas = [];
  const assinaturas = [];
  const gravadas = [];

  const linhaDaRpc = (conversa) => {
    const contato = conversa.chat_kind === "grupo" ? null : casar(db.contatos, conversa.contact_phone);
    return {
      ...conversa,
      contact_id: contato?.id || null,
      crm_name: contato?.name || null,
      crm_company: contato?.company || null,
      crm_job_title: contato?.job_title || null,
      crm_avatar_path: contato?.avatar_path || null,
      contatoEm: contato?.updated_at || null,
    };
  };

  const rpc = vi.fn(async (nome, args) => {
    rpcs.push([nome, args]);
    if (nome !== "nucleo_conversation_list") return { data: null, error: null };
    if (opcoes.rpc === "falta") return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    if (opcoes.rpc === "42883") return { data: null, error: { code: "42883", message: "function does not exist" } };
    if (opcoes.rpc === "quebrada") return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const desde = args.changed_since ? t(args.changed_since) : null;
    let linhas = db.conversas.filter((c) => c.organization_id === args.target_organization).map(linhaDaRpc);
    if (desde === null) {
      linhas.sort((a, b) => (t(b.last_message_at) || -Infinity) - (t(a.last_message_at) || -Infinity));
    } else {
      linhas = linhas
        .filter((l) => t(l.changed_at) > desde || t(l.contatoEm) > desde)
        .sort((a, b) => t(a.changed_at) - t(b.changed_at));
    }
    return {
      data: linhas.slice(0, args.max_rows).map(({ contatoEm, organization_id, ...resto }) => resto),
      error: null,
    };
  });

  const from = vi.fn((tabela) => {
    const pedido = { tabela, campos: "", filtros: [], maiores: [], ordem: null, limite: null };
    consultas.push(pedido);
    const consulta = {
      select: (campos) => ((pedido.campos = campos), consulta),
      eq: (coluna, valor) => (pedido.filtros.push([coluna, valor]), consulta),
      is: (coluna, valor) => (pedido.filtros.push([coluna, valor]), consulta),
      gt: (coluna, valor) => (pedido.maiores.push([coluna, valor]), consulta),
      order: (coluna, op) => ((pedido.ordem = [coluna, op]), consulta),
      limit: (n) => ((pedido.limite = n), consulta),
      then: (resolver, rejeitar) => Promise.resolve(executar(pedido)).then(resolver, rejeitar),
    };
    return consulta;
  });

  function executar(pedido) {
    const fonte = {
      whatsapp_conversations: db.conversas,
      contacts: db.contatos,
      whatsapp_messages: db.mensagens,
    }[pedido.tabela];
    if (opcoes.semColunaDeAlteracao && pedido.campos.includes("changed_at")) {
      return { data: null, error: { code: "42703", message: `column ${pedido.tabela}.changed_at does not exist` } };
    }
    let linhas = fonte.filter((linha) =>
      pedido.filtros.every(([coluna, valor]) => (valor === null ? linha[coluna] == null : linha[coluna] === valor))
    );
    for (const [coluna, valor] of pedido.maiores) linhas = linhas.filter((l) => t(l[coluna]) > t(valor));
    if (pedido.ordem) {
      const [coluna, { ascending }] = pedido.ordem;
      linhas = [...linhas].sort((a, b) => (ascending ? 1 : -1) * ((t(a[coluna]) || 0) - (t(b[coluna]) || 0)));
    }
    if (pedido.limite) linhas = linhas.slice(0, pedido.limite);
    // Só as colunas pedidas, como o PostgREST.
    const colunas = pedido.campos.split(",");
    return { data: linhas.map((l) => Object.fromEntries(colunas.map((c) => [c, l[c] ?? null]))), error: null };
  }

  const storage = {
    from: (bucket) => ({
      createSignedUrls: vi.fn(async (caminhos, validade) => {
        assinaturas.push({ bucket, caminhos: [...caminhos], validade, em: relogio.agora });
        return {
          data: caminhos.map((path) => ({ path, signedUrl: `https://storage.test/${bucket}/${path}?em=${relogio.agora}` })),
          error: null,
        };
      }),
    }),
  };

  const area = { workspace: ORG, get: vi.fn(async () => ({ [WORKSPACE_KEY]: area.workspace })) };
  const cache = {
    dados: new Map(),
    ler: vi.fn(async (chave) => cache.dados.get(chave)),
    gravar: vi.fn(async (chave, valor) => {
      gravadas.push(chave);
      cache.dados.set(chave, valor);
    }),
    apagarTudo: vi.fn(async () => cache.dados.clear()),
  };

  return { db, opcoes, rpc, from, storage, area, cache, rpcs, consultas, assinaturas, gravadas };
}

function bancada({ comCache = false } = {}) {
  const relogio = { agora: T0 };
  const banco = criarBanco({ relogio });
  const operacoes = criarOperacoesConversasWeb({
    supabase: { rpc: banco.rpc, from: banco.from, storage: banco.storage },
    area: banco.area,
    cache: comCache ? banco.cache : null,
    agora: () => relogio.agora,
  });
  const andar = (ms) => {
    relogio.agora += ms;
  };
  return { ...banco, operacoes, relogio, andar };
}

const conversa = (telefone, mudouEm, extra = {}) => ({
  organization_id: ORG,
  connection_id: CONEXAO,
  contact_phone: telefone,
  chat_kind: "pessoa",
  contact_name: "",
  contact_photo_url: null,
  last_message_preview: "oi",
  last_message_at: iso(mudouEm),
  last_message_from_me: false,
  unread_count: 0,
  owner: "bot",
  attendant_id: null,
  attendant_name: "",
  changed_at: iso(mudouEm),
  ...extra,
});

const mensagem = (telefone, id, enviadaEm, extra = {}) => ({
  organization_id: ORG,
  connection_id: CONEXAO,
  contact_phone: telefone,
  message_id: id,
  content: `mensagem ${id}`,
  sent_at: iso(enviadaEm),
  is_from_me: false,
  media_type: "",
  media_filename: "",
  media_path: "",
  media_mime: "",
  author_kind: "contato",
  author_name: "",
  transcribed_at: null,
  changed_at: iso(enviadaEm),
  ...extra,
});

const pedidosDaLista = (rpcs) => rpcs.filter(([nome]) => nome === "nucleo_conversation_list").map(([, args]) => args);

describe("lista pelo delta", () => {
  it("a primeira leitura é completa; a seguinte pede desde o maior changed_at menos 5 s", async () => {
    const { db, operacoes, rpcs, consultas } = bancada();
    db.conversas.push(conversa("5511900000001", T0 - 60_000), conversa("5511900000002", T0 - 30_000));

    const primeira = await operacoes["conversas.listar"]();
    expect(primeira.map((c) => c.telefone)).toEqual(["5511900000002", "5511900000001"]);
    await operacoes["conversas.listar"]();

    const [completa, delta] = pedidosDaLista(rpcs);
    expect(completa).toEqual({ target_organization: ORG, changed_since: null, max_rows: 1000 });
    expect(delta.changed_since).toBe(iso(T0 - 30_000 - SOBREPOSICAO_MS));
    expect(delta.max_rows).toBe(500);
    // Nada de tabela inteira nem de contatos: tudo veio da RPC.
    expect(consultas).toEqual([]);
  });

  it("a linha repetida pela sobreposição não duplica, e a nova entra no topo", async () => {
    const { db, operacoes, andar } = bancada();
    db.conversas.push(conversa("5511900000001", T0 - 60_000), conversa("5511900000002", T0 - 2_000));
    await operacoes["conversas.listar"]();

    andar(20_000);
    // Dentro da janela de 5 s: a 0002 volta no delta, e a 0003 é nova.
    db.conversas.push(conversa("5511900000003", T0 + 10_000));
    const lista = await operacoes["conversas.listar"]();
    expect(lista.map((c) => c.telefone)).toEqual(["5511900000003", "5511900000002", "5511900000001"]);

    const repetida = await operacoes["conversas.listar"]();
    expect(repetida).toHaveLength(3);
  });

  it("a conversa que mudou troca no lugar, e a que não mudou continua o mesmo objeto", async () => {
    const { db, operacoes, andar } = bancada();
    db.conversas.push(conversa("5511900000001", T0 - 60_000), conversa("5511900000002", T0 - 30_000));
    const [, antiga] = await operacoes["conversas.listar"]();

    andar(60_000);
    db.conversas[1] = conversa("5511900000002", T0 + 50_000, { last_message_preview: "chegou", unread_count: 1 });
    const lista = await operacoes["conversas.listar"]();
    expect(lista[0]).toMatchObject({ telefone: "5511900000002", previa: "chegou", naoLidas: 1 });
    expect(lista[1]).toBe(antiga);
  });

  it("conversa apagada continua no delta e some na releitura completa de 10 min", async () => {
    const { db, operacoes, andar, rpcs } = bancada();
    db.conversas.push(conversa("5511900000001", T0 - 60_000), conversa("5511900000002", T0 - 30_000));
    await operacoes["conversas.listar"]();

    db.conversas.splice(0, 1);
    andar(60_000);
    expect(await operacoes["conversas.listar"]()).toHaveLength(2);

    andar(RELEITURA_COMPLETA_MS);
    const depois = await operacoes["conversas.listar"]();
    expect(depois.map((c) => c.telefone)).toEqual(["5511900000002"]);
    expect(pedidosDaLista(rpcs).at(-1).changed_since).toBeNull();
  });

  it("o contato renomeado no CRM chega pelo delta, sem a conversa mudar", async () => {
    const { db, operacoes, andar } = bancada();
    db.contatos.push({ organization_id: ORG, id: "c1", name: "Marina", phone: "(11) 9000-0001", updated_at: iso(T0 - 600_000) });
    db.conversas.push(conversa("5511990000001", T0 - 60_000, { contact_name: "pelo WhatsApp" }));
    expect((await operacoes["conversas.listar"]())[0]).toMatchObject({ nome: "Marina", contactId: "c1" });

    andar(30_000);
    db.contatos[0] = { ...db.contatos[0], name: "Marina Alves", company: "Alves Odonto", updated_at: iso(T0 + 20_000) };
    const [renomeada] = await operacoes["conversas.listar"]();
    expect(renomeada).toMatchObject({ nome: "Marina Alves", empresa: "Alves Odonto" });
  });

  it("delta que bate o teto relê tudo, em vez de confiar num delta cortado", async () => {
    const { db, operacoes, andar, rpcs } = bancada();
    db.conversas.push(conversa("5511900000001", T0 - 60_000));
    await operacoes["conversas.listar"]();

    andar(10_000);
    for (let i = 0; i < 500; i += 1) db.conversas.push(conversa(`55119${String(i).padStart(8, "0")}`, T0 + i));
    const lista = await operacoes["conversas.listar"]();
    expect(lista).toHaveLength(501);
    const pedidos = pedidosDaLista(rpcs);
    expect(pedidos.at(-2).changed_since).not.toBeNull();
    expect(pedidos.at(-1).changed_since).toBeNull();
  });

  it("trocar de empresa relê tudo, e nada da outra empresa aparece", async () => {
    const { db, operacoes, area, rpcs } = bancada();
    db.conversas.push(conversa("5511900000001", T0 - 60_000), conversa("5511900000099", T0, { organization_id: ORG_B }));
    expect(await operacoes["conversas.listar"]()).toHaveLength(1);

    area.workspace = ORG_B;
    const outra = await operacoes["conversas.listar"]();
    expect(outra.map((c) => c.telefone)).toEqual(["5511900000099"]);
    expect(pedidosDaLista(rpcs).at(-1)).toMatchObject({ target_organization: ORG_B, changed_since: null });
  });

  it("forçar a releitura completa (a ficha salvou um contato) pede sem cursor", async () => {
    const { db, operacoes, rpcs } = bancada();
    db.conversas.push(conversa("5511900000001", T0 - 60_000));
    await operacoes["conversas.listar"]();
    await operacoes["conversas.listar"]({ completa: true });
    expect(pedidosDaLista(rpcs).map((p) => p.changed_since)).toEqual([null, null]);
  });

  it("pedidos simultâneos (timer, aviso, conversa aberta) viram no máximo dois", async () => {
    const { db, operacoes, rpcs } = bancada();
    db.conversas.push(conversa("5511900000001", T0 - 60_000));
    const respostas = await Promise.all([1, 2, 3, 4, 5].map(() => operacoes["conversas.listar"]()));
    expect(pedidosDaLista(rpcs)).toHaveLength(2);
    for (const lista of respostas) expect(lista).toHaveLength(1);
  });

  it("grupo nunca recebe contato, mesmo com os dígitos parecidos", async () => {
    const { db, operacoes } = bancada();
    db.contatos.push({ organization_id: ORG, id: "c1", name: "Alguém", phone: "120363001122334455", updated_at: iso(T0) });
    db.conversas.push(conversa("120363001122334455", T0, { chat_kind: "grupo", contact_name: "Comercial" }));
    const [grupo] = await operacoes["conversas.listar"]();
    expect(grupo).toMatchObject({ grupo: true, contactId: null, nome: "Comercial", telefone: "" });
  });
});

describe("sem a RPC, como antes", () => {
  it.each(["falta", "42883"])("RPC ausente (%s): lê as tabelas como hoje e para de tentar", async (modo) => {
    const { db, opcoes, operacoes, rpcs, consultas } = bancada();
    opcoes.rpc = modo;
    db.contatos.push({ organization_id: ORG, id: "c1", name: "Marina", phone: "(11) 8765-4321", company: "Alves", job_title: "Sócia", avatar_path: "av/c1.jpg", deleted_at: null });
    db.conversas.push(conversa("5511987654321", T0 - 60_000), conversa("5521999998888", T0 - 30_000));

    const lista = await operacoes["conversas.listar"]();
    expect(lista.map((c) => c.nome)).toEqual(["5521999998888", "Marina"]);
    expect(lista[1]).toMatchObject({ contactId: "c1", empresa: "Alves", cargo: "Sócia" });
    expect(lista[1].fotoUrl).toContain("contact-avatars/av/c1.jpg");

    await operacoes["conversas.listar"]();
    expect(pedidosDaLista(rpcs)).toHaveLength(1);
    expect(consultas.filter((c) => c.tabela === "whatsapp_conversations")).toHaveLength(2);
    expect(consultas.filter((c) => c.tabela === "contacts")).toHaveLength(2);
  });

  it("outra falha da RPC cai no caminho de antes só desta vez", async () => {
    const { db, opcoes, operacoes, rpcs, consultas } = bancada();
    opcoes.rpc = "quebrada";
    db.conversas.push(conversa("5511900000001", T0 - 60_000));
    expect(await operacoes["conversas.listar"]()).toHaveLength(1);
    expect(consultas.filter((c) => c.tabela === "whatsapp_conversations")).toHaveLength(1);

    opcoes.rpc = "existe";
    expect(await operacoes["conversas.listar"]()).toHaveLength(1);
    expect(pedidosDaLista(rpcs)).toHaveLength(2);
  });

  it("a RPC e o caminho de antes entregam a mesma lista", async () => {
    const montar = (b) => {
      b.db.contatos.push({ organization_id: ORG, id: "c1", name: "Marina", phone: "(11) 8765-4321", company: "Alves", job_title: "Sócia", avatar_path: "av/c1.jpg", deleted_at: null, updated_at: iso(T0) });
      b.db.conversas.push(
        conversa("5511987654321", T0 - 60_000, { unread_count: 2, owner: "ia" }),
        conversa("5521999998888", T0 - 30_000, { contact_photo_url: "https://pps.whatsapp.net/x.jpg" }),
        conversa("120363001122334455", T0 - 10_000, { chat_kind: "grupo", contact_name: "Comercial" }),
        conversa("5531988887777", T0 - 90_000, { last_message_at: null })
      );
    };
    const pelaRpc = bancada();
    montar(pelaRpc);
    const comoAntes = bancada();
    comoAntes.opcoes.rpc = "falta";
    montar(comoAntes);
    expect(await pelaRpc.operacoes["conversas.listar"]()).toEqual(await comoAntes.operacoes["conversas.listar"]());
  });
});

describe("fotos assinadas", () => {
  it("a foto não é reassinada a cada recarga; é renovada perto de vencer", async () => {
    const { db, operacoes, andar, assinaturas } = bancada();
    db.contatos.push({ organization_id: ORG, id: "c1", name: "Marina", phone: "5511900000001", avatar_path: "av/c1.jpg", updated_at: iso(T0 - 600_000) });
    db.conversas.push(conversa("5511900000001", T0 - 60_000));

    const [primeira] = await operacoes["conversas.listar"]();
    for (let i = 0; i < 5; i += 1) {
      andar(60_000);
      const [mesma] = await operacoes["conversas.listar"]();
      expect(mesma.fotoUrl).toBe(primeira.fotoUrl);
    }
    expect(assinaturas.filter((a) => a.bucket === "contact-avatars")).toHaveLength(1);

    // 55 min depois da assinatura: faltam 5 min para vencer, e renova.
    andar(55 * 60_000 - 5 * 60_000);
    const [renovada] = await operacoes["conversas.listar"]();
    expect(renovada.fotoUrl).not.toBe(primeira.fotoUrl);
    expect(assinaturas.filter((a) => a.bucket === "contact-avatars")).toHaveLength(2);
  });

  it("só a foto da conversa que chegou vai ao Storage", async () => {
    const { db, operacoes, andar, assinaturas } = bancada();
    db.contatos.push(
      { organization_id: ORG, id: "c1", name: "A", phone: "5511900000001", avatar_path: "av/c1.jpg", updated_at: iso(T0 - 600_000) },
      { organization_id: ORG, id: "c2", name: "B", phone: "5511900000002", avatar_path: "av/c2.jpg", updated_at: iso(T0 - 600_000) }
    );
    db.conversas.push(conversa("5511900000001", T0 - 60_000));
    await operacoes["conversas.listar"]();

    andar(30_000);
    db.conversas.push(conversa("5511900000002", T0 + 10_000));
    await operacoes["conversas.listar"]();
    expect(assinaturas.map((a) => a.caminhos)).toEqual([["av/c1.jpg"], ["av/c2.jpg"]]);
  });

  it("sem a RPC a foto também não é reassinada, e só a dos contatos que têm conversa", async () => {
    const { db, opcoes, operacoes, assinaturas } = bancada();
    opcoes.rpc = "falta";
    db.contatos.push(
      { organization_id: ORG, id: "c1", name: "A", phone: "5511900000001", avatar_path: "av/c1.jpg", deleted_at: null },
      { organization_id: ORG, id: "c9", name: "Sem conversa", phone: "5511900000009", avatar_path: "av/c9.jpg", deleted_at: null }
    );
    db.conversas.push(conversa("5511900000001", T0 - 60_000));
    await operacoes["conversas.listar"]();
    await operacoes["conversas.listar"]();
    expect(assinaturas.map((a) => a.caminhos)).toEqual([["av/c1.jpg"]]);
  });
});

describe("mensagens da conversa aberta pelo delta", () => {
  const ID = `${CONEXAO}:5511900000001`;
  const ID_B = `${CONEXAO}:5511900000002`;
  const daTela = (lista) => lista.filter((m) => m.tipo === "mensagem").map((m) => m.messageId);
  const pedidosDeMensagens = (consultas) => consultas.filter((c) => c.tabela === "whatsapp_messages");

  it("abre com as 300 mais novas e depois pede só o que mudou depois do cursor", async () => {
    const { db, operacoes, andar, consultas } = bancada();
    db.mensagens.push(mensagem("5511900000001", "m1", T0 - 60_000), mensagem("5511900000001", "m2", T0 - 30_000));
    expect(daTela(await operacoes["conversas.mensagens"]({ id: ID }))).toEqual(["m1", "m2"]);

    andar(20_000);
    db.mensagens.push(mensagem("5511900000001", "m3", T0 + 10_000));
    expect(daTela(await operacoes["conversas.mensagens"]({ id: ID }))).toEqual(["m1", "m2", "m3"]);

    const [primeira, segunda] = pedidosDeMensagens(consultas);
    expect(primeira.ordem).toEqual(["sent_at", { ascending: false }]);
    expect(primeira.limite).toBe(300);
    expect(primeira.campos).toContain("changed_at");
    expect(segunda.maiores).toEqual([["changed_at", iso(T0 - 30_000 - SOBREPOSICAO_MS)]]);
    expect(segunda.ordem).toEqual(["changed_at", { ascending: true }]);
    expect(segunda.filtros).toEqual(
      expect.arrayContaining([["organization_id", ORG], ["connection_id", CONEXAO], ["contact_phone", "5511900000001"]])
    );
  });

  it("a transcrição que chega depois troca a bolha no lugar, sem duplicar", async () => {
    const { db, operacoes, andar } = bancada();
    db.mensagens.push(
      mensagem("5511900000001", "m1", T0 - 60_000, { media_type: "ptt" }),
      mensagem("5511900000001", "m2", T0 - 30_000)
    );
    db.mensagens[0].content = "";
    await operacoes["conversas.mensagens"]({ id: ID });

    andar(20_000);
    db.mensagens[0] = { ...db.mensagens[0], content: "quero saber do plano", transcribed_at: iso(T0 + 15_000), changed_at: iso(T0 + 15_000) };
    const lista = await operacoes["conversas.mensagens"]({ id: ID });
    const bolhas = lista.filter((m) => m.tipo === "mensagem");
    expect(bolhas.map((m) => m.messageId)).toEqual(["m1", "m2"]);
    expect(bolhas[0]).toMatchObject({ texto: "quero saber do plano", transcricao: true });
  });

  it("sem a coluna changed_at, relê a conversa inteira como hoje e as próximas vão sem ela", async () => {
    const { db, opcoes, operacoes, consultas } = bancada();
    opcoes.semColunaDeAlteracao = true;
    db.mensagens.push(mensagem("5511900000001", "m1", T0 - 60_000));
    expect(daTela(await operacoes["conversas.mensagens"]({ id: ID }))).toEqual(["m1"]);
    expect(daTela(await operacoes["conversas.mensagens"]({ id: ID }))).toEqual(["m1"]);

    const pedidos = pedidosDeMensagens(consultas);
    expect(pedidos.map((p) => p.campos.includes("changed_at"))).toEqual([true, false, false]);
    expect(pedidos.every((p) => p.maiores.length === 0)).toBe(true);
    expect(pedidos.slice(1).every((p) => p.limite === 300 && p.ordem[0] === "sent_at")).toBe(true);
  });

  it("trocar de conversa no meio do pedido não mistura as mensagens", async () => {
    const { db, operacoes, from } = bancada();
    db.mensagens.push(mensagem("5511900000001", "a1", T0 - 60_000), mensagem("5511900000002", "b1", T0 - 50_000));
    // A primeira consulta (conversa A) demora; a de B responde antes.
    const original = from.getMockImplementation();
    let segurar = null;
    from.mockImplementation((tabela) => {
      const consulta = original(tabela);
      if (tabela === "whatsapp_messages" && !segurar) {
        const then = consulta.then;
        segurar = new Promise((solta) => {
          consulta.then = (ok, falha) => new Promise((r) => (segurar.soltar = r)).then(() => then(ok, falha));
          solta();
        });
      }
      return consulta;
    });
    const pedidoA = operacoes["conversas.mensagens"]({ id: ID });
    const pedidoB = operacoes["conversas.mensagens"]({ id: ID_B });
    expect(daTela(await pedidoB)).toEqual(["b1"]);
    await segurar;
    segurar.soltar();
    expect(daTela(await pedidoA)).toEqual(["a1"]);

    // E cada uma segue com o próprio cursor.
    db.mensagens.push(mensagem("5511900000002", "b2", T0 + 1_000));
    expect(daTela(await operacoes["conversas.mensagens"]({ id: ID }))).toEqual(["a1"]);
    expect(daTela(await operacoes["conversas.mensagens"]({ id: ID_B }))).toEqual(["b1", "b2"]);
  });

  it("a mídia não é reassinada a cada recarga", async () => {
    const { db, operacoes, andar, assinaturas } = bancada();
    db.mensagens.push(mensagem("5511900000001", "m1", T0 - 60_000, { media_type: "image", media_path: `${ORG}/x/m1.jpg` }));
    const [, primeira] = await operacoes["conversas.mensagens"]({ id: ID });
    for (let i = 0; i < 3; i += 1) {
      andar(60_000);
      await operacoes["conversas.mensagens"]({ id: ID });
    }
    andar(RELEITURA_COMPLETA_MS);
    const [, depois] = await operacoes["conversas.mensagens"]({ id: ID });
    expect(depois.midia.url).toBe(primeira.midia.url);
    expect(assinaturas.filter((a) => a.bucket === "whatsapp-media")).toHaveLength(1);
  });

  it("a releitura completa de 10 min tira a mensagem apagada", async () => {
    const { db, operacoes, andar } = bancada();
    db.mensagens.push(mensagem("5511900000001", "m1", T0 - 60_000), mensagem("5511900000001", "m2", T0 - 30_000));
    await operacoes["conversas.mensagens"]({ id: ID });
    db.mensagens.splice(0, 1);
    andar(RELEITURA_COMPLETA_MS);
    expect(daTela(await operacoes["conversas.mensagens"]({ id: ID }))).toEqual(["m2"]);
  });
});

describe("cópia local (injeção para o Major 3)", () => {
  it("desligada por padrão: nada é gravado e as guardadas são nulas", async () => {
    const { db, operacoes, cache } = bancada();
    db.conversas.push(conversa("5511900000001", T0));
    await operacoes["conversas.listar"]();
    expect(cache.gravar).not.toHaveBeenCalled();
    await expect(operacoes["conversas.listaGuardada"]()).resolves.toBeNull();
  });

  it("ligada: grava a lista e a conversa por empresa, e devolve o que guardou", async () => {
    const { db, operacoes, gravadas } = bancada({ comCache: true });
    db.conversas.push(conversa("5511900000001", T0));
    db.mensagens.push(mensagem("5511900000001", "m1", T0));
    const lista = await operacoes["conversas.listar"]();
    const conversaAberta = await operacoes["conversas.mensagens"]({ id: `${CONEXAO}:5511900000001` });
    expect(gravadas).toEqual([`conversas:${ORG}`, `mensagens:${ORG}:${CONEXAO}:5511900000001`]);
    await expect(operacoes["conversas.listaGuardada"]()).resolves.toEqual(lista);
    await expect(operacoes["conversas.mensagensGuardadas"]({ id: `${CONEXAO}:5511900000001` })).resolves.toEqual(conversaAberta);
  });

  it("falha do cache não derruba a lista", async () => {
    const { db, operacoes, cache } = bancada({ comCache: true });
    cache.gravar.mockRejectedValue(new Error("IndexedDB cheio"));
    cache.ler.mockRejectedValue(new Error("IndexedDB fechado"));
    db.conversas.push(conversa("5511900000001", T0));
    await expect(operacoes["conversas.listar"]()).resolves.toHaveLength(1);
    await expect(operacoes["conversas.listaGuardada"]()).resolves.toBeNull();
  });
});
