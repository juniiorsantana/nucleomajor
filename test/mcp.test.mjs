import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";
import { createMcp } from "../src/mcp.mjs";
import { escolherEmpresa, intervaloDoDia, diaEmSaoPaulo } from "../src/mcpTools.mjs";

const ORIGEM = "https://nucleomajor.test";
const SUPABASE = "https://supabase.test";
const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_B = "bbbbbbbb-0000-0000-0000-000000000002";
// 23h30 de 09/10 em Brasília: em UTC já é dia 10. É aqui que um "hoje" em
// UTC erraria.
const AGORA = new Date("2026-10-10T02:30:00Z");

/* Um PostgREST de brinquedo: aplica os filtros que o MCP usa. */
function filtrar(linhas, params) {
  let saida = linhas;
  for (const [campo, regra] of params) {
    if (["select", "order"].includes(campo)) continue;
    saida = saida.filter((linha) => {
      const valor = linha[campo];
      if (regra === "is.null") return valor === null || valor === undefined;
      if (regra === "not.is.null") return valor !== null && valor !== undefined;
      const [op, ...resto] = regra.split(".");
      const alvo = resto.join(".");
      if (op === "in") return alvo.replace(/[()]/g, "").split(",").includes(String(valor));
      const comparar = (a, b) => {
        if (typeof a === "number") return a - Number(b);
        if (typeof a === "boolean") return String(a) === b ? 0 : 1;
        const da = Date.parse(a);
        const db = Date.parse(b);
        if (!Number.isNaN(da) && !Number.isNaN(db) && /\d{4}-\d{2}-\d{2}T/.test(b)) return da - db;
        return String(a) === b ? 0 : String(a) < b ? -1 : 1;
      };
      if (valor === null || valor === undefined) return false;
      const c = comparar(valor, alvo);
      return { eq: c === 0, gt: c > 0, gte: c >= 0, lt: c < 0 }[op];
    });
  }
  return saida;
}

function supabaseFalso(dados) {
  const consultas = [];
  async function fetchImpl(endereco, opcoes = {}) {
    const url = new URL(endereco);
    const token = String(opcoes.headers?.Authorization || "").replace("Bearer ", "");
    consultas.push({ caminho: url.pathname, busca: url.search, token });
    const usuario = dados.tokens[token];
    if (url.pathname === "/auth/v1/user") {
      return usuario ? Response.json({ id: usuario }) : new Response("{}", { status: 403 });
    }
    if (!usuario) return new Response("{}", { status: 401 });

    if (url.pathname === "/rest/v1/rpc/calendar_events_list") {
      const corpo = JSON.parse(opcoes.body);
      const linhas = dados.eventos.filter((e) => e.organization_id === corpo.target_organization
        && Date.parse(e.starts_at) < Date.parse(corpo.range_end) && Date.parse(e.ends_at) > Date.parse(corpo.range_start));
      return Response.json(linhas);
    }

    const tabela = url.pathname.replace("/rest/v1/", "");
    let linhas;
    if (tabela === "organization_members") {
      linhas = dados.vinculos.filter((v) => v.user_id === usuario)
        .map((v) => ({ role: v.role, user_id: v.user_id, status: "active", organization: dados.empresas.find((e) => e.id === v.organization_id) }));
    } else {
      linhas = dados[tabela] || [];
      // A RLS: só linhas das empresas em que a pessoa participa.
      const minhas = new Set(dados.vinculos.filter((v) => v.user_id === usuario).map((v) => v.organization_id));
      if (tabela !== "profiles") linhas = linhas.filter((l) => minhas.has(l.organization_id));
    }
    const params = [...url.searchParams.entries()].filter(([campo]) => campo !== "user_id" && campo !== "status");
    linhas = filtrar(linhas, params);

    if (opcoes.method === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-range": `0-0/${linhas.length}` } });
    }
    const faixa = String(opcoes.headers?.Range || "").match(/^(\d+)-(\d+)$/);
    if (faixa) linhas = linhas.slice(Number(faixa[1]), Number(faixa[2]) + 1);
    return Response.json(linhas);
  }
  return { fetchImpl, consultas };
}

function cenario() {
  const mensagens = [];
  // 1.205 mensagens recebidas hoje de uma conversa: obriga a paginar.
  for (let i = 0; i < 1205; i += 1) {
    mensagens.push({ organization_id: ORG_A, contact_phone: "5511988887777", is_from_me: false, sent_at: "2026-10-09T15:00:00Z" });
  }
  mensagens.push(
    { organization_id: ORG_A, contact_phone: "556592178164", is_from_me: false, sent_at: "2026-10-10T01:00:00Z" }, // 22h de 09/10 em Brasília
    { organization_id: ORG_A, contact_phone: "556592178164", is_from_me: true, sent_at: "2026-10-09T12:00:00Z" },
    { organization_id: ORG_A, contact_phone: "5511911112222", is_from_me: false, sent_at: "2026-10-09T02:30:00Z" }, // 23h30 de 08/10: ontem
    { organization_id: ORG_A, contact_phone: "120363000000000001", is_from_me: false, sent_at: "2026-10-09T15:00:00Z" }, // grupo
    { organization_id: ORG_B, contact_phone: "5521900000000", is_from_me: false, sent_at: "2026-10-09T15:00:00Z" },
  );
  return {
    tokens: { "tok-a": "user-a", "tok-major": "user-m" },
    empresas: [{ id: ORG_A, name: "Clínica Adriani" }, { id: ORG_B, name: "Clínica Bela" }],
    vinculos: [
      { user_id: "user-a", organization_id: ORG_A, role: "owner" },
      { user_id: "user-m", organization_id: ORG_A, role: "admin" },
      { user_id: "user-m", organization_id: ORG_B, role: "admin" },
    ],
    whatsapp_conversations: [
      // Lead esperando: a última mensagem é dele, salvo sem o nono dígito.
      { organization_id: ORG_A, contact_phone: "556592178164", contact_name: "Maria", chat_kind: "direto", unread_count: 2, owner: "humano", last_message_from_me: false, last_message_at: "2026-10-10T01:00:00Z", last_message_preview: "Oi, ainda tem horário amanhã?" },
      // Contato que não é lead, também esperando: não entra na lista de leads.
      { organization_id: ORG_A, contact_phone: "5511988887777", contact_name: "Fornecedor", chat_kind: "direto", unread_count: 0, owner: "ia", last_message_from_me: false, last_message_at: "2026-10-09T15:00:00Z", last_message_preview: "ok" },
      // Lead já respondido pela equipe.
      { organization_id: ORG_A, contact_phone: "5511911112222", contact_name: "João", chat_kind: "direto", unread_count: 0, owner: "bot", last_message_from_me: true, last_message_at: "2026-10-09T02:30:00Z", last_message_preview: "Até amanhã" },
      { organization_id: ORG_A, contact_phone: "120363000000000001", contact_name: "Equipe", chat_kind: "grupo", unread_count: 9, owner: "bot", last_message_from_me: false, last_message_at: "2026-10-09T15:00:00Z" },
      { organization_id: ORG_B, contact_phone: "5521900000000", contact_name: "Segredo da B", chat_kind: "direto", unread_count: 1, owner: "humano", last_message_from_me: false, last_message_at: "2026-10-09T15:00:00Z", last_message_preview: "dado da B" },
    ],
    whatsapp_messages: mensagens,
    contacts: [
      { organization_id: ORG_A, id: "c1", name: "Maria Souza", phone: "65992178164", deleted_at: null, lead_at: "2026-10-09T13:00:00Z" },
      { organization_id: ORG_A, id: "c2", name: "João", phone: "5511911112222", deleted_at: null, lead_at: "2026-10-01T13:00:00Z" },
      { organization_id: ORG_A, id: "c3", name: "Fornecedor", phone: "5511988887777", deleted_at: null, lead_at: null },
      { organization_id: ORG_A, id: "c4", name: "Apagado", phone: "5511900000001", deleted_at: "2026-10-02T00:00:00Z", lead_at: "2026-10-01T00:00:00Z" },
      { organization_id: ORG_B, id: "c5", name: "Lead da B", phone: "5521900000000", deleted_at: null, lead_at: "2026-10-09T13:00:00Z" },
    ],
    tasks: [
      { organization_id: ORG_A, id: "t1", title: "Ligar para Maria", due_at: "2026-10-09T18:00:00Z", owner_id: "user-a", deleted_at: null, completed: false },
      { organization_id: ORG_A, id: "t2", title: "Enviar orçamento", due_at: "2026-10-07T18:00:00Z", owner_id: "user-x", deleted_at: null, completed: false },
      { organization_id: ORG_A, id: "t3", title: "Feita", due_at: "2026-10-09T18:00:00Z", owner_id: "user-a", deleted_at: null, completed: true },
      { organization_id: ORG_A, id: "t4", title: "Sem prazo", due_at: null, owner_id: null, deleted_at: null, completed: false },
    ],
    task_assignees: [{ organization_id: ORG_A, task_id: "t2", user_id: "user-x" }],
    profiles: [{ id: "user-x", full_name: "Carla Recepção" }],
    eventos: [
      { organization_id: ORG_A, source_type: "event", title: "Avaliação", starts_at: "2026-10-09T17:00:00Z", ends_at: "2026-10-09T18:00:00Z", owner_name: "Dra. Adriani", status: "scheduled" },
      { organization_id: ORG_A, source_type: "task", title: "Ligar para Maria", starts_at: "2026-10-09T18:00:00Z", ends_at: "2026-10-09T18:30:00Z" },
      { organization_id: ORG_A, source_type: "event", title: "Amanhã", starts_at: "2026-10-10T13:00:00Z", ends_at: "2026-10-10T14:00:00Z" },
    ],
  };
}

async function servidor(t) {
  const falso = supabaseFalso(cenario());
  const mcp = createMcp({ publicOrigin: ORIGEM, supabaseUrl: SUPABASE, publishableKey: "pk", fetchImpl: falso.fetchImpl, now: () => AGORA });
  const server = createServer({ mcp });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  let id = 0;
  async function rpc(token, method, params) {
    const resposta = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    return { status: resposta.status, headers: resposta.headers, corpo: await resposta.json().catch(() => null) };
  }
  const chamar = (token, name, args = {}) => rpc(token, "tools/call", { name, arguments: args }).then((r) => r.corpo.result);
  return { origin, rpc, chamar, consultas: falso.consultas };
}

test("sem token, /mcp responde 401 com o caminho para o login", async (t) => {
  const { origin, rpc } = await servidor(t);
  const semToken = await rpc(null, "initialize", {});
  assert.equal(semToken.status, 401);
  assert.equal(semToken.headers.get("www-authenticate"), `Bearer resource_metadata="${ORIGEM}/.well-known/oauth-protected-resource"`);

  const tokenRuim = await rpc("tok-falso", "initialize", {});
  assert.equal(tokenRuim.status, 401);
  assert.match(tokenRuim.headers.get("www-authenticate"), /error="invalid_token"/);

  const get = await fetch(`${origin}/mcp`);
  assert.equal(get.status, 405);
});

test("o .well-known aponta para o Supabase Auth", async (t) => {
  const { origin } = await servidor(t);
  for (const caminho of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const resposta = await fetch(`${origin}${caminho}`);
    assert.equal(resposta.status, 200, caminho);
    const corpo = await resposta.json();
    assert.equal(corpo.resource, `${ORIGEM}/mcp`);
    assert.deepEqual(corpo.authorization_servers, [`${SUPABASE}/auth/v1`]);
  }
});

test("initialize, notificação e lista de ferramentas só de leitura", async (t) => {
  const { origin, rpc } = await servidor(t);
  const inicio = await rpc("tok-a", "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "teste", version: "1" } });
  assert.equal(inicio.status, 200);
  assert.equal(inicio.corpo.result.protocolVersion, "2025-06-18");
  assert.ok(inicio.corpo.result.capabilities.tools);
  assert.equal(inicio.headers.get("mcp-session-id"), null, "sem sessão: cada POST se basta");

  const desconhecida = await rpc("tok-a", "initialize", { protocolVersion: "1999-01-01" });
  assert.equal(desconhecida.corpo.result.protocolVersion, "2025-11-25");

  const notificacao = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer tok-a" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  assert.equal(notificacao.status, 202);

  const lista = await rpc("tok-a", "tools/list", {});
  const nomes = lista.corpo.result.tools.map((tool) => tool.name);
  assert.deepEqual(nomes, ["minhas_empresas", "resumo_do_dia", "conversas", "leads", "leads_esperando", "tarefas", "agenda"]);
  for (const tool of lista.corpo.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true, tool.name);
    assert.equal(tool.annotations.destructiveHint, false, tool.name);
  }

  const metodo = await rpc("tok-a", "resources/list", {});
  assert.equal(metodo.corpo.error.code, -32601);
});

test("as cinco perguntas, no fuso de Brasília e com a regra do portal", async (t) => {
  const { chamar } = await servidor(t);

  const conversas = (await chamar("tok-a", "conversas")).structuredContent;
  assert.equal(conversas.dia, "2026-10-09", "23h30 em Brasília ainda é dia 9");
  assert.equal(conversas.diretas, 3);
  assert.equal(conversas.grupos, 1);
  assert.equal(conversas.comMensagemNoDia, 2, "a de ontem às 23h30 e o grupo ficam de fora");
  assert.equal(conversas.mensagensRecebidas, 1206, "paginou além de mil linhas");
  assert.equal(conversas.mensagensEnviadas, 1);
  assert.equal(conversas.naoLidas, 1);
  assert.equal(conversas.precisaDeVoce, 1);

  const leads = (await chamar("tok-a", "leads")).structuredContent;
  assert.deepEqual([leads.total, leads.noDia, leads.ultimos7Dias], [2, 1, 1]);

  const esperando = await chamar("tok-a", "leads_esperando");
  assert.equal(esperando.structuredContent.total, 1, "o fornecedor não é lead");
  const [maria] = esperando.structuredContent.lista;
  assert.equal(maria.nome, "Maria Souza", "casou 65992178164 com 556592178164");
  assert.equal(maria.espera, "1 h 30 min");
  assert.equal(maria.quemAtende, "equipe");
  assert.doesNotMatch(esperando.content[0].text, /92178164/, "o telefone não sai");

  const tarefas = (await chamar("tok-a", "tarefas")).structuredContent;
  assert.deepEqual([tarefas.pendentes, tarefas.minhas, tarefas.atrasadas, tarefas.doDia, tarefas.semData], [3, 1, 1, 1, 1]);
  assert.deepEqual(tarefas.listaAtrasadas[0].responsaveis, ["Carla Recepção"]);
  assert.deepEqual(tarefas.listaDoDia[0].responsaveis, ["você"]);

  const agenda = await chamar("tok-a", "agenda");
  assert.equal(agenda.structuredContent.total, 1, "tarefa e evento de amanhã ficam de fora");
  assert.equal(agenda.structuredContent.eventos[0].horario, "14:00–15:00");

  const resumo = await chamar("tok-a", "resumo_do_dia");
  assert.equal(resumo.isError, undefined);
  assert.match(resumo.content[0].text, /Clínica Adriani — hoje, 09\/10/);
  assert.match(resumo.content[0].text, /Compromissos hoje: 1/);

  const ontem = (await chamar("tok-a", "conversas", { dia: "2026-10-08" })).structuredContent;
  assert.equal(ontem.comMensagemNoDia, 1);

  const diaRuim = await chamar("tok-a", "agenda", { dia: "09/10" });
  assert.equal(diaRuim.isError, true);
});

test("a empresa sai dos vínculos da pessoa: pedir a de outra é recusado", async (t) => {
  const { chamar, consultas } = await servidor(t);

  const alheia = await chamar("tok-a", "resumo_do_dia", { empresa: "Clínica Bela" });
  assert.equal(alheia.isError, true);
  assert.match(alheia.content[0].text, /Clínica Adriani/);
  assert.doesNotMatch(alheia.content[0].text, /Segredo|dado da B/);
  const peloId = await chamar("tok-a", "leads", { empresa: ORG_B });
  assert.equal(peloId.isError, true);
  assert.ok(!consultas.some((c) => c.token === "tok-a" && c.busca.includes(ORG_B)), "nenhuma consulta da B saiu com o token de A");

  const semEscolher = await chamar("tok-major", "leads");
  assert.equal(semEscolher.isError, true);
  assert.match(semEscolher.content[0].text, /2 empresas.*Clínica Adriani; Clínica Bela/);

  const daB = await chamar("tok-major", "leads", { empresa: "bela" });
  assert.equal(daB.structuredContent.empresa.nome, "Clínica Bela");
  assert.equal(daB.structuredContent.total, 1);

  const ambigua = await chamar("tok-major", "leads", { empresa: "clinica" });
  assert.equal(ambigua.isError, true);

  const lista = await chamar("tok-major", "minhas_empresas");
  assert.equal(lista.structuredContent.empresas.length, 2);
});

test("datas: o dia de Brasília e o intervalo de 24 h", () => {
  assert.equal(diaEmSaoPaulo(new Date("2026-10-10T02:59:00Z")), "2026-10-09");
  assert.equal(diaEmSaoPaulo(new Date("2026-10-10T03:00:00Z")), "2026-10-10");
  const { inicio, fim } = intervaloDoDia("2026-10-09");
  assert.equal(inicio.toISOString(), "2026-10-09T03:00:00.000Z");
  assert.equal(fim.toISOString(), "2026-10-10T03:00:00.000Z");
  assert.equal(escolherEmpresa([{ id: "1", nome: "Única" }], undefined).nome, "Única");
});
