import { describe, expect, it } from "vitest";
import { normalizarErroAgenda } from "./agendaErrors";

describe("erros explicáveis da agenda", () => {
  it("distingue sobreposição de uma falha genérica", () => {
    expect(normalizarErroAgenda({ code: "23P01", message: "conflicting key value violates exclusion constraint" }))
      .toEqual(expect.objectContaining({ codigo: "agenda-conflito" }));
  });

  it("distingue falta de permissão", () => {
    expect(normalizarErroAgenda({ code: "42501", message: "new row violates row-level security policy" }))
      .toEqual(expect.objectContaining({ codigo: "agenda-sem-permissao" }));
  });

  it("preserva uma mensagem desconhecida", () => {
    expect(normalizarErroAgenda({ message: "Falha temporária" }, "agenda-teste"))
      .toEqual({ codigo: "agenda-teste", mensagem: "Falha temporária" });
  });
});

