import assert from "node:assert/strict";
import test from "node:test";
import { normalizarWhatsapp, normalizeSiteLead, processSiteLead, siteLeadConfig } from "../src/siteLead.mjs";
import { createServer } from "../src/server.mjs";

const CONFIG = siteLeadConfig({ NUCLEO_LEAD_TOKEN: "A".repeat(64) });

const lead = (overrides = {}) => ({
  nome: "  Lucas   Martins ",
  whatsapp: "(62) 99876-5432",
  email: "Lucas@Clinica.com",
  empresa: "Clínica Martins",
  plano: "atendimento",
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

test("o token só vale com 64 caracteres hexadecimais", () => {
  assert.equal(siteLeadConfig({ NUCLEO_LEAD_TOKEN: "F".repeat(64) }).token, "f".repeat(64));
  assert.equal(siteLeadConfig({ NUCLEO_LEAD_TOKEN: "curto" }).token, "");
  assert.equal(siteLeadConfig({}).token, "");
});

test("o WhatsApp segue a mesma régua da RPC", () => {
  assert.equal(normalizarWhatsapp("(62) 99876-5432"), "62998765432");
  assert.equal(normalizarWhatsapp("+55 62 99876-5432"), "62998765432");
  assert.equal(normalizarWhatsapp("62 3222-1100"), "6232221100");
  assert.equal(normalizarWhatsapp("10 99876-5432"), "");
  assert.equal(normalizarWhatsapp("62 89876-5432"), "");
  assert.equal(normalizarWhatsapp("9876-5432"), "");
});

test("os campos chegam limpos e o plano só vale da lista", () => {
  const { erros, lead: limpo } = normalizeSiteLead(lead());
  assert.deepEqual(erros, {});
  assert.deepEqual(limpo, {
    nome: "Lucas Martins",
    telefone: "62998765432",
    email: "lucas@clinica.com",
    plano: "atendimento",
    empresa: "Clínica Martins",
  });
  assert.deepEqual(normalizeSiteLead(lead({ plano: "indefinido" })).erros, {});
  assert.ok(normalizeSiteLead(lead({ plano: "gratis" })).erros.plano);
  assert.ok(normalizeSiteLead(lead({ plano: "__proto__" })).erros.plano);
  assert.ok(normalizeSiteLead(lead({ consentimento: "true" })).erros.consentimento);
  assert.ok(normalizeSiteLead(lead({ email: "sem-arroba" })).erros.email);
  assert.equal(normalizeSiteLead(lead({ email: "" })).lead.email, null);
  assert.ok(normalizeSiteLead(null).erros.nome);
});

test("sem token a rota fica desligada e nada é gravado", async () => {
  const { chamadas, receive } = receptor();
  const saida = await processSiteLead({ body: lead(), config: siteLeadConfig({}), receive });
  assert.equal(saida.status, 503);
  assert.equal(saida.body.code, "lead-not-configured");
  assert.equal(chamadas.length, 0);
});

test("o lead válido vai para a RPC com o nome do plano, não com o que chegou", async () => {
  const { chamadas, receive } = receptor();
  const saida = await processSiteLead({ body: lead(), config: CONFIG, receive });
  assert.equal(saida.status, 200);
  assert.deepEqual(chamadas, [{
    intake_token: "a".repeat(64),
    lead: {
      nome: "Lucas Martins",
      telefone: "62998765432",
      email: "lucas@clinica.com",
      consentimento: true,
      diagnostico: { servico: "Plano Atendimento com IA · Clínica Martins" },
    },
  }]);
});

test("o assunto nunca passa dos 60 caracteres que a RPC guarda", async () => {
  const { chamadas, receive } = receptor();
  await processSiteLead({ body: lead({ empresa: "X".repeat(80) }), config: CONFIG, receive });
  assert.ok(chamadas[0].lead.diagnostico.servico.length <= 60);
});

test("campo inválido volta com o motivo e não chama a RPC", async () => {
  const { chamadas, receive } = receptor();
  const saida = await processSiteLead({ body: lead({ whatsapp: "123", nome: "" }), config: CONFIG, receive });
  assert.equal(saida.status, 400);
  assert.ok(saida.body.fields.whatsapp);
  assert.ok(saida.body.fields.nome);
  assert.equal(chamadas.length, 0);
});

test("robô recebe sucesso e nada é gravado", async () => {
  const { chamadas, receive } = receptor();
  const saida = await processSiteLead({ body: lead({ site_da_empresa: "spam.com" }), config: CONFIG, receive });
  assert.equal(saida.status, 200);
  assert.equal(chamadas.length, 0);
});

test("as recusas da RPC viram respostas que o visitante entende", async () => {
  const limite = await processSiteLead({ body: lead(), config: CONFIG, receive: receptor("too many leads in the last hour").receive });
  assert.equal(limite.status, 429);
  const telefone = await processSiteLead({ body: lead(), config: CONFIG, receive: receptor("phone number is invalid").receive });
  assert.equal(telefone.status, 400);
  assert.ok(telefone.body.fields.whatsapp);
  const falha = await processSiteLead({ body: lead(), config: CONFIG, receive: receptor("rpc failed").receive });
  assert.equal(falha.status, 502);
});

test("POST /api/lead chega ao handler sem exigir sessão", async () => {
  const recebidos = [];
  const server = createServer({
    apiHandler: async (req, res) => res.writeHead(401).end(),
    leadHandler: async (req, res) => {
      recebidos.push(req.method);
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const resposta = await fetch(`http://127.0.0.1:${port}/api/lead`, { method: "POST", body: "{}" });
    assert.equal(resposta.status, 200);
    assert.deepEqual(recebidos, ["POST"]);
  } finally {
    server.close();
  }
});

test("/planos serve a página de comparação dos planos", async () => {
  const server = createServer({ apiHandler: async (req, res) => res.writeHead(401).end() });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    for (const rota of ["/planos", "/planos/"]) {
      const resposta = await fetch(`http://127.0.0.1:${port}${rota}`);
      assert.equal(resposta.status, 200);
      const html = await resposta.text();
      assert.match(html, /Compare os planos/);
      assert.match(html, /data-plan-open="atendimento"/);
    }
  } finally {
    server.close();
  }
});
