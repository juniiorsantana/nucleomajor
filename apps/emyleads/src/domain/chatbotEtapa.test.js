import { describe, expect, it } from "vitest";
import { destinoDaEtapa, planoDaEtapa } from "./chatbotRuntime.js";

describe("contrato de uma etapa do runtime", () => {
  it("separa mensagens e lê as etiquetas atuais na decisão seguinte", () => {
    expect(planoDaEtapa({ tipo: "enviar_mensagem", texto: "Primeira" }, {}))
      .toEqual({ action: "message", text: "Primeira", output: "padrao" });
    expect(planoDaEtapa({ tipo: "editar_etiquetas", adicionar: ["vip"], remover: [] }, {}))
      .toEqual({ action: "tags", output: "padrao" });
    const passo = { tipo: "condicao", expressao: { operador: "e", itens: [
      { tipo: "tem_etiqueta", etiquetaId: "vip" },
      { operador: "ou", itens: [{ tipo: "primeira_conversa" }, { tipo: "tarefa_atrasada" }] },
    ] } };
    const contexto = { contato: { tags: ["vip"] }, eventos: [{ tipo: "contact.created" }] };
    expect(planoDaEtapa(passo, contexto)).toEqual({ action: "condition", output: "sim" });
    expect(planoDaEtapa(passo, { ...contexto, contato: { tags: [] } }).output).toBe("nao");
    expect(planoDaEtapa({ tipo: "enviar_mensagem", texto: "Segunda" }, contexto).text).toBe("Segunda");
  });

  it("suspende IA e trata humano e encerramento como terminais", () => {
    expect(planoDaEtapa({ tipo: "transferir", destino: "ia" }, {})).toEqual({ action: "suspend" });
    expect(planoDaEtapa({ tipo: "transferir", destino: "humano" }, {})).toEqual({ action: "human" });
    expect(planoDaEtapa({ tipo: "encerrar" }, {})).toEqual({ action: "end" });
    expect(() => planoDaEtapa({ tipo: "transferir", destino: "outro" }, {})).toThrow();
    expect(() => planoDaEtapa({ tipo: "enviar_mensagem", texto: " " }, {})).toThrow();
  });

  it("resolve apenas a porta confirmada, incluindo convergência", () => {
    const definicao = { canvas: { versao: 3, conexoes: [
      { source: "if", saida: "sim", target: "a" }, { source: "if", saida: "nao", target: "b" },
      { source: "a", saida: "padrao", target: "fim" }, { source: "b", saida: "padrao", target: "fim" },
    ] } };
    expect(destinoDaEtapa(definicao, "if", "sim")).toBe("a");
    expect(destinoDaEtapa(definicao, "if", "nao")).toBe("b");
    expect(destinoDaEtapa(definicao, "a", "padrao")).toBe("fim");
    expect(destinoDaEtapa(definicao, "b", "padrao")).toBe("fim");
    expect(() => destinoDaEtapa(definicao, "if", "padrao")).toThrow();
  });
});
