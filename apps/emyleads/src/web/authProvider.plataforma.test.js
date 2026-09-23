import { describe, expect, it, vi } from "vitest";
import { criarOperacoesAuth } from "./authProvider.js";

// Só `rpc` importa aqui: as operações do painel falam com o banco por função.
function operacoes(resposta) {
  const rpc = vi.fn(async () => resposta);
  const supabase = { rpc, auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } };
  const area = { get: vi.fn(async () => ({})), set: vi.fn(), remove: vi.fn() };
  return { rpc, ops: criarOperacoesAuth({ supabase, area }) };
}

describe("operações do painel da plataforma", () => {
  it("a lista chega em português, com limite nulo = sem limite", async () => {
    const { rpc, ops } = operacoes({
      data: [{
        organization_id: "o1", organization_name: "Clínica", owner_email: "dono@x.com", plan_code: "base", plan_name: "Base",
        subscription_status: "canceled", source: "manual", state: "ok", current_period_ends_at: "2026-12-22T02:59:59Z",
        members: 2, contacts: 10, connections_in_use: 1, connections_limit: null, active_adjustments: 1,
      }],
      error: null,
    });
    const [empresa] = await ops["plataforma.empresas"]();
    expect(rpc).toHaveBeenCalledWith("platform_organizations_list");
    expect(empresa).toMatchObject({ id: "o1", nome: "Clínica", dono: "dono@x.com", estado: "ok", whatsappEmUso: 1, whatsappLimite: null, ajustes: 1 });
  });

  it("ajustar manda a confirmação de IA e o prazo como o banco espera", async () => {
    const { rpc, ops } = operacoes({ data: { features: {} }, error: null });
    await ops["plataforma.ajustarFuncao"]({ id: "o1", chave: "ai_customer", ligada: true, ate: "2026-10-10T23:59:59-03:00", nota: " piloto ", confirmarIA: true });
    expect(rpc).toHaveBeenCalledWith("platform_entitlement_set", {
      target_organization: "o1", feature_key: "ai_customer", enabled: true, limit_value: null,
      expires_at: "2026-10-10T23:59:59-03:00", note: "piloto", confirm_ai: true,
    });
  });

  it("estender, encerrar e trocar plano chamam as funções certas", async () => {
    const { rpc, ops } = operacoes({ data: { billingInAsaas: false }, error: null });
    await ops["plataforma.estenderPeriodo"]({ id: "o1", ate: "2026-12-21T23:59:59-03:00", renovar: false, nota: "90 dias" });
    await ops["plataforma.encerrar"]({ id: "o1", nota: "pediu para sair" });
    await ops["plataforma.trocarPlano"]({ id: "o1", plano: "completo" });
    expect(rpc.mock.calls).toEqual([
      ["platform_organization_set_period", { target_organization: "o1", target_ends_at: "2026-12-21T23:59:59-03:00", renew: false, note: "90 dias" }],
      ["platform_organization_end_now", { target_organization: "o1", note: "pediu para sair" }],
      ["platform_organization_set_plan", { target_organization: "o1", target_plan: "completo", note: "" }],
    ]);
  });

  it("as recusas do banco viram português", async () => {
    const casos = [
      ["enabling ai requires confirm_ai: the company needs its own WhatsApp and the VPS setup", /WhatsApp próprio/],
      ["more than one WhatsApp per company is not supported yet", /um WhatsApp por empresa/],
      ["platform administrator permission required", /administração do Núcleo Major/],
      ["note required to end access", /motivo/],
      ["ends_at must be in the future", /no futuro/],
    ];
    for (const [mensagem, esperado] of casos) {
      const { ops } = operacoes({ data: null, error: { message: mensagem } });
      await expect(ops["plataforma.ajustarFuncao"]({ id: "o1", chave: "x", ligada: true })).rejects.toThrow(esperado);
    }
  });

  it("o detalhe normaliza o histórico igual à lista geral", async () => {
    const { ops } = operacoes({
      data: {
        organization: { organization_id: "o1", organization_name: "Clínica" },
        features: [{ key: "crm" }], usage: { contacts: 3 }, members: [], connections: [], billing: [],
        audit: [{ id: 7, at: "2026-09-24T10:00:00Z", actor_email: "cmo@majorhub.com.br", action: "subscription.end_now", target: "", note: "saiu" }],
      },
      error: null,
    });
    const detalhe = await ops["plataforma.empresa"]({ id: "o1" });
    expect(detalhe.empresa.nome).toBe("Clínica");
    expect(detalhe.funcoes).toEqual([{ key: "crm" }]);
    expect(detalhe.historico[0]).toMatchObject({ id: 7, autor: "cmo@majorhub.com.br", acao: "subscription.end_now", nota: "saiu", empresa: "Clínica" });
  });
});
