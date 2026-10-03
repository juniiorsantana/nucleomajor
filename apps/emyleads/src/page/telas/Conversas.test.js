import { describe, expect, it } from "vitest";
import { ordenarPorMensagemMaisRecente, passaFiltro } from "./Conversas";

describe("lista de conversas", () => {
  it("coloca no topo a conversa que recebeu a mensagem mais recente", () => {
    const conversas = [
      { id: "antiga", ultimaMensagemEm: 10 },
      { id: "nova", ultimaMensagemEm: 30 },
      { id: "intermediaria", ultimaMensagemEm: 20 },
    ];

    expect(ordenarPorMensagemMaisRecente(conversas).map((item) => item.id)).toEqual([
      "nova",
      "intermediaria",
      "antiga",
    ]);
    expect(conversas[0].id).toBe("antiga");
  });

  it("não mistura grupos nos filtros de atendimento", () => {
    expect(passaFiltro({ grupo: true, dono: "bot", naoLidas: 0 }, "bot")).toBe(false);
    expect(passaFiltro({ grupo: false, dono: "bot", naoLidas: 0 }, "bot")).toBe(true);
  });

  it("'Precisa de você' é não lida com gente no atendimento, e só ela", () => {
    expect(passaFiltro({ grupo: false, dono: "humano", naoLidas: 2 }, "precisa")).toBe(true);
    // a IA e o fluxo respondem as deles
    expect(passaFiltro({ grupo: false, dono: "ia", naoLidas: 2 }, "precisa")).toBe(false);
    expect(passaFiltro({ grupo: false, dono: "bot", naoLidas: 2 }, "precisa")).toBe(false);
    // lida não espera ninguém; grupo não tem atendimento
    expect(passaFiltro({ grupo: false, dono: "humano", naoLidas: 0 }, "precisa")).toBe(false);
    expect(passaFiltro({ grupo: true, dono: "humano", naoLidas: 5 }, "precisa")).toBe(false);
  });
});
