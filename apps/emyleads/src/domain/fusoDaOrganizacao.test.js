import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FUSO_PADRAO, FUSOS_DO_BRASIL, fusoDaOrganizacao } from "./regras.js";

const MIGRATION = new URL("../../../../supabase/migrations/20261018130000_fuso_da_organizacao.sql", import.meta.url);

describe("o fuso da organização", () => {
  it("o banco aceita exatamente a lista do portal", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const trecho = sql.match(/-- fusos:inicio([\s\S]*?)-- fusos:fim/);
    expect(trecho, "marcadores fusos:inicio/fusos:fim na migration").not.toBeNull();
    const doBanco = [...trecho[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(doBanco).toEqual(FUSOS_DO_BRASIL);
    expect(sql).toContain(`default '${FUSO_PADRAO}'`);
  });

  it("usa o fuso da empresa quando é um dos do Brasil", () => {
    expect(fusoDaOrganizacao({ timezone: "America/Manaus" })).toBe("America/Manaus");
  });

  it("cai no padrão sem empresa, sem a coluna (banco antigo) ou com valor estranho", () => {
    expect(fusoDaOrganizacao(null)).toBe(FUSO_PADRAO);
    expect(fusoDaOrganizacao({ id: "org" })).toBe(FUSO_PADRAO);
    expect(fusoDaOrganizacao({ timezone: null })).toBe(FUSO_PADRAO);
    expect(fusoDaOrganizacao({ timezone: "Europe/Lisbon" })).toBe(FUSO_PADRAO);
  });
});
