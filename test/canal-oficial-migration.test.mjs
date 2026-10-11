import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

// O canal oficial do WhatsApp, fundação (20261014100000).
//
// Aqui não há Postgres. Estes contratos prendem as decisões de segurança que,
// se alguém "simplificar" a migration, abrem a fila de mensagens de clientes.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const NOME = "20261014100000_canal_oficial_do_whatsapp.sql";
const sql = await readFile(new URL(NOME, MIGRATIONS_DIR), "utf8");
const executavel = sql
  .split("\n")
  .filter((linha) => !linha.trimStart().startsWith("--"))
  .join("\n");

function corpo(nome) {
  const inicio = executavel.indexOf(`create or replace function public.${nome}(`);
  assert.ok(inicio >= 0, `${nome} existe`);
  return executavel.slice(inicio, executavel.indexOf("$$;", inicio));
}

test("vem depois da última migration da main quando foi escrita", async () => {
  const arquivos = (await readdir(MIGRATIONS_DIR)).filter((nome) => nome.endsWith(".sql")).sort();
  assert.ok(arquivos.indexOf(NOME) > arquivos.indexOf("20261013100000_analises_ficam_com_a_empresa.sql"));
});

test("toda função é security definer com search_path vazio", () => {
  for (const nome of ["nucleo_whatsapp_cloud_receive", "nucleo_whatsapp_cloud_inbox_claim", "nucleo_whatsapp_cloud_inbox_complete"]) {
    const texto = corpo(nome);
    assert.match(texto, /security definer/);
    assert.match(texto, /set search_path = ''/);
  }
});

test("a fila mora em private e ninguém da API lê a tabela", () => {
  assert.match(executavel, /create table private\.whatsapp_cloud_inbox/);
  assert.match(executavel, /revoke all on private\.whatsapp_cloud_inbox from public, anon, authenticated/);
  assert.match(executavel, /revoke all on private\.whatsapp_cloud_intake from public, anon, authenticated/);
});

test("receber exige o token do servidor, conferido pelo sha256", () => {
  const texto = corpo("nucleo_whatsapp_cloud_receive");
  assert.match(texto, /extensions\.digest\(token_limpo, 'sha256'\)/);
  assert.match(texto, /raise exception 'intake token is invalid'/);
  // O token é a primeira coisa; nenhum evento é lido antes dele.
  assert.ok(texto.indexOf("intake token is invalid") < texto.indexOf("jsonb_array_elements"));
});

test("evento de número desconhecido ou inativo é descartado, não guardado", () => {
  const texto = corpo("nucleo_whatsapp_cloud_receive");
  assert.match(texto, /n\.status = 'active'/);
  assert.match(texto, /c\.revoked_at is null/);
  assert.match(texto, /desconhecidos := desconhecidos \+ 1;\s*continue;/);
});

test("reenvio da Meta não duplica: chave por conexão, tipo e id", () => {
  assert.match(executavel, /unique \(connection_id, kind, external_id\)/);
  assert.match(corpo("nucleo_whatsapp_cloud_receive"), /on conflict \(connection_id, kind, external_id\) do nothing/);
});

test("reservar e concluir só valem para a conexão do próprio robô", () => {
  const claim = corpo("nucleo_whatsapp_cloud_inbox_claim");
  assert.match(claim, /private\.robot_organization\(\)/);
  assert.match(claim, /credential\.auth_user_id = auth\.uid\(\)/);
  assert.match(claim, /inbox\.connection_id = robot_connection/);
  assert.match(claim, /for update skip locked/);
  const complete = corpo("nucleo_whatsapp_cloud_inbox_complete");
  assert.match(complete, /credential\.auth_user_id = auth\.uid\(\)/);
  assert.match(complete, /inbox\.status = 'claimed'/);
});

test("anon só recebe; reservar e concluir são do robô autenticado", () => {
  assert.match(executavel, /grant execute on function public\.nucleo_whatsapp_cloud_receive\(text, jsonb\) to anon, authenticated/);
  assert.match(executavel, /grant execute on function public\.nucleo_whatsapp_cloud_inbox_claim\(integer, uuid\) to authenticated;/);
  assert.match(executavel, /grant execute on function public\.nucleo_whatsapp_cloud_inbox_complete\(bigint\[\], text\) to authenticated;/);
  assert.doesNotMatch(executavel, /inbox_claim\(integer, uuid\) to anon/);
  assert.doesNotMatch(executavel, /inbox_complete\(bigint\[\], text\) to anon/);
  // O Supabase dá EXECUTE a anon em toda função nova de `public`: revogar só
  // de `public` deixa anon reservar a fila (o ensaio de 11/10/2026 pegou).
  assert.match(executavel, /revoke all on function public\.nucleo_whatsapp_cloud_inbox_claim\(integer, uuid\) from public, anon, authenticated;/);
  assert.match(executavel, /revoke all on function public\.nucleo_whatsapp_cloud_inbox_complete\(bigint\[\], text\) from public, anon, authenticated;/);
});

test("o token de acesso da Meta não é guardado no banco", () => {
  assert.doesNotMatch(executavel, /access_token|system_user_token/);
});
