import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Agents, { AssistenteDeCriacao, DetalheAgent, SECOES_DO_AGENTE } from "./Agents";

/**
 * A suíte do app renderiza para markup estático e não clica em nada. Então o
 * que dá para provar aqui é o que a tela MOSTRA e o que ela OFERECE; a lógica
 * de decisão está em `domain/agents.test.js` e `domain/prontidaoDoAgente.test.js`,
 * e o caminho de evento real está em `Agents.interactive.test.jsx`.
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

describe("lista dos agentes", () => {
  it("chama pelo nome de produto, sem a nomenclatura técnica", () => {
    const html = render();
    expect(html).toContain("Sua equipe de IA");
    expect(html).toContain("Cada agente conversa com um público e faz um trabalho definido.");
    expect(html.toLowerCase()).not.toContain("audience");
    expect(html.toLowerCase()).not.toContain("assistant_profile");
    expect(html).not.toMatch(/is_default|isDefault=/);
  });

  it("mostra todos os agentes, dos dois públicos, com rótulo amigável", () => {
    const html = render();
    for (const nome of ["Emilia", "Closer", "Agenda", "Operacoes", "QA"]) expect(html).toContain(nome);
    expect(html).toContain("Clientes");
    expect(html).toContain("Equipe");
  });

  it("diz onde cada um atende: principal, pausado, ou ainda não atende", () => {
    const html = render();
    expect(html).toContain("Principal");
    expect(html).not.toContain(">Padrão<");
    expect(html).toContain("Pausado");
    expect(html).toContain("Ainda não atende");
  });

  it("atende por campanha só quando a campanha está no ar", () => {
    const html = render({ campanhas: [
      { name: "Formulário Meta", assistant_profile_id: "closer", status: "active" },
      { name: "Rascunho", assistant_profile_id: "qa", status: "draft" },
    ] });
    expect(html).toContain("Formulário Meta");
    expect(html).not.toContain("Rascunho");
  });

  it("agente é quadrado: cada um tem o seu símbolo, e não um avatar redondo de pessoa", () => {
    const html = render();
    expect((html.match(/viewBox="0 0 100 100"/g) || []).length).toBeGreaterThanOrEqual(elenco.length);
    expect(fonte).toContain("MarcaDoAgente");
    expect(fonte).not.toMatch(/<Iniciais/);
  });

  it("estado vazio, carregando e erro têm tela própria", () => {
    expect(render({ agents: [] })).toContain("Nenhum agente configurado.");
    expect(render({ carregando: true })).toContain("Carregando agentes…");
    const comErro = render({ erro: "Falhou" });
    expect(comErro).toContain("Falhou");
    expect(comErro).toContain('role="alert"');
  });

  it("sem permissão de escrita, não oferece criar agente", () => {
    expect(render({ canWrite: false })).not.toContain("Criar agente");
    expect(render()).toContain("Criar agente");
  });

  it("explica o que é o principal", () => {
    expect(render()).toMatch(/Principal(&quot;|")? é quem recebe primeiro/);
  });
});

describe("criação (passo 1: para que serve)", () => {
  const criacao = () => renderToStaticMarkup(
    <AssistenteDeCriacao catalogoSkills={[]} aoFechar={() => {}} aoCriar={async () => {}} />,
  );

  it("começa pela intenção, não por um formulário técnico", () => {
    const html = criacao();
    expect(html).toContain("Para que serve esse agente?");
    expect(html).not.toMatch(/<input/);
  });

  it("oferece os tipos de agente, incluindo a saída honesta 'Criar do zero'", () => {
    const html = criacao();
    for (const rotulo of ["Atendimento", "Vendas", "Criar do zero"]) expect(html).toContain(rotulo);
  });

  it("mostra o progresso em 3 passos", () => {
    expect(criacao()).toMatch(/aria-valuemax="3"/);
  });

  it("não menciona termos internos (soul, slug bruto, audience) na tela inicial", () => {
    const html = criacao();
    expect(html).not.toContain("soul");
    expect(html).not.toContain("audience");
  });
});

describe("invariáveis que a tela não pode quebrar", () => {
  it("G: com quem o agente conversa é somente leitura, e o patch nunca o envia", () => {
    expect(fonte).toMatch(/Com quem conversa[\s\S]{0,400}?disabled readOnly/);
    expect(fonte).toMatch(/name:[^\n]*slug:[^\n]*role:/);
    expect(fonte).not.toMatch(/audience:\s*rascunho/);
    expect(fonte).not.toMatch(/editar\([^)]*audience/);
  });

  it("D: nenhum agente nasce principal, e todo agente novo nasce pausado", () => {
    expect(fonte).not.toMatch(/isDefault:\s*(true|false)/);
    expect(fonte).toMatch(/Quem responde primeiro continua/);
    expect(fonte).toMatch(/active:\s*false/);
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

  it("a personalidade explica o que faz", () => {
    expect(fonte).toMatch(/conversar, se comportar e representar sua empresa/i);
  });
});

describe("página do agente, renderizada", () => {
  const skills = [
    { id: "s1", name: "Vendas", slug: "vendas", description: "Qualifica quem chega", audience: "customer", status: "published" },
    { id: "s2", name: "Agenda", slug: "agenda", description: "Marca horário", audience: "both", status: "published" },
  ];
  const acoes = {
    listarSkills: async () => [{ skill_id: "s1", enabled: true, priority: 10 }],
    definirSkill: async () => ({}), editar: async () => {},
    alternarAtivo: () => {}, tornarPadrao: () => {},
  };
  const detalhe = (over = {}, props = {}) => renderToStaticMarkup(
    <DetalheAgent agent={agent({ name: "Emilia", role: "Recepção", tone: "cordial", isDefault: true, ...over })}
      catalogoSkills={skills} canWrite aoVoltar={() => {}} acoes={acoes} {...props} />,
  );

  it("o roteiro tem as seções na ordem em que se monta um agente", () => {
    const html = detalhe();
    const roteiro = html.slice(html.indexOf('aria-label="Roteiro do agente"'), html.indexOf("</nav>"));
    const posicoes = SECOES_DO_AGENTE.map(([, rotulo]) => roteiro.indexOf(`>${rotulo}</span>`));
    expect(posicoes.every((p) => p >= 0)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(html).not.toMatch(/>Jeito</);
    expect(html).not.toMatch(/>Soul</);
    expect(html).toMatch(/de 5 itens prontos/);
  });

  it("abre na Personalidade: nome, função, como conversa e aparência", () => {
    const html = detalhe();
    for (const rotulo of ["Nome", "Função", "Como ele conversa", "Instruções", "Aparência", "Outro símbolo"]) {
      expect(html).toContain(rotulo);
    }
    expect(html).toContain("Emilia");
  });

  it("G: com quem conversa aparece desabilitado, com o motivo, sem a palavra 'audience'", () => {
    const html = detalhe();
    expect(html).toContain("Com quem conversa");
    expect(html.toLowerCase()).not.toContain("audience");
    expect(html).toMatch(/imutável depois/i);
  });

  it("o identificador técnico fica dentro de Configurações avançadas", () => {
    expect(detalhe()).toMatch(/Configurações avançadas[\s\S]{0,600}?Identificador técnico/);
  });

  it("H: oferece pausar quando ativo e ativar quando pausado", () => {
    expect(detalhe({ status: "active" })).toContain("Pausar");
    expect(detalhe({ status: "inactive" })).toContain("Ativar");
  });

  it("C: o principal aparece como tal no cabeçalho", () => {
    expect(detalhe({ isDefault: true })).toMatch(/Principal de clientes/i);
    expect(detalhe({ isDefault: false })).not.toMatch(/Principal de clientes/i);
  });

  it("Testar só aparece quando há onde testar, e não ocupa a tela", () => {
    expect(detalhe()).not.toContain("Testar");
    const html = detalhe({}, { extras: { testar: () => null } });
    expect(html).toContain("Testar");
    expect(html).not.toContain("Nada vai para clientes");
  });

  it("cabeçalho mostra o símbolo quadrado do agente", () => {
    expect(detalhe()).toMatch(/aria-label="Símbolo de Emilia"/);
  });

  it("somente leitura quando o usuário não pode escrever", () => {
    const html = renderToStaticMarkup(
      <DetalheAgent agent={agent()} catalogoSkills={skills} canWrite={false} aoVoltar={() => {}} acoes={acoes} />,
    );
    expect(html).not.toContain("Tornar principal");
    expect(html).not.toContain("Salvar");
    expect(html).not.toContain("Pausar");
  });
});
