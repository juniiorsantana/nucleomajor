import { describe, expect, it } from "vitest";
import { variantesBR } from "../../../lib/phone";
import { conexaoDaLista, conversaDoTelefone } from "./conversasUtils";

/**
 * As regras de "nova conversa" que não dependem de React.
 *
 * Mesmo motivo do resto de `conversasUtils`: este projeto não tem jsdom, então
 * efeito de hook não roda em teste. O que dá para prender é a decisão, e as
 * duas que importam aqui são as que produzem estrago silencioso quando erram —
 * uma conversa duplicada com o próprio cliente, ou uma conexão adivinhada.
 */

const conversa = (id, telefone, extras = {}) => ({
  id,
  telefone,
  grupo: false,
  ...extras,
});

const CONEXAO = "0f2a1b6c-9d3e-4f18-a5c7-2b8e6d4a1c90";

describe("conexaoDaLista", () => {
  it("tira a conexão da primeira conversa espelhada", () => {
    const lista = [conversa(`${CONEXAO}:5511987654321`, "5511987654321")];
    expect(conexaoDaLista(lista)).toBe(CONEXAO);
  });

  it("devolve null na bancada, cujos ids são de contato", () => {
    // Não é falha: `null` faz a RPC resolver a conexão sozinha quando a empresa
    // só tem uma, e recusar com motivo próprio quando tem mais de uma.
    // Adivinhar aqui seria escolher por qual WhatsApp a empresa fala.
    expect(conexaoDaLista([conversa("contato-1", "5511987654321")])).toBeNull();
  });

  it("devolve null com a caixa de entrada vazia", () => {
    expect(conexaoDaLista([])).toBeNull();
    expect(conexaoDaLista(null)).toBeNull();
  });

  it("pula o que não tem conexão até achar quem tem", () => {
    const lista = [
      conversa("contato-1", "5511987654321"),
      conversa(`${CONEXAO}:5521999998888`, "5521999998888"),
    ];
    expect(conexaoDaLista(lista)).toBe(CONEXAO);
  });

  /**
   * Com duas conexões, a tela não escolhe.
   *
   * A lista vem ordenada por quem falou por último. Devolver a primeira
   * escolheria por qual número da empresa o cliente será abordado com base em
   * quem mandou mensagem hoje de manhã — e o resultado mudaria sozinho ao
   * longo do dia. `null` faz o banco recusar com uma instrução.
   */
  it("com duas conexões devolve null, para o banco recusar", () => {
    const outra = "9c1e77aa-1111-4222-8333-444455556666";
    const lista = [
      conversa(`${CONEXAO}:5511987654321`, "5511987654321"),
      conversa(`${outra}:5521999998888`, "5521999998888"),
    ];
    expect(conexaoDaLista(lista)).toBeNull();
  });
});

describe("conversaDoTelefone", () => {
  /**
   * O teste que justifica a função existir.
   *
   * O nono dígito é a maior fonte de falso negativo num CRM de WhatsApp
   * brasileiro. Sem o casamento por variantes, quem digitasse o número do
   * próprio cliente — salvo no CRM sem o 9 — ganharia uma SEGUNDA conversa com
   * ele, e as duas apareceriam lado a lado na lista com o mesmo nome.
   */
  it("acha a conversa mesmo quando o nono dígito difere", () => {
    const lista = [conversa(`${CONEXAO}:5511987654321`, "5511987654321")];
    const achada = conversaDoTelefone(lista, variantesBR("551187654321"), variantesBR);
    expect(achada?.id).toBe(`${CONEXAO}:5511987654321`);
  });

  it("acha pelo número escrito com pontuação", () => {
    // A bancada monta a lista a partir do CRM, onde o telefone pode estar
    // gravado com parênteses. Normalizar um lado só faria a bancada nunca
    // reconhecer a própria conversa.
    const lista = [conversa("contato-1", "(11) 98765-4321")];
    const achada = conversaDoTelefone(lista, variantesBR("5511987654321"), variantesBR);
    expect(achada?.id).toBe("contato-1");
  });

  it("número novo não casa com ninguém", () => {
    const lista = [conversa(`${CONEXAO}:5511987654321`, "5511987654321")];
    expect(conversaDoTelefone(lista, variantesBR("5565992178164"), variantesBR)).toBeNull();
  });

  /**
   * Grupo fica de fora, e não por elegância.
   *
   * O identificador de um grupo mora no MESMO campo do telefone e tem dezoito
   * dígitos. Deixá-lo entrar acharia um grupo por coincidência de dígitos, e a
   * tela abriria a conversa do time achando que abriu a do cliente.
   */
  it("não confunde grupo com telefone", () => {
    const lista = [
      { id: `${CONEXAO}:120363001122334455`, telefone: "", grupo: true },
      { id: `${CONEXAO}:5511987654321`, telefone: "5511987654321", grupo: false },
    ];
    const achada = conversaDoTelefone(lista, variantesBR("120363001122334455"), variantesBR);
    expect(achada).toBeNull();
  });

  it("telefone vazio não vira busca", () => {
    const lista = [conversa(`${CONEXAO}:5511987654321`, "5511987654321")];
    expect(conversaDoTelefone(lista, variantesBR(""), variantesBR)).toBeNull();
    expect(conversaDoTelefone(lista, [], variantesBR)).toBeNull();
  });
});
