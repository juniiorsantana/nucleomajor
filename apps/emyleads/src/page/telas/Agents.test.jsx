import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Agents, { AssistenteDeCriacao, DetalheAgent } from "./Agents";

/**
 * A suíte do app renderiza para markup estático e não clica em nada. Então o
 * que dá para provar aqui é o que a tela MOSTRA e o que ela OFERECE; a lógica
 * de decisão está em `domain/agents.test.js`, e o caminho de evento real está
 * em `Agents.interactive.test.jsx`.
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

describe("home dos agentes", () => {
  it("chama pelo nome de produto: 'Seus agentes', não a nomenclatura técnica", () => {
    const html = render();
    expect(html).toContain("Seus agentes");
    expect(html).toContain("Crie agentes especializados para atender seus clientes e ajudar sua equipe.");
    // Nada de audience/assistant_profile/is_default no que a pessoa lê.
    expect(html.toLowerCase()).not.toContain("audience");
    expect(html.toLowerCase()).not.toContain("assistant_profile");
    expect(html).not.toMatch(/is_default|isDefault=/);
  });

  it("A/B: mostra todos os agentes, das duas audiências, com rótulo amigável", () => {
    const html = render();
    for (const nome of ["Emilia", "Closer", "Agenda", "Operacoes", "QA"]) {
      expect(html).toContain(nome);
    }
    expect(html).toContain("Clientes");
    expect(html).toContain("Equipe");
  });

  it("C: identifica o principal como 'Principal', não 'Padrão'", () => {
    const html = render();
    expect(html).toContain("Principal");
    expect(html).not.toContain(">Padrão<");
    expect(html).toContain("Ativo");
    expect(html).toContain("Inativo");
  });

  it("cada agente tem um avatar (iniciais coloridas), como um perfil", () => {
    const html = render();
    // O avatar usa <Iniciais>: um círculo colorido com as letras do nome.
    expect(html).toMatch(/rounded-full[^>]*>\s*E/); // Emilia -> "E" ou "EM"
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
    expect(render({ canWrite: false })).not.toContain("Criar agente");
    expect(render()).toContain("Criar agente");
  });

  it("O: as duas apresentações existem — mestre/detalhe no desktop, uma tela no mobile", () => {
    const html = render();
    expect(html).toContain("md:grid-cols-[320px_minmax(0,1fr)]");
    expect(html).toContain("md:hidden");
  });

  it("aponta onde ficou o que esta tela ainda não cobre, com o nome novo da aba", () => {
    expect(render()).toMatch(/Liberação e marca/);
  });
});

describe("assistente de criação (passo 1: intenção)", () => {
  const criacao = () => renderToStaticMarkup(
    <AssistenteDeCriacao catalogoSkills={[]} aoFechar={() => {}} aoCriar={async () => {}} />,
  );

  it("começa pela intenção, não por um formulário técnico", () => {
    const html = criacao();
    expect(html).toContain("O que você quer que esse agente faça?");
    // O primeiro passo não pede nome, slug ou audience ainda.
    expect(html).not.toMatch(/<input/);
  });

  it("oferece os presets de papel, incluindo a saída honesta 'Criar do zero'", () => {
    const html = criacao();
    for (const rotulo of ["Atendimento", "Vendas", "Qualificação", "Agenda", "Suporte", "Cobrança", "Equipe interna", "Criar do zero"]) {
      expect(html).toContain(rotulo);
    }
  });

  it("mostra o progresso em 5 passos", () => {
    expect(criacao()).toMatch(/aria-valuemax="5"/);
  });

  it("não menciona termos internos (soul, slug bruto, audience) na tela inicial", () => {
    const html = criacao().toLowerCase();
    expect(html).not.toContain("soul");
    expect(html).not.toContain("audience");
  });
});

describe("invariáveis que a tela não pode quebrar", () => {
  it("G: quem o agente atende é somente leitura no detalhe, e o patch nunca o envia", () => {
    expect(fonte).toMatch(/Quem ele atende[\s\S]{0,400}?disabled readOnly/);
    expect(fonte).toMatch(/name:[^\n]*slug:[^\n]*role:/);
    expect(fonte).not.toMatch(/audience:\s*rascunho/);
    expect(fonte).not.toMatch(/editar\([^)]*audience/);
  });

  it("D: nenhum preset, nem o assistente, marca o agente como principal na criação", () => {
    expect(fonte).not.toMatch(/isDefault:\s*(true|false)/);
    expect(fonte).toMatch(/Quem responde primeiro continua/);
  });

  it("J: trocar o principal é UMA chamada, e é a operação atômica", () => {
    expect(fonte).toContain("api.agents.tornarPadrao");
    expect(fonte).not.toMatch(/definirAtivo[\s\S]{0,200}tornarPadrao/);
    expect((fonte.match(/api\.agents\.tornarPadrao/g) || []).length).toBe(1);
  });

  it("K: toda escrita é seguida de recarga do servidor", () => {
    for (const bloco of ["tornarPadrao", "definirAtivo", "editar"]) {
      const i = fonte.indexOf(`api.agents.${bloco}`);
      expect(i).toBeGreaterThan(-1);
      expect(fonte.slice(i, i + 220)).toContain("recarregar()");
    }
  });

  it("N: nada de estado otimista fora do que o servidor confirmou", () => {
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

  it("avatar reusa o mesmo algoritmo de cor das pessoas, não uma cópia", () => {
    expect(fonte).toMatch(/corDoAgent[\s\S]{0,200}from "\.\.\/\.\.\/domain\/agents"/);
    expect(fonte).not.toMatch(/function corDerivada/);
  });

  it("Personalidade explica o que faz, e diz que não concede permissão em lugar nenhum do fluxo", () => {
    expect(fonte).toMatch(/conversar, se comportar e representar sua empresa/i);
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

  it("as três abas são Geral, Personalidade e 'O que sabe fazer'", () => {
    const html = detalhe();
    for (const rotulo of ["Geral", "Personalidade", "O que sabe fazer"]) {
      expect(html).toContain(rotulo);
    }
    expect(html).not.toMatch(/>Soul</);
    expect(html).not.toMatch(/>Skills</);
  });

  it("F: oferece nome, função e como conversa", () => {
    const html = detalhe();
    for (const rotulo of ["Nome", "Função", "Como ele conversa"]) {
      expect(html).toContain(rotulo);
    }
    expect(html).toContain("Emilia");
  });

  it("G: quem atende aparece desabilitado, com o motivo — sem a palavra 'audience'", () => {
    const html = detalhe();
    expect(html).toContain("Quem ele atende");
    expect(html.toLowerCase()).not.toContain("audience");
    expect(html).toMatch(/imutável depois/i);
  });

  it("o identificador técnico fica dentro de Configurações avançadas, não solto na tela", () => {
    const html = detalhe();
    expect(html).toContain("Configurações avançadas");
    expect(html).toMatch(/Configurações avançadas[\s\S]{0,600}?agente-recepcao|Identificador técnico/);
  });

  it("H: oferece desativar quando ativo e ativar quando inativo", () => {
    expect(detalhe({ status: "active" })).toContain("Desativar");
    expect(detalhe({ status: "inactive" })).toContain("Ativar");
  });

  it("C: no principal mostra 'Agente principal de <audiência>', sem oferecer promovê-lo de novo", () => {
    const principal = detalhe({ isDefault: true });
    expect(principal).toMatch(/Agente principal de clientes/i);
    expect(principal).not.toContain("Tornar principal");
    expect(detalhe({ isDefault: false })).toContain("Tornar principal");
  });

  it("cabeçalho mostra o avatar do agente", () => {
    expect(detalhe()).toMatch(/rounded-full/);
  });

  it("somente leitura quando o usuário não pode escrever", () => {
    const html = renderToStaticMarkup(
      <DetalheAgent agent={agent()} catalogoSkills={skills} canWrite={false}
        aoVoltar={() => {}} acoes={acoes} />,
    );
    expect(html).not.toContain("Tornar principal");
    expect(html).not.toContain("Salvar");
  });
});
