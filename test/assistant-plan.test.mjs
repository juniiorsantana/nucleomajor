import assert from "node:assert/strict";
import test from "node:test";
import { requireAssistantPlan } from "../src/server.mjs";

const responde = (valor) => async () => valor;
const falha = (status) => async () => { const erro = new Error("x"); erro.status = status; throw erro; };

test("plano com o assistente da equipe e assinatura em dia passa", async () => {
  await requireAssistantPlan("org", "tk", responde([{ state: "ok", features: { ai_team: true, ai_customer: true } }]));
  await requireAssistantPlan("org", "tk", responde([{ state: "past_due", features: { ai_team: true } }]));
  // Plano gravado antes das chaves novas: vale o `assistant`.
  await requireAssistantPlan("org", "tk", responde([{ state: "ok", features: { assistant: true } }]));
});

test("plano sem o assistente da equipe, empresa bloqueada ou sem assinatura recebem 402", async () => {
  for (const linha of [
    [{ state: "ok", features: { assistant: false } }],
    // Atendimento com IA: tem IA para clientes, mas não o assistente da equipe.
    [{ state: "ok", features: { assistant: true, ai_customer: true, ai_team: false } }],
    [{ state: "blocked", features: { ai_team: true } }],
    [{ state: "ok", features: {} }],
    [],
  ]) {
    await assert.rejects(requireAssistantPlan("org", "tk", responde(linha)), (erro) => erro.status === 402 && erro.code === "plan-without-assistant");
  }
});

test("antes da migration de cobrança (RPC inexistente) nada muda; outras falhas sobem", async () => {
  await requireAssistantPlan("org", "tk", falha(404));
  await assert.rejects(requireAssistantPlan("org", "tk", falha(502)), (erro) => erro.status === 502);
});

test("a consulta vai para organization_access_state com a sessão do usuário", async () => {
  const chamadas = [];
  await requireAssistantPlan("org-1", "token-do-usuario", async (path, token, options) => {
    chamadas.push({ path, token, body: JSON.parse(options.body) });
    return [{ state: "ok", features: { assistant: true } }];
  });
  assert.deepEqual(chamadas, [{ path: "/rest/v1/rpc/organization_access_state", token: "token-do-usuario", body: { target_organization: "org-1" } }]);
});
