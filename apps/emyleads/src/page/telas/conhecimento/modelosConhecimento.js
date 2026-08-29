/**
 * Os modelos de documento.
 *
 * O assistente de criação, o estado de primeiro acesso e o editor simples
 * leem daqui — os três precisam da mesma lista, e duplicar faria a etapa 1
 * oferecer um assunto que o editor não sabe montar.
 *
 * Cada bloco é uma pergunta em português de gente com uma ajuda embaixo. O
 * `rotulo` vira `## título` no Markdown salvo; o resto não entra no texto.
 */

export const MODELOS = [
  {
    id: "empresa",
    rotulo: "Sobre a empresa",
    descricao: "Quem vocês são, como trabalham e o que não fazem",
    caminho: "empresa/sobre.md",
    blocos: [
      {
        rotulo: "Quem é a empresa",
        ajuda: "Uma frase que você diria a alguém que nunca ouviu falar de vocês.",
        exemplo: "A Major Hub é uma agência de marketing e tecnologia em Cuiabá.",
      },
      {
        rotulo: "O que vocês fazem",
        ajuda: "Liste os serviços do jeito que o cliente pergunta por eles.",
        lista: true,
      },
      {
        rotulo: "O que vocês não fazem",
        ajuda: "É o que mais evita o assistente prometer algo errado para um cliente.",
        importante: true,
      },
      {
        rotulo: "Onde atendemos",
        ajuda: "Cidades, regiões, ou “todo o Brasil”.",
      },
    ],
  },
  {
    id: "servicos",
    rotulo: "Produtos e serviços",
    descricao: "Pacotes, prazos e o que está incluído",
    caminho: "comercial/servicos.md",
    blocos: [
      { rotulo: "O que está incluído", ajuda: "Um item por linha, com o nome que o cliente usa.", lista: true },
      { rotulo: "Prazos", ajuda: "Quanto tempo leva cada coisa, do jeito que você responderia no WhatsApp." },
      { rotulo: "O que não está incluído", ajuda: "Evita cobrança de expectativa que ninguém prometeu.", importante: true },
    ],
  },
  {
    id: "faq",
    rotulo: "Perguntas frequentes",
    descricao: "O que os clientes mais perguntam, com a resposta pronta",
    caminho: "atendimento/perguntas-frequentes.md",
    perguntasERespostas: true,
    blocos: [],
  },
  {
    id: "atendimento",
    rotulo: "Processo de atendimento",
    descricao: "Do primeiro contato até o encaminhamento",
    caminho: "atendimento/processo.md",
    blocos: [
      { rotulo: "Como começa o atendimento", ajuda: "O que acontece quando alguém manda a primeira mensagem." },
      { rotulo: "Quando encaminhar para uma pessoa", ajuda: "Os casos em que o assistente não deve seguir sozinho.", importante: true },
      { rotulo: "Horários", ajuda: "Quando vocês respondem — e o que dizer fora desse horário." },
    ],
  },
  {
    id: "comercial",
    rotulo: "Regras comerciais",
    descricao: "Descontos, prazos de pagamento e limites",
    caminho: "comercial/regras.md",
    blocos: [
      { rotulo: "Formas de pagamento", ajuda: "O que vocês aceitam.", lista: true },
      { rotulo: "Descontos permitidos", ajuda: "Até quanto, e em que situação." },
      { rotulo: "O que nunca pode ser oferecido", ajuda: "O limite que o assistente não deve cruzar por conta própria.", importante: true },
    ],
  },
  {
    id: "suporte",
    rotulo: "Suporte",
    descricao: "Problemas comuns e como resolver",
    caminho: "suporte/problemas-comuns.md",
    perguntasERespostas: true,
    blocos: [],
  },
  {
    id: "livre",
    rotulo: "Documento personalizado",
    descricao: "Comece do zero, sem modelo",
    caminho: "",
    blocos: [{ rotulo: "", ajuda: "" }],
  },
];

export const MODELO_POR_ID = new Map(MODELOS.map((item) => [item.id, item]));

/** Os três que o primeiro acesso oferece, na ordem em que rendem mais. */
export const PRIMEIROS_PASSOS = ["empresa", "servicos", "faq"];

/**
 * Monta o Markdown a partir dos blocos preenchidos.
 *
 * Bloco vazio não vira título órfão: um `## Onde atendemos` sem texto embaixo
 * entra no `search_vector` e faz o documento casar com uma pergunta que ele
 * não responde — o assistente acha o documento e não tem o que dizer.
 */
export function montarMarkdown({ titulo = "", blocos = [] } = {}) {
  const partes = [];
  if (titulo.trim()) partes.push(`# ${titulo.trim()}`);
  for (const bloco of blocos) {
    const rotulo = String(bloco?.rotulo || "").trim();
    const texto = String(bloco?.texto || "").trim();
    if (!texto) continue;
    if (rotulo) partes.push(`## ${rotulo}`);
    partes.push(bloco?.lista
      ? texto.split("\n").map((linha) => linha.trim()).filter(Boolean).map((linha) =>
        linha.startsWith("- ") ? linha : `- ${linha}`).join("\n")
      : texto);
  }
  return `${partes.join("\n\n")}\n`;
}

/**
 * O caminho inverso: do Markdown salvo de volta para blocos.
 *
 * Sem isto, abrir no editor simples um documento escrito em Markdown jogaria
 * o texto todo num campo só. O corte é pelos `##` — o `#` inicial é o título,
 * que já vive fora do conteúdo.
 */
export function lerBlocos(markdown = "") {
  const blocos = [];
  let atual = null;
  for (const bruta of String(markdown).split("\n")) {
    const linha = bruta.replace(/\s+$/, "");
    const titulo = /^##\s+(.*)$/.exec(linha);
    if (titulo) {
      if (atual) blocos.push(atual);
      atual = { rotulo: titulo[1].trim(), texto: "" };
      continue;
    }
    if (/^#\s+/.test(linha)) continue;
    if (!atual) {
      if (!linha.trim()) continue;
      atual = { rotulo: "", texto: "" };
    }
    atual.texto += `${atual.texto ? "\n" : ""}${linha}`;
  }
  if (atual) blocos.push(atual);
  return blocos.map((bloco) => ({ ...bloco, texto: bloco.texto.trim() })).filter((bloco) => bloco.rotulo || bloco.texto);
}

/** O título do documento, se o Markdown trouxer um `# `. */
export function lerTitulo(markdown = "") {
  const achado = /^#\s+(.*)$/m.exec(String(markdown));
  return achado ? achado[1].trim() : "";
}
