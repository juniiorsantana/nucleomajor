import assert from "node:assert/strict";
import test from "node:test";
import { buildConnectionRequestNotice, normalizeConnectionRequest, provisionCommand } from "../src/connectionRequest.mjs";

const ORG = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";
const CONEXAO = "8ee1e6d0-a9d0-4041-b6ea-878716a34a71";

test("o pedido aceita o número em qualquer grafia e recusa o resto", () => {
  assert.deepEqual(normalizeConnectionRequest({ organizationId: ORG, phone: "(65) 99217-8164", name: "  Recepção   da clínica " }), {
    organizationId: ORG, phone: "65992178164", name: "Recepção da clínica",
  });
  assert.throws(() => normalizeConnectionRequest({ organizationId: "x", phone: "65992178164" }), /Organização/);
  assert.throws(() => normalizeConnectionRequest({ organizationId: ORG, phone: "12345" }), /DDD/);
  assert.throws(() => normalizeConnectionRequest({ organizationId: ORG, phone: "1".repeat(16) }), /DDD/);
});

test("o comando da VPS só aceita ids de verdade, e plano desconhecido vira base", () => {
  for (const [plano, esperado] of [["base", "base"], ["atendimento", "atendimento"], ["completo", "completo"], ["full", "completo"]]) {
    assert.equal(provisionCommand({ organizationId: ORG, connectionId: CONEXAO, planCode: plano }),
      `bash scripts/vps/provision-connection.sh ${ORG} ${CONEXAO} --plano ${esperado}`);
  }
  assert.match(provisionCommand({ organizationId: ORG, connectionId: CONEXAO, planCode: "qualquer" }), /--plano base$/);
  assert.throws(() => provisionCommand({ organizationId: `${ORG}; rm -rf /`, connectionId: CONEXAO }), /inválido/);
  assert.match(provisionCommand({ organizationId: ORG, connectionId: CONEXAO, planCode: "base", phone: "+55 (65) 99217-8164" }), /--plano base --telefone 5565992178164$/);
  assert.match(provisionCommand({ organizationId: ORG, connectionId: CONEXAO, planCode: "base", phone: "$(reboot)" }), /--plano base$/);
});

test("o aviso para a equipe traz o comando e escapa o nome da empresa", () => {
  const aviso = buildConnectionRequestNotice({
    organizationName: "<Clínica>\nEvil",
    organizationId: ORG,
    connectionId: CONEXAO,
    last4: "8164",
    planCode: "base",
    requesterEmail: "dono@clinica.com",
  });
  assert.doesNotMatch(aviso.subject, /\n/);
  assert.match(aviso.text, /final 8164/);
  assert.match(aviso.text, new RegExp(`provision-connection\\.sh ${ORG} ${CONEXAO} --plano base`));
  assert.match(aviso.html, /&lt;Clínica&gt;/);
});
