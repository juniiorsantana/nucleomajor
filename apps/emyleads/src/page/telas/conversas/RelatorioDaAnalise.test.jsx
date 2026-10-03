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
      { key: "next_step", name: "Próximo passo", weight: 15, status: "critico", points_awarded: 0, reason: "Terminou sem ação definida.", evidence_message_ids: ["m6", "m7"] },
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
    expect(texto).toContain("Nota do atendimento");
    expect(texto).toContain("47/100 — 55% dos critérios avaliados");
    expect(texto).toContain("2 de 3 critérios avaliados");
    expect(texto).toContain("15 dos 55 pontos");
    expect(texto).toContain("Nota até aqui");
    expect(texto).not.toContain("não é conclusiva");
    expect(texto).toContain("Boa descoberta, mas a conversa ficou sem próximo passo.");
    expect(texto).toContain("Principal gargalo");
    expect(texto).toContain("Próximo passo · 0 de 15");
    expect(texto).toContain("Por que essa nota");
    expect(texto).toContain("15 ÷ 55 = 47");
    expect(texto).toContain("O que fazer agora");
    expect(texto).toContain("Conversa ficou em aberto");
    expect(texto).toContain("não descontam da nota");
    // Sem esquema de lead: "em breve", nunca um número.
    expect(texto).toContain("Lead Scorechance de fecharem breve");
  });

  it("não inventa faixa de qualidade para a nota", async () => {
    await render(<RelatorioDaAnalise analise={analise} podeAgir contato={contato} />);
    const nota = container.querySelector('[aria-label="Atendimento Score"]').textContent;
    expect(nota).not.toMatch(/Atenção|Bom|Ruim|Regular|Excelente/);
  });

  it("critérios: quem mais perdeu primeiro; não avaliado no fim, como traço, nunca zero", async () => {
    await render(<RelatorioDaAnalise analise={analise} podeAgir contato={contato} />);
    const linhas = [...container.querySelectorAll('[role="table"] [role="row"]')].slice(1).map((linha) => linha.textContent);
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toContain("Próximo passo");
    expect(linhas[0]).toContain("Crítico");
    expect(linhas[0]).toContain("0 / 15");
    expect(linhas[0]).toContain("Terminou sem ação definida.");
    expect(linhas[1]).toContain("Descoberta");
    expect(linhas[1]).toContain("15 / 15");
    expect(linhas[2]).toContain("Responsividade");
    expect(linhas[2]).toContain("Não avaliado");
    expect(linhas[2]).toContain("—");
    expect(linhas[2]).toContain("Fica fora da v1");
    expect(linhas[2]).not.toContain("0/10");
  });

  it("sem nota: ainda não avaliável", async () => {
    const semNota = { ...analise, relatorio: { ...RELATORIO, atendimento_score: { ...RELATORIO.atendimento_score, score: null, label: "Ainda não avaliável" } } };
    await render(<RelatorioDaAnalise analise={semNota} podeAgir contato={contato} />);
    expect(container.textContent).toContain("Ainda não avaliável");
    expect(container.textContent).not.toContain("dos critérios avaliados");
  });

  it("usar a mensagem sugerida põe o texto na caixa e fecha", async () => {
    const aoUsarMensagem = vi.fn();
    const aoFechar = vi.fn();
    await render(<RelatorioDaAnalise analise={analise} podeAgir contato={contato} aoUsarMensagem={aoUsarMensagem} aoFechar={aoFechar} />);
    expect(container.textContent).toContain("Mensagem sugerida");
    const usar = [...container.querySelectorAll("button")].filter((b) => b.textContent.includes("Usar na conversa"));
    expect(usar.length).toBe(1);
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
    await clicar([...container.querySelectorAll("button")].find((b) => b.textContent === "Ver evidência 2"));
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]').textContent).toContain("não está entre as carregadas");
  });
});

describe("ajustes da v1: cobertura e números internos", () => {
  it("cobertura baixa: a nota fica esmaecida e avisa que não é conclusiva", async () => {
    const baixa = { ...analise, relatorio: { ...RELATORIO, atendimento_score: { ...RELATORIO.atendimento_score, score: 100, evaluated_weight: 10 } } };
    await render(<RelatorioDaAnalise analise={baixa} podeAgir contato={contato} />);
    expect(container.textContent).toContain("100/100 — 10% dos critérios avaliados");
    expect(container.textContent).toContain("Poucos critérios avaliados: a nota ainda não é conclusiva.");
    expect(container.querySelector('[aria-label="Atendimento Score"] [data-nota]').className).toContain("text-sub");
  });

  it("os números internos das mensagens não aparecem no texto, só nos links", async () => {
    const comNumeros = {
      ...analise,
      relatorio: {
        ...RELATORIO,
        diagnosis: {
          ...RELATORIO.diagnosis,
          summary: "Pediu agendar às 15h (#43) e mandou os dados (#46,#48).",
          main_bottleneck: { criterion: null, title: "Sem fechamento #49", explanation: "Duas falhas (#73 e #75).", evidence_message_ids: ["m6"] },
        },
      },
    };
    await render(<RelatorioDaAnalise analise={comNumeros} podeAgir contato={contato} aoVerMensagem={() => true} />);
    expect(container.textContent).toContain("Pediu agendar às 15h e mandou os dados.");
    expect(container.textContent).toContain("Sem fechamento");
    expect(container.textContent).not.toMatch(/#\d/);
    expect(botao("Ver evidência")).toBeTruthy();
  });
});

describe("o relatório visual", () => {
  const em = (minutos) => new Date(Date.UTC(2026, 8, 26, 13, 0) + minutos * 60 * 1000).toISOString();
  const comLinha = {
    ...analise,
    concluidaEm: em(5000),
    linhaDoTempo: {
      until: em(5000),
      messages: [
        { id: "m5", at: em(0), fromMe: false, author: "contato", snippet: "Quanto custa?" },
        { id: "m6", at: em(200), fromMe: true, author: "humano", snippet: "Fico à disposição" },
      ],
    },
    relatorio: {
      ...RELATORIO,
      diagnosis: { ...RELATORIO.diagnosis, red_flags: [{ code: "conversation_left_open", evidence_message_ids: ["m6"] }] },
      red_flags: [{ code: "conversation_left_open", reason: "", evidence_message_ids: ["m6"] }],
    },
  };

  it("linha do tempo: período, pausa, parada e legendas; clicar no ponto leva à mensagem", async () => {
    const aoVerMensagem = vi.fn(() => true);
    await render(<RelatorioDaAnalise analise={comLinha} podeAgir contato={contato} aoVerMensagem={aoVerMensagem} aoFechar={() => {}} />);
    const texto = container.textContent;
    expect(texto).toContain("2 mensagens, em 26/09");
    expect(texto).toContain("Onde aconteceu na conversa");
    expect(texto).toContain("3h20 até a equipe responder");
    expect(texto).toContain("parada");
    expect(texto).toContain("“Quanto custa?”");
    const ponto = container.querySelector('button[aria-label^="Equipe, 26/09"]');
    expect(ponto.getAttribute("aria-label")).toContain("Conversa ficou em aberto");
    await clicar(ponto);
    expect(aoVerMensagem).toHaveBeenCalledWith("m6");
  });

  it("sem linha do tempo (banco antes da migration), a seção não aparece", async () => {
    await render(<RelatorioDaAnalise analise={analise} podeAgir contato={contato} />);
    expect(container.textContent).not.toContain("Onde aconteceu na conversa");
  });

  it("ver mapa: as etapas, o gargalo e a volta ao relatório", async () => {
    await render(<RelatorioDaAnalise analise={comLinha} nome="Mariana" podeAgir contato={contato} />);
    await clicar([...container.querySelectorAll("button")].find((b) => b.textContent.includes("Ver mapa")));
    const mapa = container.querySelector('[aria-label="Mapa da conversa"]');
    expect(mapa.textContent).toContain("Mapa da conversa · Mariana");
    expect(mapa.textContent).toContain("Próximo passo");
    expect(mapa.textContent).toContain("o gargalo está aqui");
    expect(mapa.textContent).toContain("Fazer agora");
    expect(mapa.textContent).toContain("47/100");
    await clicar(botao("Voltar ao relatório"));
    expect(container.querySelector('[aria-label="Mapa da conversa"]')).toBeNull();
  });

  it("copiar resumo põe o texto na área de transferência e avisa", async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await render(<RelatorioDaAnalise analise={comLinha} nome="Mariana" podeAgir contato={contato} />);
    await clicar([...container.querySelectorAll("button")].find((b) => b.textContent.includes("Copiar resumo")));
    expect(writeText.mock.calls[0][0]).toContain("Nota: 47/100 — 55% dos critérios avaliados");
    expect(container.querySelector('[role="status"]').textContent).toBe("Resumo copiado.");
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
    expect(alvo.firstElementChild.classList.contains("outline-signal")).toBe(true);
    expect(mostrarMensagem(lista, "nao-existe")).toBe(false);
    expect(mostrarMensagem(null, "m1")).toBe(false);
  });
});
