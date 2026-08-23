import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  chatbotsPadrao,
  criarPasso,
  DESTINOS_TRANSFERENCIA,
  ehTransferencia,
  TIPOS_PASSO,
} from "./chatbots";
import { TIPOS_CONDICAO } from "./regras";

describe("domínio de chatbots", () => {
  it("cria a semente com ids e datas determinísticas", () => {
    const bots = chatbotsPadrao(123);
    expect(bots).toHaveLength(1);
    expect(bots[0]).toMatchObject({ id: "boas-vindas-primeira", criadoEm: 123, atualizadoEm: 123 });
    expect(bots[0].condicoes).toEqual([{ tipo: TIPOS_CONDICAO.primeiraConversa }]);
    expect(bots[0].passos[0]).toMatchObject({ tipo: TIPOS_PASSO.enviarMensagem, id: "boas-vindas-mensagem" });
  });

  it("cria passos com ids distintos", () => {
    const a = criarPasso(TIPOS_PASSO.enviarMensagem);
    const b = criarPasso(TIPOS_PASSO.editarEtiquetas);
    expect(a.id).not.toBe(b.id);
  });
});

describe("bloco de transferência", () => {
  it("nasce entregando para humano", () => {
    // Transferir para uma pessoa é sempre seguro; passar para a IA é que
    // precisa ser uma escolha.
    const passo = criarPasso(TIPOS_PASSO.transferir);
    expect(passo).toMatchObject({
      tipo: "transferir",
      destino: DESTINOS_TRANSFERENCIA.humano,
      motivo: "",
    });
    expect(passo.id).toBeTruthy();
  });

  it("aceita o destino e o motivo informados", () => {
    const passo = criarPasso(TIPOS_PASSO.transferir, {
      destino: DESTINOS_TRANSFERENCIA.ia,
      motivo: "orçamento",
    });
    expect(passo).toMatchObject({ destino: "ia", motivo: "orçamento" });
  });

  it("reconhece um passo de transferência", () => {
    expect(ehTransferencia(criarPasso(TIPOS_PASSO.transferir))).toBe(true);
    expect(ehTransferencia(criarPasso(TIPOS_PASSO.enviarMensagem))).toBe(false);
    expect(ehTransferencia(null)).toBe(false);
  });
});
