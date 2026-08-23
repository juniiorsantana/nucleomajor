import { describe, expect, it } from "vitest";
import {
  TIPOS_CONDICAO,
  avaliarCondicao,
  regraAtende,
  regrasAtendidas,
} from "./regras";
import { criarContato, criarNegocio, criarTarefa } from "./types";

const REGRA_SEMENTE_TESTE = [{
  id: "boas-vindas-primeira",
  nome: "Boas-vindas",
  ativo: true,
  condicoes: [{ tipo: TIPOS_CONDICAO.primeiraConversa }],
}];

const DIA_MS = 24 * 60 * 60 * 1000;
const AGORA = Date.parse("2026-08-12T12:00:00-03:00");

const contexto = (partial = {}) => ({
  contato: criarContato(),
  negocios: [],
  tarefas: [],
  notas: [],
  eventos: [],
  agora: AGORA,
  ...partial,
});

describe("avaliarCondicao — tem_etiqueta", () => {
  it("atende quando o contato tem a etiqueta", () => {
    const ctx = contexto({ contato: criarContato({ tags: ["lead-quente"] }) });
    expect(
      avaliarCondicao({ tipo: TIPOS_CONDICAO.temEtiqueta, etiquetaId: "lead-quente" }, ctx)
    ).toBe(true);
  });

  it("não atende sem a etiqueta, nem com tags vazio", () => {
    const semTag = contexto({ contato: criarContato({ tags: ["cliente"] }) });
    const vazio = contexto({ contato: criarContato({ tags: [] }) });
    expect(
      avaliarCondicao({ tipo: TIPOS_CONDICAO.temEtiqueta, etiquetaId: "lead-quente" }, semTag)
    ).toBe(false);
    expect(
      avaliarCondicao({ tipo: TIPOS_CONDICAO.temEtiqueta, etiquetaId: "lead-quente" }, vazio)
    ).toBe(false);
  });
});

describe("avaliarCondicao — estagio_atual", () => {
  it("atende quando o negócio aberto está no estágio", () => {
    const ctx = contexto({ negocios: [criarNegocio({ stageId: "proposta", status: "aberto" })] });
    expect(avaliarCondicao({ tipo: TIPOS_CONDICAO.estagioAtual, stageId: "proposta" }, ctx)).toBe(true);
  });

  it("não atende em outro estágio, nem sem negócio nenhum", () => {
    const outroEstagio = contexto({ negocios: [criarNegocio({ stageId: "contato", status: "aberto" })] });
    const semNegocio = contexto({ negocios: [] });
    expect(avaliarCondicao({ tipo: TIPOS_CONDICAO.estagioAtual, stageId: "proposta" }, outroEstagio)).toBe(false);
    expect(avaliarCondicao({ tipo: TIPOS_CONDICAO.estagioAtual, stageId: "proposta" }, semNegocio)).toBe(false);
  });
});

describe("avaliarCondicao — tarefa_atrasada", () => {
  it("atende com uma tarefa vencida e não concluída entre várias", () => {
    const ctx = contexto({
      tarefas: [
        criarTarefa({ venceEm: AGORA + DIA_MS, concluida: false }),
        criarTarefa({ venceEm: AGORA - DIA_MS, concluida: false }),
      ],
    });
    expect(avaliarCondicao({ tipo: TIPOS_CONDICAO.tarefaAtrasada }, ctx)).toBe(true);
  });

  it("não atende quando tudo concluído ou sem prazo", () => {
    const ctx = contexto({
      tarefas: [
        criarTarefa({ venceEm: AGORA - DIA_MS, concluida: true }),
        criarTarefa({ venceEm: null, concluida: false }),
      ],
    });
    expect(avaliarCondicao({ tipo: TIPOS_CONDICAO.tarefaAtrasada }, ctx)).toBe(false);
  });
});

describe("avaliarCondicao — sem_interacao_ha", () => {
  it("atende quando o intervalo já estourou, usando ultimaEm", () => {
    const ctx = contexto({ contato: criarContato({ ultimaEm: AGORA - 5 * DIA_MS }) });
    expect(avaliarCondicao({ tipo: TIPOS_CONDICAO.semInteracaoHa, dias: 5 }, ctx)).toBe(true);
  });

  it("não atende um instante antes do limite", () => {
    const ctx = contexto({ contato: criarContato({ ultimaEm: AGORA - 5 * DIA_MS + 1 }) });
    expect(avaliarCondicao({ tipo: TIPOS_CONDICAO.semInteracaoHa, dias: 5 }, ctx)).toBe(false);
  });

  it("cai para atualizadoEm/criadoEm quando ultimaEm é nulo", () => {
    const ctx = contexto({
      contato: criarContato({ ultimaEm: null, atualizadoEm: AGORA - 10 * DIA_MS }),
    });
    expect(avaliarCondicao({ tipo: TIPOS_CONDICAO.semInteracaoHa, dias: 5 }, ctx)).toBe(true);
  });
});

describe("avaliarCondicao — primeira_conversa", () => {
  it("atende com só eventos de identidade", () => {
    const ctx = contexto({ eventos: [{ tipo: "contact.created" }, { tipo: "contact.imported" }] });
    expect(avaliarCondicao({ tipo: TIPOS_CONDICAO.primeiraConversa }, ctx)).toBe(true);
  });

  it("não atende assim que há um evento de negócio, tarefa ou nota", () => {
    const ctx = contexto({ eventos: [{ tipo: "contact.created" }, { tipo: "note.created" }] });
    expect(avaliarCondicao({ tipo: TIPOS_CONDICAO.primeiraConversa }, ctx)).toBe(false);
  });

  it("não atende sem nenhum evento", () => {
    expect(avaliarCondicao({ tipo: TIPOS_CONDICAO.primeiraConversa }, contexto({ eventos: [] }))).toBe(false);
  });
});

describe("regraAtende / regrasAtendidas", () => {
  const regraDupla = {
    id: "r1",
    nome: "Etiqueta + estágio",
    ativo: true,
    condicoes: [
      { tipo: TIPOS_CONDICAO.temEtiqueta, etiquetaId: "lead-quente" },
      { tipo: TIPOS_CONDICAO.estagioAtual, stageId: "proposta" },
    ],
    mensagem: "oi",
  };

  it("exige todas as condições (E implícito)", () => {
    const so1 = contexto({
      contato: criarContato({ tags: ["lead-quente"] }),
      negocios: [criarNegocio({ stageId: "contato", status: "aberto" })],
    });
    const ambas = contexto({
      contato: criarContato({ tags: ["lead-quente"] }),
      negocios: [criarNegocio({ stageId: "proposta", status: "aberto" })],
    });
    expect(regraAtende(regraDupla, so1)).toBe(false);
    expect(regraAtende(regraDupla, ambas)).toBe(true);
  });

  it("regra inativa nunca aparece, mesmo atendendo às condições", () => {
    const ctx = contexto({
      contato: criarContato({ tags: ["lead-quente"] }),
      negocios: [criarNegocio({ stageId: "proposta", status: "aberto" })],
    });
    const inativa = { ...regraDupla, ativo: false };
    expect(regrasAtendidas([inativa], ctx)).toEqual([]);
    expect(regrasAtendidas([regraDupla], ctx)).toEqual([regraDupla]);
  });
});

describe("REGRAS_PADRAO", () => {
  it("a regra de boas-vindas dispara só na primeira conversa", () => {
    const primeira = contexto({ eventos: [{ tipo: "contact.created" }] });
    const jaAtendida = contexto({ eventos: [{ tipo: "contact.created" }, { tipo: "task.created" }] });
    expect(regrasAtendidas(REGRA_SEMENTE_TESTE, primeira).map((r) => r.id)).toContain("boas-vindas-primeira");
    expect(regrasAtendidas(REGRA_SEMENTE_TESTE, jaAtendida).map((r) => r.id)).not.toContain("boas-vindas-primeira");
  });
});
