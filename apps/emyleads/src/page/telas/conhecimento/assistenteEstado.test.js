import { describe, expect, it } from "vitest";
import {
  avancar,
  conteudoDoEstado,
  documentoDoEstado,
  escolherModelo,
  escolherPublico,
  estadoInicial,
  estadoFoiAlterado,
  motivoParaNaoAvancar,
  motivoParaNaoPublicarAgora,
  sincronizarCaminho,
  temConteudo,
  voltar,
} from "./assistenteEstado";

const COLECOES = [
  { id: "col-ext", name: "Atendimento", audience: "external", scope_type: "organization" },
  { id: "col-int", name: "Comercial", audience: "internal", scope_type: "organization" },
];

/**
 * Um estado pronto para a revisão, como a tela o entrega.
 *
 * Passa por `sincronizarCaminho` porque o componente também passa: `caminho`
 * não nasce mais do modelo, é derivado do título. O patch vem depois da
 * sincronização para um teste poder fixar um caminho à mão.
 */
const pronto = (patch = {}) => ({
  ...sincronizarCaminho({
    ...estadoInicial("empresa"),
    etapa: 4,
    caminhoDeEscrita: "guiado",
    blocos: [{ rotulo: "Quem é a empresa", texto: "Uma agência de Cuiabá." }],
    publico: "equipe",
  }),
  ...patch,
});

describe("estadoInicial", () => {
  it("começa na etapa 1 quando não veio assunto", () => {
    expect(estadoInicial().etapa).toBe(1);
  });

  it("pula para a etapa 2 quando o assunto já foi escolhido no primeiro acesso", () => {
    // Os cartões de "comece por aqui" já respondem a etapa 1; repetir a
    // pergunta faria a pessoa escolher duas vezes a mesma coisa.
    const estado = estadoInicial("empresa");
    expect(estado.etapa).toBe(2);
    expect(estado.modeloId).toBe("empresa");
    expect(estado.titulo).toBe("Sobre a empresa");
  });

  it("já fixa o caminho de perguntas e respostas nos modelos que são disso", () => {
    expect(estadoInicial("faq").caminhoDeEscrita).toBe("perguntas");
  });

  it("preserva no estado os campos que devem virar lista Markdown", () => {
    const estado = estadoInicial("servicos");
    expect(estado.blocos[0].lista).toBe(true);
    const preenchido = {
      ...estado,
      caminhoDeEscrita: "guiado",
      blocos: estado.blocos.map((bloco, indice) => ({
        ...bloco,
        texto: indice === 0 ? "Gestão de tráfego\nCriação de sites" : "",
      })),
    };
    expect(conteudoDoEstado(preenchido)).toContain("- Gestão de tráfego\n- Criação de sites");
  });
});

describe("estadoFoiAlterado", () => {
  it("só pede confirmação de descarte depois de alguma mudança", () => {
    const inicial = estadoInicial("empresa");
    expect(estadoFoiAlterado(inicial, inicial)).toBe(false);
    expect(estadoFoiAlterado({ ...inicial, titulo: "Sobre a Major" }, inicial)).toBe(true);
  });
});

describe("motivoParaNaoAvancar", () => {
  it("etapa 1 exige assunto", () => {
    expect(motivoParaNaoAvancar(estadoInicial())).toMatch(/assunto/i);
    expect(motivoParaNaoAvancar({ ...estadoInicial(), modeloId: "empresa" })).toBeNull();
  });

  it("etapa 2 exige o caminho de escrita", () => {
    const estado = { ...estadoInicial("livre"), etapa: 2, caminhoDeEscrita: null };
    expect(motivoParaNaoAvancar(estado)).toMatch(/como você quer escrever/i);
  });

  it("etapa 2 também exige o conteúdo, porque é nela que se escreve", () => {
    const escolhido = { ...estadoInicial("empresa"), etapa: 2, caminhoDeEscrita: "guiado" };
    expect(motivoParaNaoAvancar(escolhido)).toMatch(/escreva o conteúdo/i);
    const preenchido = { ...escolhido, blocos: [{ rotulo: "Quem é a empresa", texto: "Uma agência." }] };
    expect(motivoParaNaoAvancar(preenchido)).toBeNull();
  });

  it("etapa 3 exige público", () => {
    expect(motivoParaNaoAvancar({ ...pronto(), etapa: 3, publico: null })).toMatch(/quem poderá usar/i);
    expect(motivoParaNaoAvancar({ ...pronto(), etapa: 3 })).toBeNull();
  });

  it("etapa 3 não trava conteúdo de cliente sem coleção — rascunho é legítimo", () => {
    // `nucleo_knowledge_save` grava rascunho externo sem coleção; só publicar
    // exige. A versão de cinco etapas travava aqui, e por isso esse caminho
    // nunca era alcançável pelo assistente.
    const semColecao = { ...pronto(), etapa: 3, publico: "clientes", ondeTodos: false, colecoesIds: [] };
    expect(motivoParaNaoAvancar(semColecao)).toBeNull();
    expect(motivoParaNaoPublicarAgora(semColecao, COLECOES)).toMatch(/coleção externa/i);
  });

  it("etapa 4 recusa documento vazio mesmo com título preenchido", () => {
    // Só o `# Título` não é conteúdo: o documento entraria na busca e não
    // teria o que responder.
    const vazio = { ...pronto(), blocos: [{ rotulo: "Quem é a empresa", texto: "" }] };
    expect(temConteudo(vazio)).toBe(false);
    expect(motivoParaNaoAvancar(vazio)).toMatch(/vazio/i);
  });
});

describe("conteudoDoEstado", () => {
  it("o caminho guiado vira título e blocos", () => {
    expect(conteudoDoEstado(pronto())).toBe("# Sobre a empresa\n\n## Quem é a empresa\n\nUma agência de Cuiabá.\n");
  });

  it("o caminho de perguntas vira um subtítulo por pergunta", () => {
    const estado = pronto({
      caminhoDeEscrita: "perguntas",
      titulo: "Perguntas frequentes",
      perguntas: [
        { pergunta: "Vocês atendem fora de Cuiabá?", resposta: "Todo o Brasil, de forma remota." },
        { pergunta: "", resposta: "resposta sem pergunta" },
      ],
    });
    const markdown = conteudoDoEstado(estado);
    expect(markdown).toContain("## Vocês atendem fora de Cuiabá?");
    expect(markdown).toContain("Todo o Brasil, de forma remota.");
    expect(markdown).not.toContain("resposta sem pergunta");
  });

  it("texto colado e arquivo enviado passam direto", () => {
    expect(conteudoDoEstado(pronto({ caminhoDeEscrita: "texto", texto: "# Já vem pronto" }))).toBe("# Já vem pronto");
    expect(conteudoDoEstado(pronto({ caminhoDeEscrita: "arquivo", texto: "do arquivo" }))).toBe("do arquivo");
  });
});

describe("documentoDoEstado", () => {
  it("traduz público para escopo e audiência", () => {
    expect(documentoDoEstado(pronto({ publico: "clientes" }))).toMatchObject({ escopo: "organization", audiencia: "external" });
    expect(documentoDoEstado(pronto({ publico: "equipe" }))).toMatchObject({ escopo: "organization", audiencia: "internal" });
    expect(documentoDoEstado(pronto({ publico: "pessoal" }))).toMatchObject({ escopo: "personal", audiencia: "internal" });
  });

  it("acrescenta .md ao caminho quando falta", () => {
    // Rede de segurança: `sincronizarCaminho` já entrega com extensão, mas um
    // caminho digitado à mão no campo avançado pode chegar sem ela.
    expect(documentoDoEstado(pronto({ caminho: "empresa/sobre" })).caminho).toBe("empresa/sobre.md");
    expect(documentoDoEstado(pronto({ caminho: "empresa/sobre.md" })).caminho).toBe("empresa/sobre.md");
  });

  it("documento pessoal nunca leva coleção", () => {
    const estado = pronto({ publico: "pessoal", ondeTodos: false, colecoesIds: ["col-ext"] });
    expect(documentoDoEstado(estado).colecoesIds).toEqual([]);
  });

  it("“em qualquer lugar” limpa as coleções escolhidas antes", () => {
    const estado = pronto({ ondeTodos: true, colecoesIds: ["col-int"] });
    expect(documentoDoEstado(estado).colecoesIds).toEqual([]);
  });

  it("conteúdo de cliente nunca perde a coleção por um estado antigo de qualquer lugar", () => {
    const estado = pronto({ publico: "clientes", ondeTodos: true, colecoesIds: ["col-ext"] });
    expect(documentoDoEstado(estado).colecoesIds).toEqual(["col-ext"]);
  });
});

describe("escolherPublico", () => {
  it("cliente exige destino específico e marca a única coleção externa", () => {
    const estado = escolherPublico(pronto(), "clientes", [COLECOES[0]]);
    expect(estado).toMatchObject({ publico: "clientes", ondeTodos: false, colecoesIds: ["col-ext"] });
  });

  it("não adivinha quando há mais de uma coleção externa", () => {
    const estado = escolherPublico(pronto(), "clientes", [
      COLECOES[0],
      { id: "col-camp", name: "Campanha", audience: "external", scope_type: "campaign" },
    ]);
    expect(estado).toMatchObject({ publico: "clientes", ondeTodos: false, colecoesIds: [] });
  });

  it("equipe e pessoal podem continuar no conhecimento geral", () => {
    expect(escolherPublico(pronto(), "equipe", COLECOES)).toMatchObject({ ondeTodos: true, colecoesIds: [] });
    expect(escolherPublico(pronto(), "pessoal", COLECOES)).toMatchObject({ ondeTodos: true, colecoesIds: [] });
  });
});

describe("motivoParaNaoPublicarAgora", () => {
  it("conteúdo de cliente sem coleção externa não publica", () => {
    const estado = pronto({ publico: "clientes", ondeTodos: true });
    expect(motivoParaNaoPublicarAgora(estado, COLECOES)).toMatch(/coleção externa/i);
  });

  it("com a coleção externa escolhida, publica", () => {
    const estado = pronto({ publico: "clientes", ondeTodos: false, colecoesIds: ["col-ext"] });
    expect(motivoParaNaoPublicarAgora(estado, COLECOES)).toBeNull();
  });

  it("conteúdo interno publica sem coleção nenhuma", () => {
    expect(motivoParaNaoPublicarAgora(pronto({ publico: "equipe" }), COLECOES)).toBeNull();
  });

  it("repete a pendência da revisão antes de falar de coleção", () => {
    // Documento vazio e sem coleção: a frase útil é a do vazio, não a da
    // coleção — resolver a coleção não faria o botão liberar.
    const estado = pronto({ publico: "clientes", blocos: [{ rotulo: "X", texto: "" }] });
    expect(motivoParaNaoPublicarAgora(estado, COLECOES)).toMatch(/vazio/i);
  });
});

describe("escolherModelo", () => {
  it("troca os blocos ao trocar de assunto", () => {
    const estado = escolherModelo(estadoInicial("empresa"), "comercial");
    expect(estado.blocos.map((bloco) => bloco.rotulo)).toEqual(["Formas de pagamento", "Descontos permitidos", "O que nunca pode ser oferecido"]);
    expect(estado.titulo).toBe("Regras comerciais");
  });

  it("preserva o título que a pessoa digitou", () => {
    const escrito = { ...estadoInicial("empresa"), titulo: "Sobre a Major Hub" };
    expect(escolherModelo(escrito, "comercial").titulo).toBe("Sobre a Major Hub");
  });

  it("navegar não passa da primeira nem da última etapa", () => {
    expect(voltar({ ...estadoInicial(), etapa: 1 }).etapa).toBe(1);
    expect(avancar({ ...estadoInicial(), etapa: 4 }).etapa).toBe(4);
  });
});

describe("sincronizarCaminho", () => {
  it("deriva o caminho do título enquanto ninguém o escolheu à mão", () => {
    const estado = sincronizarCaminho(estadoInicial("empresa"));
    expect(estado.caminho).toBe("empresa/sobre-a-empresa.md");
  });

  it("acompanha a troca de título", () => {
    const base = sincronizarCaminho(estadoInicial("empresa"));
    const renomeado = sincronizarCaminho({ ...base, titulo: "Quem somos" });
    expect(renomeado.caminho).toBe("empresa/quem-somos.md");
  });

  it("acompanha a troca de assunto, que muda a pasta", () => {
    const empresa = sincronizarCaminho(estadoInicial("empresa"));
    const comercial = sincronizarCaminho(escolherModelo(empresa, "servicos"));
    expect(comercial.caminho).toBe("comercial/produtos-e-servicos.md");
  });

  it("desvia dos caminhos já ocupados", () => {
    const estado = sincronizarCaminho(estadoInicial("empresa"), ["empresa/sobre-a-empresa.md"]);
    expect(estado.caminho).toBe("empresa/sobre-a-empresa-2.md");
  });

  it("uma escolha manual não é desfeita por uma troca de título", () => {
    // Sem isto, quem abre o campo avançado, digita um caminho e depois corrige
    // uma vírgula do título perde a escolha sem nada avisar.
    const manual = { ...estadoInicial("empresa"), caminho: "meu/caminho.md", caminhoManual: true };
    expect(sincronizarCaminho({ ...manual, titulo: "Outro título" }).caminho).toBe("meu/caminho.md");
  });

  it("devolve o mesmo objeto quando nada muda, para não disparar render à toa", () => {
    const estado = sincronizarCaminho(estadoInicial("empresa"));
    expect(sincronizarCaminho(estado)).toBe(estado);
  });
});
