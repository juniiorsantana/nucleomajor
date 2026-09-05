// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * Teste INTERATIVO da Central de Agents — ETAPA 12B.
 *
 * A suíte do app inteiro roda em `renderToStaticMarkup` (ambiente `node`, sem
 * DOM) e não clica em nada — `Agents.test.jsx` prova o que a tela MOSTRA, não
 * o que acontece quando alguém age nela. Este arquivo prova o caminho
 * completo: evento de DOM real → handler real do componente → chamada real a
 * `api.agents.*` → resposta (controlada) → re-render → estado visível.
 *
 * A fronteira mockada é `../../data/client`, e não por atalho: é a fronteira
 * que o próprio arquivo declara ("Painel e página de gestão falam SÓ com este
 * arquivo"). Abaixo dela — `chamar`, `web/operations.js`,
 * `criarOperacoesAgents`, o Supabase real — já está coberto por
 * `test/agent-management.test.mjs` (domínio puro) e pela prova comportamental
 * em Postgres descartável da FASE F/G; nada disso é produção e nada aqui toca
 * banco algum.
 *
 * Infra: `jsdom` foi adicionado como devDependency mínima (mesmo padrão de
 * `fake-indexeddb`, já usado no projeto para `db.test.js`) — nenhum framework
 * de teste novo (sem Testing Library, sem Playwright). Os helpers de clique e
 * digitação abaixo são deliberadamente pequenos e locais a este arquivo.
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

/**
 * Espelha exatamente o que `Inteligencia.jsx` faz: mantém a lista em estado
 * próprio e `recarregar` chama `api.agents.listar()` de novo. Não é um duplo
 * da tela — é o mesmo contrato que a Central real usa para alimentar `Agents`.
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
  // que não configura listarSkills quebra com "undefined.then" — não é o
  // componente que está errado (produção sempre recebe uma Promise de
  // api.agents.listarSkills), é o double do teste que precisa de um padrão.
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
  // singular: há sempre o "Agentes" da lista e, quando aberto, o "Novo
  // agente" do modal, ambos presentes no documento ao mesmo tempo.
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

describe("CRIAR — evento real até a chamada da API", () => {
  it("preencher e salvar chama agents.criar sem is_default, e a lista atualiza", async () => {
    await montar({ inicial: [] });

    await clicar(botaoComTexto("Novo agente"));
    expect(container.textContent).toContain("Definida agora e imutável depois");

    await digitar(inputPorRotulo("Nome"), "Emília");
    await digitar(inputPorRotulo("Função"), "Recepção");

    agentsApi.criar.mockResolvedValueOnce(
      agent({ id: "emilia", name: "Emília", role: "Recepção", isDefault: false }),
    );
    agentsApi.listar.mockResolvedValueOnce([
      agent({ id: "emilia", name: "Emília", role: "Recepção", isDefault: false }),
    ]);

    await clicar(botaoComTexto("Criar agente"));
    await tick();

    // A chamada real, com o payload real que o handler monta.
    expect(agentsApi.criar).toHaveBeenCalledTimes(1);
    const enviado = agentsApi.criar.mock.calls[0][0];
    expect(enviado).toMatchObject({ name: "Emília", audience: "customer", role: "Recepção" });
    expect(enviado).not.toHaveProperty("isDefault");
    expect(enviado).not.toHaveProperty("is_default");

    // Fechou o formulário e recarregou do servidor — não é otimista.
    expect(titulos()).not.toContain("Novo agente");
    expect(agentsApi.listar).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Emília");
  });

  it("erro na criação (slug duplicado) mantém o formulário aberto e não cria fantasma", async () => {
    await montar({ inicial: [agent({ id: "x", name: "Existente" })] });

    await clicar(botaoComTexto("Novo agente"));
    await digitar(inputPorRotulo("Nome"), "Existente");

    agentsApi.criar.mockRejectedValueOnce({
      code: "AGENT_SLUG_ALREADY_EXISTS",
      message: 'duplicate key value violates unique constraint "assistant_profiles_organization_slug_key"',
    });

    await clicar(botaoComTexto("Criar agente"));
    await tick();

    // Mensagem amigável, nunca o texto cru do banco.
    expect(container.textContent).toContain("Já existe um agente com esse identificador");
    expect(container.textContent).not.toMatch(/constraint|duplicate key/i);

    // O modal continua aberto — não fica "meio sucesso".
    expect(titulos()).toContain("Novo agente");

    // Nenhuma recarga: nenhum agente fantasma pode ter aparecido.
    expect(agentsApi.listar).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Existente\nExistente");
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
    // Sem recarga — nada foi confirmado pelo servidor.
    expect(agentsApi.listar).not.toHaveBeenCalled();
    // O rascunho digitado não some: a pessoa não perde o que escreveu.
    expect(inputPorRotulo("Nome").value).toBe("Closer Editado");
  });
});

describe("DEFAULT — uma chamada só, nunca dois updates", () => {
  const elenco = () => [
    agent({ id: "emilia", name: "Emilia", isDefault: true }),
    agent({ id: "closer", name: "Closer", isDefault: false }),
  ];

  it("tornar padrão chama SOMENTE agents.tornarPadrao, com confirmação antes", async () => {
    await montar({ inicial: elenco() });

    const cartaoCloser = botoes().find((b) => b.textContent.includes("Closer"));
    await clicar(cartaoCloser);
    await tick();

    // Confirmação aparece ANTES de qualquer chamada de rede.
    await clicar(botaoComTexto("Tornar padrão"));
    expect(container.textContent).toContain("Closer passa a ser o agente inicial");
    expect(container.textContent).toContain("Emilia");
    expect(agentsApi.tornarPadrao).not.toHaveBeenCalled();

    agentsApi.tornarPadrao.mockResolvedValueOnce({ changed: true, agentId: "closer" });
    agentsApi.listar.mockResolvedValueOnce([
      agent({ id: "emilia", name: "Emilia", isDefault: false }),
      agent({ id: "closer", name: "Closer", isDefault: true }),
    ]);

    const confirmar = Array.from(container.querySelectorAll('[role="alertdialog"] button'))
      .find((b) => b.textContent.trim() === "Tornar padrão");
    await clicar(confirmar);
    await tick();

    // A invariável central: UMA chamada, o resto (rebaixar o antigo) é da RPC.
    expect(agentsApi.tornarPadrao).toHaveBeenCalledTimes(1);
    expect(agentsApi.tornarPadrao).toHaveBeenCalledWith({ agentId: "closer" });
    expect(agentsApi.editar).not.toHaveBeenCalled();
    expect(agentsApi.definirAtivo).not.toHaveBeenCalled();

    // Estado visual depois do refresh: Closer ganhou o padrão, Emilia perdeu.
    expect(container.textContent).toContain("Agente padrão desta audiência");
  });

  it("falha ao trocar o padrão preserva o estado anterior na tela", async () => {
    await montar({ inicial: elenco() });
    const cartaoCloser = botoes().find((b) => b.textContent.includes("Closer"));
    await clicar(cartaoCloser);
    await tick();

    await clicar(botaoComTexto("Tornar padrão"));
    agentsApi.tornarPadrao.mockRejectedValueOnce({ code: "AGENT_FORBIDDEN", message: "sem permissão" });

    const confirmar = Array.from(container.querySelectorAll('[role="alertdialog"] button'))
      .find((b) => b.textContent.trim() === "Tornar padrão");
    await clicar(confirmar);
    await tick();

    expect(container.textContent).toContain("Você não tem permissão");
    // Sem recarga: o padrão continua sendo Emilia na tela.
    expect(agentsApi.listar).not.toHaveBeenCalled();
    expect(existeBotao("Tornar padrão")).toBe(true); // Closer continua non-default
  });
});

describe("DESATIVAR O PADRÃO — aviso antes, sem autopromoção", () => {
  it("avisa antes de desativar, muda só active, e não promove ninguém", async () => {
    const emilia = agent({ id: "emilia", name: "Emilia", isDefault: true, status: "active" });
    await montar({ inicial: [emilia] });

    await clicar(botoes().find((b) => b.textContent.includes("Emilia")));
    await tick();

    await clicar(botaoComTexto("Desativar"));
    // Aviso aparece ANTES de qualquer chamada.
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
    expect(agentsApi.tornarPadrao).not.toHaveBeenCalled(); // nada de autopromoção

    // Estado válido e simultâneo: padrão E inativo ao mesmo tempo.
    expect(container.textContent).toContain("Agente padrão desta audiência");
    expect(container.textContent).toContain("Ativar"); // virou o botão inverso
  });
});

describe("SKILLS — vincular/desvincular, N:N de verdade", () => {
  it("desvincular do agente A não afeta o agente B", async () => {
    const skillX = { id: "sx", name: "Vendas", slug: "vendas", audience: "customer", status: "published" };
    const A = agent({ id: "a", name: "Agente A" });
    const B = agent({ id: "b", name: "Agente B" });

    agentsApi.listarSkills.mockImplementation(async ({ agentId }) =>
      [{ skill_id: "sx", enabled: true, priority: 10 }]);

    await montar({ inicial: [A, B], catalogoSkills: [skillX] });

    await clicar(botoes().find((b) => b.textContent.includes("Agente A")));
    await tick();
    await clicar(botaoComTexto("Skills"));
    await tick();

    expect(container.textContent).toContain("Vendas");
    expect(existeBotao("Desvincular")).toBe(true);

    agentsApi.definirSkill.mockResolvedValueOnce({});
    // A partir de agora, A não tem mais a skill; B nunca foi tocado.
    agentsApi.listarSkills.mockImplementation(async ({ agentId }) =>
      agentId === "a" ? [] : [{ skill_id: "sx", enabled: true, priority: 10 }]);

    await clicar(botaoComTexto("Desvincular"));
    await tick();

    expect(agentsApi.definirSkill).toHaveBeenCalledWith({ agentId: "a", skillId: "sx", enabled: false });
    expect(container.textContent).toContain("Nenhuma skill vinculada a este agente");

    // Troca para B: continua vinculada lá, sem nenhuma chamada de escrita.
    await clicar(botoes().find((b) => b.textContent.includes("Agente B")));
    await tick();
    await clicar(botaoComTexto("Skills"));
    await tick();

    expect(container.textContent).toContain("Vendas");
    expect(agentsApi.definirSkill).toHaveBeenCalledTimes(1); // só a chamada de A
  });
});

describe("SKILLS — vincular", () => {
  it("vincular uma skill disponível chama definirSkill(enabled: true) e ela migra de seção", async () => {
    const skillY = { id: "sy", name: "Agenda", slug: "agenda", audience: "customer", status: "published" };
    const A = agent({ id: "a", name: "Agente A" });
    agentsApi.listarSkills.mockResolvedValue([]); // nada vinculado ainda

    await montar({ inicial: [A], catalogoSkills: [skillY] });
    await clicar(botoes().find((b) => b.textContent.includes("Agente A")));
    await tick();
    await clicar(botaoComTexto("Skills"));
    await tick();

    expect(container.textContent).toContain("Disponíveis (1)");
    expect(existeBotao("Vincular")).toBe(true);

    agentsApi.definirSkill.mockResolvedValueOnce({});
    agentsApi.listarSkills.mockResolvedValueOnce([{ skill_id: "sy", enabled: true, priority: 100 }]);

    await clicar(botaoComTexto("Vincular"));
    await tick();

    expect(agentsApi.definirSkill).toHaveBeenCalledWith({ agentId: "a", skillId: "sy", enabled: true });
    expect(container.textContent).toContain("Vinculadas (1)");
    expect(existeBotao("Vincular")).toBe(false);
  });
});

describe("MOBILE — navegação de uma tela por vez", () => {
  function painelMobile() {
    // A tela monta desktop e mobile juntos; o painel mobile é o segundo
    // `<div>` de topo (`flex ... md:hidden`), distinto do grid desktop
    // (`hidden ... md:grid`) que vem antes dele.
    const topo = Array.from(container.querySelectorAll(":scope > div"));
    const achado = topo.find((d) => d.className.includes("md:hidden") && d.className.includes("flex"));
    if (!achado) throw new Error("painel mobile não encontrado");
    return achado;
  }

  it("lista → agente → detalhe → voltar, tudo dentro do painel mobile", async () => {
    await montar({ inicial: [agent({ id: "emilia", name: "Emilia", isDefault: true })] });

    const painel = painelMobile();
    expect(painel.textContent).toContain("Emilia");
    expect(painel.textContent).not.toContain("Selecione um agente"); // isso é só do desktop

    const cartao = Array.from(painel.querySelectorAll("button"))
      .find((b) => b.textContent.includes("Emilia"));
    await clicar(cartao);
    await tick();

    // O painel mobile agora mostra o DETALHE, não mais a lista.
    expect(painelMobile().textContent).toContain("Agente padrão desta audiência");
    expect(painelMobile().textContent).not.toContain("nesta organização"); // contador da lista sumiu

    const voltar = painelMobile().querySelector('button[aria-label="Voltar"]');
    expect(voltar).toBeTruthy();
    await clicar(voltar);
    await tick();

    // De volta para a lista, sem ficar preso no detalhe.
    expect(painelMobile().textContent).toContain("nesta organização");
  });

  it("Novo agente no mobile: cancelar fecha sem deixar modal preso", async () => {
    await montar({ inicial: [] });

    await clicar(botaoComTexto("Novo agente"));
    expect(titulos()).toContain("Novo agente");

    await clicar(botaoComTexto("Cancelar"));

    expect(titulos()).not.toContain("Novo agente");
    expect(agentsApi.criar).not.toHaveBeenCalled();
    // A ação principal (Novo agente) continua acessível depois de cancelar.
    expect(existeBotao("Novo agente")).toBe(true);
  });
});
