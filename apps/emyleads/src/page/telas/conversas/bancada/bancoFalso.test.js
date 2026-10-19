import { describe, expect, it } from "vitest";
import { criarBancoFalso, criarClienteFalso } from "./bancoFalso.js";
import { CONEXAO, ORGANIZACAO, gerarEmpresa, popular } from "./cenario.js";

/**
 * A bancada só mede o que importa se o banco falso responder como o de
 * verdade. Estas provas fixam o comportamento que o portal novo depende de
 * enxergar: coluna e RPC que faltam no banco de hoje, `changed_at` que não
 * anda com a regravação da sincronia, e o aviso de realtime só com mudança.
 */

const conversa = (telefone, extra = {}) => ({
  organization_id: ORGANIZACAO,
  connection_id: CONEXAO,
  contact_phone: telefone,
  chat_kind: "pessoa",
  contact_name: "",
  contact_photo_url: null,
  last_message_preview: "oi",
  last_message_at: "2026-10-20T12:00:00.000Z",
  last_message_from_me: false,
  unread_count: 0,
  owner: "bot",
  attendant_id: null,
  attendant_name: null,
  ...extra,
});

describe("banco de hoje", () => {
  it("responde 42703 para changed_at e PGRST202 para a RPC da lista", async () => {
    const banco = criarBancoFalso({ esquema: "hoje" });
    const cliente = criarClienteFalso(banco);
    const coluna = await cliente.from("whatsapp_messages").select("message_id,changed_at").eq("organization_id", ORGANIZACAO);
    expect(coluna.error?.code).toBe("42703");
    const rpc = await cliente.rpc("nucleo_conversation_list", { target_organization: ORGANIZACAO });
    expect(rpc.error?.code).toBe("PGRST202");
  });

  it("não avisa o realtime quando a sincronia só regrava updated_at", () => {
    let agora = Date.UTC(2026, 9, 20);
    const banco = criarBancoFalso({ esquema: "hoje", agora: () => agora });
    const avisos = [];
    banco.ouvir((evento) => avisos.push(evento));
    banco.inserir("whatsapp_conversations", conversa("5511987654321"));
    expect(avisos).toHaveLength(1);
    agora += 15_000;
    banco.atualizar("whatsapp_conversations", () => true, { updated_at: new Date(agora).toISOString() });
    expect(avisos).toHaveLength(1);
    banco.atualizar("whatsapp_conversations", () => true, { unread_count: 1 });
    expect(avisos).toHaveLength(2);
    expect(avisos[1]).toEqual({ organization_id: ORGANIZACAO, topic: "conversas", entity_id: CONEXAO });
  });
});

describe("banco da escala (contrato da seção 4)", () => {
  it("changed_at só anda quando algo além de updated_at muda, e o aviso leva a conversa", () => {
    let agora = Date.UTC(2026, 9, 20);
    const banco = criarBancoFalso({ esquema: "escala", agora: () => agora });
    const avisos = [];
    banco.ouvir((evento) => avisos.push(evento));
    banco.inserir("whatsapp_conversations", conversa("5511987654321"));
    const antes = banco.tabelas.whatsapp_conversations[0].changed_at;
    agora += 15_000;
    banco.atualizar("whatsapp_conversations", () => true, { updated_at: new Date(agora).toISOString() });
    expect(banco.tabelas.whatsapp_conversations[0].changed_at).toBe(antes);
    agora += 15_000;
    banco.atualizar("whatsapp_conversations", () => true, { last_message_preview: "nova" });
    expect(banco.tabelas.whatsapp_conversations[0].changed_at > antes).toBe(true);
    expect(avisos.at(-1)).toMatchObject({ topic: "conversas", entity_key: "5511987654321" });
  });

  it("a RPC casa o contato pelo nono dígito, não casa grupo e devolve o delta com contato mudado", async () => {
    let agora = Date.UTC(2026, 9, 20);
    const banco = criarBancoFalso({ esquema: "escala", agora: () => agora });
    banco.inserir("whatsapp_conversations", conversa("5511987654321"));
    banco.inserir("whatsapp_conversations", conversa("120363000000000001", { chat_kind: "grupo" }));
    banco.inserir("contacts", {
      id: "c-1", organization_id: ORGANIZACAO, name: "Maria", phone: "551187654321",
      company: "Clínica", job_title: null, avatar_path: "a.jpg", deleted_at: null,
    });
    banco.inserir("contacts", {
      id: "c-2", organization_id: ORGANIZACAO, name: "Grupo?", phone: "120363000000000001",
      company: null, job_title: null, avatar_path: null, deleted_at: null,
    });
    const cliente = criarClienteFalso(banco, { agora: () => agora });
    const tudo = await cliente.rpc("nucleo_conversation_list", { target_organization: ORGANIZACAO });
    const pessoa = tudo.data.find((l) => l.chat_kind === "pessoa");
    const grupo = tudo.data.find((l) => l.chat_kind === "grupo");
    expect(pessoa).toMatchObject({ contact_id: "c-1", crm_name: "Maria", crm_avatar_path: "a.jpg" });
    expect(grupo.contact_id).toBeNull();

    const cursor = new Date(agora).toISOString();
    agora += 60_000;
    const nada = await cliente.rpc("nucleo_conversation_list", { target_organization: ORGANIZACAO, changed_since: cursor });
    expect(nada.data).toEqual([]);
    banco.atualizar("contacts", (c) => c.id === "c-1", { name: "Maria Souza" });
    const delta = await cliente.rpc("nucleo_conversation_list", { target_organization: ORGANIZACAO, changed_since: cursor });
    expect(delta.data.map((l) => l.crm_name)).toEqual(["Maria Souza"]);
  });
});

describe("cliente falso", () => {
  it("conta pedidos, linhas e bytes por origem e por minuto", async () => {
    let agora = Date.UTC(2026, 9, 20);
    const banco = criarBancoFalso({ esquema: "hoje", agora: () => agora });
    popular(banco, gerarEmpresa({ conversas: 20, inicio: agora }));
    const cliente = criarClienteFalso(banco, { agora: () => agora });
    await cliente.from("whatsapp_conversations").select("contact_phone").eq("organization_id", ORGANIZACAO);
    agora += 61_000;
    await cliente.from("contacts").select("id,name").eq("organization_id", ORGANIZACAO);
    expect(cliente.contagem.pedidos).toBe(2);
    expect(cliente.contagem.porOrigem.whatsapp_conversations.linhas).toBe(20);
    expect(cliente.contagem.porOrigem.contacts.linhas).toBe(40);
    expect(cliente.contagem.porMinuto[1].linhas).toBe(40);
    expect(cliente.contagem.bytes).toBeGreaterThan(0);
  });

  it("conta a URL reassinada enquanto a anterior ainda valia", async () => {
    let agora = Date.UTC(2026, 9, 20);
    const cliente = criarClienteFalso(criarBancoFalso(), { agora: () => agora });
    await cliente.storage.from("contact-avatars").createSignedUrls(["a.jpg"], 3600);
    agora += 20_000;
    await cliente.storage.from("contact-avatars").createSignedUrls(["a.jpg"], 3600);
    agora += 3_600_000;
    await cliente.storage.from("contact-avatars").createSignedUrls(["a.jpg"], 3600);
    expect(cliente.reassinaturas).toEqual({ antesDeVencer: 1, total: 2 });
  });
});
