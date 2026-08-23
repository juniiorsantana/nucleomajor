import { describe, expect, it } from "vitest";
import { NO_CONDICOES, NO_ENTRADA, SAIDA_PADRAO, topologiaDe } from "./chatbotGrafo";
import { assinaturaContexto, ordenarChatbots, planoDosPassos } from "./chatbotRuntime";

const ligar = (source, target) => ({ source, saida: SAIDA_PADRAO, target });

const bot = (passos, canvas) => ({ id: "bot", passos, ...(canvas ? { canvas } : {}) });
const contato = (tags = []) => ({ id: "c1", tags });

const msg = (id, texto = "Olá") => ({ id, tipo: "enviar_mensagem", texto });
const tag = (id, adicionar = [], remover = []) => ({ id, tipo: "editar_etiquetas", adicionar, remover });
const transferir = (id, destino = "ia", motivo = "") => ({ id, tipo: "transferir", destino, motivo });

describe("plano de execução", () => {
  it("para na primeira mensagem e guarda o resto", () => {
    const plano = planoDosPassos(bot([msg("m1"), tag("t1", ["quente"])]), contato());
    expect(plano.mensagem).toBe("Olá");
    expect(plano.etiquetas).toEqual([]);
    expect(plano.restantes.map((p) => p.id)).toEqual(["t1"]);
  });

  it("acumula as etiquetas que vêm antes da mensagem", () => {
    const plano = planoDosPassos(
      bot([tag("t1", ["quente"]), tag("t2", ["vip"], ["frio"]), msg("m1")]),
      contato(["frio"])
    );
    expect(plano.etiquetas.sort()).toEqual(["frio", "quente", "vip"]);
    expect(plano.tagsFinais.sort()).toEqual(["quente", "vip"]);
    expect(plano.mensagem).toBe("Olá");
  });

  it("não conta como alterada uma etiqueta que o contato já tinha", () => {
    const plano = planoDosPassos(bot([tag("t1", ["quente"]), msg("m1")]), contato(["quente"]));
    expect(plano.etiquetas).toEqual([]);
    expect(plano.tagsFinais).toEqual(["quente"]);
  });

  it("colhe a transferência que vem DEPOIS da mensagem", () => {
    // O fluxo natural é "manda a saudação e passa para a IA". Como a execução
    // para na primeira mensagem, um bloco de transferência abaixo dela nunca
    // rodaria — e o bot ficaria mudo para sempre depois da saudação.
    const plano = planoDosPassos(bot([msg("m1"), transferir("x", "ia", "quer orçamento")]), contato());
    expect(plano.mensagem).toBe("Olá");
    expect(plano.transferencia).toEqual({ destino: "ia", motivo: "quer orçamento" });
  });

  it("transferência antes da mensagem encerra o plano sem falar nada", () => {
    const plano = planoDosPassos(bot([transferir("x", "humano"), msg("m1")]), contato());
    expect(plano.mensagem).toBeNull();
    expect(plano.transferencia).toEqual({ destino: "humano", motivo: "" });
  });

  it("vale a PRIMEIRA transferência do caminho, não a última", () => {
    // Dois blocos desses são contraditórios, e obedecer ao último faria a ordem
    // no canvas significar o contrário do que ela parece.
    const plano = planoDosPassos(
      bot([msg("m1"), transferir("x", "ia"), transferir("y", "humano")]),
      contato()
    );
    expect(plano.transferencia.destino).toBe("ia");
  });

  it("fluxo sem mensagem nenhuma não manda nada", () => {
    const plano = planoDosPassos(bot([tag("t1", ["quente"])]), contato());
    expect(plano.mensagem).toBeNull();
    expect(plano.etiquetas).toEqual(["quente"]);
  });
});

describe("a ordem vem do grafo", () => {
  it("obedece às conexões, não à posição no array", () => {
    // O array diz mensagem→etiqueta; o grafo diz etiqueta→mensagem. Quem manda
    // é o grafo: por isso a etiqueta é aplicada antes de a execução parar.
    const canvas = {
      versao: 2,
      nos: [],
      conexoes: [ligar(NO_ENTRADA, NO_CONDICOES), ligar(NO_CONDICOES, "t1"), ligar("t1", "m1")],
    };
    const plano = planoDosPassos(bot([msg("m1"), tag("t1", ["quente"])], canvas), contato());
    expect(plano.etiquetas).toEqual(["quente"]);
    expect(plano.mensagem).toBe("Olá");
  });

  it("um chatbot sem canvas é linear, e dá o mesmo plano de sempre", () => {
    // A equivalência que sustenta a migração: enquanto nada ramifica, o grafo
    // derivado do array produz exatamente o caminho do array.
    const passos = [tag("t1", ["quente"]), msg("m1"), tag("t2", ["tarde"])];
    const semCanvas = planoDosPassos(bot(passos), contato());
    const comCanvas = planoDosPassos(
      bot(passos, { versao: 2, nos: [], conexoes: topologiaDe(passos) }),
      contato()
    );
    expect(semCanvas).toEqual(comCanvas);
  });

  it("ignora um bloco que ficou solto no array e fora do caminho", () => {
    const canvas = {
      versao: 2,
      nos: [],
      conexoes: [ligar(NO_ENTRADA, NO_CONDICOES), ligar(NO_CONDICOES, "m1")],
    };
    const plano = planoDosPassos(bot([msg("m1"), tag("solto", ["nunca"])], canvas), contato());
    expect(plano.mensagem).toBe("Olá");
    expect(plano.restantes).toEqual([]);
  });
});

describe("assinatura do contexto", () => {
  const ficha = (extra = {}) => ({
    contato: { id: "c1", tags: [], atualizadoEm: 1 },
    negocios: [],
    tarefas: [],
    notas: [],
    eventos: [],
    ...extra,
  });

  it("muda quando o canvas é religado, mesmo com os passos intactos", () => {
    // Desde a v2 a ordem vem do grafo. Uma assinatura cega para topologia
    // deixaria passar uma preparação feita sob um fluxo que já não existe.
    const passos = [msg("m1"), tag("t1", ["quente"])];
    const antes = { id: "b", ativo: true, condicoes: [], passos, atualizadoEm: 1 };
    const depois = {
      ...antes,
      canvas: {
        versao: 2,
        nos: [],
        conexoes: [ligar(NO_ENTRADA, NO_CONDICOES), ligar(NO_CONDICOES, "t1"), ligar("t1", "m1")],
      },
    };
    expect(assinaturaContexto(antes, ficha())).not.toBe(assinaturaContexto(depois, ficha()));
  });

  it("não muda quando nada relevante mudou", () => {
    const b = { id: "b", ativo: true, condicoes: [], passos: [msg("m1")], atualizadoEm: 1 };
    expect(assinaturaContexto(b, ficha())).toBe(assinaturaContexto({ ...b }, ficha()));
  });
});

describe("ordem de avaliação dos chatbots", () => {
  it("o mais antigo vence, e o id desempata", () => {
    const bots = [
      { id: "z", criadoEm: 2 },
      { id: "a", criadoEm: 1 },
      { id: "b", criadoEm: 1 },
    ];
    expect(ordenarChatbots(bots).map((b) => b.id)).toEqual(["a", "b", "z"]);
  });

  it("não mexe no array de quem chamou", () => {
    const bots = [{ id: "z", criadoEm: 2 }, { id: "a", criadoEm: 1 }];
    ordenarChatbots(bots);
    expect(bots.map((b) => b.id)).toEqual(["z", "a"]);
  });
});
