import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

// `nucleo_operator_context` responde "quem é este telefone". Desde 30/08/2026
// ela devolve ZERO LINHAS quando o remetente não é operador, em vez de levantar
// exceção — porque para os resolvedores de contexto da fase H essa é a resposta
// normal: significa que quem escreveu é um cliente.
//
// A correção só é segura enquanto valer uma premissa: todo chamador que EXIGE
// operador tem o seu próprio `if not found then raise`. Eram vinte e dois na
// data da mudança, conferidos um a um. Um chamador novo que esqueça a guarda
// passa a atender não-operador com contexto vazio — falha aberta, exatamente o
// que o resto deste repositório evita.
//
// Este teste existe para que essa premissa não dependa de ninguém lembrar dela.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const CHAMADA = /nucleo_operator_context\s*\(/;

// Os três que tratam operador como OPCIONAL, por desenho. Ficam de fora da
// exigência de guarda — e são nomeados aqui, um a um, para que incluir um
// quarto seja uma decisão explícita de quem escrever a migration.
const OPCIONAIS = new Map([
  ["20260823120000_fase_h_inteligencia_contextual.sql", ["nucleo_intelligence_context_resolve"]],
  ["20260828210000_corrigir_roteamento_tarefas_interno.sql", ["nucleo_intelligence_context_resolve_v2"]],
  ["20260830060000_ferramentas_de_solicitacao_de_agenda.sql", ["nucleo_intelligence_context_resolve_v2"]],
]);

async function chamadas() {
  const arquivos = (await readdir(MIGRATIONS_DIR)).filter((n) => n.endsWith(".sql")).sort();
  const encontradas = [];

  for (const nome of arquivos) {
    const sql = await readFile(new URL(nome, MIGRATIONS_DIR), "utf8");
    const linhas = sql.split("\n");

    linhas.forEach((linha, indice) => {
      if (!CHAMADA.test(linha)) return;
      if (/create or replace|revoke |grant /.test(linha)) return;
      // Comentário não é chamada.
      if (linha.trim().startsWith("--")) return;

      // A guarda pode vir na mesma instrução ou nas linhas seguintes; seis
      // linhas cobrem o `select ... into ... from ... where ... limit 1;`
      // mais o `if not found`.
      const janela = linhas.slice(indice, indice + 6).join(" ").toLowerCase();
      encontradas.push({
        arquivo: nome,
        linha: indice + 1,
        temGuarda: janela.includes("not found"),
        trecho: linha.trim().slice(0, 70),
      });
    });
  }
  return encontradas;
}

test("todo chamador que exige operador falha fechado por conta própria", async () => {
  const todas = await chamadas();
  assert.ok(todas.length > 0, "nenhuma chamada a nucleo_operator_context foi encontrada");

  const desprotegidas = todas.filter((c) => !c.temGuarda && !OPCIONAIS.has(c.arquivo));
  assert.deepEqual(
    desprotegidas.map((c) => `${c.arquivo}:${c.linha}`),
    [],
    "chamada a nucleo_operator_context sem `if not found`: a função devolve zero linhas para " +
      "não-operador, então sem a guarda esta RPC atende quem não devia. " +
      `Trechos: ${desprotegidas.map((c) => c.trecho).join(" | ")}`,
  );
});

test("a função devolve vazio para não-operador e ainda barra credencial inativa", async () => {
  const sql = await readFile(
    new URL("20260830070000_operador_opcional_no_contexto.sql", MIGRATIONS_DIR),
    "utf8",
  );

  // Só o corpo da função: o bloco de prova, no fim da migration, cita a string
  // antiga de propósito para garantir que ela sumiu.
  const inicio = sql.indexOf("create or replace function public.nucleo_operator_context");
  const corpo = sql.slice(inicio, sql.indexOf("\n$$;", inicio));
  assert.ok(
    !corpo.includes("sender is not a verified operator"),
    "o ramo do não-operador voltou a levantar exceção; todo turno de cliente falha de novo",
  );
  assert.ok(
    corpo.includes("robot credential is inactive"),
    "a guarda de credencial de robô é falha de infraestrutura e tem que continuar levantando",
  );
});

// O consumidor que motivou a mudança. Se ele parar de tratar a ausência como
// "é cliente", a correção perde o sentido.
test("o resolvedor de contexto trata ausência de operador como turno de cliente", async () => {
  const sql = await readFile(
    new URL("20260823120000_fase_h_inteligencia_contextual.sql", MIGRATIONS_DIR),
    "utf8",
  );
  const inicio = sql.indexOf("create or replace function public.nucleo_intelligence_context_resolve");
  const corpo = sql.slice(inicio, sql.indexOf("\n$$;", inicio));

  assert.match(corpo, /resolved_audience text := 'customer'/);
  assert.match(corpo, /if found and operator_row\.organization_id = robot_org then/);
});
