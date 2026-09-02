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
 * Escrever — mandar mensagem, trocar o dono — não passa por aqui: vai pela fila
 * de comandos do runtime, e é a Leva 2. Enquanto não existe, as duas operações
 * falham com um código que a tela sabe traduzir, em vez de fingir que
 * funcionaram.
 */

const CAMPOS_CONVERSA =
  "connection_id,contact_phone,contact_name,last_message_preview," +
  "last_message_at,last_message_from_me,unread_count,owner";

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

/** O id de uma conversa na tela: conexão e telefone, que juntos a identificam. */
const idDaConversa = (connectionId, telefone) => `${connectionId}:${telefone}`;

function separarId(id) {
  const cru = String(id || "");
  const corte = cru.indexOf(":");
  if (corte < 1) return null;
  const connectionId = cru.slice(0, corte);
  const telefone = cru.slice(corte + 1).replace(/\D/g, "");
  return telefone ? { connectionId, telefone } : null;
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
      const contato = acharContato(indice, linha.contact_phone);
      return {
        id: idDaConversa(linha.connection_id, linha.contact_phone),
        // Sem contato no CRM a conversa continua aparecendo: quem chegou agora
        // ainda não foi cadastrado, e é justamente essa a pessoa que não pode
        // sumir da caixa de entrada.
        contactId: contato?.id || null,
        nome: contato?.name || linha.contact_name || linha.contact_phone,
        empresa: contato?.company || "",
        cargo: contato?.job_title || "",
        telefone: linha.contact_phone,
        dono: linha.owner,
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
        .eq("contact_phone", alvo.telefone)
        .order("sent_at", { ascending: true })
        // Teto por conversa: a tela rola até o fim, e trazer anos de histórico
        // de uma vez travaria o navegador em quem conversa todo dia.
        .limit(300),
      "conversas-mensagens-falharam"
    );

    // O divisor de data não vem do banco — é derivado, e por isso nasce aqui e
    // não numa coluna que precisaria ser mantida em dia.
    const saida = [];
    let diaAnterior = null;
    for (const linha of linhas) {
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

  const aindaNaoEscreve = (acao) => async () => {
    throw erroConversas(
      `${acao} ainda não está ligado nesta tela — a VPS não recebe comando do portal por enquanto.`,
      "conversas-escrita-indisponivel"
    );
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

    "conversas.enviar": aindaNaoEscreve("Enviar mensagem"),
    "conversas.trocarDono": aindaNaoEscreve("Trocar quem atende"),
  };
}
