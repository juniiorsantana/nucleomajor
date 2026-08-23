import { describe, expect, it } from "vitest";
import { adicionarDias, intervaloDaVisao, segmentosDoDia, somarPorCategoria } from "./agendaUtils";

const evento = (id, inicio, fim, extras = {}) => ({
  id,
  sourceType: "event",
  titulo: id,
  inicio,
  fim,
  diaInteiro: false,
  categoryName: "Reunião",
  categoryColor: "#FB923C",
  ...extras,
});

describe("matemática da régua da agenda", () => {
  it("posiciona eventos sobrepostos em colunas distintas", () => {
    const dia = new Date(2026, 7, 21);
    const segmentos = segmentosDoDia([
      evento("a", new Date(2026, 7, 21, 9).toISOString(), new Date(2026, 7, 21, 11).toISOString()),
      evento("b", new Date(2026, 7, 21, 10).toISOString(), new Date(2026, 7, 21, 12).toISOString()),
      evento("c", new Date(2026, 7, 21, 13).toISOString(), new Date(2026, 7, 21, 14).toISOString()),
    ], dia);
    expect(segmentos.slice(0, 2).map((item) => item.colunas)).toEqual([2, 2]);
    expect(new Set(segmentos.slice(0, 2).map((item) => item.coluna)).size).toBe(2);
    expect(segmentos[2].colunas).toBe(1);
  });

  it("recorta na virada do dia sem perder o evento", () => {
    const dia = new Date(2026, 7, 21);
    const segmentos = segmentosDoDia([
      evento("noturno", new Date(2026, 7, 20, 23, 30).toISOString(), new Date(2026, 7, 21, 1).toISOString()),
    ], dia);
    expect(segmentos).toHaveLength(1);
    expect(segmentos[0].inicioMinutos).toBe(0);
    expect(segmentos[0].fimMinutos).toBe(60);
  });

  it("monta mês com seis semanas completas", () => {
    const faixa = intervaloDaVisao("month", new Date(2026, 7, 21));
    expect((faixa.ate - faixa.de) / 86400000).toBe(42);
    expect(faixa.de.getDay()).toBe(1);
    expect(adicionarDias(faixa.de, 41) < faixa.ate).toBe(true);
  });

  it("soma horas por categoria e separa indisponibilidade privada", () => {
    const totais = somarPorCategoria([
      evento("reunião", new Date(2026, 7, 21, 9).toISOString(), new Date(2026, 7, 21, 10, 30).toISOString()),
      evento("privado", new Date(2026, 7, 21, 11).toISOString(), new Date(2026, 7, 21, 12).toISOString(), { titulo: "Indisponível" }),
    ]);
    expect(totais).toEqual(expect.arrayContaining([
      expect.objectContaining({ nome: "Reunião", minutos: 90 }),
      expect.objectContaining({ nome: "Indisponível", minutos: 60 }),
    ]));
  });
});
