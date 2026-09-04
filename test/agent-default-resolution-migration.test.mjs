import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// FASE D. A migration troca a seleção implícita de agente ("o perfil daquela
// audience") pela seleção explícita do padrão. Como nas fases anteriores, aqui
// não há Postgres: estes contratos asseguram que a migration DECLARA a regra
// certa, e a própria migration falha sozinha no apply se a declaração não
// estiver lá (bloco final). A prova COMPORTAMENTAL — inclusive o cenário
// futuro com dois agentes, que é o que realmente distingue "recusar" de "cair
// no outro" — está em scripts/sql/prova-resolvedor-agente-padrao.sql.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const NOME_DA_MIGRATION = "20260904230000_resolvers_usam_agente_padrao.sql";

const sql = await readFile(new URL(NOME_DA_MIGRATION, MIGRATIONS_DIR), "utf8");

// Só o SQL que executa: fora ficam os comentários `--`, porque o cabeçalho
// desta migration cita de propósito o texto que ela está removendo.
const sqlExecutavel = sql
  .split("\n")
  .filter((linha) => !linha.trimStart().startsWith("--"))
  .join("\n");

// O corpo de cada função redefinida, para que um contrato sobre o v2 não passe
// por acidente por causa do que está escrito dentro do payload.
function corpoDaFuncao(nome) {
  const inicio = sqlExecutavel.indexOf(`CREATE OR REPLACE FUNCTION ${nome}`);
  assert.notEqual(inicio, -1, `a migration deveria redefinir ${nome}`);
  const fim = sqlExecutavel.indexOf("$function$;", inicio);
  assert.notEqual(fim, -1, `o corpo de ${nome} não termina como esperado`);
  return sqlExecutavel.slice(inicio, fim);
}

const payload = corpoDaFuncao("private.intelligence_payload");
const access = corpoDaFuncao("public.nucleo_customer_assistant_access");
const v2 = corpoDaFuncao("public.nucleo_intelligence_context_resolve_v2");

test("A: a seleção de agente do runtime referencia is_default explicitamente", () => {
  // O ponto por onde passa todo o runtime: v1, v2, v3 e o preview.
  assert.match(
    payload,
    /select \* into selected_profile from public\.assistant_profiles profile\s+where profile\.organization_id = target_organization\s+and profile\.audience = target_audience\s+and profile\.is_default;/,
    "intelligence_payload deveria selecionar o agente por (organização, audience, is_default)",
  );
});

test("B: com um único padrão ativo, o comportamento e a mensagem pública não mudam", () => {
  // A fase não pode inventar erro novo: quem consome isso hoje reconhece
  // exatamente esta string.
  const recusas = payload.match(
    /raise exception 'assistant profile is inactive or unavailable'/g,
  );
  assert.equal(
    recusas?.length,
    2,
    "as duas recusas (sem padrão / padrão inativo) deveriam usar a mesma mensagem de hoje",
  );
  // E o perfil escolhido continua alimentando o resto da função do mesmo jeito.
  assert.ok(
    payload.includes("set assistant_profile_id = selected_profile.id"),
    "o perfil selecionado deveria continuar sendo gravado no contexto",
  );
});

test("C: padrão inativo recusa, e a recusa é separada da seleção", () => {
  // O coração da fase. Se `active` voltar para dentro do where da seleção, um
  // padrão parado faz a query achar OUTRO agente em vez de recusar.
  assert.ok(
    !/and profile\.audience = target_audience and profile\.active/.test(payload),
    "a seleção do agente não pode voltar a filtrar active junto",
  );
  assert.match(
    payload,
    /if not selected_profile\.active then raise exception 'assistant profile is inactive or unavailable'; end if;/,
    "faltou a checagem de active separada, depois da seleção",
  );
  // E não pode existir uma segunda busca procurando substituto ativo.
  const buscasDeAgente = payload.match(
    /from public\.assistant_profiles/g,
  );
  assert.equal(
    buscasDeAgente?.length,
    1,
    "intelligence_payload deveria consultar assistant_profiles uma única vez: procurar substituto é o que a fase proíbe",
  );
});

test("D: ausência de padrão falha fechado", () => {
  assert.match(
    payload,
    /and profile\.is_default;\s+if not found then raise exception/,
    "sem padrão, a função deveria levantar exceção imediatamente",
  );
  assert.ok(
    !/coalesce\(selected_profile/.test(payload),
    "não deveria haver fallback silencioso para um perfil qualquer",
  );
});

test("E: o acesso do cliente usa o padrão explicitamente e preserva profile_inactive", () => {
  assert.match(
    access,
    /where profile\.organization_id = robot_org and profile\.audience = 'customer'\s+and profile\.is_default;/,
    "nucleo_customer_assistant_access deveria buscar o padrão da audience customer",
  );
  // Os dois casos (sem padrão e padrão inativo) continuam caindo no mesmo
  // reason público que existe hoje.
  assert.match(
    access,
    /if not found or not profile_row\.active then/,
    "a distinção entre encontrado e ativo deveria continuar existindo",
  );
  assert.ok(
    access.includes("'reason', 'profile_inactive'"),
    "o reason público profile_inactive não pode ter sido trocado por erro genérico",
  );
});

test("F: o preview não ganha seleção própria — ele herda a do payload", async () => {
  // O preview (public.intelligence_context_preview) delega inteiramente a
  // private.intelligence_payload. Corrigir o payload já o corrige; redefinir o
  // preview aqui criaria uma segunda semântica de padrão, que é justamente o
  // que a fase quer evitar.
  assert.ok(
    !sqlExecutavel.includes("intelligence_context_preview"),
    "a FASE D não deveria redefinir o preview",
  );
  const origem = await readFile(
    new URL("20260823120000_fase_h_inteligencia_contextual.sql", MIGRATIONS_DIR),
    "utf8",
  );
  const inicio = origem.indexOf("create or replace function public.intelligence_context_preview");
  assert.notEqual(inicio, -1, "o preview deveria estar definido na migration da FASE H");
  const corpo = origem.slice(inicio, origem.indexOf("$$;", inicio));
  assert.ok(
    corpo.includes("private.intelligence_payload("),
    "o preview deveria delegar ao payload",
  );
  assert.ok(
    !corpo.includes("from public.assistant_profiles"),
    "o preview não pode ter seleção de agente própria",
  );
});

test("G: o v2 não tem seleção arbitrária de agente remanescente", () => {
  // O v2 não resolve o agente da conversa, mas entrava por um perfil interno
  // qualquer para achar o skill de tarefas.
  assert.match(
    v2,
    /where profile\.organization_id = robot_org\s+and profile\.audience = 'internal'\s+and profile\.is_default\s+and profile\.active/,
    "o v2 deveria alcançar o skill de tarefas pelo agente padrão interno",
  );
  const buscasDeAgente = v2.match(/from public\.assistant_profiles/g);
  assert.equal(
    buscasDeAgente?.length,
    1,
    "o v2 deveria tocar assistant_profiles uma única vez",
  );
});

test("H: o v3 não tem seleção arbitrária de agente — ele lê o perfil pinado", async () => {
  // O v3 nunca escolheu agente: ele lê context_row.assistant_profile_id, que é
  // gravado pelo payload a cada turno. Por isso não é redefinido aqui.
  assert.ok(
    !sqlExecutavel.includes("nucleo_intelligence_context_resolve_v3"),
    "a FASE D não deveria redefinir o v3",
  );
  const origem = await readFile(
    new URL("20260824210000_fase_h3_orquestracao_contextual.sql", MIGRATIONS_DIR),
    "utf8",
  );
  const inicio = origem.indexOf("create or replace function public.nucleo_intelligence_context_resolve_v3");
  assert.notEqual(inicio, -1, "o v3 deveria estar definido na migration da FASE H3");
  const corpo = origem.slice(inicio, origem.indexOf("$$;", inicio));
  const buscasDeAgente = corpo.match(/from public\.assistant_profiles[^\n]*/g) ?? [];
  for (const busca of buscasDeAgente) {
    assert.ok(
      /profile\.id = context_row\.assistant_profile_id/.test(corpo),
      `o v3 só pode alcançar o perfil pelo id pinado, e não por ${busca}`,
    );
  }
  assert.ok(
    !/from public\.assistant_profiles profile\s+where profile\.organization_id/.test(corpo),
    "o v3 não pode selecionar agente por organização + audience",
  );
});

test("I: nenhuma seleção de agente depende de limit 1", () => {
  // A regra não é "não existe limit 1", é "nenhum limit 1 decide QUAL AGENTE".
  // Toda query que toca assistant_profiles precisa fixar o agente por
  // is_default (ou por id pinado); o que sobrar depois disso pode ordenar e
  // limitar, porque aí já está escolhendo skill, não agente.
  for (const [nome, corpo] of [["payload", payload], ["access", access], ["v2", v2]]) {
    const trechos = corpo.split(/from public\.assistant_profiles/).slice(1);
    assert.ok(trechos.length > 0, `${nome}: deveria consultar assistant_profiles`);
    for (const trecho of trechos) {
      const query = trecho.slice(0, trecho.indexOf(";"));
      assert.ok(
        /profile\.is_default/.test(query) || /profile\.id = /.test(query),
        `${nome}: a query que lê assistant_profiles precisa fixar o agente por is_default ou por id`,
      );
      if (/\blimit 1\b/.test(query)) {
        // Se limitou, então não estava escolhendo agente: precisa ter ordem
        // explícita e estar selecionando outra coisa que não o perfil.
        assert.match(
          query,
          /order by/,
          `${nome}: um limit 1 sem order by não tem critério nenhum`,
        );
        assert.ok(
          !/into (selected_profile|profile_row)\b/.test(query),
          `${nome}: a query que carrega o próprio perfil não pode terminar em limit 1`,
        );
      }
    }
  }
  // E, explicitamente: as duas queries que carregam o agente perderam o limit 1.
  // Recorte por statement — até o primeiro `;` — senão a busca atravessa para
  // a query seguinte e acusa um limit 1 que é de outra coisa.
  const statement = (corpo, marcador) => {
    const inicio = corpo.indexOf(marcador);
    assert.notEqual(inicio, -1, `não achei ${marcador}`);
    return corpo.slice(inicio, corpo.indexOf(";", inicio));
  };
  assert.ok(
    !/\blimit 1\b/.test(statement(payload, "into selected_profile")),
    "a seleção do agente no payload não pode mais usar limit 1",
  );
  assert.ok(
    !/\blimit 1\b/.test(statement(access, "into profile_row")),
    "a seleção do agente no customer access não pode mais usar limit 1",
  );
});

test("J: a UNIQUE antiga (organization_id, audience) continua exigida", () => {
  assert.ok(
    sqlExecutavel.includes("unique (organization_id, audience) sumiu"),
    "a migration deveria falhar se a unique antiga não estiver mais lá",
  );
  assert.match(
    sqlExecutavel,
    /= array\['audience', 'organization_id'\]/,
    "a checagem da unique antiga deveria comparar exatamente essas colunas",
  );
});

test("K: a FASE D não remove nada nem libera multi-agent", () => {
  assert.ok(
    !/\bdrop\b/i.test(sqlExecutavel),
    "a FASE D não pode conter DROP",
  );
  assert.ok(
    !/alter table/i.test(sqlExecutavel),
    "a FASE D não altera tabela: ela só redefine funções",
  );
  // E ela exige o índice parcial da FASE C, que é o que torna seguro ter
  // tirado o limit 1 da seleção.
  assert.ok(
    sqlExecutavel.includes("assistant_profiles_one_default_idx"),
    "a migration deveria exigir o índice parcial de agente padrão",
  );
});

test("L: provision_intelligence não é reescrita e segue criando padrão", async () => {
  assert.ok(
    !sqlExecutavel.includes("provision_intelligence"),
    "a FASE D não deveria reescrever provision_intelligence",
  );
  const faseC = await readFile(
    new URL("20260904190000_agente_padrao_explicito.sql", MIGRATIONS_DIR),
    "utf8",
  );
  const inicio = faseC.indexOf("create or replace function private.provision_intelligence");
  assert.notEqual(inicio, -1, "a FASE C deveria definir provision_intelligence");
  const corpo = faseC.slice(inicio);
  const inserts = corpo.match(/organization_id, template_id, audience, display_name, created_by, updated_by, is_default/g);
  assert.equal(inserts?.length, 2, "os dois perfis iniciais deveriam informar is_default");
  assert.equal(
    (corpo.match(/actor, actor, true/g) ?? []).length,
    2,
    "os dois perfis iniciais deveriam nascer com is_default = true",
  );
});
