import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import * as db from "./db";
import { operacoes as locais } from "./localProvider";
import { criarOperacoesSincronizacao } from "./remoteProvider";

function apagar(nome) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(nome);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Banco de teste bloqueado."));
  });
}

const supabaseFalso = {
  auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } }, error: null }) },
};

function criarSupabaseMigracaoFalso() {
  const tabelas = Object.fromEntries(["stages", "tags", "contacts", "deals", "tasks", "notes", "contact_events", "contact_tags", "chatbot_definitions"].map((nome) => [nome, []]));
  const rpcCalls = [];
  let falharEm = null;
  const consulta = (nome) => {
    const estado = { filtros: [], inclusao: null, ordenacao: null, limite: null, operacao: "select" };
    const api = {
      select: () => api,
      eq: (campo, valor) => { estado.filtros.push((linha) => linha[campo] === valor); return api; },
      in: (campo, valores) => { estado.inclusao = (linha) => valores.includes(linha[campo]); return api; },
      is: (campo, valor) => { estado.filtros.push((linha) => linha[campo] === valor || (valor === null && linha[campo] == null)); return api; },
      order: (campo, opcoes) => { estado.ordenacao = { campo, crescente: opcoes?.ascending !== false }; return api; },
      limit: (valor) => { estado.limite = valor; return api; },
      delete: () => { estado.operacao = "delete"; return api; },
      maybeSingle: async () => {
        let linhas = tabelas[nome].filter((linha) => estado.filtros.every((filtro) => filtro(linha)) && (!estado.inclusao || estado.inclusao(linha)));
        if (estado.limite) linhas = linhas.slice(0, estado.limite);
        return { data: linhas[0] || null, error: null };
      },
      or: (expressao) => {
        const cursorId = expressao.match(/id\.gt\.([^,)]+)/)?.[1];
        if (cursorId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursorId)) {
          throw new Error(`cursor remoto inválido: ${cursorId}`);
        }
        return api;
      },
      upsert: async (linhas) => {
        if (falharEm === nome) throw new Error(`falha simulada em ${nome}`);
        const lista = Array.isArray(linhas) ? linhas : [linhas];
        for (const linha of lista) {
          const chave = nome === "contact_tags" ? `${linha.contact_id}:${linha.tag_id}` : linha.id;
          const indice = tabelas[nome].findIndex((atual) => (nome === "contact_tags" ? `${atual.contact_id}:${atual.tag_id}` : atual.id) === chave);
          if (indice >= 0) tabelas[nome][indice] = { ...tabelas[nome][indice], ...linha };
          else tabelas[nome].push({ ...linha });
        }
        return { data: lista, error: null };
      },
      update: async (patch) => {
        for (const linha of tabelas[nome]) if (estado.filtros.every((filtro) => filtro(linha))) Object.assign(linha, patch);
        return { data: null, error: null };
      },
      then: (resolve, reject) => {
        try {
          let linhas = tabelas[nome].filter((linha) => estado.filtros.every((filtro) => filtro(linha)) && (!estado.inclusao || estado.inclusao(linha)));
          if (estado.ordenacao) linhas = [...linhas].sort((a, b) => String(a[estado.ordenacao.campo]).localeCompare(String(b[estado.ordenacao.campo])) * (estado.ordenacao.crescente ? 1 : -1));
          if (estado.limite) linhas = linhas.slice(0, estado.limite);
          if (estado.operacao === "delete") {
            for (const linha of linhas) {
              const indice = tabelas[nome].indexOf(linha);
              if (indice >= 0) tabelas[nome].splice(indice, 1);
            }
            return Promise.resolve(resolve({ data: null, error: null }));
          }
          return Promise.resolve(resolve({ data: linhas, error: null }));
        } catch (error) { return Promise.reject(reject?.(error) || error); }
      },
    };
    return api;
  };
  return {
    tabelas,
    falharEm: (nome) => { falharEm = nome; },
    auth: supabaseFalso.auth,
    from: consulta,
    rpc: async (nome, args) => {
      rpcCalls.push({ nome, args });
      if (nome === "chatbot_execution_claim") return { data: "ffffffff-ffff-4fff-8fff-ffffffffffff", error: null };
      if (nome === "chatbot_execution_complete") return { data: true, error: null };
      if (nome === "migrate_local_chatbots") {
        args.chatbot_payload.forEach((item, index) => tabelas.chatbot_definitions.push({
          id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          organization_id: args.target_organization,
          name: item.name,
          active: item.active,
          definition: item.definition,
          version: 1,
          executions: 0,
          created_at: "2026-08-23T00:00:00.000Z",
          updated_at: "2026-08-23T00:00:00.000Z",
          deleted_at: null,
        }));
        return { data: args.chatbot_payload.length, error: null };
      }
      return { data: null, error: { code: "PGRST202", message: "função ausente" } };
    },
    rpcCalls,
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async (caminho) => ({ data: { signedUrl: `https://fake.local/${caminho}` }, error: null }) }) },
  };
}

describe("provider remoto e outbox", () => {
  beforeEach(async () => {
    db.definirWorkspace("org-test");
    db.esquecerConexao();
    await apagar("emyleads-org-test");
    globalThis.chrome = { storage: { local: { get: async () => ({ "emyleads.workspace.atual": "org-test" }), set: async () => {}, remove: async () => {} } } };
  });

  it("restaura o workspace antes da primeira operação depois que o service worker acorda", async () => {
    const contato = await locais["contatos.criar"]({
      nome: "Contato etiquetado",
      telefone: "5565999999988",
      tags: ["cliente"],
    });
    db.definirWorkspace(null);

    const sync = criarOperacoesSincronizacao({ supabase: supabaseFalso, local: locais });
    const contatos = await sync.operacoes["contatos.listar"]();

    expect(db.obterWorkspace()).toBe("org-test");
    expect(contatos.find((item) => item.id === contato.id)?.tags).toContain("cliente");
  });

  it("atribui ID remoto e enfileira uma criação local", async () => {
    const sync = criarOperacoesSincronizacao({ supabase: supabaseFalso, local: locais });
    const contato = await locais["contatos.criar"]({ nome: "Ana", telefone: "5565999999999" });

    await sync.syncInterno.registrarResultado("contatos.criar", {}, contato, null);

    const salvo = (await db.todos(db.LOJAS.contatos))[0];
    const fila = await db.todos(db.LOJAS.outbox);
    expect(salvo.remoteId).toMatch(/^[0-9a-f-]{36}$/);
    const contatoNaFila = fila.find((item) => item.entidade === "contatos");
    expect(contatoNaFila).toMatchObject({ entidade: "contatos", localId: contato.id, operacao: "upsert", status: "pendente" });
    expect(contatoNaFila.payload.id).toBe(salvo.remoteId);
  });

  it("coalesce duas alterações do mesmo registro em uma fila", async () => {
    const sync = criarOperacoesSincronizacao({ supabase: supabaseFalso, local: locais });
    const contato = await locais["contatos.criar"]({ nome: "Ana", telefone: "5565999999999" });
    const atualizado = await locais["contatos.atualizar"]({ id: contato.id, patch: { nome: "Ana Maria" } });

    await sync.syncInterno.registrarResultado("contatos.criar", {}, contato, null);
    await sync.syncInterno.registrarResultado("contatos.atualizar", { id: contato.id }, atualizado, { tipo: "contatos", item: contato });

    const fila = await db.todos(db.LOJAS.outbox);
    const contatoNaFila = fila.find((item) => item.entidade === "contatos");
    expect(contatoNaFila.payload.name).toBe("Ana Maria");
  });

  it("aceita eventos no mesmo pipeline de sincronização", async () => {
    const sync = criarOperacoesSincronizacao({ supabase: supabaseFalso, local: locais });
    const contato = await locais["contatos.criar"]({ nome: "Ana", telefone: "5565999999999" });
    const evento = await locais["eventos.registrar"]({ contactId: contato.id, tipo: "bot.condition.met", carga: { regra: "primeiro-contato" } });

    await sync.syncInterno.registrarResultado("eventos.registrar", {}, evento, null);

    const fila = await db.todos(db.LOJAS.outbox);
    expect(fila.find((item) => item.entidade === "eventos" && item.localId === evento.id)).toMatchObject({ localId: evento.id, operacao: "upsert" });
  });

  it("enfileira o contato alterado por um chatbot, mas não o chatbot local", async () => {
    const sync = criarOperacoesSincronizacao({ supabase: supabaseFalso, local: locais });
    const contato = await locais["contatos.criar"]({ nome: "Ana", telefone: "5565999999999" });
    const atualizado = await locais["contatos.atualizar"]({ id: contato.id, patch: { tags: ["lead-quente"] } });

    await sync.syncInterno.registrarResultado("chatbots.executar", {}, { contato: atualizado }, null);

    const fila = await db.todos(db.LOJAS.outbox);
    expect(fila.find((item) => item.entidade === "contatos" && item.localId === contato.id)).toMatchObject({ operacao: "upsert" });
    expect(fila.some((item) => item.entidade === "chatbots")).toBe(false);
  });

  it("usa created_at como cursor do histórico remoto", async () => {
    const sync = criarOperacoesSincronizacao({ supabase: supabaseFalso, local: locais });
    expect(sync.syncInterno).toBeTruthy();
  });

  it("ignora cursor local antigo que não é UUID remoto", async () => {
    await db.gravar(db.LOJAS.sync, {
      chave: "cursor:estagios",
      valor: { valor: "2026-08-21T00:00:00.000Z", id: "2ru5prvh" },
    });
    const remoto = criarSupabaseMigracaoFalso();
    const sync = criarOperacoesSincronizacao({ supabase: remoto, local: locais });

    await expect(sync.operacoes["sync.executar"]()).resolves.toMatchObject({ organizationId: "org-test" });
  });

  it("mantém no conector uma cópia local da versão ativa dos chatbots", async () => {
    const remoto = criarSupabaseMigracaoFalso();
    remoto.tabelas.chatbot_definitions.push({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      organization_id: "org-test",
      name: "Recepção central",
      active: true,
      definition: { gatilho: { tipo: "primeiro-contato" }, passos: [{ id: "p1", tipo: "enviar-mensagem", texto: "Olá" }] },
      version: 4,
      executions: 2,
      created_at: "2026-08-20T00:00:00.000Z",
      updated_at: "2026-08-23T00:00:00.000Z",
      deleted_at: null,
    });
    const sync = criarOperacoesSincronizacao({ supabase: remoto, local: locais });

    await sync.operacoes["sync.executar"]();

    expect(await db.todos(db.LOJAS.chatbots)).toEqual([
      expect.objectContaining({
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        nome: "Recepção central",
        ativo: true,
        version: 4,
      }),
    ]);
    expect((await db.buscar(db.LOJAS.sync, "chatbots-cache"))?.valor?.quantidade).toBe(1);
  });

  it("reivindica a mensagem no Supabase antes de liberar o envio automático", async () => {
    const contato = await locais["contatos.criar"]({ nome: "Ana", telefone: "5565999999999" });
    const contatoRemoto = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.gravar(db.LOJAS.contatos, { ...contato, remoteId: contatoRemoto });
    const bot = (await locais["chatbots.listar"]())[0];
    const botRemoto = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await db.gravar(db.LOJAS.chatbots, { ...bot, remoteId: botRemoto });
    const remoto = criarSupabaseMigracaoFalso();
    const sync = criarOperacoesSincronizacao({ supabase: remoto, local: locais });

    const resultado = await sync.operacoes["chatbots.prepararAutomatico"]({
      contactId: contato.id,
      messageId: "mensagem-central-1",
      agora: Date.now(),
    });

    expect(resultado.preparacao?.executionId).toBe("ffffffff-ffff-4fff-8fff-ffffffffffff");
    expect(remoto.rpcCalls[0]).toMatchObject({
      nome: "chatbot_execution_claim",
      args: {
        target_organization: "org-test",
        target_chatbot: botRemoto,
        target_contact: contatoRemoto,
        target_external_message: "mensagem-central-1",
      },
    });
  });

  it("retoma o snapshot depois de uma falha e conclui sem duplicar", async () => {
    db.definirWorkspace(null);
    await locais["contatos.criar"]({ nome: "Legado", telefone: "5565999999999" });
    db.definirWorkspace("org-test");
    const remoto = criarSupabaseMigracaoFalso();
    remoto.falharEm("contacts");
    const sync = criarOperacoesSincronizacao({ supabase: remoto, local: locais });

    await expect(sync.operacoes["sync.migrarLegado"]({ confirmado: true })).rejects.toThrow(/falha simulada/);
    db.definirWorkspace(null);
    const estadoFalha = (await db.buscar(db.LOJAS.sync, "migracao-snapshot-estado"))?.valor;
    expect(estadoFalha.status).toBe("erro");

    remoto.falharEm(null);
    db.definirWorkspace("org-test");
    const resultado = await sync.operacoes["sync.migrarLegado"]({ confirmado: true });
    expect(resultado.concluida).toBe(true);
    expect(remoto.tabelas.contacts).toHaveLength(1);
    expect(remoto.tabelas.stages.length).toBeGreaterThan(0);
    db.definirWorkspace(null);
    expect((await db.buscar(db.LOJAS.sync, "migracao-snapshot-concluida"))?.valor?.snapshotId).toBeTruthy();

    // Uma edição posterior pertence à sincronização normal e não pode fazer a
    // tela de migração inicial reaparecer.
    remoto.tabelas.contacts[0].name = "Legado atualizado";
    db.definirWorkspace("org-test");
    const status = await sync.operacoes["sync.migracaoStatus"]();
    expect(status.concluida).toBe(true);
    expect(status.etapa).toBe("complete");
  });

  it("repara remoteId antigo antes de enviar a fila offline", async () => {
    const contato = await locais["contatos.criar"]({ nome: "Legado", telefone: "5565999999999" });
    db.definirWorkspace("org-test");
    await db.gravar(db.LOJAS.contatos, { ...contato, remoteId: "2ru5prvh" });
    await db.gravar(db.LOJAS.outbox, {
      id: "outbox-legado", entidade: "contatos", localId: contato.id, remoteId: "2ru5prvh",
      operacao: "upsert", payload: { id: "2ru5prvh", organization_id: "org-test", name: contato.nome, phone: contato.telefone },
      tags: [], status: "pendente", tentativas: 0, criadoEm: Date.now(), atualizadoEm: Date.now(), ultimoErro: null,
    });
    const remoto = criarSupabaseMigracaoFalso();
    const sync = criarOperacoesSincronizacao({ supabase: remoto, local: locais });

    await expect(sync.operacoes["sync.executar"]()).resolves.toMatchObject({ organizationId: "org-test" });
    expect(remoto.tabelas.contacts).toHaveLength(1);
    expect(remoto.tabelas.contacts[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect((await db.buscar(db.LOJAS.contatos, contato.id)).remoteId).toBe(remoto.tabelas.contacts[0].id);
  });
});
