import { describe, expect, it } from "vitest";
import {
  agruparPorAudiencia, avisoAoDesativar, avisoAoTornarPadrao, mensagemDeErro,
  ordenarAgents, padraoDaAudiencia, selosDoAgent, separarSkills,
} from "./agents";
import { AGENT_ERRORS, AgentError } from "../../../../packages/intelligence/src/agent-management.mjs";

const agent = (over = {}) => ({
  id: over.id ?? "a1", name: "Agente", slug: "agente", audience: "customer",
  role: null, tone: null, soulMarkdown: null, status: "active", isDefault: false, ...over,
});

const elenco = [
  agent({ id: "closer", name: "Closer", audience: "customer" }),
  agent({ id: "qa", name: "QA", audience: "internal" }),
  agent({ id: "emilia", name: "Emilia", audience: "customer", isDefault: true }),
  agent({ id: "agenda", name: "Agenda", audience: "customer", status: "inactive" }),
  agent({ id: "ops", name: "Operacoes", audience: "internal", isDefault: true }),
];

describe("ordem da lista", () => {
  it("A/B: agrupa por audiência e mantém os vários agentes de cada uma", () => {
    const grupos = agruparPorAudiencia(elenco);
    expect(grupos.map((g) => g.id)).toEqual(["customer", "internal"]);
    expect(grupos[0].agents).toHaveLength(3);
    expect(grupos[1].agents).toHaveLength(2);
  });

  it("C: o padrão vem primeiro dentro da audiência, depois ordem alfabética", () => {
    // Não é estética: o padrão é o único que responde hoje. Enterrá-lo numa
    // lista alfabética esconde a informação mais importante da tela.
    const [clientes, equipe] = agruparPorAudiencia(elenco);
    expect(clientes.agents.map((a) => a.name)).toEqual(["Emilia", "Agenda", "Closer"]);
    expect(equipe.agents.map((a) => a.name)).toEqual(["Operacoes", "QA"]);
  });

  it("não muda o array recebido", () => {
    const original = [...elenco];
    ordenarAgents(elenco);
    expect(elenco).toEqual(original);
  });

  it("aguenta lista vazia e nula", () => {
    expect(agruparPorAudiencia([])).toEqual([]);
    expect(agruparPorAudiencia(undefined)).toEqual([]);
    expect(ordenarAgents(undefined)).toEqual([]);
  });
});

describe("selos", () => {
  it("C: padrão e status aparecem, nessa ordem", () => {
    expect(selosDoAgent(agent({ isDefault: true })).map((s) => s.texto)).toEqual(["Padrão", "Ativo"]);
    expect(selosDoAgent(agent({ isDefault: false })).map((s) => s.texto)).toEqual(["Ativo"]);
    expect(selosDoAgent(agent({ status: "inactive" })).map((s) => s.texto)).toEqual(["Inativo"]);
  });

  it("padrão inativo mostra os dois — são ortogonais", () => {
    const selos = selosDoAgent(agent({ isDefault: true, status: "inactive" }));
    expect(selos.map((s) => s.texto)).toEqual(["Padrão", "Inativo"]);
  });
});

describe("padrão da audiência", () => {
  it("acha o padrão certo de cada audiência, sem .find(audience) solto", () => {
    expect(padraoDaAudiencia(elenco, "customer").name).toBe("Emilia");
    expect(padraoDaAudiencia(elenco, "internal").name).toBe("Operacoes");
  });

  it("devolve null quando a audiência não tem padrão", () => {
    const semPadrao = elenco.filter((a) => !a.isDefault);
    expect(padraoDaAudiencia(semPadrao, "customer")).toBeNull();
  });
});

describe("I: desativar", () => {
  it("desligar o agente PADRÃO e ativo pede confirmação e explica a consequência", () => {
    const aviso = avisoAoDesativar(agent({ name: "Emilia", isDefault: true }));
    expect(aviso).not.toBeNull();
    expect(aviso.descricao).toMatch(/sem atendimento/i);
    // E deixa explícito que ninguém é promovido no lugar.
    expect(aviso.descricao).toMatch(/Nenhum outro agente é promovido/i);
    expect(aviso.rotulo).toBe("Desativar mesmo assim");
  });

  it("desligar agente comum não interrompe ninguém, e não pede confirmação", () => {
    expect(avisoAoDesativar(agent({ isDefault: false }))).toBeNull();
  });

  it("reativar não pede confirmação", () => {
    expect(avisoAoDesativar(agent({ isDefault: true, status: "inactive" }))).toBeNull();
  });
});

describe("J/K: tornar padrão", () => {
  it("nomeia o padrão que sai e diz que ele continua existindo", () => {
    const aviso = avisoAoTornarPadrao(agent({ name: "Closer" }), agent({ id: "emilia", name: "Emilia" }));
    expect(aviso.descricao).toContain("Closer");
    expect(aviso.descricao).toContain("Emilia");
    expect(aviso.descricao).toMatch(/continua existindo/i);
  });

  it("avisa quando o agente promovido está inativo", () => {
    const aviso = avisoAoTornarPadrao(agent({ name: "Agenda", status: "inactive" }), null);
    expect(aviso.descricao).toMatch(/está inativo/i);
  });

  it("sem padrão anterior, não inventa um nome", () => {
    const aviso = avisoAoTornarPadrao(agent({ name: "Closer" }), null);
    expect(aviso.descricao).not.toMatch(/no lugar de/i);
  });
});

describe("L/M: skills", () => {
  const catalogo = [
    { id: "s1", name: "Vendas", audience: "customer", status: "published" },
    { id: "s2", name: "Agenda", audience: "both", status: "published" },
    { id: "s3", name: "Tarefas", audience: "internal", status: "published" },
    { id: "s4", name: "Rascunho", audience: "customer", status: "draft" },
  ];

  it("separa vinculadas de disponíveis, respeitando a audiência", () => {
    const { vinculadas, disponiveis } = separarSkills(
      catalogo, [{ skill_id: "s1", enabled: true, priority: 10 }], "customer",
    );
    expect(vinculadas.map((s) => s.id)).toEqual(["s1"]);
    // s3 é interna e s4 não está publicada: nenhuma das duas aparece.
    expect(disponiveis.map((s) => s.id)).toEqual(["s2"]);
  });

  it("vínculo desligado conta como disponível, não como vinculado", () => {
    const { vinculadas, disponiveis } = separarSkills(
      catalogo, [{ skill_id: "s1", enabled: false, priority: 10 }], "customer",
    );
    expect(vinculadas).toHaveLength(0);
    expect(disponiveis.map((s) => s.id)).toContain("s1");
  });

  it("vinculadas saem por prioridade", () => {
    const { vinculadas } = separarSkills(catalogo, [
      { skill_id: "s2", enabled: true, priority: 10 },
      { skill_id: "s1", enabled: true, priority: 90 },
    ], "customer");
    expect(vinculadas.map((s) => s.id)).toEqual(["s2", "s1"]);
  });

  it("agente sem vínculo nenhum: tudo elegível fica disponível", () => {
    const { vinculadas, disponiveis } = separarSkills(catalogo, [], "internal");
    expect(vinculadas).toHaveLength(0);
    expect(disponiveis.map((s) => s.id)).toEqual(["s2", "s3"]);
  });
});

describe("E/N: erros viram frase de tela", () => {
  it("slug duplicado explica o que fazer", () => {
    const frase = mensagemDeErro(new AgentError(AGENT_ERRORS.SLUG_ALREADY_EXISTS));
    expect(frase).toMatch(/identificador/i);
    expect(frase).not.toMatch(/23505|duplicate key|constraint/i);
  });

  it("padrão já existente manda usar Tornar padrão, em vez de criar outro", () => {
    expect(mensagemDeErro(new AgentError(AGENT_ERRORS.DEFAULT_ALREADY_EXISTS)))
      .toMatch(/Tornar padrão/i);
  });

  it("sem permissão diz isso, sem falar de RLS", () => {
    const frase = mensagemDeErro(new AgentError(AGENT_ERRORS.FORBIDDEN));
    expect(frase).toMatch(/permissão/i);
    expect(frase).not.toMatch(/row-level|policy|42501/i);
  });

  it("erro desconhecido não vira texto técnico vazio", () => {
    expect(mensagemDeErro(new Error("Falha de rede"))).toBe("Falha de rede");
    expect(mensagemDeErro(null)).toBe("Não foi possível concluir a ação.");
    expect(mensagemDeErro({})).toBe("Não foi possível concluir a ação.");
  });
});
