import { describe, expect, it } from "vitest";
import { criarOperacoesConversas } from "./conversasMock";

const CONTATOS = [
  { id: "a", nome: "Mariana Costa", empresa: "Agro Forte", telefone: "5566996337712", ultimaEm: 200 },
  { id: "b", nome: "João Silva", empresa: "Clínica Integrar", telefone: "5565988124470", ultimaEm: 100 },
];

const criar = (contatos = CONTATOS) =>
  criarOperacoesConversas({ listarContatos: async () => contatos });

describe("conversas mockadas", () => {
  it("lista uma conversa por contato, da mais recente para a mais antiga", async () => {
    const ops = criar();
    const lista = await ops["conversas.listar"]();
    expect(lista.filter((c) => !c.grupo).map((c) => c.id)).toEqual(["a", "b"]);
    expect(lista[0].nome).toBe("Mariana Costa");
  });

  /**
   * Grupo é 56% da caixa de entrada de verdade. A bancada tem um para a lista
   * ser desenhada com o que ela realmente vai conter — e para prender as três
   * coisas que um grupo não tem: telefone, ficha e atendente.
   */
  it("a bancada tem um grupo, sem telefone, sem ficha e sem atendente", async () => {
    const ops = criar();
    const grupo = (await ops["conversas.listar"]()).find((c) => c.grupo);
    expect(grupo).toBeTruthy();
    expect(grupo.telefone).toBe("");
    expect(grupo.contactId).toBeNull();
    expect(grupo.atendenteId).toBeNull();
    expect((await ops["conversas.mensagens"]({ id: grupo.id })).length).toBeGreaterThan(0);
  });

  it("atribuir a alguém guarda quem assumiu, e devolver para a IA apaga", async () => {
    const ops = criar();
    await ops["conversas.trocarDono"]({ id: "a", dono: "humano", atendenteId: "u1" });
    let linha = (await ops["conversas.listar"]()).find((c) => c.id === "a");
    expect(linha.atendenteId).toBe("u1");

    // A identidade só vale enquanto o dono é humano — a regra do árbitro.
    await ops["conversas.trocarDono"]({ id: "a", dono: "ia" });
    linha = (await ops["conversas.listar"]()).find((c) => c.id === "a");
    expect(linha.atendenteId).toBeNull();
    expect(linha.atendenteNome).toBe("");
  });

  it("resolve {nome} e {empresa} no roteiro, e não entrega o texto cru", async () => {
    const ops = criar();
    const msgs = await ops["conversas.mensagens"]({ id: "a" });
    const texto = msgs.map((m) => m.texto).join(" ");
    expect(texto).not.toContain("{nome}");
    expect(texto).not.toContain("{empresa}");
    expect(texto).toContain("Mariana");
  });

  it("abrir a conversa zera o não lido", async () => {
    const ops = criar();
    const antes = await ops["conversas.listar"]();
    expect(antes[0].naoLidas).toBeGreaterThan(0);
    await ops["conversas.mensagens"]({ id: "a" });
    const depois = await ops["conversas.listar"]();
    expect(depois[0].naoLidas).toBe(0);
  });

  it("mensagem enviada entra na conversa e vira a prévia da lista", async () => {
    const ops = criar();
    await ops["conversas.enviar"]({ id: "b", texto: "  Combinado  " });
    const msgs = await ops["conversas.mensagens"]({ id: "b" });
    const ultima = msgs[msgs.length - 1];
    expect(ultima).toMatchObject({ tipo: "mensagem", direcao: "sai", texto: "Combinado" });
    const lista = await ops["conversas.listar"]();
    expect(lista.find((c) => c.id === "b").previa).toBe("Combinado");
  });

  it("mensagem vazia não vira bolha", async () => {
    const ops = criar();
    expect(await ops["conversas.enviar"]({ id: "b", texto: "   " })).toBeNull();
  });

  /**
   * Trocar o dono sem deixar rastro foi o que já fez um contato receber duas
   * respostas para a mesma mensagem — o evento na conversa é o registro.
   */
  it("trocar o dono muda a lista e escreve o evento na conversa", async () => {
    const ops = criar();
    await ops["conversas.trocarDono"]({ id: "a", dono: "ia" });
    const lista = await ops["conversas.listar"]();
    expect(lista.find((c) => c.id === "a").dono).toBe("ia");
    const msgs = await ops["conversas.mensagens"]({ id: "a" });
    expect(msgs.some((m) => m.tipo === "sistema" && m.dono === "ia")).toBe(true);
  });

  it("os modelos saem no formato que sortearVariacao espera", async () => {
    const ops = criar();
    const modelos = await ops["conversas.modelos"]();
    expect(modelos.length).toBeGreaterThan(0);
    for (const m of modelos) {
      expect(Array.isArray(m.variacoes)).toBe(true);
      expect(m.variacoes.length).toBeGreaterThan(0);
      expect(Array.isArray(m.baralho)).toBe(true);
      for (const v of m.variacoes) expect(typeof v.id).toBe("string");
    }
  });

  it("o baralho guardado volta no próximo pedido de modelos", async () => {
    const ops = criar();
    await ops["conversas.guardarBaralho"]({ id: "t1", baralho: ["t1b"] });
    const modelos = await ops["conversas.modelos"]();
    expect(modelos.find((m) => m.id === "t1").baralho).toEqual(["t1b"]);
  });

  it("sem contatos, sobra só o grupo da bancada", async () => {
    const ops = criar([]);
    const lista = await ops["conversas.listar"]();
    expect(lista.every((c) => c.grupo)).toBe(true);
    expect(await ops["conversas.mensagens"]({ id: "a" })).toEqual([]);
  });
});
