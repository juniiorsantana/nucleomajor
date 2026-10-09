import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CAMPANHA_DO_ORCAMENTO,
  normalizeOrcamento,
  orcamentoLeadConfig,
  processOrcamento,
  SERVICO_DO_ORCAMENTO,
  tokenDoOrcamento,
} from "../src/orcamentoLead.mjs";
import { createServer } from "../src/server.mjs";

const TOKEN_DA_PLANOS = "a".repeat(64);
const CONFIG = orcamentoLeadConfig({ NUCLEO_LEAD_TOKEN: TOKEN_DA_PLANOS });
const sha256 = (valor) => createHash("sha256").update(valor, "utf8").digest("hex");

const pedido = (overrides = {}) => ({
  nome: "  Ana   Paula ",
  email: "Ana@Empresa.com.br",
  whatsapp: "(65) 99876-5432",
  consentimento: true,
  ...overrides,
});

function receptor(erro) {
  const chamadas = [];
  const receive = async (payload) => {
    chamadas.push(payload);
    if (erro) throw new Error(erro);
    return { ok: true };
  };
  return { chamadas, receive };
}

test("o token é derivado do da Planos do Site, com a mesma conta do SQL", () => {
  // O SQL grava sha256(token) a partir de sha256(token da Planos):
  // token = sha256("orcamento-link-na-bio:" + sha256(token da Planos)).
  assert.equal(CONFIG.token, sha256(`orcamento-link-na-bio:${sha256(TOKEN_DA_PLANOS)}`));
  assert.equal(CONFIG.token, tokenDoOrcamento(TOKEN_DA_PLANOS));
  assert.notEqual(CONFIG.token, TOKEN_DA_PLANOS);
  assert.equal(CAMPANHA_DO_ORCAMENTO, "Orçamento pelo link na bio");
});

test("um token próprio vale no lugar do derivado; sem nenhum, a rota fica desligada", () => {
  assert.equal(orcamentoLeadConfig({ NUCLEO_ORCAMENTO_LEAD_TOKEN: "B".repeat(64), NUCLEO_LEAD_TOKEN: TOKEN_DA_PLANOS }).token, "b".repeat(64));
  assert.equal(orcamentoLeadConfig({ NUCLEO_ORCAMENTO_LEAD_TOKEN: "curto", NUCLEO_LEAD_TOKEN: TOKEN_DA_PLANOS }).token, CONFIG.token);
  assert.equal(orcamentoLeadConfig({}).token, "");
});

test("nome, e-mail e WhatsApp são obrigatórios e chegam limpos", () => {
  const { erros, lead } = normalizeOrcamento(pedido());
  assert.deepEqual(erros, {});
  assert.deepEqual(lead, { nome: "Ana Paula", email: "ana@empresa.com.br", telefone: "65998765432" });

  const vazio = normalizeOrcamento({});
  assert.ok(vazio.erros.nome);
  assert.ok(vazio.erros.email);
  assert.ok(vazio.erros.whatsapp);
  assert.ok(vazio.erros.consentimento);
  assert.ok(normalizeOrcamento(pedido({ email: "sem-arroba" })).erros.email);
  assert.ok(normalizeOrcamento(pedido({ consentimento: "true" })).erros.consentimento);
  assert.ok(normalizeOrcamento(null).erros.nome);
});

test("sem token nada é gravado", async () => {
  const { chamadas, receive } = receptor();
  const saida = await processOrcamento({ body: pedido(), config: orcamentoLeadConfig({}), receive });
  assert.equal(saida.status, 503);
  assert.equal(saida.body.code, "lead-not-configured");
  assert.equal(chamadas.length, 0);
});

test("o pedido válido vai para a RPC com o token e o assunto da campanha", async () => {
  const { chamadas, receive } = receptor();
  const saida = await processOrcamento({ body: pedido(), config: CONFIG, receive });
  assert.equal(saida.status, 200);
  assert.deepEqual(chamadas, [{
    intake_token: CONFIG.token,
    lead: {
      nome: "Ana Paula",
      telefone: "65998765432",
      email: "ana@empresa.com.br",
      consentimento: true,
      diagnostico: { servico: SERVICO_DO_ORCAMENTO },
    },
  }]);
  assert.ok(SERVICO_DO_ORCAMENTO.length <= 60);
});

test("campo inválido volta com o motivo e não chama a RPC", async () => {
  const { chamadas, receive } = receptor();
  const saida = await processOrcamento({ body: pedido({ whatsapp: "123", email: "" }), config: CONFIG, receive });
  assert.equal(saida.status, 400);
  assert.ok(saida.body.fields.whatsapp);
  assert.ok(saida.body.fields.email);
  assert.equal(chamadas.length, 0);
});

test("robô recebe sucesso e nada é gravado", async () => {
  const { chamadas, receive } = receptor();
  const saida = await processOrcamento({ body: pedido({ site_da_empresa: "spam.com" }), config: CONFIG, receive });
  assert.equal(saida.status, 200);
  assert.equal(chamadas.length, 0);
});

test("as recusas da RPC viram respostas que o visitante entende", async () => {
  const limite = await processOrcamento({ body: pedido(), config: CONFIG, receive: receptor("too many leads in the last hour").receive });
  assert.equal(limite.status, 429);
  const telefone = await processOrcamento({ body: pedido(), config: CONFIG, receive: receptor("phone number is invalid").receive });
  assert.equal(telefone.status, 400);
  assert.ok(telefone.body.fields.whatsapp);
  const registros = [];
  const falha = await processOrcamento({ body: pedido(), config: CONFIG, receive: receptor("intake token not found").receive, log: (m) => registros.push(m) });
  assert.equal(falha.status, 502);
  assert.equal(registros.length, 1);
});

test("POST /api/orcamento chega ao handler sem exigir sessão", async () => {
  const recebidos = [];
  const server = createServer({
    apiHandler: async (req, res) => res.writeHead(401).end(),
    orcamentoHandler: async (req, res) => {
      recebidos.push(req.method);
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const resposta = await fetch(`http://127.0.0.1:${port}/api/orcamento`, { method: "POST", body: "{}" });
    assert.equal(resposta.status, 200);
    assert.deepEqual(recebidos, ["POST"]);
  } finally {
    server.close();
  }
});
