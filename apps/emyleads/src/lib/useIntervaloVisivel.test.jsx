// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { iniciarIntervaloVisivel, useIntervaloVisivel } from "./useIntervaloVisivel";

/** Um documento de mentira: só a visibilidade e o aviso de quando ela muda. */
function documentoFalso(estado = "visible") {
  const alvo = new EventTarget();
  alvo.visibilityState = estado;
  alvo.mudar = (novo) => {
    alvo.visibilityState = novo;
    alvo.dispatchEvent(new Event("visibilitychange"));
  };
  return alvo;
}

describe("iniciarIntervaloVisivel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("bate no intervalo com a aba à vista, e não roda ao ligar", () => {
    const tarefa = vi.fn();
    const parar = iniciarIntervaloVisivel(tarefa, 1000, { documento: documentoFalso() });
    expect(tarefa).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(tarefa).toHaveBeenCalledTimes(3);
    parar();
  });

  it("não deixa relógio nenhum vivo com a aba oculta", () => {
    const documento = documentoFalso();
    const tarefa = vi.fn();
    const parar = iniciarIntervaloVisivel(tarefa, 1000, { documento });
    documento.mudar("hidden");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(tarefa).not.toHaveBeenCalled();
    parar();
  });

  it("nem liga quando a aba já começa oculta", () => {
    const tarefa = vi.fn();
    const parar = iniciarIntervaloVisivel(tarefa, 1000, { documento: documentoFalso("hidden") });
    expect(vi.getTimerCount()).toBe(0);
    parar();
  });

  it("ao voltar depois de perder uma batida, roda na hora e retoma o ritmo", () => {
    const documento = documentoFalso();
    const tarefa = vi.fn();
    const parar = iniciarIntervaloVisivel(tarefa, 1000, { documento });
    documento.mudar("hidden");
    vi.advanceTimersByTime(5000);
    documento.mudar("visible");
    expect(tarefa).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(tarefa).toHaveBeenCalledTimes(2);
    parar();
  });

  it("ao voltar sem ter perdido batida, não consulta à toa", () => {
    const documento = documentoFalso();
    const tarefa = vi.fn();
    const parar = iniciarIntervaloVisivel(tarefa, 10_000, { documento });
    vi.advanceTimersByTime(2000);
    documento.mudar("hidden");
    documento.mudar("visible");
    expect(tarefa).not.toHaveBeenCalled();
    parar();
  });

  it("com sempreAoVoltar, toda volta relê", () => {
    const documento = documentoFalso();
    const tarefa = vi.fn();
    const parar = iniciarIntervaloVisivel(tarefa, 10_000, { documento, sempreAoVoltar: true });
    documento.mudar("hidden");
    documento.mudar("visible");
    expect(tarefa).toHaveBeenCalledTimes(1);
    parar();
  });

  it("parar desliga o relógio e para de ouvir a aba", () => {
    const documento = documentoFalso();
    const tarefa = vi.fn();
    const parar = iniciarIntervaloVisivel(tarefa, 1000, { documento });
    parar();
    documento.mudar("hidden");
    vi.advanceTimersByTime(5000);
    documento.mudar("visible");
    expect(vi.getTimerCount()).toBe(0);
    expect(tarefa).not.toHaveBeenCalled();
  });

  it("uma promessa recusada não escapa como erro solto", async () => {
    const tarefa = vi.fn().mockRejectedValue(new Error("rede"));
    const parar = iniciarIntervaloVisivel(tarefa, 1000, { documento: documentoFalso() });
    await vi.advanceTimersByTimeAsync(1000);
    expect(tarefa).toHaveBeenCalledTimes(1);
    parar();
  });
});

describe("useIntervaloVisivel", () => {
  let raiz;
  let palco;

  function Relogio({ tarefa, intervalo, ativo }) {
    useIntervaloVisivel(tarefa, intervalo, { ativo });
    return null;
  }

  const montar = (props) => act(() => raiz.render(<Relogio {...props} />));

  beforeEach(() => {
    vi.useFakeTimers();
    palco = document.createElement("div");
    raiz = createRoot(palco);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    vi.useRealTimers();
  });

  it("roda a tarefa mais recente sem recriar o relógio", () => {
    const primeira = vi.fn();
    const segunda = vi.fn();
    montar({ tarefa: primeira, intervalo: 1000 });
    montar({ tarefa: segunda, intervalo: 1000 });
    vi.advanceTimersByTime(1000);
    expect(primeira).not.toHaveBeenCalled();
    expect(segunda).toHaveBeenCalledTimes(1);
  });

  it("trocar a cadência vale a partir dali", () => {
    const tarefa = vi.fn();
    montar({ tarefa, intervalo: 1000 });
    vi.advanceTimersByTime(1000);
    montar({ tarefa, intervalo: 10_000 });
    vi.advanceTimersByTime(9000);
    expect(tarefa).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(tarefa).toHaveBeenCalledTimes(2);
  });

  it("desligado ou sem intervalo, não há relógio", () => {
    const tarefa = vi.fn();
    montar({ tarefa, intervalo: 1000, ativo: false });
    expect(vi.getTimerCount()).toBe(0);
    montar({ tarefa, intervalo: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("desmontar desliga", () => {
    const tarefa = vi.fn();
    montar({ tarefa, intervalo: 1000 });
    act(() => raiz.unmount());
    raiz = createRoot(palco);
    vi.advanceTimersByTime(5000);
    expect(tarefa).not.toHaveBeenCalled();
  });
});
