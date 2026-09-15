import { describe, expect, it, vi } from "vitest";
import { criarOperacoesConversasWeb } from "./conversasProvider.js";
import { WORKSPACE_KEY } from "./storage.js";

const ORGANIZATION_ID = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";
const CONNECTION_ID = "0f2a1b6c-9d3e-4f18-a5c7-2b8e6d4a1c90";
const AVATAR_PATH = `organizations/${ORGANIZATION_ID}/contacts/contato-1/avatar.jpg`;

/**
 * O construtor de consulta do supabase-js, o suficiente para este provider:
 * encadeia e resolve no fim. Guarda o que foi pedido porque metade do que se
 * afirma aqui é sobre a CONSULTA — o escopo por organização e as colunas que
 * ficaram de fora do `select` — e não sobre o que voltou dela.
 */
function criarConsulta(tabela, resultado, chamadas) {
  const alvo = {
    tabela,
    campos: "",
    filtros: [],
    ordem: null,
    limite: null,
    select: vi.fn((campos) => ((alvo.campos = campos), alvo)),
    eq: vi.fn((coluna, valor) => (alvo.filtros.push([coluna, valor]), alvo)),
    is: vi.fn((coluna, valor) => (alvo.filtros.push([coluna, valor]), alvo)),
    order: vi.fn((coluna, opcoes) => ((alvo.ordem = [coluna, opcoes]), alvo)),
    limit: vi.fn((quantas) => ((alvo.limite = quantas), alvo)),
    then: (resolver) => resolver(resultado),
  };
  chamadas.push(alvo);
  return alvo;
}

const AGORA = new Date().toISOString();

const CONVERSAS = [
  {
    connection_id: CONNECTION_ID,
    // Com o nono dígito. O contato do CRM está gravado sem ele.
    contact_phone: "5511987654321",
    contact_name: "Cliente pelo WhatsApp",
    last_message_preview: "Bom dia! Consegue me mandar a proposta?",
    last_message_at: AGORA,
    last_message_from_me: false,
    unread_count: 2,
    owner: "ia",
  },
  {
    connection_id: CONNECTION_ID,
    contact_phone: "5521999998888",
    contact_name: "",
    contact_photo_url: "https://pps.whatsapp.net/novo-contato.jpg",
    last_message_preview: "oi",
    last_message_at: null,
    last_message_from_me: false,
    unread_count: 0,
    owner: "bot",
  },
  {
    connection_id: CONNECTION_ID,
    // Identificador de grupo: dezoito dígitos, no mesmo campo do telefone. É
    // `chat_kind` que diz como lê-lo — e é por isso que ele precisa de teste.
    contact_phone: "120363001122334455",
    chat_kind: "grupo",
    contact_name: "Comercial · Núcleo Major",
    last_message_preview: "fechamos o mês com 12 propostas",
    last_message_at: AGORA,
    last_message_from_me: false,
    unread_count: 4,
    owner: "bot",
    attendant_id: null,
    attendant_name: "",
  },
];

const CONTATOS = [
  {
    id: "contato-1",
    name: "Marina Alves",
    phone: "(11) 8765-4321",
    company: "Alves Odontologia",
    job_title: "Sócia",
    avatar_path: AVATAR_PATH,
  },
];

/**
 * Como o banco responde: da mais nova para a mais velha.
 *
 * A ordem desta bancada é parte do que ela afirma. A consulta pede
 * `ascending: false`, e escrever a lista aqui em ordem de tela esconderia
 * justamente o passo que a conversa depende — a inversão.
 */
const MENSAGENS = [
  {
    message_id: "wa-3",
    content: "",
    sent_at: "2026-09-01T13:06:00.000Z",
    is_from_me: true,
    media_type: "ptt",
    media_filename: "audio.ogg",
    author_kind: "ia",
    author_name: "Bia",
  },
  {
    message_id: "wa-2",
    content: "Segue a foto do dente",
    sent_at: "2026-09-01T13:05:00.000Z",
    is_from_me: false,
    media_type: "image",
    media_filename: "foto.jpg",
    author_kind: "contato",
    author_name: "",
  },
  {
    message_id: "wa-1",
    content: "Bom dia!",
    sent_at: "2026-08-31T13:00:00.000Z",
    is_from_me: false,
    media_type: "",
    media_filename: "",
    author_kind: "contato",
    author_name: "",
  },
];

function bancada({
  workspace = ORGANIZATION_ID,
  rpc = null,
  conversas = CONVERSAS,
  contatos = CONTATOS,
  mensagens = MENSAGENS,
  assinatura = null,
  upload = { error: null },
} = {}) {
  const chamadas = [];
  const respostas = {
    whatsapp_conversations: conversas,
    contacts: contatos,
    whatsapp_messages: mensagens,
  };
  const rpcs = [];
  const criarUrlsAssinadas = vi.fn(async (caminhos, validade) => {
    if (assinatura instanceof Error) throw assinatura;
    if (assinatura?.error) return assinatura;
    return {
      data:
        assinatura?.data ||
        caminhos.map((path) => ({ path, signedUrl: `https://storage.test/${path}` })),
      error: null,
    };
  });
  const uploads = [];
  const supabase = {
    from: vi.fn((tabela) =>
      criarConsulta(tabela, { data: respostas[tabela], error: null }, chamadas)
    ),
    storage: {
      from: vi.fn((bucket) => ({
        createSignedUrls: (caminhos, validade) => {
          uploads.bucketAssinado = bucket;
          return criarUrlsAssinadas(caminhos, validade);
        },
        upload: vi.fn(async (caminho, arquivo, opcoes) => {
          uploads.push([bucket, caminho, arquivo, opcoes]);
          return upload;
        }),
      })),
    },
    rpc: vi.fn(async (nome, argumentos) => {
      rpcs.push([nome, argumentos]);
      return rpc
        ? rpc(nome, argumentos)
        : { data: { commandId: "cmd-1", status: "pending" }, error: null };
    }),
  };
  const area = { get: vi.fn(async () => (workspace ? { [WORKSPACE_KEY]: workspace } : {})) };
  return {
    operacoes: criarOperacoesConversasWeb({ supabase, area }),
    chamadas,
    criarUrlsAssinadas,
    supabase,
    rpcs,
    uploads,
  };
}

const consultaDe = (chamadas, tabela) => chamadas.find((c) => c.tabela === tabela);

describe("atendimento pela IA grava e lê no banco", () => {
  it("consultar pergunta ao banco pelo número, na organização da sessão", async () => {
    const { operacoes, rpcs } = bancada({
      rpc: async () => ({ data: { optedOut: true, contactFound: true }, error: null }),
    });
    const estado = await operacoes["conversas.atendimentoIA"]({ telefone: "5511987654321" });

    expect(rpcs[0]).toEqual([
      "nucleo_contact_ai_opt_out_status",
      { target_organization: ORGANIZATION_ID, target_chat: "5511987654321" },
    ]);
    expect(estado).toEqual({ atende: false, contatoSalvo: true });
  });

  it("desligar manda opt_out e devolve o que o banco gravou", async () => {
    const { operacoes, rpcs } = bancada({
      // O banco é quem decide o estado final: aqui ele devolve "atende".
      rpc: async () => ({ data: { optedOut: false, contactIds: [] }, error: null }),
    });
    const gravado = await operacoes["conversas.definirAtendimentoIA"]({
      telefone: "5511987654321",
      atender: false,
      nome: " Marina ",
    });

    const [nome, argumentos] = rpcs[0];
    expect(nome).toBe("nucleo_contact_ai_opt_out_set");
    expect(argumentos).toEqual({
      target_organization: ORGANIZATION_ID,
      target_chat: "5511987654321",
      opt_out: true,
      contact_name: "Marina",
    });
    expect(gravado).toEqual({ atende: true });
  });

  it("a recusa do banco chega em português e não vira estado", async () => {
    const { operacoes } = bancada({
      rpc: async () => ({ data: null, error: { message: "organization membership required" } }),
    });
    await expect(
      operacoes["conversas.definirAtendimentoIA"]({ telefone: "5511987654321", atender: false })
    ).rejects.toThrow("Você não faz parte desta empresa.");
  });
});

describe("conversas.listar", () => {
  it("acha o contato do CRM mesmo sem o nono dígito", async () => {
    const { operacoes } = bancada();
    const [primeira] = await operacoes["conversas.listar"]();

    // O CRM guarda "(11) 8765-4321" e o WhatsApp entrega "5511987654321". É o
    // falso negativo que `variantesBR` existe para evitar: sem ele a conversa
    // apareceria como número solto, sem ficha e sem empresa.
    expect(primeira).toMatchObject({
      id: `${CONNECTION_ID}:5511987654321`,
      contactId: "contato-1",
      nome: "Marina Alves",
      empresa: "Alves Odontologia",
      cargo: "Sócia",
      dono: "ia",
      naoLidas: 2,
    });
    expect(primeira.hora).toMatch(/^\d{2}:\d{2}$/);
  });

  it("assina os avatares dos contatos em um único lote", async () => {
    const { operacoes, chamadas, criarUrlsAssinadas, supabase } = bancada();

    const [primeira] = await operacoes["conversas.listar"]();

    expect(consultaDe(chamadas, "contacts").campos).toContain("avatar_path");
    expect(supabase.storage.from).toHaveBeenCalledOnce();
    expect(supabase.storage.from).toHaveBeenCalledWith("contact-avatars");
    expect(criarUrlsAssinadas).toHaveBeenCalledOnce();
    expect(criarUrlsAssinadas).toHaveBeenCalledWith([AVATAR_PATH], 3600);
    expect(primeira.fotoUrl).toBe(`https://storage.test/${AVATAR_PATH}`);
  });

  it("mantém a lista com iniciais quando a assinatura do avatar falha", async () => {
    const { operacoes } = bancada({
      assinatura: { data: null, error: { message: "storage indisponível" } },
    });

    await expect(operacoes["conversas.listar"]()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ contactId: "contato-1", fotoUrl: null })])
    );
  });

  it("mantém na lista quem ainda não foi cadastrado", async () => {
    const { operacoes } = bancada();
    const [, segunda] = await operacoes["conversas.listar"]();

    // Quem chegou agora é justamente quem não pode sumir da caixa de entrada.
    // Sem nome no CRM nem no WhatsApp, a linha mostra o número.
    expect(segunda).toMatchObject({ contactId: null, nome: "5521999998888" });
    expect(segunda.fotoUrl).toBe("https://pps.whatsapp.net/novo-contato.jpg");
    expect(segunda.hora).toBe("");
  });

  it("consulta as duas tabelas presa à organização da sessão", async () => {
    const { operacoes, chamadas } = bancada();
    await operacoes["conversas.listar"]();

    for (const tabela of ["whatsapp_conversations", "contacts"]) {
      expect(consultaDe(chamadas, tabela).filtros).toContainEqual([
        "organization_id",
        ORGANIZATION_ID,
      ]);
    }
    expect(consultaDe(chamadas, "whatsapp_conversations").ordem).toEqual([
      "last_message_at",
      { ascending: false, nullsFirst: false },
    ]);
    expect(consultaDe(chamadas, "whatsapp_conversations").campos).toContain("contact_photo_url");
  });

  it("sem empresa escolhida não sai consulta nenhuma", async () => {
    const { operacoes, supabase } = bancada({ workspace: null });
    await expect(operacoes["conversas.listar"]()).rejects.toMatchObject({
      codigo: "workspace-ausente",
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("conversas.mensagens", () => {
  it("separa os dias e rotula a mídia que ficou na VPS", async () => {
    const { operacoes } = bancada();
    const linhas = await operacoes["conversas.mensagens"]({
      id: `${CONNECTION_ID}:5511987654321`,
    });

    expect(linhas.filter((l) => l.tipo === "data")).toHaveLength(2);
    expect(linhas[0].tipo).toBe("data");

    const bolhas = linhas.filter((l) => l.tipo === "mensagem");
    expect(bolhas[0]).toMatchObject({
      messageId: "wa-1",
      direcao: "entra",
      texto: "Bom dia!",
      enviadaEm: new Date("2026-08-31T13:00:00.000Z").getTime(),
    });
    // Legenda de imagem chega como conteúdo normal e ganha o rótulo junto.
    expect(bolhas[1].texto).toBe("📎 Imagem\nSegue a foto do dente");
    // Áudio sem texto vira só o rótulo — bolha vazia seria pior que dizer o tipo.
    expect(bolhas[2]).toMatchObject({ direcao: "sai", texto: "🎤 Áudio" });
  });

  /**
   * Quem escreveu, do nosso lado.
   *
   * A terceira queixa do dono em 13/09/2026 — "não dá para saber, nas
   * mensagens, quem escreveu" — é de DADO, não de tela: toda saída da empresa
   * chega ao Bridge como `is_from_me = 1`, venha da IA, do atendente ou do
   * celular. Quem separa as três é o runtime, que anota o que ele mesmo manda;
   * aqui a coluna vira o rótulo da bolha.
   */
  it("leva o nome e o tom de quem escreveu até a bolha", async () => {
    const { operacoes } = bancada();
    const bolhas = (
      await operacoes["conversas.mensagens"]({ id: `${CONNECTION_ID}:5511987654321` })
    ).filter((l) => l.tipo === "mensagem");

    expect(bolhas[2]).toMatchObject({ tom: "ia", autor: "Bia" });
    // O contato não leva rótulo: quem ele é já está no topo da conversa, e
    // repetir o nome em toda bolha é ruído.
    expect(bolhas[0]).toMatchObject({ tom: null, autor: null });
  });

  it("mensagem sem autoria sai sem nome — é o celular, e não um erro", async () => {
    const { operacoes } = bancada({
      mensagens: [
        {
          message_id: "wa-9",
          content: "respondi daqui do celular",
          sent_at: "2026-09-01T13:10:00.000Z",
          is_from_me: true,
          media_type: "",
          media_filename: "",
          author_kind: "",
          author_name: "",
        },
      ],
    });
    const bolhas = (
      await operacoes["conversas.mensagens"]({ id: `${CONNECTION_ID}:5511987654321` })
    ).filter((l) => l.tipo === "mensagem");

    expect(bolhas[0]).toMatchObject({ direcao: "sai", tom: null, autor: null });
  });

  it("nome sem tipo não vira rótulo", async () => {
    // Acontece quando o runtime é mais novo que o portal e manda um tipo que
    // este código ainda não conhece. Meio dado numa etiqueta de autoria é pior
    // que nenhum: a bolha afirmaria quem escreveu sem saber em que qualidade.
    const { operacoes } = bancada({
      mensagens: [
        {
          message_id: "wa-8",
          content: "oi",
          sent_at: "2026-09-01T13:11:00.000Z",
          is_from_me: true,
          media_type: "",
          media_filename: "",
          author_kind: "fluxo",
          author_name: "Fluxo de boas-vindas",
        },
      ],
    });
    const bolhas = (
      await operacoes["conversas.mensagens"]({ id: `${CONNECTION_ID}:5511987654321` })
    ).filter((l) => l.tipo === "mensagem");

    expect(bolhas[0]).toMatchObject({ tom: null, autor: null });
  });

  it("pede as colunas de autoria ao banco", async () => {
    const { operacoes, chamadas } = bancada();
    await operacoes["conversas.mensagens"]({ id: `${CONNECTION_ID}:5511987654321` });

    const consulta = consultaDe(chamadas, "whatsapp_messages");
    expect(consulta.campos).toContain("author_kind");
    expect(consulta.campos).toContain("author_name");
  });

  it("pede só o que a tela mostra, e nunca o material da mídia", async () => {
    const { operacoes, chamadas } = bancada();
    await operacoes["conversas.mensagens"]({ id: `${CONNECTION_ID}:5511987654321` });

    const consulta = consultaDe(chamadas, "whatsapp_messages");
    // O espelho não guarda chave, hash nem URL de CDN (migration
    // 20260902120000). Pedir qualquer um deles aqui seria o primeiro passo para
    // alguém acrescentá-los lá.
    for (const proibido of ["media_key", "file_sha256", "url"]) {
      expect(consulta.campos).not.toContain(proibido);
    }
    expect(consulta.filtros).toEqual([
      ["organization_id", ORGANIZATION_ID],
      ["connection_id", CONNECTION_ID],
      ["contact_phone", "5511987654321"],
    ]);
    // Teto por conversa: anos de histórico de uma vez travariam o navegador de
    // quem conversa todo dia.
    expect(consulta.limite).toBe(300);
  });

  /**
   * O teto corta pelo fim da conversa, e não pelo começo.
   *
   * Foi o defeito relatado em 03/09/2026: com `ascending: true`, o `limit`
   * devolvia as 300 mensagens MAIS ANTIGAS, e quem passou desse número via a
   * conversa parada no passado para sempre. A lateral continuava certa, porque
   * a prévia vem de `whatsapp_conversations` — o que fazia o defeito parecer
   * coisa da tela, e não da consulta.
   *
   * Ordem e teto são uma decisão só; por isso as duas afirmações moram juntas.
   */
  it("o teto guarda as mensagens mais NOVAS, e a tela as recebe em ordem", async () => {
    const { operacoes, chamadas } = bancada();
    const linhas = await operacoes["conversas.mensagens"]({
      id: `${CONNECTION_ID}:5511987654321`,
    });

    expect(consultaDe(chamadas, "whatsapp_messages").ordem).toEqual([
      "sent_at",
      { ascending: false },
    ]);
    // E chega à tela na ordem de leitura, apesar disso.
    const bolhas = linhas.filter((l) => l.tipo === "mensagem");
    expect(bolhas.map((b) => b.texto)).toEqual([
      "Bom dia!",
      "📎 Imagem\nSegue a foto do dente",
      "🎤 Áudio",
    ]);
  });

  it("id estranho devolve vazio em vez de consultar", async () => {
    const { operacoes, supabase } = bancada();
    expect(await operacoes["conversas.mensagens"]({ id: "sem-telefone:" })).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("grupo na lista", () => {
  it("entra com o nome do grupo, sem telefone e sem ficha", async () => {
    const { operacoes } = bancada();
    const grupo = (await operacoes["conversas.listar"]()).find((c) => c.grupo);

    expect(grupo).toMatchObject({
      id: `${CONNECTION_ID}:120363001122334455`,
      nome: "Comercial · Núcleo Major",
      // Um grupo não tem telefone. Formatá-lo daria um número de dezoito
      // dígitos com DDD inventado no cabeçalho da conversa.
      telefone: "",
      // E não procura contato: o índice acharia alguém por coincidência de
      // dígitos e penduraria a ficha da pessoa errada ao lado da conversa.
      contactId: null,
      naoLidas: 4,
    });
  });

  it("usa um rótulo legível quando o grupo nunca teve nome", async () => {
    const semNome = { ...CONVERSAS.find((c) => c.chat_kind === "grupo"), contact_name: "   " };
    const { operacoes } = bancada({ conversas: [semNome] });

    const [grupo] = await operacoes["conversas.listar"]();

    expect(grupo.nome).toBe("Grupo sem nome");
  });

  it("o identificador de grupo sobrevive à volta pelo id da tela", async () => {
    const { operacoes, chamadas } = bancada();
    const grupo = (await operacoes["conversas.listar"]()).find((c) => c.grupo);
    await operacoes["conversas.mensagens"]({ id: grupo.id });

    // Se o id fosse limpo como telefone, a consulta procuraria por outra chave
    // e a conversa abriria vazia — sem erro nenhum.
    expect(consultaDe(chamadas, "whatsapp_messages").filtros).toContainEqual([
      "contact_phone",
      "120363001122334455",
    ]);
  });
});

describe("escrever pela fila do runtime", () => {
  it("enfileira a mensagem com a conexão e o chat separados do id da tela", async () => {
    const { operacoes, rpcs } = bancada();
    const resposta = await operacoes["conversas.enviar"]({
      id: `${CONNECTION_ID}:5511987654321`,
      texto: "  Bom dia, Marina!  ",
    });

    const [nome, argumentos] = rpcs[0];
    expect(nome).toBe("nucleo_conversation_command_enqueue");
    expect(argumentos).toMatchObject({
      target_organization: ORGANIZATION_ID,
      target_connection: CONNECTION_ID,
      target_chat: "5511987654321",
      requested_command: "conversation_send",
    });
    expect(argumentos.command_payload.text).toBe("Bom dia, Marina!");
    expect(resposta).toEqual({ comandoId: "cmd-1", situacao: "pending" });
  });

  /**
   * A idempotência sai do clique, e não do texto.
   *
   * Chavear pelo conteúdo faria a segunda mensagem "ok" da mesma conversa ser
   * engolida como repetição da primeira — e "ok" é o que mais se digita duas
   * vezes num atendimento.
   */
  it("cada envio leva um clientId próprio", async () => {
    const { operacoes, rpcs } = bancada();
    const id = `${CONNECTION_ID}:5511987654321`;
    await operacoes["conversas.enviar"]({ id, texto: "ok" });
    await operacoes["conversas.enviar"]({ id, texto: "ok" });

    const [primeiro, segundo] = rpcs.map(([, a]) => a.command_payload.clientId);
    expect(primeiro).toBeTruthy();
    expect(primeiro).not.toBe(segundo);
  });

  it("atribuir manda o id de quem assume, e nunca o nome", async () => {
    const { operacoes, rpcs } = bancada();
    await operacoes["conversas.trocarDono"]({
      id: `${CONNECTION_ID}:5511987654321`,
      dono: "humano",
      atendenteId: "6f1d3e0c-9a2b-4c1e-8f77-2b0a5d4e9c31",
    });

    const [nome, argumentos] = rpcs[0];
    expect(nome).toBe("nucleo_conversation_command_enqueue");
    expect(argumentos.requested_command).toBe("conversation_owner");
    expect(argumentos.command_payload).toMatchObject({
      owner: "humano",
      attendantId: "6f1d3e0c-9a2b-4c1e-8f77-2b0a5d4e9c31",
    });
    // O nome é resolvido do perfil, dentro do banco. Aceitá-lo daqui deixaria
    // a faixa dizer "Atendente · Lucas" numa conversa que outra pessoa pegou.
    expect(argumentos.command_payload.attendantName).toBeUndefined();
  });

  it("quem não é humano não carrega atendente", async () => {
    const { operacoes, rpcs } = bancada();
    await operacoes["conversas.trocarDono"]({
      id: `${CONNECTION_ID}:5511987654321`,
      dono: "ia",
      atendenteId: "6f1d3e0c-9a2b-4c1e-8f77-2b0a5d4e9c31",
    });
    expect(rpcs[0][1].command_payload.attendantId).toBe("");
  });

  it("a recusa da RPC chega em português", async () => {
    const { operacoes } = bancada({
      rpc: async () => ({
        data: null,
        error: { message: "conversation is not mirrored for this connection" },
      }),
    });
    await expect(
      operacoes["conversas.enviar"]({ id: `${CONNECTION_ID}:5511987654321`, texto: "oi" })
    ).rejects.toMatchObject({
      codigo: "conversas-comando-falhou",
      message: /ainda não chegou da VPS/,
    });
  });

  it("id estranho não vira comando", async () => {
    const { operacoes, supabase } = bancada();
    await expect(
      operacoes["conversas.enviar"]({ id: "sem-chat:", texto: "oi" })
    ).rejects.toMatchObject({ codigo: "conversas-id-invalido" });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("o desfecho traz a situação e o motivo, para a tela parar de dizer enviando", async () => {
    const { operacoes } = bancada({
      rpc: async () => ({
        data: { status: "failed", errorCode: "recipient_not_allowed" },
        error: null,
      }),
    });
    expect(await operacoes["conversas.desfecho"]({ comandoId: "cmd-1" })).toEqual({
      situacao: "failed",
      motivo: "recipient_not_allowed",
      resultado: null,
    });
  });

  it("o desfecho devolve o resultado do runtime, que é onde a verificação responde", async () => {
    const { operacoes } = bancada({
      rpc: async () => ({
        data: {
          status: "completed",
          errorCode: null,
          result: { onWhatsApp: false, reason: "not_registered" },
        },
        error: null,
      }),
    });
    expect(await operacoes["conversas.desfecho"]({ comandoId: "cmd-1" })).toEqual({
      situacao: "completed",
      motivo: "",
      resultado: { onWhatsApp: false, reason: "not_registered" },
    });
  });
});

describe("conversas.verificarNumero", () => {
  it("pergunta pelo comando que não exige conversa espelhada", async () => {
    const { operacoes, rpcs } = bancada();
    await operacoes["conversas.verificarNumero"]({
      connectionId: CONNECTION_ID,
      telefone: "(11) 98765-4321",
    });

    const [nome, argumentos] = rpcs[0];
    expect(nome).toBe("nucleo_conversation_command_enqueue");
    expect(argumentos.requested_command).toBe("conversation_check");
    // Com DDI, e não só sem pontuação. Tirar os parênteses e parar por aí
    // mandaria "11987654321" pela fila, o Bridge procuraria "+11987654321", e a
    // resposta seria "não tem WhatsApp" sobre um número que tem.
    expect(argumentos.target_chat).toBe("5511987654321");
    expect(argumentos.target_connection).toBe(CONNECTION_ID);
  });

  it("cada pergunta tem clientId próprio, para reperguntar não ser engolido", async () => {
    const { operacoes, rpcs } = bancada();
    await operacoes["conversas.verificarNumero"]({
      connectionId: CONNECTION_ID,
      telefone: "5511987654321",
    });
    await operacoes["conversas.verificarNumero"]({
      connectionId: CONNECTION_ID,
      telefone: "5511987654321",
    });
    expect(rpcs[0][1].command_payload.clientId).not.toBe(
      rpcs[1][1].command_payload.clientId
    );
  });
});

describe("conversas.iniciar", () => {
  it("cria a conversa e devolve o id que a lista usa", async () => {
    const { operacoes, rpcs } = bancada({
      rpc: async () => ({
        data: {
          connectionId: CONNECTION_ID,
          chat: "5565992178164",
          created: true,
          commandId: "cmd-9",
        },
        error: null,
      }),
    });

    const nova = await operacoes["conversas.iniciar"]({
      connectionId: CONNECTION_ID,
      telefone: "+55 65 99217-8164",
      nome: "  Ana Paula  ",
    });

    const [nome, argumentos] = rpcs[0];
    expect(nome).toBe("nucleo_conversation_start");
    expect(argumentos.target_phone).toBe("5565992178164");
    expect(argumentos.contact_name).toBe("Ana Paula");
    // O id é `<conexao>:<chat>`, o mesmo formato que `conversas.listar` monta.
    // Se divergisse, a tela selecionaria uma conversa que a lista não tem.
    expect(nova.id).toBe(`${CONNECTION_ID}:5565992178164`);
    expect(nova.criada).toBe(true);
  });

  it("conexão nula chega nula, para o banco resolver", async () => {
    // A tela não adivinha por qual WhatsApp a empresa fala. Com um só, o banco
    // resolve; com mais de um, recusa com motivo próprio.
    const { operacoes, rpcs } = bancada({
      rpc: async () => ({
        data: { connectionId: CONNECTION_ID, chat: "5565992178164", created: true },
        error: null,
      }),
    });
    await operacoes["conversas.iniciar"]({ telefone: "5565992178164" });
    expect(rpcs[0][1].target_connection).toBeNull();
  });

  it("o teto por hora chega em português, dizendo o que fazer", async () => {
    const { operacoes } = bancada({
      rpc: async () => ({
        data: null,
        error: { message: "too many conversations started in the last hour" },
      }),
    });
    await expect(
      operacoes["conversas.iniciar"]({ telefone: "5565992178164" })
    ).rejects.toThrow(/Espere um pouco/);
  });

  it("mais de uma conexão vira instrução, e não erro cru do banco", async () => {
    const { operacoes } = bancada({
      rpc: async () => ({
        data: null,
        error: { message: "organization has more than one connection; choose one" },
      }),
    });
    await expect(
      operacoes["conversas.iniciar"]({ telefone: "5565992178164" })
    ).rejects.toThrow(/mais de um WhatsApp conectado/);
  });
});

describe("modelos de mensagem", () => {
  it("devolve o baralho guardado na sessão", async () => {
    const { operacoes } = bancada();
    const [modelo] = await operacoes["conversas.modelos"]();
    expect(modelo.baralho).toEqual([]);

    await operacoes["conversas.guardarBaralho"]({ id: modelo.id, baralho: ["t1b", "t1c"] });
    const [depois] = await operacoes["conversas.modelos"]();
    expect(depois.baralho).toEqual(["t1b", "t1c"]);
  });
});

describe("mídia com arquivo", () => {
  const COM_ARQUIVO = [
    {
      message_id: "wa-5",
      content: "*Bia:*\nSegue o áudio",
      sent_at: "2026-09-16T13:06:00.000Z",
      is_from_me: true,
      media_type: "ptt",
      media_filename: "audio.ogg",
      media_path: `${ORGANIZATION_ID}/${CONNECTION_ID}/outbox/abc.webm`,
      media_mime: "audio/webm",
      author_kind: "humano",
      author_name: "Bia",
    },
    {
      message_id: "wa-4",
      content: "",
      sent_at: "2026-09-16T13:05:00.000Z",
      is_from_me: false,
      media_type: "image",
      media_filename: "foto.jpg",
      media_path: `${ORGANIZATION_ID}/${CONNECTION_ID}/5511987654321/wa-4.jpg`,
      media_mime: "image/jpeg",
      author_kind: "contato",
      author_name: "",
    },
    // Ainda sem arquivo: o runtime sobe um ciclo depois da mensagem.
    {
      message_id: "wa-3",
      content: "",
      sent_at: "2026-09-16T13:04:00.000Z",
      is_from_me: false,
      media_type: "audio",
      media_filename: "audio.ogg",
      media_path: "",
      media_mime: "",
      author_kind: "contato",
      author_name: "",
    },
  ];

  it("assina os caminhos do bucket de mídia num lote só e entrega a URL à bolha", async () => {
    const { operacoes, criarUrlsAssinadas, uploads } = bancada({ mensagens: COM_ARQUIVO });
    const lista = await operacoes["conversas.mensagens"]({ id: `${CONNECTION_ID}:5511987654321` });

    expect(uploads.bucketAssinado).toBe("whatsapp-media");
    expect(criarUrlsAssinadas).toHaveBeenCalledTimes(1);
    expect(criarUrlsAssinadas.mock.calls[0][0]).toEqual([
      `${ORGANIZATION_ID}/${CONNECTION_ID}/outbox/abc.webm`,
      `${ORGANIZATION_ID}/${CONNECTION_ID}/5511987654321/wa-4.jpg`,
    ]);
    expect(criarUrlsAssinadas.mock.calls[0][1]).toBe(3600);

    const bolhas = lista.filter((item) => item.tipo === "mensagem");
    expect(bolhas[0]).toMatchObject({ messageId: "wa-3", texto: "🎤 Áudio", midia: null });
    expect(bolhas[1]).toMatchObject({
      messageId: "wa-4",
      texto: "",
      midia: {
        tipo: "imagem",
        url: `https://storage.test/${ORGANIZATION_ID}/${CONNECTION_ID}/5511987654321/wa-4.jpg`,
        nome: "foto.jpg",
        mime: "image/jpeg",
      },
    });
    expect(bolhas[2].midia).toMatchObject({ tipo: "audio", mime: "audio/webm" });
  });

  it("tira a assinatura do runtime do texto de quem já tem nome na bolha", async () => {
    const { operacoes } = bancada({ mensagens: COM_ARQUIVO });
    const lista = await operacoes["conversas.mensagens"]({ id: `${CONNECTION_ID}:5511987654321` });
    const bolhas = lista.filter((item) => item.tipo === "mensagem");
    expect(bolhas[2]).toMatchObject({ autor: "Bia", tom: "humano", texto: "Segue o áudio" });
  });

  it("sem URL assinada a bolha volta ao rótulo, como antes", async () => {
    const { operacoes } = bancada({
      mensagens: COM_ARQUIVO,
      assinatura: { data: null, error: { message: "storage indisponível" } },
    });
    const lista = await operacoes["conversas.mensagens"]({ id: `${CONNECTION_ID}:5511987654321` });
    const bolhas = lista.filter((item) => item.tipo === "mensagem");
    expect(bolhas[1]).toMatchObject({ texto: "📎 Imagem", midia: null });
    expect(bolhas[2]).toMatchObject({ texto: "🎤 Áudio\nSegue o áudio", midia: null });
  });

  it("pede as colunas do arquivo, e continua sem pedir o material da mídia", async () => {
    const { operacoes, chamadas } = bancada();
    await operacoes["conversas.mensagens"]({ id: `${CONNECTION_ID}:5511987654321` });
    const consulta = consultaDe(chamadas, "whatsapp_messages");
    expect(consulta.campos).toContain("media_path");
    expect(consulta.campos).toContain("media_mime");
    expect(consulta.campos).not.toContain("media_key");
  });

  it("um texto do contato que se parece com assinatura fica como veio", async () => {
    const { operacoes } = bancada({
      mensagens: [
        {
          message_id: "wa-9",
          content: "*Marina:*\nsou eu mesma",
          sent_at: "2026-09-16T13:04:00.000Z",
          is_from_me: false,
          media_type: "",
          media_filename: "",
          author_kind: "contato",
          author_name: "",
        },
      ],
    });
    const lista = await operacoes["conversas.mensagens"]({ id: `${CONNECTION_ID}:5511987654321` });
    expect(lista.at(-1).texto).toBe("*Marina:*\nsou eu mesma");
  });
});

describe("enviar arquivo pela fila", () => {
  const id = `${CONNECTION_ID}:5511987654321`;
  const imagem = { name: "foto.jpg", type: "image/jpeg", size: 1024 };

  it("sobe para o outbox da conexão com o clientId por nome, e enfileira o caminho", async () => {
    const { operacoes, rpcs, uploads } = bancada();
    await operacoes["conversas.enviar"]({
      id,
      texto: " legenda ",
      arquivo: imagem,
      clientId: "b1f2c3d4-0000-4000-8000-000000000001",
    });

    const caminho = `${ORGANIZATION_ID}/${CONNECTION_ID}/outbox/b1f2c3d4-0000-4000-8000-000000000001.jpg`;
    expect(uploads).toEqual([
      ["whatsapp-media", caminho, imagem, { contentType: "image/jpeg", cacheControl: "3600" }],
    ]);
    const [nome, argumentos] = rpcs.at(-1);
    expect(nome).toBe("nucleo_conversation_command_enqueue");
    expect(argumentos.requested_command).toBe("conversation_send");
    expect(argumentos.command_payload).toEqual({
      clientId: "b1f2c3d4-0000-4000-8000-000000000001",
      text: "legenda",
      mediaPath: caminho,
      mediaMime: "image/jpeg",
    });
  });

  it("o áudio gravado perde os parâmetros do mime e ganha a extensão certa", async () => {
    const { operacoes, rpcs, uploads } = bancada();
    await operacoes["conversas.enviar"]({
      id,
      texto: "",
      arquivo: { name: "gravacao.webm", type: "audio/webm;codecs=opus", size: 2048 },
      clientId: "e5f6a7b8-0000-4000-8000-000000000002",
    });
    expect(uploads[0][1].endsWith("/outbox/e5f6a7b8-0000-4000-8000-000000000002.webm")).toBe(true);
    expect(uploads[0][3].contentType).toBe("audio/webm");
    expect(rpcs.at(-1)[1].command_payload).toMatchObject({ text: "", mediaMime: "audio/webm" });
  });

  it("o reenvio encontra o arquivo já no bucket e segue para a fila", async () => {
    const { operacoes, rpcs } = bancada({
      upload: { error: { message: "The resource already exists", statusCode: "409" } },
    });
    await operacoes["conversas.enviar"]({ id, texto: "", arquivo: imagem, clientId: "aaaa-1" });
    expect(rpcs.at(-1)[0]).toBe("nucleo_conversation_command_enqueue");
  });

  it("upload que falha não enfileira nada, e diz o que fazer", async () => {
    const { operacoes, rpcs } = bancada({ upload: { error: { message: "network down" } } });
    await expect(
      operacoes["conversas.enviar"]({ id, texto: "", arquivo: imagem, clientId: "aaaa-2" })
    ).rejects.toThrow(/não subiu/);
    expect(rpcs).toEqual([]);
  });

  it("tipo de arquivo fora da lista é recusado antes de subir", async () => {
    const { operacoes, rpcs, uploads } = bancada();
    await expect(
      operacoes["conversas.enviar"]({
        id,
        texto: "",
        arquivo: { name: "x.pdf", type: "application/pdf", size: 10 },
      })
    ).rejects.toThrow(/tipo de arquivo/);
    expect(uploads).toEqual([]);
    expect(rpcs).toEqual([]);
  });

  it("sem arquivo o envio continua exatamente como era", async () => {
    const { operacoes, rpcs, uploads } = bancada();
    await operacoes["conversas.enviar"]({ id, texto: "oi", clientId: "aaaa-3" });
    expect(uploads).toEqual([]);
    expect(rpcs.at(-1)[1].command_payload).toEqual({ clientId: "aaaa-3", text: "oi" });
  });
});
