import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as db from "./db.js";
import { operacoes as local } from "./localProvider.js";
import { criarOperacoesSincronizacao } from "./remoteProvider.js";

describe.each(["local", "remote"])("fluxos v3 no provider %s", (mode) => {
  let operations;
  let contact;
  beforeEach(async () => {
    db.definirWorkspace("flow-provider-test");
    db.esquecerConexao();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("emyleads-flow-provider-test");
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    globalThis.chrome = { storage: { local: {
      get: async () => ({ "emyleads.workspace.atual": "flow-provider-test" }),
      set: async () => {}, remove: async () => {},
    } } };
    operations = mode === "local" ? local : criarOperacoesSincronizacao({ local, supabase: {} }).operacoes;
    contact = await local["contatos.criar"]({ nome: "Teste", telefone: "5511999993333" });
    await db.gravar(db.LOJAS.chatbots, {
      id: "flow", nome: "Fluxo", ativo: true, execucoes: 0, criadoEm: 1, atualizadoEm: 1,
      condicoes: [{ tipo: "primeira_conversa" }],
      passos: [
        { id: "one", tipo: "enviar_mensagem", texto: "Primeira" },
        { id: "two", tipo: "enviar_mensagem", texto: "Segunda" },
        { id: "end", tipo: "encerrar" },
      ],
      canvas: { versao: 3, conexoes: [
        { source: "entrada", target: "condicoes", saida: "padrao" },
        { source: "condicoes", target: "one", saida: "padrao" },
        { source: "one", target: "two", saida: "padrao" },
        { source: "two", target: "end", saida: "padrao" },
      ] },
    });
  });
  afterEach(() => { db.esquecerConexao(); db.definirWorkspace(null); });

  it("prevê exatamente a etapa pedida, sem efeitos ou avanço implícito", async () => {
    const args = { chatbotId: "flow", contactId: contact.id };
    const first = await operations["chatbots.prepararEtapa"](args);
    const second = await operations["chatbots.prepararEtapa"]({ ...args, cursor: "two" });
    expect(first.plan).toEqual({ action: "message", text: "Primeira", output: "padrao" });
    expect(second.plan.text).toBe("Segunda");
    expect((await db.buscar(db.LOJAS.chatbots, "flow")).execucoes).toBe(0);
    expect(await db.todos(db.LOJAS.outbox)).toEqual([]);
  });

  it("não executa o fluxo v3 pelo consumidor legado do navegador", async () => {
    const args = { chatbotId: "flow", contactId: contact.id };
    await expect(operations["chatbots.preparar"](args)).rejects.toMatchObject({ codigo: "fluxo-executor-central" });
    await expect(operations["chatbots.executar"](args)).rejects.toMatchObject({ codigo: "fluxo-executor-central" });
    const automatic = await operations["chatbots.prepararAutomatico"]({ ...args, messageId: "inbound" });
    expect(automatic).toEqual({ preparacao: null, motivo: "fluxo-executor-central" });
  });
});
