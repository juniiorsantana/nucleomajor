import { describe, expect, it } from "vitest";
import { mesmaConversa, textoDaTransferencia } from "./conversasUtils";

const msg = (texto, extra = {}) => ({
  tipo: "mensagem",
  direcao: "entra",
  hora: "09:41",
  texto,
  lido: false,
  ...extra,
});

describe("mesmaConversa", () => {
  it("reconhece a mesma conversa recarregada, para a tela não se mexer à toa", () => {
    // É o caso comum: a conversa aberta recarrega a cada 20 segundos e a cada
    // aviso do realtime, e quase sempre nada mudou. Trocar o estado aqui
    // rolaria a conversa até o fim por cima de quem está lendo o histórico.
    const antes = [msg("oi"), msg("tudo bem?")];
    const depois = [msg("oi"), msg("tudo bem?")];
    expect(mesmaConversa(antes, depois)).toBe(true);
  });

  it("vê a mensagem nova que chegou no fim", () => {
    const antes = [msg("oi")];
    expect(mesmaConversa(antes, [msg("oi"), msg("ainda está aí?")])).toBe(false);
  });

  it("vê a mensagem que saiu daqui voltar do aparelho", () => {
    // A bolha provisória NÃO entra nesta comparação: ela vive fora da lista do
    // espelho e só é mesclada na hora de desenhar. O que esta função compara
    // são duas fotos do espelho, e o que muda quando a mensagem enviada volta é
    // o tamanho da lista. É esse `false` que troca o relógio pelo tique — sem
    // ele, a bolha ficava com o relógio para sempre, que foi o defeito
    // relatado em 03/09/2026.
    const antes = [msg("oi")];
    const depois = [msg("oi"), msg("Bom dia!", { direcao: "sai" })];
    expect(mesmaConversa(antes, depois)).toBe(false);
  });

  it("vê a confirmação de leitura mudar sem mudar o texto", () => {
    const antes = [msg("oi", { direcao: "sai", lido: false })];
    const depois = [msg("oi", { direcao: "sai", lido: true })];
    expect(mesmaConversa(antes, depois)).toBe(false);
  });

  it("duas conversas vazias são iguais, e a primeira carga não é", () => {
    expect(mesmaConversa([], [])).toBe(true);
    // `null` é o estado antes da primeira carga: precisa deixar passar, senão a
    // conversa nunca aparece.
    expect(mesmaConversa(null, [msg("oi")])).toBe(false);
  });
});

describe("textoDaTransferencia", () => {
  it("diz o nome de quem assumiu, e não o cargo", () => {
    // "Atendente" serve igual para as duas pessoas de uma equipe de duas, e é
    // justamente quem assumiu que quem olha precisa saber.
    expect(textoDaTransferencia("humano", "Júnior")).toBe("Transferido para Júnior");
  });

  it("sem nome, diz o que de fato aconteceu", () => {
    // Um fluxo que pede gente sem saber quem tirou os automatismos e não
    // definiu dono. Inventar um nome aqui seria mentir sobre quem responde.
    expect(textoDaTransferencia("humano", "")).toBe("Transferido para atendimento humano");
    expect(textoDaTransferencia("humano", "   ")).toBe("Transferido para atendimento humano");
  });

  it("separa os dois automatismos pelo nome próprio", () => {
    // Foi a confusão entre robô e IA que já fez um contato receber duas
    // respostas para a mesma mensagem.
    expect(textoDaTransferencia("ia")).toBe("Transferido para o Agente de IA");
    expect(textoDaTransferencia("bot")).toBe("Devolvido ao Robô do CRM");
  });
});
