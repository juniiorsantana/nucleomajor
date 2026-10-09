import { describe, expect, it, vi } from "vitest";
import { criarOperacoesAuth } from "./authProvider.js";

// Os aplicativos autorizados pelo MCP do portal moram no Supabase Auth
// (`auth.oauth`): a fronteira mockada é só ela.
function operacoes(oauth) {
  const supabase = { auth: { oauth, getSession: vi.fn(async () => ({ data: { session: null } })) } };
  const area = { get: vi.fn(async () => ({})), set: vi.fn(), remove: vi.fn() };
  return criarOperacoesAuth({ supabase, area });
}

describe("aplicativos conectados ao MCP do portal", () => {
  it("lista os autorizados com nome e data", async () => {
    const ops = operacoes({
      listGrants: vi.fn(async () => ({
        data: [
          { client: { id: "c1", name: "Claude", uri: "https://claude.ai", logo_uri: "" }, scopes: ["openid"], granted_at: "2026-10-09T15:00:00Z" },
          { client: { id: "", name: "Sem id" }, scopes: [], granted_at: "2026-10-09T15:00:00Z" },
        ],
        error: null,
      })),
    });
    expect(await ops["auth.aplicativosConectados"]()).toEqual({
      liberado: true,
      aplicativos: [{ id: "c1", nome: "Claude", desde: "2026-10-09T15:00:00Z" }],
    });
  });

  it("servidor OAuth desligado no projeto é 'ainda não liberado', não erro", async () => {
    const ops = operacoes({
      listGrants: vi.fn(async () => ({ data: null, error: { code: "feature_disabled", message: "OAuth server is disabled", status: 404 } })),
    });
    expect(await ops["auth.aplicativosConectados"]()).toEqual({ liberado: false, aplicativos: [] });
  });

  it("outra falha aparece como falha, em português", async () => {
    const ops = operacoes({ listGrants: vi.fn(async () => ({ data: null, error: { code: "unexpected_failure", message: "boom", status: 500 } })) });
    await expect(ops["auth.aplicativosConectados"]()).rejects.toThrow("Não foi possível ver os aplicativos conectados agora.");
  });

  it("desconectar revoga pelo id do cliente e não finge sucesso", async () => {
    const revokeGrant = vi.fn(async () => ({ data: {}, error: null }));
    const ops = operacoes({ revokeGrant });
    expect(await ops["auth.desconectarAplicativo"]({ clientId: "c1" })).toEqual({ ok: true });
    expect(revokeGrant).toHaveBeenCalledWith({ clientId: "c1" });

    const recusa = operacoes({ revokeGrant: vi.fn(async () => ({ data: null, error: { message: "not found" } })) });
    await expect(recusa["auth.desconectarAplicativo"]({ clientId: "c1" })).rejects.toThrow(/Não foi possível desconectar/);
    await expect(recusa["auth.desconectarAplicativo"]({})).rejects.toThrow("Aplicativo não informado.");
  });
});
