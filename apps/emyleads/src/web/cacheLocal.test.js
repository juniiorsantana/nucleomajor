import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarOperacoesAuth } from "./authProvider.js";
import {
  CACHE_LOCAL_LIGADO,
  MENSAGENS_POR_CONVERSA,
  VALIDADE_MS,
  apagarCacheLocal,
  criarCacheLocal,
} from "./cacheLocal.js";

const DIA = 24 * 60 * 60 * 1000;

let indexedDB;
let agora;
let sessao;

const novoCache = () =>
  criarCacheLocal({ indexedDB, agora: () => agora, escopo: async () => ({ ...sessao }) });

beforeEach(() => {
  // Um IndexedDB novo por prova: nada passa de uma para a outra.
  indexedDB = new IDBFactory();
  globalThis.indexedDB = indexedDB;
  agora = Date.UTC(2026, 9, 20, 13);
  sessao = { usuario: "u-ana", organizacao: "org-a" };
});

describe("cache local das Conversas", () => {
  it("fica desligado por padrão (decisão do dono, 19/10/2026)", () => {
    expect(CACHE_LOCAL_LIGADO).toBe(false);
  });

  it("grava e lê de volta", async () => {
    const cache = novoCache();
    expect(await cache.gravar("lista", [{ id: "c1" }])).toBe(true);
    expect(await cache.ler("lista")).toEqual([{ id: "c1" }]);
    expect(await cache.ler("nada")).toBeNull();
  });

  it("isola empresas: a lista da empresa A não aparece na B", async () => {
    const cache = novoCache();
    await cache.gravar("lista", ["da A"]);
    sessao.organizacao = "org-b";
    expect(await cache.ler("lista")).toBeNull();
    await cache.gravar("lista", ["da B"]);
    sessao.organizacao = "org-a";
    expect(await cache.ler("lista")).toEqual(["da A"]);
  });

  it("isola usuários, e a troca de usuário apaga a cópia do anterior", async () => {
    await novoCache().gravar("lista", ["da Ana"]);
    // Outra pessoa, outro carregamento da página, mesmo navegador.
    sessao.usuario = "u-bia";
    const daBia = novoCache();
    expect(await daBia.ler("lista")).toBeNull();
    sessao.usuario = "u-ana";
    expect(await novoCache().ler("lista")).toEqual(["da Ana"]);

    // Na mesma página: a sessão muda de dono, e o que era da Ana some.
    const cache = novoCache();
    await cache.gravar("lista", ["da Ana"]);
    sessao.usuario = "u-bia";
    await cache.ler("lista");
    sessao.usuario = "u-ana";
    expect(await novoCache().ler("lista")).toBeNull();
  });

  it("sem usuário ou sem empresa não lê nem grava", async () => {
    const cache = novoCache();
    sessao = { usuario: null, organizacao: "org-a" };
    expect(await cache.gravar("lista", [1])).toBe(false);
    sessao = { usuario: "u-ana", organizacao: null };
    expect(await cache.gravar("lista", [1])).toBe(false);
    expect(await cache.ler("lista")).toBeNull();
  });

  it("vence em 7 dias, e o vencido é apagado ao abrir", async () => {
    const cache = novoCache();
    await cache.gravar("lista", ["velha"]);
    agora += VALIDADE_MS - 1;
    expect(await cache.ler("lista")).toEqual(["velha"]);
    agora += 1;
    expect(await cache.ler("lista")).toBeNull();

    await cache.gravar("mensagens:c1", ["oi"]);
    agora += 8 * DIA;
    const depois = novoCache();
    await depois.ler("qualquer");
    const linhas = await new Promise((ok) => {
      const req = indexedDB.open("emyleads-conversas");
      req.onsuccess = () => {
        const todas = req.result.transaction("entradas").objectStore("entradas").getAll();
        todas.onsuccess = () => {
          req.result.close();
          ok(todas.result);
        };
      };
    });
    expect(linhas).toEqual([]);
  });

  it("guarda só as 50 últimas mensagens de cada conversa", async () => {
    const cache = novoCache();
    const mensagens = Array.from({ length: 300 }, (_, i) => ({ messageId: `m${i}` }));
    await cache.gravar("mensagens:conn:5511987654321", mensagens);
    const lidas = await cache.ler("mensagens:conn:5511987654321");
    expect(lidas).toHaveLength(MENSAGENS_POR_CONVERSA);
    expect(lidas[0].messageId).toBe("m250");
    expect(lidas.at(-1).messageId).toBe("m299");
    // A lista não é cortada.
    await cache.gravar("lista", mensagens);
    expect(await cache.ler("lista")).toHaveLength(300);
  });

  it("apagarTudo leva todas as empresas e usuários", async () => {
    const cache = novoCache();
    await cache.gravar("lista", ["A"]);
    sessao.organizacao = "org-b";
    await cache.gravar("lista", ["B"]);
    await cache.apagarTudo();
    expect(await cache.ler("lista")).toBeNull();
    sessao.organizacao = "org-a";
    expect(await cache.ler("lista")).toBeNull();
  });
});

describe("falha do IndexedDB não derruba a tela", () => {
  it("sem IndexedDB: lê nulo, não grava e não lança", async () => {
    delete globalThis.indexedDB;
    const cache = criarCacheLocal({ escopo: async () => sessao });
    expect(await cache.ler("lista")).toBeNull();
    expect(await cache.gravar("lista", [1])).toBe(false);
    await expect(cache.apagarTudo()).resolves.toBeUndefined();
    await expect(apagarCacheLocal()).resolves.toBe(false);
  });

  it("IndexedDB que lança ao abrir (aba anônima, navegador bloqueando)", async () => {
    const quebrado = { open: () => { throw new Error("SecurityError"); }, deleteDatabase: () => { throw new Error("SecurityError"); } };
    const cache = criarCacheLocal({ indexedDB: quebrado, escopo: async () => sessao });
    expect(await cache.ler("lista")).toBeNull();
    expect(await cache.gravar("lista", [1])).toBe(false);
    await expect(apagarCacheLocal({ indexedDB: quebrado })).resolves.toBe(false);
  });

  it("IndexedDB que responde erro ao abrir, e que volta depois", async () => {
    let falhar = true;
    const instavel = {
      open: (...args) => {
        if (!falhar) return indexedDB.open(...args);
        const req = {};
        setTimeout(() => req.onerror?.({}), 0);
        return req;
      },
    };
    const cache = criarCacheLocal({ indexedDB: instavel, agora: () => agora, escopo: async () => sessao });
    expect(await cache.gravar("lista", [1])).toBe(false);
    falhar = false;
    expect(await cache.gravar("lista", [1])).toBe(true);
    expect(await cache.ler("lista")).toEqual([1]);
  });

  it("escopo que falha (sessão ilegível) também não lança", async () => {
    const cache = criarCacheLocal({ indexedDB, escopo: async () => { throw new Error("sem sessão"); } });
    expect(await cache.ler("lista")).toBeNull();
    expect(await cache.gravar("lista", [1])).toBe(false);
  });
});

describe("logout e login", () => {
  const auth = () => {
    const supabase = {
      auth: {
        signOut: vi.fn(async () => ({ error: null })),
        signInWithPassword: vi.fn(async () => ({ error: null })),
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      },
    };
    const area = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
    return criarOperacoesAuth({ supabase, area });
  };

  it("sair apaga a cópia local inteira", async () => {
    const cache = novoCache();
    await cache.gravar("lista", ["conversa de cliente"]);
    await auth()["auth.sair"]();
    expect(await novoCache().ler("lista")).toBeNull();
  });

  it("entrar também apaga (sessão anterior que venceu sem logout)", async () => {
    await novoCache().gravar("lista", ["conversa de cliente"]);
    await auth()["auth.entrar"]({ email: "bia@x.com", senha: "segredo" });
    expect(await novoCache().ler("lista")).toBeNull();
  });
});
