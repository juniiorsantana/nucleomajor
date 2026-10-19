import { describe, expect, it } from "vitest";
import { conexoesSemFluxo, textoDoAvisoSemFluxo } from "./conexaoDoFluxo.js";

const conexao = (name, flowRuntime) => ({ connectionId: name, name, readiness: flowRuntime === undefined ? null : { flowRuntime } });

describe("a conexão que não roda fluxo", () => {
  it("só conta quem disse not_configured", () => {
    const lista = [
      conexao("Major", "online"),
      conexao("Adriani", "not_configured"),
      conexao("Antiga", null),
      conexao("Sem heartbeat"),
    ];
    expect(conexoesSemFluxo(lista).map((item) => item.name)).toEqual(["Adriani"]);
  });

  it("sem lista, nada a avisar", () => {
    expect(conexoesSemFluxo(undefined)).toEqual([]);
    expect(textoDoAvisoSemFluxo([])).toBe("");
  });

  it("o texto diz o nome de cada conexão", () => {
    expect(textoDoAvisoSemFluxo([conexao("Recepção", "not_configured")])).toBe(
      "A conexão “Recepção” não roda fluxo: os fluxos ativos não respondem nela.",
    );
    expect(textoDoAvisoSemFluxo([conexao("A"), conexao("B"), conexao("C")])).toMatch(/^As conexões “A”, “B” e “C” não rodam fluxo/);
  });
});
