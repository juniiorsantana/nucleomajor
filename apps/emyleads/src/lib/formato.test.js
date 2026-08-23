import { describe, expect, it } from "vitest";
import { fmtRelativo } from "./formato";

const AGORA = Date.parse("2026-08-12T12:00:00-03:00");

describe("fmtRelativo", () => {
  it("trata nulo e futuro", () => {
    expect(fmtRelativo(null, AGORA)).toBe("—");
    expect(fmtRelativo(AGORA + 1000, AGORA)).toBe("agora");
  });

  it("formata minutos, dias, meses e anos", () => {
    expect(fmtRelativo(AGORA - 60 * 1000, AGORA)).toBe("há 1 min");
    expect(fmtRelativo(AGORA - 2 * 24 * 60 * 60 * 1000, AGORA)).toBe("há 2 dias");
    expect(fmtRelativo(AGORA - 30 * 24 * 60 * 60 * 1000, AGORA)).toBe("há 1 mês");
    expect(fmtRelativo(AGORA - 365 * 24 * 60 * 60 * 1000, AGORA)).toBe("há 1 ano");
  });
});

describe("fmtRelativo com data do Supabase", () => {
  const agora = Date.parse("2026-08-19T15:00:00.000Z");

  it("aceita texto ISO, não só número", () => {
    // `organization_members.joined_at` chega como texto do Postgres. Antes
    // disto a tela de Equipe mostrava "há NaN anos".
    expect(fmtRelativo("2026-08-19T12:00:00.000Z", agora)).toBe("há 3 h");
  });

  it("segue aceitando número em milissegundos", () => {
    expect(fmtRelativo(agora - 2 * 60 * 60 * 1000, agora)).toBe("há 2 h");
  });

  it("data ilegível vira travessão, não NaN", () => {
    expect(fmtRelativo("nem data isso é", agora)).toBe("—");
    expect(fmtRelativo(null, agora)).toBe("—");
  });
});
