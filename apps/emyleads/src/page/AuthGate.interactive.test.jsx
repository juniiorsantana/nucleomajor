// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * O caminho de quem pagou: link de ativação → conta → empresa, e a porta
 * fechada de quem está sem assinatura. Mesmo desenho de
 * `telas/Agents.interactive.test.jsx`: a fronteira mockada é `../data/client`.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = {
  auth: { estado: vi.fn(), cadastrar: vi.fn(), entrar: vi.fn(), sair: vi.fn(), migracaoControle: vi.fn() },
  organizacoes: { acesso: vi.fn(), criar: vi.fn(), selecionar: vi.fn(), aceitarConvite: vi.fn() },
  sync: { migracaoStatus: vi.fn() },
};

vi.mock("../data/client", () => ({ api }));

const { default: AuthGate } = await import("./AuthGate");

const USUARIO = { id: "u1", email: "cliente@exemplo.com", nome: "Cliente" };
const EMPRESA = { id: "org-1", name: "Clínica do Cliente", papel: "owner" };
const OUTRA = { id: "org-2", name: "Outra Empresa", papel: "member" };

let raiz;
let container;

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => {
    raiz.render(<AuthGate>{(estado) => <div data-testid="painel">painel {estado.acesso?.estado}</div>}</AuthGate>);
  });
  await act(async () => {});
}

function campo(rotulo) {
  const label = [...container.querySelectorAll("label")].find((l) => l.textContent.includes(rotulo));
  return label?.querySelector("input");
}

async function digitar(input, valor) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function enviar(form) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

beforeEach(() => {
  for (const grupo of Object.values(api)) for (const fn of Object.values(grupo)) fn.mockReset();
  api.sync.migracaoStatus.mockResolvedValue({ temDados: false, concluida: true, totais: {} });
  api.auth.migracaoControle.mockResolvedValue({ origem: null, preferencia: null });
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/app/");
});

afterEach(async () => {
  await act(async () => raiz?.unmount());
  container?.remove();
  globalThis.__NUCLEO_CONFIG__ = undefined;
});

describe("link de ativação", () => {
  it("abre em Criar conta com o e-mail da compra e manda o retorno da confirmação", async () => {
    window.history.replaceState(null, "", "/app/ativar?codigo=nm12-3456-7890-ab&email=Cliente%40Exemplo.com");
    api.auth.estado.mockResolvedValue(null);
    api.auth.cadastrar.mockResolvedValue({ confirmacaoPendente: true, email: "cliente@exemplo.com" });
    await montar();

    expect(container.textContent).toContain("Pagamento confirmado");
    expect(container.textContent).toContain("Crie sua conta");
    expect(campo("E-mail").value).toBe("cliente@exemplo.com");
    // O código saiu da barra de endereço, e ficou guardado nesta aba.
    expect(window.location.pathname).toBe("/app/");
    expect(window.location.search).toBe("");
    expect(JSON.parse(window.sessionStorage.getItem("emyleads.ativacao.pendente")).codigo).toBe("NM12-3456-7890-AB");

    await digitar(campo("Seu nome"), "Cliente");
    await digitar(campo("Senha"), "senha-forte-123");
    await enviar(container.querySelector("form"));

    expect(api.auth.cadastrar).toHaveBeenCalledTimes(1);
    const args = api.auth.cadastrar.mock.calls[0][0];
    expect(args.email).toBe("cliente@exemplo.com");
    expect(args.redirectTo).toBe(`${window.location.origin}/app/ativar?codigo=NM12-3456-7890-AB&email=cliente%40exemplo.com`);
    expect(container.textContent).toContain("continuar a ativação");
  });

  it("depois do login, o código já vem preenchido e some ao ativar a empresa", async () => {
    window.sessionStorage.setItem("emyleads.ativacao.pendente", JSON.stringify({ codigo: "NM12-3456-7890-AB", email: "cliente@exemplo.com" }));
    api.auth.estado.mockResolvedValue({ usuario: USUARIO, organizacoes: [], organizacaoAtual: null });
    api.organizacoes.criar.mockResolvedValue({ usuario: USUARIO, organizacoes: [EMPRESA], organizacaoAtual: EMPRESA });
    api.organizacoes.acesso.mockResolvedValue({ estado: "ok", recursos: { assistant: false } });
    await montar();

    expect(campo("Código de ativação").value).toBe("NM12-3456-7890-AB");
    await digitar(campo("Nome da empresa"), "Clínica do Cliente");
    await enviar(container.querySelector("form"));

    expect(api.organizacoes.criar).toHaveBeenCalledWith({ nome: "Clínica do Cliente", codigo: "NM12-3456-7890-AB" });
    expect(window.sessionStorage.getItem("emyleads.ativacao.pendente")).toBeNull();
    expect(container.querySelector("[data-testid=painel]").textContent).toBe("painel ok");
  });

  it("sem liberação, o rodapé leva ao checkout quando ele está configurado", async () => {
    globalThis.__NUCLEO_CONFIG__ = { checkoutUrl: "https://www.asaas.com/c/725104409743" };
    api.auth.estado.mockResolvedValue({ usuario: USUARIO, organizacoes: [], organizacaoAtual: null });
    await montar();
    const link = [...container.querySelectorAll("a")].find((a) => a.textContent.includes("Assine"));
    expect(link?.getAttribute("href")).toBe("https://www.asaas.com/c/725104409743");
  });
});

describe("assinatura", () => {
  it("empresa bloqueada não abre o painel, e ainda deixa trocar de empresa e sair", async () => {
    const estado = { usuario: USUARIO, organizacoes: [EMPRESA, OUTRA], organizacaoAtual: EMPRESA };
    api.auth.estado.mockResolvedValue(estado);
    api.organizacoes.acesso.mockImplementation(async ({ id }) => (
      id === EMPRESA.id ? { estado: "blocked", status: "canceled", recursos: {} } : { estado: "ok", recursos: {} }
    ));
    api.organizacoes.selecionar.mockResolvedValue({ ...estado, organizacaoAtual: OUTRA });
    await montar();

    expect(container.querySelector("[data-testid=painel]")).toBeNull();
    expect(container.textContent).toContain("acesso suspenso");
    expect(container.textContent).toContain("foi cancelada");
    expect(container.textContent).toContain("Seus dados continuam guardados");

    const trocar = [...container.querySelectorAll("button")].find((b) => b.textContent === "Outra Empresa");
    await act(async () => trocar.click());
    await act(async () => {});
    expect(api.organizacoes.selecionar).toHaveBeenCalledWith({ id: "org-2" });
    expect(container.querySelector("[data-testid=painel]").textContent).toBe("painel ok");
  });

  it("falha ao ler a assinatura não tranca ninguém do lado de fora", async () => {
    api.auth.estado.mockResolvedValue({ usuario: USUARIO, organizacoes: [EMPRESA], organizacaoAtual: EMPRESA });
    api.organizacoes.acesso.mockRejectedValue(new Error("rede caiu"));
    await montar();
    expect(container.querySelector("[data-testid=painel]").textContent).toBe("painel ok");
  });

  it("atendente de empresa bloqueada é mandado ao responsável, sem botão de assinar", async () => {
    globalThis.__NUCLEO_CONFIG__ = { checkoutUrl: "https://www.asaas.com/c/725104409743" };
    const atendente = { ...EMPRESA, papel: "member" };
    api.auth.estado.mockResolvedValue({ usuario: USUARIO, organizacoes: [atendente], organizacaoAtual: atendente });
    api.organizacoes.acesso.mockResolvedValue({ estado: "blocked", status: "past_due", recursos: {} });
    await montar();
    expect(container.textContent).toContain("Fale com quem administra a empresa");
    expect([...container.querySelectorAll("a")].some((a) => a.textContent.includes("Assinar"))).toBe(false);
  });
});
