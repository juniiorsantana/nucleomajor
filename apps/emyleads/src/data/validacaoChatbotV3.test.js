import { describe, expect, it } from "vitest";
import { validarChatbot } from "./validacao";

const no = (id, x) => ({ id, x, y: 0 });
const ligar = (source, target, saida = "padrao") => ({ source, saida, target });

const chatbotV3 = (expressao) => ({
  id: "bot-v3",
  nome: "Fluxo ramificado",
  ativo: true,
  condicoes: [{ tipo: "primeira_conversa" }],
  passos: [
    { id: "decisao", tipo: "condicao", expressao },
    { id: "sim", tipo: "enviar_mensagem", texto: "Atende" },
    { id: "nao", tipo: "enviar_mensagem", texto: "Não atende" },
    { id: "fim", tipo: "encerrar" },
  ],
  canvas: {
    versao: 3,
    nos: ["entrada", "condicoes", "decisao", "sim", "nao", "fim"].map(no),
    conexoes: [
      ligar("entrada", "condicoes"),
      ligar("condicoes", "decisao"),
      ligar("decisao", "sim", "sim"),
      ligar("decisao", "nao", "nao"),
      ligar("sim", "fim"),
      ligar("nao", "fim"),
    ],
  },
  execucoes: 0,
  ultimaExecucaoEm: null,
  criadoEm: 1,
  atualizadoEm: 1,
});

describe("validação do documento de fluxo v3", () => {
  it("aceita expressão E/OU aninhada e convergência", () => {
    const chatbot = chatbotV3({
      operador: "e",
      itens: [
        { tipo: "primeira_conversa" },
        { operador: "ou", itens: [{ tipo: "tarefa_atrasada" }, { tipo: "sem_interacao_ha", dias: 7 }] },
      ],
    });

    expect(validarChatbot(chatbot)).toBe(chatbot);
  });

  it("recusa grupo vazio", () => {
    expect(() => validarChatbot(chatbotV3({ operador: "e", itens: [] }))).toThrow(/expressão/i);
  });

  it("recusa operador desconhecido", () => {
    expect(() => validarChatbot(chatbotV3({ operador: "xor", itens: [{ tipo: "primeira_conversa" }] }))).toThrow(/operador/i);
  });

  it("recusa v3 sem uma das portas da condição", () => {
    const chatbot = chatbotV3([{ tipo: "primeira_conversa" }]);
    chatbot.canvas.conexoes = chatbot.canvas.conexoes.filter(
      (conexao) => !(conexao.source === "decisao" && conexao.saida === "nao")
    );

    expect(() => validarChatbot(chatbot)).toThrow(/saída.*não/i);
  });
});
