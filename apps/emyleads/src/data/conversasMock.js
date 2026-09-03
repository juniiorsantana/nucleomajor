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
import { MODELOS } from "./modelosPadrao";

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

/**
 * O grupo da bancada.
 *
 * O identificador tem a forma do de verdade — dezoito dígitos, sem servidor —
 * porque é ele que o portal usa como chave, e um "grupo-1" esconderia que a
 * chave de grupo e a de pessoa moram no mesmo campo.
 */
const GRUPO = {
  id: "120363001122334455",
  nome: "Comercial · Núcleo Major",
  previa: "Marina: fechamos o mês com 12 propostas em aberto",
  roteiro: [
    { tipo: "data", texto: "Ontem" },
    { tipo: "mensagem", direcao: "entra", hora: "16:02", texto: "Alguém falou com a clínica?" },
    { tipo: "mensagem", direcao: "sai", hora: "16:10", texto: "Falei agora, mando o resumo" },
    {
      tipo: "mensagem",
      direcao: "entra",
      hora: "16:31",
      texto: "Marina: fechamos o mês com 12 propostas em aberto",
    },
  ],
};

/** A última linha da conversa, que é o que a lista mostra como prévia. */
function previaDoRoteiro(roteiro, contato) {
  const ultima = [...roteiro].reverse().find((m) => m.tipo === "mensagem");
  return ultima ? renderizar(ultima.texto, contato) : "";
}

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
  const atendentes = new Map();
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
    const linhas = ordenados.map((contato, i) => {
      const padrao = PADROES[i % PADROES.length];
      const acrescimos = extras.get(contato.id) || [];
      const ultima = [...acrescimos].reverse().find((m) => m.tipo === "mensagem");
      return {
        id: contato.id,
        contactId: contato.id,
        grupo: false,
        nome: contato.nome || contato.telefone || "Sem nome",
        empresa: contato.empresa || "",
        cargo: contato.cargo || "",
        telefone: contato.telefone || "",
        dono: donos.get(contato.id) || padrao.dono,
        atendenteId: atendentes.get(contato.id)?.id || null,
        atendenteNome: atendentes.get(contato.id)?.nome || "",
        hora: ultima ? ultima.hora : padrao.hora,
        naoLidas: lidas.has(contato.id) ? 0 : padrao.naoLidas,
        fixado: padrao.fixado,
        saiu: ultima ? true : padrao.saiu === true,
        lido: ultima ? ultima.lido === true : padrao.lido === true,
        previa: ultima ? ultima.texto : previaDoRoteiro(roteiroDe(contato, i), contato),
      };
    });

    // Um grupo na bancada, porque grupo é 56% da caixa de entrada de verdade e
    // desenhar a lista sem um deixaria a linha do grupo sem prova visual.
    // Grupo não tem telefone, não tem ficha e não tem atendente.
    return linhas.concat([
      {
        id: GRUPO.id,
        contactId: null,
        grupo: true,
        nome: GRUPO.nome,
        empresa: "",
        cargo: "",
        telefone: "",
        dono: donos.get(GRUPO.id) || "bot",
        atendenteId: null,
        atendenteNome: "",
        hora: "ontem",
        naoLidas: lidas.has(GRUPO.id) ? 0 : 4,
        fixado: false,
        saiu: false,
        lido: false,
        previa: GRUPO.previa,
      },
    ]);
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
      lidas.add(id);
      if (id === GRUPO.id) return GRUPO.roteiro.concat(extras.get(id) || []);
      const { contato, indice } = await posicaoDe(id);
      if (!contato) return [];
      return roteiroDe(contato, indice).concat(extras.get(id) || []);
    },

    /**
     * Mock: a mensagem entra na tela e não sai do navegador.
     *
     * Devolve `comandoId: null`, e é isso que diz à tela que aqui não há fila
     * para acompanhar — no portal, o envio volta pendente e só o desfecho diz
     * se saiu. A bancada executa na hora de propósito: ela existe para
     * desenhar a tela, não para simular a latência da VPS.
     */
    "conversas.enviar": async ({ id, texto }) => {
      const limpo = String(texto || "").trim();
      if (!limpo) return null;
      extras.set(
        id,
        (extras.get(id) || []).concat([
          {
            tipo: "mensagem",
            direcao: "sai",
            hora: horaDeAgora(),
            tom: "humano",
            lido: false,
            texto: limpo,
          },
        ])
      );
      return { comandoId: null, situacao: "completed" };
    },

    /**
     * Trocar o dono escreve um evento na conversa, com hora e motivo.
     *
     * O evento existe porque foi a confusão entre robô e IA que já fez um
     * contato receber duas respostas para a mesma mensagem: sem registro, a
     * próxima pessoa a abrir a conversa não tem como saber o que mudou.
     */
    "conversas.trocarDono": async ({ id, dono, atendenteId = null }) => {
      const textos = {
        bot: "Devolvido ao Robô do CRM — as regras dos chatbots voltam a responder",
        ia: "Passado para o Agente de IA — ele responde esta conversa",
        humano: "Assumido por um atendente — nenhum automatismo responde até devolver",
      };
      donos.set(id, dono);
      // A identidade só vale enquanto o dono é humano — a mesma regra do
      // árbitro na VPS. Guardá-la depois faria a faixa dizer que alguém atende
      // uma conversa que voltou para a IA.
      if (dono === "humano" && atendenteId) {
        atendentes.set(id, { id: atendenteId, nome: "Você" });
      } else {
        atendentes.delete(id);
      }
      extras.set(
        id,
        (extras.get(id) || []).concat([{ tipo: "sistema", dono, texto: textos[dono] || "" }])
      );
      return { comandoId: null, situacao: "completed" };
    },

    /** Na bancada nada fica pendente: o comando já terminou quando foi pedido. */
    "conversas.desfecho": async () => ({ situacao: "completed", motivo: "" }),

    "conversas.modelos": async () =>
      MODELOS.map((m) => ({ ...m, baralho: baralhos.get(m.id) || [] })),

    /** Guarda o baralho que `sortearVariacao` devolveu, para não repetir. */
    "conversas.guardarBaralho": async ({ id, baralho }) => {
      baralhos.set(id, baralho || []);
      return { id, baralho };
    },
  };
}
