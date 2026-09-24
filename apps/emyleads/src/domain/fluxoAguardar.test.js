import { describe, expect, it } from "vitest";
import { MAXIMO_DE_ESPERAS, TIPOS_PASSO, criarPasso, rotuloDaSaida, saidasDoPasso, textoDaEspera } from "./chatbots.js";
import { problemaParaOServidor } from "./fluxoNoServidor.js";

/** O follow-up: cobra, espera; respondeu vai para a equipe, sem resposta encerra. */
function followUp(espera = {}) {
  return {
    gatilho: { tipo: "manual" },
    condicoes: [{ tipo: "primeira_conversa" }],
    passos: [
      { id: "cobra", tipo: "enviar_mensagem", texto: "Conseguiu ver a proposta?" },
      { id: "espera", tipo: "aguardar", duracao: 24, unidade: "horas", ...espera },
      { id: "gente", tipo: "transferir", destino: "humano", motivo: "" },
      { id: "fim", tipo: "encerrar" },
    ],
    canvas: {
      versao: 3,
      nos: [],
      conexoes: [
        { source: "entrada", saida: "padrao", target: "condicoes" },
        { source: "condicoes", saida: "padrao", target: "cobra" },
        { source: "cobra", saida: "padrao", target: "espera" },
        { source: "espera", saida: "respondeu", target: "gente" },
        { source: "espera", saida: "sem_resposta", target: "fim" },
      ],
    },
  };
}

describe("bloco Aguardar", () => {
  it("nasce esperando 24 horas, com as saídas Respondeu e Não respondeu", () => {
    const passo = criarPasso(TIPOS_PASSO.aguardar);
    expect(passo).toMatchObject({ tipo: "aguardar", duracao: 24, unidade: "horas" });
    expect(saidasDoPasso(passo)).toEqual(["respondeu", "sem_resposta"]);
    expect(rotuloDaSaida(passo, "respondeu")).toBe("Respondeu");
    expect(rotuloDaSaida(passo, "sem_resposta")).toBe("Não respondeu");
  });

  it("escreve o tempo por extenso", () => {
    expect(textoDaEspera({ duracao: 1, unidade: "dias" })).toBe("1 dia");
    expect(textoDaEspera({ duracao: 2, unidade: "horas" })).toBe("2 horas");
    expect(textoDaEspera({ duracao: 30, unidade: "minutos" })).toBe("30 minutos");
  });

  it("aceita o follow-up completo", () => {
    expect(problemaParaOServidor(followUp())).toBeNull();
  });

  it("recusa tempo fora da faixa de cada unidade", () => {
    expect(problemaParaOServidor(followUp({ duracao: 31, unidade: "dias" }))).toMatch(/de 1 a 30 dias/);
    expect(problemaParaOServidor(followUp({ duracao: 0 }))).toMatch(/de 1 a 720 horas/);
    expect(problemaParaOServidor(followUp({ duracao: 1.5 }))).toMatch(/de 1 a 720 horas/);
    expect(problemaParaOServidor(followUp({ unidade: "semanas" }))).toMatch(/unidade de tempo/);
  });

  it("pede o destino das duas saídas", () => {
    const semRespondeu = followUp();
    semRespondeu.canvas.conexoes = semRespondeu.canvas.conexoes.filter((c) => c.saida !== "respondeu");
    expect(problemaParaOServidor(semRespondeu)).toMatch(/“Respondeu”/);
  });

  it(`recusa mais de ${MAXIMO_DE_ESPERAS} esperas no mesmo fluxo`, () => {
    const d = followUp();
    for (let i = 0; i < MAXIMO_DE_ESPERAS; i += 1) d.passos.push({ id: `extra${i}`, tipo: "aguardar", duracao: 1, unidade: "horas" });
    expect(problemaParaOServidor(d)).toMatch(/passa de 10 blocos “Aguardar”/);
  });
});
