import { MODELOS } from "../data/modelosPadrao.js";
import { fmtDiaDaConversa, fmtHoraDaLista } from "../lib/formato.js";
import { normalizePhone, variantesBR } from "../lib/phone.js";
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
  "connection_id,contact_phone,chat_kind,contact_name,contact_photo_url,last_message_preview," +
  "last_message_at,last_message_from_me,unread_count,owner,attendant_id,attendant_name";

const CAMPOS_MENSAGEM =
  "message_id,content,sent_at,is_from_me,media_type,media_filename," +
  "media_path,media_mime,author_kind,author_name";

/**
 * O tom da bolha para cada tipo de autor.
 *
 * `Bolha` já sabe pintar `bot`, `ia` e `humano` desde a Leva 2 — o que faltava
 * era o dado, que chegou em 13/09/2026. `contato` não entra aqui de propósito:
 * a mensagem de quem está do outro lado não leva rótulo de autor, porque o
 * nome dele já está no topo da conversa e repeti-lo em toda bolha é ruído.
 *
 * Um tipo desconhecido (runtime mais novo que o portal) cai fora do mapa e a
 * bolha sai sem nome — a mesma coisa que acontece com a mensagem digitada no
 * celular, que é o desfecho certo para "não sei quem escreveu".
 */
const TOM_DO_AUTOR = { bot: "bot", ia: "ia", humano: "humano" };

const BUCKET_AVATARES = "contact-avatars";
const VALIDADE_AVATAR_SEGUNDOS = 60 * 60;

/**
 * O bucket privado da mídia das conversas (desde 16/09/2026).
 *
 * O runtime da VPS sobe para lá o áudio e a imagem que chegam, e o portal sobe
 * o que a equipe manda. A tela nunca lê o objeto direto: pede uma URL assinada
 * de uma hora, que é o que a policy do bucket permite a um membro da
 * organização — e a URL vale só pelo tempo da tela aberta.
 */
const BUCKET_MIDIA = "whatsapp-media";
const VALIDADE_MIDIA_SEGUNDOS = 60 * 60;

/**
 * O que a bolha mostra quando a mensagem é mídia SEM arquivo.
 *
 * É o caso de tudo que chegou antes de 16/09/2026, do que o runtime ainda não
 * subiu (o arquivo chega um ciclo depois da mensagem) e do que continua fora
 * do escopo — documento, vídeo, figurinha. Dizer o tipo é mais honesto que uma
 * bolha vazia. Legenda chega como conteúdo normal e ganha o rótulo junto.
 */
const ROTULO_DE_MIDIA = {
  image: "📎 Imagem",
  video: "📎 Vídeo",
  audio: "🎤 Áudio",
  ptt: "🎤 Áudio",
  document: "📎 Documento",
  sticker: "📎 Figurinha",
};

/** Como a bolha trata cada tipo de arquivo que tem URL. */
const TIPO_DE_MIDIA = { image: "imagem", audio: "audio", ptt: "audio" };

/**
 * A extensão com que o anexo sobe para o bucket, pelo tipo que o navegador
 * declarou. O runtime lê a extensão para dar o arquivo ao Bridge, e o áudio
 * gravado aqui (WebM/Opus no Chrome, Ogg/Opus no Firefox) é convertido lá para
 * o formato de mensagem de voz do WhatsApp.
 */
const EXTENSAO_POR_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
};

/** `audio/webm;codecs=opus` → `audio/webm`. O bucket e a RPC leem só o tipo. */
const mimeLimpo = (mime) =>
  String(mime || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

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
  ["phone number is invalid", "Esse número não parece um telefone. Confira o DDD e o DDI."],
  [
    "connection is not available",
    "O WhatsApp desta empresa não está disponível. Confira em Conexões.",
  ],
  [
    "more than one connection",
    "Esta empresa tem mais de um WhatsApp conectado. Abra uma conversa existente" +
      " do número que você quer usar antes de começar outra.",
  ],
  // O teto existe para a caixa de entrada não virar disparador. O texto diz o
  // que fazer — esperar —, e não só que deu errado.
  [
    "too many conversations started",
    "Muitas conversas novas na última hora. Espere um pouco antes de começar outra.",
  ],
  // O anexo. A RPC confere que o arquivo existe no bucket e foi enviado por
  // quem está mandando; "não achei" quase sempre é um upload que falhou no
  // meio, e a saída é anexar de novo.
  ["media path is invalid", "O arquivo não chegou ao servidor. Anexe de novo."],
  // O disparo manual de um fluxo (20260926120000).
  ["contact unavailable", "Salve este contato antes de iniciar um fluxo para ele."],
  ["flow unavailable", "Esse fluxo não está mais ativo ou deixou de ser iniciado pela equipe."],
  [
    "flow trigger unavailable",
    "O fluxo não pôde começar: confira se o plano tem chatbots e se o WhatsApp está conectado.",
  ],
  [
    "media type is not allowed",
    "Esse tipo de arquivo não pode ser enviado. Use JPG, PNG, WebP ou o áudio gravado aqui.",
  ],
];

function traduzir(mensagem) {
  const cru = String(mensagem || "");
  const achado = RECUSAS.find(([trecho]) => cru.includes(trecho));
  return achado ? achado[1] : cru;
}

/**
 * Converte caminhos privados de um bucket em URLs temporárias para a tela.
 *
 * Uma falha do Storage não pode derrubar a caixa de entrada: avatar e arquivo
 * de mídia são enriquecimento visual, e o que fica sem URL cai no fallback
 * completo — as iniciais para o avatar, o rótulo "🎤 Áudio" para a bolha.
 */
async function assinarCaminhos(supabase, bucket, caminhos, validade) {
  const unicos = [...new Set(caminhos.map((c) => String(c || "").trim()).filter(Boolean))];
  if (unicos.length === 0) return new Map();

  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(unicos, validade);
    if (error) return new Map();

    return new Map(
      (data || [])
        .filter((arquivo) => arquivo?.path && arquivo?.signedUrl && !arquivo?.error)
        .map((arquivo) => [arquivo.path, arquivo.signedUrl])
    );
  } catch {
    return new Map();
  }
}

const assinarAvatares = (supabase, contatos) =>
  assinarCaminhos(
    supabase,
    BUCKET_AVATARES,
    contatos.map((contato) => contato.avatar_path),
    VALIDADE_AVATAR_SEGUNDOS
  );

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

/**
 * A assinatura que o runtime põe na frente do que sai pelo portal e pela IA:
 * `*Nome:*` e uma quebra de linha. Mesmo formato de `assinatura.py` na VPS.
 */
const ASSINATURA_RE = /^\*([^*\r\n]{1,120}):\*(?:\r?\n|$)/;

/**
 * O texto sem a assinatura, quando a bolha já diz quem escreveu.
 *
 * Só para saída da conta com autor conhecido: é o runtime que assina, e a
 * etiqueta de autor da bolha é a mesma informação. Deixar as duas seria dizer
 * "Bia" duas vezes — e quebrava a conciliação da bolha provisória, que casa
 * pelo texto digitado, sem assinatura. O que o contato escreve fica como
 * veio, mesmo que se pareça com uma assinatura.
 */
function semAssinatura(linha) {
  const conteudo = String(linha.content || "");
  if (!linha.is_from_me || !TOM_DO_AUTOR[linha.author_kind]) return conteudo;
  return conteudo.replace(ASSINATURA_RE, "");
}

function textoDaMensagem(linha) {
  const conteudo = semAssinatura(linha).trim();
  const rotulo = ROTULO_DE_MIDIA[linha.media_type] || (linha.media_type ? "📎 Anexo" : "");
  if (conteudo && rotulo) return `${rotulo}\n${conteudo}`;
  return conteudo || rotulo;
}

/**
 * O arquivo da mensagem, quando ele existe E a tela consegue abri-lo.
 *
 * Sem URL assinada não há `midia`: a bolha volta ao rótulo, que é o
 * comportamento de antes de 16/09/2026. Tipo desconhecido com URL vira
 * "outro" — a bolha oferece o link, e não finge saber tocar.
 */
function midiaDaMensagem(linha, urls) {
  const caminho = String(linha.media_path || "").trim();
  const url = caminho ? urls.get(caminho) : null;
  if (!url) return null;
  return {
    tipo: TIPO_DE_MIDIA[linha.media_type] || "outro",
    url,
    nome: String(linha.media_filename || "").trim(),
    mime: String(linha.media_mime || "").trim(),
  };
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
    // existir, só para ganhar nome de CRM, ficha e avatar.
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
          .select("id,name,phone,company,job_title,avatar_path")
          .eq("organization_id", organizationId)
          .is("deleted_at", null),
        "conversas-contatos-falharam"
      ),
    ]);

    const indice = indicePorTelefone(contatos);
    const avatares = await assinarAvatares(supabase, contatos);
    return conversas.map((linha) => {
      const grupo = linha.chat_kind === "grupo";
      // Grupo não procura contato: o identificador dele não é telefone de
      // ninguém, e deixá-lo cair no índice acharia um contato por coincidência
      // de dígitos e penduraria a ficha da pessoa errada ao lado da conversa.
      const contato = grupo ? null : acharContato(indice, linha.contact_phone);
      const nomeEspelhado = String(linha.contact_name || "").trim();
      return {
        id: idDaConversa(linha.connection_id, linha.contact_phone),
        grupo,
        // Sem contato no CRM a conversa continua aparecendo: quem chegou agora
        // ainda não foi cadastrado, e é justamente essa a pessoa que não pode
        // sumir da caixa de entrada.
        contactId: contato?.id || null,
        nome: grupo
          ? nomeEspelhado || "Grupo sem nome"
          : contato?.name || nomeEspelhado || linha.contact_phone,
        empresa: contato?.company || "",
        cargo: contato?.job_title || "",
        fotoUrl: avatares.get(contato?.avatar_path) || linha.contact_photo_url || null,
        // O grupo não tem telefone para mostrar. Formatar o id dele como se
        // fosse um daria à tela um número de dezoito dígitos com DDD inventado.
        telefone: grupo ? "" : linha.contact_phone,
        dono: linha.owner,
        atendenteId: linha.attendant_id || null,
        atendenteNome: linha.attendant_name || "",
        hora: fmtHoraDaLista(linha.last_message_at),
        ultimaMensagemEm: linha.last_message_at ? new Date(linha.last_message_at).getTime() : 0,
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

    // As URLs dos arquivos, assinadas de uma vez para a conversa inteira: uma
    // chamada, e não uma por bolha.
    const urls = await assinarCaminhos(
      supabase,
      BUCKET_MIDIA,
      linhas.map((linha) => linha.media_path),
      VALIDADE_MIDIA_SEGUNDOS
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
      const midia = midiaDaMensagem(linha, urls);
      saida.push({
        tipo: "mensagem",
        messageId: linha.message_id,
        direcao: linha.is_from_me ? "sai" : "entra",
        enviadaEm: new Date(linha.sent_at).getTime(),
        hora: new Date(linha.sent_at).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        // Com arquivo, o texto é só a legenda: o rótulo "🎤 Áudio" em cima de
        // um player seria dizer duas vezes a mesma coisa.
        texto: midia ? semAssinatura(linha).trim() : textoDaMensagem(linha),
        midia,
        // Quem escreveu do nosso lado. O Bridge não registra isso — para ele
        // toda saída da conta é `is_from_me = 1` — então quem responde é o
        // runtime, que anota o que ele próprio manda e cruza na sincronia.
        //
        // Sem autoria a bolha sai sem rótulo, e isso É a resposta: pela regra
        // do dono, mensagem sem registro foi digitada no aplicativo do celular,
        // que envia direto do aparelho. Não existe rótulo "celular" porque
        // seria palpite.
        //
        // O nome só sai acompanhado do tipo. Um nome sem tipo é meio dado —
        // acontece quando o runtime é mais novo que o portal e manda um tipo
        // que este código ainda não conhece — e meio dado numa etiqueta de
        // autoria é pior que nenhum: a bolha afirmaria quem escreveu sem saber
        // em que qualidade.
        tom: TOM_DO_AUTOR[linha.author_kind] || null,
        autor: TOM_DO_AUTOR[linha.author_kind] ? linha.author_name || null : null,
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
  const enfileirarEm = async ({ connectionId, chat }, comando, carga) => {
    const organizationId = await organizacao();
    const { data, error } = await supabase.rpc("nucleo_conversation_command_enqueue", {
      target_organization: organizationId,
      target_connection: connectionId,
      target_chat: chat,
      requested_command: comando,
      // `clientId` vem de quem chama quando o clique tem identidade própria — e
      // o reenvio de uma bolha que falhou é o mesmo clique, tentado de novo. A
      // RPC só ressuscita comando `failed` ou `expired`; reaproveitar a chave
      // faz um comando que na verdade saiu ser devolvido como está, em vez de
      // virar uma segunda mensagem igual no WhatsApp de quem recebe.
      command_payload: { clientId: crypto.randomUUID(), ...carga },
    });
    if (error) throw erroConversas(traduzir(error.message), "conversas-comando-falhou");
    return { comandoId: data?.commandId || null, situacao: data?.status || "pending" };
  };

  const enfileirar = async (id, comando, carga) => {
    const alvo = separarId(id);
    if (!alvo) throw erroConversas("Conversa inválida.", "conversas-id-invalido");
    return enfileirarEm(alvo, comando, carga);
  };

  /**
   * O telefone como o WhatsApp o endereça: só dígitos, com DDI.
   *
   * `normalizePhone` é quem põe o 55 quando o número veio sem DDI. Tirar só a
   * pontuação deixaria "11987654321" atravessar a fila, o Bridge procuraria
   * "+11987654321", e a resposta seria "não tem WhatsApp" sobre um número que
   * tem — a pior forma de errar nesta tela.
   *
   * Sem DDI reconhecível sobram os dígitos, e quem recusa é a RPC, com uma
   * mensagem traduzida. Inventar um país aqui seria pior que recusar.
   */
  const telefoneDoWhatsApp = (bruto) =>
    normalizePhone(bruto) || String(bruto || "").replace(/\D/g, "");

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
     *
     * Com `arquivo` (imagem escolhida ou áudio gravado), o arquivo sobe antes
     * para o `outbox` da conexão no bucket, com o `clientId` por nome — é a
     * mesma identidade do clique que a RPC usa para não mandar duas vezes, e é
     * por isso que o reenvio de uma bolha que falhou encontra o objeto já lá e
     * não sobe de novo. O texto vira legenda e pode ficar vazio.
     */
    "conversas.enviar": async ({ id, texto, clientId = null, arquivo = null }) => {
      const limpo = String(texto || "").trim();
      if (!arquivo) {
        return enfileirar(id, "conversation_send", {
          text: limpo,
          ...(clientId ? { clientId } : {}),
        });
      }

      const alvo = separarId(id);
      if (!alvo) throw erroConversas("Conversa inválida.", "conversas-id-invalido");
      const mime = mimeLimpo(arquivo.type);
      const extensao = EXTENSAO_POR_MIME[mime];
      if (!extensao) {
        throw erroConversas(
          "Esse tipo de arquivo não pode ser enviado. Use JPG, PNG, WebP ou o áudio gravado aqui.",
          "conversas-anexo-invalido"
        );
      }
      const identidade = clientId || crypto.randomUUID();
      const organizationId = await organizacao();
      const caminho = `${organizationId}/${alvo.connectionId}/outbox/${identidade}.${extensao}`;

      const { error } = await supabase.storage
        .from(BUCKET_MIDIA)
        .upload(caminho, arquivo, { contentType: mime, cacheControl: "3600" });
      // "Já existe" é o reenvio do mesmo clique: o objeto subiu na tentativa
      // anterior e a fila é quem falhou. Qualquer outro erro é o upload.
      if (error && !/exists|duplicate/i.test(String(error.message || ""))) {
        throw erroConversas(
          "O arquivo não subiu para o servidor. Confira a conexão e tente de novo.",
          "conversas-anexo-falhou"
        );
      }

      return enfileirarEm(alvo, "conversation_send", {
        text: limpo,
        mediaPath: caminho,
        mediaMime: mime,
        clientId: identidade,
      });
    },

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


    /**
     * Pergunta se um número existe no WhatsApp, antes de criar conversa.
     *
     * O único comando desta fila que não exige conversa espelhada — perguntar
     * não envia nada, e exigir espelho para perguntar seria exigir a resposta
     * antes da pergunta.
     *
     * Devolve só o comando. Quem espera a resposta é a tela, pelo mesmo
     * `desfecho` que acompanha um envio: aqui também enfileirar não é
     * perguntar, e a volta leva alguns segundos.
     */
    "conversas.verificarNumero": async ({ connectionId, telefone }) =>
      enfileirarEm(
        { connectionId, chat: telefoneDoWhatsApp(telefone) },
        "conversation_check",
        {}
      ),

    /**
     * Cria a conversa com quem ainda não falou com a empresa.
     *
     * Não manda mensagem. A conversa nasce vazia e a primeira mensagem sai pelo
     * composer, pelo mesmo caminho de qualquer outra — que a esta altura já
     * funciona, porque a linha passou a existir.
     *
     * `connectionId` pode vir nulo: com um WhatsApp só, o banco resolve
     * sozinho. Com mais de um, ele recusa em vez de escolher — adivinhar por
     * qual número a empresa fala com o cliente é decisão de gente.
     */
    "conversas.iniciar": async ({ connectionId = null, telefone, nome = "" }) => {
      const organizationId = await organizacao();
      const { data, error } = await supabase.rpc("nucleo_conversation_start", {
        target_organization: organizationId,
        target_connection: connectionId,
        target_phone: telefoneDoWhatsApp(telefone),
        contact_name: String(nome || "").trim(),
      });
      if (error) throw erroConversas(traduzir(error.message), "conversas-inicio-falhou");
      return {
        id: idDaConversa(data?.connectionId, data?.chat),
        criada: data?.created === true,
        comandoId: data?.commandId || null,
      };
    },

    /**
     * A IA atende este número? Pergunta ao banco, com a regra do gate da VPS.
     *
     * Até 13/09/2026 a ficha respondia isso lendo as etiquetas da cópia local,
     * e a cópia local mentia: a marca ficava no navegador e nunca subia. O dono
     * via "desligado" e a IA seguia respondendo.
     */
    "conversas.atendimentoIA": async ({ telefone }) => {
      const organizationId = await organizacao();
      const { data, error } = await supabase.rpc("nucleo_contact_ai_opt_out_status", {
        target_organization: organizationId,
        target_chat: telefoneDoWhatsApp(telefone),
      });
      if (error) throw erroConversas(traduzir(error.message), "conversas-atendimento-ia-falhou");
      return { atende: data?.optedOut !== true, contatoSalvo: data?.contactFound === true };
    },

    /**
     * Liga ou desliga a IA para o número, direto no banco e numa transação só.
     *
     * Devolve o estado que ficou GRAVADO, relido pelo predicado do gate — é ele
     * que a ficha mostra, e não o que foi pedido.
     */
    "conversas.definirAtendimentoIA": async ({ telefone, atender, nome = "" }) => {
      const organizationId = await organizacao();
      const { data, error } = await supabase.rpc("nucleo_contact_ai_opt_out_set", {
        target_organization: organizationId,
        target_chat: telefoneDoWhatsApp(telefone),
        opt_out: !atender,
        contact_name: String(nome || "").trim(),
      });
      if (error) throw erroConversas(traduzir(error.message), "conversas-atendimento-ia-falhou");
      return { atende: data?.optedOut !== true };
    },

    /**
     * Alguém da equipe inicia um fluxo de gatilho manual (follow-up) para o
     * contato. O banco enfileira o disparo e a VPS roda o fluxo; a tela só
     * sabe que ficou na fila.
     */
    "conversas.iniciarFluxo": async ({ contatoId, chatbotId }) => {
      const { data, error } = await supabase.rpc("nucleo_flow_trigger_manual", {
        target_contact: contatoId,
        target_chatbot: chatbotId,
      });
      if (error) throw erroConversas(traduzir(error.message), "conversas-fluxo-falhou");
      return { enfileirado: Number(data?.queued || 0) > 0 };
    },

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
        // O que o runtime respondeu. Vazio na maioria dos comandos; numa
        // verificação é ele que carrega o `onWhatsApp` — a resposta inteira.
        resultado: data?.result || null,
      };
    },
  };
}
