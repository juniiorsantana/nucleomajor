// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * Os cartões que vieram de Configurações para o painel da plataforma:
 * emitir liberação escolhendo o plano, ver as vendas do Asaas com plano e
 * ciclo, e copiar o comando que monta a conexão do cliente na VPS.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plataforma = {
  estado: vi.fn(),
  planos: vi.fn(),
  emitirAcesso: vi.fn(),
  vendas: vi.fn(),
  pedidosDeConexao: vi.fn(),
  reenviarAtivacao: vi.fn(),
  revogarAtivacao: vi.fn(),
};

vi.mock("../data/client", () => ({ api: { plataforma } }));

const { LiberarAcesso, PedidosDeConexao, VendasDoAsaas } = await import("./administracao");

let raiz;
let container;

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz.render(
    <>
      <LiberarAcesso />
      <VendasDoAsaas />
      <PedidosDeConexao />
    </>,
  ));
  await act(async () => {});
}

const PLANOS = [
  { codigo: "base", nome: "Base" },
  { codigo: "atendimento", nome: "Atendimento com IA" },
  { codigo: "completo", nome: "Completo" },
  { codigo: "full", nome: "Full" },
];

beforeEach(() => {
  for (const fn of Object.values(plataforma)) {
    fn.mockReset();
  }
  plataforma.estado.mockResolvedValue({ administrador: true });
  plataforma.planos.mockResolvedValue(PLANOS);
  plataforma.vendas.mockResolvedValue([]);
  plataforma.pedidosDeConexao.mockResolvedValue([]);
});

afterEach(async () => {
  await act(async () => raiz?.unmount());
  container?.remove();
});

describe("liberação manual", () => {
  it("lista os planos do banco e emite no plano escolhido", async () => {
    plataforma.emitirAcesso.mockResolvedValue({
      access_code: "NM12-3456-7890-AB", email: "cliente@exemplo.com", plan_code: "atendimento",
    });
    await montar();

    const selecao = container.querySelector("select");
    expect([...selecao.options].map((o) => o.textContent)).toEqual(["Base", "Atendimento com IA", "Completo", "Full"]);
    expect(selecao.value).toBe("base");

    const email = container.querySelector("input[type=email]");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(email, "cliente@exemplo.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    await act(async () => {
      setSelect.call(selecao, "atendimento");
      selecao.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => {});

    expect(plataforma.emitirAcesso).toHaveBeenCalledWith({ email: "cliente@exemplo.com", plano: "atendimento", dias: 7 });
    expect(container.textContent).toContain("NM12-3456-7890-AB");
    expect(container.textContent).toContain("plano atendimento");
    expect(container.textContent).toContain("não passa pelo Asaas");
  });

  it("sem a migration dos planos, ainda dá para emitir o Full", async () => {
    plataforma.planos.mockRejectedValue(new Error("PGRST202"));
    await montar();
    expect([...container.querySelector("select").options].map((o) => o.value)).toEqual(["full"]);
  });

});

describe("vendas e pedidos", () => {
  it("mostra o plano e o ciclo da venda", async () => {
    plataforma.vendas.mockResolvedValue([{
      id: "v1", email: "cliente@exemplo.com", plano: "atendimento", nomePlano: "Atendimento com IA",
      ciclo: "YEARLY", status: "active", codigoStatus: "pending", ativacaoEnviada: "2026-09-22T10:00:00Z",
    }]);
    await montar();
    expect(container.textContent).toContain("Atendimento com IA anual");
    expect(container.textContent).toContain("Aguardando o cliente ativar");
  });

  it("o comando da VPS leva o plano do pedido", async () => {
    plataforma.pedidosDeConexao.mockResolvedValue([
      { conexaoId: "c1", empresaId: "o1", empresa: "Clínica", dono: "dono@exemplo.com", final: "8164", plano: "completo", pedidoEm: "2026-09-22T10:00:00Z", sinalEm: null },
      { conexaoId: "c2", empresaId: "o2", empresa: "Major", dono: "cmo@majorhub.com.br", final: "8362", plano: "full", pedidoEm: "2026-09-22T10:00:00Z", sinalEm: null },
    ]);
    await montar();
    expect(container.textContent).toContain("provision-connection.sh o1 c1 --plano completo");
    // A Major está no full, que tem as duas IAs: para a VPS, é o completo.
    expect(container.textContent).toContain("provision-connection.sh o2 c2 --plano completo");
  });

  it("na tela própria, sem pendência, diz que não há nada", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    raiz = createRoot(container);
    await act(async () => raiz.render(<PedidosDeConexao mostrarVazio />));
    await act(async () => {});
    expect(container.textContent).toContain("Nenhum WhatsApp aguardando a VPS");
  });

  it("pedido que já deu sinal não aparece", async () => {
    plataforma.pedidosDeConexao.mockResolvedValue([
      { conexaoId: "c1", empresaId: "o1", empresa: "Clínica", plano: "base", sinalEm: "2026-09-22T10:00:00Z" },
    ]);
    await montar();
    expect(container.textContent).not.toContain("provision-connection.sh");
  });
});
