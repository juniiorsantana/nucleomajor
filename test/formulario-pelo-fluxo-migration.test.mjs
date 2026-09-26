import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

// O formulário chama o lead pelo fluxo do chatbot, sem IA (20260926180000).
//
// Sem Postgres aqui: estes contratos prendem as decisões que, se alguém
// "simplificar" a migration, trazem de volta a mensagem em dobro ou a IA no
// plano Base. A prova COMPORTAMENTAL (35 itens, todas as migrations reais em
// PGlite) é `scripts/sql/prova-formulario-pelo-fluxo.mjs`.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const NOME = "20260926180000_o_formulario_chama_pelo_fluxo.sql";
const ORIGINAL = "20260915000000_o_lead_do_site_chama_a_ia.sql";
const semCr = (texto) => texto.replace(/\r/g, "");
const sql = semCr(await readFile(new URL(NOME, MIGRATIONS_DIR), "utf8"));
const original = semCr(await readFile(new URL(ORIGINAL, MIGRATIONS_DIR), "utf8"));
const ligacao = semCr(await readFile(new URL("../scripts/sql/ligar-formulario-meta.sql", import.meta.url), "utf8"));

const executavel = (texto) => texto.split("\n").filter((linha) => !linha.trimStart().startsWith("--")).join("\n");
const funcao = (texto, assinatura) => {
  const inicio = texto.indexOf(assinatura);
  assert.ok(inicio >= 0, `${assinatura} existe`);
  return texto.slice(inicio, texto.indexOf("$$;", inicio));
};
const receber = funcao(sql, "create or replace function public.nucleo_site_lead_receive(");
const gatilho = executavel(funcao(sql, "create or replace function private.flow_trigger_on_campaign_lead()"));

test("vem depois da última migration da main quando foi escrita", async () => {
  const arquivos = (await readdir(MIGRATIONS_DIR)).filter((nome) => nome.endsWith(".sql")).sort();
  assert.ok(arquivos.indexOf(NOME) > arquivos.indexOf("20260926170000_lead_e_uma_marca_do_contato.sql"));
  assert.equal(arquivos.filter((nome) => nome.startsWith("20260926180000")).length, 1, "número sem repetição");
});

test("quem já está ligado continua como estava", () => {
  assert.match(sql, /add column if not exists first_message text not null default 'agent'/);
  assert.match(sql, /check \(first_message in \('agent', 'flow'\)\)/);
  assert.match(executavel(sql), /where first_message <> 'agent'\) then\s+raise exception/);
});

test("a função nova é a de 20260915000000 com três trocas, e nada mais", () => {
  const antes = funcao(original, "create or replace function public.nucleo_site_lead_receive(");
  const linhasAntes = new Set(antes.split("\n"));
  const novas = receber.split("\n").filter((linha) => !linhasAntes.has(linha));
  // As trocas: o ramo 'flow' da decisão, a marca no lugar do comando, o retorno.
  assert.ok(novas.length <= 20, `linhas novas demais: ${novas.length}\n${novas.join("\n")}`);
  const removidas = antes.split("\n").filter((linha) => !new Set(receber.split("\n")).has(linha));
  assert.deepEqual(removidas.map((linha) => linha.trim()), [
    "if enviar or avisar then",
    "'teamNotified', enviar or avisar",
  ]);
});

test("no modo fluxo nada vai para a VPS e a IA não é chamada", () => {
  const corpo = executavel(receber);
  // A decisão do fluxo vem antes da do agente: plano Base não tem agente ativo.
  assert.ok(corpo.indexOf("elsif config.first_message = 'flow' then") < corpo.indexOf("motivo := 'agent_inactive'"));
  // O comando e os contextos da IA ficam do outro lado do `if`.
  const ramoFluxo = corpo.slice(corpo.indexOf("if config.first_message = 'flow' then\n    if motivo"), corpo.indexOf("elsif enviar or avisar then"));
  assert.match(ramoFluxo, /set welcome_requested = true/);
  assert.doesNotMatch(ramoFluxo, /connection_runtime_commands|conversation_intelligence_contexts/);
  assert.doesNotMatch(corpo, /conversation_send/);
});

test("o fluxo dispara pela marca, uma vez, e o modo antigo não muda", () => {
  assert.match(gatilho, /intake\.first_message = 'flow'/);
  assert.match(gatilho, /new\.welcome_requested\s+and \(tg_op = 'INSERT' or not old\.welcome_requested\)/);
  assert.match(gatilho, /elsif new\.contact_id is not null and \(tg_op = 'INSERT' or old\.contact_id is distinct from new\.contact_id\)/);
  assert.match(sql, /after insert or update of contact_id, welcome_requested on public\.campaign_site_leads/);
  assert.match(sql, /revoke all on function private\.flow_trigger_on_campaign_lead\(\) from public, anon, authenticated/);
});

test("a ligação do Meta cria a campanha e liga em modo fluxo", () => {
  const corpo = executavel(ligacao);
  assert.match(corpo, /insert into public\.organization_campaigns/);
  assert.match(corpo, /'flow'\n\s+from unica, token/);
  assert.match(corpo, /first_message = excluded\.first_message/);
  // O token só existe no resultado: o banco guarda o sha256.
  assert.match(corpo, /encode\(extensions\.digest\(token\.valor, 'sha256'\), 'hex'\)/);
});
