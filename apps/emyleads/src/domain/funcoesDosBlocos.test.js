import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TIPOS_GATILHO, TIPOS_PASSO } from "./chatbots.js";
import {
  bloqueioDoFluxo,
  chaveDoBloco,
  funcaoDoBloco,
  funcoesDoFluxo,
  FUNCOES_DOS_BLOCOS,
  motivoDoCadeado,
  NOMES_DAS_FUNCOES,
} from "./funcoesDosBlocos.js";
import { TIPOS_CONDICAO } from "./regras.js";

const MIGRATION = new URL("../../../../supabase/migrations/20261018100000_cada_bloco_depende_do_plano.sql", import.meta.url);

const SO_CHATBOT = { chatbots: true };
const COM_IA = { chatbots: true, ai_customer: true };

const fluxo = (passos, extra = {}) => ({
  condicoes: [{ tipo: TIPOS_CONDICAO.primeiraConversa }],
  passos,
  canvas: { versao: 3, nos: [], conexoes: [] },
  ...extra,
});

describe("a lista única de funções dos blocos", () => {
  it("é a mesma que o banco grava em private.flow_block_requirements", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const trecho = sql.match(/select \$lista\$([\s\S]*?)\$lista\$::jsonb/);
    expect(trecho, "marcadores $lista$ na migration").not.toBeNull();
    expect(JSON.parse(trecho[1])).toEqual(JSON.parse(JSON.stringify(FUNCOES_DOS_BLOCOS)));
  });

  it("cobre todo tipo de bloco, de regra e de gatilho que o construtor conhece", () => {
    for (const tipo of Object.values(TIPOS_PASSO)) {
      if (tipo === TIPOS_PASSO.transferir) continue;
      expect(FUNCOES_DOS_BLOCOS.blocos[tipo], tipo).toBeTruthy();
    }
    expect(FUNCOES_DOS_BLOCOS.blocos["transferir:ia"]).toBe("ai_customer");
    expect(FUNCOES_DOS_BLOCOS.blocos["transferir:humano"]).toBe("chatbots");
    for (const tipo of Object.values(TIPOS_CONDICAO)) expect(FUNCOES_DOS_BLOCOS.regras[tipo], tipo).toBeTruthy();
    for (const tipo of Object.values(TIPOS_GATILHO)) expect(FUNCOES_DOS_BLOCOS.gatilhos[tipo], tipo).toBeTruthy();
  });

  it("só a transferência para a IA exige IA; o resto, só chatbots", () => {
    const todas = [
      ...Object.entries(FUNCOES_DOS_BLOCOS.blocos),
      ...Object.entries(FUNCOES_DOS_BLOCOS.regras),
      ...Object.entries(FUNCOES_DOS_BLOCOS.gatilhos),
    ];
    expect(todas.filter(([, funcao]) => funcao !== "chatbots")).toEqual([["transferir:ia", "ai_customer"]]);
  });

  it("toda função citada tem nome para o motivo do cadeado", () => {
    const citadas = new Set(Object.values(FUNCOES_DOS_BLOCOS).flatMap((grupo) => Object.values(grupo)));
    for (const funcao of citadas) expect(NOMES_DAS_FUNCOES[funcao], funcao).toBeTruthy();
  });
});

describe("o que cada bloco exige", () => {
  it("separa a transferência pelo destino", () => {
    expect(chaveDoBloco({ tipo: "transferir", destino: "ia" })).toBe("transferir:ia");
    expect(chaveDoBloco({ tipo: "transferir", destino: "humano" })).toBe("transferir:humano");
    // Sem destino é o padrão do editor (humano), como no banco.
    expect(chaveDoBloco({ tipo: "transferir" })).toBe("transferir:humano");
    expect(funcaoDoBloco({ tipo: "transferir", destino: "ia" })).toBe("ai_customer");
    expect(funcaoDoBloco({ tipo: "aguardar" })).toBe("chatbots");
    expect(funcaoDoBloco({ tipo: "desconhecido" })).toBeNull();
  });

  it("o motivo diz qual função falta, e some quando ela está liberada", () => {
    expect(motivoDoCadeado("ai_customer", SO_CHATBOT)).toMatch(/IA atendendo clientes/);
    expect(motivoDoCadeado("ai_customer", COM_IA)).toBeNull();
    // Só `true` explícito libera.
    expect(motivoDoCadeado("ai_customer", { ai_customer: "true" })).not.toBeNull();
    expect(motivoDoCadeado("chatbots", undefined)).not.toBeNull();
  });

  it("junta gatilho, regras de entrada, blocos e regras de condição, sem repetir", () => {
    const definicao = fluxo([
      { id: "c", tipo: "condicao", expressao: { operador: "e", itens: [{ tipo: "dia_da_semana", dias: [1] }] } },
      { id: "ia", tipo: "transferir", destino: "ia" },
    ], { gatilho: { tipo: "palavra", palavras: ["oi"] } });
    expect(funcoesDoFluxo(definicao)).toEqual(["chatbots", "ai_customer"]);
  });
});

describe("o que o banco diria ao salvar", () => {
  it("recusa a IA para quem só tem chatbot, e aceita com IA", () => {
    const definicao = fluxo([{ id: "ia", tipo: "transferir", destino: "ia", objetivoIa: "x" }]);
    expect(bloqueioDoFluxo(definicao, SO_CHATBOT)).toMatch(/IA atendendo clientes/);
    expect(bloqueioDoFluxo(definicao, COM_IA)).toBeNull();
  });

  it("aceita fluxo sem IA no plano só com chatbot", () => {
    expect(bloqueioDoFluxo(fluxo([{ id: "m", tipo: "enviar_mensagem", texto: "Oi" }]), SO_CHATBOT)).toBeNull();
  });

  it("sem chatbots, nada passa", () => {
    expect(bloqueioDoFluxo(fluxo([{ id: "m", tipo: "enviar_mensagem", texto: "Oi" }]), {})).toMatch(/Chatbots/);
  });

  it("o formato sem caminhos (v2) não é conferido aqui: segue no executor antigo", () => {
    const v2 = { ...fluxo([{ id: "ia", tipo: "transferir", destino: "ia" }]), canvas: { versao: 2, nos: [], conexoes: [] } };
    expect(bloqueioDoFluxo(v2, SO_CHATBOT)).toBeNull();
  });
});
