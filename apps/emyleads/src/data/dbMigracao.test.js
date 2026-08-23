import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import * as db from "./db";
import { operacoes } from "./localProvider";

function apagarBanco() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("emyleads");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function criarBancoV3() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("emyleads", 3);
    req.onupgradeneeded = () => {
      const banco = req.result;
      const contatos = banco.createObjectStore("contatos", { keyPath: "id" });
      contatos.createIndex("telefone", "telefone");
      contatos.createIndex("waId", "waId");
      const negocios = banco.createObjectStore("negocios", { keyPath: "id" });
      negocios.createIndex("contactId", "contactId");
      negocios.createIndex("stageId", "stageId");
      const tarefas = banco.createObjectStore("tarefas", { keyPath: "id" });
      tarefas.createIndex("contactId", "contactId");
      tarefas.createIndex("venceEm", "venceEm");
      const notas = banco.createObjectStore("notas", { keyPath: "id" });
      notas.createIndex("contactId", "contactId");
      const estagios = banco.createObjectStore("estagios", { keyPath: "id" });
      estagios.createIndex("ordem", "ordem");
      banco.createObjectStore("tags", { keyPath: "id" });
      banco.createObjectStore("meta", { keyPath: "chave" });
      const outbox = banco.createObjectStore("outbox", { keyPath: "id" });
      outbox.createIndex("status", "status");
      outbox.createIndex("entidade", "entidade");
      outbox.createIndex("criadoEm", "criadoEm");
      banco.createObjectStore("sync", { keyPath: "chave" });
      const eventos = banco.createObjectStore("eventos", { keyPath: "id" });
      eventos.createIndex("contactId", "contactId");
      eventos.createIndex("ocorridoEm", "ocorridoEm");
    };
    req.onsuccess = () => {
      const banco = req.result;
      const tx = banco.transaction([...banco.objectStoreNames], "readwrite");
      tx.objectStore("contatos").put({ id: "contato-v3", telefone: "", tags: [] });
      tx.objectStore("estagios").put({ id: "estagio-v3", nome: "Antigo", ordem: 0 });
      tx.objectStore("tags").put({ id: "tag-v3", nome: "Antiga", cor: "#000000" });
      tx.objectStore("meta").put({ chave: "preferencia", valor: true });
      tx.objectStore("outbox").put({ id: "outbox-v3", status: "pendente", entidade: "contatos", criadoEm: 1 });
      tx.objectStore("sync").put({ chave: "cursor-contatos", valor: 1 });
      tx.objectStore("eventos").put({ id: "evento-v3", contactId: "contato-v3", tipo: "contact.created", ocorridoEm: 1, criadoEm: 1 });
      tx.oncomplete = () => { banco.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe("migração do IndexedDB v3 para v4", () => {
  beforeEach(async () => {
    db.definirWorkspace(null);
    db.esquecerConexao();
    await apagarBanco();
  });

  it("preserva os stores existentes e semeia chatbots uma única vez", async () => {
    await criarBancoV3();
    expect((await db.buscar(db.LOJAS.contatos, "contato-v3")).id).toBe("contato-v3");
    expect((await db.buscar(db.LOJAS.estagios, "estagio-v3")).nome).toBe("Antigo");
    expect((await db.buscar(db.LOJAS.tags, "tag-v3")).nome).toBe("Antiga");
    expect((await db.buscar(db.LOJAS.meta, "preferencia")).valor).toBe(true);
    expect((await db.buscar(db.LOJAS.outbox, "outbox-v3")).status).toBe("pendente");
    expect((await db.buscar(db.LOJAS.sync, "cursor-contatos")).valor).toBe(1);
    expect((await db.buscar(db.LOJAS.eventos, "evento-v3")).tipo).toBe("contact.created");
    expect(await db.porIndice(db.LOJAS.contatos, "telefone", "")).toHaveLength(1);

    const bots = await operacoes["chatbots.listar"]();
    expect(bots.some((bot) => bot.id === "boas-vindas-primeira")).toBe(true);
    await operacoes["chatbots.remover"]({ id: "boas-vindas-primeira" });
    db.esquecerConexao();
    expect(await operacoes["chatbots.listar"]()).toEqual([]);
  });
});
