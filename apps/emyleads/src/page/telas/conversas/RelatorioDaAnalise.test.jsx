// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  tarefas: { criar: vi.fn() },
  agenda: { criar: vi.fn() },
}));
vi.mock("../../../data/client", () => ({ api }));

import { RelatorioDaAnalise } from "./RelatorioDaAnalise";
import { mostrarMensagem } from "../Conversas";

let container;
let root;
const render = async (elemento) => {
  await act(async () => root.render(elemento));
};
const botao = (texto) => [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === texto);
const clicar = async (el) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const digitar = async (el, valor) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

const RELATORIO = {
  schema_version: "analysis.v1",
  lead_score: null,
  atendimento_score: {
    score: 47, max_score: 100, evaluated_weight: 55, max_weight: 100, label: "47/100 até aqui",
    criteria: [
      { key: "responsiveness", name: "Responsividade contextual", weight: 10, status: "nao_avaliado", points_awarded: null },
      { key: "discovery", name: "Descoberta da necessidade", weight: 15, status: "bom", points_awarded: 15 },
      { key: "next_step", name: "Próximo passo", weight: 15, status: "critico", points_awarded: 0, reason: "Terminou sem ação definida." },
    ],
  },
  diagnosis: {
    summary: "Boa descoberta, mas a conversa ficou sem próximo passo.",
    main_bottleneck: { criterion: "next_step", title: "Sem próximo passo", explanation: "Havia condição de avançar.", evidence_message_ids: ["m6"] },
    why_this_score: [{ criterion: "next_step", explanation: "Terminou sem ação definida.", evidence_message_ids: ["m6", "m7"] }],
    what_to_do_now: [
      { priority: "alta", action_type: "create_follow_up", title: "Retomar na quarta", instruction: "Combinar data", reason: "Lead pediu", due_at: "2026-10-07", evidence_message_ids: [] },
      { priority: "media", action_type: "reply", title: "Responder agora", instruction: "Mandar a mensagem", reason: "", due_at: null, evidence_message_ids: [] },
      { priority: "baixa", action_type: "schedule_meeting", title: "Diagnóstico", instruction: "", reason: "", due_at: "2026-10-08T10:00-03:00", evidence_message_ids: [] },
    ],
    suggested_message: { applicable: true, text: "Podemos marcar o diagnóstico para quarta?" },
    red_flags: [{ code: "conversation_left_open", severity: null, criterion: "next_step", reason: "Havia condição de avançar.", evidence_message_ids: [] }],
  },
  red_flags: [{ code: "conversation_left_open", severity: null, criterion: "next_step", reason: "Havia condição de avançar.", evidence_message_ids: [] }],
};
const analise = { id: "a1", situacao: "done", relatorio: RELATORIO, resultado: { schema_version: "analysis_report.v1", ...RELATORIO.diagnosis } };
const contato = { id: "k1" };

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.tarefas.criar.mockReset();
  api.agenda.criar.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("o relatório v1", () => {
  it("mostra a nota parcial, o resumo, o gargalo, o porquê e o que fazer, sem Lead Score", async () => {
    await render(<RelatorioDaAnalise analise={analise} podeAgir contato={contato} />);
    const texto = container.textContent;
    expect(texto).toContain("Atendimento Score");
    expect(texto).toContain("47/100 até aqui");
    expect(texto).toContain("Nota parcial");
    expect(texto).toContain("Boa descoberta, mas a conversa ficou sem próximo passo.");
    expect(texto).toContain("Principal gargalo");
    expect(texto).toContain("Por que essa nota?");
    expect(texto).toContain("O que fazer agora");
    expect(texto).toContain("Conversa ficou em aberto");
    expect(texto).toContain("não descontam da nota");
    expect(texto).not.toMatch(/Lead Score/);
  });

  it("detalhamento: não avaliado aparece como traço, nunca como zero", async () => {
    await render(<RelatorioDaAnalise analise={analise} podeAgir contato={contato} />);
    expect(container.querySelector("table")).toBeNull();
    await clicar(botao("Ver critérios"));
    const linhas = [...container.querySelectorAll("tr")].map((tr) => tr.textContent);
    expect(linhas[0]).toContain("Responsividade contextual");
    expect(linhas[0]).toContain("Ainda não avaliável");
    expect(linhas[0]).toContain("—");
    expect(linhas[0]).not.toContain("0/10");
    expect(linhas[1]).toContain("15/15");
    expect(linhas[2]).toContain("0/15");
    expect(linhas[2]).toContain("Terminou sem ação definida.");
  });

  it("sem nota: ainda não avaliável", async () => {
    const semNota = { ...analise, relatorio: { ...RELATORIO, atendimento_score: { ...RELATORIO.atendimento_score, score: null, label: "Ainda não avaliável" } } };
    await render(<RelatorioDaAnalise analise={semNota} podeAgir contato={contato} />);
    expect(container.textContent).toContain("Ainda não avaliável");
    expect(container.textContent).not.toContain("Nota parcial");
  });

  it("usar a mensagem sugerida põe o texto na caixa e fecha", async () => {
    const aoUsarMensagem = vi.fn();
    const aoFechar = vi.fn();
    await render(<RelatorioDaAnalise analise={analise} podeAgir contato={contato} aoUsarMensagem={aoUsarMensagem} aoFechar={aoFechar} />);
    const usar = [...container.querySelectorAll("button")].filter((b) => b.textContent.includes("Usar mensagem sugerida"));
    expect(usar.length).toBe(2);
    await clicar(usar[0]);
    expect(aoUsarMensagem).toHaveBeenCalledWith("Podemos marcar o diagnóstico para quarta?");
    expect(aoFechar).toHaveBeenCalled();
  });

  it("criar follow-up só prepara: data sem hora pede a hora antes de criar", async () => {
    const aoCriado = vi.fn();
    await render(<RelatorioDaAnalise analise={analise} podeAgir contato={contato} negocio={{ id: "d1" }} aoCriado={aoCriado} />);
    await clicar(botao("Criar follow-up"));
    expect(api.tarefas.criar).not.toHaveBeenCalled();
    expect(container.querySelector('input[aria-label="Título"]').value).toBe("Retomar na quarta");
    expect(container.querySelector('input[aria-label="Data"]').value).toBe("2026-10-07");
    expect(container.querySelector('input[aria-label="Hora"]').value).toBe("");
    expect(container.textContent).toContain("A conversa não diz o horário");
    await clicar(botao("Criar"));
    expect(container.querySelector('[role="alert"]').textContent).toContain("Escolha a data e a hora.");
    expect(api.tarefas.criar).not.toHaveBeenCalled();
    await digitar(container.querySelector('input[aria-label="Hora"]'), "14:00");
    await clicar(botao("Criar"));
    expect(api.tarefas.criar).toHaveBeenCalledTimes(1);
    const enviada = api.tarefas.criar.mock.calls[0][0];
    expect([enviada.titulo, enviada.contactId, enviada.dealId, new Date(enviada.venceEm).getHours()]).toEqual(["Retomar na quarta", "k1", "d1", 14]);
    expect(aoCriado).toHaveBeenCalled();
    expect(container.textContent).toContain("Criado");
  });

  it("agendar cria o compromisso com o contato, a partir da data e hora sugeridas", async () => {
    await render(<RelatorioDaAnalise analise={analise} podeAgir contato={contato} />);
    await clicar(botao("Agendar"));
    expect(container.querySelector('input[aria-label="Hora"]').value).not.toBe("");
    await clicar(botao("Criar"));
    const enviado = api.agenda.criar.mock.calls[0][0];
    expect(enviado.contactId).toBe("k1");
    expect(new Date(enviado.fim) - new Date(enviado.inicio)).toBe(30 * 60 * 1000);
  });

  it("sem lead ou sem permissão, as ações não aparecem como botão", async () => {
    await render(<RelatorioDaAnalise analise={analise} podeAgir contato={null} />);
    expect(botao("Criar follow-up")).toBeUndefined();
    expect(container.textContent).toContain("Crie o lead para criar follow-up por aqui.");
    await render(<RelatorioDaAnalise analise={analise} podeAgir={false} contato={contato} />);
    expect(botao("Criar follow-up")).toBeUndefined();
    expect(botao("Agendar")).toBeUndefined();
  });

  it("ver evidência: achou, fecha e leva à mensagem; não achou, avisa", async () => {
    const aoFechar = vi.fn();
    const aoVerMensagem = vi.fn((id) => id === "m6");
    await render(<RelatorioDaAnalise analise={analise} podeAgir contato={contato} aoVerMensagem={aoVerMensagem} aoFechar={aoFechar} />);
    await clicar(botao("Ver evidência"));
    expect(aoVerMensagem).toHaveBeenCalledWith("m6");
    expect(aoFechar).toHaveBeenCalledTimes(1);
    await clicar(botao("Ver evidência 2"));
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]').textContent).toContain("não está entre as carregadas");
  });
});

describe("mostrarMensagem", () => {
  it("rola até a bolha pelo message_id e devolve se achou", () => {
    const lista = document.createElement("div");
    lista.innerHTML = '<div data-message-id="m1"><div>oi</div></div><div data-message-id="m2"><div>tudo</div></div>';
    const alvo = lista.querySelector('[data-message-id="m2"]');
    alvo.scrollIntoView = vi.fn();
    expect(mostrarMensagem(lista, "m2")).toBe(true);
    expect(alvo.scrollIntoView).toHaveBeenCalled();
    expect(alvo.firstElementChild.classList.contains("outline-accent")).toBe(true);
    expect(mostrarMensagem(lista, "nao-existe")).toBe(false);
    expect(mostrarMensagem(null, "m1")).toBe(false);
  });
});
