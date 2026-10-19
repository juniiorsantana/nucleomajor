import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { criarGrafoInicial } from "../page/telas/chatbotFlow.js";
import { converterParaV3, efeitosDoLinear, efeitosDoV3Linear, ID_DO_FIM_CONVERTIDO } from "./conversaoV3.js";
import { problemaParaOServidor } from "./fluxoNoServidor.js";

const CASOS = JSON.parse(readFileSync(new URL("./casosDeConversaoV3.json", import.meta.url), "utf8"));

describe("a conversão v2 → v3 (Etapa 11)", () => {
  for (const caso of CASOS) {
    it(caso.nome, () => {
      const resultado = converterParaV3(caso.definicao, { recursos: caso.recursos || null });
      expect(resultado.estado, resultado.detalhe).toBe(caso.esperado);
      if (caso.motivo) expect(resultado.motivo).toBe(caso.motivo);
      if (resultado.estado === "convertido") {
        // O banco aceitaria, e o executor novo faz o mesmo que o linear fazia.
        expect(problemaParaOServidor(resultado.definicao)).toBeNull();
        expect(efeitosDoV3Linear(resultado.definicao)).toEqual(efeitosDoLinear(caso.definicao));
        // Idempotente: converter de novo não muda nada.
        expect(converterParaV3(resultado.definicao).estado).toBe("ja_v3");
      }
    });
  }

  it("guarda as condições, o gatilho e as posições do mapa", () => {
    const caso = CASOS.find((item) => item.nome.includes("Teste do construtor") && item.esperado === "convertido");
    const { definicao } = converterParaV3(caso.definicao);
    expect(definicao.condicoes).toEqual(caso.definicao.condicoes);
    expect(definicao.gatilho).toEqual(caso.definicao.gatilho);
    expect(definicao.canvas.nos).toEqual(caso.definicao.canvas.nos);
    expect(definicao.canvas.versao).toBe(3);
  });

  it("o fim solto vira um Encerrar ligado ao último bloco", () => {
    const caso = CASOS.find((item) => item.nome.startsWith("fim solto"));
    const { definicao } = converterParaV3(caso.definicao);
    expect(definicao.passos.at(-1)).toEqual({ id: ID_DO_FIM_CONVERTIDO, tipo: "encerrar" });
    expect(definicao.canvas.conexoes).toContainEqual({ source: "oi", saida: "padrao", target: ID_DO_FIM_CONVERTIDO });
    expect(definicao.canvas.nos.find((no) => no.id === ID_DO_FIM_CONVERTIDO)).toMatchObject({ x: 1212 });
  });

  it("o editor abre o v2 com as mesmas ligações da conversão", () => {
    const passos = [
      { id: "ia", tipo: "transferir", destino: "ia", retornoPassoId: "fim", falhaPassoId: "equipe" },
      { id: "fim", tipo: "encerrar" },
      { id: "equipe", tipo: "transferir", destino: "humano" },
    ];
    const { conexoes } = criarGrafoInicial(passos, null, { ramificado: true });
    expect(conexoes.map(({ source, saida, target }) => `${source}:${saida}:${target}`)).toEqual(
      expect.arrayContaining(["ia:sucesso:fim", "ia:falha:equipe"]),
    );
  });
});
