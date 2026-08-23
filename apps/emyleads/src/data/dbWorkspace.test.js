import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import * as db from "./db";

function apagar(nome) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(nome);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Banco de teste bloqueado."));
  });
}

describe("isolamento do cache por workspace", () => {
  beforeEach(async () => {
    db.definirWorkspace(null);
    await apagar("emyleads");
    await apagar("emyleads-org-a");
    await apagar("emyleads-org-b");
  });

  it("não mistura registros quando troca de empresa", async () => {
    db.definirWorkspace("org-a");
    await db.gravar(db.LOJAS.contatos, { id: "a", nome: "Contato A" });

    db.definirWorkspace("org-b");
    expect(await db.todos(db.LOJAS.contatos)).toEqual([]);
    await db.gravar(db.LOJAS.contatos, { id: "b", nome: "Contato B" });

    db.definirWorkspace("org-a");
    expect(await db.todos(db.LOJAS.contatos)).toEqual([{ id: "a", nome: "Contato A" }]);
    db.definirWorkspace("org-b");
    expect(await db.todos(db.LOJAS.contatos)).toEqual([{ id: "b", nome: "Contato B" }]);
  });
});
