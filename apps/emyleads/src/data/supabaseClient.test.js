import { describe, expect, it, vi } from "vitest";
import { criarStorageChrome, verificarConexaoSupabase } from "./supabaseClient";

describe("storage de sessão do Supabase", () => {
  it("grava, lê e remove valores usando chrome.storage", async () => {
    const valores = {};
    const area = {
      get: vi.fn(async (chave) => ({ [chave]: valores[chave] })),
      set: vi.fn(async (novos) => Object.assign(valores, novos)),
      remove: vi.fn(async (chave) => delete valores[chave]),
    };
    const storage = criarStorageChrome(area);

    expect(await storage.getItem("sessao")).toBeNull();
    await storage.setItem("sessao", "token");
    expect(await storage.getItem("sessao")).toBe("token");
    await storage.removeItem("sessao");
    expect(await storage.getItem("sessao")).toBeNull();
  });
});

describe("diagnóstico do Supabase", () => {
  it("confirma gateway e informa quando não há sessão", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const supabase = {
      auth: { getSession: vi.fn(async () => ({ data: { session: null }, error: null })) },
    };

    const resultado = await verificarConexaoSupabase({ fetchImpl, supabase });

    expect(resultado).toMatchObject({
      conectado: true,
      projeto: "teste",
      auth: "disponivel",
      autenticado: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://teste.supabase.co/auth/v1/settings",
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("classifica uma chave recusada sem expor seu valor", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 }));

    await expect(verificarConexaoSupabase({ fetchImpl })).rejects.toMatchObject({
      codigo: "supabase-chave-invalida",
    });
  });
});
