import { describe, expect, it } from "vitest";
import { agendaInternals } from "./Agenda";

describe("regras de exibição da Agenda", () => {
  it("calcula a segunda-feira como início da semana", () => {
    const segunda = agendaInternals.inicioDaSemana(new Date(2026, 7, 19, 15));
    expect(segunda.getDay()).toBe(1);
    expect(agendaInternals.chaveDia(segunda)).toBe("2026-08-17");
  });

  it("preserva o horário local ao transformar o formulário em ISO", () => {
    const iso = agendaInternals.isoLocal("2026-08-21", "09:30");
    const data = new Date(iso);
    expect(data.getFullYear()).toBe(2026);
    expect(data.getMonth()).toBe(7);
    expect(data.getDate()).toBe(21);
    expect(data.getHours()).toBe(9);
    expect(data.getMinutes()).toBe(30);
  });

  it("abre um evento como formulário editável", () => {
    expect(agendaInternals.eventoParaFormulario({
      titulo: "Reunião",
      descricao: "Pauta",
      inicio: "2026-08-21T12:00:00.000Z",
      fim: "2026-08-21T13:00:00.000Z",
      tipo: "block",
      visibilidade: "personal",
    })).toMatchObject({ titulo: "Reunião", descricao: "Pauta", tipo: "block", visibilidade: "personal" });
  });
});
