import { describe, expect, it } from "vitest";
import { CORES_DE_PESSOA, corDaPessoa, nomeCompleto, nomeCurto } from "./perfil";

/** Luminância relativa e contraste do WCAG, para checar a paleta contra o branco. */
function contrasteComBranco(hex) {
  const canais = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  const luminancia = 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
  return 1.05 / (luminancia + 0.05);
}

describe("paleta de pessoa", () => {
  it("toda cor sustenta as iniciais brancas por cima", () => {
    // Avatar colorido escreve a inicial em branco (ver `Iniciais`). Cor que não
    // alcança 4.5:1 vira um borrão onde deveria estar o rosto de alguém — foi
    // o caso do verde `#16a34a`, que media 3.30 e saiu daqui por isso.
    for (const cor of CORES_DE_PESSOA) {
      expect(contrasteComBranco(cor), `${cor} tem contraste baixo demais`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("não reaproveita o verde de sucesso, que diria 'deu certo' em vez de um nome", () => {
    expect(CORES_DE_PESSOA).not.toContain("#16a34a");
  });

  it("não repete cor, porque cor repetida não distingue ninguém", () => {
    expect(new Set(CORES_DE_PESSOA).size).toBe(CORES_DE_PESSOA.length);
  });
});

describe("cor da pessoa", () => {
  it("usa a cor escolhida, normalizada", () => {
    expect(corDaPessoa({ id: "a", color: "#0369A1" })).toBe("#0369a1");
  });

  it("deriva do id quando ninguém escolheu", () => {
    const cor = corDaPessoa({ id: "user-1" });
    expect(CORES_DE_PESSOA).toContain(cor);
  });

  it("deriva a mesma cor para o mesmo id, sempre", () => {
    expect(corDaPessoa({ id: "user-1" })).toBe(corDaPessoa({ id: "user-1" }));
  });

  it("nunca deriva o cinza, que leria como desativado", () => {
    const cinza = CORES_DE_PESSOA[CORES_DE_PESSOA.length - 1];
    const derivadas = new Set();
    for (let i = 0; i < 400; i++) derivadas.add(corDaPessoa({ id: `user-${i}` }));
    expect(derivadas.has(cinza)).toBe(false);
    // A derivação distribui: 400 ids não podem cair todos na mesma cor.
    expect(derivadas.size).toBeGreaterThan(4);
  });

  it("aceita o cinza quando é escolha explícita", () => {
    expect(corDaPessoa({ id: "a", color: "#667085" })).toBe("#667085");
  });

  it("ignora cor malformada em vez de pintar com lixo", () => {
    expect(CORES_DE_PESSOA).toContain(corDaPessoa({ id: "a", color: "azul" }));
    expect(CORES_DE_PESSOA).toContain(corDaPessoa({ id: "a", color: "#12345" }));
  });
});

describe("nome curto", () => {
  it("prefere o escolhido", () => {
    expect(nomeCurto({ display_name: "Jr", full_name: "Júnior Nemes Teibel" })).toBe("Jr");
  });

  it("cai para o primeiro nome quando ninguém escolheu", () => {
    expect(nomeCurto({ full_name: "Júnior Nemes Teibel" })).toBe("Júnior");
  });

  it("preserva acento e hífen do primeiro nome", () => {
    expect(nomeCurto({ full_name: "Ana-Lúcia Muniz" })).toBe("Ana-Lúcia");
  });

  it("não devolve o pedaço de um e-mail como se fosse nome", () => {
    // Quem entra por convite pode ficar com o e-mail no lugar do nome; o
    // primeiro "nome" de "junior@majorhub.com" não serve para cartão nenhum.
    expect(nomeCurto({ full_name: "junior@majorhub.com" })).toBe("junior@majorhub.com");
  });

  it("usa o texto do vazio quando não há nada", () => {
    expect(nomeCurto({}, "Você")).toBe("Você");
    expect(nomeCurto(null, "Você")).toBe("Você");
  });

  it("ignora espaço em branco disfarçado de escolha", () => {
    expect(nomeCurto({ display_name: "   ", full_name: "Lucas Prado" })).toBe("Lucas");
  });
});

describe("nome completo", () => {
  it("devolve o do perfil", () => {
    expect(nomeCompleto({ full_name: "Aline Souza" })).toBe("Aline Souza");
  });

  it("avisa quando o perfil está vazio em vez de mostrar nada", () => {
    expect(nomeCompleto({})).toBe("Sem nome no perfil");
  });
});
