import assert from "node:assert/strict";
import test from "node:test";
import { supabaseDb } from "../src/mcp.mjs";
import { runTool } from "../src/mcpCatalogo.mjs";
import { instanteEmBrasilia } from "../src/mcpEscrita.mjs";
import { ToolError } from "../src/mcpTools.mjs";

const MAJOR = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";
const OUTRA = "bbbbbbbb-0000-0000-0000-000000000002";
const LIBERADAS = new Set([MAJOR]);
// 10h de quarta, 29/10/2026, em Brasília.
const AGORA = new Date("2026-10-29T13:00:00Z");

/* ───────── um banco em memória: lê e grava com os filtros do PostgREST ───────── */

function casa(valor, regra) {
  if (regra === "is.null") return valor === null || valor === undefined;
  if (regra === "not.is.null") return valor !== null && valor !== undefined;
  const [op, ...resto] = regra.split(".");
  const alvo = decodeURIComponent(resto.join("."));
  if (op === "in") return alvo.replace(/^\(|\)$/g, "").split(",").includes(String(valor));
  if (op === "like" || op === "ilike") {
    const padrao = alvo.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${padrao}$`, op === "ilike" ? "i" : "").test(String(valor ?? ""));
  }
  if (valor === null || valor === undefined) return false;
  if (op === "eq") return String(valor) === alvo;
  const a = Date.parse(valor);
  const b = Date.parse(alvo);
  const c = !Number.isNaN(a) && !Number.isNaN(b) ? a - b : Number(valor) - Number(alvo);
  return { gt: c > 0, gte: c >= 0, lt: c < 0 }[op];
}

function bancoFalso(tabelas, { usuario, rpc = {}, recusas = {} } = {}) {
  const gravacoes = [];
  let sequencia = 0;
  const ler = (caminho) => {
    const url = new URL(caminho, "https://x.test");
    const tabela = url.pathname.replace("/rest/v1/", "");
    let linhas = tabelas[tabela] || [];
    let limite = Infinity;
    for (const [campo, regra] of url.searchParams.entries()) {
      if (campo === "select" || campo === "order") continue;
      if (campo === "limit") {
        limite = Number(regra);
        continue;
      }
      linhas = linhas.filter((linha) => casa(linha[campo], regra));
    }
    return { tabela, linhas: linhas.slice(0, limite) };
  };
  return {
    gravacoes,
    tabelas,
    async select(caminho) {
      return ler(caminho).linhas.map((l) => ({ ...l }));
    },
    async selectAll(caminho) {
      return ler(caminho).linhas.map((l) => ({ ...l }));
    },
    async count(caminho) {
      return ler(caminho).linhas.length;
    },
    async rpc(fn, corpo) {
      gravacoes.push({ rpc: fn, corpo });
      if (!rpc[fn]) throw new Error(`rpc inesperada: ${fn}`);
      return rpc[fn](corpo);
    },
    async insert(tabela, linha) {
      if (recusas[tabela]) throw recusas[tabela];
      sequencia += 1;
      const nova = { id: `${tabela}-${sequencia}`, created_at: AGORA.toISOString(), deleted_at: null, ...linha };
      (tabelas[tabela] ||= []).push(nova);
      gravacoes.push({ insert: tabela, linha: nova });
      return { ...nova };
    },
    async update(caminho, patch) {
      const { tabela, linhas } = ler(caminho);
      if (recusas[`update:${tabela}`]) throw recusas[`update:${tabela}`];
      for (const linha of linhas) Object.assign(linha, patch);
      gravacoes.push({ update: tabela, patch, ids: linhas.map((l) => l.id) });
      return linhas.map((l) => ({ ...l }));
    },
    usuario,
  };
}

function cenario() {
  return {
    organization_members: [
      { user_id: "u-junior", status: "active", role: "owner", organization_id: MAJOR, organization: { id: MAJOR, name: "Núcleo Major" } },
      { user_id: "u-ana", status: "active", role: "member", organization_id: MAJOR, organization: { id: MAJOR, name: "Núcleo Major" } },
      { user_id: "u-cliente", status: "active", role: "owner", organization_id: OUTRA, organization: { id: OUTRA, name: "Clínica Bela" } },
    ],
    profiles: [
      { id: "u-junior", full_name: "Junior Santana" },
      { id: "u-ana", full_name: "Ana Paula" },
    ],
    contacts: [
      { id: "c-maria", organization_id: MAJOR, name: "Maria Souza", phone: "5565992178164", lead_at: "2026-10-01T12:00:00Z", created_at: "2026-10-01T12:00:00Z", deleted_at: null, source: "Instagram" },
      { id: "c-joao", organization_id: MAJOR, name: "João Lima", phone: "5511988887777", lead_at: null, created_at: "2026-09-10T12:00:00Z", deleted_at: null, source: "" },
      { id: "c-mariana", organization_id: MAJOR, name: "Mariana Alves", phone: "5521977776666", lead_at: null, created_at: "2026-10-20T12:00:00Z", deleted_at: null, source: "Site" },
    ],
    whatsapp_conversations: [
      { organization_id: MAJOR, connection_id: "conn-1", chat_kind: "direto", contact_phone: "5565992178164", contact_name: "Maria", last_message_at: "2026-10-29T12:00:00Z", last_message_from_me: false },
      { organization_id: MAJOR, connection_id: "conn-1", chat_kind: "direto", contact_phone: "5548999990000", contact_name: "Pedro Novo", last_message_at: "2026-10-29T11:00:00Z", last_message_from_me: false },
    ],
    stages: [
      { id: "s-lead", organization_id: MAJOR, name: "Lead", position: 0, deleted_at: null },
      { id: "s-qualif", organization_id: MAJOR, name: "Qualificação", position: 2, deleted_at: null },
      { id: "s-prop", organization_id: MAJOR, name: "Proposta", position: 3, deleted_at: null },
      { id: "s-fechado", organization_id: MAJOR, name: "Fechado", position: 5, deleted_at: null },
    ],
    deals: [
      { id: "d-maria", organization_id: MAJOR, contact_id: "c-maria", stage_id: "s-qualif", status: "aberto", title: "", value: 1500, deleted_at: null, created_at: "2026-10-05T12:00:00Z", updated_at: "2026-10-05T12:00:00Z", closed_at: null, loss_reason: "" },
    ],
    tasks: [],
    task_assignees: [],
    notes: [],
    contact_events: [],
    calendar_categories: [{ id: "cat-1", organization_id: MAJOR, active: true, position: 0 }],
    calendar_events: [],
    deal_stage_history: [],
    conversation_analyses: [],
  };
}

const rodar = (db, nome, args = {}, usuario = "u-junior") => runTool(nome, args, { db, user: { id: usuario }, agora: AGORA, liberadas: LIBERADAS });

const recusaCom = (trecho) => (erro) => erro instanceof ToolError && erro.message.includes(trecho);

/* ───────────────────────── a trava das empresas ───────────────────────── */

test("relatório e escrita só nas empresas liberadas; a leitura continua para todas", async () => {
  const db = bancoFalso(cenario());
  await assert.rejects(rodar(db, "criar_tarefa", { titulo: "Ligar" }, "u-cliente"), recusaCom("ainda não estão liberados para Clínica Bela"));
  await assert.rejects(rodar(db, "relatorio_de_vendas", {}, "u-cliente"), recusaCom("ainda não estão liberados"));
  assert.equal(db.gravacoes.length, 0);
  const leitura = await rodar(db, "minhas_empresas", {}, "u-cliente");
  assert.match(leitura.text, /Clínica Bela/);
});

/* ───────────────────────── leads e contatos ───────────────────────── */

test("criar_contato entra como lead e não duplica o mesmo número, com ou sem o nono dígito", async () => {
  const db = bancoFalso(cenario());
  const criado = await rodar(db, "criar_contato", { nome: "Carla Dias", telefone: "(65) 99999-1234", origem: "Indicação" });
  assert.match(criado.text, /^Núcleo Major\nFeito\. Carla Dias \(…1234\) entrou como lead\./);
  const linha = db.tabelas.contacts.find((c) => c.name === "Carla Dias");
  assert.equal(linha.phone, "5565999991234");
  assert.equal(linha.lead_at, AGORA.toISOString());
  assert.equal(linha.created_by, "u-junior");
  assert.equal(db.tabelas.contact_events.at(-1).source, "mcp");

  const deNovo = await rodar(db, "criar_contato", { nome: "Carla", telefone: "6599991234" });
  assert.match(deNovo.text, /Já existe: Carla Dias \(…1234\), lead\. Não criei outro\./);
  assert.equal(db.tabelas.contacts.filter((c) => c.name.startsWith("Carla")).length, 1);
});

test("editar_contato transforma em lead quem só estava no WhatsApp", async () => {
  const db = bancoFalso(cenario());
  const r = await rodar(db, "editar_contato", { busca: "Pedro", lead: true, origem: "WhatsApp" });
  assert.match(r.text, /Feito\. Pedro Novo \(…0000\) entrou no CRM: origem, virou lead\./);
  const pedro = db.tabelas.contacts.find((c) => c.name === "Pedro Novo");
  assert.ok(pedro.lead_at);
});

test("editar_contato traduz a recusa do banco de tirar lead que tem negócio", async () => {
  const recusa = Object.assign(new Error("O banco recusou a consulta."), { status: 502, upstream: 400, hint: "lead_tem_negocio" });
  const db = bancoFalso(cenario(), { recusas: { "update:contacts": recusa } });
  await assert.rejects(rodar(db, "editar_contato", { busca: "Maria Souza", lead: false }), recusaCom("tem negócio no Funil e continua lead"));
});

test("busca com duas pessoas não grava nada: devolve a lista para escolher", async () => {
  const db = bancoFalso(cenario());
  await assert.rejects(rodar(db, "mover_negocio", { busca: "Mari", etapa: "Proposta" }), recusaCom("Qual delas?"));
  await assert.rejects(rodar(db, "anotar", { busca: "Mari", texto: "oi" }), recusaCom("Qual delas?"));
  assert.equal(db.gravacoes.length, 0);
});

/* ───────────────────────── Funil ───────────────────────── */

test("mover_negocio muda a etapa na hora e deixa o rastro do MCP", async () => {
  const db = bancoFalso(cenario());
  const r = await rodar(db, "mover_negocio", { busca: "Maria Souza", etapa: "proposta" });
  assert.match(r.text, /Feito\. Negócio de Maria Souza \(…8164\): Qualificação → Proposta\./);
  assert.equal(db.tabelas.deals[0].stage_id, "s-prop");
  assert.equal(db.tabelas.deals[0].updated_by, "u-junior");
  const evento = db.tabelas.contact_events.at(-1);
  assert.deepEqual([evento.event_type, evento.source, evento.payload.campos], ["deal.updated", "mcp", ["stage_id"]]);

  const perdido = await rodar(db, "mover_negocio", { busca: "8164", situacao: "perdido", motivo_da_perda: "Preço" });
  assert.match(perdido.text, /marcado como perdido; motivo: Preço/);
  assert.equal(db.tabelas.deals[0].loss_reason, "Preço");

  await assert.rejects(rodar(db, "mover_negocio", { busca: "8164", etapa: "Contrato" }), recusaCom("As etapas são: Lead, Qualificação, Proposta, Fechado"));
  await assert.rejects(rodar(db, "mover_negocio", { busca: "João", etapa: "Proposta" }), recusaCom("não tem negócio no Funil"));
});

test("criar_negocio começa na primeira etapa e não duplica negócio aberto", async () => {
  const db = bancoFalso(cenario());
  const r = await rodar(db, "criar_negocio", { busca: "João", valor: 2000 });
  assert.match(r.text, /Feito\. Negócio de João Lima \(…7777\) \(R\$ 2\.000\) criado em Lead\./);
  assert.equal(db.tabelas.deals.at(-1).stage_id, "s-lead");
  await assert.rejects(rodar(db, "criar_negocio", { busca: "João" }), recusaCom("já tem negócio aberto"));
  await rodar(db, "criar_negocio", { busca: "João", outro_negocio: true, titulo: "Renovação" });
  assert.equal(db.tabelas.deals.filter((d) => d.contact_id === "c-joao").length, 2);
});

/* ───────────────────────── tarefas e notas ───────────────────────── */

test("criar_tarefa: só o dia vira 9h de Brasília, responsável pelo nome, e repetir não duplica", async () => {
  const db = bancoFalso(cenario());
  const r = await rodar(db, "criar_tarefa", { titulo: "Ligar para a Maria", prazo: "2026-10-30", responsavel: "Ana", busca: "Maria Souza" });
  assert.match(r.text, /Feito\. Tarefa "Ligar para a Maria" para .*09:00, de Ana Paula, ligada a Maria Souza \(…8164\)\./);
  const tarefa = db.tabelas.tasks[0];
  assert.equal(tarefa.due_at, "2026-10-30T12:00:00.000Z");
  assert.equal(tarefa.owner_id, "u-ana");
  assert.deepEqual(db.tabelas.task_assignees.map((a) => a.user_id), ["u-ana"]);

  const deNovo = await rodar(db, "criar_tarefa", { titulo: "Ligar para a Maria", prazo: "2026-10-30", responsavel: "Ana", busca: "Maria Souza" });
  assert.match(deNovo.text, /já estava criada/);
  assert.equal(db.tabelas.tasks.length, 1);

  await assert.rejects(rodar(db, "criar_tarefa", { titulo: "x", responsavel: "Carlos" }), recusaCom("Ninguém da equipe se chama"));
});

test("concluir_tarefa acha pelo título e pergunta quando há duas", async () => {
  const db = bancoFalso(cenario());
  await rodar(db, "criar_tarefa", { titulo: "Enviar proposta da Maria" });
  await rodar(db, "criar_tarefa", { titulo: "Enviar proposta do João" });
  await assert.rejects(rodar(db, "concluir_tarefa", { tarefa: "enviar proposta" }), recusaCom("Achei 2 tarefas"));
  const r = await rodar(db, "concluir_tarefa", { tarefa: "proposta do joão" });
  assert.match(r.text, /Feito\. Tarefa "Enviar proposta do João" concluída\./);
  assert.equal(db.tabelas.tasks.find((t) => t.title.endsWith("João")).completed, true);
});

test("anotar escreve na ficha com o nome de quem pediu e não repete a mesma nota", async () => {
  const db = bancoFalso(cenario());
  const r = await rodar(db, "anotar", { busca: "Maria Souza", texto: "Prefere contato à tarde." });
  assert.match(r.text, /Feito\. Nota na ficha de Maria Souza \(…8164\)/);
  assert.equal(db.tabelas.notes[0].author_label, "Junior Santana");
  await rodar(db, "anotar", { busca: "Maria Souza", texto: "Prefere contato à tarde." });
  assert.equal(db.tabelas.notes.length, 1);
});

/* ───────────────────────── agenda ───────────────────────── */

test("marcar, remarcar e cancelar compromisso, só os da própria pessoa", async () => {
  const db = bancoFalso(cenario());
  const r = await rodar(db, "marcar_compromisso", { titulo: "Reunião com a Maria", inicio: "2026-10-30 14:00", busca: "Maria Souza" });
  assert.match(r.text, /Feito\. "Reunião com a Maria" marcado para .*14:00–15:00 \(com Maria Souza \(…8164\), só na sua agenda\)\./);
  const evento = db.tabelas.calendar_events[0];
  assert.deepEqual([evento.starts_at, evento.ends_at, evento.visibility, evento.category_id], ["2026-10-30T17:00:00.000Z", "2026-10-30T18:00:00.000Z", "personal", "cat-1"]);

  await rodar(db, "marcar_compromisso", { titulo: "Reunião com a Maria", inicio: "2026-10-30 14:00" });
  assert.equal(db.tabelas.calendar_events.length, 1);

  const remarcado = await rodar(db, "remarcar_compromisso", { compromisso: "reunião", novo_inicio: "2026-10-31 09:30" });
  assert.match(remarcado.text, /saiu de .*14:00–15:00 e foi para .*09:30–10:30/);
  assert.equal(evento.starts_at, "2026-10-31T12:30:00.000Z");

  await assert.rejects(rodar(db, "remarcar_compromisso", { compromisso: "reunião", cancelar: true }, "u-ana"), recusaCom("Só dá para remarcar ou cancelar o que você mesmo marcou"));
  await rodar(db, "remarcar_compromisso", { compromisso: "reunião", cancelar: true });
  assert.equal(evento.status, "cancelled");
  assert.equal(db.tabelas.calendar_events.length, 1);
});

test("datas: só AAAA-MM-DD [HH:MM] e dia que existe", () => {
  assert.equal(instanteEmBrasilia("2026-10-30 8:05", "o início").data.toISOString(), "2026-10-30T11:05:00.000Z");
  assert.equal(instanteEmBrasilia("2026-10-30", "o início").soDia, true);
  assert.throws(() => instanteEmBrasilia("30/10", "o início"), ToolError);
  assert.throws(() => instanteEmBrasilia("2026-02-30", "o início"), /não é uma data válida/);
});

/* ───────────────────────── relatórios ───────────────────────── */

test("relatorio_de_vendas usa as contas da tela Relatórios", async () => {
  const dados = cenario();
  dados.deals.push({ id: "d-ganho", organization_id: MAJOR, contact_id: "c-joao", stage_id: "s-fechado", status: "ganho", title: "", value: 3000, deleted_at: null, created_at: "2026-10-10T12:00:00Z", updated_at: "2026-10-20T12:00:00Z", closed_at: "2026-10-20T12:00:00Z", loss_reason: "" });
  const db = bancoFalso(dados);
  const r = await rodar(db, "relatorio_de_vendas", { periodo: "mes" });
  assert.match(r.text, /Vendas neste mês:/);
  assert.match(r.text, /Leads novos: 1;/); // Maria virou lead em 01/10
  assert.match(r.text, /Fechados: 1 ganho\(s\) \(R\$ 3\.000\) e 0 perdido\(s\); taxa de ganho 100%/);
  assert.match(r.text, /Por origem: Instagram 1/);
  assert.equal(db.gravacoes.length, 0);
});

/* ───────────────────────── qualidade do atendimento ───────────────────────── */

const CREDITOS = { limit: 100, used: 10, left: 90, renewsAt: "2026-11-15T03:00:00Z" };

test("sem análise: diz o custo e o saldo e não pede nada sozinho", async () => {
  const db = bancoFalso(cenario(), { rpc: { conversation_analysis_credits: () => CREDITOS } });
  const r = await rodar(db, "qualidade_do_atendimento", { busca: "Maria Souza" });
  assert.match(r.text, /Ainda não há análise da conversa com Maria Souza \(…8164\)\./);
  assert.match(r.text, /90 de 100 análises/);
  assert.match(r.text, /só com o sim, use pedir_analise/);
  assert.ok(!db.gravacoes.some((g) => g.rpc === "conversation_analysis_request"));
});

test("pedir_analise exige confirmado=true e então pede pela conversa certa", async () => {
  const db = bancoFalso(cenario(), {
    rpc: {
      conversation_analysis_credits: () => CREDITOS,
      conversation_analysis_request: () => ({ analysisId: "an-1", status: "pending", credits: { ...CREDITOS, used: 12, left: 88 } }),
    },
  });
  await assert.rejects(rodar(db, "pedir_analise", { busca: "Maria Souza", tipo: "completa" }), recusaCom("usa 2 crédito(s)"));
  assert.ok(!db.gravacoes.some((g) => g.rpc === "conversation_analysis_request"));

  const r = await rodar(db, "pedir_analise", { busca: "Maria Souza", tipo: "completa", confirmado: true });
  const pedido = db.gravacoes.find((g) => g.rpc === "conversation_analysis_request").corpo;
  assert.deepEqual(pedido, { target_organization: MAJOR, target_connection: "conn-1", target_chat: "5565992178164", analysis_kind: "completa" });
  assert.match(r.text, /Pedida a análise completa da conversa com Maria Souza \(…8164\)\. .* 88 de 100 análises/);
});

test("com análise pronta: o resumo da nota, como o botão Copiar da ficha", async () => {
  const dados = cenario();
  dados.conversation_analyses.push({ id: "an-9", organization_id: MAJOR, contact_id: "c-maria", contact_phone: "5565992178164", kind: "atendimento", status: "done", requested_at: "2026-10-28T12:00:00Z", completed_at: "2026-10-28T12:02:00Z", saved_at: "2026-10-28T13:00:00Z", service_score: 62 });
  const db = bancoFalso(dados, {
    rpc: {
      conversation_analysis_status: () => ({
        report: {
          schema_version: "analysis_report.v1",
          atendimento_score: { score: 62, evaluated_weight: 60, max_weight: 90 },
          diagnosis: { summary: "Boa abertura, sem próximo passo.", main_bottleneck: { title: "Ficou em aberto" }, what_to_do_now: [{ title: "Propor horário" }] },
        },
      }),
    },
  });
  const r = await rodar(db, "qualidade_do_atendimento", { busca: "Maria Souza" });
  assert.match(r.text, /Análise de atendimento de 28\/10\./);
  assert.match(r.text, /Nota: 62\/100 — 67% dos critérios avaliados/);
  assert.match(r.text, /Gargalo: Ficou em aberto/);
  assert.match(r.text, /1\. Propor horário/);

  const empresa = await rodar(db, "qualidade_do_atendimento", { periodo: "7dias" });
  assert.match(empresa.text, /1 análise\(s\) feitas; 1 com nota, média 62\/100\./);
  assert.match(empresa.text, /Notas mais baixas: Maria Souza 62/);
});

/* ───────────────────────── gravar pelo PostgREST ───────────────────────── */

test("insert e update pedem a linha de volta e a dica do banco chega a quem chamou", async () => {
  const pedidos = [];
  const fetchImpl = async (url, opcoes) => {
    pedidos.push({ url, metodo: opcoes.method, prefer: opcoes.headers.Prefer, token: opcoes.headers.Authorization, corpo: opcoes.body });
    if (opcoes.method === "PATCH") return new Response(JSON.stringify({ message: "lead com negocio", hint: "lead_tem_negocio" }), { status: 400 });
    return Response.json([{ id: "n-1", body: "oi" }]);
  };
  const db = supabaseDb({ supabaseUrl: "https://s.test", publishableKey: "pk", token: "tok", fetchImpl });
  assert.deepEqual(await db.insert("notes", { body: "oi" }), { id: "n-1", body: "oi" });
  assert.deepEqual(pedidos[0], { url: "https://s.test/rest/v1/notes", metodo: "POST", prefer: "return=representation", token: "Bearer tok", corpo: '{"body":"oi"}' });
  const original = console.error;
  console.error = () => {};
  try {
    await assert.rejects(db.update("/rest/v1/contacts?id=eq.c1", { lead_at: null }), (erro) => erro.hint === "lead_tem_negocio" && erro.upstream === 400);
  } finally {
    console.error = original;
  }
});
