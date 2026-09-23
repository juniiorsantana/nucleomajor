import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FUSOS_DO_BRASIL } from "../apps/emyleads/src/domain/regras.js";

const ler = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const migration = (await ler("supabase/migrations/20260925110000_fluxos_com_dia_e_horario.sql")).replaceAll("\r", "");
const validacao = await ler("scripts/sql/validar-fluxos-com-dia-e-horario.sql");
const anterior = (await ler("supabase/migrations/20260907010000_fluxos_execucao_persistida.sql")).replaceAll("\r", "");

describe("dia da semana e horário no banco", () => {
  it("a conferência espera o hash do corpo que a migration grava", () => {
    const corpo = migration.match(/as \$\$(.*?)\$\$;/s)[1];
    const hash = createHash("md5").update(corpo).digest("hex");
    assert.match(validacao, new RegExp(`'flow_validate_expression', '${hash}'`));
  });

  it("o banco aceita exatamente os fusos que o portal oferece", () => {
    const lista = migration.match(/not in \(\s*('America[^)]+)\)/s)[1];
    const fusos = [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(fusos, [...FUSOS_DO_BRASIL].sort());
  });

  it("só troca a função de formato das regras, mantendo o que ela já recusava", () => {
    assert.equal((migration.match(/create or replace function/g) || []).length, 1);
    assert.match(migration, /create or replace function private\.flow_validate_expression\(expression jsonb, depth integer default 0\)/);
    assert.match(migration, /language plpgsql immutable set search_path = ''/);
    const antigo = anterior.match(/create function private\.flow_validate_expression.*?as \$\$(.*?)\$\$;/s)[1];
    for (const linha of antigo.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("if kind is null"))) {
      assert.ok(migration.includes(linha), `linha antiga sumiu: ${linha}`);
    }
  });

  it("a conferência só lê", () => {
    assert.doesNotMatch(validacao, /\b(insert|update|delete|alter|drop|create)\b/i);
  });
});
