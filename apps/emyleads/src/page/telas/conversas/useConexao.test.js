import { describe, expect, it } from "vitest";
import { FASES } from "../conexoes/estadoDaConexao";
import {
  CADENCIA_LENTA_MS,
  CADENCIA_MEDIA_MS,
  CADENCIA_RAPIDA_MS,
  cadenciaDaConexao,
} from "./useConexao";

describe("cadenciaDaConexao", () => {
  it("rápida com o modal do QR aberto, seja qual for o estado", () => {
    expect(cadenciaDaConexao({ atento: true, resumo: { fase: FASES.CONECTADO } })).toBe(CADENCIA_RAPIDA_MS);
  });

  it("rápida enquanto a VPS diz que está pareando", () => {
    expect(cadenciaDaConexao({ resumo: { fase: FASES.PAREANDO } })).toBe(CADENCIA_RAPIDA_MS);
  });

  it("lenta quando está conectada", () => {
    expect(cadenciaDaConexao({ resumo: { fase: FASES.CONECTADO } })).toBe(CADENCIA_LENTA_MS);
  });

  it("média quando não há conexão ou ela não está bem: a empresa sem WhatsApp não fica nos 6 s", () => {
    expect(cadenciaDaConexao({ resumo: null })).toBe(CADENCIA_MEDIA_MS);
    for (const fase of [FASES.DESCONECTADO, FASES.RUNTIME_PARADO, FASES.PREPARANDO, FASES.DIVERGENTE]) {
      expect(cadenciaDaConexao({ resumo: { fase } })).toBe(CADENCIA_MEDIA_MS);
    }
  });
});
