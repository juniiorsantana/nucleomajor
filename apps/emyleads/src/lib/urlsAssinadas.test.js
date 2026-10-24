import { describe, expect, it, vi } from "vitest";
import { criarCacheDeUrlsAssinadas } from "./urlsAssinadas.js";

const HORA = 60 * 60;

/** O Storage do supabase-js, com um token novo a cada assinatura, como o de verdade. */
function storageFalso({ falhar = false } = {}) {
  let tokens = 0;
  const lote = vi.fn(async (caminhos) => {
    if (falhar) return { data: null, error: { message: "fora do ar" } };
    return { data: caminhos.map((path) => ({ path, signedUrl: `https://s.test/${path}?t=${++tokens}` })), error: null };
  });
  const um = vi.fn(async (caminho) => {
    if (falhar) return { data: null, error: { message: "Object not found" } };
    return { data: { signedUrl: `https://s.test/${caminho}?t=${++tokens}` }, error: null };
  });
  const supabase = { storage: { from: vi.fn(() => ({ createSignedUrls: lote, createSignedUrl: um })) } };
  return { supabase, lote, um };
}

describe("assinarVarios", () => {
  it("duas recargas seguidas fazem uma chamada só e devolvem a mesma URL", async () => {
    const { supabase, lote } = storageFalso();
    const cache = criarCacheDeUrlsAssinadas();

    const primeira = await cache.assinarVarios(supabase, "whatsapp-media", ["a.jpg", "b.ogg"], HORA);
    const segunda = await cache.assinarVarios(supabase, "whatsapp-media", ["a.jpg", "b.ogg"], HORA);

    expect(lote).toHaveBeenCalledOnce();
    expect([...segunda]).toEqual([...primeira]);
    expect(primeira.size).toBe(2);
  });

  it("renova quando falta menos de 20% do prazo, e não antes", async () => {
    let agora = 0;
    const { supabase, lote } = storageFalso();
    const cache = criarCacheDeUrlsAssinadas({ agora: () => agora });

    const primeira = await cache.assinarVarios(supabase, "b", ["a.jpg"], HORA);
    agora = 47 * 60 * 1000;
    const aos47 = await cache.assinarVarios(supabase, "b", ["a.jpg"], HORA);
    agora = 48 * 60 * 1000;
    const aos48 = await cache.assinarVarios(supabase, "b", ["a.jpg"], HORA);

    expect(aos47.get("a.jpg")).toBe(primeira.get("a.jpg"));
    expect(aos48.get("a.jpg")).not.toBe(primeira.get("a.jpg"));
    expect(lote).toHaveBeenCalledTimes(2);
  });

  it("só pede ao Storage o caminho que ainda não tem URL", async () => {
    const { supabase, lote } = storageFalso();
    const cache = criarCacheDeUrlsAssinadas();

    await cache.assinarVarios(supabase, "b", ["a.jpg"], HORA);
    const depois = await cache.assinarVarios(supabase, "b", ["a.jpg", " c.jpg ", "", null], HORA);

    expect(lote).toHaveBeenCalledTimes(2);
    expect(lote.mock.calls[1][0]).toEqual(["c.jpg"]);
    expect([...depois.keys()]).toEqual(["a.jpg", "c.jpg"]);
  });

  it("pedidos ao mesmo tempo esperam a mesma assinatura", async () => {
    const { supabase, lote } = storageFalso();
    const cache = criarCacheDeUrlsAssinadas();

    const [uma, outra] = await Promise.all([
      cache.assinarVarios(supabase, "b", ["a.jpg"], HORA),
      cache.assinarVarios(supabase, "b", ["a.jpg"], HORA),
    ]);

    expect(lote).toHaveBeenCalledOnce();
    expect(outra.get("a.jpg")).toBe(uma.get("a.jpg"));
  });

  it("o mesmo caminho em buckets diferentes são arquivos diferentes", async () => {
    const { supabase, lote } = storageFalso();
    const cache = criarCacheDeUrlsAssinadas();

    await cache.assinarVarios(supabase, "contact-avatars", ["x.jpg"], HORA);
    await cache.assinarVarios(supabase, "whatsapp-media", ["x.jpg"], HORA);

    expect(lote).toHaveBeenCalledTimes(2);
  });

  it("falha não fica guardada: a próxima recarga tenta de novo", async () => {
    const quebrado = storageFalso({ falhar: true });
    const cache = criarCacheDeUrlsAssinadas();

    expect((await cache.assinarVarios(quebrado.supabase, "b", ["a.jpg"], HORA)).size).toBe(0);

    const { supabase, lote } = storageFalso();
    const depois = await cache.assinarVarios(supabase, "b", ["a.jpg"], HORA);
    expect(lote).toHaveBeenCalledOnce();
    expect(depois.get("a.jpg")).toMatch(/^https:/);
  });
});

describe("assinarUm", () => {
  it("devolve a mesma URL até perto do vencimento", async () => {
    let agora = 0;
    const { supabase, um } = storageFalso();
    const cache = criarCacheDeUrlsAssinadas({ agora: () => agora });

    const primeira = await cache.assinarUm(supabase, "contact-avatars", "f.jpg", HORA);
    const segunda = await cache.assinarUm(supabase, "contact-avatars", "f.jpg", HORA);
    agora = 50 * 60 * 1000;
    const renovada = await cache.assinarUm(supabase, "contact-avatars", "f.jpg", HORA);

    expect(segunda).toBe(primeira);
    expect(renovada).not.toBe(primeira);
    expect(um).toHaveBeenCalledTimes(2);
  });

  it("divide a URL com assinarVarios", async () => {
    const { supabase, lote, um } = storageFalso();
    const cache = criarCacheDeUrlsAssinadas();

    const varios = await cache.assinarVarios(supabase, "contact-avatars", ["f.jpg"], HORA);
    const unico = await cache.assinarUm(supabase, "contact-avatars", "f.jpg", HORA);

    expect(unico).toBe(varios.get("f.jpg"));
    expect(lote).toHaveBeenCalledOnce();
    expect(um).not.toHaveBeenCalled();
  });

  it("rejeita com o erro do Storage e não guarda a falha", async () => {
    const quebrado = storageFalso({ falhar: true });
    const cache = criarCacheDeUrlsAssinadas();

    await expect(cache.assinarUm(quebrado.supabase, "b", "f.jpg", HORA)).rejects.toMatchObject({
      message: "Object not found",
    });

    const { supabase, um } = storageFalso();
    await expect(cache.assinarUm(supabase, "b", "f.jpg", HORA)).resolves.toMatch(/^https:/);
    expect(um).toHaveBeenCalledOnce();
  });

  it("esquecer força URL nova depois de trocar o arquivo", async () => {
    const { supabase, um } = storageFalso();
    const cache = criarCacheDeUrlsAssinadas();

    const antes = await cache.assinarUm(supabase, "b", "f.jpg", HORA);
    cache.esquecer("b", "f.jpg");
    const depois = await cache.assinarUm(supabase, "b", "f.jpg", HORA);

    expect(depois).not.toBe(antes);
    expect(um).toHaveBeenCalledTimes(2);
  });
});
