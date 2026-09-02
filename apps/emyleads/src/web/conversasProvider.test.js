import { describe, expect, it, vi } from "vitest";
import { criarOperacoesConversasWeb } from "./conversasProvider.js";
import { WORKSPACE_KEY } from "./storage.js";

const ORGANIZATION_ID = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";
const CONNECTION_ID = "0f2a1b6c-9d3e-4f18-a5c7-2b8e6d4a1c90";

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
    last_message_preview: "oi",
    last_message_at: null,
    last_message_from_me: false,
    unread_count: 0,
    owner: "bot",
  },
];

const CONTATOS = [
  {
    id: "contato-1",
    name: "Marina Alves",
    phone: "(11) 8765-4321",
    company: "Alves Odontologia",
    job_title: "Sócia",
  },
];

const MENSAGENS = [
  {
    message_id: "wa-1",
    content: "Bom dia!",
    sent_at: "2026-08-31T13:00:00.000Z",
    is_from_me: false,
    media_type: "",
    media_filename: "",
  },
  {
    message_id: "wa-2",
    content: "Segue a foto do dente",
    sent_at: "2026-09-01T13:05:00.000Z",
    is_from_me: false,
    media_type: "image",
    media_filename: "foto.jpg",
  },
  {
    message_id: "wa-3",
    content: "",
    sent_at: "2026-09-01T13:06:00.000Z",
    is_from_me: true,
    media_type: "ptt",
    media_filename: "audio.ogg",
  },
];

function bancada({ workspace = ORGANIZATION_ID } = {}) {
  const chamadas = [];
  const respostas = {
    whatsapp_conversations: CONVERSAS,
    contacts: CONTATOS,
    whatsapp_messages: MENSAGENS,
  };
  const supabase = {
    from: vi.fn((tabela) =>
      criarConsulta(tabela, { data: respostas[tabela], error: null }, chamadas)
    ),
  };
  const area = { get: vi.fn(async () => (workspace ? { [WORKSPACE_KEY]: workspace } : {})) };
  return { operacoes: criarOperacoesConversasWeb({ supabase, area }), chamadas, supabase };
}

const consultaDe = (chamadas, tabela) => chamadas.find((c) => c.tabela === tabela);

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

  it("mantém na lista quem ainda não foi cadastrado", async () => {
    const { operacoes } = bancada();
    const [, segunda] = await operacoes["conversas.listar"]();

    // Quem chegou agora é justamente quem não pode sumir da caixa de entrada.
    // Sem nome no CRM nem no WhatsApp, a linha mostra o número.
    expect(segunda).toMatchObject({ contactId: null, nome: "5521999998888" });
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
    expect(bolhas[0]).toMatchObject({ direcao: "entra", texto: "Bom dia!" });
    // Legenda de imagem chega como conteúdo normal e ganha o rótulo junto.
    expect(bolhas[1].texto).toBe("📎 Imagem\nSegue a foto do dente");
    // Áudio sem texto vira só o rótulo — bolha vazia seria pior que dizer o tipo.
    expect(bolhas[2]).toMatchObject({ direcao: "sai", texto: "🎤 Áudio" });
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

  it("id estranho devolve vazio em vez de consultar", async () => {
    const { operacoes, supabase } = bancada();
    expect(await operacoes["conversas.mensagens"]({ id: "sem-telefone:" })).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("o que ainda não escreve", () => {
  it("recusa envio e troca de dono com um código que a tela traduz", async () => {
    const { operacoes } = bancada();
    // A Leva 2 é a fila de comandos do runtime. Enquanto ela não existe, fingir
    // que funcionou faria alguém mandar a mesma mensagem duas vezes.
    for (const acao of ["conversas.enviar", "conversas.trocarDono"]) {
      await expect(operacoes[acao]({ id: "x", texto: "oi" })).rejects.toMatchObject({
        codigo: "conversas-escrita-indisponivel",
      });
    }
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
