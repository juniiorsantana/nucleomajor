import { describe, expect, it } from "vitest";
import { CONFIANCA_MINIMA, itemDaLeitura, leituraDaConversa } from "./leituraDaConversa";

const linha = (summary, extra = {}) => ({
  created_at: "2026-10-01T15:00:00Z",
  analyzed_until: "2026-10-01T13:50:00Z",
  messages_count: 42,
  summary,
  ...extra,
});

describe("leituraDaConversa", () => {
  it("sem leitura não mostra nada", () => {
    expect(leituraDaConversa(null)).toBeNull();
    expect(leituraDaConversa(linha(null))).toBeNull();
    expect(leituraDaConversa(linha({}))).toBeNull();
    // Só perguntas que a tela não conhece: nada a mostrar.
    expect(leituraDaConversa(linha({ pergunta_nova: { a: "x", p: 0.9 } }))).toBeNull();
  });

  it("traduz as respostas e agrupa lead e atendimento", () => {
    const leitura = leituraDaConversa(linha({
      temperatura: { a: "morno", p: 0.71 },
      intencao: { a: "pesquisando", p: 0.78 },
      objecao_principal: { a: "preco", p: 0.88 },
      pergunta_sem_resposta: { a: "sim", p: 0.82 },
      propos_proximo_passo: { a: "nao", p: 0.9 },
      tom_empresa: { a: "caloroso", p: 0.7 },
    }));
    expect(leitura.mensagens).toBe(42);
    expect(leitura.lidaEm).toBe("2026-10-01T15:00:00Z");
    expect(leitura.grupos.map((g) => g.titulo)).toEqual(["O lead", "O atendimento"]);
    const lead = Object.fromEntries(leitura.grupos[0].itens.map((i) => [i.chave, i.valor]));
    expect(lead).toEqual({ temperatura: "Morno", intencao: "Pesquisando", objecao_principal: "Preço" });
    const atendimento = Object.fromEntries(leitura.grupos[1].itens.map((i) => [i.chave, i]));
    expect(atendimento.pergunta_sem_resposta).toMatchObject({ valor: "Sim", tom: "danger" });
    expect(atendimento.propos_proximo_passo).toMatchObject({ valor: "Não", tom: "warning" });
    expect(leitura.temperatura).toMatchObject({ valor: "Morno", tom: "warning" });
  });

  it("abaixo do corte de confiança vira incerto e não vira temperatura", () => {
    const leitura = leituraDaConversa(linha({ temperatura: { a: "quente", p: CONFIANCA_MINIMA - 0.01 } }));
    expect(leitura.grupos[0].itens[0]).toMatchObject({ valor: "Incerto", incerto: true, tom: "faint" });
    expect(leitura.temperatura).toBeNull();
    // Chance ausente também é incerto.
    expect(itemDaLeitura({ prazo: { a: "agora" } }, "prazo")).toMatchObject({ incerto: true });
  });

  it("sinal só vira selo com sim e chance acima do corte", () => {
    const leitura = leituraDaConversa(linha({
      insatisfeito: { a: "sim", p: 0.91 },
      pediu_humano: { a: "sim", p: 0.55 },
      precisa_resposta: { a: "nao", p: 0.97 },
    }));
    expect(leitura.sinais).toEqual([{ chave: "insatisfeito", texto: "Cliente insatisfeito", tom: "danger" }]);
    expect(leitura.grupos).toEqual([]);
  });

  it("opção desconhecida não aparece", () => {
    expect(itemDaLeitura({ intencao: { a: "talvez", p: 0.9 } }, "intencao")).toBeNull();
    expect(itemDaLeitura({ intencao: { a: 3, p: 0.9 } }, "intencao")).toBeNull();
    expect(itemDaLeitura({}, "intencao")).toBeNull();
  });
});
