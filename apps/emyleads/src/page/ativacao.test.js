import { describe, expect, it } from "vitest";
import { ativacaoGuardada, esquecerAtivacao, lerAtivacaoDaUrl, linkDeRetorno, normalizarCodigo } from "./ativacao";

function janela(url, { semArmazenamento = false } = {}) {
  const endereco = new URL(url);
  const guardado = new Map();
  const substituicoes = [];
  return {
    location: { pathname: endereco.pathname, search: endereco.search, origin: endereco.origin },
    history: { replaceState: (_estado, _titulo, destino) => substituicoes.push(destino) },
    sessionStorage: semArmazenamento
      ? { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); }, removeItem() { throw new Error("bloqueado"); } }
      : {
        getItem: (chave) => guardado.get(chave) ?? null,
        setItem: (chave, valor) => guardado.set(chave, valor),
        removeItem: (chave) => guardado.delete(chave),
      },
    substituicoes,
  };
}

describe("ativação pelo link do e-mail", () => {
  it("normaliza o código em qualquer grafia e recusa o que não é código", () => {
    expect(normalizarCodigo("nm12 3456 7890 ab")).toBe("NM12-3456-7890-AB");
    expect(normalizarCodigo("NM1234567890AB")).toBe("NM12-3456-7890-AB");
    expect(normalizarCodigo("XX12-3456-7890-AB")).toBe("");
    expect(normalizarCodigo("")).toBe("");
  });

  it("lê o link, guarda na aba e limpa o endereço", () => {
    const w = janela("https://nucleomajor.com/app/ativar?codigo=nm12-3456-7890-ab&email=Pessoa%40Empresa.com");
    expect(lerAtivacaoDaUrl(w)).toEqual({ codigo: "NM12-3456-7890-AB", email: "pessoa@empresa.com" });
    expect(w.substituicoes).toEqual(["/app/"]);
    expect(ativacaoGuardada(w)).toEqual({ codigo: "NM12-3456-7890-AB", email: "pessoa@empresa.com" });
    esquecerAtivacao(w);
    expect(ativacaoGuardada(w)).toBeNull();
  });

  it("ignora outras rotas e códigos inválidos", () => {
    expect(lerAtivacaoDaUrl(janela("https://nucleomajor.com/app/conversas?codigo=NM12-3456-7890-AB"))).toBeNull();
    expect(lerAtivacaoDaUrl(janela("https://nucleomajor.com/app/ativar?codigo=abc"))).toBeNull();
    expect(lerAtivacaoDaUrl(null)).toBeNull();
  });

  it("sem armazenamento, o link ainda funciona nesta aba", () => {
    const w = janela("https://nucleomajor.com/app/ativar?codigo=NM12-3456-7890-AB", { semArmazenamento: true });
    expect(lerAtivacaoDaUrl(w)).toEqual({ codigo: "NM12-3456-7890-AB", email: "" });
    expect(ativacaoGuardada(w)).toBeNull();
    expect(() => esquecerAtivacao(w)).not.toThrow();
  });

  it("monta o retorno da confirmação de e-mail na mesma origem", () => {
    const w = janela("https://nucleomajor.com/app/");
    expect(linkDeRetorno({ codigo: "NM12-3456-7890-AB", email: "a@b.com" }, w))
      .toBe("https://nucleomajor.com/app/ativar?codigo=NM12-3456-7890-AB&email=a%40b.com");
    expect(linkDeRetorno(null, w)).toBe("");
  });
});
