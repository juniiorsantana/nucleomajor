// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * Teste INTERATIVO do assistente de criação de habilidade privada.
 *
 * Existe por causa de um defeito concreto: o assistente gravava o `spec` sem
 * `instructionsMarkdown`, e o resolvedor de clientes RECUSA uma habilidade sem
 * instruções (`published skill instructions are invalid`, em
 * `20260824210000_fase_h3_orquestracao_contextual.sql:347-349`). O resultado era
 * uma habilidade que a tela publicava com sucesso e que derrubava a primeira
 * conversa de cliente que caísse nela.
 *
 * Por isso o que este arquivo prova não é "o campo aparece" — é que a tela NÃO
 * consegue mais publicar uma habilidade que o banco vai recusar, e que o texto
 * escrito chega ao `spec` com o nome que o banco lê.
 *
 * Mesma fronteira e mesmas ferramentas de `Agents.interactive.test.jsx`:
 * `../../data/client` é mockado, jsdom é o ambiente, nada aqui toca banco.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inteligenciaApi = { salvarSkill: vi.fn() };

vi.mock("../../data/client", () => ({ api: { inteligencia: inteligenciaApi } }));

const { SkillWizard } = await import("./Inteligencia");
const { INSTRUCTIONS_MIN } = await import("../../../../../packages/intelligence/src/skill-limits.mjs");

const DADOS = {
  profiles: [{ id: "perfil-cliente", audience: "customer" }, { id: "perfil-equipe", audience: "internal" }],
  collections: [],
};

/** Uma instrução que passa no piso do banco, sem depender de sorte de contagem. */
const INSTRUCAO_VALIDA = `# Venda de site\n\n${"Pergunte o segmento antes de falar de preço. ".repeat(4)}`;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.clearAllMocks();
  inteligenciaApi.salvarSkill.mockResolvedValue({ id: "sk-nova" });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

async function montar() {
  await act(async () => {
    root = createRoot(container);
    root.render(<SkillWizard data={DADOS} close={() => {}} saved={async () => {}} fail={() => {}} />);
  });
}

function botoes() {
  return Array.from(container.querySelectorAll("button"));
}

function botaoComTexto(texto) {
  const achado = botoes().find((b) => b.textContent.trim() === texto);
  if (!achado) throw new Error(`botão "${texto}" não encontrado`);
  return achado;
}

function campoPorPlaceholder(placeholder) {
  const achado = container.querySelector(`[placeholder="${placeholder}"]`);
  if (!achado) throw new Error(`campo "${placeholder}" não encontrado`);
  return achado;
}

/** O passo é uma pilha numerada no topo: "2. Instruções". */
async function irPara(rotulo) {
  const chip = botoes().find((b) => b.textContent.trim().endsWith(rotulo));
  if (!chip) throw new Error(`passo "${rotulo}" não encontrado`);
  await clicar(chip);
}

async function clicar(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function digitar(el, valor) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Nome e objetivo: o que a tela exigia ANTES desta correção, e nada além. */
async function preencherIdentidade() {
  await digitar(campoPorPlaceholder("Nome do skill"), "Venda de site e tráfego");
  await digitar(campoPorPlaceholder("Qual resultado este skill produz?"), "Qualificar quem pede orçamento.");
}

async function escreverInstrucao(texto) {
  await irPara("Instruções");
  await digitar(container.querySelector("textarea"), texto);
}

describe("assistente de habilidade privada — instruções", () => {
  it("tem um passo de instruções", async () => {
    await montar();
    expect(botoes().some((b) => b.textContent.trim() === "2. Instruções")).toBe(true);
  });

  it("não publica uma habilidade sem instruções, que é o que o banco recusa", async () => {
    await montar();
    await preencherIdentidade();
    await irPara("Publicar");

    const publicar = botaoComTexto("Publicar skill");
    expect(publicar.disabled).toBe(true);

    await clicar(publicar);
    expect(inteligenciaApi.salvarSkill).not.toHaveBeenCalled();
  });

  it("não publica instrução curta demais para o piso do banco", async () => {
    await montar();
    await preencherIdentidade();
    await escreverInstrucao("# Venda\n\nPergunte o segmento.");
    await irPara("Publicar");

    expect("# Venda\n\nPergunte o segmento.".length).toBeLessThan(INSTRUCTIONS_MIN);
    expect(botaoComTexto("Publicar skill").disabled).toBe(true);
  });

  it("leva a instrução ao spec com o nome que o banco lê", async () => {
    await montar();
    await preencherIdentidade();
    await escreverInstrucao(INSTRUCAO_VALIDA);
    await irPara("Publicar");

    const publicar = botaoComTexto("Publicar skill");
    expect(publicar.disabled).toBe(false);
    await clicar(publicar);

    expect(inteligenciaApi.salvarSkill).toHaveBeenCalledTimes(1);
    const [enviado] = inteligenciaApi.salvarSkill.mock.calls[0];
    expect(enviado.spec.instructionsMarkdown).toBe(INSTRUCAO_VALIDA.trim());
    // E o resto do spec continua o que era: a correção acrescenta, não troca.
    expect(enviado.spec.objective).toBe("Qualificar quem pede orçamento.");
    expect(enviado.spec).toHaveProperty("activation");
    expect(enviado.spec).toHaveProperty("allowedTools");
  });

  it("vincula só os perfis da audiência escolhida", async () => {
    await montar();
    await preencherIdentidade();
    await escreverInstrucao(INSTRUCAO_VALIDA);
    await irPara("Publicar");
    await clicar(botaoComTexto("Publicar skill"));

    const [enviado] = inteligenciaApi.salvarSkill.mock.calls[0];
    expect(enviado.profileIds).toEqual(["perfil-cliente"]);
  });
});
