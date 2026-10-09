// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * O "Permitir acesso" do MCP: mostra quem pede, devolve a resposta ao
 * Supabase e manda a pessoa de volta ao Claude/ChatGPT. A fronteira
 * mockada é o `auth.oauth` do supabase-js.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../web/supabaseClient", () => ({ obterSupabaseWeb: () => ({ auth: { oauth: null } }) }));

const { default: ConsentimentoOAuth, destinoConfiavel } = await import("./ConsentimentoOAuth");

const PEDIDO = {
  authorization_id: "auth-1",
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  client: { id: "c1", name: "Claude", uri: "https://claude.ai", logo_uri: "" },
  user: { id: "u1", email: "dona@exemplo.com" },
  scope: "openid email",
};

let raiz;
let container;

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
});

async function montar(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz.render(<ConsentimentoOAuth {...props} />));
  await act(async () => {});
}

function botao(texto) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent.includes(texto));
}

describe("ConsentimentoOAuth", () => {
  it("mostra o pedido e, ao permitir, volta para o aplicativo", async () => {
    const oauth = {
      getAuthorizationDetails: vi.fn().mockResolvedValue({ data: PEDIDO, error: null }),
      approveAuthorization: vi.fn().mockResolvedValue({ data: { redirect_url: "https://claude.ai/api/mcp/auth_callback?code=x" }, error: null }),
      denyAuthorization: vi.fn(),
    };
    const irPara = vi.fn();
    await montar({ oauth, busca: "?authorization_id=auth-1", irPara });

    expect(oauth.getAuthorizationDetails).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Claude quer ler seus dados");
    expect(container.textContent).toContain("dona@exemplo.com");
    expect(container.textContent).toContain("Enviar mensagens");
    expect(container.textContent).toContain("claude.ai");

    await act(async () => botao("Permitir acesso").click());
    expect(oauth.approveAuthorization).toHaveBeenCalledWith("auth-1", { skipBrowserRedirect: true });
    expect(irPara).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?code=x");
  });

  it("não permitir também devolve a pessoa, com a recusa", async () => {
    const oauth = {
      getAuthorizationDetails: vi.fn().mockResolvedValue({ data: PEDIDO, error: null }),
      approveAuthorization: vi.fn(),
      denyAuthorization: vi.fn().mockResolvedValue({ data: { redirect_url: "https://claude.ai/cb?error=access_denied" }, error: null }),
    };
    const irPara = vi.fn();
    await montar({ oauth, busca: "?authorization_id=auth-1", irPara });
    await act(async () => botao("Não permitir").click());
    expect(oauth.approveAuthorization).not.toHaveBeenCalled();
    expect(irPara).toHaveBeenCalledWith("https://claude.ai/cb?error=access_denied");
  });

  it("já autorizado antes: segue direto, sem perguntar de novo", async () => {
    const oauth = { getAuthorizationDetails: vi.fn().mockResolvedValue({ data: { redirect_url: "https://chatgpt.com/cb?code=y" }, error: null }) };
    const irPara = vi.fn();
    await montar({ oauth, busca: "?authorization_id=auth-2", irPara });
    expect(irPara).toHaveBeenCalledWith("https://chatgpt.com/cb?code=y");
  });

  it("falha aparece como falha, sem sair da tela", async () => {
    const oauth = {
      getAuthorizationDetails: vi.fn().mockResolvedValue({ data: PEDIDO, error: null }),
      approveAuthorization: vi.fn().mockResolvedValue({ data: null, error: new Error("boom") }),
    };
    const irPara = vi.fn();
    await montar({ oauth, busca: "?authorization_id=auth-1", irPara });
    await act(async () => botao("Permitir acesso").click());
    expect(irPara).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]").textContent).toMatch(/Não foi possível registrar/);
    expect(botao("Permitir acesso").disabled).toBe(false);
  });

  it("só confia no que volta para o Claude ou para o ChatGPT, por https", () => {
    for (const bom of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
      "https://chatgpt.com/connector_platform_oauth_redirect",
      "https://www.claude.ai/cb",
    ]) expect(destinoConfiavel(bom), bom).toBe(true);
    for (const ruim of [
      "http://claude.ai/api/mcp/auth_callback",
      "https://claude.ai.golpe.com/cb",
      "https://golpeclaude.ai/cb",
      "https://golpe.com/?volta=claude.ai",
      "javascript:alert(1)",
      "",
      undefined,
    ]) expect(destinoConfiavel(ruim), String(ruim)).toBe(false);
  });

  it("aplicativo que volta para outro site: sem Permitir, e recusar não leva até ele", async () => {
    const oauth = {
      getAuthorizationDetails: vi.fn().mockResolvedValue({
        data: { ...PEDIDO, client: { ...PEDIDO.client, name: "Claude" }, redirect_uri: "https://claude-ai.golpe.com/cb" },
        error: null,
      }),
      approveAuthorization: vi.fn(),
      denyAuthorization: vi.fn().mockResolvedValue({ data: { redirect_url: "https://claude-ai.golpe.com/cb?error=access_denied" }, error: null }),
    };
    const irPara = vi.fn();
    await montar({ oauth, busca: "?authorization_id=auth-3", irPara });

    expect(container.textContent).toContain("não é reconhecido");
    expect(container.textContent).toContain("claude-ai.golpe.com");
    expect(botao("Permitir acesso")).toBeUndefined();

    await act(async () => botao("Recusar pedido").click());
    expect(oauth.denyAuthorization).toHaveBeenCalledWith("auth-3", { skipBrowserRedirect: true });
    expect(oauth.approveAuthorization).not.toHaveBeenCalled();
    expect(irPara).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Pedido recusado");
  });

  it("retorno automático para destino estranho também para aqui", async () => {
    const oauth = { getAuthorizationDetails: vi.fn().mockResolvedValue({ data: { redirect_url: "https://golpe.com/cb?code=z" }, error: null }) };
    const irPara = vi.fn();
    await montar({ oauth, busca: "?authorization_id=auth-4", irPara });
    expect(irPara).not.toHaveBeenCalled();
    expect(container.textContent).toContain("golpe.com");
    expect(container.textContent).toContain("não é reconhecido");
  });

  it("link sem authorization_id ou expirado explica o que fazer", async () => {
    await montar({ oauth: { getAuthorizationDetails: vi.fn() }, busca: "", irPara: vi.fn() });
    expect(container.textContent).toMatch(/link de autorização está incompleto/);
    act(() => raiz.unmount());
    container.remove();

    const oauth = { getAuthorizationDetails: vi.fn().mockResolvedValue({ data: null, error: new Error("expirado") }) };
    await montar({ oauth, busca: "?authorization_id=velho", irPara: vi.fn() });
    expect(container.textContent).toMatch(/expirou ou já foi usado/);
  });
});
