import { describe, expect, it } from "vitest";
import { criarFilaPorChave } from "./fila";

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

describe("criarFilaPorChave", () => {
  it("serializa tarefas da mesma chave, sem sobreposição", async () => {
    const enfileirar = criarFilaPorChave();
    const eventos = [];

    const a = enfileirar("conversa", async () => {
      eventos.push("a:inicio");
      await esperar(20);
      eventos.push("a:fim");
    });
    const b = enfileirar("conversa", async () => {
      eventos.push("b:inicio");
      await esperar(1);
      eventos.push("b:fim");
    });

    await Promise.all([a, b]);
    expect(eventos).toEqual(["a:inicio", "a:fim", "b:inicio", "b:fim"]);
  });

  it("chaves diferentes não esperam uma pela outra", async () => {
    const enfileirar = criarFilaPorChave();
    const eventos = [];

    const lenta = enfileirar("conversa-1", async () => {
      await esperar(30);
      eventos.push("lenta");
    });
    const rapida = enfileirar("conversa-2", async () => {
      eventos.push("rapida");
    });

    await Promise.all([lenta, rapida]);
    expect(eventos).toEqual(["rapida", "lenta"]);
  });

  it("uma tarefa que falha não trava as seguintes da mesma chave", async () => {
    const enfileirar = criarFilaPorChave();
    const eventos = [];

    const falha = enfileirar("conversa", async () => {
      throw new Error("wa-js caiu");
    });
    const seguinte = enfileirar("conversa", async () => {
      eventos.push("seguinte rodou");
    });

    await expect(falha).rejects.toThrow("wa-js caiu");
    await seguinte;
    expect(eventos).toEqual(["seguinte rodou"]);
  });

  it("duas filas são independentes — é o que acontece com duas abas abertas", async () => {
    const abaA = criarFilaPorChave();
    const abaB = criarFilaPorChave();
    const eventos = [];

    // Mesma conversa, filas distintas: nada as serializa entre si. É por isso
    // que a fila sozinha não é proteção suficiente contra resposta dupla.
    const primeira = abaA("mesma-conversa", async () => {
      eventos.push("A:inicio");
      await esperar(20);
      eventos.push("A:fim");
    });
    const segunda = abaB("mesma-conversa", async () => {
      eventos.push("B:inicio");
    });

    await Promise.all([primeira, segunda]);
    expect(eventos).toEqual(["A:inicio", "B:inicio", "A:fim"]);
  });
});
