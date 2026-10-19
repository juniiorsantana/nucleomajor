// Etapa 11 — passo 2 da conversão v2 → v3: gera o SQL do dono para UMA empresa.
//
//   node scripts/fluxos/converter-v2-para-v3.mjs <exportacao.json> <pasta de saída>
//
// Lê o JSON de `scripts/fluxos/exportar-fluxos-da-empresa.sql`, converte cada
// fluxo com a função pura do portal (`apps/emyleads/src/domain/conversaoV3.js`)
// e escreve dois arquivos:
//
//   <empresa>-1-converter.sql  ensaio por padrão (só relata, nada fica gravado);
//   <empresa>-2-desfazer.sql   volta cada fluxo convertido à definição exportada.
//
// O SQL confere de novo no banco, na hora de aplicar: o fluxo não mudou desde a
// exportação, `private.flow_validate(spec, empresa)` aceita (a mesma
// conferência do início da conversa, com o plano da Etapa 10),
// `private.flow_locked_feature` não acusa bloco trancado e as conexões da
// empresa dizem que rodam fluxo (`flow_runtime_status`, 20261018140000).
// O backup é o de sempre: o gatilho `chatbot_definition_versioning` grava a
// definição anterior em `chatbot_versions` a cada mudança.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { converterParaV3 } from "../../apps/emyleads/src/domain/conversaoV3.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Literal jsonb com um delimitador que não aparece no texto. */
function jsonb(valor) {
  const texto = JSON.stringify(valor);
  let marca = "fluxo";
  while (texto.includes(`$${marca}$`)) marca += "_";
  return `$${marca}$${texto}$${marca}$::jsonb`;
}
const texto = (valor) => `'${String(valor ?? "").replace(/'/g, "''")}'`;
const comentario = (valor) => String(valor ?? "").replace(/[\r\n]+/g, " ").slice(0, 200);

/** O relatório e os dois SQL, a partir do JSON exportado. Puro, para a prova. */
export function gerarSqlDeConversao(exportacao) {
  const org = exportacao?.organizationId;
  if (!UUID.test(String(org || ""))) throw new Error("exportação sem organizationId válido");
  const recursos = exportacao.recursos && typeof exportacao.recursos === "object" ? exportacao.recursos : null;
  const relatorio = [];
  const convertidos = [];
  for (const fluxo of exportacao.fluxos || []) {
    if (!UUID.test(String(fluxo?.id || ""))) throw new Error("fluxo sem id válido na exportação");
    const resultado = converterParaV3(fluxo.definition || {}, { recursos });
    relatorio.push({ id: fluxo.id, nome: fluxo.name, ativo: !!fluxo.active, estado: resultado.estado, motivo: resultado.motivo || "", detalhe: resultado.detalhe || "" });
    if (resultado.estado === "convertido") convertidos.push({ fluxo, depois: resultado.definicao });
  }

  const linhasDoRelatorio = relatorio.map((item) =>
    `--   ${item.estado.padEnd(11)} ${item.ativo ? "ativo  " : "inativo"} ${comentario(item.nome)} (${item.id})${item.motivo ? ` — ${item.motivo}: ${comentario(item.detalhe)}` : ""}`,
  ).join("\n");
  const cabecalho = `-- Empresa: ${comentario(exportacao.organizationName)} (${org})
-- Exportado em: ${comentario(exportacao.exportedAt)}
-- Gerado por scripts/fluxos/converter-v2-para-v3.mjs em ${new Date().toISOString()}.
--
-- O que a conversão pura decidiu, fluxo a fluxo:
${linhasDoRelatorio || "--   (nenhum fluxo)"}
`;

  const valores = convertidos.map(({ fluxo, depois }) =>
    `  ('${fluxo.id}'::uuid, ${texto(fluxo.name)}, ${jsonb(fluxo.definition)}, ${jsonb(depois)})`,
  ).join(",\n");

  const converter = `-- Etapa 11 — conversão v2 → v3, passo 3: CONVERTER.
${cabecalho}--
-- Como usar: colar inteiro no SQL Editor com \`ensaio\` = true (o padrão). O
-- ensaio confere tudo, mostra nas mensagens (NOTICE) o que faria e termina com
-- um erro proposital: nada fica gravado. Depois, trocar para false e colar de
-- novo. Pode ser colado mais de uma vez: o que já foi convertido é pulado.
-- Desfazer: o arquivo -2-desfazer.sql gerado junto.

begin;

create temp table conversao_v2_v3 (
  chatbot_id uuid primary key,
  nome text not null,
  antes jsonb not null,
  depois jsonb not null
) on commit drop;
${convertidos.length ? `insert into conversao_v2_v3 (chatbot_id, nome, antes, depois) values\n${valores};` : "-- nada a converter nesta empresa"}

do $conversao$
declare
  ensaio constant boolean := true;          -- false grava de verdade
  exigir_executor constant boolean := true; -- as conexões precisam dizer que rodam fluxo
  empresa constant uuid := '${org}';
  item record;
  atual record;
  trava text;
  problema text;
  convertidos integer := 0;
  ja_estavam integer := 0;
  pulados integer := 0;
begin
  if to_regprocedure('private.flow_validate(jsonb, uuid)') is null
     or to_regprocedure('private.flow_locked_feature(uuid, jsonb)') is null then
    raise exception 'conversão: falta a migration 20261018100000 (cada bloco depende do plano)';
  end if;
  if exigir_executor then
    if not exists (select 1 from information_schema.columns where table_schema = 'public'
                   and table_name = 'connection_runtime_status' and column_name = 'flow_runtime_status') then
      problema := 'falta a migration 20261018140000: o banco ainda não sabe se a conexão roda fluxo';
    elsif not exists (select 1 from public.whatsapp_connections c
                      where c.organization_id = empresa and c.status <> 'revoked') then
      problema := 'a empresa não tem conexão de WhatsApp';
    elsif exists (
      select 1 from public.whatsapp_connections c
      left join public.connection_runtime_status s on s.connection_id = c.id
      where c.organization_id = empresa and c.status <> 'revoked'
        and coalesce(s.flow_runtime_status, '') <> 'online'
    ) then
      problema := 'alguma conexão da empresa não diz que roda fluxo (flow_runtime_status <> online)';
    end if;
    if problema is not null then
      if not ensaio then
        raise exception 'conversão: %. Ligue o executor de fluxos na conexão antes de converter.', problema;
      end if;
      raise notice 'ATENÇÃO (o ensaio segue, a conversão de verdade pararia aqui): %', problema;
    end if;
  end if;

  for item in select * from conversao_v2_v3 order by nome loop
    select b.id, b.organization_id, b.version, b.definition, b.deleted_at into atual
    from public.chatbot_definitions b where b.id = item.chatbot_id for update;
    if not found or atual.organization_id <> empresa or atual.deleted_at is not null then
      pulados := pulados + 1;
      raise notice 'pulado: "%" não existe mais nesta empresa', item.nome;
      continue;
    end if;
    if atual.definition = item.depois then
      ja_estavam := ja_estavam + 1;
      raise notice 'já convertido: "%"', item.nome;
      continue;
    end if;
    if atual.definition <> item.antes then
      pulados := pulados + 1;
      raise notice 'pulado: "%" mudou desde a exportação (versão %); exporte de novo', item.nome, atual.version;
      continue;
    end if;
    trava := private.flow_locked_feature(empresa, item.depois);
    if trava is not null then
      pulados := pulados + 1;
      raise notice 'pulado: "%" usa bloco que o plano não libera (%)', item.nome, trava;
      continue;
    end if;
    begin
      perform private.flow_validate(item.depois, empresa);
    exception when others then
      pulados := pulados + 1;
      raise notice 'pulado: "%" o banco recusaria (%)', item.nome, sqlerrm;
      continue;
    end;
    -- O gatilho chatbot_definition_versioning guarda a versão anterior em
    -- chatbot_versions e sobe a versão.
    update public.chatbot_definitions set definition = item.depois where id = item.chatbot_id;
    convertidos := convertidos + 1;
    raise notice 'convertido: "%" (versão % → %)', item.nome, atual.version, atual.version + 1;
  end loop;

  if ensaio then
    raise exception 'ENSAIO: nada gravado. Seriam convertidos %, já estavam %, pulados %.', convertidos, ja_estavam, pulados;
  end if;
  raise notice 'GRAVADO: convertidos %, já estavam %, pulados %.', convertidos, ja_estavam, pulados;
end
$conversao$;

commit;
`;

  const desfazer = `-- Etapa 11 — conversão v2 → v3: DESFAZER.
${cabecalho}--
-- Volta cada fluxo convertido à definição exportada, se ninguém o editou depois
-- da conversão (quem foi editado é só relatado: desfazer à mão pela tabela
-- chatbot_versions, que guarda todas as versões). Ensaio por padrão, como na
-- conversão. A volta também gera uma versão nova em chatbot_versions.

begin;

create temp table desfazer_v2_v3 (
  chatbot_id uuid primary key,
  nome text not null,
  antes jsonb not null,
  depois jsonb not null
) on commit drop;
${convertidos.length ? `insert into desfazer_v2_v3 (chatbot_id, nome, antes, depois) values\n${valores};` : "-- nada a desfazer nesta empresa"}

do $desfazer$
declare
  ensaio constant boolean := true;  -- false grava de verdade
  empresa constant uuid := '${org}';
  item record;
  atual record;
  voltaram integer := 0;
  pulados integer := 0;
begin
  for item in select * from desfazer_v2_v3 order by nome loop
    select b.organization_id, b.version, b.definition into atual
    from public.chatbot_definitions b where b.id = item.chatbot_id and b.deleted_at is null for update;
    if not found or atual.organization_id <> empresa then
      pulados := pulados + 1;
      raise notice 'pulado: "%" não existe mais', item.nome;
      continue;
    end if;
    if atual.definition = item.antes then
      raise notice 'já estava como antes: "%"', item.nome;
      continue;
    end if;
    if atual.definition <> item.depois then
      pulados := pulados + 1;
      raise notice 'pulado: "%" foi editado depois da conversão (versão %); veja chatbot_versions', item.nome, atual.version;
      continue;
    end if;
    update public.chatbot_definitions set definition = item.antes where id = item.chatbot_id;
    voltaram := voltaram + 1;
    raise notice 'voltou ao v2: "%" (versão % → %)', item.nome, atual.version, atual.version + 1;
  end loop;
  if ensaio then
    raise exception 'ENSAIO: nada gravado. Voltariam %, pulados %.', voltaram, pulados;
  end if;
  raise notice 'GRAVADO: voltaram %, pulados %.', voltaram, pulados;
end
$desfazer$;

commit;
`;
  return { relatorio, converter, desfazer };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const [entrada, saida] = process.argv.slice(2);
  if (!entrada || !saida) {
    console.error("uso: node scripts/fluxos/converter-v2-para-v3.mjs <exportacao.json> <pasta de saída>");
    process.exit(2);
  }
  const bruto = JSON.parse(readFileSync(entrada, "utf8").replace(/^﻿/, ""));
  // O SQL Editor exporta a linha inteira; aceitar {exportacao: {...}} e o objeto puro.
  const exportacao = bruto?.exportacao || (Array.isArray(bruto) ? bruto[0]?.exportacao : null) || bruto;
  const { relatorio, converter, desfazer } = gerarSqlDeConversao(exportacao);
  mkdirSync(saida, { recursive: true });
  const base = String(exportacao.organizationName || exportacao.organizationId).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "empresa";
  writeFileSync(join(saida, `${base}-1-converter.sql`), converter);
  writeFileSync(join(saida, `${base}-2-desfazer.sql`), desfazer);
  for (const item of relatorio) console.log(`${item.estado.padEnd(11)} ${item.nome}${item.motivo ? ` — ${item.motivo}` : ""}`);
  console.log(`\nArquivos em ${saida}: ${base}-1-converter.sql e ${base}-2-desfazer.sql`);
}
