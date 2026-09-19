import assert from "node:assert/strict";
import test from "node:test";
import { requireAssistantPlan } from "../src/server.mjs";

const responde = (valor) => async () => valor;
const falha = (status) => async () => { const erro = new Error("x"); erro.status = status; throw erro; };

test("plano com IA e assinatura em dia passa", async () => {
  await requireAssistantPlan("org", "tk", responde([{ state: "ok", features: { assistant: true } }]));
  await requireAssistantPlan("org", "tk", responde([{ state: "past_due", features: { assistant: true } }]));
});

test("plano sem IA, empresa bloqueada ou sem assinatura recebem 402", async () => {
  for (const linha of [
    [{ state: "ok", features: { assistant: false } }],
    [{ state: "blocked", features: { assistant: true } }],
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
