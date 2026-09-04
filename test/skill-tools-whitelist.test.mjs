import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { RUNTIME_TOOLS, loadSkillCatalog } from "../packages/intelligence/src/catalog.mjs";

// A lista de ferramentas aceitas existe em vários lugares que nada liga entre
// si: `RUNTIME_TOOLS`, em packages/intelligence/src/catalog.mjs, que valida a
// skill na publicação; e uma lista fixa DENTRO DE CADA UM dos resolvedores
// SQL que validam a mesma skill na hora de resolver o contexto da conversa —
// `nucleo_intelligence_context_resolve_v2` (interno + fallback de externo) e
// `nucleo_intelligence_context_resolve_v3` (clientes externos).
//
// Em 27/08/2026 a fase H.4 acrescentou `calendar.request.prepare` e
// `calendar.request.submit` ao catálogo e criou a skill `solicitacao-agenda`
// com as duas. A lista de v2 não foi atualizada — nem pela H.4, nem por
// 20260828210000, que reescreveu a função inteira mantendo as treze antigas —
// até ser corrigida em 20260830060000.
//
// Aquela correção tocou só v2. `nucleo_intelligence_context_resolve_v3`
// mantém sua PRÓPRIA lista, independente da de v2 (v3 delega a v2 apenas para
// obter assistente/campanha/coleções — não herda a validação de ferramentas),
// e ficou com uma lista de dez, sem as duas de calendar.request nem as três
// de task.*. Como v3 é o resolvedor usado para clientes externos, qualquer
// turno que chegasse aos estágios `confirmar_cliente`/`submeter` de
// `solicitacao-agenda` levantava `published skill contains an unsupported
// tool` outra vez — o mesmo incidente de 30/08, reaberto num resolvedor
// diferente do que a correção anterior tocou. Corrigido em
// 20260904120000_sincronizar_allowedtools_do_resolve_v3.sql.
//
// O teste anterior não pegava essa segunda divergência: ele procurava a
// whitelist "vigente" pela ÚLTIMA MIGRATION, em ordem de nome de arquivo, que
// contivesse o texto da mensagem de erro — sem nunca conferir de qual FUNÇÃO
// aquela definição pertencia. Como só o arquivo de v2 usa literalmente
// "item not in (" (v3 usa "tool not in ("), a extração antiga sempre pulava o
// arquivo de v3 e comparava o catálogo contra v2, nunca contra v3. Este
// arquivo agora localiza a whitelist de cada função pelo NOME dela, e testa
// v2 e v3 separadamente.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const MARCADOR = "published skill contains an unsupported tool";

// Isola o corpo de UMA função (pelo nome completo) dentro de uma migration, e
// extrai a lista de ferramentas do bloco `... not in (...)` que valida
// `allowedTools`. Procurar pela forma do bloco, não por um nome de variável
// fixo (`item` em v2, `tool` em v3), faz a extração sobreviver a uma futura
// reescrita da função.
function extrairListaDoCorpo(corpoFuncao) {
  if (!corpoFuncao.includes(MARCADOR)) return null;
  const abertura = corpoFuncao.lastIndexOf("not in (");
  if (abertura === -1) return null;
  const fechamento = corpoFuncao.indexOf(")", abertura);
  const bloco = corpoFuncao.slice(abertura, fechamento);
  const ferramentas = [...bloco.matchAll(/'([a-z][a-z0-9_.]*)'/g)].map((m) => m[1]);
  return ferramentas.length ? ferramentas : null;
}

// Varre as migrations em ordem cronológica (nome de arquivo) e guarda a
// última definição de `nomeFuncao` que contiver a validação de ferramentas —
// isto é, a que está valendo no banco depois de todas as reescritas por
// `create or replace function`. Migrations que redefinem uma função DIFERENTE
// no mesmo arquivo (ex.: v3 chamando v2) não interferem, porque o corpo é
// isolado pelo nome antes de procurar o bloco `not in (...)`.
async function coletarWhitelistPorFuncao(nomeFuncao) {
  const arquivos = (await readdir(MIGRATIONS_DIR)).filter((nome) => nome.endsWith(".sql")).sort();
  const assinatura = `create or replace function public.${nomeFuncao}(`;

  let encontrada = null;
  for (const nome of arquivos) {
    const sql = await readFile(new URL(nome, MIGRATIONS_DIR), "utf8");
    const inicio = sql.indexOf(assinatura);
    if (inicio === -1) continue;
    const fim = sql.indexOf("$$;", inicio);
    if (fim === -1) continue;
    const corpo = sql.slice(inicio, fim);
    const ferramentas = extrairListaDoCorpo(corpo);
    if (!ferramentas) continue;
    encontrada = { nome, ferramentas };
  }
  return encontrada;
}

test("a extração de whitelist distingue v2 de v3 por nome de função, não pela última migration com o marcador", async () => {
  const v2 = await coletarWhitelistPorFuncao("nucleo_intelligence_context_resolve_v2");
  const v3 = await coletarWhitelistPorFuncao("nucleo_intelligence_context_resolve_v3");

  assert.ok(v2, "nenhuma migration define nucleo_intelligence_context_resolve_v2 com a validação de ferramentas");
  assert.ok(v3, "nenhuma migration define nucleo_intelligence_context_resolve_v3 com a validação de ferramentas");
  // As duas funções são redefinidas em arquivos diferentes hoje. Isto prova
  // que a extração acompanha CADA função, e não apenas "a migration mais
  // recente que menciona a mensagem de erro" (o bug do teste antigo).
  assert.notEqual(v2.nome, v3.nome, "v2 e v3 deveriam ser localizadas em migrations diferentes");
});

test("nucleo_intelligence_context_resolve_v2 aceita exatamente o catálogo canônico de ferramentas", async () => {
  const v2 = await coletarWhitelistPorFuncao("nucleo_intelligence_context_resolve_v2");
  assert.ok(v2, "nucleo_intelligence_context_resolve_v2 não foi encontrada");

  const noSql = new Set(v2.ferramentas);
  const noCatalogo = new Set(RUNTIME_TOOLS);

  const faltando = [...noCatalogo].filter((tool) => !noSql.has(tool));
  assert.deepEqual(
    faltando,
    [],
    `${v2.nome} não aceita ferramentas que o catálogo publica: ${faltando.join(", ")}. ` +
      "Uma skill publicada com elas quebra a resolução de contexto em tempo de conversa.",
  );

  const sobrando = [...noSql].filter((tool) => !noCatalogo.has(tool));
  assert.deepEqual(
    sobrando,
    [],
    `${v2.nome} aceita ferramentas fora do catálogo: ${sobrando.join(", ")}. ` +
      "A validação do banco não pode ser mais permissiva que a da publicação.",
  );
});

// O contrato real que importa não é "v2 === v3" — as duas funções podem
// legitimamente divergir (v3 só processa audience=customer; v3.tarefas nunca
// aparece porque `tarefas` é audience=internal). O contrato que não pode
// quebrar é: toda ferramenta que uma skill de CLIENTE pode pedir, em algum
// estágio do seu workflow, precisa ser aceita pelo resolvedor que atende
// clientes (v3). Se amanhã uma skill de cliente ganhar um estágio com uma
// ferramenta nova e ninguém atualizar v3, este teste falha aqui — não no
// WhatsApp de um cliente.
test("toda ferramenta que uma skill de cliente pode pedir por estágio está na whitelist de nucleo_intelligence_context_resolve_v3", async () => {
  const v3 = await coletarWhitelistPorFuncao("nucleo_intelligence_context_resolve_v3");
  assert.ok(v3, "nucleo_intelligence_context_resolve_v3 não foi encontrada");
  const aceitasPorV3 = new Set(v3.ferramentas);

  const catalogo = await loadSkillCatalog();
  assert.equal(
    catalogo.filter((entry) => entry.errors.length).length,
    0,
    "catálogo de skills inválido; corrija antes de checar o contrato skill→resolver",
  );

  const skillsDeCliente = catalogo
    .map((entry) => entry.skill)
    .filter((skill) => skill.audience === "customer" || skill.audience === "both");
  assert.ok(skillsDeCliente.length > 0, "nenhuma skill de audience customer/both encontrada no catálogo");

  const exigidasPorEstagio = new Set();
  for (const skill of skillsDeCliente) {
    for (const stage of skill.workflow?.stages || []) {
      for (const tool of stage.allowedTools || []) exigidasPorEstagio.add(tool);
    }
  }

  const faltando = [...exigidasPorEstagio].filter((tool) => !aceitasPorV3.has(tool));
  assert.deepEqual(
    faltando,
    [],
    `${v3.nome} não aceita ${faltando.join(", ")}, exigidas por estágio de skill(s) de cliente. ` +
      "Um turno de cliente que chegue a esse estágio recebe 'published skill contains an unsupported tool'.",
  );
});

// Regressão concreta do incidente: não basta um teste genérico que passe por
// acidente porque ninguém pediu horário durante a checagem. As duas
// ferramentas de solicitacao-agenda precisam estar, nominalmente, na
// whitelist de v3 — o resolvedor que processa o cliente que pede o horário.
test("calendar.request.prepare e calendar.request.submit estão disponíveis no contrato de v3 (regressão do incidente de 30/08)", async () => {
  const v3 = await coletarWhitelistPorFuncao("nucleo_intelligence_context_resolve_v3");
  assert.ok(v3, "nucleo_intelligence_context_resolve_v3 não foi encontrada");

  for (const tool of ["calendar.request.prepare", "calendar.request.submit"]) {
    assert.ok(RUNTIME_TOOLS.has(tool), `${tool} sumiu do catálogo`);
    assert.ok(
      v3.ferramentas.includes(tool),
      `${tool} não é aceita por ${v3.nome}; o pedido de horário do cliente volta a falhar em solicitacao-agenda`,
    );
  }
});

// A skill que motivou o caso. Se ela deixar de declarar as ferramentas de
// solicitação, os testes acima passam a testar o vazio.
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
