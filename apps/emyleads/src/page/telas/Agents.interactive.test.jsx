// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * Teste INTERATIVO da Central de Agentes — ETAPA 12B / 12B.1.
 *
 * A suíte do app inteiro roda em `renderToStaticMarkup` (ambiente `node`, sem
 * DOM) e não clica em nada — `Agents.test.jsx` prova o que a tela MOSTRA, não
 * o que acontece quando alguém age nela. Este arquivo prova o caminho
 * completo: evento de DOM real → handler real do componente → chamada real a
 * `api.agents.*` → resposta (controlada) → re-render → estado visível.
 *
 * A fronteira mockada é `../../data/client`, que é a fronteira que o próprio
 * arquivo declara ("Painel e página de gestão falam SÓ com este arquivo").
 * Abaixo dela — chamar, web/operations.js, criarOperacoesAgents, o Supabase
 * real — já está coberto por `test/agent-management.test.mjs` (domínio puro)
 * e pela prova comportamental em Postgres descartável; nada aqui toca banco.
 *
 * Infra: `jsdom` é devDependency mínima (mesmo padrão de `fake-indexeddb`, já
 * usado neste projeto) — nenhum framework de teste novo.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agentsApi = {
  listar: vi.fn(),
  criar: vi.fn(),
  editar: vi.fn(),
  definirAtivo: vi.fn(),
  tornarPadrao: vi.fn(),
  listarSkills: vi.fn(),
  definirSkill: vi.fn(),
};

vi.mock("../../data/client", () => ({ api: { agents: agentsApi } }));

// Importados DEPOIS do mock (vitest hoisted o vi.mock acima de qualquer
// import, então isto pega a versão já substituída).
const { useState } = await import("react");
const { default: Agents } = await import("./Agents");

function agent(over = {}) {
  return {
    id: over.id ?? "a1", organizationId: "org-1", name: "Agente", slug: "agente",
    audience: "customer", role: null, tone: null, soulMarkdown: null,
    status: "active", isDefault: false, ...over,
  };
}

const CATALOGO_VENDAS = [
  { id: "sk-vendas", slug: "vendas", name: "Vendas", description: "Conduz até o fechamento.", audience: "customer", status: "published" },
  { id: "sk-pre", slug: "pre-qualificacao", name: "Pré-qualificação", description: "Descobre o perfil do contato.", audience: "customer", status: "published" },
];

/**
 * Espelha exatamente o que `Inteligencia.jsx` faz: mantém a lista em estado
 * próprio e `recarregar` chama `api.agents.listar()` de novo.
 */
function Harness({ inicial, catalogoSkills = [], canWrite = true }) {
  const [agents, setAgents] = useState(inicial);
  const [erro, setErro] = useState("");
  const recarregar = async () => {
    try {
      setAgents(await agentsApi.listar());
      setErro("");
    } catch (falha) {
      setErro(falha.message);
    }
  };
  return (
    <Agents agents={agents} catalogoSkills={catalogoSkills} canWrite={canWrite}
      recarregar={recarregar} carregando={false} erro={erro} />
  );
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.clearAllMocks();
  // Toda instância de DetalheAgent busca skills ao montar. Sem isto, um teste
  // que não configura listarSkills quebra com "undefined.then" — produção
  // sempre recebe uma Promise real; é o double do teste que precisa do padrão.
  agentsApi.listarSkills.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

async function montar(props) {
  await act(async () => {
    root = createRoot(container);
    root.render(<Harness {...props} />);
  });
}

async function tick() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function botoes() {
  return Array.from(container.querySelectorAll("button"));
}
function titulos() {
  // A tela monta desktop E mobile ao mesmo tempo no DOM — só classes CSS
  // escondem um dos dois, e jsdom não aplica layout. Por isso "h2" nunca é
  // singular fora do assistente de criação (que é um overlay único).
  return Array.from(container.querySelectorAll("h2")).map((h) => h.textContent);
}
function botaoComTexto(texto) {
  const achado = botoes().find((b) => b.textContent.trim() === texto);
  if (!achado) throw new Error(`botão "${texto}" não encontrado`);
  return achado;
}
function existeBotao(texto) {
  return botoes().some((b) => b.textContent.trim() === texto);
}
function inputPorRotulo(rotulo) {
  const labels = Array.from(container.querySelectorAll("label"));
  const label = labels.find((l) => l.querySelector(":scope > span")?.textContent === rotulo);
  if (!label) throw new Error(`campo "${rotulo}" não encontrado`);
  return label.querySelector("input, textarea");
}
function assistenteAberto() {
  return Boolean(container.querySelector('[role="progressbar"]'));
}
/**
 * Os cartões do assistente (preset, audiência) têm ícone + título + descrição
 * dentro do MESMO botão — o textContent concatenado nunca bate exatamente com
 * o rótulo. O rótulo em si é sempre um <span> folha (sem filhos); clicar o
 * botão mais próximo dele é o mesmo gesto que a pessoa faz na tela.
 */
function abrirDetalhes(texto) {
  const summary = Array.from(container.querySelectorAll("summary"))
    .find((s) => s.textContent.trim() === texto);
  if (!summary) throw new Error(`<summary> "${texto}" não encontrado`);
  return clicar(summary);
}
function clicarCard(rotulo) {
  const spans = Array.from(container.querySelectorAll("span"));
  const alvo = spans.find((s) => s.children.length === 0 && s.textContent.trim() === rotulo);
  if (!alvo) throw new Error(`cartão "${rotulo}" não encontrado`);
  const botao = alvo.closest("button");
  if (!botao) throw new Error(`cartão "${rotulo}" não está dentro de um botão`);
  return clicar(botao);
}

async function clicar(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function digitar(el, valor) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el), "value",
    ).set;
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CRIAR — assistente em etapas até a chamada real da API", () => {
  it("escolher um preset e seguir as 5 telas chama criar + as skills sugeridas, sem is_default", async () => {
    await montar({ inicial: [], catalogoSkills: CATALOGO_VENDAS });

    await clicar(botaoComTexto("Criar agente"));
    expect(assistenteAberto()).toBe(true);
    expect(container.textContent).toContain("O que você quer que esse agente faça?");

    // Passo 0: intenção. Escolher "Vendas" pré-preenche função, tom, soul e
    // as duas skills que a organização já publicou para esse preset.
    await clicarCard("Vendas");
    expect(container.textContent).toContain("Com quem esse agente vai conversar?");

    // Passo 1: público. O preset já sugeriu "customer"; confirmar avança.
    await clicarCard("Clientes e leads");
    expect(container.textContent).toContain("Como ele se chama?");

    // Passo 2: identidade. Função e tom já vieram do preset.
    expect(inputPorRotulo("Função").value).toBe("Vendas");
    expect(existeBotao("Persuasivo")).toBe(true);
    await digitar(inputPorRotulo("Nome"), "Emília");
    await clicar(botaoComTexto("Continuar"));
    expect(container.textContent).toContain("Personalidade e instruções");

    // Passo 3: personalidade, já sugerida pelo preset — segue sem editar.
    expect(container.textContent).toMatch(/conduz para o fechamento/i);
    await clicar(botaoComTexto("Continuar"));
    expect(container.textContent).toContain("O que esse agente sabe fazer?");

    // Passo 4: habilidades, as duas do preset já vêm marcadas.
    expect(container.textContent).toContain("Vendas");
    expect(container.textContent).toContain("Pré-qualificação");

    agentsApi.criar.mockResolvedValueOnce(agent({ id: "emilia", name: "Emília", role: "Vendas" }));
    agentsApi.definirSkill.mockResolvedValue({});
    agentsApi.listar.mockResolvedValueOnce([agent({ id: "emilia", name: "Emília", role: "Vendas" })]);

    await clicar(botaoComTexto("Concluir"));
    await tick();

    // A chamada de criação, com o payload real que o assistente monta.
    expect(agentsApi.criar).toHaveBeenCalledTimes(1);
    const enviado = agentsApi.criar.mock.calls[0][0];
    expect(enviado).toMatchObject({ name: "Emília", audience: "customer", role: "Vendas" });
    expect(enviado.tone).toMatch(/persuasivo/i);
    expect(enviado).not.toHaveProperty("isDefault");
    expect(enviado).not.toHaveProperty("is_default");
    expect(enviado).not.toHaveProperty("skillIds"); // órfão de UX, nunca vai pro comando de criação

    // As duas skills sugeridas foram vinculadas ao agente RECÉM-CRIADO.
    expect(agentsApi.definirSkill).toHaveBeenCalledTimes(2);
    for (const chamada of agentsApi.definirSkill.mock.calls) {
      expect(chamada[0]).toMatchObject({ agentId: "emilia", enabled: true });
    }
    expect(agentsApi.definirSkill.mock.calls.map((c) => c[0].skillId).sort())
      .toEqual(["sk-pre", "sk-vendas"]);

    // Fechou o assistente e recarregou do servidor — não é otimista.
    expect(assistenteAberto()).toBe(false);
    expect(agentsApi.listar).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Emília");
  });

  it("'Criar do zero' não pré-preenche nada, e pede a audiência no passo seguinte", async () => {
    await montar({ inicial: [] });
    await clicar(botaoComTexto("Criar agente"));
    await clicarCard("Criar do zero");

    expect(container.textContent).toContain("Com quem esse agente vai conversar?");
    await clicarCard("Minha equipe");

    expect(inputPorRotulo("Função").value).toBe("");
    expect(inputPorRotulo("Nome").value).toBe("");

    // Sem nome, "Continuar" fica desabilitado — não avança em branco.
    expect(botaoComTexto("Continuar").disabled).toBe(true);
  });

  it("o identificador técnico fica em Configurações avançadas, derivado do nome", async () => {
    await montar({ inicial: [] });
    await clicar(botaoComTexto("Criar agente"));
    await clicarCard("Criar do zero");
    await clicarCard("Clientes e leads");

    // Fechado por padrão: o identificador não aparece no fluxo principal.
    expect(container.querySelector('input[value=""]')).toBeTruthy();
    await digitar(inputPorRotulo("Nome"), "Agente Teste");

    await abrirDetalhes("Configurações avançadas");
    expect(inputPorRotulo("Identificador técnico").value).toBe("agente-teste");
  });

  it("erro na criação (identificador duplicado) mantém o assistente aberto e não cria fantasma", async () => {
    await montar({ inicial: [agent({ id: "x", name: "Existente" })] });
    await clicar(botaoComTexto("Criar agente"));
    await clicarCard("Criar do zero");
    await clicarCard("Clientes e leads");
    await digitar(inputPorRotulo("Nome"), "Existente");
    await clicar(botaoComTexto("Continuar"));
    await clicar(botaoComTexto("Continuar"));

    agentsApi.criar.mockRejectedValueOnce({
      code: "AGENT_SLUG_ALREADY_EXISTS",
      message: 'duplicate key value violates unique constraint "assistant_profiles_organization_slug_key"',
    });
    await clicar(botaoComTexto("Concluir"));
    await tick();

    // Mensagem amigável, nunca o texto cru do banco.
    expect(container.textContent).toContain("Já existe um agente com esse identificador");
    expect(container.textContent).not.toMatch(/constraint|duplicate key/i);

    // O assistente continua aberto — não fica "meio sucesso".
    expect(assistenteAberto()).toBe(true);
    expect(agentsApi.listar).not.toHaveBeenCalled();
  });

  it("fechar pelo X não chama a API e não deixa nada preso", async () => {
    await montar({ inicial: [] });
    await clicar(botaoComTexto("Criar agente"));
    expect(assistenteAberto()).toBe(true);

    await clicar(container.querySelector('button[aria-label="Fechar"]'));

    expect(assistenteAberto()).toBe(false);
    expect(agentsApi.criar).not.toHaveBeenCalled();
    expect(existeBotao("Criar agente")).toBe(true);
  });
});

describe("EDITAR — não vaza campo estrutural", () => {
  it("editar nome envia só os campos permitidos, e a UI reflete o novo estado", async () => {
    await montar({ inicial: [agent({ id: "closer", name: "Closer" })] });

    await clicar(container.querySelector('button[aria-pressed]'));
    await tick();

    const campoNome = inputPorRotulo("Nome");
    expect(campoNome.value).toBe("Closer");
    await digitar(campoNome, "Closer Noturno");

    agentsApi.editar.mockResolvedValueOnce(agent({ id: "closer", name: "Closer Noturno" }));
    agentsApi.listar.mockResolvedValueOnce([agent({ id: "closer", name: "Closer Noturno" })]);

    await clicar(botaoComTexto("Salvar"));
    await tick();

    expect(agentsApi.editar).toHaveBeenCalledTimes(1);
    const enviado = agentsApi.editar.mock.calls[0][0];
    expect(enviado).toMatchObject({ agentId: "closer", name: "Closer Noturno" });
    for (const proibido of ["organization_id", "organizationId", "audience", "is_default", "isDefault"]) {
      expect(enviado).not.toHaveProperty(proibido);
    }

    expect(agentsApi.listar).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Closer Noturno");
  });

  it("erro ao editar não mente: mostra o erro e não apaga o que foi digitado", async () => {
    await montar({ inicial: [agent({ id: "closer", name: "Closer" })] });
    await clicar(container.querySelector('button[aria-pressed]'));
    await tick();

    await digitar(inputPorRotulo("Nome"), "Closer Editado");
    agentsApi.editar.mockRejectedValueOnce({ code: "AGENT_FORBIDDEN", message: "sem permissão" });

    await clicar(botaoComTexto("Salvar"));
    await tick();

    expect(container.textContent).toContain("Você não tem permissão");
    expect(container.textContent).not.toContain("Salvo.");
    expect(agentsApi.listar).not.toHaveBeenCalled();
    expect(inputPorRotulo("Nome").value).toBe("Closer Editado");
  });
});

describe("PRINCIPAL — uma chamada só, nunca dois updates", () => {
  const elenco = () => [
    agent({ id: "emilia", name: "Emilia", isDefault: true }),
    agent({ id: "closer", name: "Closer", isDefault: false }),
  ];

  it("tornar principal chama SOMENTE agents.tornarPadrao, com confirmação antes", async () => {
    await montar({ inicial: elenco() });

    const cartaoCloser = botoes().find((b) => b.textContent.includes("Closer"));
    await clicar(cartaoCloser);
    await tick();

    await clicar(botaoComTexto("Tornar principal"));
    expect(container.textContent).toContain("Closer passa a ser o agente inicial");
    expect(container.textContent).toContain("Emilia");
    expect(agentsApi.tornarPadrao).not.toHaveBeenCalled();

    agentsApi.tornarPadrao.mockResolvedValueOnce({ changed: true, agentId: "closer" });
    agentsApi.listar.mockResolvedValueOnce([
      agent({ id: "emilia", name: "Emilia", isDefault: false }),
      agent({ id: "closer", name: "Closer", isDefault: true }),
    ]);

    const confirmar = Array.from(container.querySelectorAll('[role="alertdialog"] button'))
      .find((b) => b.textContent.trim() === "Tornar principal");
    await clicar(confirmar);
    await tick();

    expect(agentsApi.tornarPadrao).toHaveBeenCalledTimes(1);
    expect(agentsApi.tornarPadrao).toHaveBeenCalledWith({ agentId: "closer" });
    expect(agentsApi.editar).not.toHaveBeenCalled();
    expect(agentsApi.definirAtivo).not.toHaveBeenCalled();

    expect(container.textContent).toContain("Agente principal de clientes");
  });

  it("falha ao trocar o principal preserva o estado anterior na tela", async () => {
    await montar({ inicial: elenco() });
    const cartaoCloser = botoes().find((b) => b.textContent.includes("Closer"));
    await clicar(cartaoCloser);
    await tick();

    await clicar(botaoComTexto("Tornar principal"));
    agentsApi.tornarPadrao.mockRejectedValueOnce({ code: "AGENT_FORBIDDEN", message: "sem permissão" });

    const confirmar = Array.from(container.querySelectorAll('[role="alertdialog"] button'))
      .find((b) => b.textContent.trim() === "Tornar principal");
    await clicar(confirmar);
    await tick();

    expect(container.textContent).toContain("Você não tem permissão");
    expect(agentsApi.listar).not.toHaveBeenCalled();
    expect(existeBotao("Tornar principal")).toBe(true);
  });
});

describe("DESATIVAR O PRINCIPAL — aviso antes, sem autopromoção", () => {
  it("avisa antes de desativar, muda só active, e não promove ninguém", async () => {
    const emilia = agent({ id: "emilia", name: "Emilia", isDefault: true, status: "active" });
    await montar({ inicial: [emilia] });

    await clicar(botoes().find((b) => b.textContent.includes("Emilia")));
    await tick();

    await clicar(botaoComTexto("Desativar"));
    expect(container.textContent).toMatch(/fica.*sem atendimento/i);
    expect(container.textContent).toMatch(/Nenhum outro agente é promovido/i);
    expect(agentsApi.definirAtivo).not.toHaveBeenCalled();

    agentsApi.definirAtivo.mockResolvedValueOnce(agent({ ...emilia, status: "inactive" }));
    agentsApi.listar.mockResolvedValueOnce([agent({ ...emilia, status: "inactive" })]);

    const confirmar = Array.from(container.querySelectorAll('[role="alertdialog"] button'))
      .find((b) => b.textContent.trim() === "Desativar mesmo assim");
    await clicar(confirmar);
    await tick();

    expect(agentsApi.definirAtivo).toHaveBeenCalledWith({ agentId: "emilia", active: false });
    expect(agentsApi.tornarPadrao).not.toHaveBeenCalled();

    // Estado válido e simultâneo: principal E inativo ao mesmo tempo.
    expect(container.textContent).toContain("Agente principal de clientes");
    expect(container.textContent).toContain("Ativar");
  });
});

describe("HABILIDADES — vincular/desvincular, N:N de verdade", () => {
  it("remover do agente A não afeta o agente B", async () => {
    const skillX = { id: "sx", name: "Vendas", slug: "vendas", audience: "customer", status: "published" };
    const A = agent({ id: "a", name: "Agente A" });
    const B = agent({ id: "b", name: "Agente B" });

    agentsApi.listarSkills.mockImplementation(async () =>
      [{ skill_id: "sx", enabled: true, priority: 10 }]);

    await montar({ inicial: [A, B], catalogoSkills: [skillX] });

    await clicar(botoes().find((b) => b.textContent.includes("Agente A")));
    await tick();
    await clicar(botaoComTexto("O que sabe fazer"));
    await tick();

    expect(container.textContent).toContain("Vendas");
    expect(existeBotao("Remover")).toBe(true);

    agentsApi.definirSkill.mockResolvedValueOnce({});
    agentsApi.listarSkills.mockImplementation(async ({ agentId }) =>
      agentId === "a" ? [] : [{ skill_id: "sx", enabled: true, priority: 10 }]);

    await clicar(botaoComTexto("Remover"));
    await tick();

    expect(agentsApi.definirSkill).toHaveBeenCalledWith({ agentId: "a", skillId: "sx", enabled: false });
    expect(container.textContent).toContain("Este agente ainda não sabe fazer nada");

    await clicar(botoes().find((b) => b.textContent.includes("Agente B")));
    await tick();
    await clicar(botaoComTexto("O que sabe fazer"));
    await tick();

    expect(container.textContent).toContain("Vendas");
    expect(agentsApi.definirSkill).toHaveBeenCalledTimes(1);
  });

  it("adicionar uma habilidade disponível chama definirSkill(enabled: true) e ela migra de seção", async () => {
    const skillY = { id: "sy", name: "Agenda", slug: "agenda", audience: "customer", status: "published" };
    const A = agent({ id: "a", name: "Agente A" });
    agentsApi.listarSkills.mockResolvedValue([]);

    await montar({ inicial: [A], catalogoSkills: [skillY] });
    await clicar(botoes().find((b) => b.textContent.includes("Agente A")));
    await tick();
    await clicar(botaoComTexto("O que sabe fazer"));
    await tick();

    expect(container.textContent).toContain("Pode aprender (1)");
    expect(existeBotao("Adicionar")).toBe(true);

    agentsApi.definirSkill.mockResolvedValueOnce({});
    agentsApi.listarSkills.mockResolvedValueOnce([{ skill_id: "sy", enabled: true, priority: 100 }]);

    await clicar(botaoComTexto("Adicionar"));
    await tick();

    expect(agentsApi.definirSkill).toHaveBeenCalledWith({ agentId: "a", skillId: "sy", enabled: true });
    expect(container.textContent).toContain("Sabe fazer (1)");
    expect(existeBotao("Adicionar")).toBe(false);
  });
});

describe("MOBILE — navegação de uma tela por vez", () => {
  function painelMobile() {
    const topo = Array.from(container.querySelectorAll(":scope > div"));
    const achado = topo.find((d) => d.className.includes("md:hidden") && d.className.includes("flex"));
    if (!achado) throw new Error("painel mobile não encontrado");
    return achado;
  }

  it("lista → agente → detalhe → voltar, tudo dentro do painel mobile", async () => {
    await montar({ inicial: [agent({ id: "emilia", name: "Emilia", isDefault: true })] });

    const painel = painelMobile();
    expect(painel.textContent).toContain("Emilia");
    expect(painel.textContent).not.toContain("Selecione um agente");

    const cartao = Array.from(painel.querySelectorAll("button"))
      .find((b) => b.textContent.includes("Emilia"));
    await clicar(cartao);
    await tick();

    expect(painelMobile().textContent).toContain("Agente principal de clientes");
    expect(painelMobile().textContent).not.toContain("Seus agentes");

    const voltar = painelMobile().querySelector('button[aria-label="Voltar"]');
    expect(voltar).toBeTruthy();
    await clicar(voltar);
    await tick();

    expect(painelMobile().textContent).toContain("Seus agentes");
  });

  it("assistente de criação no mobile: X fecha sem deixar nada preso", async () => {
    await montar({ inicial: [] });
    await clicar(botaoComTexto("Criar agente"));
    expect(assistenteAberto()).toBe(true);

    await clicar(container.querySelector('button[aria-label="Fechar"]'));

    expect(assistenteAberto()).toBe(false);
    expect(agentsApi.criar).not.toHaveBeenCalled();
    expect(existeBotao("Criar agente")).toBe(true);
  });

  it("cada etapa do assistente é uma tela própria — 'Voltar' funciona", async () => {
    await montar({ inicial: [] });
    await clicar(botaoComTexto("Criar agente"));
    await clicarCard("Vendas");
    expect(container.textContent).toContain("Com quem esse agente vai conversar?");

    await clicar(container.querySelector('button[aria-label="Voltar"]'));
    expect(container.textContent).toContain("O que você quer que esse agente faça?");
  });
});
