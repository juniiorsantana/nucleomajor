import { describe, expect, it } from "vitest";
import {
  GATILHOS_SEM_MENSAGEM,
  TIPOS_GATILHO,
  TIPOS_PASSO,
  criarPasso,
  gatilhoDo,
  novoIdDeOpcao,
  rotuloDaSaida,
  saidasDoPasso,
} from "./chatbots.js";
import { problemaDoGatilho, problemaParaOServidor } from "./fluxoNoServidor.js";

const ETIQUETA = "11111111-1111-4111-8111-111111111111";

/** Menu de duas opções; sem entender, encerra. */
function menu() {
  return {
    condicoes: [{ tipo: "primeira_conversa" }],
    passos: [
      {
        id: "menu", tipo: "perguntar", texto: "Como posso ajudar?", tentativas: 2, prazoHoras: 24,
        opcoes: [
          { id: "agendar", rotulo: "Agendar", sinonimos: ["marcar"] },
          { id: "falar", rotulo: "Falar com alguém", sinonimos: [] },
        ],
      },
      { id: "msg", tipo: "enviar_mensagem", texto: "Anotado, {nome}." },
      { id: "fim", tipo: "encerrar" },
    ],
    canvas: {
      versao: 3,
      nos: [],
      conexoes: [
        { source: "entrada", saida: "padrao", target: "condicoes" },
        { source: "condicoes", saida: "padrao", target: "menu" },
        { source: "menu", saida: "agendar", target: "msg" },
        { source: "menu", saida: "falar", target: "fim" },
        { source: "menu", saida: "nao_resolvido", target: "fim" },
        { source: "msg", saida: "padrao", target: "fim" },
      ],
    },
  };
}

const com = (mudar) => {
  const d = menu();
  mudar(d);
  return problemaParaOServidor(d);
};

describe("blocos que perguntam", () => {
  it("a pergunta tem uma saída por opção, mais 'não entendeu'", () => {
    const passo = menu().passos[0];
    expect(saidasDoPasso(passo)).toEqual(["agendar", "falar", "nao_resolvido"]);
    expect(rotuloDaSaida(passo, "agendar")).toBe("Agendar");
    expect(rotuloDaSaida(passo, "nao_resolvido")).toBe("Não entendeu");
  });

  it("coletar tem 'respondeu' e 'não respondeu'", () => {
    const passo = criarPasso(TIPOS_PASSO.coletar);
    expect(saidasDoPasso(passo)).toEqual(["padrao", "nao_resolvido"]);
    expect(rotuloDaSaida(passo, "padrao")).toBe("Respondeu");
    expect(rotuloDaSaida(passo, "nao_resolvido")).toBe("Não respondeu");
    expect(passo).toMatchObject({ variavel: "resposta", prazoHoras: 24 });
  });

  it("o bloco novo nasce com duas opções de id aceito pelo banco", () => {
    const passo = criarPasso(TIPOS_PASSO.perguntar);
    expect(passo.opcoes).toHaveLength(2);
    for (const opcao of passo.opcoes) expect(opcao.id).toMatch(/^[a-z0-9_-]{1,40}$/);
    expect(novoIdDeOpcao()).not.toBe(novoIdDeOpcao());
  });

  it("aceita o menu completo", () => {
    expect(com(() => {})).toBeNull();
  });

  it("pede o nome de toda opção", () => {
    expect(com((d) => { d.passos[0].opcoes[1].rotulo = " "; })).toMatch(/Dê um nome a todas as opções/);
  });

  it("pede o destino de cada opção pelo nome dela", () => {
    expect(com((d) => { d.canvas.conexoes = d.canvas.conexoes.filter((c) => c.saida !== "falar"); }))
      .toMatch(/“Falar com alguém”/);
  });

  it("recusa tentativas e prazo fora da faixa", () => {
    expect(com((d) => { d.passos[0].tentativas = 6; })).toMatch(/entre 1 e 5/);
    expect(com((d) => { d.passos[0].prazoHoras = 169; })).toMatch(/entre 1 e 168/);
  });

  it("recusa variável fora do formato", () => {
    expect(com((d) => {
      d.passos[0] = { id: "menu", tipo: "coletar", texto: "Seu e-mail?", variavel: "E-mail" };
      d.canvas.conexoes = d.canvas.conexoes
        .filter((c) => c.source !== "menu")
        .concat([{ source: "menu", saida: "padrao", target: "msg" }, { source: "menu", saida: "nao_resolvido", target: "fim" }]);
    })).toMatch(/nome da variável/);
  });
});

describe("gatilho", () => {
  it("sem gatilho vale a mensagem do contato", () => {
    expect(gatilhoDo({})).toEqual({ tipo: TIPOS_GATILHO.mensagem });
    expect(problemaDoGatilho(undefined)).toBeNull();
  });

  it("só mensagem e palavra dependem do contato escrever", () => {
    expect([...GATILHOS_SEM_MENSAGEM].sort()).toEqual(["campanha", "etapa", "etiqueta", "manual"]);
  });

  it("aceita cada tipo completo", () => {
    for (const gatilho of [
      { tipo: "mensagem" },
      { tipo: "palavra", palavras: ["promoção"] },
      { tipo: "manual" },
      { tipo: "etiqueta", etiquetaId: ETIQUETA },
      { tipo: "etapa", stageId: ETIQUETA },
      { tipo: "campanha", campanhaId: ETIQUETA },
    ]) expect(com((d) => { d.gatilho = gatilho; })).toBeNull();
  });

  it("pede o que falta em cada tipo", () => {
    expect(problemaDoGatilho({ tipo: "palavra", palavras: [] })).toMatch(/ao menos uma palavra/);
    expect(problemaDoGatilho({ tipo: "etiqueta", etiquetaId: "" })).toMatch(/etiqueta/);
    expect(problemaDoGatilho({ tipo: "etapa" })).toMatch(/etapa do funil/);
    expect(problemaDoGatilho({ tipo: "campanha", campanhaId: "x" })).toMatch(/campanha/);
    expect(problemaDoGatilho({ tipo: "agenda" })).toMatch(/Escolha como o fluxo começa/);
  });
});
