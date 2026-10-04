// Gera a migration 20261010100000 (a Análise Completa) a partir do molde
// `scripts/sql/molde-20261010100000.sql`, recortando o corpo atual do pedido de
// análise (20261004100000) e aplicando só as mudanças da Completa. Assim o
// resto do pedido fica idêntico ao que está em produção.
//
//   node scripts/sql/gerar-20261010100000.mjs
import { readFileSync, writeFileSync } from "node:fs";

const ler = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r/g, "");

function recortar(arquivo, inicio) {
  const texto = ler(arquivo);
  const i = texto.indexOf(inicio);
  if (i < 0) throw new Error(`não achei ${inicio}`);
  const fim = texto.indexOf("\n$$;", texto.indexOf("as $$", i));
  return texto.slice(i, fim + 4);
}

function trocar(texto, antes, depois) {
  if (texto.split(antes).length !== 2) throw new Error(`trecho não é único: ${antes.slice(0, 60)}`);
  // Função na troca: com texto, o JavaScript transformaria "$$" em "$".
  return texto.replace(antes, () => depois);
}

let pedido = recortar("supabase/migrations/20261004100000_atendimento_score_v1.sql", "create or replace function public.conversation_analysis_request(");
pedido = trocar(pedido,
  "  if tipo not in ('comercial', 'atendimento') then\n    raise exception 'analysis kind must be comercial or atendimento';\n  end if;",
  "  if tipo not in ('comercial', 'atendimento', 'lead', 'completa') then\n    raise exception 'analysis kind must be comercial, atendimento, lead or completa';\n  end if;");
pedido = trocar(pedido,
  "  versao_playbook integer;\n",
  "  versao_playbook integer;\n  -- A Completa (atendimento + lead + veredito) custa 2 créditos; o resto, 1.\n  custo integer := case when lower(trim(coalesce(analysis_kind, ''))) = 'completa' then 2 else 1 end;\n");
pedido = trocar(pedido,
  "  if saldo ->> 'limit' is not null and (saldo ->> 'left')::integer <= 0 then",
  "  if saldo ->> 'limit' is not null and (saldo ->> 'left')::integer < custo then");
pedido = trocar(pedido,
  "    lead_score, service_score\n  ) values (",
  "    lead_score, service_score, credits\n  ) values (");
pedido = trocar(pedido,
  "    (avaliacao ->> 'service')::smallint\n  )\n  returning id into nova;",
  "    (avaliacao ->> 'service')::smallint,\n    custo\n  )\n  returning id into nova;");

const molde = ler("scripts/sql/molde-20261010100000.sql");
const sql = trocar(molde, "-- {{PEDIDO}}", pedido);
writeFileSync(new URL("../../supabase/migrations/20261010100000_analise_completa.sql", import.meta.url), sql);
console.log("ok", sql.length);
