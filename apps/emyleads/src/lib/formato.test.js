import { describe, expect, it } from "vitest";
import { fmtDiaDaConversa, fmtHoraDaLista, fmtRelativo } from "./formato";

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

/*
 * As duas escalas da tela de Conversas. Os instantes são montados em hora
 * local, e não com texto ISO fixo, porque o que se afirma aqui — "é hoje", "é
 * ontem" — é sobre o dia do calendário de quem lê. Um ISO com fuso cravado
 * passaria aqui e falharia numa máquina de CI em outro fuso.
 */
const QUARTA = new Date(2026, 8, 2, 15, 0).getTime();
const emPonto = (...partes) => new Date(...partes).getTime();

describe("fmtHoraDaLista", () => {
  it("hoje é a hora, ontem é palavra", () => {
    expect(fmtHoraDaLista(emPonto(2026, 8, 2, 9, 41), QUARTA)).toBe("09:41");
    expect(fmtHoraDaLista(emPonto(2026, 8, 1, 22, 0), QUARTA)).toBe("ontem");
  });

  it("dentro da semana é o dia, sem o ponto que o pt-BR põe", () => {
    const domingo = fmtHoraDaLista(emPonto(2026, 7, 30, 10, 0), QUARTA);
    expect(domingo).not.toContain(".");
    // A coluna tem 336px e disputa espaço com o nome e o contador de não lidas.
    expect(domingo).toMatch(/^\p{L}{3}$/u);
  });

  it("mais velho que a semana é data curta, sem o ano", () => {
    expect(fmtHoraDaLista(emPonto(2026, 7, 23, 10, 0), QUARTA)).toBe("23/08");
  });

  it("aceita o texto ISO que vem do Postgres, e vazio não vira NaN", () => {
    const hoje = new Date(2026, 8, 2, 9, 41).toISOString();
    expect(fmtHoraDaLista(hoje, QUARTA)).toBe("09:41");
    expect(fmtHoraDaLista(null, QUARTA)).toBe("");
    expect(fmtHoraDaLista("nem data isso é", QUARTA)).toBe("");
  });
});

describe("fmtDiaDaConversa", () => {
  it("é rótulo, e por isso vem em maiúsculas", () => {
    expect(fmtDiaDaConversa(emPonto(2026, 8, 2, 9, 41), QUARTA)).toBe("HOJE");
    expect(fmtDiaDaConversa(emPonto(2026, 8, 1, 23, 59), QUARTA)).toBe("ONTEM");
  });

  it("fora dos dois últimos dias mostra dia e mês", () => {
    // Sem o ano: o espelho guarda 90 dias, então o mais longe que a pílula
    // chega é a virada do ano, e ali o mês já resolve.
    expect(fmtDiaDaConversa(emPonto(2026, 4, 12, 10, 0), QUARTA)).toBe("12/05");
    expect(fmtDiaDaConversa(null, QUARTA)).toBe("");
  });
});
