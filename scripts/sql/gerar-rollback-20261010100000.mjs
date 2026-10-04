// Gera o rollback da 20261010100000 (Análise Completa) recortando, das
// migrations anteriores, o corpo exato de cada função que ela substitui.
//
//   node scripts/sql/gerar-rollback-20261010100000.mjs
import { readFileSync, writeFileSync } from "node:fs";

const ler = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r/g, "");

function recortar(arquivo, inicio) {
  const texto = ler(`supabase/migrations/${arquivo}`);
  const i = texto.indexOf(inicio);
  if (i < 0) throw new Error(`não achei ${inicio} em ${arquivo}`);
  const fim = texto.indexOf("\n$$;", texto.indexOf("as $$", i));
  return texto.slice(i, fim + 4).replace(/^create function/, "create or replace function");
}

const creditos = recortar("20261002100000_analisar_conversa.sql", "create function private.creditos_de_analise(");
const pedido = recortar("20261004100000_atendimento_score_v1.sql", "create or replace function public.conversation_analysis_request(");
const relatorio = recortar("20261008100000_avaliacao_do_vendedor_v2.sql", "create function private.relatorio_do_vendedor(");
const linha = recortar("20261008100000_avaliacao_do_vendedor_v2.sql", "create or replace function private.linha_do_tempo_da_analise(");
const painel = recortar("20261008100000_avaliacao_do_vendedor_v2.sql", "create function public.platform_analysis_schema_set(");

const sql = `-- Rollback da 20261010100000 (Análise Completa).
--
-- Gerado por scripts/sql/gerar-rollback-20261010100000.mjs: cada função volta
-- EXATAMENTE ao corpo da migration de antes. A régua volta para a v2 se a v3
-- estiver em vigor; o modelo e as réguas da v3 ficam aposentados, não
-- apagados. As análises feitas continuam no banco: as de tipo lead e
-- completa ficam guardadas, e por isso a trava de tipos só volta ao que era
-- quando não houver nenhuma delas. A coluna de créditos sai (o uso volta a
-- ser uma linha por análise).

begin;

do $$
begin
  if to_regprocedure('private.veredito_do_cruzamento(jsonb, jsonb)') is null then
    raise exception 'abortado: a 20261010100000 nao esta aplicada';
  end if;
end $$;

-- 1. A régua: v2 de novo onde a v3 estiver valendo.
update public.analysis_schemas set status = 'retired'
where organization_id is not null and definition ->> 'key' = 'atendimento.v3' and status = 'published';
do $$
begin
  if exists (select 1 from public.analysis_schemas where organization_id is null and status = 'published'
             and definition ->> 'key' = 'atendimento.v3') then
    perform private.trocar_regua_padrao('atendimento.v2');
  end if;
end $$;

-- 2. As funções de antes.
${creditos}

revoke all on function private.creditos_de_analise(uuid) from public, anon, authenticated;

${pedido}

${relatorio}

revoke all on function private.relatorio_do_vendedor(public.conversation_analyses) from public, anon, authenticated;

${linha}

revoke all on function private.linha_do_tempo_da_analise(public.conversation_analyses) from public, anon, authenticated;

${painel}

revoke all on function public.platform_analysis_schema_set(uuid, text, text) from public, anon, authenticated;
grant execute on function public.platform_analysis_schema_set(uuid, text, text) to authenticated;

drop function private.veredito_do_cruzamento(jsonb, jsonb);

-- 3. A coluna e a trava de tipos.
alter table public.conversation_analyses drop column credits;
do $$
begin
  if not exists (select 1 from public.conversation_analyses where kind in ('lead', 'completa')) then
    alter table public.conversation_analyses drop constraint conversation_analyses_kind_check;
    alter table public.conversation_analyses
      add constraint conversation_analyses_kind_check check (kind in ('comercial', 'atendimento'));
  end if;
end $$;

commit;
`;
writeFileSync(new URL("rollback-20261010100000-analise-completa.sql", import.meta.url), sql);
console.log("ok", sql.length);
