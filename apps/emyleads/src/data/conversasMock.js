/**
 * Conversas — dados de demonstração enquanto não existe rota de mensagens.
 *
 * A tela de Conversas nasceu do desenho em `docs/design/conversas/`, e nasceu
 * antes do back-end: o gateway expõe QUEM atende cada conversa, mas não expõe
 * o histórico de mensagens para a Gestão (está escrito no próprio
 * `web/gatewayProvider.js`). Sem isto a tela não teria como existir, e o
 * desenho ficaria parado num arquivo que ninguém abre.
 *
 * Então o histórico é falso e o resto é verdadeiro. Os CONTATOS vêm do
 * provider de verdade — quem chama passa `listarContatos` —, e é por isso que
 * a lista mostra os nomes que a organização realmente tem, e não seis pessoas
 * inventadas. O que se inventa aqui é só o que ainda não tem de onde vir: as
 * bolhas, a hora e o não lido.
 *
 * Quando a rota de mensagens existir, este arquivo sai inteiro e as mesmas
 * chaves (`conversas.listar`, `conversas.mensagens`, `conversas.enviar`)
 * passam a ser implementadas por quem tem os dados. A interface não muda —
 * é a mesma fronteira que `data/client.js` já descreve.
 */

import { renderizar } from "../lib/template";

/* ------------------------------------------------------------------ */
/* O roteiro                                                           */
/* ------------------------------------------------------------------ */

/**
 * A conversa longa — a que mostra tudo que a tela sabe fazer.
 *
 * Vai para o contato mais recente, seja ele quem for: os textos usam `{nome}`
 * e `{empresa}` e passam pelo `renderizar` de verdade, o mesmo das mensagens
 * padrão. Escrever "Mariana" fixo faria a demonstração mentir para quem abre
 * a tela com os próprios contatos dentro.
 */
const ROTEIRO_LONGO = [
  { tipo: "data", texto: "ONTEM" },
  {
    tipo: "mensagem",
    direcao: "entra",
    hora: "16:02",
    texto:
      "Oi! Vi a proposta de tráfego que vocês fizeram pro pessoal da Odonto Prime. Vocês trabalham com agro também?",
  },
  { tipo: "sistema", dono: "bot", texto: "Robô do CRM respondeu pela regra Primeiro contato" },
  {
    tipo: "mensagem",
    direcao: "sai",
    hora: "16:02",
    autor: "Robô do CRM",
    tom: "bot",
    lido: true,
    texto:
      "Oi, {nome}! Trabalhamos sim. Hoje atendemos revendas, cooperativas e agroindústria em Mato Grosso. Posso te mandar dois cases do setor?",
  },
  { tipo: "mensagem", direcao: "entra", hora: "16:20", texto: "Pode mandar" },
  { tipo: "sistema", dono: "ia", texto: "Agente de IA assumiu a conversa" },
  {
    tipo: "mensagem",
    direcao: "sai",
    hora: "16:21",
    autor: "Agente de IA",
    tom: "ia",
    lido: true,
    texto:
      "Mandei dois cases no seu e-mail. O de maior resultado foi uma revenda que saiu de 40 para 180 orçamentos por mês em quatro meses.",
  },
  { tipo: "data", texto: "HOJE" },
  { tipo: "mensagem", direcao: "entra", hora: "09:22", texto: "Bom dia! Consegui falar com o meu sócio ontem." },
  {
    tipo: "mensagem",
    direcao: "entra",
    hora: "09:23",
    texto:
      "A gente quer começar depois da colheita, em outubro. Dá pra segurar o valor da proposta até lá?",
  },
  { tipo: "sistema", dono: "humano", texto: "Alguém assumiu — motivo: pedido de condição comercial" },
  {
    tipo: "mensagem",
    direcao: "sai",
    hora: "09:31",
    tom: "humano",
    lido: true,
    cita: { quem: "{nome}", texto: "Dá pra segurar o valor da proposta até lá?" },
    texto:
      "Bom dia, {nome}! Dá sim. Seguro os R$ 3.200/mês até 31/10 e a gente já deixa o contrato assinado agora.",
  },
  { tipo: "naoLidas", texto: "2 mensagens não lidas" },
  { tipo: "mensagem", direcao: "entra", hora: "09:40", texto: "Perfeito" },
  { tipo: "mensagem", direcao: "entra", hora: "09:41", texto: "Pode mandar o contrato então?" },
];

/** A conversa curta — quem acabou de chegar e o robô respondeu. */
const ROTEIRO_CURTO = [
  { tipo: "data", texto: "HOJE" },
  { tipo: "mensagem", direcao: "entra", hora: "08:58", texto: "Bom dia!" },
  { tipo: "sistema", dono: "bot", texto: "Robô do CRM respondeu pela regra Primeiro contato" },
  {
    tipo: "mensagem",
    direcao: "sai",
    hora: "08:58",
    autor: "Robô do CRM",
    tom: "bot",
    lido: true,
    texto:
      "Bom dia! Sou o assistente da Major Hub. Me conta rapidinho o que você precisa que eu já chamo alguém do time.",
  },
];

/**
 * O que varia de uma linha para a outra na lista.
 *
 * Seis padrões que se repetem em roda. Sem isto toda conversa teria a mesma
 * hora e o mesmo não lido, e a lista não mostraria nada do que a tela precisa
 * mostrar: quem está esperando, quem já foi respondido, quem está no robô.
 */
const PADROES = [
  { hora: "09:41", naoLidas: 2, dono: "humano", saiu: false, fixado: true },
  { hora: "09:12", naoLidas: 0, dono: "ia", saiu: true, lido: true, fixado: false },
  { hora: "ontem", naoLidas: 1, dono: "bot", saiu: false, fixado: false },
  { hora: "ontem", naoLidas: 0, dono: "bot", saiu: false, fixado: false },
  { hora: "seg", naoLidas: 3, dono: "bot", saiu: false, fixado: false },
  { hora: "seg", naoLidas: 0, dono: "humano", saiu: true, lido: true, fixado: false },
];

/** A última linha da conversa, que é o que a lista mostra como prévia. */
function previaDoRoteiro(roteiro, contato) {
  const ultima = [...roteiro].reverse().find((m) => m.tipo === "mensagem");
  return ultima ? renderizar(ultima.texto, contato) : "";
}

/* ------------------------------------------------------------------ */
/* Mensagens padrão                                                    */
/* ------------------------------------------------------------------ */

/**
 * Modelos com variações de verdade, no formato que `sortearVariacao` espera.
 *
 * O baralho vive aqui e não no componente porque é ele que faz o sorteio não
 * repetir: quem sorteia devolve o baralho novo, e alguém precisa guardar.
 */
const MODELOS = [
  {
    id: "t1",
    categoria: "primeiro",
    titulo: "Primeiro contato",
    variaveis: "{nome} {empresa}",
    variacoes: [
      {
        id: "t1a",
        texto:
          "Oi, {nome}! Aqui é da Major Hub. Obrigado pelo contato. Me conta rapidinho o que a {empresa} está precisando agora?",
      },
      {
        id: "t1b",
        texto:
          "Olá, {nome}! Vi que você chamou a gente. Pra eu já te mandar a coisa certa: o que a {empresa} está querendo resolver?",
      },
      {
        id: "t1c",
        texto:
          "{nome}, tudo bem? Aqui é da Major Hub. Me conta em duas linhas o momento da {empresa} que eu te respondo com o caminho.",
      },
    ],
  },
  {
    id: "t2",
    categoria: "proposta",
    titulo: "Enviar proposta",
    variaveis: "{nome} {empresa}",
    variacoes: [
      {
        id: "t2a",
        texto:
          "{nome}, segue a proposta da {empresa} em PDF. Qualquer dúvida me chama por aqui. A validade é de 15 dias.",
      },
      {
        id: "t2b",
        texto:
          "{nome}, mandei a proposta da {empresa} no seu e-mail. Dá uma olhada com calma — fico à disposição pra ajustar o escopo.",
      },
    ],
  },
  {
    id: "t3",
    categoria: "follow",
    titulo: "Sem resposta há 3 dias",
    variaveis: "{nome}",
    variacoes: [
      {
        id: "t3a",
        texto:
          "Oi, {nome}! Passando só pra saber se você chegou a ver a proposta. Se preferir, marco 15 minutos pra gente conversar.",
      },
      {
        id: "t3b",
        texto:
          "{nome}, tudo certo por aí? Não quero ser chato — só me diz se faz sentido seguir ou se prefere que eu volte mais pra frente.",
      },
    ],
  },
  {
    id: "t4",
    categoria: "proposta",
    titulo: "Confirmar reunião",
    variaveis: "{nome}",
    variacoes: [
      {
        id: "t4a",
        texto:
          "{nome}, confirmando nossa conversa de amanhã às 14h. Vou te chamar por aqui mesmo. Fica bom pra você?",
      },
    ],
  },
  {
    id: "t5",
    categoria: "pos",
    titulo: "Relatório do mês",
    variaveis: "{nome} {empresa}",
    variacoes: [
      {
        id: "t5a",
        texto:
          "{nome}, subi o relatório do mês na pasta da {empresa}. Quer que eu te explique os números numa call rápida?",
      },
    ],
  },
];

export const CATEGORIAS_DE_MODELO = [
  { id: "todas", rotulo: "Todas" },
  { id: "primeiro", rotulo: "Primeiro contato" },
  { id: "proposta", rotulo: "Proposta" },
  { id: "follow", rotulo: "Follow-up" },
  { id: "pos", rotulo: "Pós-venda" },
];

/* ------------------------------------------------------------------ */
/* A interface                                                         */
/* ------------------------------------------------------------------ */

const horaDeAgora = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * As operações de conversa.
 *
 * `listarContatos` é injetado porque o provider local lê do IndexedDB e o do
 * portal lê do Supabase — a lista é a mesma, o caminho até ela é que não é.
 *
 * O que o usuário faz na sessão (mandar mensagem, trocar o dono, abrir uma
 * conversa) fica em memória e some ao recarregar. É proposital: gravar
 * conversa falsa no banco de alguém seria pior do que perdê-la.
 */
export function criarOperacoesConversas({ listarContatos }) {
  const extras = new Map();
  const donos = new Map();
  const lidas = new Set();
  const baralhos = new Map();

  const roteiroDe = (contato, indice) => {
    const base = indice === 0 ? ROTEIRO_LONGO : ROTEIRO_CURTO;
    return base.map((m) => ({
      ...m,
      texto: renderizar(m.texto, contato),
      ...(m.cita ? { cita: { quem: renderizar(m.cita.quem, contato), texto: m.cita.texto } } : {}),
    }));
  };

  const listar = async () => {
    const contatos = await listarContatos();
    const ordenados = [...contatos].sort((a, b) => (b.ultimaEm || 0) - (a.ultimaEm || 0));
    return ordenados.map((contato, i) => {
      const padrao = PADROES[i % PADROES.length];
      const acrescimos = extras.get(contato.id) || [];
      const ultima = [...acrescimos].reverse().find((m) => m.tipo === "mensagem");
      return {
        id: contato.id,
        contactId: contato.id,
        nome: contato.nome || contato.telefone || "Sem nome",
        empresa: contato.empresa || "",
        cargo: contato.cargo || "",
        telefone: contato.telefone || "",
        dono: donos.get(contato.id) || padrao.dono,
        hora: ultima ? ultima.hora : padrao.hora,
        naoLidas: lidas.has(contato.id) ? 0 : padrao.naoLidas,
        fixado: padrao.fixado,
        saiu: ultima ? true : padrao.saiu === true,
        lido: ultima ? ultima.lido === true : padrao.lido === true,
        previa: ultima ? ultima.texto : previaDoRoteiro(roteiroDe(contato, i), contato),
      };
    });
  };

  const posicaoDe = async (id) => {
    const contatos = await listarContatos();
    const ordenados = [...contatos].sort((a, b) => (b.ultimaEm || 0) - (a.ultimaEm || 0));
    const indice = ordenados.findIndex((c) => c.id === id);
    return { contato: ordenados[indice] || null, indice };
  };

  return {
    "conversas.listar": listar,

    "conversas.mensagens": async ({ id }) => {
      const { contato, indice } = await posicaoDe(id);
      if (!contato) return [];
      lidas.add(id);
      return roteiroDe(contato, indice).concat(extras.get(id) || []);
    },

    // Mock: a mensagem entra na tela e não sai do navegador. Quando existir a
    // rota de envio, é aqui que ela entra — e o resto da tela não muda.
    "conversas.enviar": async ({ id, texto }) => {
      const limpo = String(texto || "").trim();
      if (!limpo) return null;
      const mensagem = {
        tipo: "mensagem",
        direcao: "sai",
        hora: horaDeAgora(),
        tom: "humano",
        lido: false,
        texto: limpo,
      };
      extras.set(id, (extras.get(id) || []).concat([mensagem]));
      return mensagem;
    },

    /**
     * Trocar o dono escreve um evento na conversa, com hora e motivo.
     *
     * O evento existe porque foi a confusão entre robô e IA que já fez um
     * contato receber duas respostas para a mesma mensagem: sem registro, a
     * próxima pessoa a abrir a conversa não tem como saber o que mudou.
     */
    "conversas.trocarDono": async ({ id, dono }) => {
      const textos = {
        bot: "Devolvido ao Robô do CRM — as regras dos chatbots voltam a responder",
        ia: "Passado para o Agente de IA — ele responde esta conversa",
        humano: "Assumido por um atendente — nenhum automatismo responde até devolver",
      };
      donos.set(id, dono);
      extras.set(
        id,
        (extras.get(id) || []).concat([{ tipo: "sistema", dono, texto: textos[dono] || "" }])
      );
      return { id, dono };
    },

    "conversas.modelos": async () =>
      MODELOS.map((m) => ({ ...m, baralho: baralhos.get(m.id) || [] })),

    /** Guarda o baralho que `sortearVariacao` devolveu, para não repetir. */
    "conversas.guardarBaralho": async ({ id, baralho }) => {
      baralhos.set(id, baralho || []);
      return { id, baralho };
    },
  };
}
