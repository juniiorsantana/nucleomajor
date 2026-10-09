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
    if (["select", "order", "limit"].includes(campo)) continue;
    saida = saida.filter((linha) => {
      const valor = linha[campo];
      if (regra === "is.null") return valor === null || valor === undefined;
      if (regra === "not.is.null") return valor !== null && valor !== undefined;
      const [op, ...resto] = regra.split(".");
      const alvo = resto.join(".");
      if (op === "in") return alvo.replace(/[()]/g, "").split(",").includes(String(valor));
      if (op === "like" || op === "ilike") {
        const padrao = alvo.split("*").map((parte) => parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
        return new RegExp(`^${padrao}$`, op === "ilike" ? "i" : "").test(String(valor ?? ""));
      }
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
    { organization_id: ORG_A, contact_phone: "556592178164", is_from_me: false, sent_at: "2026-10-10T01:00:00Z", content: "Oi, ainda tem horário amanhã?", author_kind: "contato" }, // 22h de 09/10 em Brasília
    { organization_id: ORG_A, contact_phone: "556592178164", is_from_me: true, sent_at: "2026-10-09T12:00:00Z", content: "Temos às 10h, serve?", author_kind: "ia", author_name: "" },
    { organization_id: ORG_A, contact_phone: "556592178164", is_from_me: false, sent_at: "2026-10-09T11:00:00Z", content: "", media_type: "audio", author_kind: "contato" },
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
      // Esperando há quase três semanas, e nunca virou contato no CRM.
      { organization_id: ORG_A, contact_phone: "5511933334444", contact_name: "Paciente Antiga", chat_kind: "direto", unread_count: 1, owner: "humano", last_message_from_me: false, last_message_at: "2026-09-20T12:00:00Z", last_message_preview: "Vocês atendem sábado?" },
    ],
    deals: [
      { organization_id: ORG_A, contact_id: "c1", stage_id: "s2", title: "Botox", value: "1200.00", status: "aberto", loss_reason: "", deleted_at: null, updated_at: "2026-10-09T13:00:00Z" },
    ],
    stages: [
      { organization_id: ORG_A, id: "s1", name: "Lead", deleted_at: null },
      { organization_id: ORG_A, id: "s2", name: "Em contato", deleted_at: null },
    ],
    notes: [
      { organization_id: ORG_A, contact_id: "c1", body: "Prefere horário de manhã.", author_label: "Carla", deleted_at: null, created_at: "2026-10-09T13:30:00Z" },
    ],
    whatsapp_messages: mensagens,
    contacts: [
      { organization_id: ORG_A, id: "c1", name: "Maria Souza", phone: "5565992178164", deleted_at: null, lead_at: "2026-10-09T13:00:00Z", source: "Formulário Meta" },
      { organization_id: ORG_A, id: "c6", name: "Mariana Lima", phone: "5511955556666", deleted_at: null, lead_at: null },
      { organization_id: ORG_A, id: "c2", name: "João", phone: "5511911112222", deleted_at: null, lead_at: "2026-10-01T13:00:00Z" },
      { organization_id: ORG_A, id: "c3", name: "Fornecedor", phone: "5511988887777", deleted_at: null, lead_at: null },
      { organization_id: ORG_A, id: "c4", name: "Apagado", phone: "5511900000001", deleted_at: "2026-10-02T00:00:00Z", lead_at: "2026-10-01T00:00:00Z" },
      { organization_id: ORG_B, id: "c5", name: "Lead da B", phone: "5521900000000", deleted_at: null, lead_at: "2026-10-09T13:00:00Z" },
    ],
    tasks: [
      { organization_id: ORG_A, id: "t1", contact_id: "c1", title: "Ligar para Maria", due_at: "2026-10-09T18:00:00Z", owner_id: "user-a", deleted_at: null, completed: false },
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
  assert.deepEqual(nomes, [
    "minhas_empresas", "resumo_do_dia", "esperando_resposta", "leads_esperando", "ficha_do_contato",
    "conversa_com_contato", "conversas", "leads", "tarefas", "agenda",
  ]);
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
  assert.equal(conversas.periodo, "hoje");
  assert.equal(conversas.de, "2026-10-09T03:00:00.000Z", "23h30 em Brasília ainda é dia 9");
  assert.equal(conversas.diretas, 4);
  assert.equal(conversas.grupos, 1);
  assert.equal(conversas.comMensagem, 2, "a de ontem às 23h30 e o grupo ficam de fora");
  assert.equal(conversas.mensagensRecebidas, 1207, "paginou além de mil linhas");
  assert.equal(conversas.mensagensEnviadas, 1);
  assert.equal(conversas.anterior.comMensagem, 1, "ontem: a do João às 23h30");
  assert.equal(conversas.naoLidas, 2);
  assert.deepEqual(conversas.precisaDeVoce, { total: 2, hoje: 1, semana: 0, antigas: 1 }, "separado por idade");

  const leads = (await chamar("tok-a", "leads")).structuredContent;
  assert.deepEqual([leads.total, leads.noPeriodo, leads.anterior], [2, 1, 0]);

  const esperando = await chamar("tok-a", "leads_esperando");
  assert.equal(esperando.structuredContent.total, 1, "o fornecedor não é lead");
  const [maria] = esperando.structuredContent.hoje.lista;
  assert.equal(maria.nome, "Maria Souza", "casou 5565992178164 com 556592178164");
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
  assert.equal(ontem.comMensagem, 1);

  const diaRuim = await chamar("tok-a", "agenda", { dia: "09/10" });
  assert.equal(diaRuim.isError, true);
});

test("quem está esperando: todos, por idade, e as antigas dizem quem é", async (t) => {
  const { chamar } = await servidor(t);
  const r = await chamar("tok-a", "esperando_resposta");
  const dados = r.structuredContent;
  assert.equal(dados.total, 3);
  assert.deepEqual(dados.hoje.lista.map((item) => [item.nome, item.lead]), [["Fornecedor", false], ["Maria Souza", true]], "a espera mais longa primeiro");
  assert.equal(dados.antigas.total, 1);
  assert.equal(dados.antigas.lista[0].nome, "Paciente Antiga", "fora do CRM, pelo nome da conversa");
  assert.equal(dados.antigas.lista[0].espera, "19 dias");
  assert.match(r.content[0].text, /Há mais tempo/);
  assert.match(r.content[0].text, /Vocês atendem sábado\?/);

  const resumo = await chamar("tok-a", "resumo_do_dia");
  assert.match(resumo.content[0].text, /Esperando resposta: 3 \(2 de hoje, 0 dos últimos 7 dias, 1 há mais tempo\)/);
  assert.match(resumo.content[0].text, /Precisando de alguém da equipe: 2 \(1 de hoje, 0 dos últimos 7 dias, 1 mais antigas\)/);
});

test("períodos: semana, mês, comparação e período desconhecido", async (t) => {
  const { chamar } = await servidor(t);
  const semana = (await chamar("tok-a", "leads", { periodo: "semana" })).structuredContent;
  assert.equal(semana.de, "2026-10-05T03:00:00.000Z", "a semana começa na segunda");
  assert.equal(semana.ate, "2026-10-10T03:00:00.000Z", "e vai até o fim de hoje");
  assert.deepEqual([semana.noPeriodo, semana.anterior], [1, 1], "João entrou na semana passada");

  const mes = (await chamar("tok-a", "leads", { periodo: "mes" })).structuredContent;
  assert.equal(mes.de, "2026-10-01T03:00:00.000Z");
  assert.equal(mes.noPeriodo, 2);

  const texto = (await chamar("tok-a", "conversas", { periodo: "7dias" })).content[0].text;
  assert.match(texto, /nos últimos 7 dias/);
  assert.match(texto, /nos 7 dias anteriores/);

  const ruim = await chamar("tok-a", "leads", { periodo: "trimestre" });
  assert.equal(ruim.isError, true);
});

test("agenda de vários dias, agrupada por dia", async (t) => {
  const { chamar } = await servidor(t);
  const r = await chamar("tok-a", "agenda", { dias: 2 });
  assert.equal(r.structuredContent.total, 2);
  assert.deepEqual(r.structuredContent.eventos.map((e) => e.dia), ["2026-10-09", "2026-10-10"]);
  assert.match(r.content[0].text, /Compromissos nos próximos 2 dias: 2/);
  assert.match(r.content[0].text, /sex\.?, 09\/10/);
});

test("ficha do contato: por nome, por número, pelos últimos dígitos, e sem chutar", async (t) => {
  const { chamar } = await servidor(t);
  const r = await chamar("tok-a", "ficha_do_contato", { busca: "maria souza" });
  const f = r.structuredContent;
  assert.equal(f.nome, "Maria Souza");
  assert.equal(f.lead, true);
  assert.deepEqual(f.negocios, [{ titulo: "Botox", etapa: "Em contato", situacao: "aberto", valor: 1200, motivoDaPerda: null }]);
  assert.deepEqual(f.tarefasAbertas.map((tarefa) => tarefa.titulo), ["Ligar para Maria"]);
  assert.equal(f.notas[0].texto, "Prefere horário de manhã.");
  assert.equal(f.conversa.esperandoResposta, true);
  assert.equal(f.telefone, "…8164");
  assert.doesNotMatch(r.content[0].text, /92178164/, "o telefone não sai inteiro");
  assert.match(r.content[0].text, /Em contato, aberto, R\$ 1\.200/);

  for (const busca of ["(65) 99217-8164", "6592178164", "8164"]) {
    const porNumero = await chamar("tok-a", "ficha_do_contato", { busca });
    assert.equal(porNumero.structuredContent?.nome, "Maria Souza", busca);
  }

  const duas = await chamar("tok-a", "ficha_do_contato", { busca: "maria" });
  assert.equal(duas.isError, true, "Maria Souza e Mariana Lima: pergunta em vez de chutar");
  assert.match(duas.content[0].text, /Maria Souza.*Mariana Lima|Mariana Lima.*Maria Souza/);

  const soWhatsApp = (await chamar("tok-a", "ficha_do_contato", { busca: "paciente antiga" })).structuredContent;
  assert.equal(soWhatsApp.noCrm, false);
  assert.equal(soWhatsApp.conversa.esperandoResposta, true);

  const ninguem = await chamar("tok-a", "ficha_do_contato", { busca: "Zé Ninguém" });
  assert.equal(ninguem.isError, true);

  const daOutra = await chamar("tok-a", "ficha_do_contato", { busca: "Lead da B" });
  assert.equal(daOutra.isError, true, "contato de outra empresa não aparece");
});

test("conversa com o contato: em ordem, com quem falou e a mídia pelo rótulo", async (t) => {
  const { chamar } = await servidor(t);
  const r = await chamar("tok-a", "conversa_com_contato", { busca: "maria souza", mensagens: 10 });
  const dados = r.structuredContent;
  assert.equal(dados.total, 3);
  assert.deepEqual(dados.mensagens.map((m) => [m.quem, m.texto]), [
    ["Maria Souza", "[áudio]"],
    ["IA", "Temos às 10h, serve?"],
    ["Maria Souza", "Oi, ainda tem horário amanhã?"],
  ]);
  assert.match(r.content[0].text, /09\/10 09:00 · IA: Temos às 10h, serve\?/);

  const ultima = (await chamar("tok-a", "conversa_com_contato", { busca: "8164", mensagens: 1 })).structuredContent;
  assert.deepEqual(ultima.mensagens.map((m) => m.texto), ["Oi, ainda tem horário amanhã?"], "a mais recente fica");
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
