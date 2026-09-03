import { MODELOS } from "../data/modelosPadrao.js";
import { fmtDiaDaConversa, fmtHoraDaLista } from "../lib/formato.js";
import { variantesBR } from "../lib/phone.js";
import { WORKSPACE_KEY } from "./storage.js";

/**
 * Conversas do WhatsApp, lidas do espelho que a VPS publica.
 *
 * A VPS nunca abre porta: o runtime empurra conversas e mensagens para o
 * Supabase pela RPC `nucleo_conversation_sync` (migration 20260902120000), e o
 * navegador lê as duas tabelas com RLS por organização. É o mesmo desenho do
 * `connection_runtime_status` — o runtime escreve por RPC, o portal só lê.
 *
 * Este provider substitui `data/conversasMock.js` no portal. O mock continua
 * servindo a bancada de desenvolvimento, que roda sem Supabase.
 *
 * Escrever — mandar mensagem, atribuir quem atende — também não abre porta na
 * VPS. Vai pela fila de comandos que já existia para a verificação de operador
 * e para a fila humana (`connection_runtime_commands`): o portal enfileira, o
 * runtime reivindica com a credencial de robô da conexão e executa em loopback.
 *
 * Duas consequências que a tela precisa respeitar, e que não são defeito:
 *
 * 1. Enfileirar NÃO é enviar. O comando volta como `pending`, e quem sabe se a
 *    mensagem saiu é o desfecho, alguns segundos depois. Por isso existe
 *    `conversas.desfecho`.
 * 2. A mensagem enviada aparece na conversa quando a sincronia a trouxer de
 *    volta do WhatsApp — a mesma volta que qualquer mensagem dá. Nada é escrito
 *    direto na tabela de mensagens daqui: o espelho tem uma fonte só, e é o
 *    aparelho.
 */

const CAMPOS_CONVERSA =
  "connection_id,contact_phone,chat_kind,contact_name,last_message_preview," +
  "last_message_at,last_message_from_me,unread_count,owner,attendant_id,attendant_name";

const CAMPOS_MENSAGEM =
  "message_id,content,sent_at,is_from_me,media_type,media_filename";

/**
 * O que a bolha mostra quando a mensagem é mídia.
 *
 * Os bytes ficam na VPS — daqui não dá para abrir o anexo, e dizer o tipo é
 * mais honesto que uma bolha vazia. Legenda de imagem chega como conteúdo
 * normal e ganha o rótulo junto.
 */
const ROTULO_DE_MIDIA = {
  image: "📎 Imagem",
  video: "📎 Vídeo",
  audio: "🎤 Áudio",
  ptt: "🎤 Áudio",
  document: "📎 Documento",
  sticker: "📎 Figurinha",
};

function erroConversas(mensagem, codigo) {
  const erro = new Error(mensagem);
  erro.codigo = codigo;
  return erro;
}

/**
 * As recusas da RPC, em português.
 *
 * A RPC levanta em inglês de propósito — é a língua do banco, e a mensagem
 * também vai para log e para o Postgres. Traduzir aqui é o que impede um
 * atendente de ler "conversation is not mirrored for this connection" no meio
 * de um atendimento; o texto que sobra sem tradução é devolvido como veio, que
 * é melhor que engolir uma falha desconhecida.
 */
const RECUSAS = [
  [
    "organization membership required",
    "Você não faz parte desta empresa.",
  ],
  [
    "conversation is not mirrored",
    "Esta conversa ainda não chegou da VPS. Aguarde a sincronia e tente de novo.",
  ],
  [
    "message text is invalid",
    "A mensagem está vazia ou passa de 4000 caracteres.",
  ],
  [
    "attendant is not an active member",
    "Quem você escolheu não está mais ativo nesta empresa.",
  ],
  ["conversation owner is invalid", "Quem atende só pode ser o robô, a IA ou alguém da equipe."],
  ["conversation command is invalid", "Comando desconhecido para esta conversa."],
  ["conversation command not found", "Este envio não existe mais."],
];

function traduzir(mensagem) {
  const cru = String(mensagem || "");
  const achado = RECUSAS.find(([trecho]) => cru.includes(trecho));
  return achado ? achado[1] : cru;
}

/**
 * O id de uma conversa na tela: conexão e o identificador do chat.
 *
 * O identificador é o telefone quando é gente e o id do grupo quando é grupo —
 * o mesmo campo, e é `grupo` que diz como lê-lo. O traço sobrevive porque grupo
 * antigo (`<telefone>-<carimbo>`) o usa; tirá-lo aqui faria o id não casar com
 * a linha do banco, e a conversa abriria vazia.
 */
const idDaConversa = (connectionId, chat) => `${connectionId}:${chat}`;

function separarId(id) {
  const cru = String(id || "");
  const corte = cru.indexOf(":");
  if (corte < 1) return null;
  const connectionId = cru.slice(0, corte);
  const chat = cru.slice(corte + 1).replace(/[^0-9-]/g, "");
  return chat ? { connectionId, chat } : null;
}

/**
 * Telefone → contato do CRM, por qualquer das formas que o número pode ter.
 *
 * O nono dígito é a maior fonte de falso negativo num CRM de WhatsApp
 * brasileiro, e `variantesBR` existe exatamente para isso: o contato entra no
 * índice por todas as suas formas, e a conversa acha por qualquer uma.
 */
function indicePorTelefone(contatos) {
  const indice = new Map();
  for (const contato of contatos || []) {
    for (const forma of variantesBR(contato.phone)) {
      if (!indice.has(forma)) indice.set(forma, contato);
    }
  }
  return indice;
}

const acharContato = (indice, telefone) => {
  for (const forma of variantesBR(telefone)) {
    const achado = indice.get(forma);
    if (achado) return achado;
  }
  return null;
};

function textoDaMensagem(linha) {
  const conteudo = String(linha.content || "").trim();
  const rotulo = ROTULO_DE_MIDIA[linha.media_type] || (linha.media_type ? "📎 Anexo" : "");
  if (conteudo && rotulo) return `${rotulo}\n${conteudo}`;
  return conteudo || rotulo;
}

export function criarOperacoesConversasWeb({ supabase, area }) {
  // O baralho das variações de mensagem padrão. Vive em memória porque é
  // preferência de sessão, não dado da organização: sortear diferente depois de
  // recarregar a página não incomoda ninguém.
  const baralhos = new Map();

  const organizacao = async () => {
    const salvo = (await area.get(WORKSPACE_KEY))[WORKSPACE_KEY];
    if (!salvo) throw erroConversas("Entre em uma empresa para continuar.", "workspace-ausente");
    return salvo;
  };

  const executar = async (consulta, codigo) => {
    const { data, error } = await consulta;
    if (error) throw erroConversas(error.message, codigo);
    return data || [];
  };

  const listar = async () => {
    const organizationId = await organizacao();
    // As duas consultas em paralelo: a lista não depende dos contatos para
    // existir, só para ganhar nome de CRM e ficha.
    const [conversas, contatos] = await Promise.all([
      executar(
        supabase
          .from("whatsapp_conversations")
          .select(CAMPOS_CONVERSA)
          .eq("organization_id", organizationId)
          .order("last_message_at", { ascending: false, nullsFirst: false }),
        "conversas-lista-falhou"
      ),
      executar(
        supabase
          .from("contacts")
          .select("id,name,phone,company,job_title")
          .eq("organization_id", organizationId)
          .is("deleted_at", null),
        "conversas-contatos-falharam"
      ),
    ]);

    const indice = indicePorTelefone(contatos);
    return conversas.map((linha) => {
      const grupo = linha.chat_kind === "grupo";
      // Grupo não procura contato: o identificador dele não é telefone de
      // ninguém, e deixá-lo cair no índice acharia um contato por coincidência
      // de dígitos e penduraria a ficha da pessoa errada ao lado da conversa.
      const contato = grupo ? null : acharContato(indice, linha.contact_phone);
      return {
        id: idDaConversa(linha.connection_id, linha.contact_phone),
        grupo,
        // Sem contato no CRM a conversa continua aparecendo: quem chegou agora
        // ainda não foi cadastrado, e é justamente essa a pessoa que não pode
        // sumir da caixa de entrada.
        contactId: contato?.id || null,
        nome: contato?.name || linha.contact_name || linha.contact_phone,
        empresa: contato?.company || "",
        cargo: contato?.job_title || "",
        // O grupo não tem telefone para mostrar. Formatar o id dele como se
        // fosse um daria à tela um número de dezoito dígitos com DDD inventado.
        telefone: grupo ? "" : linha.contact_phone,
        dono: linha.owner,
        atendenteId: linha.attendant_id || null,
        atendenteNome: linha.attendant_name || "",
        hora: fmtHoraDaLista(linha.last_message_at),
        naoLidas: linha.unread_count || 0,
        previa: linha.last_message_preview || "",
        saiu: linha.last_message_from_me === true,
        // Confirmação de leitura ainda não vem do bridge; um tique é o que
        // sabemos, e dois seriam invenção.
        lido: false,
        fixado: false,
      };
    });
  };

  const mensagens = async ({ id }) => {
    const alvo = separarId(id);
    if (!alvo) return [];
    const organizationId = await organizacao();
    const linhas = await executar(
      supabase
        .from("whatsapp_messages")
        .select(CAMPOS_MENSAGEM)
        .eq("organization_id", organizationId)
        .eq("connection_id", alvo.connectionId)
        .eq("contact_phone", alvo.chat)
        // Da mais nova para a mais velha, e a lista é invertida depois.
        //
        // O teto e a ordem são uma decisão só, e ler a ordem sem o teto é o
        // que estragou esta consulta: com `ascending: true`, o `limit` corta
        // pelo COMEÇO, e a conversa passada de 300 mensagens ficava presa nas
        // 300 mais antigas. Nada errava — a consulta respondia depressa e
        // sempre a mesma coisa. A lateral acompanhava, porque a prévia vem da
        // outra tabela, e só a conversa aberta ficava no passado.
        //
        // Descendente também é a ordem do índice `whatsapp_messages_thread_idx`.
        .order("sent_at", { ascending: false })
        // Teto por conversa: a tela rola até o fim, e trazer anos de histórico
        // de uma vez travaria o navegador em quem conversa todo dia.
        .limit(300),
      "conversas-mensagens-falharam"
    );

    // O divisor de data não vem do banco — é derivado, e por isso nasce aqui e
    // não numa coluna que precisaria ser mantida em dia.
    const saida = [];
    let diaAnterior = null;
    // A tela lê de cima para baixo; o banco entregou ao contrário.
    for (const linha of [...linhas].reverse()) {
      const dia = new Date(linha.sent_at).toDateString();
      if (dia !== diaAnterior) {
        saida.push({ tipo: "data", texto: fmtDiaDaConversa(linha.sent_at) });
        diaAnterior = dia;
      }
      saida.push({
        tipo: "mensagem",
        direcao: linha.is_from_me ? "sai" : "entra",
        hora: new Date(linha.sent_at).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        texto: textoDaMensagem(linha),
        // Quem escreveu do nosso lado — robô, IA ou pessoa — o bridge não
        // registra. Sem `tom`, a bolha sai sem rótulo de autor, que é a
        // verdade disponível.
        lido: false,
      });
    }
    return saida;
  };

  /**
   * Enfileira um comando e devolve o identificador dele.
   *
   * `clientId` é gerado por chamada e é o que torna o reenvio seguro: a RPC
   * chaveia a idempotência por ele, e não pelo texto. Sem isso, a segunda
   * mensagem "ok" da mesma conversa seria engolida como repetição da primeira —
   * e "ok" é o que mais se digita duas vezes num atendimento.
   */
  const enfileirar = async (id, comando, carga) => {
    const alvo = separarId(id);
    if (!alvo) throw erroConversas("Conversa inválida.", "conversas-id-invalido");
    const organizationId = await organizacao();
    const { data, error } = await supabase.rpc("nucleo_conversation_command_enqueue", {
      target_organization: organizationId,
      target_connection: alvo.connectionId,
      target_chat: alvo.chat,
      requested_command: comando,
      command_payload: { ...carga, clientId: crypto.randomUUID() },
    });
    if (error) throw erroConversas(traduzir(error.message), "conversas-comando-falhou");
    return { comandoId: data?.commandId || null, situacao: data?.status || "pending" };
  };

  return {
    "conversas.listar": listar,
    "conversas.mensagens": mensagens,

    "conversas.modelos": async () =>
      MODELOS.map((modelo) => ({ ...modelo, baralho: baralhos.get(modelo.id) || [] })),

    "conversas.guardarBaralho": async ({ id, baralho }) => {
      baralhos.set(id, baralho || []);
      return { id, baralho };
    },

    /**
     * Manda a mensagem para a fila do runtime.
     *
     * Não devolve bolha. A mensagem entra na conversa quando a sincronia a
     * trouxer de volta do aparelho, como qualquer outra — inventar a bolha aqui
     * faria a tela afirmar que saiu antes de alguém ter enviado nada. Quem
     * mostra "enviando" é a tela, a partir do comando que volta daqui.
     */
    "conversas.enviar": async ({ id, texto }) =>
      enfileirar(id, "conversation_send", { text: String(texto || "").trim() }),

    /**
     * Atribui a conversa: ao robô, à IA, ou a uma pessoa da equipe.
     *
     * O nome de quem assume é resolvido no banco, a partir do perfil — daqui
     * vai só o id. Mandar o nome junto deixaria a faixa dizer "Atendente ·
     * Lucas" numa conversa que outra pessoa pegou.
     */
    "conversas.trocarDono": async ({ id, dono, atendenteId = null }) =>
      enfileirar(id, "conversation_owner", {
        owner: dono,
        attendantId: dono === "humano" && atendenteId ? String(atendenteId) : "",
      }),

    /** O desfecho de um comando, para a tela parar de dizer "enviando". */
    "conversas.desfecho": async ({ comandoId }) => {
      if (!comandoId) return null;
      const organizationId = await organizacao();
      const { data, error } = await supabase.rpc("nucleo_conversation_command_status", {
        target_organization: organizationId,
        target_command: comandoId,
      });
      if (error) throw erroConversas(traduzir(error.message), "conversas-desfecho-falhou");
      return {
        situacao: data?.status || "pending",
        motivo: data?.errorCode || "",
      };
    },
  };
}
