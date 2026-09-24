import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

// O lead do formulário do site passa a ser chamado pela IA (20260915000000).
//
// Aqui não há Postgres. Estes contratos prendem as decisões que, se alguém
// "simplificar" a migration, devolvem um defeito conhecido. A prova
// COMPORTAMENTAL (61 itens, com o sha256 real da chave do contexto) é
// `scripts/sql/prova-lead-do-site.mjs`, em PGlite.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const NOME = "20260915000000_o_lead_do_site_chama_a_ia.sql";
const sql = await readFile(new URL(NOME, MIGRATIONS_DIR), "utf8");
const ligacao = await readFile(new URL("../scripts/sql/ligar-campanha-do-site.sql", import.meta.url), "utf8");

const executavel = (texto) =>
  texto
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("--"))
    .join("\n");
const sqlExecutavel = executavel(sql);

const corpo = (() => {
  const inicio = sqlExecutavel.indexOf("create or replace function public.nucleo_site_lead_receive(");
  assert.ok(inicio >= 0, "a função de receber o lead existe");
  return sqlExecutavel.slice(inicio, sqlExecutavel.indexOf("$$;", inicio));
})();

test("vem depois das migrations que ela supõe aplicadas", async () => {
  // A fila com os oito tipos (20260910010000) e a sincronia com autoria
  // (20260913230000), a última aplicada quando esta foi escrita.
  const arquivos = (await readdir(MIGRATIONS_DIR)).filter((nome) => nome.endsWith(".sql")).sort();
  assert.ok(arquivos.indexOf(NOME) > arquivos.indexOf("20260913230000_o_nome_de_quem_escreveu.sql"));
  assert.ok(arquivos.includes("20260910010000_qr_do_whatsapp_pelo_portal.sql"));
});

test("a primeira mensagem vai por comando próprio, nunca por conversation_send", () => {
  // conversation_send faz o runtime ler "a equipe respondeu pelo portal" e a IA
  // sai da conversa exatamente com o lead que ela deveria atender.
  assert.match(corpo, /'site_lead_welcome'/);
  assert.doesNotMatch(corpo, /conversation_send/);
  assert.doesNotMatch(corpo, /nucleo_conversation_command_enqueue/);
});

test("a carga do comando não carrega destinatário da equipe", () => {
  // Quem recebe o aviso é configuração da VPS. A fila nasce de um formulário
  // público; um campo de destino aqui faria do site um disparador.
  const carga = corpo.slice(corpo.indexOf("'site_lead_welcome',"), corpo.indexOf("config.enabled_by,"));
  for (const chave of ["'phone'", "'sendWelcome'", "'skipReason'", "'text'", "'authorName'", "'lead'"]) {
    assert.ok(carga.includes(chave), `a carga leva ${chave}`);
  }
  assert.doesNotMatch(carga, /notify|team|equipe|destino|recipient/i);
});

test("o Router da FASE 13 não é tocado: a campanha entra pelo contexto criado antes", () => {
  assert.doesNotMatch(sqlExecutavel, /function private\.intelligence_payload/);
  assert.doesNotMatch(sqlExecutavel, /nucleo_intelligence_context_resolve/);
  assert.match(corpo, /insert into public\.conversation_intelligence_contexts/);
});

test("contexto transferido para gente bloqueia a criação do contexto da campanha", () => {
  // Um contexto ativo ao lado de um `handed_off` furaria a recusa por
  // atendimento humano, que o Router confere antes de tudo.
  assert.match(corpo, /context\.state in \('active', 'handed_off'\)/);
});

test("a chave do contexto é o sha256 do telefone, nas duas formas do celular", () => {
  assert.match(corpo, /encode\(extensions\.digest\(variante, 'sha256'\), 'hex'\)/);
  assert.match(corpo, /foreach variante in array variantes/);
});

test("consentimento só vale como true de verdade", () => {
  assert.match(corpo, /consentiu := coalesce\(lead -> 'consentimento' = 'true'::jsonb, false\)/);
});

test("a função é do servidor do site (anon) e as tabelas não são de ninguém de fora", () => {
  assert.match(sqlExecutavel, /grant execute on function public\.nucleo_site_lead_receive\(text, jsonb\) to anon;/);
  assert.match(sqlExecutavel, /revoke all on function public\.nucleo_site_lead_receive\(text, jsonb\) from authenticated;/);
  assert.match(sqlExecutavel, /revoke all on public\.campaign_site_intakes from anon, authenticated;/);
  assert.doesNotMatch(sqlExecutavel, /grant [a-z, ]+ on public\.campaign_site_intakes/);
  assert.match(corpo, /security definer/);
  assert.match(corpo, /set search_path = ''/);
});

test("o token nunca é guardado em claro nem vai para o prompt", () => {
  assert.match(corpo, /token_hash = encode\(extensions\.digest\(token_limpo, 'sha256'\), 'hex'\)/);
  // organization_campaigns.configuration vai inteira para o payload do Router.
  assert.doesNotMatch(sqlExecutavel, /update public\.organization_campaigns/);
  assert.match(ligacao, /encode\(extensions\.digest\(token\.valor, 'sha256'\), 'hex'\)/);
});

test("sem tabela temporária: o SQL Editor não é psql -f", () => {
  assert.doesNotMatch(sqlExecutavel, /create temp(orary)? table/i);
  assert.doesNotMatch(ligacao, /create temp(orary)? table/i);
});

test("a lista de comandos é reescrita inteira e a migration confere o resultado", () => {
  const check = sqlExecutavel.slice(sqlExecutavel.indexOf("add constraint connection_runtime_commands_command_type_check"));
  for (const tipo of [
    "operator_verification_send", "handoff_return_to_ai", "handoff_close",
    "conversation_send", "conversation_owner", "conversation_check",
    "connection_pair_start", "connection_pair_qr", "site_lead_welcome",
  ]) {
    assert.ok(check.includes(`'${tipo}'`), `o check mantém ${tipo}`);
  }
  assert.match(sqlExecutavel, /a lista de comandos mudou desde 20260910010000/);
  assert.match(sqlExecutavel, /conferencia: a fila nao aceita site_lead_welcome/);
});

test("o que o visitante escreve não vira link nem frase na mensagem da Major", () => {
  // `{nome}` só com letras e `{site}` só com formato de domínio: a mensagem sai
  // pelo WhatsApp da empresa para o telefone que o visitante informou.
  assert.match(corpo, /split_part\(nome_do_lead, ' ', 1\), '\[\^A-Za-z/);
  assert.match(corpo, /'\[\^a-z0-9\.-\]'/);
  assert.match(corpo, /site_do_lead !~ '\^\[a-z0-9\]/);
});
