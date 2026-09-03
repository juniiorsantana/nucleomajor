import { describe, expect, it } from "vitest";
import {
  adicionarDias,
  corDaPessoa,
  coresDaEquipe,
  corDoEvento,
  densidadeDoBloco,
  eventoVisivelNoFiltro,
  faixaVisivel,
  faixasPorPessoa,
  idsDosResponsaveis,
  iniciaisDoNome,
  intervaloDaVisao,
  passoParaAltura,
  segmentosDoDia,
  fundoDoEvento,
  eventoEditavel,
  eventoPessoalDeOutro,
  somarPorCategoria,
  somarPorPessoa,
  tipoDoEvento,
} from "./agendaUtils";

describe("permissões de eventos pessoais", () => {
  const pessoalDoLucas = {
    id: "evento-lucas",
    sourceType: "event",
    ownerId: "lucas",
    titulo: "Indisponível",
    visibilidade: "personal",
  };

  it("não permite que dono ou administrador edite evento pessoal de outra pessoa", () => {
    expect(eventoEditavel(pessoalDoLucas, "junior", "owner")).toBe(false);
    expect(eventoEditavel(pessoalDoLucas, "admin", "admin")).toBe(false);
  });

  it("identifica o evento pessoal de outro profissional para a interface somente leitura", () => {
    expect(eventoPessoalDeOutro(pessoalDoLucas, "junior")).toBe(true);
    expect(eventoPessoalDeOutro({ ...pessoalDoLucas, ownerId: "junior" }, "junior")).toBe(false);
    expect(eventoPessoalDeOutro({ ...pessoalDoLucas, visibilidade: "organization" }, "junior")).toBe(false);
  });
});

const evento = (id, inicio, fim, extras = {}) => ({
  id,
  sourceType: "event",
  titulo: id,
  inicio,
  fim,
  diaInteiro: false,
  categoryName: "Reunião",
  categoryColor: "#FB923C",
  ...extras,
});

describe("matemática da régua da agenda", () => {
  it("posiciona eventos sobrepostos em colunas distintas", () => {
    const dia = new Date(2026, 7, 21);
    const segmentos = segmentosDoDia([
      evento("a", new Date(2026, 7, 21, 9).toISOString(), new Date(2026, 7, 21, 11).toISOString()),
      evento("b", new Date(2026, 7, 21, 10).toISOString(), new Date(2026, 7, 21, 12).toISOString()),
      evento("c", new Date(2026, 7, 21, 13).toISOString(), new Date(2026, 7, 21, 14).toISOString()),
    ], dia);
    expect(segmentos.slice(0, 2).map((item) => item.colunas)).toEqual([2, 2]);
    expect(new Set(segmentos.slice(0, 2).map((item) => item.coluna)).size).toBe(2);
    expect(segmentos[2].colunas).toBe(1);
  });

  it("recorta na virada do dia sem perder o evento", () => {
    const dia = new Date(2026, 7, 21);
    const segmentos = segmentosDoDia([
      evento("noturno", new Date(2026, 7, 20, 23, 30).toISOString(), new Date(2026, 7, 21, 1).toISOString()),
    ], dia);
    expect(segmentos).toHaveLength(1);
    expect(segmentos[0].inicioMinutos).toBe(0);
    expect(segmentos[0].fimMinutos).toBe(60);
  });

  it("monta mês com seis semanas completas", () => {
    const faixa = intervaloDaVisao("month", new Date(2026, 7, 21));
    expect((faixa.ate - faixa.de) / 86400000).toBe(42);
    expect(faixa.de.getDay()).toBe(1);
    expect(adicionarDias(faixa.de, 41) < faixa.ate).toBe(true);
  });

  it("soma horas por categoria e separa indisponibilidade privada", () => {
    const totais = somarPorCategoria([
      evento("reunião", new Date(2026, 7, 21, 9).toISOString(), new Date(2026, 7, 21, 10, 30).toISOString()),
      evento("privado", new Date(2026, 7, 21, 11).toISOString(), new Date(2026, 7, 21, 12).toISOString(), { titulo: "Indisponível" }),
    ]);
    expect(totais).toEqual(expect.arrayContaining([
      expect.objectContaining({ nome: "Reunião", minutos: 90 }),
      expect.objectContaining({ nome: "Indisponível", minutos: 60 }),
    ]));
  });
});

describe("faixas por pessoa na visão de equipe", () => {
  const dia = new Date(2026, 7, 21);
  const as = (hora, minuto = 0) => new Date(2026, 7, 21, hora, minuto).toISOString();
  const membros = [
    { id: "ana", name: "Ana Prado" },
    { id: "bruno", name: "Bruno Lima" },
    { id: "caio", name: "Caio Souza" },
  ];

  it("dá a cada profissional a largura inteira da própria faixa", () => {
    // O bug que isto guarda: sem faixas, três pessoas reunidas às 10h
    // disputavam a mesma coluna do dia e viravam três tiras de 33%.
    const faixas = faixasPorPessoa([
      evento("ana-1", as(10), as(11), { ownerId: "ana" }),
      evento("bruno-1", as(10), as(11), { ownerId: "bruno" }),
      evento("caio-1", as(10), as(11), { ownerId: "caio" }),
    ], dia, membros);

    expect(faixas.map((faixa) => faixa.id)).toEqual(["ana", "bruno", "caio"]);
    for (const faixa of faixas) {
      expect(faixa.segmentos).toHaveLength(1);
      expect(faixa.segmentos[0].colunas).toBe(1);
    }
  });

  it("resolve sobreposição dentro da faixa de quem é dona dela", () => {
    const faixas = faixasPorPessoa([
      evento("ana-1", as(9), as(11), { ownerId: "ana" }),
      evento("ana-2", as(10), as(12), { ownerId: "ana" }),
      evento("bruno-1", as(10), as(11), { ownerId: "bruno" }),
    ], dia, membros);

    const ana = faixas.find((faixa) => faixa.id === "ana");
    const bruno = faixas.find((faixa) => faixa.id === "bruno");
    expect(ana.segmentos.map((item) => item.colunas)).toEqual([2, 2]);
    expect(bruno.segmentos[0].colunas).toBe(1);
  });

  it("mantém a faixa vazia, porque horário livre é a informação procurada", () => {
    const faixas = faixasPorPessoa([
      evento("ana-1", as(9), as(10), { ownerId: "ana" }),
    ], dia, membros);
    expect(faixas).toHaveLength(3);
    expect(faixas.find((faixa) => faixa.id === "caio").segmentos).toEqual([]);
  });

  it("omite faixa vazia quando o chamador pede densidade", () => {
    const faixas = faixasPorPessoa([
      evento("ana-1", as(9), as(10), { ownerId: "ana" }),
    ], dia, membros, { incluirVazias: false });
    expect(faixas.map((faixa) => faixa.id)).toEqual(["ana"]);
  });

  it("não engole quem tem evento mas saiu da lista de membros", () => {
    const faixas = faixasPorPessoa([
      evento("ex-1", as(9), as(10), { ownerId: "ex-membro", ownerName: "Dani Alves" }),
    ], dia, membros);
    const extra = faixas.find((faixa) => faixa.id === "ex-membro");
    expect(extra).toBeDefined();
    expect(extra.nome).toBe("Dani Alves");
  });

  it("soma o ocupado de cada profissional", () => {
    const totais = somarPorPessoa([
      evento("ana-1", as(9), as(10, 30), { ownerId: "ana", ownerName: "Ana Prado" }),
      evento("ana-2", as(14), as(15), { ownerId: "ana", ownerName: "Ana Prado" }),
      evento("bruno-1", as(10), as(11), { ownerId: "bruno", ownerName: "Bruno Lima" }),
    ]);
    expect(totais[0]).toEqual(expect.objectContaining({ id: "ana", minutos: 150 }));
    expect(totais[1]).toEqual(expect.objectContaining({ id: "bruno", minutos: 60 }));
  });
});

describe("tarefa com mais de um responsável", () => {
  const as = (hora, minuto = 0) => new Date(2026, 8, 3, hora, minuto).toISOString();
  const compartilhada = {
    id: "tarefa-1",
    sourceType: "task",
    titulo: "Fechar a proposta",
    inicio: as(10),
    fim: as(10, 30),
    diaInteiro: false,
    ownerId: "ana",
    ownerName: "Ana Prado",
    assigneeIds: ["ana", "bruno", "carla"],
    visibilidade: "organization",
  };

  it("cai no responsável principal quando a lista não veio", () => {
    // O RPC antigo não devolve `assignee_ids`. Enquanto a migration não sobe,
    // a agenda tem de continuar desenhando com o que existe.
    expect(idsDosResponsaveis({ ownerId: "ana" })).toEqual(["ana"]);
    expect(idsDosResponsaveis({ ownerId: "ana", assigneeIds: [] })).toEqual(["ana"]);
    expect(idsDosResponsaveis({})).toEqual([]);
  });

  it("ocupa a faixa de cada responsável, e não só a do principal", () => {
    // É o que faz a faixa vazia significar "essa pessoa está livre". Se a
    // tarefa aparecesse só na faixa da Ana, Bruno e Carla pareceriam
    // disponíveis às 10h — e alguém marcaria reunião por cima.
    const faixas = faixasPorPessoa([compartilhada], new Date(2026, 8, 3), [
      { id: "ana", name: "Ana Prado" },
      { id: "bruno", name: "Bruno Lima" },
      { id: "carla", name: "Carla Dias" },
      { id: "davi", name: "Davi Souza" },
    ]);
    const ocupadas = faixas.filter((faixa) => faixa.segmentos.length).map((faixa) => faixa.id);
    expect(ocupadas).toEqual(["ana", "bruno", "carla"]);
    expect(faixas.find((faixa) => faixa.id === "davi").segmentos).toHaveLength(0);
  });

  it("conta os minutos de cada responsável no resumo da equipe", () => {
    const totais = somarPorPessoa([compartilhada]);
    expect(totais.map((item) => item.id).sort()).toEqual(["ana", "bruno", "carla"]);
    expect(totais.every((item) => item.minutos === 30)).toBe(true);
  });

  it("mostra a tarefa ao filtrar por qualquer um dos responsáveis", () => {
    expect(eventoVisivelNoFiltro(compartilhada, "carla", "davi")).toBe(true);
  });
});

describe("a cor da pessoa é a do perfil", () => {
  it("usa a cor escolhida na Equipe em vez de derivar do id", () => {
    // A agenda tinha uma paleta própria e a mesma pessoa saía de uma cor aqui
    // e de outra na Equipe. Escolher a cor não servia de nada.
    const cores = coresDaEquipe([{ id: "ana", color: "#0369A1" }]);
    expect(corDaPessoa("ana", cores)).toBe("#0369a1");
    expect(corDoEvento({ sourceType: "event", ownerId: "ana", tipo: "appointment" }, "pessoa", cores))
      .toBe("#0369a1");
  });

  it("deriva do id quem ainda não escolheu, e quem já saiu da equipe", () => {
    const cores = coresDaEquipe([{ id: "ana", color: null }]);
    expect(corDaPessoa("ana", cores)).toMatch(/^#[0-9a-f]{6}$/);
    // "zoe" não está no mapa: derivar mantém o bloco antigo com a cor de
    // sempre em vez de apagá-lo.
    expect(corDaPessoa("zoe", cores)).toBe(corDaPessoa("zoe", cores));
    expect(corDaPessoa("zoe", cores)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("identidade visual do bloco", () => {
  it("mantém a cor da pessoa estável e independente da posição na lista", () => {
    const antes = corDaPessoa("ana");
    const depois = corDaPessoa("ana");
    expect(antes).toBe(depois);
    expect(antes).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("troca a dimensão pintada conforme o modo escolhido", () => {
    const item = evento("x", new Date().toISOString(), new Date().toISOString(), {
      ownerId: "ana",
      tipo: "appointment",
      categoryColor: "#FB923C",
    });
    // A cor conta o TIPO, não a categoria: numa agenda com uma categoria só
    // configurada, pintar por categoria devolvia a semana inteira da mesma cor.
    expect(corDoEvento(item, "tipo")).toBe(tipoDoEvento(item).cor);
    expect(corDoEvento(item, "tipo")).not.toBe("#FB923C");
    expect(corDoEvento(item, "pessoa")).toBe(corDaPessoa("ana"));
  });

  it("trata 'categoria' gravado antes como a cor padrão de hoje", () => {
    // Quem já usava a agenda tem "categoria" no localStorage. A preferência
    // antiga não pode virar tela quebrada nem um modo que não existe mais.
    const item = evento("x", new Date().toISOString(), new Date().toISOString(), { tipo: "event" });
    expect(corDoEvento(item, "categoria")).toBe(corDoEvento(item, "tipo"));
  });

  it("classifica o tipo pela origem antes do campo do formulário", () => {
    const agora = new Date().toISOString();
    expect(tipoDoEvento(evento("a", agora, agora, { titulo: "Indisponível", tipo: "event" })).id).toBe("unavailable");
    expect(tipoDoEvento({ ...evento("b", agora, agora), sourceType: "task", tipo: "appointment" }).id).toBe("task");
    expect(tipoDoEvento(evento("c", agora, agora, { tipo: "block" })).id).toBe("block");
    expect(tipoDoEvento(evento("d", agora, agora, { tipo: "event" })).id).toBe("event");
    expect(tipoDoEvento(evento("e", agora, agora, {})).id).toBe("appointment");
  });

  it("deixa indisponibilidade cinza nos dois modos", () => {
    const bloqueio = evento("x", new Date().toISOString(), new Date().toISOString(), {
      titulo: "Indisponível",
      ownerId: "ana",
    });
    const cinza = tipoDoEvento(bloqueio).cor;
    expect(corDoEvento(bloqueio, "tipo")).toBe(cinza);
    expect(corDoEvento(bloqueio, "pessoa")).toBe(cinza);
  });

  it("dilui a cor no fundo da tela em vez de calcular a cor do texto", () => {
    // O contrato que substituiu a função de contraste: o fundo sai da cor do
    // evento misturada com --el-bg, então o texto pode ser sempre --el-fg e
    // qualquer cor que a empresa escolher no seletor nasce legível. Depender
    // de --el-bg é o que faz o tema escuro funcionar sem uma segunda paleta.
    const fundo = fundoDoEvento("#22C55E");
    expect(fundo).toContain("#22C55E");
    expect(fundo).toContain("var(--el-bg)");
    expect(fundoDoEvento("#22C55E", 8)).toContain("8%");
  });

  it("extrai iniciais de nome simples e composto", () => {
    expect(iniciaisDoNome("Ana Prado")).toBe("AP");
    expect(iniciaisDoNome("Ana Maria Prado")).toBe("AP");
    expect(iniciaisDoNome("Ana")).toBe("AN");
    expect(iniciaisDoNome("")).toBe("?");
  });
});

describe("faixa desenhada versus expediente", () => {
  const as = (hora, minuto = 0) => new Date(2026, 7, 21, hora, minuto).toISOString();
  const EXPEDIENTE = [8 * 60, 18 * 60];

  it("não deixa evento fora do expediente sumir da grade", () => {
    // O bug: com expediente até as 18h, um jantar às 19h30 era descartado pelo
    // filtro de segmentos e a tela ficava vazia - enquanto o resumo continuava
    // somando as horas dele.
    const faixa = faixaVisivel([evento("jantar", as(19, 30), as(21))], ...EXPEDIENTE);
    expect(faixa.fim).toBe(21 * 60);
    expect(faixa.inicio).toBe(8 * 60);
  });

  it("estica para trás quando o evento começa antes do expediente", () => {
    const faixa = faixaVisivel([evento("voo", as(5, 40), as(7))], ...EXPEDIENTE);
    expect(faixa.inicio).toBe(5 * 60);
    expect(faixa.fim).toBe(18 * 60);
  });

  it("mantém o expediente quando tudo cabe dentro dele", () => {
    const faixa = faixaVisivel([evento("reunião", as(10), as(11))], ...EXPEDIENTE);
    expect(faixa).toEqual({ inicio: 8 * 60, fim: 18 * 60 });
  });

  it("abre o dia inteiro para evento que atravessa a meia-noite", () => {
    const faixa = faixaVisivel([
      evento("virada", as(23), new Date(2026, 7, 22, 1).toISOString()),
    ], ...EXPEDIENTE);
    expect(faixa.inicio).toBe(0);
    expect(faixa.fim).toBe(24 * 60);
  });

  it("ignora evento de dia inteiro, que mora na faixa própria", () => {
    const faixa = faixaVisivel([
      evento("feriado", as(0), as(23, 59), { diaInteiro: true }),
    ], ...EXPEDIENTE);
    expect(faixa).toEqual({ inicio: 8 * 60, fim: 18 * 60 });
  });

  it("sobrevive a data inválida e a expediente invertido", () => {
    expect(faixaVisivel([evento("quebrado", "não é data", "nem isso")], ...EXPEDIENTE))
      .toEqual({ inicio: 8 * 60, fim: 18 * 60 });
    const invertido = faixaVisivel([], 18 * 60, 8 * 60);
    expect(invertido.fim).toBeGreaterThan(invertido.inicio);
  });

  it("nunca passa da meia-noite", () => {
    const faixa = faixaVisivel([evento("tarde", as(23, 30), as(23, 59))], ...EXPEDIENTE);
    expect(faixa.fim).toBe(24 * 60);
  });
});

describe("densidade e passo em função do zoom", () => {
  it("degrada o conteúdo do bloco conforme a altura disponível", () => {
    expect(densidadeDoBloco(80)).toBe("completa");
    expect(densidadeDoBloco(40)).toBe("media");
    expect(densidadeDoBloco(18)).toBe("minima");
  });

  it("libera ajuste fino só quando o zoom dá resolução para isso", () => {
    expect(passoParaAltura(32)).toBe(30);
    expect(passoParaAltura(64)).toBe(30);
    expect(passoParaAltura(96)).toBe(15);
    expect(passoParaAltura(144)).toBe(5);
  });

  it("mantém o título de uma reunião de 30 minutos visível já no zoom padrão", () => {
    // O corte antigo era 38px: com 64px/hora, meia hora dá 32px e o título
    // sumia justamente no evento mais comum da agenda. "media" existe para
    // cobrir essa faixa mostrando hora e título; só o responsável fica de fora.
    expect(densidadeDoBloco(64 / 2)).toBe("media");
    expect(densidadeDoBloco(96 / 2)).toBe("media");
    expect(densidadeDoBloco(144 / 2)).toBe("completa");
  });
});
