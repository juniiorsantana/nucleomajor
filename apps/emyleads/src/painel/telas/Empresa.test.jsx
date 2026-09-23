// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * A tela de uma empresa: interruptores (plano × ajuste × resultado), a
 * confirmação que ligar IA exige, o motivo obrigatório para encerrar e o
 * aviso de que a cobrança do Asaas não muda por aqui.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plataforma = {
  empresa: vi.fn(),
  planosDoPainel: vi.fn(),
  ajustarFuncao: vi.fn(),
  voltarAoPlano: vi.fn(),
  encerrar: vi.fn(),
  estenderPeriodo: vi.fn(),
  trocarPlano: vi.fn(),
};
vi.mock("../../data/client", () => ({ api: { plataforma } }));

const { default: Empresa } = await import("./Empresa");

const funcao = (key, extra) => ({
  key, kind: "feature", name: key, description: "", category: "gestao", isAi: false, plan: true, adjustment: null, result: true, ...extra,
});

function detalhe(extra = {}) {
  return {
    empresa: {
      id: "o1", nome: "Clínica Adriane", dono: "dono@exemplo.com", plano: "base", nomePlano: "Base",
      status: "canceled", origem: "manual", estado: "ok", fimDoPeriodo: "2026-12-22T02:59:59Z", ...extra.empresa,
    },
    funcoes: [
      funcao("crm", { name: "Contatos, funil e tarefas" }),
      funcao("chatbots", { name: "Chatbots", plan: false, result: false }),
      funcao("ai_customer", { name: "IA atendendo clientes", isAi: true, plan: false, result: false }),
      funcao("agenda", { name: "Agenda", result: false, adjustment: { enabled: false, limitValue: null, expiresAt: null, note: "", active: true } }),
      { key: "connections", kind: "limit", name: "Números de WhatsApp", description: "", isAi: false, plan: 1, adjustment: null, result: 1 },
    ],
    uso: { contacts: 12, deals: 3, conversations30d: 4, messages30d: 40 },
    pessoas: [{ email: "dono@exemplo.com", role: "owner", status: "active" }],
    conexoes: [],
    vendas: extra.vendas || [],
    historico: [],
  };
}

let raiz;
let container;

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz.render(<Empresa id="o1" aoVoltar={() => {}} />));
  await act(async () => {});
}

const botao = (texto, dentro = container) => [...dentro.querySelectorAll("button")].find((b) => b.textContent.trim() === texto);
const linha = (nome) => [...container.querySelectorAll("tr")].find((tr) => tr.textContent.includes(nome));
const dialogo = () => document.querySelector("[role=dialog]");
async function clicar(elemento) {
  await act(async () => elemento.click());
  await act(async () => {});
}
async function enviar() {
  await act(async () => dialogo().querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => {});
}
async function escrever(el, valor) {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  for (const fn of Object.values(plataforma)) fn.mockReset();
  plataforma.empresa.mockResolvedValue(detalhe());
  plataforma.planosDoPainel.mockResolvedValue([
    { codigo: "base", nome: "Base", ativo: true },
    { codigo: "completo", nome: "Completo", ativo: true },
  ]);
});

afterEach(async () => {
  await act(async () => raiz?.unmount());
  container?.remove();
});

describe("empresa", () => {
  it("mostra situação, plano, uso e cada função com plano, ajuste e resultado", async () => {
    await montar();
    expect(container.textContent).toContain("Clínica Adriane");
    expect(container.textContent).toContain("Pago até 21/12/2026 · sem renovação");
    expect(container.textContent).toContain("Mensagens em 30 dias");
    expect(linha("Chatbots").textContent).toContain("Desligada");
    expect(botao("Ligar", linha("Chatbots"))).toBeTruthy();
    // Ajuste que desliga a agenda aparece e dá para voltar ao plano.
    expect(linha("Agenda").textContent).toContain("desligada");
    expect(botao("Voltar ao plano", linha("Agenda"))).toBeTruthy();
    // Um WhatsApp por empresa: o limite só oferece fechar (0).
    expect(botao("Fechar o WhatsApp", linha("Números de WhatsApp"))).toBeTruthy();
    expect(botao("Liberar 1 número", linha("Números de WhatsApp"))).toBeUndefined();
  });

  it("ligar o chatbot manda o ajuste, com prazo quando escolhido", async () => {
    plataforma.ajustarFuncao.mockResolvedValue({ features: {} });
    await montar();
    await clicar(botao("Ligar", linha("Chatbots")));
    const prazo = dialogo().querySelector("select");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(prazo, "15");
      prazo.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await enviar();
    const chamada = plataforma.ajustarFuncao.mock.calls[0][0];
    expect(chamada).toMatchObject({ id: "o1", chave: "chatbots", ligada: true, limite: null, confirmarIA: false });
    expect(chamada.ate).toMatch(/T23:59:59-03:00$/);
    expect(plataforma.empresa).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("O histórico registrou a mudança");
  });

  it("ligar IA só vai com a confirmação marcada", async () => {
    plataforma.ajustarFuncao.mockResolvedValue({ features: {} });
    await montar();
    await clicar(botao("Ligar", linha("IA atendendo clientes")));
    expect(dialogo().textContent).toContain("montada na VPS");
    const aplicar = botao("Aplicar", dialogo());
    expect(aplicar.disabled).toBe(true);
    await clicar(dialogo().querySelector("input[type=checkbox]"));
    expect(aplicar.disabled).toBe(false);
    await enviar();
    expect(plataforma.ajustarFuncao.mock.calls[0][0]).toMatchObject({ chave: "ai_customer", ligada: true, confirmarIA: true });
  });

  it("encerrar exige o motivo", async () => {
    plataforma.encerrar.mockResolvedValue({ billingInAsaas: false });
    await montar();
    await clicar(botao("Encerrar agora"));
    const confirmar = botao("Encerrar agora", dialogo());
    expect(confirmar.disabled).toBe(true);
    await escrever(dialogo().querySelector("textarea"), "pediu para sair");
    expect(confirmar.disabled).toBe(false);
    await enviar();
    expect(plataforma.encerrar).toHaveBeenCalledWith({ id: "o1", nota: "pediu para sair" });
  });

  it("empresa do Asaas avisa que a cobrança continua lá", async () => {
    // Fim bem no futuro: "+30" conta a partir dele, e o teste não envelhece.
    plataforma.empresa.mockResolvedValue(detalhe({ empresa: { origem: "payment", fimDoPeriodo: "2030-12-22T02:59:59Z" } }));
    plataforma.estenderPeriodo.mockResolvedValue({ billingInAsaas: true });
    await montar();
    expect(container.textContent).toContain("muda o ACESSO, não a cobrança");
    await clicar(botao("+30 dias"));
    expect(dialogo().querySelector("input[type=date]").value).toBe("2031-01-20");
    await enviar();
    expect(plataforma.estenderPeriodo.mock.calls[0][0]).toMatchObject({ id: "o1", ate: "2031-01-20T23:59:59-03:00", renovar: false });
    expect(container.textContent).toContain("A cobrança continua no Asaas");
  });

  it("trocar para um plano menor avisa antes", async () => {
    plataforma.empresa.mockResolvedValue(detalhe({ empresa: { plano: "completo", nomePlano: "Completo" } }));
    plataforma.trocarPlano.mockResolvedValue({});
    await montar();
    await clicar(botao("Trocar o plano…"));
    const select = dialogo().querySelector("select");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "base");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(dialogo().textContent).toContain("Este plano é menor");
    await enviar();
    expect(plataforma.trocarPlano).toHaveBeenCalledWith({ id: "o1", plano: "base", nota: "" });
  });
});
