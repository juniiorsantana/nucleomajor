import { describe, expect, it } from "vitest";
import { descreverAcao, descreverValor, diasAte, ehDoAsaas, ehRebaixamento, fimDoDia, fimMaisDias, situacao, venceEmBreve } from "./formatos";

const AGORA = Date.parse("2026-09-24T15:00:00Z");
const DIA = 86_400_000;

describe("situação da empresa", () => {
  it("bloqueada vence qualquer outra coisa", () => {
    expect(situacao({ estado: "blocked", status: "canceled", fimDoPeriodo: "2026-09-20T02:59:59Z" }, AGORA))
      .toEqual({ rotulo: "Bloqueada desde 19/09/2026", tom: "perigo" });
    expect(situacao({ estado: "blocked", status: "" }, AGORA).rotulo).toBe("Sem assinatura");
  });

  it("cancelada com data futura é 'pago até, sem renovação' — e perto do fim acende o alerta", () => {
    expect(situacao({ estado: "ok", status: "canceled", fimDoPeriodo: "2026-12-22T02:59:59Z" }, AGORA))
      .toEqual({ rotulo: "Pago até 21/12/2026 · sem renovação", tom: "ok" });
    expect(situacao({ estado: "ok", status: "canceled", fimDoPeriodo: new Date(AGORA + 3 * DIA).toISOString() }, AGORA).tom).toBe("atencao");
  });

  it("atraso e ativa", () => {
    expect(situacao({ estado: "past_due", status: "past_due" }, AGORA).tom).toBe("atencao");
    expect(situacao({ estado: "ok", status: "active" }, AGORA)).toEqual({ rotulo: "Ativa", tom: "ok" });
  });
});

describe("vence em breve", () => {
  const empresa = (dias, extra = {}) => ({ estado: "ok", status: "canceled", fimDoPeriodo: new Date(AGORA + dias * DIA).toISOString(), ...extra });

  it("só o acesso sem renovação que acaba em até 7 dias", () => {
    expect(venceEmBreve(empresa(3), AGORA)).toBe(true);
    expect(venceEmBreve(empresa(7), AGORA)).toBe(true);
    expect(venceEmBreve(empresa(8), AGORA)).toBe(false);
    expect(venceEmBreve(empresa(3, { status: "active" }), AGORA)).toBe(false);
    expect(venceEmBreve(empresa(-1, { estado: "blocked" }), AGORA)).toBe(false);
  });

  it("dias até arredondam para cima", () => {
    expect(diasAte(new Date(AGORA + 1.2 * DIA), AGORA)).toBe(2);
    expect(diasAte(null, AGORA)).toBeNull();
  });
});

describe("datas de fim", () => {
  it("+N dias conta a partir do fim atual quando ele ainda não passou", () => {
    expect(fimMaisDias("2026-10-20T02:59:59Z", 30, AGORA)).toBe("2026-11-18T23:59:59-03:00");
  });

  it("+N dias conta de hoje quando o fim já passou ou não existe", () => {
    expect(fimMaisDias("2026-01-01T00:00:00Z", 30, AGORA)).toBe("2026-10-24T23:59:59-03:00");
    expect(fimMaisDias(null, 90, AGORA)).toBe("2026-12-23T23:59:59-03:00");
  });

  it("o dia do calendário termina às 23:59 de Brasília", () => {
    expect(fimDoDia("2026-12-21")).toBe("2026-12-21T23:59:59-03:00");
    expect(fimDoDia("")).toBeNull();
    expect(fimDoDia("21/12/2026")).toBeNull();
  });
});

describe("plano e Asaas", () => {
  it("rebaixamento", () => {
    expect(ehRebaixamento("completo", "base")).toBe(true);
    expect(ehRebaixamento("full", "completo")).toBe(true);
    expect(ehRebaixamento("base", "atendimento")).toBe(false);
    // Plano desconhecido nunca passa como subida para o menor.
    expect(ehRebaixamento("ouro", "base")).toBe(true);
  });

  it("Asaas pela origem ou por venda ativa ligada", () => {
    expect(ehDoAsaas({ origem: "payment" })).toBe(true);
    expect(ehDoAsaas({ origem: "manual" }, [{ status: "active" }])).toBe(true);
    expect(ehDoAsaas({ origem: "manual" }, [{ status: "canceled" }])).toBe(false);
  });
});

describe("textos", () => {
  it("valores de função e de limite", () => {
    expect(descreverValor({ kind: "feature" }, true)).toBe("ligada");
    expect(descreverValor({ kind: "feature" }, undefined)).toBe("—");
    expect(descreverValor({ kind: "limit", key: "connections" }, 1)).toBe("1 número");
    expect(descreverValor({ kind: "limit", key: "connections" }, 0)).toBe("0 números");
    expect(descreverValor({ kind: "limit", key: "connections" }, null)).toBe("sem limite");
  });

  it("cada ação do histórico em português", () => {
    expect(descreverAcao({ acao: "entitlement.set", alvo: "chatbots", depois: { enabled: true, limit_value: null, expires_at: "2026-10-10T02:59:59Z" } }))
      .toBe("chatbots: ligada até 09/10/2026");
    expect(descreverAcao({ acao: "entitlement.set", alvo: "connections", depois: { enabled: null, limit_value: 0 } })).toBe("connections: limite 0");
    expect(descreverAcao({ acao: "entitlement.clear", alvo: "agenda" })).toBe("agenda: voltou ao plano");
    expect(descreverAcao({ acao: "subscription.set_period", depois: { status: "canceled", current_period_ends_at: "2026-12-22T02:59:59Z" } }))
      .toBe("Pago até 21/12/2026, sem renovação");
    expect(descreverAcao({ acao: "subscription.end_now" })).toBe("Acesso encerrado");
    expect(descreverAcao({ acao: "subscription.set_plan", alvo: "completo", antes: { plan_code: "base" }, depois: { plan_code: "completo" } }))
      .toBe("Plano: base → completo");
  });
});
