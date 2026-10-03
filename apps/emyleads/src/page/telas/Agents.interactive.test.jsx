// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/**
 * Teste INTERATIVO dos agentes (fluxo novo da Equipe de IA, 03/10/2026).
 *
 * Prova o caminho completo: evento de DOM real → handler real do componente
 * → chamada real a `api.agents.*` → resposta controlada → re-render → estado
 * visível. A fronteira mockada é `../../data/client`, a única que a tela
 * conhece. Abaixo dela, o provider tem os próprios testes.
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

/** Espelha o que `Inteligencia.jsx` faz: lista em estado próprio e `recarregar` lista de novo. */
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
  // Toda página de agente busca as habilidades ao montar.
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

const botoes = () => Array.from(container.querySelectorAll("button"));
function botaoComTexto(texto) {
  const achado = botoes().find((b) => b.textContent.trim() === texto || b.getAttribute("aria-label") === texto);
  if (!achado) throw new Error(`botão "${texto}" não encontrado`);
  return achado;
}
const existeBotao = (texto) => botoes().some((b) => b.textContent.trim() === texto || b.getAttribute("aria-label") === texto);
function inputPorRotulo(rotulo) {
  const label = Array.from(container.querySelectorAll("label")).find((l) => l.querySelector(":scope > span")?.textContent === rotulo);
  if (!label) throw new Error(`campo "${rotulo}" não encontrado`);
  return label.querySelector("input, textarea");
}
const assistenteAberto = () => Boolean(container.querySelector('[role="progressbar"]'));

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
/** Cartão da criação: o rótulo é um <span> folha dentro do botão. */
function clicarCard(rotulo) {
  const alvo = Array.from(container.querySelectorAll("span")).find((s) => s.children.length === 0 && s.textContent.trim() === rotulo);
  if (!alvo?.closest("button")) throw new Error(`cartão "${rotulo}" não encontrado`);
  return clicar(alvo.closest("button"));
}
function abrirDetalhes(texto) {
  const summary = Array.from(container.querySelectorAll("summary")).find((s) => s.textContent.trim() === texto);
  if (!summary) throw new Error(`<summary> "${texto}" não encontrado`);
  return clicar(summary);
}
/** Abre um agente pela linha da lista. */
async function abrirAgente(nome) {
  const linha = Array.from(container.querySelectorAll(".agent-linha")).find((b) => b.textContent.includes(nome));
  if (!linha) throw new Error(`agente "${nome}" não está na lista`);
  await clicar(linha);
  await tick();
}
/** Vai para uma seção do roteiro da página do agente. */
async function irParaSecao(rotulo) {
  const nav = container.querySelector('nav[aria-label="Roteiro do agente"]');
  const botao = Array.from(nav.querySelectorAll("button"))
    .find((b) => Array.from(b.querySelectorAll("span")).some((s) => s.children.length === 0 && s.textContent === rotulo));
  if (!botao) throw new Error(`seção "${rotulo}" não encontrada`);
  await clicar(botao);
  await tick();
}
function confirmarNoDialogo(texto) {
  const botao = Array.from(container.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent.trim() === texto);
  if (!botao) throw new Error(`confirmação "${texto}" não encontrada`);
  return clicar(botao);
}

describe("CRIAR — três passos até a chamada real da API", () => {
  it("escolher um tipo e seguir os passos cria o agente PAUSADO, com aparência e as habilidades sugeridas", async () => {
    await montar({ inicial: [], catalogoSkills: CATALOGO_VENDAS });

    await clicar(botaoComTexto("Criar agente"));
    expect(assistenteAberto()).toBe(true);
    expect(container.textContent).toContain("Para que serve esse agente?");

    // Passo 1: o tipo já define o público; segue direto para nome e jeito.
    await clicarCard("Vendas");
    expect(container.textContent).toContain("Como ele se chama e como conversa?");
    expect(inputPorRotulo("Função").value).toBe("Vendas");
    expect(existeBotao("Persuasivo")).toBe(true);
    expect(container.textContent).toContain("Outro símbolo");
    await clicar(botaoComTexto("Cor 6"));
    await digitar(inputPorRotulo("Nome"), "Emília");
    await clicar(botaoComTexto("Continuar"));

    // Passo 3: revisar, com as habilidades do tipo já marcadas.
    expect(container.textContent).toContain("Confira antes de criar");
    expect(container.textContent).toContain("Ele nasce pausado.");
    expect(container.textContent).toContain("Pré-qualificação");

    agentsApi.criar.mockResolvedValueOnce(agent({ id: "emilia", name: "Emília", role: "Vendas", status: "inactive" }));
    agentsApi.definirSkill.mockResolvedValue({});
    agentsApi.listar.mockResolvedValueOnce([agent({ id: "emilia", name: "Emília", role: "Vendas", status: "inactive" })]);

    await clicar(botaoComTexto("Criar e abrir"));
    await tick();

    expect(agentsApi.criar).toHaveBeenCalledTimes(1);
    const enviado = agentsApi.criar.mock.calls[0][0];
    expect(enviado).toMatchObject({ name: "Emília", audience: "customer", role: "Vendas", active: false });
    expect(enviado.tone).toMatch(/persuasivo/i);
    expect(enviado.appearance).toMatchObject({ cor: 6 });
    expect(enviado.appearance.semente).toMatch(/^[0-9a-z]{6}$/);
    for (const proibido of ["isDefault", "is_default", "skillIds"]) expect(enviado).not.toHaveProperty(proibido);

    expect(agentsApi.definirSkill).toHaveBeenCalledTimes(2);
    for (const chamada of agentsApi.definirSkill.mock.calls) expect(chamada[0]).toMatchObject({ agentId: "emilia", enabled: true });

    // Fechou a criação, recarregou do servidor e abriu a página do agente novo.
    expect(assistenteAberto()).toBe(false);
    expect(agentsApi.listar).toHaveBeenCalledTimes(1);
    expect(container.querySelector('nav[aria-label="Roteiro do agente"]')).toBeTruthy();
    expect(container.textContent).toContain("Emília");
    expect(container.textContent).toContain("Pausado");
  });

  it("'Criar do zero' não pré-preenche nada, e pede o público antes de seguir", async () => {
    await montar({ inicial: [] });
    await clicar(botaoComTexto("Criar agente"));
    await clicarCard("Criar do zero");

    expect(container.textContent).toContain("Com quem esse agente vai conversar?");
    await clicarCard("Minha equipe");

    expect(inputPorRotulo("Função").value).toBe("");
    expect(inputPorRotulo("Nome").value).toBe("");
    expect(botaoComTexto("Continuar").disabled).toBe(true);
  });

  it("mostra falha parcial de habilidades sem repetir o cadastro já concluído", async () => {
    await montar({ inicial: [], catalogoSkills: CATALOGO_VENDAS });
    await clicar(botaoComTexto("Criar agente"));
    await clicarCard("Vendas");
    await digitar(inputPorRotulo("Nome"), "SDR");
    await clicar(botaoComTexto("Continuar"));
    agentsApi.criar.mockResolvedValueOnce(agent({ id: "sdr", name: "SDR" }));
    agentsApi.definirSkill.mockRejectedValueOnce({ code: "AGENT_FORBIDDEN" }).mockResolvedValueOnce({});
    agentsApi.listar.mockResolvedValueOnce([agent({ id: "sdr", name: "SDR" })]);
    await clicar(botaoComTexto("Criar e abrir"));
    await tick();
    expect(assistenteAberto()).toBe(false);
    expect(container.textContent).toContain("O agente foi criado, mas 1 habilidade(s) não foram vinculadas");
    expect(agentsApi.criar).toHaveBeenCalledTimes(1);
    expect(agentsApi.tornarPadrao).not.toHaveBeenCalled();
  });

  it("o identificador técnico fica em Configurações avançadas, derivado do nome", async () => {
    await montar({ inicial: [] });
    await clicar(botaoComTexto("Criar agente"));
    await clicarCard("Criar do zero");
    await clicarCard("Clientes e leads");
    await digitar(inputPorRotulo("Nome"), "Agente Teste");
    await abrirDetalhes("Configurações avançadas");
    expect(inputPorRotulo("Identificador técnico").value).toBe("agente-teste");
  });

  it("erro na criação (identificador duplicado) mantém a criação aberta e não cria fantasma", async () => {
    await montar({ inicial: [agent({ id: "x", name: "Existente" })] });
    await clicar(botaoComTexto("Criar agente"));
    await clicarCard("Criar do zero");
    await clicarCard("Clientes e leads");
    await digitar(inputPorRotulo("Nome"), "Existente");
    await clicar(botaoComTexto("Continuar"));

    agentsApi.criar.mockRejectedValueOnce({
      code: "AGENT_SLUG_ALREADY_EXISTS",
      message: 'duplicate key value violates unique constraint "assistant_profiles_organization_slug_key"',
    });
    await clicar(botaoComTexto("Criar e abrir"));
    await tick();

    expect(container.textContent).toContain("Já existe um agente com esse identificador");
    expect(container.textContent).not.toMatch(/constraint|duplicate key/i);
    expect(assistenteAberto()).toBe(true);
    expect(agentsApi.listar).not.toHaveBeenCalled();
  });

  it("fechar pelo X não chama a API e não deixa nada preso", async () => {
    await montar({ inicial: [] });
    await clicar(botaoComTexto("Criar agente"));
    await clicar(container.querySelector('button[aria-label="Fechar"]'));
    expect(assistenteAberto()).toBe(false);
    expect(agentsApi.criar).not.toHaveBeenCalled();
    expect(existeBotao("Criar agente")).toBe(true);
  });

  it("cada passo é uma tela própria, e 'Voltar' funciona", async () => {
    await montar({ inicial: [] });
    await clicar(botaoComTexto("Criar agente"));
    await clicarCard("Vendas");
    expect(container.textContent).toContain("Como ele se chama e como conversa?");
    await clicar(container.querySelector('button[aria-label="Voltar"]'));
    expect(container.textContent).toContain("Para que serve esse agente?");
  });
});

describe("EDITAR — barra de não salvo, e nada estrutural vaza", () => {
  it("mudar o nome mostra 'Alterações não salvas'; Salvar envia só o permitido e recarrega", async () => {
    await montar({ inicial: [agent({ id: "closer", name: "Closer" })] });
    await abrirAgente("Closer");

    expect(container.textContent).not.toContain("Alterações não salvas");
    await digitar(inputPorRotulo("Nome"), "Closer Noturno");
    expect(container.textContent).toContain("Alterações não salvas");

    agentsApi.editar.mockResolvedValueOnce(agent({ id: "closer", name: "Closer Noturno" }));
    agentsApi.listar.mockResolvedValueOnce([agent({ id: "closer", name: "Closer Noturno" })]);
    await clicar(botaoComTexto("Salvar"));
    await tick();

    const enviado = agentsApi.editar.mock.calls[0][0];
    expect(enviado).toMatchObject({ agentId: "closer", name: "Closer Noturno" });
    for (const proibido of ["organization_id", "organizationId", "audience", "is_default", "isDefault", "appearance"]) {
      expect(enviado).not.toHaveProperty(proibido);
    }
    expect(agentsApi.listar).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Closer Noturno");
  });

  it("trocar a cor manda só a aparência junto, e Descartar volta ao salvo", async () => {
    await montar({ inicial: [agent({ id: "closer", name: "Closer" })] });
    await abrirAgente("Closer");

    await clicar(botaoComTexto("Cor 3"));
    expect(container.textContent).toContain("Alterações não salvas");
    await clicar(botaoComTexto("Descartar"));
    expect(container.textContent).not.toContain("Alterações não salvas");

    await clicar(botaoComTexto("Cor 3"));
    agentsApi.editar.mockResolvedValueOnce(agent({ id: "closer", name: "Closer", appearance: { cor: 3 } }));
    agentsApi.listar.mockResolvedValueOnce([agent({ id: "closer", name: "Closer", appearance: { cor: 3 } })]);
    await clicar(botaoComTexto("Salvar"));
    await tick();
    expect(agentsApi.editar.mock.calls[0][0].appearance).toMatchObject({ cor: 3 });
  });

  it("erro ao salvar não mente: mostra o erro e não apaga o que foi digitado", async () => {
    await montar({ inicial: [agent({ id: "closer", name: "Closer" })] });
    await abrirAgente("Closer");

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

  it("tornar principal, em Onde atende, chama SOMENTE agents.tornarPadrao, com confirmação antes", async () => {
    await montar({ inicial: elenco() });
    await abrirAgente("Closer");
    await irParaSecao("Onde atende");

    await clicar(botaoComTexto("Tornar principal"));
    expect(container.textContent).toContain("Closer passa a receber primeiro");
    expect(container.textContent).toContain("Emilia");
    expect(agentsApi.tornarPadrao).not.toHaveBeenCalled();

    agentsApi.tornarPadrao.mockResolvedValueOnce({ changed: true, agentId: "closer" });
    agentsApi.listar.mockResolvedValueOnce([
      agent({ id: "emilia", name: "Emilia", isDefault: false }),
      agent({ id: "closer", name: "Closer", isDefault: true }),
    ]);
    await confirmarNoDialogo("Tornar principal");
    await tick();

    expect(agentsApi.tornarPadrao).toHaveBeenCalledTimes(1);
    expect(agentsApi.tornarPadrao).toHaveBeenCalledWith({ agentId: "closer" });
    expect(agentsApi.editar).not.toHaveBeenCalled();
    expect(agentsApi.definirAtivo).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Principal de clientes");
  });

  it("falha ao trocar o principal preserva o estado anterior na tela", async () => {
    await montar({ inicial: elenco() });
    await abrirAgente("Closer");
    await irParaSecao("Onde atende");

    await clicar(botaoComTexto("Tornar principal"));
    agentsApi.tornarPadrao.mockRejectedValueOnce({ code: "AGENT_FORBIDDEN", message: "sem permissão" });
    await confirmarNoDialogo("Tornar principal");
    await tick();

    expect(container.textContent).toContain("Você não tem permissão");
    expect(agentsApi.listar).not.toHaveBeenCalled();
    expect(existeBotao("Tornar principal")).toBe(true);
  });
});

describe("PAUSAR O PRINCIPAL — aviso antes, sem autopromoção", () => {
  it("avisa antes de pausar, muda só active, e não promove ninguém", async () => {
    const emilia = agent({ id: "emilia", name: "Emilia", isDefault: true, status: "active" });
    await montar({ inicial: [emilia] });
    await abrirAgente("Emilia");

    await clicar(botaoComTexto("Pausar"));
    expect(container.textContent).toMatch(/fica.*sem atendimento/i);
    expect(container.textContent).toMatch(/Nenhum outro agente é promovido/i);
    expect(agentsApi.definirAtivo).not.toHaveBeenCalled();

    agentsApi.definirAtivo.mockResolvedValueOnce(agent({ ...emilia, status: "inactive" }));
    agentsApi.listar.mockResolvedValueOnce([agent({ ...emilia, status: "inactive" })]);
    await confirmarNoDialogo("Pausar mesmo assim");
    await tick();

    expect(agentsApi.definirAtivo).toHaveBeenCalledWith({ agentId: "emilia", active: false });
    expect(agentsApi.tornarPadrao).not.toHaveBeenCalled();
    // Estado válido e simultâneo: principal E pausado ao mesmo tempo.
    expect(container.textContent).toContain("Principal de clientes");
    expect(container.textContent).toContain("Ativar");
  });
});

describe("HABILIDADES — ligar e desligar, N:N de verdade", () => {
  it("remover do agente A não afeta o agente B", async () => {
    const skillX = { id: "sx", name: "Vendas", slug: "vendas", audience: "customer", status: "published" };
    agentsApi.listarSkills.mockImplementation(async () => [{ skill_id: "sx", enabled: true, priority: 10 }]);
    await montar({ inicial: [agent({ id: "a", name: "Agente A" }), agent({ id: "b", name: "Agente B" })], catalogoSkills: [skillX] });

    await abrirAgente("Agente A");
    await irParaSecao("Habilidades");
    expect(container.textContent).toContain("Vendas");

    agentsApi.definirSkill.mockResolvedValueOnce({});
    agentsApi.listarSkills.mockImplementation(async ({ agentId }) =>
      agentId === "a" ? [] : [{ skill_id: "sx", enabled: true, priority: 10 }]);
    await clicar(botaoComTexto("Remover"));
    await tick();

    expect(agentsApi.definirSkill).toHaveBeenCalledWith({ agentId: "a", skillId: "sx", enabled: false });
    expect(container.textContent).toContain("Este agente ainda não sabe fazer nada");

    await clicar(botaoComTexto("Voltar"));
    await abrirAgente("Agente B");
    await irParaSecao("Habilidades");
    expect(existeBotao("Remover")).toBe(true);
    expect(agentsApi.definirSkill).toHaveBeenCalledTimes(1);
  });

  it("adicionar uma habilidade chama definirSkill(enabled: true) e ela muda de seção", async () => {
    const skillY = { id: "sy", name: "Agenda", slug: "agenda", audience: "customer", status: "published" };
    agentsApi.listarSkills.mockResolvedValue([]);
    await montar({ inicial: [agent({ id: "a", name: "Agente A" })], catalogoSkills: [skillY] });
    await abrirAgente("Agente A");
    await irParaSecao("Habilidades");

    expect(container.textContent).toContain("Pode aprender (1)");
    agentsApi.definirSkill.mockResolvedValueOnce({});
    agentsApi.listarSkills.mockResolvedValueOnce([{ skill_id: "sy", enabled: true, priority: 100 }]);
    await clicar(botaoComTexto("Adicionar"));
    await tick();

    expect(agentsApi.definirSkill).toHaveBeenCalledWith({ agentId: "a", skillId: "sy", enabled: true });
    expect(container.textContent).toContain("Sabe fazer (1)");
    expect(existeBotao("Adicionar")).toBe(false);
  });
});

describe("NAVEGAÇÃO — lista e página do agente", () => {
  it("lista → página do agente → voltar", async () => {
    await montar({ inicial: [agent({ id: "emilia", name: "Emilia", isDefault: true })] });
    expect(container.textContent).toContain("Sua equipe de IA");

    await abrirAgente("Emilia");
    expect(container.textContent).toContain("Principal de clientes");
    expect(container.textContent).not.toContain("Sua equipe de IA");

    await clicar(botaoComTexto("Voltar"));
    await tick();
    expect(container.textContent).toContain("Sua equipe de IA");
  });
});
