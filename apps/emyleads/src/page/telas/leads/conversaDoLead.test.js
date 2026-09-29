import { describe, expect, it } from "vitest";
import {
  SITUACOES,
  conversaDoContato,
  indiceDeConversas,
  situacaoDaConversa,
} from "./conversaDoLead";

const conversa = (dados) => ({ id: dados.telefone, grupo: false, ultimaMensagemEm: 1, saiu: false, ...dados });

describe("conversa do lead", () => {
  it("acha a conversa guardada sem o nono dígito a partir do número do formulário", () => {
    const indice = indiceDeConversas([conversa({ telefone: "556599775492" })]);
    expect(conversaDoContato(indice, { telefone: "5566999775492" })).toBeNull();
    expect(conversaDoContato(indice, { telefone: "5565999775492" })?.telefone).toBe("556599775492");
  });

  it("acha a conversa guardada com o nono dígito a partir do número sem ele", () => {
    const indice = indiceDeConversas([conversa({ telefone: "5565999775492" })]);
    expect(conversaDoContato(indice, { telefone: "(65) 9977-5492" })?.telefone).toBe("5565999775492");
  });

  it("fica com a conversa mais recente quando o número tem duas", () => {
    const indice = indiceDeConversas([
      conversa({ telefone: "556599775492", ultimaMensagemEm: 10 }),
      conversa({ telefone: "5565999775492", ultimaMensagemEm: 20 }),
    ]);
    expect(conversaDoContato(indice, { telefone: "5565999775492" })?.ultimaMensagemEm).toBe(20);
  });

  it("ignora grupo e contato sem telefone", () => {
    const indice = indiceDeConversas([conversa({ telefone: "120363404701403742", grupo: true })]);
    expect(conversaDoContato(indice, { telefone: "120363404701403742" })).toBeNull();
    expect(conversaDoContato(indice, { telefone: "" })).toBeNull();
  });

  it("diz quem falou por último", () => {
    expect(situacaoDaConversa(null)).toBe(SITUACOES.semConversa);
    expect(situacaoDaConversa(conversa({ telefone: "1", ultimaMensagemEm: 0 }))).toBe(SITUACOES.semConversa);
    expect(situacaoDaConversa(conversa({ telefone: "1", saiu: true }))).toBe(SITUACOES.aguardando);
    expect(situacaoDaConversa(conversa({ telefone: "1", saiu: false }))).toBe(SITUACOES.respondeu);
  });
});
