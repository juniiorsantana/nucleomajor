import { describe, expect, it } from "vitest";
import { indiceDeConversas } from "../leads/conversaDoLead";
import { fluxoDaCampanha, resumoDaCampanha, textoDaPrimeiraMensagem } from "./resumoDaCampanha";

const AGORA = Date.UTC(2026, 8, 28, 12);
const DIA = 24 * 60 * 60 * 1000;

const campanha = {
  id: "camp-1",
  leads: [
    { contactId: "a", telefone: "5565999990001", chegouEm: AGORA - DIA },
    { contactId: "b", telefone: "5565999990002", chegouEm: AGORA - 2 * DIA },
    { contactId: "c", telefone: "5565999990003", chegouEm: AGORA - 10 * DIA },
    { contactId: "apagado", telefone: "5565999990004", chegouEm: AGORA - DIA },
  ],
};
const contatos = [
  { id: "a", nome: "Ana", telefone: "5565999990001" },
  { id: "b", nome: "Bia", telefone: "5565999990002" },
  { id: "c", nome: "Caio", telefone: "5565999990003" },
];
// Ana respondeu (a última é dela), Bia está esperando a equipe falar e a
// conversa da Bia está guardada sem o nono dígito, como o WhatsApp faz.
const indice = indiceDeConversas([
  { id: "1", telefone: "5565999990001", ultimaMensagemEm: AGORA, saiu: false },
  { id: "2", telefone: "556599990002", ultimaMensagemEm: AGORA, saiu: true },
]);

describe("resumo da campanha", () => {
  it("conta leads, semana e situação da conversa pela mesma lista", () => {
    const resumo = resumoDaCampanha(campanha, contatos, indice, AGORA);
    expect(resumo.total).toBe(4);
    expect(resumo.nestaSemana).toBe(3);
    expect(resumo.respondeu).toBe(1);
    expect(resumo.aguardando).toBe(1);
    expect(resumo.semConversa).toBe(2);
    expect(resumo.respondeu + resumo.aguardando + resumo.semConversa).toBe(resumo.total);
  });

  it("mantém o lead cujo contato foi apagado, só com o telefone", () => {
    const { linhas } = resumoDaCampanha(campanha, contatos, indice, AGORA);
    const apagado = linhas.find((linha) => linha.lead.contactId === "apagado");
    expect(apagado.contato).toEqual({ id: null, nome: "", telefone: "5565999990004" });
  });

  it("acha o fluxo ativo da campanha e a primeira mensagem dele", () => {
    const chatbots = [
      { id: "x", ativo: false, gatilho: { tipo: "campanha", campanhaId: "camp-1" }, passos: [] },
      { id: "y", ativo: true, gatilho: { tipo: "campanha", campanhaId: "outra" }, passos: [] },
      {
        id: "z",
        ativo: true,
        gatilho: { tipo: "campanha", campanhaId: "camp-1" },
        passos: [{ tipo: "enviar_mensagem", texto: "Oi, {nome}!" }],
      },
    ];
    const fluxo = fluxoDaCampanha(chatbots, "camp-1");
    expect(fluxo.id).toBe("z");
    expect(textoDaPrimeiraMensagem(fluxo)).toBe("Oi, {nome}!");
    expect(fluxoDaCampanha(chatbots, "sem-fluxo")).toBeNull();
  });
});
