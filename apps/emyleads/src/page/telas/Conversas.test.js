import { describe, expect, it } from "vitest";
import { comRascunho, ordenarPorMensagemMaisRecente, passaFiltro } from "./Conversas";

describe("rascunho por conversa", () => {
  it("o texto escrito para uma conversa não aparece na outra", () => {
    const rascunhos = comRascunho({}, "org:A", "oi, A");
    expect(rascunhos["org:A"]).toBe("oi, A");
    expect(rascunhos["org:B"]).toBeUndefined();
    // a mesma conversa noutra empresa também é outra caixa
    expect(rascunhos["outra:A"]).toBeUndefined();
  });

  it("o envio que falha devolve o texto à conversa de origem sem atropelar o novo", () => {
    let rascunhos = comRascunho({}, "org:B", "já escrevendo para B");
    rascunhos = comRascunho(rascunhos, "org:A", (agora) => agora || "o que falhou");
    rascunhos = comRascunho(rascunhos, "org:B", (agora) => agora || "o que falhou");
    expect(rascunhos).toEqual({ "org:A": "o que falhou", "org:B": "já escrevendo para B" });
  });

  it("rascunho vazio sai do mapa e não muda o que não mudou", () => {
    const rascunhos = { "org:A": "oi" };
    expect(comRascunho(rascunhos, "org:A", "")).toEqual({});
    expect(comRascunho(rascunhos, "org:A", "oi")).toBe(rascunhos);
    expect(comRascunho({}, "org:A", "")).toEqual({});
  });
});

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
