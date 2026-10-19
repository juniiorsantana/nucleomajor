import { describe, expect, it, vi } from "vitest";
import {
  FOLGA_DA_URL_MS,
  RELEITURA_COMPLETA_MS,
  SOBREPOSICAO_MS,
  avisoTocaConversa,
  criarCacheDeUrls,
  criarFila,
  faltaColuna,
  faltaRpc,
  juntarConversas,
  juntarMensagens,
  precisaReleituraCompleta,
  proximoCursor,
} from "./sincronia.js";

const T0 = Date.parse("2026-10-20T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

describe("cursor com sobreposição", () => {
  it("volta cinco segundos do maior changed_at que chegou", () => {
    const linhas = [{ changed_at: iso(T0 + 1000) }, { changed_at: iso(T0 + 9000) }, { changed_at: iso(T0) }];
    expect(proximoCursor(linhas, null)).toBe(iso(T0 + 9000 - SOBREPOSICAO_MS));
  });

  it("sem linha nova o cursor fica onde estava", () => {
    expect(proximoCursor([], iso(T0))).toBe(iso(T0));
    expect(proximoCursor([], null)).toBeNull();
  });

  it("nunca anda para trás com linhas só da janela de sobreposição", () => {
    const cursor = iso(T0);
    // Repetida pela sobreposição: changed_at 3 s depois do cursor.
    expect(proximoCursor([{ changed_at: iso(T0 + 3000) }], cursor)).toBe(cursor);
  });

  it("linha sem a coluna (banco de antes) não vira cursor", () => {
    expect(proximoCursor([{ message_id: "a" }, { changed_at: null }], null)).toBeNull();
  });
});

describe("releitura completa", () => {
  it("relê quando nunca leu, e de dez em dez minutos", () => {
    expect(precisaReleituraCompleta({ cursor: null, completaEm: T0, agora: T0 })).toBe(true);
    expect(precisaReleituraCompleta({ cursor: iso(T0), completaEm: NaN, agora: T0 })).toBe(true);
    expect(precisaReleituraCompleta({ cursor: iso(T0), completaEm: T0, agora: T0 + RELEITURA_COMPLETA_MS - 1 })).toBe(false);
    expect(precisaReleituraCompleta({ cursor: iso(T0), completaEm: T0, agora: T0 + RELEITURA_COMPLETA_MS })).toBe(true);
  });
});

describe("junção da lista", () => {
  const c = (id, ultimaMensagemEm, extra = {}) => ({ id, ultimaMensagemEm, ...extra });

  it("a mesma conversa duas vezes vira uma linha, com o dado mais novo", () => {
    const antes = [c("a", 30), c("b", 20), c("c", 10)];
    const depois = juntarConversas(antes, [c("b", 20, { previa: "nova" }), c("b", 20, { previa: "nova" })]);
    expect(depois.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(depois[1].previa).toBe("nova");
  });

  it("repetir o mesmo delta não muda nada (idempotente)", () => {
    const antes = [c("a", 30), c("b", 20)];
    const delta = [c("c", 40), c("a", 30, { naoLidas: 1 })];
    const uma = juntarConversas(antes, delta);
    const duas = juntarConversas(uma, delta);
    expect(duas).toEqual(uma);
    expect(duas).toHaveLength(3);
  });

  it("a conversa que não mudou continua a MESMA referência", () => {
    const b = c("b", 20);
    const depois = juntarConversas([c("a", 30), b], [c("a", 31)]);
    expect(depois[1]).toBe(b);
  });

  it("reordena pela última mensagem, e a sem mensagem fica no fim", () => {
    const depois = juntarConversas([c("a", 30), c("b", 20), c("vazia", 0)], [c("b", 50)]);
    expect(depois.map((x) => x.id)).toEqual(["b", "a", "vazia"]);
  });

  it("sem delta devolve a mesma lista", () => {
    const antes = [c("a", 1)];
    expect(juntarConversas(antes, [])).toBe(antes);
  });
});

describe("junção das mensagens", () => {
  const m = (id, sent, changed, extra = {}) => ({
    message_id: id,
    sent_at: iso(T0 + sent),
    changed_at: iso(T0 + changed),
    ...extra,
  });

  it("junta por message_id, sem duplicar, em ordem de envio", () => {
    const antes = [m("1", 0, 0), m("2", 1000, 1000)];
    const depois = juntarMensagens(antes, [m("2", 1000, 1000), m("3", 2000, 2000)]);
    expect(depois.map((x) => x.message_id)).toEqual(["1", "2", "3"]);
  });

  it("a mensagem que mudou depois de chegar (transcrição) troca no lugar", () => {
    const antes = [m("1", 0, 0), m("2", 1000, 1000, { content: "" })];
    const depois = juntarMensagens(antes, [m("2", 1000, 5000, { content: "transcrito" })]);
    expect(depois).toHaveLength(2);
    expect(depois[1].content).toBe("transcrito");
  });

  it("a resposta atrasada e mais velha não desfaz a mais nova", () => {
    const antes = [m("2", 1000, 5000, { content: "transcrito" })];
    const depois = juntarMensagens(antes, [m("2", 1000, 1000, { content: "" })]);
    expect(depois[0].content).toBe("transcrito");
  });

  it("fica com as mais novas até o teto", () => {
    const antes = [m("1", 0, 0), m("2", 1000, 0)];
    const depois = juntarMensagens(antes, [m("3", 2000, 2000)], 2);
    expect(depois.map((x) => x.message_id)).toEqual(["2", "3"]);
  });
});

describe("fila de pedidos", () => {
  function adiada() {
    let resolve;
    const promise = new Promise((ok) => (resolve = ok));
    return { promise, resolve };
  }

  it("um pedido por vez; os que chegam no meio dividem o próximo", async () => {
    const respostas = [adiada(), adiada()];
    const opcoesVistas = [];
    let i = 0;
    const executar = vi.fn((opcoes) => {
      opcoesVistas.push(opcoes);
      return respostas[i++].promise;
    });
    const pedir = criarFila(executar, (a, b) => ({ completa: Boolean(a.completa || b.completa) }));

    const primeiro = pedir({});
    const segundo = pedir({});
    const terceiro = pedir({ completa: true });
    await Promise.resolve();
    expect(executar).toHaveBeenCalledTimes(1);

    respostas[0].resolve("um");
    await expect(primeiro).resolves.toBe("um");
    await vi.waitFor(() => expect(executar).toHaveBeenCalledTimes(2));
    respostas[1].resolve("dois");
    await expect(segundo).resolves.toBe("dois");
    await expect(terceiro).resolves.toBe("dois");
    // Quem esperou pediu a releitura completa: o próximo foi completo.
    expect(opcoesVistas[1]).toEqual({ completa: true });
    expect(executar).toHaveBeenCalledTimes(2);
  });

  it("a falha de um pedido não trava os seguintes", async () => {
    let vez = 0;
    const pedir = criarFila(async () => {
      vez += 1;
      if (vez === 1) throw new Error("rede");
      return "ok";
    });
    await expect(pedir()).rejects.toThrow("rede");
    await expect(pedir()).resolves.toBe("ok");
  });
});

describe("cache de URL assinada", () => {
  const lote = (prefixo) => vi.fn(async (caminhos) => new Map(caminhos.map((c) => [c, `${prefixo}/${c}`])));

  it("reaproveita a URL até cinco minutos antes de vencer, e então renova", async () => {
    let agora = T0;
    const cache = criarCacheDeUrls({ agora: () => agora });
    const primeira = lote("v1");
    expect((await cache.assinar("b", ["x.jpg"], 3600, primeira)).get("x.jpg")).toBe("v1/x.jpg");

    const segunda = lote("v2");
    agora = T0 + 3600_000 - FOLGA_DA_URL_MS - 1;
    expect((await cache.assinar("b", ["x.jpg"], 3600, segunda)).get("x.jpg")).toBe("v1/x.jpg");
    expect(segunda).not.toHaveBeenCalled();

    agora = T0 + 3600_000 - FOLGA_DA_URL_MS;
    expect((await cache.assinar("b", ["x.jpg"], 3600, segunda)).get("x.jpg")).toBe("v2/x.jpg");
    expect(segunda).toHaveBeenCalledWith(["x.jpg"]);
  });

  it("assina só o que falta, num lote", async () => {
    const cache = criarCacheDeUrls({ agora: () => T0 });
    await cache.assinar("b", ["a", "b"], 3600, lote("v1"));
    const segunda = lote("v2");
    const urls = await cache.assinar("b", ["a", "b", "c", "c", ""], 3600, segunda);
    expect(segunda).toHaveBeenCalledWith(["c"]);
    expect([...urls.entries()]).toEqual([
      ["a", "v1/a"],
      ["b", "v1/b"],
      ["c", "v2/c"],
    ]);
  });

  it("a falha não fica guardada: a próxima tenta de novo", async () => {
    const cache = criarCacheDeUrls({ agora: () => T0 });
    const falha = vi.fn(async () => new Map());
    expect((await cache.assinar("b", ["a"], 3600, falha)).size).toBe(0);
    const segunda = lote("v2");
    await cache.assinar("b", ["a"], 3600, segunda);
    expect(segunda).toHaveBeenCalledOnce();
  });

  it("buckets diferentes não dividem a URL do mesmo caminho", async () => {
    const cache = criarCacheDeUrls({ agora: () => T0 });
    await cache.assinar("avatares", ["a"], 3600, lote("av"));
    const midia = lote("md");
    expect((await cache.assinar("midia", ["a"], 3600, midia)).get("a")).toBe("md/a");
  });

  it("tem teto, para uma sessão longa não crescer sem fim", async () => {
    const cache = criarCacheDeUrls({ agora: () => T0, teto: 3 });
    await cache.assinar("b", ["1", "2", "3", "4", "5"], 3600, lote("v"));
    expect(cache.tamanho()).toBe(3);
  });
});

describe("erros do banco de antes da migration", () => {
  it("reconhece a RPC que falta", () => {
    expect(faltaRpc({ code: "PGRST202" })).toBe(true);
    expect(faltaRpc({ code: "42883" })).toBe(true);
    expect(faltaRpc({ code: "42501" })).toBe(false);
    expect(faltaRpc(null)).toBe(false);
  });

  it("reconhece a coluna que falta pelo nome", () => {
    const erro = { code: "42703", message: "column whatsapp_messages.changed_at does not exist" };
    expect(faltaColuna(erro, "changed_at")).toBe(true);
    expect(faltaColuna(erro, "transcribed_at")).toBe(false);
    expect(faltaColuna({ code: "PGRST204", message: "Could not find the 'changed_at' column" }, "changed_at")).toBe(true);
    expect(faltaColuna({ code: "42501", message: "changed_at" }, "changed_at")).toBe(false);
  });
});

describe("aviso de realtime e a conversa aberta", () => {
  const aberta = "conexao-1:5511987654321";

  it("com a chave da conversa aberta, toca", () => {
    expect(avisoTocaConversa({ entityId: "conexao-1", entityKeys: ["5511987654321"] }, aberta)).toBe(true);
  });

  it("com a chave de outra conversa, não toca", () => {
    expect(avisoTocaConversa({ entityId: "conexao-1", entityKeys: ["5521999998888"] }, aberta)).toBe(false);
  });

  it("o mesmo telefone em outra conexão não toca", () => {
    expect(avisoTocaConversa({ entityId: "conexao-2", entityKeys: ["5511987654321"] }, aberta)).toBe(false);
  });

  it("aviso de várias conexões (entityId nulo) decide pela chave", () => {
    expect(avisoTocaConversa({ entityId: null, entityKeys: ["5511987654321"] }, aberta)).toBe(true);
  });

  it("aviso sem chave (banco de antes, canal que religou) toca qualquer conversa", () => {
    expect(avisoTocaConversa({ entityKeys: null }, aberta)).toBe(true);
    expect(avisoTocaConversa({}, aberta)).toBe(true);
  });

  it("sem conversa aberta não há o que recarregar", () => {
    expect(avisoTocaConversa({ entityKeys: null }, null)).toBe(false);
  });
});
