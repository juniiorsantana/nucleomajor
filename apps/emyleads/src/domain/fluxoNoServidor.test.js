import { describe, expect, it } from "vitest";
import { problemaParaOServidor } from "./fluxoNoServidor.js";

const VIP = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";

/** Um fluxo com tudo o que o v3 tem: condição, convergência, IA com retorno e encerrar. */
function fluxo() {
  return {
    condicoes: [{ tipo: "primeira_conversa" }],
    passos: [
      { id: "cond", tipo: "condicao", expressao: { operador: "ou", itens: [{ tipo: "tem_etiqueta", etiquetaId: VIP }] } },
      { id: "vip", tipo: "enviar_mensagem", texto: "Olá, cliente VIP!" },
      { id: "tag", tipo: "editar_etiquetas", adicionar: [LEAD], remover: [] },
      { id: "ia", tipo: "transferir", destino: "ia", alvoIa: "reception", objetivoIa: "Descobrir o que o contato quer" },
      { id: "fim", tipo: "encerrar" },
      { id: "gente", tipo: "transferir", destino: "humano", motivo: "" },
    ],
    canvas: {
      versao: 3,
      nos: [],
      conexoes: [
        { source: "entrada", saida: "padrao", target: "condicoes" },
        { source: "condicoes", saida: "padrao", target: "cond" },
        { source: "cond", saida: "sim", target: "vip" },
        { source: "cond", saida: "nao", target: "tag" },
        { source: "vip", saida: "padrao", target: "ia" },
        { source: "tag", saida: "padrao", target: "ia" },
        { source: "ia", saida: "sucesso", target: "fim" },
        { source: "ia", saida: "falha", target: "gente" },
      ],
    },
  };
}

const com = (mudar) => {
  const definicao = fluxo();
  mudar(definicao);
  return problemaParaOServidor(definicao);
};
const passo = (definicao, id) => definicao.passos.find((item) => item.id === id);

describe("o que o servidor exige de um fluxo v3", () => {
  it("aceita bifurcação, convergência, IA com as duas saídas e encerrar", () => {
    expect(problemaParaOServidor(fluxo())).toBeNull();
  });

  it("recusa o que não é v3", () => {
    expect(com((d) => { d.canvas.versao = 2; })).toMatch(/formato com caminhos/);
  });

  it("exige ao menos uma regra de entrada, como o banco", () => {
    expect(com((d) => { d.condicoes = []; })).toMatch(/“Condições” precisa de ao menos uma regra/);
  });

  it("exige o objetivo da IA, sem o qual o banco recusa a transferência", () => {
    expect(com((d) => { passo(d, "ia").objetivoIa = "  "; })).toMatch(/o que a IA precisa conseguir/);
    expect(com((d) => { passo(d, "ia").objetivoIa = "x".repeat(2001); })).toMatch(/passa de 2000/);
  });

  it("exige habilidade ou campanha com identificador de verdade", () => {
    expect(com((d) => { Object.assign(passo(d, "ia"), { alvoIa: "skill", skillId: null }); })).toMatch(/habilidade/);
    expect(com((d) => { Object.assign(passo(d, "ia"), { alvoIa: "campaign", campanhaId: "abc" }); })).toMatch(/campanha/);
  });

  it("recusa mensagem vazia e mensagem longa demais", () => {
    expect(com((d) => { passo(d, "vip").texto = " "; })).toMatch(/Escreva a mensagem/);
    expect(com((d) => { passo(d, "vip").texto = "x".repeat(4001); })).toMatch(/4000/);
  });

  it("recusa etiqueta que não é da empresa (id que o banco não reconhece)", () => {
    expect(com((d) => { passo(d, "tag").adicionar = ["tag-local"]; })).toMatch(/ainda não foi salva/);
    expect(com((d) => { passo(d, "cond").expressao.itens[0].etiquetaId = ""; })).toMatch(/escolha a etiqueta/);
  });

  it("recusa grupo vazio e operador desconhecido na condição", () => {
    expect(com((d) => { passo(d, "cond").expressao.itens = []; })).toMatch(/ao menos uma regra/);
    expect(com((d) => { passo(d, "cond").expressao.operador = "xor"; })).toMatch(/grupo sem/);
  });

  it("recusa saída sem destino, dizendo qual", () => {
    expect(com((d) => {
      d.canvas.conexoes = d.canvas.conexoes.filter((c) => !(c.source === "ia" && c.saida === "falha"));
      d.passos = d.passos.filter((p) => p.id !== "gente");
    })).toMatch(/saída “Falha”/);
  });

  it("recusa conexão saindo de bloco que encerra", () => {
    expect(com((d) => { d.canvas.conexoes.push({ source: "fim", saida: "padrao", target: "gente" }); }))
      .toMatch(/encerra o fluxo/);
  });

  it("recusa bloco solto", () => {
    expect(com((d) => { d.passos.push({ id: "solto", tipo: "encerrar" }); })).toMatch(/não recebe nenhuma conexão/);
  });

  it("recusa ciclo", () => {
    expect(com((d) => {
      d.canvas.conexoes = d.canvas.conexoes.map((c) => c.source === "tag" ? { ...c, target: "cond" } : c);
    })).toMatch(/voltar para um bloco anterior/);
  });

  it("recusa identificador de bloco que o banco não aceita", () => {
    expect(com((d) => { d.passos[0].id = "com espaço"; })).toMatch(/identificação inválida/);
  });

  it("recusa conexão para Condições que não venha de Nova mensagem", () => {
    expect(com((d) => { d.canvas.conexoes.push({ source: "vip", saida: "padrao", target: "condicoes" }); }))
      .toMatch(/conexão inválida/);
  });
});
