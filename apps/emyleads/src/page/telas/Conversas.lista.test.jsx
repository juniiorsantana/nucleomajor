// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { janelaDaLista } from "./conversas/janelaDaLista";

/**
 * A lista virtualizada: só as linhas que cabem viram elementos, e a busca, os
 * filtros, a ordem e a conversa selecionada continuam como antes dela. A tela
 * é a de verdade; os hooks de dados são trocados por uma lista fixa.
 */

const estadoConversas = { conversas: [], atual: null, setAtual: vi.fn() };

vi.mock("./conversas/useConversas", () => ({
  useConversas: () => ({
    modelos: [],
    mensagens: [],
    equipe: [],
    leituras: {},
    erro: "",
    aviso: "",
    recarregarLista: () => Promise.resolve(),
    enviar: vi.fn(),
    reenviar: vi.fn(),
    verificarNumero: vi.fn(),
    iniciarConversa: vi.fn(),
    trocarDono: vi.fn(),
    guardarBaralho: vi.fn(),
    ...estadoConversas,
  }),
}));
vi.mock("./conversas/useConexao", () => ({
  useConexao: () => ({ conexao: null, resumo: null, carregado: true, recarregar: vi.fn() }),
}));
vi.mock("./conversas/usePareamento", () => ({
  usePareamento: () => ({ qr: null, pedindo: false, pedir: vi.fn(), ler: vi.fn() }),
}));
vi.mock("./conversas/useRolagemConversa", () => ({
  useRolagemConversa: () => ({ rolagem: { current: null }, aoRolar: vi.fn(), noFim: true, novas: 0, irParaOFim: vi.fn() }),
}));

const { default: Conversas, ordenarPorMensagemMaisRecente, passaFiltro } = await import("./Conversas");

const ALTURA = 67;
const DONOS = ["bot", "ia", "humano"];

/** 2 mil conversas: quase seis vezes a meta de 300 e mais de quatro vezes a Adriani. */
function gerarConversas(total = 2000) {
  return Array.from({ length: total }, (_, i) => ({
    id: `conn:55119${String(i).padStart(8, "0")}`,
    grupo: i % 10 === 9,
    contactId: null,
    nome: i % 10 === 9 ? `Grupo ${i}` : `Pessoa ${i}`,
    empresa: i % 7 === 0 ? "Clínica Sorriso" : "",
    cargo: "",
    fotoUrl: null,
    telefone: `55119${String(i).padStart(8, "0")}`,
    dono: DONOS[i % 3],
    atendenteId: null,
    atendenteNome: i % 3 === 2 ? "Ana" : "",
    hora: "09:41",
    // Fora de ordem de propósito: quem ordena é a tela.
    ultimaMensagemEm: ((i * 7919) % 2000) * 1000,
    naoLidas: i % 5 === 0 ? 2 : 0,
    previa: i % 11 === 0 ? "quero agendar uma consulta" : "obrigado",
    saiu: false,
    lido: false,
    fixado: false,
  }));
}

const dados = { contatos: [], negocios: [], tarefas: [], notas: [], tags: [], estagios: [] };
const sessao = { organizacaoAtual: { id: "org-a", papel: "owner" }, usuario: { perfil: {} } };

let container;
let root;

async function renderizar() {
  await act(async () => {
    root.render(<Conversas dados={dados} sessao={sessao} />);
  });
}

const caixaDaLista = () => container.querySelector("[aria-hidden='true']").parentElement;
const linhas = () => [...caixaDaLista().querySelectorAll(":scope > div > button")];
const nomes = () => linhas().map((b) => b.querySelector(".truncate").textContent);
const contador = () => container.querySelector("h1").nextElementSibling.textContent;

async function rolarAte(px) {
  const caixa = caixaDaLista();
  Object.defineProperty(caixa, "scrollTop", { value: px, configurable: true });
  await act(async () => {
    caixa.dispatchEvent(new Event("scroll"));
  });
}

/** Rola do começo ao fim e devolve os nomes na ordem em que passaram. */
async function nomesRolandoTudo(total) {
  const vistos = [];
  for (let px = 0; px <= total * ALTURA; px += ALTURA * 10) {
    await rolarAte(px);
    for (const nome of nomes()) if (!vistos.includes(nome)) vistos.push(nome);
  }
  return vistos;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  estadoConversas.conversas = gerarConversas();
  estadoConversas.atual = null;
  estadoConversas.setAtual = vi.fn();
  // A caixa da lista com 600 px de altura, como numa tela de notebook.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete HTMLElement.prototype.clientHeight;
});

describe("janela da lista", () => {
  it("desenha só o que cabe, com folga, e espaçadores do tamanho do resto", () => {
    expect(janelaDaLista({ total: 2000, alturaLinha: 67, primeiraVisivel: 0, alturaVisivel: 600 }))
      .toEqual({ inicio: 0, fim: 17, antes: 0, depois: 1983 * 67 });
    expect(janelaDaLista({ total: 2000, alturaLinha: 67, primeiraVisivel: 1000, alturaVisivel: 600 }))
      .toEqual({ inicio: 992, fim: 1017, antes: 992 * 67, depois: 983 * 67 });
    expect(janelaDaLista({ total: 2000, alturaLinha: 67, primeiraVisivel: 5000, alturaVisivel: 600 }).fim).toBe(2000);
  });

  it("sem saber a altura da caixa mostra um mínimo, e lista vazia não desenha nada", () => {
    expect(janelaDaLista({ total: 100, alturaLinha: 67 })).toMatchObject({ inicio: 0, fim: 38 });
    expect(janelaDaLista({ total: 0, alturaLinha: 67 })).toEqual({ inicio: 0, fim: 0, antes: 0, depois: 0 });
  });
});

describe("lista de conversas com 2 mil linhas", () => {
  it("só as linhas visíveis viram elementos, e a rolagem passa por todas na ordem de hoje", async () => {
    const inicio = performance.now();
    await renderizar();
    const tempo = performance.now() - inicio;
    const esperado = ordenarPorMensagemMaisRecente(estadoConversas.conversas.filter((c) => !c.grupo)).map((c) => c.nome);

    expect(contador()).toBe(String(esperado.length));
    expect(linhas().length).toBeLessThanOrEqual(30);
    expect(nomes()).toEqual(esperado.slice(0, linhas().length));

    const espaco = [...caixaDaLista().children];
    const alturaTotal = parseInt(espaco[0].style.height || 0, 10) + linhas().length * ALTURA + parseInt(espaco.at(-1).style.height, 10);
    expect(alturaTotal).toBe(esperado.length * ALTURA);

    expect(await nomesRolandoTudo(esperado.length)).toEqual(esperado);
    expect(linhas().length).toBeLessThanOrEqual(30);
    console.log(`2 mil conversas: ${linhas().length} linhas desenhadas, primeira montagem em ${Math.round(tempo)} ms`);
  }, 30_000);

  it("a busca mostra o mesmo que hoje", async () => {
    await renderizar();
    const input = container.querySelector("input[placeholder='Buscar conversa ou contato']");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "Sorriso");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const esperado = ordenarPorMensagemMaisRecente(
      estadoConversas.conversas.filter((c) => !c.grupo && `${c.nome} ${c.empresa} ${c.previa} ${c.atendenteNome}`.toLowerCase().includes("sorriso"))
    ).map((c) => c.nome);
    expect(contador()).toBe(String(esperado.length));
    expect(await nomesRolandoTudo(esperado.length)).toEqual(esperado);
  }, 30_000);

  it("os filtros e a aba de grupos mostram o mesmo que hoje", async () => {
    await renderizar();
    const clicar = async (rotulo) => {
      const botao = [...container.querySelectorAll("button[role='tab']")].find((b) => b.textContent.startsWith(rotulo));
      await act(async () => botao.click());
    };

    await clicar("Não lidas");
    const naoLidas = ordenarPorMensagemMaisRecente(
      estadoConversas.conversas.filter((c) => !c.grupo && passaFiltro(c, "naolidas"))
    ).map((c) => c.nome);
    expect(contador()).toBe(String(naoLidas.length));
    expect(await nomesRolandoTudo(naoLidas.length)).toEqual(naoLidas);

    await clicar("Grupos");
    const grupos = ordenarPorMensagemMaisRecente(estadoConversas.conversas.filter((c) => c.grupo)).map((c) => c.nome);
    expect(contador()).toBe(String(grupos.length));
    expect(await nomesRolandoTudo(grupos.length)).toEqual(grupos);
  }, 30_000);

  it("clicar numa linha do meio da lista seleciona a conversa, e ela continua marcada depois de rolar", async () => {
    await renderizar();
    await rolarAte(ALTURA * 1200);
    const alvo = linhas()[10];
    const nome = alvo.querySelector(".truncate").textContent;
    const id = estadoConversas.conversas.find((c) => c.nome === nome).id;
    await act(async () => alvo.click());
    expect(estadoConversas.setAtual).toHaveBeenCalledWith(id);

    estadoConversas.atual = id;
    await renderizar();
    await rolarAte(0);
    await rolarAte(ALTURA * 1200);
    const marcadas = linhas().filter((b) => b.className.includes("bg-surface-hover"));
    expect(marcadas.map((b) => b.querySelector(".truncate").textContent)).toEqual([nome]);
  }, 30_000);
});
