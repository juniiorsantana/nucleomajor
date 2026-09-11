import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// O deadlock que calava o control plane: nove gatilhos `for each row` rodavam
// uma faxina sem teto e sem `skip locked` dentro da transação de quem escreveu,
// todos sobre a mesma tabela.
//
// Aqui não há Postgres. Estes contratos asseguram que a migration DECLARA a
// regra certa, e a própria migration falha sozinha no apply se a declaração não
// estiver lá (bloco final de asserções). A prova COMPORTAMENTAL — duas sessões
// disputando as mesmas linhas, que nenhuma leitura de SQL prova sozinha — é
// separada; ver scripts/sql/README-prova-faxina-do-gatilho.md.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const NOME_DA_MIGRATION = "20260911050000_a_faxina_do_gatilho_nao_pode_travar_a_escrita.sql";
const NOME_DA_ORIGEM = "20260823030000_fase_f_web.sql";
const NOME_DOS_COMANDOS = "20260826010000_vps_operator_verification_commands.sql";

const sql = await readFile(new URL(NOME_DA_MIGRATION, MIGRATIONS_DIR), "utf8");
const sqlOrigem = await readFile(new URL(NOME_DA_ORIGEM, MIGRATIONS_DIR), "utf8");
const sqlComandos = await readFile(new URL(NOME_DOS_COMANDOS, MIGRATIONS_DIR), "utf8");

// Só o SQL que executa: fora ficam os comentários `--`, porque o cabeçalho
// desta migration cita LITERALMENTE o delete defeituoso que ela remove. Sem
// este recorte, o teste passaria lendo a descrição do defeito como se fosse a
// correção — e passaria também se a correção não existisse.
function executavel(texto) {
  return texto
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("--"))
    .join("\n");
}

const sqlExecutavel = executavel(sql);

// Recorte do corpo de uma função: do CREATE até o `$$;` que o fecha.
//
// Necessário porque a migration fala sobre si mesma em dois lugares — o bloco
// que recusa aplicar sobre um banco inesperado e o que confere o resultado — e
// os dois citam os mesmos trechos de SQL dentro de strings. Contar ocorrências
// no arquivo inteiro contaria a verificação junto com o verificado.
function corpoDaFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`create or replace function ${nome}`);
  assert.notEqual(inicio, -1, `deveria redefinir ${nome}`);
  const fim = fonte.indexOf("$$;", inicio);
  assert.notEqual(fim, -1, `o corpo de ${nome} não termina como esperado`);
  return fonte.slice(inicio, fim);
}

const gatilho = corpoDaFuncao(sqlExecutavel, "private.portal_realtime_notify()");
const reserva = corpoDaFuncao(sqlExecutavel, "public.nucleo_runtime_commands_claim(");

// Recorte de um statement: do marcador até o primeiro `;`. Buscar no arquivo
// inteiro confundiria a faxina do gatilho com a varredura da reserva.
function statement(fonte, marcador) {
  const inicio = fonte.indexOf(marcador);
  assert.notEqual(inicio, -1, `não achei o statement que começa em: ${marcador}`);
  const fim = fonte.indexOf(";", inicio);
  assert.notEqual(fim, -1, `o statement de ${marcador} não termina com ;`);
  return fonte.slice(inicio, fim + 1);
}

test("o defeito existia mesmo: a origem tem a faxina que espera", () => {
  // Se esta asserção cair, a premissa da migration mudou — alguém já mexeu no
  // gatilho por outro caminho, e o resto deste arquivo está descrevendo um
  // banco que não existe mais.
  const gatilhoOriginal = statement(
    executavel(sqlOrigem),
    "delete from public.portal_realtime_events",
  );
  assert.match(gatilhoOriginal, /created_at < now\(\) - interval '7 days'/);
  assert.doesNotMatch(gatilhoOriginal, /skip locked/i);
  assert.doesNotMatch(gatilhoOriginal, /\blimit\b/i);
});

test("a faxina do gatilho não espera mais, e tem teto", () => {
  const faxina = statement(gatilho, "delete from public.portal_realtime_events evento");
  assert.match(faxina, /for update skip locked/);
  assert.match(faxina, /limit 200/);
  // A ordem é cinto e suspensório; quem garante é o skip locked.
  assert.match(faxina, /order by velho\.created_at, velho\.id/);
});

test("nenhum delete solto sobrou na tabela de eventos", () => {
  // A garantia negativa, e a que realmente importa: não basta EXISTIR um delete
  // seguro, é preciso não existir nenhum inseguro.
  const deletes = gatilho
    .split(";")
    .filter((trecho) => /delete\s+from\s+public\.portal_realtime_events/i.test(trecho));
  assert.equal(deletes.length, 1, "deveria haver exatamente um delete na tabela de eventos");
  assert.match(deletes[0], /for update skip locked/);
});

test("a faxina continua sendo a mesma faxina", () => {
  const faxina = statement(gatilho, "delete from public.portal_realtime_events evento");
  assert.match(faxina, /interval '7 days'/, "a janela de retenção não podia mudar aqui");
});

test("o sinal do gatilho não mudou: os dois ramos continuam inserindo", () => {
  const insercoes = gatilho.match(/insert into public\.portal_realtime_events/g) || [];
  assert.equal(insercoes.length, 2, "um insert para DELETE e outro para INSERT/UPDATE");
  assert.match(gatilho, /old\.organization_id/);
  assert.match(gatilho, /new\.organization_id/);
  assert.match(gatilho, /tg_argv\[0\]/);
});

test("a varredura de expiração da reserva de comandos também não espera", () => {
  const varredura = statement(reserva, "with vencidos as");
  assert.match(varredura, /for update skip locked/);
  assert.match(varredura, /limit 100/);
  assert.match(varredura, /status in \('pending', 'claimed'\)/);
  assert.match(varredura, /expires_at <= now\(\)/);
  assert.match(varredura, /set status = 'expired'/);
});

test("a entrega de comandos não mudou", () => {
  const entrega = statement(reserva, "with selected as");
  assert.match(entrega, /order by command\.created_at/, "FIFO");
  assert.match(entrega, /for update skip locked/);
  assert.match(entrega, /command\.attempts < 3/);
  assert.match(entrega, /command\.expires_at > now\(\)/, "comando vencido nunca é entregue");
  assert.match(reserva, /least\(coalesce\(max_items, 10\), 20\)/);
});

test("o corpo da reserva é o vigente, menos a varredura", () => {
  // Um CREATE OR REPLACE reescreve a função inteira. O risco não é o que a
  // migration muda de propósito — é o que ela apaga sem querer ao recopiar.
  const vigente = executavel(sqlComandos);
  for (const pedaco of [
    "robot credential is inactive or connection was revoked",
    "robot connection is inactive or revoked",
    "claimed_instance = runtime_instance",
    "'commandId', claimed.id",
    "update public.connection_robot_credentials",
    "set last_used_at = now()",
    "return jsonb_build_object('commands', claimed_commands)",
  ]) {
    assert.ok(vigente.includes(pedaco), `premissa: a vigente tem ${pedaco}`);
    assert.ok(sqlExecutavel.includes(pedaco), `a reescrita perdeu: ${pedaco}`);
  }
});

test("a migration se recusa a rodar sobre um banco que não é o esperado", () => {
  assert.match(sqlExecutavel, /ABORTADA: private\.portal_realtime_notify nao existe/);
  assert.match(sqlExecutavel, /ABORTADA: a faxina do gatilho ja foi consertada/);
  assert.match(sqlExecutavel, /ABORTADA: o corpo vivo do gatilho nao tem a faxina/);
});

test("a migration confere a si mesma depois de aplicar", () => {
  for (const falha of [
    "FALHOU: a faxina do gatilho voltou a poder esperar",
    "FALHOU: a faxina do gatilho ficou sem teto",
    "FALHOU: a janela de retencao de 7 dias mudou",
    "FALHOU: a varredura de expiracao voltou a poder esperar",
    "FALHOU: a entrega de comandos deixou de ser FIFO",
    "FALHOU: SECURITY DEFINER ou search_path mudou em alguma das duas funcoes",
    "FALHOU: authenticated perdeu o EXECUTE da reserva de comandos",
    "FALHOU: nao sao mais nove gatilhos apontando para portal_realtime_notify",
  ]) {
    assert.ok(sqlExecutavel.includes(falha), `faltou a asserção: ${falha}`);
  }
});

test("privilégios e isolamento continuam declarados", () => {
  assert.match(sqlExecutavel, /security definer/);
  assert.match(sqlExecutavel, /set search_path = ''/);
  assert.match(
    sqlExecutavel,
    /revoke all on function public\.nucleo_runtime_commands_claim\(integer, uuid\) from public/,
  );
  assert.match(
    sqlExecutavel,
    /grant execute on function public\.nucleo_runtime_commands_claim\(integer, uuid\) to authenticated/,
  );
});

test("a migration não afirma nada sobre anon", () => {
  // Em produção `anon` TEM o EXECUTE desta função, e tem desde 26/08: o projeto
  // carrega `ALTER DEFAULT PRIVILEGES` concedendo EXECUTE a anon, authenticated
  // e service_role em toda função criada no schema public, e `revoke ... from
  // public` não alcança concessão nominal a papel. Diagnosticado na ETAPA 11D.
  //
  // Uma asserção contra isso PASSA no Postgres descartável — que não tem esses
  // default privileges — e ABORTA numa reconstrução do zero contra um Supabase
  // real. É o limite do harness: ele prova semântica de SQL, não configuração
  // de projeto. A trava existe para a asserção não voltar por boa intenção.
  assert.doesNotMatch(sqlExecutavel, /has_function_privilege\('anon'/);
  assert.match(sqlExecutavel, /has_function_privilege\('authenticated'/);
});

test("a migration não depende de tabela temporária", () => {
  // O SQL Editor do Supabase devolveu `42P01: relation ... does not exist` na
  // primeira tentativa de aplicar: lá os statements não compartilham a
  // transação que um `on commit drop` pressupõe. A 13B tem o mesmo padrão e
  // esta migration o copiou — a trava existe para ele não voltar por cópia.
  assert.doesNotMatch(sqlExecutavel, /create temporary table/i);
  assert.doesNotMatch(sqlExecutavel, /_faxina_acl_antes/);
});

test("a migration é uma transação só", () => {
  assert.ok(sqlExecutavel.trimStart().startsWith("begin;"));
  assert.ok(sqlExecutavel.trimEnd().endsWith("commit;"));
});
