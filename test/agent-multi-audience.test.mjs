import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// FASE E. A migration remove `unique (organization_id, audience)` de
// `assistant_profiles`. Como nas fases anteriores, aqui não há Postgres: estes
// contratos asseguram que a migration DECLARA o que promete, e ela mesma falha
// no apply se a declaração não estiver lá (guardas + bloco final). A prova
// COMPORTAMENTAL — N agentes por audience, padrão inativo recusando, e a
// inferência do ON CONFLICT pelo índice parcial — está em
// scripts/sql/prova-multi-agente.sql.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const NOME_DA_MIGRATION = "20260905000000_a_audience_deixa_de_limitar_a_um_agente.sql";

const sql = await readFile(new URL(NOME_DA_MIGRATION, MIGRATIONS_DIR), "utf8");

// Só o SQL que executa: o cabeçalho desta migration cita de propósito o texto
// da constraint que ela remove e do ON CONFLICT que ela substitui.
const sqlExecutavel = sql
  .split("\n")
  .filter((linha) => !linha.trimStart().startsWith("--"))
  .join("\n");

// Só o corpo de provision_intelligence. Sem delimitar o fim, o bloco final de
// asserção da migration entraria no recorte — e ele cita de propósito o
// `on conflict` antigo, para provar que ele sumiu.
function corpoDeProvision() {
  const inicio = sqlExecutavel.indexOf(
    "create or replace function private.provision_intelligence",
  );
  assert.notEqual(inicio, -1, "a migration deveria redefinir provision_intelligence");
  const fim = sqlExecutavel.indexOf("\n$$;", inicio);
  assert.notEqual(fim, -1, "o corpo de provision_intelligence não termina como esperado");
  return sqlExecutavel.slice(inicio, fim);
}

test("A: a migration remove exatamente uma constraint, e é a unique de audience", () => {
  const drops = sqlExecutavel.match(/drop\s+constraint/gi) ?? [];
  assert.equal(drops.length, 1, "a FASE E deve remover uma única constraint");
  assert.match(
    sqlExecutavel,
    /drop constraint assistant_profiles_organization_id_audience_key/i,
    "a constraint removida deve ser a unique (organization_id, audience), pelo nome",
  );
});

test("B: nada além dela é removido, e nenhuma tabela é alterada de forma destrutiva", () => {
  assert.doesNotMatch(sqlExecutavel, /drop\s+index/i, "a FASE E não remove índice");
  assert.doesNotMatch(sqlExecutavel, /drop\s+table/i, "a FASE E não remove tabela");
  assert.doesNotMatch(sqlExecutavel, /drop\s+policy/i, "a FASE E não remove policy");
  assert.doesNotMatch(sqlExecutavel, /drop\s+trigger/i, "a FASE E não remove gatilho");
  assert.doesNotMatch(sqlExecutavel, /drop\s+column/i, "a FASE E não remove coluna");
  assert.doesNotMatch(
    sqlExecutavel,
    /alter\s+table[\s\S]{0,80}disable\s+row\s+level\s+security/i,
    "a FASE E não desliga RLS",
  );
});

test("C: as guardas recusam rodar fora do estado que as FASES C e D deixaram", () => {
  for (const exigencia of [
    "is_default",
    "assistant_profiles_one_default_idx",
    "assistant_profiles_organization_slug_key",
    "intelligence_payload",
    "nucleo_customer_assistant_access",
    "nucleo_intelligence_context_resolve_v2",
  ]) {
    assert.ok(
      sqlExecutavel.includes(exigencia),
      `as guardas devem conferir ${exigencia} antes do DROP`,
    );
  }
  // Fail closed, e sem corrigir dado em silêncio.
  const excecoes = sqlExecutavel.match(/raise exception 'FASE E abortada/g) ?? [];
  assert.ok(
    excecoes.length >= 6,
    `esperava pelo menos 6 guardas que abortam, encontrei ${excecoes.length}`,
  );
  assert.doesNotMatch(
    sqlExecutavel,
    /update public\.assistant_profiles\s+set is_default/i,
    "a FASE E não pode promover agente para consertar dado",
  );
});

test("D: a guarda exige exatamente um padrão por audience já existente", () => {
  assert.match(
    sqlExecutavel,
    /count\(\*\) filter \(where is_default\) = 0/i,
    "deve recusar audience existente sem padrão",
  );
  assert.match(
    sqlExecutavel,
    /where is_default[\s\S]{0,120}having count\(\*\) > 1/i,
    "deve recusar mais de um padrão por audience",
  );
});

test("E: provision_intelligence deixa de inferir a unique removida", () => {
  const corpo = corpoDeProvision();

  assert.doesNotMatch(
    corpo,
    /on conflict \(organization_id, audience\) do nothing/i,
    "o ON CONFLICT não pode mais apontar para a unique removida",
  );
  const inferencias = corpo.match(
    /on conflict \(organization_id, audience\) where is_default do nothing/gi,
  ) ?? [];
  assert.equal(
    inferencias.length,
    2,
    "os dois inserts de agente devem inferir o índice parcial de padrão",
  );
});

test("F: provision_intelligence lê o padrão, em vez da primeira linha da audience", () => {
  const corpo = corpoDeProvision();

  // `select ... into` sem `strict` pega a PRIMEIRA linha e descarta o resto sem
  // erro. Com N agentes por audience isso seria escolher por sorteio a quem
  // amarrar as skills iniciais — o mesmo defeito que a FASE D tirou dos
  // resolvedores.
  for (const audiencia of ["internal", "customer"]) {
    const seletor = new RegExp(
      `audience = '${audiencia}' and is_default`,
      "i",
    );
    assert.match(
      corpo,
      seletor,
      `a leitura do perfil ${audiencia} deve exigir is_default`,
    );
  }
  assert.doesNotMatch(
    corpo,
    /audience = '(internal|customer)';/i,
    "nenhuma leitura de perfil pode terminar sem filtrar is_default",
  );
});

test("G: provision_intelligence não toca em agentes não-padrão", () => {
  const corpo = corpoDeProvision();
  assert.doesNotMatch(corpo, /delete\s+from public\.assistant_profiles/i);
  assert.doesNotMatch(corpo, /update public\.assistant_profiles/i);
});

test("H: a FASE E não cria Agent Router nem afrouxa a resolução", () => {
  // Nenhum resolvedor é redefinido aqui: quem responde continua sendo o padrão
  // que a FASE D instalou. Escolher entre os N elegíveis é a FASE G.
  for (const resolvedor of [
    "private.intelligence_payload",
    "public.nucleo_customer_assistant_access",
    "public.nucleo_intelligence_context_resolve_v2",
    "public.nucleo_intelligence_context_resolve_v3",
  ]) {
    assert.ok(
      !sqlExecutavel.includes(`create or replace function ${resolvedor}`.toLowerCase()) &&
        !sqlExecutavel.includes(`CREATE OR REPLACE FUNCTION ${resolvedor}`),
      `a FASE E não deve redefinir ${resolvedor}`,
    );
  }
  const redefinidas = sqlExecutavel.match(/create or replace function/gi) ?? [];
  assert.equal(
    redefinidas.length,
    1,
    "a FASE E redefine somente provision_intelligence",
  );
});

test("M: a UI ativa não escolhe agente por audience arbitrária", async () => {
  // `data.profiles.find((item) => item.audience === "customer")` era exato
  // enquanto a unique garantia um agente por audience. Assim que a FASE E cai,
  // ele passa a pegar "algum" agente de clientes — e o `profileId` da campanha
  // sairia por sorteio.
  const tela = await readFile(
    new URL("../apps/emyleads/src/page/telas/Inteligencia.jsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    tela,
    /\.find\(\(item\) => item\.audience === "customer"\)/,
    "a seleção do agente de clientes deve exigir is_default",
  );
  assert.doesNotMatch(
    tela,
    /\.find\(\(item\) => item\.audience === "internal"\)/,
    "a seleção do agente interno deve exigir is_default",
  );
  assert.match(
    tela,
    /\.find\(\(item\) => item\.audience === "customer" && item\.is_default\)/,
    "a campanha deve ser amarrada ao agente PADRÃO de clientes",
  );
});
