import { describe, expect, it } from "vitest";
import {
  contaDoVendedor,
  ehAnaliseV2,
  ehRelatorioV2,
  faixaDaNota,
  pontosEmOrdem,
  pontosEmTexto,
  resumoDoVendedorParaCopiar,
  rotuloDoPonto,
  velocidadeEmTexto,
  duracaoUtil,
  linhaDoVendedor,
  vendedorEmTexto,
} from "./vendedorV2.js";

const p = (key, weight, status, points, state) => ({ key, weight, status, points_awarded: points, state });

describe("vendedorV2", () => {
  it("reconhece o formato da v2", () => {
    expect(ehRelatorioV2({ schema_version: "analysis_report.v2" })).toBe(true);
    expect(ehRelatorioV2({ schema_version: "analysis_report.v1" })).toBe(false);
    expect(ehAnaliseV2({ schema_version: "analysis.v2" })).toBe(true);
    expect(ehAnaliseV2(null)).toBe(false);
  });

  it("faixa só com nota conclusiva", () => {
    expect(faixaDaNota({ score: 45, conclusive: true, band: "atrapalhou" })).toMatchObject({ rotulo: "Atrapalhou a venda", tom: "danger" });
    expect(faixaDaNota({ score: 60, conclusive: true, band: "nao_fecha" })).toMatchObject({ rotulo: "Atende, mas não fecha", tom: "warning" });
    expect(faixaDaNota({ score: 90, conclusive: true, band: "vendeu_bem" })).toMatchObject({ rotulo: "Vendeu bem", tom: "success" });
    expect(faixaDaNota({ score: 90, conclusive: false, band: "vendeu_bem" })).toMatchObject({ rotulo: "Não conclusiva", conclusiva: false });
    expect(faixaDaNota(null).rotulo).toBe("Ainda não avaliável");
  });

  it("ordem: mais perdido primeiro, não avaliados no fim", () => {
    const ordem = pontosEmOrdem([
      p("speed", 8, "bom", 8), p("close", 12, "nao_avaliado", null), p("advance", 16, "critico", 0),
      p("diagnosis", 14, "atencao", 8.4), p("objection", 12, "ruim", 2.4), p("empathy", 8, "nao_avaliado", null),
    ]).map((x) => x.key);
    expect(ordem).toEqual(["advance", "objection", "diagnosis", "speed", "close", "empathy"]);
  });

  it("rótulos e pontos, sem zero para quem não foi avaliado", () => {
    expect(rotuloDoPonto(p("advance", 16, "critico", 0, "continuacao"))).toBe("Ficou em aberto");
    expect(rotuloDoPonto(p("advance", 16, "bom", 16, "compromisso_com_data"))).toBe("Avançou com data");
    expect(rotuloDoPonto(p("promises", 8, "ruim", 1.6, "vencida_sem_entrega"))).toBe("Não cumpriu");
    expect(rotuloDoPonto(p("diagnosis", 14, "atencao", 8.4))).toBe("Atenção");
    expect(rotuloDoPonto(p("close", 12, "nao_avaliado", null))).toBe("Não avaliado");
    expect(pontosEmTexto(p("diagnosis", 14, "atencao", 8.4))).toBe("8,4 / 14");
    expect(pontosEmTexto(p("close", 12, "nao_avaliado", null))).toBe("—");
    expect(contaDoVendedor({ score: 45, evaluated_weight: 88, criteria: [p("a", 16, "critico", 0), p("b", 14, "atencao", 8.4), p("c", 8, "bom", 8)] }).texto).toBe("16,4 ÷ 88 = 45");
  });

  it("quem atendeu e a velocidade", () => {
    expect(vendedorEmTexto({ kind: "equipe", label: "Equipe · pelo celular" }).nome).toBe("Equipe · pelo celular");
    expect(vendedorEmTexto({ kind: "pessoa", label: "Ana" })).toEqual({ nome: "Ana", nota: "" });
    expect(vendedorEmTexto({ kind: "ia", label: "IA" }).nome).toBe("IA");
    expect(vendedorEmTexto(null).nome).toBe("Sem resposta da empresa");
    expect(velocidadeEmTexto({ firstResponseBusinessMinutes: 12 })).toBe("Primeira resposta em 12 min de horário comercial.");
    expect(velocidadeEmTexto({ firstResponseBusinessMinutes: 0 })).toBe("Primeira resposta em menos de 1 minuto.");
    expect(velocidadeEmTexto({ firstResponseBusinessMinutes: null, waitingBusinessMinutes: 330, state: "critico" })).toBe("O cliente espera a primeira resposta há 5 h 30 min de horário comercial.");
    expect(velocidadeEmTexto({ firstResponseBusinessMinutes: 720, state: "critico" })).toBe("Primeira resposta em 12 h de horário comercial.");
    // Análises de antes de 20261009100000: 241 era o teto, não o tempo.
    expect(velocidadeEmTexto({ firstResponseBusinessMinutes: 241, state: "critico" })).toBe("Primeira resposta depois de mais de 4 h de horário comercial.");
    expect(velocidadeEmTexto({ waitingBusinessMinutes: 241, state: "critico" })).toContain("há mais de 4 h");
    expect([duracaoUtil(0), duracaoUtil(59), duracaoUtil(60), duracaoUtil(125)]).toEqual(["0 min", "59 min", "1 h", "2 h 5 min"]);
  });

  it("resumo para copiar", () => {
    const texto = resumoDoVendedorParaCopiar({
      nome: "Rodrigo",
      relatorio: {
        seller: { kind: "equipe", label: "Equipe · pelo celular" },
        vendedor_score: { score: 45, coverage: 88, conclusive: true, band: "atrapalhou" },
        diagnosis: {
          verdict: "Deixou o cliente sem caminho (#3).",
          did_well: [{ title: "Respondeu rápido" }],
          cost_the_sale: [{ title: "Aceitou a objeção" }],
          what_to_do_now: [{ title: "Retomar com o casal" }],
        },
      },
    });
    expect(texto).toBe([
      "Avaliação do vendedor · Rodrigo",
      "Nota: 45/100 · Atrapalhou a venda · 88% avaliado",
      "Quem atendeu: Equipe · pelo celular",
      "",
      "Deixou o cliente sem caminho.",
      "",
      "O que fez bem:",
      "+ Respondeu rápido",
      "",
      "O que custou a venda:",
      "- Aceitou a objeção",
      "",
      "O que fazer agora: Retomar com o casal",
    ].join("\n"));
  });

  it("linha do tempo: legenda só no que custou a venda, no gargalo e nos alertas", () => {
    const timeline = { until: "x", messages: ["m1", "m2", "m3", "m4", "m5"].map((id) => ({ id, snippet: "texto " + id })) };
    const linha = linhaDoVendedor(timeline, {
      cost_the_sale: [{ evidence_message_ids: ["m2"] }],
      did_well: [{ evidence_message_ids: ["m1"] }],
      main_bottleneck: { evidence_message_ids: ["m3"] },
    }, [{ evidence_message_ids: ["m4"] }]);
    expect(linha.messages.filter((m) => m.snippet).map((m) => m.id)).toEqual(["m2", "m3", "m4"]);
    expect(linhaDoVendedor(null, {})).toBeNull();
  });
});
