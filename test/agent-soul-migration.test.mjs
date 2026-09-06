import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// FASE 13C, metade do banco. A migration leva o `soul_markdown` do agente que o
// Router da 13B escolheu até o payload — e nada além disso.
//
// O contrato central deste arquivo é o item B: o corpo da função tem de ser o
// corpo aplicado da 13B mais exatamente três acréscimos conhecidos. Qualquer
// outra diferença — na seleção de agente, na campanha, na skill, na
// persistência ou no retorno — reprova, porque seria a 13C mudando o Router
// enquanto ninguém olhava.
//
// A prova comportamental (persona do agente A não aparece quando B atende) está
// em scripts/sql/prova-soul-do-agente.sql.

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
const NOME_13C = "20260906010000_fase_13c_soul_do_agente_no_prompt.sql";
const NOME_13B = "20260905220000_fase_13_agent_router.sql";

const sql = await readFile(new URL(NOME_13C, MIGRATIONS_DIR), "utf8");
const sql13b = await readFile(new URL(NOME_13B, MIGRATIONS_DIR), "utf8");

function executavel(texto) {
  return texto
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("--"))
    .join("\n");
}

const sqlExecutavel = executavel(sql);

function corpoDaFuncao(fonte) {
  const inicio = fonte.indexOf("CREATE OR REPLACE FUNCTION private.intelligence_payload");
  assert.notEqual(inicio, -1, "deveria redefinir private.intelligence_payload");
  const fim = fonte.indexOf("$function$;", inicio) + "$function$;".length;
  return fonte.slice(inicio, fim);
}

const payload = corpoDaFuncao(sql);
const payload13b = corpoDaFuncao(sql13b);

function ocorrencias(texto, agulha) {
  return texto.split(agulha).length - 1;
}

test("A: a migration redefine apenas private.intelligence_payload", () => {
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
      !new RegExp(`(?:CREATE|create) OR REPLACE FUNCTION [a-z]+\\.${proibida}`, "i").test(sqlExecutavel),
      `a 13C não deveria redefinir ${proibida}`,
    );
  }
});

test("B: o corpo é o da 13B mais exatamente três acréscimos — nada mais", () => {
  // A mesma transformação que gerou o arquivo, refeita aqui a partir da 13B.
  // Se a 13C tiver mexido em qualquer outra linha, esta comparação reprova.
  const esperado = payload13b
    .replace(
      "  safe_source jsonb := coalesce(source_data, '{}'::jsonb);\n",
      "  safe_source jsonb := coalesce(source_data, '{}'::jsonb);\n  soul_texto text;\n  soul_hash text;\n",
    )
    .replace(
      `    'processo', selected_profile.process_config, 'templateId', selected_profile.template_id
    ),`,
      `    'processo', selected_profile.process_config, 'templateId', selected_profile.template_id,
      'soul', soul_texto, 'soulHash', soul_hash
    ),`,
    );

  // O terceiro acréscimo é um bloco inteiro; ele é removido antes da comparação
  // e conferido no item C.
  const inicioBloco = payload.indexOf("  soul_texto := nullif(");
  assert.notEqual(inicioBloco, -1, "faltou a leitura do soul");
  const fimBloco = payload.indexOf("  -- A campanha de uma conversa JA ABERTA", inicioBloco);
  assert.notEqual(fimBloco, -1, "o bloco do soul deveria terminar antes da campanha");
  const semBloco = payload.slice(0, inicioBloco) + payload.slice(fimBloco);

  // Comentários fora: o cabeçalho do bloco novo explica o que ele faz, e isso
  // não é diferença de comportamento.
  const semComentarios = (t) =>
    t.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").replace(/\n{2,}/g, "\n");

  assert.equal(
    semComentarios(semBloco),
    semComentarios(esperado),
    "fora os três acréscimos conhecidos, o corpo deveria ser idêntico ao da 13B",
  );
});

test("C: o Soul sai do agente selecionado, e de nenhuma consulta própria", () => {
  // O caminho de vazamento entre agentes seria uma busca separada em
  // assistant_profiles para pegar persona. Continuam três — os três ramos do
  // Router — e nenhuma delas é sobre soul.
  assert.equal(
    ocorrencias(payload, "from public.assistant_profiles profile"),
    3,
    "nenhuma consulta nova a assistant_profiles pode ter aparecido",
  );
  assert.match(
    payload,
    /soul_texto := nullif\(btrim\(coalesce\(selected_profile\.soul_markdown, ''\)\), ''\);/,
    "o soul deveria vir de selected_profile, o mesmo agente que o Router escolheu",
  );
  assert.equal(
    ocorrencias(payload, "soul_markdown"),
    1,
    "soul_markdown deveria ser lido uma única vez, do perfil selecionado",
  );
});

test("D: agente sem Soul manda null — nunca o Soul de outro agente", () => {
  // Nenhum fallback: nem para o padrão, nem para o perfil anterior, nem para
  // texto fixo. Herdar persona por ausência é o mesmo erro que a FASE D proibiu
  // para disponibilidade.
  assert.ok(
    !/coalesce\(soul_texto/.test(payload),
    "não pode haver fallback de soul",
  );
  assert.ok(
    !/soul[_a-z]* *:= *'/.test(payload.replace(/soul_texto := nullif\(btrim\(coalesce\(selected_profile\.soul_markdown, ''\)\), ''\);/, "")),
    "o soul não pode ser preenchido com literal nenhum",
  );
  // E o payload envia a chave mesmo quando é null, para o runtime distinguir
  // "sem persona" de "campo que não veio".
  assert.match(
    payload,
    /'soul', soul_texto, 'soulHash', soul_hash/,
    "soul e soulHash deveriam sair juntos no objeto assistente",
  );
});

test("E: o contrato de saída não mudou", () => {
  assert.ok(payload.includes("'schemaVersion', 'fase-h-1'"), "o schemaVersion mudou");
  assert.ok(payload.includes("'assistente', jsonb_build_object("), "a chave assistente mudou");
  assert.ok(!payload.includes("'agente', jsonb_build_object("), "assistente não pode virar agente");
  // As chaves que já existiam continuam todas lá, na mesma ordem.
  assert.match(
    payload,
    /'id', selected_profile\.id, 'nome', selected_profile\.display_name,\s+'tom', selected_profile\.tone, 'marca', selected_profile\.brand_config,\s+'processo', selected_profile\.process_config, 'templateId', selected_profile\.template_id,/,
    "as chaves antigas de assistente deveriam continuar como estavam",
  );
});

test("F: Soul é persona — não encosta em ferramenta, permissão ou política", () => {
  // No CORPO da função: nenhuma ferramenta. (No resto do arquivo a palavra
  // aparece de propósito, na asserção final que proíbe exatamente isto.)
  for (const proibido of ["allowedTools", "allowed_tools"]) {
    assert.ok(
      !payload.includes(proibido),
      `o corpo da função não deveria mencionar ${proibido}`,
    );
  }
  // E a migration inteira não mexe em autorização.
  for (const proibido of ["grant ", "revoke ", "create policy", "alter policy", "row level security"]) {
    assert.ok(
      !new RegExp(proibido, "i").test(sqlExecutavel),
      `a 13C não deveria conter ${proibido}`,
    );
  }
  // E o bloco de políticas do payload continua o mesmo.
  assert.match(
    payload,
    /'politicas', jsonb_build_object\(\s+'organizacaoDerivada', true,/,
    "o bloco de políticas não pode ter mudado",
  );
});

test("G: o teto de 8000 existe no banco e no payload, e descarta em vez de derrubar", () => {
  assert.match(
    payload,
    /if soul_texto is not null and length\(soul_texto\) > 8000 then\s+soul_texto := null;/,
    "o payload deveria descartar soul acima do teto, sem levantar exceção",
  );
  assert.match(
    sqlExecutavel,
    /add constraint assistant_profiles_soul_markdown_tamanho\s+check \(soul_markdown is null or length\(soul_markdown\) <= 8000\)/,
    "a constraint de tamanho deveria existir, com nome próprio",
  );
  // Derrubar o turno por persona longa demais trocaria um problema cosmético
  // por um real: o cliente ficaria sem resposta.
  assert.ok(
    !/length\(soul_texto\) > 8000 then\s+raise/.test(payload),
    "soul acima do teto não pode derrubar o turno",
  );
});

test("H: o hash é sha256 e o conteúdo nunca vai para log", () => {
  assert.match(
    payload,
    /encode\(extensions\.digest\(soul_texto, 'sha256'\), 'hex'\)/,
    "o hash deveria ser sha256 em hex, como o contentHash de skill",
  );
  // Nenhum raise/notice carrega o texto da persona.
  for (const linha of payload.split("\n")) {
    if (/raise (notice|warning|exception|log)/i.test(linha)) {
      assert.ok(
        !linha.includes("soul_texto"),
        `o conteúdo do soul não pode aparecer em log: ${linha.trim()}`,
      );
    }
  }
});

test("I: as guardas de pré-voo protegem o Router e a aplicação repetida", () => {
  const guardas = [
    ["a coluna soul_markdown (FASE B) nao existe", "a coluna da FASE B"],
    ["o Router da 13B nao esta aplicado", "a 13B aplicada"],
    ["ja transporta Soul", "aplicação repetida"],
    ["extensions.digest (pgcrypto) nao existe", "o pgcrypto do hash"],
    ["acima de 8000 caracteres", "linhas que violariam a constraint"],
  ];
  for (const [agulha, oque] of guardas) {
    assert.ok(sqlExecutavel.includes(agulha), `faltou a guarda de pré-voo para ${oque}`);
  }
});

test("J: as asserções finais provam que a 13B sobreviveu à reescrita", () => {
  const finais = sqlExecutavel.slice(sqlExecutavel.lastIndexOf("$function$;"));
  for (const agulha of [
    "o Soul nao esta sendo lido do agente selecionado",
    "o payload nao carrega soul e soulHash",
    "esperava 3 selecoes de agente",
    "a precedencia do Router da 13B foi perdida",
    "as seis recusas da 13B nao estao mais la",
    "o schemaVersion do payload mudou",
    "o payload passou a mencionar ferramentas",
    "a constraint de tamanho do soul nao existe",
    "o v2 deixou de copiar o objeto assistente inteiro",
    "o v3 deixou de copiar o objeto assistente inteiro",
  ]) {
    assert.ok(finais.includes(agulha), `faltou a asserção final: ${agulha}`);
  }
  assert.ok(finais.trimEnd().endsWith("commit;"), "a migration deveria terminar em commit");
});

test("K: nada de source_data, targetAgentId ou vocabulário de handoff", () => {
  // O Soul viaja pelo objeto do agente, não por sinal do worker. O recorte é só
  // o bloco do soul: o resto da função usa safe_source legitimamente, para
  // persistir o contexto, e isso é da 13B.
  const blocoSoul = payload.slice(
    payload.indexOf("soul_texto := nullif("),
    payload.indexOf("  -- A campanha de uma conversa JA ABERTA"),
  );
  assert.ok(blocoSoul.length > 0, "não achei o bloco do soul");
  assert.ok(!blocoSoul.includes("safe_source"), "o soul não pode vir de source_data");
  assert.ok(!blocoSoul.includes("source_data"), "o soul não pode vir de source_data");
  for (const proibido of ["targetAgentId", "targetMode", "handoff", "transferir_agente"]) {
    assert.ok(!sqlExecutavel.includes(proibido), `a 13C não deveria introduzir ${proibido}`);
  }
});

test("L: v2 e v3 continuam sendo o transporte, e a migration exige isso", () => {
  // É por eles que as duas chaves novas chegam ao runtimeContext sem mudança de
  // contrato. A migration confere isso no apply; aqui travamos a declaração.
  assert.ok(
    sqlExecutavel.includes("'assistant', payload -> ''assistente''") ||
      sqlExecutavel.includes("''assistant'', payload -> ''assistente''"),
    "a migration deveria exigir que o v2 copie o objeto assistente inteiro",
  );
  assert.ok(
    sqlExecutavel.includes("''assistant'', base_payload -> ''assistente''"),
    "a migration deveria exigir que o v3 copie o objeto assistente inteiro",
  );
});
