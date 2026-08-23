import { describe, expect, it } from "vitest";
import {
  OPCOES_DE_PAPEL,
  podeGerenciarEquipe,
  podeMudarPapel,
  podeRemover,
  textoDoPapel,
} from "./papeis";

const membro = (partial = {}) => ({ user_id: "u1", role: "member", status: "active", ...partial });

describe("quem gerencia a equipe", () => {
  it("dono e administrador convidam e removem", () => {
    // Espelha `private.can_manage_org`: role in ('owner', 'admin').
    expect(podeGerenciarEquipe("owner")).toBe(true);
    expect(podeGerenciarEquipe("admin")).toBe(true);
  });

  it("atendente não gerencia", () => {
    expect(podeGerenciarEquipe("member")).toBe(false);
    expect(podeGerenciarEquipe(undefined)).toBe(false);
  });
});

describe("quem muda papel", () => {
  it("só o dono", () => {
    // `change_organization_member_role` recusa admin com
    // "owner permission required" — é mais restrito que convidar de propósito.
    expect(podeMudarPapel("owner")).toBe(true);
    expect(podeMudarPapel("admin")).toBe(false);
    expect(podeMudarPapel("member")).toBe(false);
  });

  it("dono não é oferecido como destino", () => {
    // A função recusa promover outro a dono: transferir a organização é outro
    // fluxo, que ainda não existe.
    expect(OPCOES_DE_PAPEL.map((o) => o.id)).toEqual(["member", "admin"]);
  });
});

describe("quem pode ser removido", () => {
  it("dono e admin removem um atendente", () => {
    expect(podeRemover("owner", membro(), "eu")).toBe(true);
    expect(podeRemover("admin", membro(), "eu")).toBe(true);
  });

  it("atendente não remove ninguém", () => {
    expect(podeRemover("member", membro(), "eu")).toBe(false);
  });

  it("o dono nunca é removível", () => {
    // O `delete` filtra `role <> 'owner'`: remover um dono não dá erro, só não
    // apaga nada. Oferecer o botão mostraria sucesso sem ter feito nada, que é
    // pior que recusar.
    expect(podeRemover("owner", membro({ user_id: "outro", role: "owner" }), "eu")).toBe(false);
    expect(podeRemover("admin", membro({ user_id: "outro", role: "owner" }), "eu")).toBe(false);
  });

  it("o dono não se remove", () => {
    expect(podeRemover("owner", membro({ user_id: "eu", role: "owner" }), "eu")).toBe(false);
  });

  it("um admin pode sair sozinho", () => {
    // A função só barra auto-remoção quando quem pede é dono; admin saindo da
    // própria equipe é permitido pelo banco.
    expect(podeRemover("admin", membro({ user_id: "eu", role: "admin" }), "eu")).toBe(true);
  });
});

describe("nomes em português", () => {
  it("traduz os três papéis", () => {
    expect(textoDoPapel("owner")).toBe("Dono");
    expect(textoDoPapel("admin")).toBe("Administrador");
    expect(textoDoPapel("member")).toBe("Atendente");
  });

  it("não engole um papel desconhecido", () => {
    expect(textoDoPapel("supervisor")).toBe("supervisor");
    expect(textoDoPapel(null)).toBe("—");
  });
});
