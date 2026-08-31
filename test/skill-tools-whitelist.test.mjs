import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { RUNTIME_TOOLS } from "../packages/intelligence/src/catalog.mjs";

// A lista de ferramentas aceitas existe em dois lugares que nada liga entre si:
// `RUNTIME_TOOLS`, em packages/intelligence/src/catalog.mjs, que valida a skill
// na publicação; e uma lista fixa dentro de
// `nucleo_intelligence_context_resolve_v2`, que valida a MESMA skill na hora de
// resolver o contexto da conversa.
//
// Em 27/08/2026 a fase H.4 acrescentou `calendar.request.prepare` e
// `calendar.request.submit` ao catálogo e criou a skill `solicitacao-agenda`
// com as duas. A lista do SQL não foi atualizada — nem pela H.4, nem por
// 20260828210000, que reescreveu a função inteira mantendo as treze antigas.
//
// O efeito só apareceu em 30/08, quando o Bridge passou a entregar mensagem de
// cliente: todo turno que caísse nessa skill levantava `published skill
// contains an unsupported tool`, virava `intelligence.resolve_failed` e o
// cliente recebia "temporariamente indisponível" seguido de transferência
// humana.
//
// Este teste existe para que a próxima divergência apareça aqui, e não no
// WhatsApp de um cliente.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const MARCADOR = "published skill contains an unsupported tool";

// A lista vive dentro do `item not in (...)` que valida `allowed_tools`.
// Procurar pela FORMA, e não por um nome de migration fixo, faz o teste seguir
// a função quando ela for redefinida de novo — foi redefinida duas vezes até
// aqui. A última migration em ordem cronológica que contém a validação é a que
// está valendo no banco.
async function listaDoSqlVigente() {
  const arquivos = (await readdir(MIGRATIONS_DIR))
    .filter((nome) => nome.endsWith(".sql"))
    .sort();

  let vigente = null;
  for (const nome of arquivos) {
    const sql = await readFile(new URL(nome, MIGRATIONS_DIR), "utf8");
    if (!sql.includes(MARCADOR)) continue;

    // O último bloco do arquivo, não o primeiro: o marcador também aparece em
    // comentário de cabeçalho, e uma migration pode citar a regra antes de
    // redefini-la.
    const abertura = sql.lastIndexOf("item not in (");
    if (abertura === -1) continue;
    const fechamento = sql.indexOf(")", abertura);
    const bloco = sql.slice(abertura, fechamento);
    const ferramentas = [...bloco.matchAll(/'([a-z][a-z0-9_.]*)'/g)].map((m) => m[1]);
    if (ferramentas.length === 0) continue;

    vigente = { nome, ferramentas };
  }
  return vigente;
}

test("a validação de ferramentas no SQL cobre o catálogo canônico", async () => {
  const vigente = await listaDoSqlVigente();
  assert.ok(vigente, "nenhuma migration declara a validação de ferramentas da skill");

  const noSql = new Set(vigente.ferramentas);
  const noCatalogo = new Set(RUNTIME_TOOLS);

  const faltando = [...noCatalogo].filter((tool) => !noSql.has(tool));
  assert.deepEqual(
    faltando,
    [],
    `${vigente.nome} não aceita ferramentas que o catálogo publica: ${faltando.join(", ")}. ` +
      "Uma skill publicada com elas quebra a resolução de contexto em tempo de conversa.",
  );

  const sobrando = [...noSql].filter((tool) => !noCatalogo.has(tool));
  assert.deepEqual(
    sobrando,
    [],
    `${vigente.nome} aceita ferramentas fora do catálogo: ${sobrando.join(", ")}. ` +
      "A validação do banco não pode ser mais permissiva que a da publicação.",
  );
});

test("as ferramentas de solicitação de agenda estão nos dois lados", async () => {
  const vigente = await listaDoSqlVigente();
  for (const tool of ["calendar.request.prepare", "calendar.request.submit"]) {
    assert.ok(RUNTIME_TOOLS.has(tool), `${tool} sumiu do catálogo`);
    assert.ok(
      vigente.ferramentas.includes(tool),
      `${tool} não é aceita por ${vigente.nome}; o pedido de horário do cliente volta a falhar`,
    );
  }
});

// A skill que motivou o caso. Se ela deixar de declarar as ferramentas de
// solicitação, o teste acima passa a testar o vazio.
test("a skill solicitacao-agenda pede horário sem criar evento direto", async () => {
  const skill = JSON.parse(
    await readFile(new URL("../packages/intelligence/skills/solicitacao-agenda/skill.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    skill.allowedTools.filter((tool) => tool.startsWith("calendar.request.")).sort(),
    ["calendar.request.prepare", "calendar.request.submit"],
  );
  assert.ok(
    !skill.allowedTools.includes("calendar.confirm") && !skill.allowedTools.includes("calendar.prepare"),
    "a skill do cliente não pode criar evento direto; ver docs/specs/SPEC-EXTERNAL-PILOT.md",
  );
});
