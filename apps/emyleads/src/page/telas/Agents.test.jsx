import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Agents, { DetalheAgent, NovoAgent } from "./Agents";

/**
 * A suíte do app renderiza para markup estático e não clica em nada. Então o
 * que dá para provar aqui é o que a tela MOSTRA e o que ela OFERECE; a lógica
 * de decisão está em `domain/agents.test.js`, e o que só existe dentro de um
 * `onClick` é verificado pelo texto do módulo — que é o suficiente para travar
 * as invariáveis que importam (uma chamada só na troca de padrão, nada de
 * `.find(audience)`, nenhum estado otimista).
 */

const fonte = readFileSync(new URL("./Agents.jsx", import.meta.url), "utf8");

const agent = (over = {}) => ({
  id: over.id ?? "a1", name: "Agente", slug: "agente", audience: "customer",
  role: null, tone: null, soulMarkdown: null, status: "active", isDefault: false, ...over,
});

const elenco = [
  agent({ id: "emilia", name: "Emilia", audience: "customer", isDefault: true, role: "Recepção" }),
  agent({ id: "closer", name: "Closer", audience: "customer" }),
  agent({ id: "agenda", name: "Agenda", audience: "customer", status: "inactive" }),
  agent({ id: "ops", name: "Operacoes", audience: "internal", isDefault: true }),
  agent({ id: "qa", name: "QA", audience: "internal" }),
];

const render = (props = {}) => renderToStaticMarkup(
  <Agents agents={elenco} catalogoSkills={[]} canWrite recarregar={async () => {}}
    carregando={false} erro="" {...props} />,
);

describe("lista", () => {
  it("A/B: mostra todos os agentes, das duas audiências", () => {
    const html = render();
    for (const nome of ["Emilia", "Closer", "Agenda", "Operacoes", "QA"]) {
      expect(html).toContain(nome);
    }
    expect(html).toContain("Clientes");
    expect(html).toContain("Equipe");
    expect(html).toContain("5 nesta organização");
  });

  it("C: identifica o padrão e o estado de cada um", () => {
    const html = render();
    expect(html).toContain("Padrão");
    expect(html).toContain("Ativo");
    expect(html).toContain("Inativo");
  });

  it("empty state quando não há agente nenhum", () => {
    expect(render({ agents: [] })).toContain("Nenhum agente configurado.");
  });

  it("estados de carregamento e erro têm tela própria", () => {
    expect(render({ carregando: true })).toContain("Carregando agentes…");
    const comErro = render({ erro: "Falhou" });
    expect(comErro).toContain("Falhou");
    expect(comErro).toContain('role="alert"');
  });

  it("sem permissão de escrita, não oferece criar agente", () => {
    expect(render({ canWrite: false })).not.toContain("Novo agente");
    expect(render()).toContain("Novo agente");
  });

  it("O: as duas apresentações existem — mestre/detalhe no desktop, uma tela no mobile", () => {
    const html = render();
    expect(html).toContain("md:grid-cols-[320px_minmax(0,1fr)]");
    expect(html).toContain("md:hidden");
    expect(html).toContain("hidden");
  });

  it("aponta onde ficou o que esta tela ainda não cobre", () => {
    // Rollout e marca continuam na aba Assistentes; a tela diz isso em vez de
    // deixar o usuário procurar.
    expect(render()).toMatch(/Rollout, marca e política de sessão/i);
  });
});

describe("invariáveis que a tela não pode quebrar", () => {
  it("G: audience é somente leitura no detalhe, e o patch nunca a envia", () => {
    expect(fonte).toMatch(/Audiência[\s\S]{0,400}?disabled readOnly/);
    // O rascunho de edição só tem os campos editáveis.
    expect(fonte).toMatch(/name:[^\n]*slug:[^\n]*role:/);
    expect(fonte).not.toMatch(/audience:\s*rascunho/);
    expect(fonte).not.toMatch(/editar\([^)]*audience/);
  });

  it("D: a criação não oferece nascer padrão", () => {
    const criacao = fonte.slice(fonte.indexOf("function NovoAgent"), fonte.indexOf("function DetalheAgent"));
    expect(criacao).not.toMatch(/isDefault|is_default|Tornar padrão/);
    expect(criacao).toMatch(/nasce <strong>comum<\/strong>/);
  });

  it("J: trocar o padrão é UMA chamada, e é a operação atômica", () => {
    // Dois updates pelo frontend abririam a janela sem padrão que a RPC existe
    // para fechar. Se alguém tentar, este teste reprova.
    expect(fonte).toContain("api.agents.tornarPadrao");
    expect(fonte).not.toMatch(/definirAtivo[\s\S]{0,200}tornarPadrao/);
    expect(fonte).not.toMatch(/isDefault:\s*(true|false)/);
    expect((fonte.match(/api\.agents\.tornarPadrao/g) || []).length).toBe(1);
  });

  it("K: toda escrita é seguida de recarga do servidor", () => {
    for (const bloco of ["tornarPadrao", "definirAtivo", "editar"]) {
      const i = fonte.indexOf(`api.agents.${bloco}`);
      expect(i).toBeGreaterThan(-1);
      expect(fonte.slice(i, i + 220)).toContain("recarregar()");
    }
  });

  it("N: nada de estado otimista — a tela só reflete o que o servidor confirmou", () => {
    // Não existe setAgents/mutação local da coleção dentro da tela: a lista vem
    // sempre de `recarregar`. Se um erro acontecer, a UI fica como estava.
    expect(fonte).not.toMatch(/setAgents\(/);
    expect(fonte).toMatch(/catch \(e\) \{ setFalha\(mensagemDeErro\(e\)\); \}/);
  });

  it("não escolhe agente por audiência arbitrária", () => {
    expect(fonte).not.toMatch(/\.find\(\([^)]*\) => [^)]*\.audience === "(customer|internal)"\)/);
  });

  it("fala só com as operações da FASE F", () => {
    const chamadas = [...fonte.matchAll(/api\.([a-zA-Z.]+)\(/g)].map((m) => m[1]);
    expect(new Set(chamadas)).toEqual(new Set([
      "agents.listarSkills", "agents.definirSkill", "agents.editar",
      "agents.definirAtivo", "agents.tornarPadrao", "agents.criar",
    ]));
  });

  it("Soul é persona, e a tela diz que ele não concede permissão", () => {
    expect(fonte).toMatch(/personalidade, postura, princípios e estilo/i);
    expect(fonte).toMatch(/não concede permissão/i);
  });
});

describe("detalhe do agente, renderizado", () => {
  const skills = [
    { id: "s1", name: "Vendas", slug: "vendas", description: "Qualifica quem chega", audience: "customer", status: "published" },
    { id: "s2", name: "Agenda", slug: "agenda", description: "Marca horário", audience: "both", status: "published" },
  ];
  const acoes = {
    listarSkills: async () => [{ skill_id: "s1", enabled: true, priority: 10 }],
    definirSkill: async () => ({}), editar: async () => {},
    alternarAtivo: () => {}, tornarPadrao: () => {},
  };
  const detalhe = (over = {}) => renderToStaticMarkup(
    <DetalheAgent agent={agent({ name: "Emilia", role: "Recepção", tone: "cordial", isDefault: true, ...over })}
      catalogoSkills={skills} canWrite aoVoltar={() => {}} acoes={acoes} />,
  );

  it("F: oferece nome, slug, função e tom", () => {
    const html = detalhe();
    for (const rotulo of ["Nome", "Identificador (slug)", "Função", "Tom"]) {
      expect(html).toContain(rotulo);
    }
    expect(html).toContain("Emilia");
    expect(html).toContain("Recepção");
  });

  it("G: audiência aparece desabilitada, com o motivo", () => {
    const html = detalhe();
    expect(html).toContain("Audiência");
    expect(html).toMatch(/disabled[^>]*readonly|readonly[^>]*disabled/i);
    expect(html).toMatch(/Imutável depois da criação/i);
  });

  it("H: oferece desativar quando ativo e ativar quando inativo", () => {
    expect(detalhe({ status: "active" })).toContain("Desativar");
    expect(detalhe({ status: "inactive" })).toContain("Ativar");
  });

  it("C: no padrão mostra o selo, e não oferece “Tornar padrão”", () => {
    const padrao = detalhe({ isDefault: true });
    expect(padrao).toContain("Agente padrão desta audiência");
    expect(padrao).not.toContain("Tornar padrão");
    expect(detalhe({ isDefault: false })).toContain("Tornar padrão");
  });

  it("somente leitura quando o usuário não pode escrever", () => {
    const html = renderToStaticMarkup(
      <DetalheAgent agent={agent()} catalogoSkills={skills} canWrite={false}
        aoVoltar={() => {}} acoes={acoes} />,
    );
    expect(html).not.toContain("Tornar padrão");
    expect(html).not.toContain("Salvar");
  });
});

describe("formulário de criação, renderizado", () => {
  const criar = () => renderToStaticMarkup(
    <NovoAgent aoFechar={() => {}} aoCriar={async () => {}} />,
  );

  it("D: pede nome, audiência, função, tom e soul — e nada de padrão", () => {
    const html = criar();
    for (const rotulo of ["Nome", "Audiência", "Função", "Tom", "Soul"]) {
      expect(html).toContain(rotulo);
    }
    expect(html).toContain("Clientes");
    expect(html).toContain("Equipe");
    expect(html).not.toContain("Tornar padrão");
    expect(html).toMatch(/nasce <strong>comum<\/strong>/);
  });

  it("explica que a audiência é definida agora e imutável depois", () => {
    expect(criar()).toMatch(/imutável depois/i);
  });

  it("o Soul vem com a ajuda certa, e sem convite a colocar permissão", () => {
    const html = criar();
    expect(html).toMatch(/personalidade, postura, princípios e estilo de comunicação/i);
    expect(html).toMatch(/Não coloque aqui ferramentas, permissões/i);
  });
});
