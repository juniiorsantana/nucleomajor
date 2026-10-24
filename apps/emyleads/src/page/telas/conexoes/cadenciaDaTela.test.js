import { describe, expect, it } from "vitest";
import {
  AVISO_MINIMO_MS,
  CARTAO_FUNDO_MS,
  CARTAO_PAREANDO_MS,
  avisoPedeReleitura,
  cadenciaDoCartao,
  precisaPerguntarAoGateway,
} from "./cadenciaDaTela";

describe("cadenciaDoCartao", () => {
  it("é rápida só com alguém pareando", () => {
    expect(cadenciaDoCartao(true)).toBe(CARTAO_PAREANDO_MS);
    expect(cadenciaDoCartao(false)).toBe(CARTAO_FUNDO_MS);
  });
});

describe("avisoPedeReleitura", () => {
  it("ignora tópicos que não mexem no cartão", () => {
    for (const topico of ["conversas", "operators", "handoffs", "intelligence"]) {
      expect(avisoPedeReleitura({ topico, ultimaLeitura: 0, agora: 1e9 })).toBe(false);
    }
  });

  it("fora do pareamento, segura o aviso que chega logo depois de uma leitura", () => {
    const agora = 1_000_000;
    expect(avisoPedeReleitura({ topico: "connections", ultimaLeitura: agora - 3000, agora })).toBe(false);
    expect(avisoPedeReleitura({ topico: "connections", ultimaLeitura: agora - AVISO_MINIMO_MS, agora })).toBe(true);
  });

  it("pareando, todo aviso de conexão relê", () => {
    const agora = 1_000_000;
    expect(avisoPedeReleitura({ topico: "connections", alguemPareando: true, ultimaLeitura: agora, agora })).toBe(true);
  });
});

describe("precisaPerguntarAoGateway", () => {
  it("só com o gateway local respondendo", () => {
    expect(precisaPerguntarAoGateway({ gateway: "online" })).toBe(true);
    for (const gateway of ["cloud", "remote", "offline", "nao-vinculado", "nao-autorizado"]) {
      expect(precisaPerguntarAoGateway({ gateway })).toBe(false);
    }
    expect(precisaPerguntarAoGateway(null)).toBe(false);
  });
});
