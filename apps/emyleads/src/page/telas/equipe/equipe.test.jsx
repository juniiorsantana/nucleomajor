// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  playbook: { carregar: vi.fn(), salvar: vi.fn() },
  inteligencia: { leituras: vi.fn(), avaliarTeste: vi.fn(), statusAvaliacao: vi.fn() },
}));
vi.mock("../../../data/client", () => ({ api }));

import PlaybookComercial from "./PlaybookComercial";
import { AbaDesempenho, AvaliacaoDoJev, erroAoPedir, motivoDaAvaliacao } from "./AbasDoAgente";

let container;
let root;
const render = async (elemento) => {
  await act(async () => root.render(elemento));
  await act(async () => {});
};
const botao = (texto) => [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === texto);
const clicar = async (el) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const AGENTE = { id: "a1", name: "SDR", audience: "customer", isDefault: false, tone: "direto e consultivo" };

describe("Playbook comercial", () => {
  beforeEach(() => {
    api.playbook.carregar.mockResolvedValue({
      rascunho: { objecoes: [{ chave: "preco", nome: "Preço", resposta: "aula experimental" }] },
      publicado: {},
      versao: 0,
      publicadoEm: null,
    });
    api.inteligencia.leituras.mockResolvedValue([
      { contact_phone: "5565911112222", created_at: new Date().toISOString(), summary: { objecao_principal: { a: "concorrente", p: 0.9 } } },
      { contact_phone: "5565933334444", created_at: new Date().toISOString(), summary: { objecao_principal: { a: "outra", p: 0.8 } } },
    ]);
    api.playbook.salvar.mockResolvedValue({ saved: true, published: true, version: 1 });
  });

  it("mostra o rascunho, o estado de publicação e o que as conversas dizem", async () => {
    await render(<PlaybookComercial canWrite />);
    const texto = container.textContent;
    expect(texto).toContain("Playbook comercial");
    expect(texto).toContain("Ainda não publicado");
    expect(container.querySelector('input[value="Preço"]')).not.toBeNull();
    expect(texto).toContain("O que as conversas dizem");
    expect(texto).toContain("Concorrente");
    expect(texto).toContain("Objeção fora da lista: 1 conversa");
    // A conversa com objeção fora da lista aparece com o número protegido.
    expect(texto).toContain("•••• 4444");
  });

  it("acrescentar uma objeção vista nas conversas e publicar manda para o banco", async () => {
    await render(<PlaybookComercial canWrite />);
    await clicar(botao("Acrescentar"));
    expect(container.querySelector('input[value="Concorrente"]')).not.toBeNull();
    await clicar(botao("Publicar"));
    expect(api.playbook.salvar).toHaveBeenCalledTimes(1);
    const { conteudo, publicar } = api.playbook.salvar.mock.calls[0][0];
    expect(publicar).toBe(true);
    expect(conteudo.objecoes.map((o) => o.chave)).toEqual(["preco", "concorrente"]);
  });

  it("quem não pode escrever vê sem botões de salvar", async () => {
    await render(<PlaybookComercial canWrite={false} />);
    expect(botao("Publicar")).toBeUndefined();
    expect(botao("Acrescentar")).toBeUndefined();
  });
});

describe("Testar: avaliação do Jev", () => {
  it("pede, acompanha e mostra a avaliação agrupada", async () => {
    vi.useFakeTimers();
    api.playbook.carregar.mockResolvedValue({ rascunho: {}, publicado: { proximosPassos: [{ chave: "aula_experimental", nome: "Aula experimental" }] }, versao: 1 });
    api.inteligencia.avaliarTeste.mockResolvedValue({ comandoId: "c1" });
    api.inteligencia.statusAvaliacao
      .mockResolvedValueOnce({ situacao: "claimed", motivo: "", resultado: null })
      .mockResolvedValueOnce({
        situacao: "completed",
        motivo: "",
        resultado: { r: { segue_o_jeito: ["nao", 0.81], proximo_passo_oferecido: ["aula_experimental", 0.9], pergunta_sem_resposta: ["sim", 0.77] } },
      });
    await render(<AvaliacaoDoJev agent={AGENTE} canWrite />);
    expect(container.textContent).toContain("direto e consultivo");
    await clicar(botao("Avaliar com o Jev"));
    await act(async () => vi.advanceTimersByTimeAsync(2100));
    await act(async () => vi.advanceTimersByTimeAsync(2100));
    expect(api.inteligencia.avaliarTeste).toHaveBeenCalledWith(expect.objectContaining({ agentId: "a1" }));
    const texto = container.textContent;
    expect(texto).toContain("Seguiu o jeito do agente");
    expect(texto).toContain("Aula experimental");
    expect(texto).toContain("Pergunta sem resposta");
  });

  it("traduz os motivos de falha", () => {
    expect(motivoDaAvaliacao("insights_disabled")).toMatch(/não está ligado/);
    expect(motivoDaAvaliacao("jev_http_402")).toMatch(/jev_http_402/);
    expect(motivoDaAvaliacao("expired")).toMatch(/não pegou o pedido/);
    expect(erroAoPedir("conversation insights are disabled for this organization")).toMatch(/painel da plataforma/);
    expect(erroAoPedir("organization management required")).toMatch(/dono ou admin/);
  });
});

describe("Desempenho", () => {
  it("mostra as taxas do agente a partir das leituras", async () => {
    api.inteligencia.leituras.mockResolvedValue([
      { assistant_profile_id: "a1", summary: { pergunta_sem_resposta: { a: "sim", p: 0.9 }, temperatura: { a: "quente", p: 0.8 } }, ai_messages: 2, team_messages: 0 },
      { assistant_profile_id: "a1", summary: { pergunta_sem_resposta: { a: "nao", p: 0.9 } }, ai_messages: 0, team_messages: 1 },
      { assistant_profile_id: "outro", summary: { pergunta_sem_resposta: { a: "sim", p: 0.9 } }, ai_messages: 1, team_messages: 0 },
    ]);
    await render(<AbaDesempenho agent={AGENTE} />);
    const texto = container.textContent;
    expect(texto).toContain("2 conversas lidas");
    expect(texto).toContain("Pergunta sem resposta");
    expect(texto).toContain("50%");
    expect(texto).toContain("Só a IA");
  });

  it("sem leituras, explica quando elas aparecem", async () => {
    api.inteligencia.leituras.mockResolvedValue([]);
    await render(<AbaDesempenho agent={AGENTE} />);
    expect(container.textContent).toMatch(/parada por uma hora/);
  });
});
