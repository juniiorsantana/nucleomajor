import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// FASE 13, primeira fatia. A migration troca "o agente é sempre o padrão" pela
// precedência afinidade → campanha → padrão, reescrevendo um corpo só.
//
// Como nas fases anteriores, aqui não há Postgres: estes contratos asseguram
// que a migration DECLARA a regra certa, e a própria migration falha sozinha no
// apply se a declaração não estiver lá (bloco final de asserções). A prova
// COMPORTAMENTAL — a que distingue "recusa" de "cai no outro agente", que
// nenhuma leitura de SQL prova sozinha — está em
// scripts/sql/prova-agent-router.sql.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const NOME_DA_MIGRATION = "20260905220000_fase_13_agent_router.sql";
const NOME_DA_FASE_D = "20260904230000_resolvers_usam_agente_padrao.sql";

const sql = await readFile(new URL(NOME_DA_MIGRATION, MIGRATIONS_DIR), "utf8");
const sqlFaseD = await readFile(new URL(NOME_DA_FASE_D, MIGRATIONS_DIR), "utf8");

// Só o SQL que executa: fora ficam os comentários `--`, porque o cabeçalho
// desta migration cita de propósito o comportamento que ela está removendo.
function executavel(texto) {
  return texto
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("--"))
    .join("\n");
}

const sqlExecutavel = executavel(sql);
const faseDExecutavel = executavel(sqlFaseD);

function corpoDaFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`CREATE OR REPLACE FUNCTION ${nome}`);
  assert.notEqual(inicio, -1, `deveria redefinir ${nome}`);
  const fim = fonte.indexOf("$function$;", inicio);
  assert.notEqual(fim, -1, `o corpo de ${nome} não termina como esperado`);
  return fonte.slice(inicio, fim);
}

const payload = corpoDaFuncao(sqlExecutavel, "private.intelligence_payload");
const payloadFaseD = corpoDaFuncao(faseDExecutavel, "private.intelligence_payload");

// Recorte de um statement: do marcador até o primeiro `;`. Sem isso, uma busca
// por `limit 1` atravessa para a query seguinte e acusa um limite que é de
// outra coisa.
function statement(corpo, marcador, ocorrencia = 0) {
  let inicio = -1;
  for (let i = 0; i <= ocorrencia; i += 1) {
    inicio = corpo.indexOf(marcador, inicio + 1);
    assert.notEqual(inicio, -1, `não achei a ocorrência ${ocorrencia} de ${marcador}`);
  }
  return corpo.slice(inicio, corpo.indexOf(";", inicio));
}

function ocorrencias(texto, agulha) {
  return texto.split(agulha).length - 1;
}

test("A: a migration redefine apenas private.intelligence_payload", () => {
  // Uma semântica de roteamento, não uma por chamador. v2, v3, preview e
  // provision_intelligence chegam todos aqui e não podem ganhar critério
  // próprio.
  assert.equal(
    ocorrencias(sqlExecutavel, "CREATE OR REPLACE FUNCTION"),
    1,
    "a fatia deveria redefinir uma função só",
  );
  for (const proibida of [
    "nucleo_intelligence_context_resolve_v2",
    "nucleo_intelligence_context_resolve_v3",
    "intelligence_context_preview",
    "provision_intelligence",
    "nucleo_customer_assistant_access",
  ]) {
    assert.ok(
      !sqlExecutavel.includes(`FUNCTION public.${proibida}`) &&
        !sqlExecutavel.includes(`function public.${proibida}`) &&
        !sqlExecutavel.includes(`FUNCTION private.${proibida}`) &&
        !sqlExecutavel.includes(`function private.${proibida}`),
      `a FASE 13 não deveria redefinir ${proibida}`,
    );
  }
});

test("B: a precedência declarada é afinidade → campanha → padrão", () => {
  const afinidade = payload.indexOf("profile.id = existing_context.assistant_profile_id");
  const campanha = payload.indexOf("profile.id = selected_campaign.assistant_profile_id");
  const padrao = payload.indexOf("profile.is_default");

  assert.notEqual(afinidade, -1, "faltou a seleção por afinidade");
  assert.notEqual(campanha, -1, "faltou a seleção pelo agente da campanha");
  assert.notEqual(padrao, -1, "a seleção do agente padrão (FASE D) foi perdida");
  assert.ok(
    afinidade < campanha && campanha < padrao,
    "a ordem dos ramos deveria ser afinidade, campanha e só então padrão",
  );

  // E os três são ramos do MESMO if: um `elsif` entre eles é o que garante
  // exclusão mútua. Dois `if` separados deixariam o segundo sobrescrever o
  // primeiro em silêncio.
  const bloco = payload.slice(afinidade, padrao);
  assert.equal(
    ocorrencias(bloco, "elsif"),
    1,
    "os ramos de seleção de agente deveriam ser encadeados por elsif",
  );
});

test("C: o contexto é carregado ANTES de qualquer seleção de agente", () => {
  // É o que torna a afinidade possível. Na FASE D o agente era escolhido antes
  // de se olhar a conversa.
  const contexto = payload.indexOf("into existing_context");
  const primeiroAgente = payload.indexOf("from public.assistant_profiles profile");
  assert.notEqual(contexto, -1, "o contexto deveria ser carregado");
  assert.ok(
    contexto < primeiroAgente,
    "o contexto da conversa deveria ser lido antes de escolher o agente",
  );
});

test("D: atendimento humano recusa antes de escolher agente", () => {
  const handoff = payload.indexOf("conversation is assigned to human service");
  const primeiroAgente = payload.indexOf("from public.assistant_profiles profile");
  assert.notEqual(handoff, -1, "a recusa por atendimento humano deveria continuar existindo");
  assert.ok(
    handoff < primeiroAgente,
    "conversa entregue a humano tem de recusar antes de qualquer seleção de agente",
  );
});

test("E: toda seleção de agente é por critério explícito, e nenhuma usa limit 1", () => {
  // A regra não é "não existe limit 1", é "nenhum limit 1 decide QUAL AGENTE".
  const trechos = payload.split("from public.assistant_profiles profile").slice(1);
  assert.equal(trechos.length, 3, "deveriam existir exatamente três seleções de agente");

  for (const trecho of trechos) {
    const query = trecho.slice(0, trecho.indexOf(";"));
    assert.ok(
      /profile\.is_default/.test(query) || /profile\.id = /.test(query),
      "cada seleção precisa fixar o agente por is_default ou por id",
    );
    assert.ok(
      !/\blimit 1\b/.test(query),
      "nenhuma seleção de agente pode terminar em limit 1",
    );
  }

  // As duas buscas por id não podem confiar só no id: escopo é
  // id + organization_id + audience.
  for (const marcador of [
    "profile.id = existing_context.assistant_profile_id",
    "profile.id = selected_campaign.assistant_profile_id",
  ]) {
    const query = statement(payload, marcador);
    assert.match(
      query,
      /profile\.organization_id = target_organization/,
      `${marcador} deveria filtrar por organização`,
    );
    assert.match(
      query,
      /profile\.audience = target_audience/,
      `${marcador} deveria filtrar por audience`,
    );
  }

  // E a do padrão continua dependendo explicitamente de is_default.
  const padrao = statement(payload, "profile.organization_id = target_organization\n      and profile.audience = target_audience\n      and profile.is_default");
  assert.match(padrao, /profile\.is_default/, "a seleção do padrão deveria depender de is_default");
});

test("F: os três ramos recusam com a mensagem pública de sempre, e nenhum procura substituto", () => {
  assert.equal(
    ocorrencias(payload, "assistant profile is inactive or unavailable"),
    6,
    "três ramos × (não existe / existe mas está parado) = seis recusas com a string de hoje",
  );
  // Nenhum código de erro novo: mexer nisso obrigaria a mexer no runtime.
  const excecoes = payload.match(/raise exception '([^']+)'/g) ?? [];
  const conhecidas = new Set([
    "raise exception 'invalid assistant audience'",
    "raise exception 'invalid assistant channel'",
    "raise exception 'invalid conversation context key'",
    "raise exception 'conversation is assigned to human service'",
    "raise exception 'assistant profile is inactive or unavailable'",
  ]);
  for (const excecao of excecoes) {
    assert.ok(conhecidas.has(excecao), `mensagem pública nova no payload: ${excecao}`);
  }
});

test("G: active continua sendo checagem separada, nunca filtro da seleção", () => {
  // O coração herdado da FASE D. Se `active` voltar para dentro do where, um
  // agente parado faz a query encontrar OUTRO em vez de recusar.
  assert.ok(
    !/and profile\.audience = target_audience and profile\.active/.test(payload),
    "a seleção do agente não pode voltar a filtrar active junto",
  );
  assert.equal(
    ocorrencias(payload, "if not selected_profile.active then raise exception"),
    3,
    "cada um dos três ramos precisa da sua checagem de active, depois da seleção",
  );
});

test("H: campanha de conversa aberta nunca atravessa o agente pinado", () => {
  // Reaproveitar a campanha gravada exige que ela seja do agente pinado...
  const reaproveita = statement(payload, "where campaign.id = existing_context.campaign_id");
  assert.match(
    reaproveita,
    /campaign\.organization_id = target_organization/,
    "a campanha reaproveitada deveria ser filtrada por organização",
  );
  assert.match(
    reaproveita,
    /campaign\.assistant_profile_id = selected_profile\.id/,
    "a campanha reaproveitada deveria pertencer ao agente pinado",
  );
  // ...e a campanha descoberta numa conversa já aberta é descartada se for de
  // outro agente. Descartada, não recusada: campanha é do funil, não da conversa.
  assert.match(
    payload,
    /selected_campaign\.assistant_profile_id is distinct from selected_profile\.id then\s+selected_campaign := null;/,
    "campanha descoberta de outro agente deveria ser descartada numa conversa já aberta",
  );
});

test("I: a descoberta automática de campanha só ganhou desempate determinista", () => {
  // Elegibilidade (fonte, keyword, campanha padrão, vigência) e ordenação são
  // as mesmas da FASE D; o que mudou foi QUANDO ela roda, não o que ela aceita.
  // A única diferença permitida na query é `campaign.id` como última chave de
  // desempate — se ela decidisse algo antes de `created_at`, mudaria
  // precedência, e este assert quebraria.
  const recorte = (corpo) => {
    const inicio = corpo.indexOf("from public.organization_campaigns campaign\n    left join public.campaign_sources source");
    assert.notEqual(inicio, -1, "não achei a descoberta de campanha");
    return corpo.slice(inicio, corpo.indexOf(";", inicio));
  };
  assert.equal(
    recorte(payload),
    recorte(payloadFaseD).replace("campaign.created_at", "campaign.created_at, campaign.id"),
    "a descoberta de campanha só pode diferir da FASE D pelo desempate por id",
  );

  // E o desempate é mesmo o ÚLTIMO critério, imediatamente antes do limit 1.
  assert.match(
    recorte(payload),
    /campaign\.created_at, campaign\.id\s+limit 1$/,
    "campaign.id deveria ser a última chave da ordenação, logo antes do limit 1",
  );

  // E ela só roda quando a conversa ainda não tem campanha.
  assert.match(
    payload,
    /if existing_context\.campaign_id is null and target_audience = 'customer' then/,
    "a descoberta deveria acontecer só quando a conversa ainda não tem campanha",
  );
});

test("J: o contrato de saída e a persistência são byte a byte os da FASE D", () => {
  const retorno = (corpo) => corpo.slice(corpo.indexOf("return jsonb_build_object("));
  assert.equal(
    retorno(payload),
    retorno(payloadFaseD),
    "o JSON de retorno não pode ter mudado nesta fatia",
  );

  const persistencia = (corpo) => {
    const inicio = corpo.indexOf("if should_persist then");
    return corpo.slice(inicio, corpo.indexOf("return jsonb_build_object(", inicio));
  };
  assert.equal(
    persistencia(payload),
    persistencia(payloadFaseD),
    "a persistência do contexto não pode ter mudado nesta fatia",
  );

  // Explicitamente, porque é o que o runtime valida na borda.
  assert.ok(payload.includes("'schemaVersion', 'fase-h-1'"), "o schemaVersion mudou");
  assert.ok(
    payload.includes("set assistant_profile_id = selected_profile.id"),
    "o contexto deveria continuar gravando o agente resolvido — é dali que o v3 lê",
  );
});

test("K: nada de vocabulário novo de roteamento nem rename de assistente", () => {
  for (const proibido of ["targetAgentId", "targetMode", "agent_id", "'agente'"]) {
    assert.ok(
      !sqlExecutavel.includes(proibido),
      `a fatia não deveria introduzir ${proibido}`,
    );
  }
  // As chaves do payload continuam em português e continuam as mesmas.
  assert.ok(payload.includes("'assistente', jsonb_build_object("), "a chave assistente mudou");
  assert.ok(!payload.includes("'agente', jsonb_build_object("), "assistente não pode virar agente");
});

test("L: a fatia não mexe em schema — é só CREATE OR REPLACE", () => {
  assert.ok(!/alter table/i.test(sqlExecutavel), "a FASE 13 não altera tabela");
  assert.ok(!/drop (table|constraint|index|function|policy)/i.test(sqlExecutavel), "a FASE 13 não remove nada");
  assert.ok(!/create table public\./i.test(sqlExecutavel), "a FASE 13 não cria tabela de negócio");
  assert.ok(!/create (unique )?index/i.test(sqlExecutavel), "a FASE 13 não cria índice");
  assert.ok(!/grant |revoke /i.test(sqlExecutavel), "a FASE 13 não mexe em privilégio");
  // A única tabela criada é a temporária que guarda o ACL de antes.
  assert.equal(
    ocorrencias(sqlExecutavel, "create temporary table"),
    1,
    "a única criação deveria ser a tabela temporária da conferência de ACL",
  );
});

test("M: as guardas de pré-voo cobrem tudo que a fatia pressupõe", () => {
  const guardas = [
    ["is_default", "a coluna da FASE C"],
    ["assistant_profiles_one_default_idx", "o índice parcial que dispensa o limit 1"],
    ["conversation_intelligence_contexts.assistant_profile_id nao existe", "a coluna da afinidade"],
    ["organization_campaigns.assistant_profile_id nao existe", "o vínculo campanha → agente"],
    ["FK composta (assistant_profile_id, organization_id) do contexto", "a FK do contexto"],
    ["FK composta (assistant_profile_id, organization_id) da campanha", "a FK da campanha"],
    ["nao seleciona por is_default (FASE D ausente)", "a FASE D aplicada"],
  ];
  for (const [agulha, oque] of guardas) {
    assert.ok(sqlExecutavel.includes(agulha), `faltou a guarda de pré-voo para ${oque}`);
  }
  // E o pré-voo recusa aplicar duas vezes por cima de um router já instalado.
  assert.ok(
    sqlExecutavel.includes("ja le a afinidade"),
    "a migration deveria recusar rodar sobre um corpo que já roteia",
  );
});

test("N: as asserções finais conferem o corpo aplicado, não a mensagem de sucesso", () => {
  const finais = sqlExecutavel.slice(sqlExecutavel.lastIndexOf("$function$;"));
  for (const agulha of [
    "select p.prosrc into corpo",
    "profile.id = existing_context.assistant_profile_id",
    "profile.id = selected_campaign.assistant_profile_id",
    "voltou a filtrar active junto",
    "esperava 6 recusas",
    "esperava 3 selecoes de agente",
    "o desempate por campaign.id saiu da descoberta de campanha",
    "o schemaVersion do payload mudou",
    "dono, ACL ou configuracao da funcao mudou",
  ]) {
    assert.ok(finais.includes(agulha), `faltou a asserção final: ${agulha}`);
  }
  assert.ok(finais.trimEnd().endsWith("commit;"), "a migration deveria terminar em commit");
});

test("O: o v3 continua sem seleção própria — ele lê o id pinado", async () => {
  // Mesma trava da FASE D, revalidada aqui porque agora o campo que o v3 lê
  // deixou de ser sempre o padrão: se o v3 ganhasse seleção própria, passariam
  // a existir duas semânticas de roteamento.
  const origem = await readFile(
    new URL("20260824210000_fase_h3_orquestracao_contextual.sql", MIGRATIONS_DIR),
    "utf8",
  );
  const inicio = origem.indexOf(
    "create or replace function public.nucleo_intelligence_context_resolve_v3",
  );
  assert.notEqual(inicio, -1, "o v3 deveria estar definido na migration da FASE H3");
  const corpo = origem.slice(inicio, origem.indexOf("$$;", inicio));
  assert.ok(
    /profile\.id = context_row\.assistant_profile_id/.test(corpo),
    "o v3 só pode alcançar o perfil pelo id pinado",
  );
  assert.ok(
    !/from public\.assistant_profiles profile\s+where profile\.organization_id/.test(corpo),
    "o v3 não pode selecionar agente por organização + audience",
  );
});
