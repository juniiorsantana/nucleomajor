import { describe, expect, it } from "vitest";
import {
  analiseDoBanco,
  contaDaNota,
  criteriosEmOrdem,
  duracaoEmTexto,
  etapasDaConversa,
  faixaDosPontos,
  linhaDoTempo,
  momentosDaConversa,
  motivoDoCriterio,
  periodoDaLinha,
  prazoEmTexto,
  resumoParaCopiar,
  rotuloDoCriterio,
} from "./analiseDaConversa";

const crit = (key, weight, status, points, extra = {}) => ({ key, weight, status, points_awarded: points, ...extra });
// O exemplo do desenho: 45 pontos de 80 avaliados = 56.
const CRITERIOS = [
  crit("responsiveness", 10, "nao_avaliado", null),
  crit("discovery", 15, "atencao", 9),
  crit("conversation_coherence", 15, "bom", 15),
  crit("communication_adaptation", 10, "bom", 10),
  crit("qualification", 10, "ruim", 2),
  crit("playbook_adherence", 15, "atencao", 9, { reason: "Preço antes da descoberta (#4)." }),
  crit("next_step", 15, "critico", 0, { state: "ficou_em_aberto" }),
  crit("follow_up", 10, "nao_avaliado", null, { state: "not_due" }),
  crit("objection_handling", 0, "bom", 0),
];

describe("os critérios na tela", () => {
  it("ordem: quem mais perdeu primeiro, não avaliados no fim, peso zero fora", () => {
    expect(criteriosEmOrdem(CRITERIOS).map((c) => c.key)).toEqual([
      "next_step", "qualification", "discovery", "playbook_adherence", "conversation_coherence", "communication_adaptation", "responsiveness", "follow_up",
    ]);
  });

  it("faixa dos 100 pontos: pedaço do tamanho do peso, parte cheia = ganho", () => {
    const faixa = faixaDosPontos(CRITERIOS);
    expect(faixa.reduce((soma, p) => soma + p.peso, 0)).toBe(100);
    expect(faixa.find((p) => p.key === "qualification")).toMatchObject({ peso: 10, ganho: 20, tom: "danger", avaliado: true });
    expect(faixa.find((p) => p.key === "next_step")).toMatchObject({ ganho: 0, avaliado: true });
    expect(faixa.find((p) => p.key === "follow_up")).toMatchObject({ ganho: null, avaliado: false, tom: "faint" });
  });

  it("a conta da nota: 6 de 8 critérios, 45 de 80 pontos", () => {
    expect(contaDaNota({ evaluated_weight: 80, criteria: CRITERIOS })).toEqual({ avaliados: 6, total: 8, pontos: 45, pesoAvaliado: 80 });
  });

  it("rótulo: o estado de negócio quando diz mais; não avaliado nunca vira zero", () => {
    expect(rotuloDoCriterio(CRITERIOS[6])).toBe("Ficou em aberto");
    expect(rotuloDoCriterio(CRITERIOS[1])).toBe("Atenção");
    expect(rotuloDoCriterio(CRITERIOS[7])).toBe("Não avaliado");
    expect(rotuloDoCriterio(crit("follow_up", 10, "ruim", 2, { state: "overdue" }))).toBe("Vencido");
  });

  it("motivo: o do Analista, sem números internos; não avaliado diz por quê", () => {
    expect(motivoDoCriterio(CRITERIOS[5])).toBe("Preço antes da descoberta.");
    expect(motivoDoCriterio(CRITERIOS[0])).toContain("Fica fora da v1");
    expect(motivoDoCriterio(CRITERIOS[7])).toBe("Nenhum follow-up vencido para avaliar.");
    expect(motivoDoCriterio(crit("discovery", 15, "nao_avaliado", null))).toBe("Sem dado suficiente para avaliar.");
    expect(motivoDoCriterio(CRITERIOS[2])).toBe("");
  });
});

describe("o mapa da conversa", () => {
  it("cada etapa é um critério, na ordem da conversa, e o follow-up vem depois", () => {
    const etapas = etapasDaConversa(CRITERIOS, { criterion: "next_step" });
    expect(etapas.map((e) => e.nome)).toEqual(["Abertura", "Descoberta", "Qualificação", "Proposta", "Próximo passo", "Follow-up"]);
    expect(etapas[0]).toMatchObject({ detalhe: "adaptação: bom · 10/10", tom: "success" });
    expect(etapas[3]).toMatchObject({ detalhe: "playbook: atenção · 9/15", nota: "Preço antes da descoberta." });
    expect(etapas[4]).toMatchObject({ detalhe: "ficou em aberto · 0/15", tom: "danger", forte: true, marca: "parou aqui!" });
    expect(etapas[5]).toMatchObject({ depois: true, avaliado: false, detalhe: "não avaliado", nota: "" });
  });

  it("gargalo em outro critério: a marca diz gargalo; sem critério, nenhuma marca", () => {
    expect(etapasDaConversa(CRITERIOS, { criterion: "qualification" })[2].marca).toBe("o gargalo está aqui");
    expect(etapasDaConversa(CRITERIOS, { criterion: null }).every((e) => !e.marca)).toBe(true);
    expect(etapasDaConversa(CRITERIOS, { criterion: "conversation_coherence" }).every((e) => !e.marca)).toBe(true);
  });
});

// 26/09/2026 10:00 em Brasília = 13:00 UTC.
const em = (minutos) => new Date(Date.UTC(2026, 8, 26, 13, 0) + minutos * 60 * 1000).toISOString();
const msg = (id, minutos, fromMe, extra = {}) => ({ id, at: em(minutos), fromMe, author: fromMe ? "humano" : "contato", ...extra });

describe("a linha do tempo", () => {
  const timeline = {
    until: em(1393 + 3 * 24 * 60),
    messages: [
      msg("x1", 0, false),
      msg("x2", 3, true, { author: "ia" }),
      msg("x3", 4, false, { snippet: "Quanto custa?" }),
      msg("x4", 5, true, { snippet: "O plano sai por R$ 300" }),
      msg("x5", 28, false),
      msg("x6", 218, true), // 3h10 depois da mensagem do cliente
      msg("x7", 1390, false, { snippet: "Vou pensar e te falo" }), // no dia seguinte
      msg("x8", 1393, true),
    ],
  };
  const alertas = [
    { code: "playbook_violation", evidence_message_ids: ["x4"] },
    { code: "conversation_left_open", evidence_message_ids: ["x8"] },
  ];

  it("pausa longa da equipe, virada de dia e parada no fim", () => {
    const linha = linhaDoTempo(timeline, alertas);
    expect(linha.total).toBe(8);
    expect(linha.pausas).toHaveLength(1);
    expect(linha.pausas[0].rotulo).toBe("3h10 até a equipe responder");
    expect(linha.dias.map((d) => d.rotulo)).toEqual(["27/09"]);
    expect(linha.parada.rotulo).toBe("3 dias parada");
    const xs = linha.mensagens.map((m) => m.x);
    expect(xs.every((x, i) => i === 0 || x > xs[i - 1])).toBe(true);
    expect(xs[0]).toBe(2);
    expect(linha.parada.x1).toBeLessThan(98);
  });

  it("a espera conta desde a primeira mensagem do cliente sem resposta", () => {
    const linha = linhaDoTempo({ until: em(200), messages: [msg("a", 0, false), msg("b", 50, false), msg("c", 70, true)] });
    expect(linha.pausas[0].rotulo).toBe("1h10 até a equipe responder");
    expect(linhaDoTempo({ until: em(200), messages: [msg("a", 0, false), msg("b", 59, true)] }).pausas).toHaveLength(0);
  });

  it("legendas: a do alerta para a mensagem citada nele, senão o trecho", () => {
    const linha = linhaDoTempo(timeline, alertas);
    const por = Object.fromEntries(linha.mensagens.map((m) => [m.id, m]));
    expect(por.x4).toMatchObject({ tom: "warning", legenda: "Fora do playbook", lado: "equipe" });
    expect(por.x8).toMatchObject({ tom: "danger", legenda: "Conversa ficou em aberto" });
    expect(por.x3).toMatchObject({ tom: "accent", legenda: "“Quanto custa?”", lado: "cliente" });
    expect(por.x1).toMatchObject({ tom: null, legenda: "", citada: false });
    expect(por.x2.autor).toBe("ia");
  });

  it("momentos do celular: citadas, pausas e a parada, em ordem", () => {
    const momentos = momentosDaConversa(linhaDoTempo(timeline, alertas));
    expect(momentos.map((m) => [m.tipo, m.texto])).toEqual([
      ["mensagem", "“Quanto custa?”"],
      ["mensagem", "Fora do playbook"],
      ["pausa", "3h10 até a equipe responder"],
      ["mensagem", "“Vou pensar e te falo”"],
      ["mensagem", "Conversa ficou em aberto"],
      ["parada", "3 dias parada"],
    ]);
  });

  it("conversa recente: sem parada; nada na janela: sem linha", () => {
    const linha = linhaDoTempo({ until: em(30), messages: [msg("a", 0, false), msg("b", 2, true)] });
    expect(linha.parada).toBeNull();
    expect(linha.mensagens[1].x).toBe(98);
    expect(linhaDoTempo({ until: em(0), messages: [] })).toBeNull();
    expect(linhaDoTempo(null)).toBeNull();
  });

  it("o período lido", () => {
    expect(periodoDaLinha(linhaDoTempo(timeline))).toBe("8 mensagens, de 26/09 a 27/09");
    expect(periodoDaLinha(linhaDoTempo({ until: em(5), messages: [msg("a", 0, false)] }))).toBe("1 mensagem, em 26/09");
  });

  it("a linha do tempo vem da consulta de andamento", () => {
    expect(analiseDoBanco({ id: "a", timeline }).linhaDoTempo).toBe(timeline);
    expect(analiseDoBanco({ id: "a" }).linhaDoTempo).toBeNull();
  });
});

describe("textos", () => {
  it("duração", () => {
    expect(duracaoEmTexto(25 * 60e3)).toBe("25 min");
    expect(duracaoEmTexto(190 * 60e3)).toBe("3h10");
    expect(duracaoEmTexto(120 * 60e3)).toBe("2h");
    expect(duracaoEmTexto(25 * 3600e3)).toBe("1 dia");
    expect(duracaoEmTexto(80 * 3600e3)).toBe("3 dias");
  });

  it("prazo da ação", () => {
    expect(prazoEmTexto("2026-10-07")).toBe("07/10");
    expect(prazoEmTexto(null)).toBe("");
    expect(prazoEmTexto("2026-10-08T10:00:00")).toBe("08/10, 10:00");
  });

  it("resumo para copiar: nota com cobertura, gargalo, ações e mensagem, sem números internos", () => {
    const texto = resumoParaCopiar({
      nome: "Mariana",
      relatorio: {
        atendimento_score: { score: 100, evaluated_weight: 10, max_weight: 100 },
        diagnosis: {
          summary: "Pediu horário (#43).",
          main_bottleneck: { title: "Sem dono" },
          what_to_do_now: [{ title: "Assumir o atendimento" }, { instruction: "Checar a IA" }],
          suggested_message: { applicable: true, text: "Oi, Mariana!" },
        },
      },
    });
    expect(texto).toBe(
      [
        "Análise do atendimento · Mariana",
        "Nota: 100/100 — 10% dos critérios avaliados (ainda não conclusiva)",
        "",
        "Pediu horário.",
        "",
        "Gargalo: Sem dono",
        "",
        "O que fazer agora:",
        "1. Assumir o atendimento",
        "2. Checar a IA",
        "",
        "Mensagem sugerida:",
        "Oi, Mariana!",
      ].join("\n")
    );
  });
});
