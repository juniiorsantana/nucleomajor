import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const ler = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const migration = await ler("supabase/migrations/20260925100000_fluxos_com_caminhos.sql");
const gestao = await ler("apps/emyleads/src/page/Gestao.jsx");
const validacao = await ler("scripts/sql/validar-fluxos-com-caminhos.sql");

describe("função fluxos com caminhos", () => {
  it("o banco e o portal usam a mesma chave", () => {
    const chave = migration.match(/values \(\s*'([a-z_]+)'/)[1];
    assert.equal(chave, "fluxos_ramificados");
    assert.match(gestao, new RegExp(`recursos\\?\\.${chave} === true`));
    assert.match(validacao, new RegExp(`'${chave}'`));
  });

  it("só entra no catálogo: não liga para nenhuma empresa", () => {
    assert.doesNotMatch(migration, /organization_entitlements/);
    assert.match(migration, /on conflict \(key\) do nothing/);
  });

  it("cabe nas regras do catálogo", () => {
    const [, nome, descricao] = migration.match(/'feature',\s*'([^']+)',\s*'([^']+)'/);
    assert.ok(nome.trim().length >= 1 && nome.length <= 80);
    assert.ok(descricao.length <= 300);
  });

  it("a conferência só lê", () => {
    assert.doesNotMatch(validacao, /\b(insert|update|delete|alter|drop|create)\b/i);
  });
});
