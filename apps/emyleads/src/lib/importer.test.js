import { describe, expect, it } from "vitest";
import {
  detectarMapeamento,
  linhasParaContatos,
  parseDelimitado,
} from "./importer";

describe("importer", () => {
  it("lê CSV com cabeçalho, nome, empresa e telefone", () => {
    const linhas = parseDelimitado(
      'Nome,Empresa,Telefone\nMaria Silva,Major Hub,"(65) 99217-8164"'
    );
    const mapeamento = detectarMapeamento(linhas);
    expect(linhasParaContatos(linhas, mapeamento)).toEqual([
      {
        nome: "Maria Silva",
        empresa: "Major Hub",
        telefone: "(65) 99217-8164",
      },
    ]);
  });

  it("detecta telefone mesmo quando a planilha não tem cabeçalho", () => {
    const linhas = parseDelimitado("Maria Silva\t(65) 99217-8164\nJoão\t(65) 98888-1111");
    const mapeamento = detectarMapeamento(linhas);
    expect(mapeamento.temCabecalho).toBe(false);
    expect(mapeamento.telefone).toBe(1);
    expect(linhasParaContatos(linhas, mapeamento)[0].telefone).toBe(
      "(65) 99217-8164"
    );
  });
});
