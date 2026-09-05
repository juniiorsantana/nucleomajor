import { describe, expect, it } from "vitest";
import {
  PRESETS_DE_AGENTE, TONS_SUGERIDOS, agruparPorAudiencia, avisoAoDesativar,
  avisoAoTornarPadrao, corDoAgent, descricaoDaSkill, mensagemDeErro,
  ordenarAgents, padraoDaAudiencia, presetPorId, selosDoAgent,
  separarSkills, skillsPreSelecionadas, tomPorId,
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

  it("C: o principal vem primeiro dentro da audiência, depois ordem alfabética", () => {
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

describe("selos — linguagem de produto, não de coluna", () => {
  it("C: o selo do agente principal diz 'Principal', não 'Padrão'", () => {
    expect(selosDoAgent(agent({ isDefault: true })).map((s) => s.texto)).toEqual(["Principal", "Ativo"]);
    expect(selosDoAgent(agent({ isDefault: false })).map((s) => s.texto)).toEqual(["Ativo"]);
    expect(selosDoAgent(agent({ status: "inactive" })).map((s) => s.texto)).toEqual(["Inativo"]);
  });

  it("principal inativo mostra os dois — são ortogonais", () => {
    const selos = selosDoAgent(agent({ isDefault: true, status: "inactive" }));
    expect(selos.map((s) => s.texto)).toEqual(["Principal", "Inativo"]);
  });
});

describe("avatar — cor estável por agente", () => {
  it("a mesma id sempre produz a mesma cor", () => {
    expect(corDoAgent(agent({ id: "emilia" }))).toBe(corDoAgent(agent({ id: "emilia" })));
  });

  it("é a mesma paleta/algoritmo usado para pessoas — não uma segunda implementação", () => {
    expect(corDoAgent(agent({ id: "x" }))).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("agente principal da audiência", () => {
  it("acha o principal certo de cada audiência, sem .find(audience) solto", () => {
    expect(padraoDaAudiencia(elenco, "customer").name).toBe("Emilia");
    expect(padraoDaAudiencia(elenco, "internal").name).toBe("Operacoes");
  });

  it("devolve null quando a audiência não tem principal", () => {
    const semPrincipal = elenco.filter((a) => !a.isDefault);
    expect(padraoDaAudiencia(semPrincipal, "customer")).toBeNull();
  });
});

describe("I: desativar", () => {
  it("desligar o agente PRINCIPAL e ativo pede confirmação e explica a consequência", () => {
    const aviso = avisoAoDesativar(agent({ name: "Emilia", isDefault: true }));
    expect(aviso).not.toBeNull();
    expect(aviso.titulo).toMatch(/agente principal/i);
    expect(aviso.descricao).toMatch(/sem atendimento/i);
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

describe("J/K: tornar principal", () => {
  it("nomeia o principal que sai e diz que ele continua existindo", () => {
    const aviso = avisoAoTornarPadrao(agent({ name: "Closer" }), agent({ id: "emilia", name: "Emilia" }));
    expect(aviso.titulo).toMatch(/agente principal/i);
    expect(aviso.descricao).toContain("Closer");
    expect(aviso.descricao).toContain("Emilia");
    expect(aviso.descricao).toMatch(/continua existindo/i);
    expect(aviso.rotulo).toBe("Tornar principal");
  });

  it("avisa quando o agente promovido está inativo", () => {
    const aviso = avisoAoTornarPadrao(agent({ name: "Agenda", status: "inactive" }), null);
    expect(aviso.descricao).toMatch(/está inativo/i);
  });

  it("sem principal anterior, não inventa um nome", () => {
    const aviso = avisoAoTornarPadrao(agent({ name: "Closer" }), null);
    expect(aviso.descricao).not.toMatch(/no lugar de/i);
  });
});

describe("L/M: skills", () => {
  const catalogo = [
    { id: "s1", name: "Vendas", slug: "vendas", audience: "customer", status: "published" },
    { id: "s2", name: "Agenda", slug: "agenda", audience: "both", status: "published" },
    { id: "s3", name: "Tarefas", slug: "tarefas", audience: "internal", status: "published" },
    { id: "s4", name: "Rascunho", slug: "rascunho", audience: "customer", status: "draft" },
  ];

  it("separa vinculadas de disponíveis, respeitando a audiência", () => {
    const { vinculadas, disponiveis } = separarSkills(
      catalogo, [{ skill_id: "s1", enabled: true, priority: 10 }], "customer",
    );
    expect(vinculadas.map((s) => s.id)).toEqual(["s1"]);
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

  it("descrição ausente vira frase amigável, nunca o slug técnico", () => {
    expect(descricaoDaSkill({ description: "Fala com o cliente." })).toBe("Fala com o cliente.");
    expect(descricaoDaSkill({ description: "", slug: "pre-qualificacao" })).toBe("Sem descrição disponível.");
    expect(descricaoDaSkill({ slug: "pre-qualificacao" })).not.toContain("pre-qualificacao");
  });
});

describe("E/N: erros viram frase de tela", () => {
  it("slug duplicado explica o que fazer", () => {
    const frase = mensagemDeErro(new AgentError(AGENT_ERRORS.SLUG_ALREADY_EXISTS));
    expect(frase).toMatch(/identificador/i);
    expect(frase).not.toMatch(/23505|duplicate key|constraint/i);
  });

  it("principal já existente manda usar Tornar principal, em vez de criar outro", () => {
    expect(mensagemDeErro(new AgentError(AGENT_ERRORS.DEFAULT_ALREADY_EXISTS)))
      .toMatch(/Tornar principal/i);
  });

  it("sem permissão diz isso, sem falar de RLS", () => {
    const frase = mensagemDeErro(new AgentError(AGENT_ERRORS.FORBIDDEN));
    expect(frase).toMatch(/permissão/i);
    expect(frase).not.toMatch(/row-level|policy|42501/i);
  });

  it("audience imutável fala de 'quem o agente atende', não de 'audience'", () => {
    const frase = mensagemDeErro(new AgentError(AGENT_ERRORS.AUDIENCE_IMMUTABLE));
    expect(frase.toLowerCase()).not.toContain("audience");
  });

  it("erro desconhecido não vira texto técnico vazio", () => {
    expect(mensagemDeErro(new Error("Falha de rede"))).toBe("Falha de rede");
    expect(mensagemDeErro(null)).toBe("Não foi possível concluir a ação.");
    expect(mensagemDeErro({})).toBe("Não foi possível concluir a ação.");
  });
});

describe("assistente de criação — presets são só UX", () => {
  it("todo preset de audience 'customer'/'internal' tem os campos que o passo seguinte precisa", () => {
    for (const preset of PRESETS_DE_AGENTE) {
      if (preset.id === "zero") continue;
      expect(["customer", "internal"]).toContain(preset.audience);
      expect(preset.role.length).toBeGreaterThan(0);
      expect(tomPorId(preset.tomSugerido)).not.toBeNull();
      expect(preset.soulSugerido.length).toBeGreaterThan(0);
    }
  });

  it("'Criar do zero' não sugere nada — o usuário define tudo", () => {
    const zero = presetPorId("zero");
    expect(zero.audience).toBeNull();
    expect(zero.role).toBe("");
    expect(zero.tomSugerido).toBeNull();
    expect(zero.soulSugerido).toBe("");
    expect(zero.skillsSugeridas).toEqual([]);
  });

  it("presetPorId com id desconhecido devolve null, nunca undefined silencioso", () => {
    expect(presetPorId("nao-existe")).toBeNull();
  });

  it("cada tom sugerido tem um rótulo curto e uma frase completa para o campo real", () => {
    for (const tom of TONS_SUGERIDOS) {
      expect(tom.rotulo.length).toBeLessThan(20);
      expect(tom.texto.length).toBeGreaterThan(tom.rotulo.length);
    }
  });

  it("skillsPreSelecionadas só marca o que a organização realmente publicou", () => {
    const catalogoDaOrg = [
      { id: "sk-vendas", slug: "vendas", status: "published" },
      { id: "sk-pre", slug: "pre-qualificacao", status: "draft" },
    ];
    const preset = presetPorId("vendas");
    const marcadas = skillsPreSelecionadas(catalogoDaOrg, preset);
    expect(marcadas).toEqual(["sk-vendas"]);
  });

  it("preset sem skills sugeridas não marca nada, mesmo com catálogo cheio", () => {
    const cobranca = presetPorId("cobranca");
    const marcadas = skillsPreSelecionadas(
      [{ id: "s1", slug: "vendas", status: "published" }], cobranca,
    );
    expect(marcadas).toEqual([]);
  });

  it("nenhum preset marca o agente como principal — isso continua ação separada", () => {
    for (const preset of PRESETS_DE_AGENTE) {
      expect(preset).not.toHaveProperty("isDefault");
      expect(preset).not.toHaveProperty("is_default");
    }
  });
});
