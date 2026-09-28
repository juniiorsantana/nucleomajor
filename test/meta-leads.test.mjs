import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createServer } from "../src/server.mjs";
import { createMetaLeadsHandler, leadFromFieldData, parseIntakes, signatureIsValid } from "../src/metaLeads.mjs";

const APP_SECRET = "segredo-do-app";
const VERIFY_TOKEN = "token-de-verificacao";
const ACCESS_TOKEN = "token-do-usuario-do-sistema";
const PAGE_ID = "1244817988723251";
const INTAKE = "a".repeat(64);
const SUPABASE = "https://projeto.supabase.co";

function sign(body) {
  return `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
}

function aviso(leadgenId = "900000000000001", pageId = PAGE_ID) {
  return JSON.stringify({
    object: "page",
    entry: [{ id: pageId, time: 1, changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, page_id: pageId, form_id: "1" } }] }],
  });
}

const FIELD_DATA = [
  { name: "full_name", values: ["Maria da Silva"] },
  { name: "phone_number", values: ["+5565999990000"] },
  { name: "email", values: ["maria@exemplo.com"] },
];

// Simula o Graph e o Supabase. `graph`/`rpc` decidem a resposta de cada um.
function fakeFetch({ graph = () => ({ status: 200, body: { field_data: FIELD_DATA } }), rpc = () => ({ status: 200, body: { accepted: true, welcome: true } }) } = {}) {
  const calls = [];
  const impl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const reply = url.startsWith("https://graph.facebook.com") ? graph(url) : rpc(JSON.parse(init.body || "{}"));
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  };
  return { impl, calls };
}

async function running(fetchStub, overrides = {}) {
  const logs = [];
  const handler = createMetaLeadsHandler({
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    accessToken: ACCESS_TOKEN,
    intakes: new Map([[PAGE_ID, INTAKE]]),
    supabaseUrl: SUPABASE,
    publishableKey: "sb_publishable_x",
    fetchImpl: fetchStub.impl,
    log: (event, detail) => logs.push({ event, detail }),
    ...overrides,
  });
  const server = createServer({ apiHandler: async () => { throw new Error("não devia chegar na API autenticada"); }, metaLeadsHandler: handler });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}/api/webhooks/meta-leads`, logs };
}

function post(origin, body, signature = sign(body)) {
  return fetch(origin, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature }, body });
}

test("responde o desafio de verificação do Meta só com o token certo", async (t) => {
  const { server, origin } = await running(fakeFetch());
  t.after(() => server.close());

  const ok = await fetch(`${origin}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "1158201444");

  const errado = await fetch(`${origin}?hub.mode=subscribe&hub.verify_token=outro&hub.challenge=1158201444`);
  assert.equal(errado.status, 403);
});

test("aviso com assinatura errada é recusado antes de qualquer chamada", async (t) => {
  const stub = fakeFetch();
  const { server, origin } = await running(stub);
  t.after(() => server.close());

  const response = await post(origin, aviso(), `sha256=${"0".repeat(64)}`);
  assert.equal(response.status, 401);
  assert.equal(stub.calls.length, 0);
});

test("busca o lead no Graph e entrega à função do lead com o token da página", async (t) => {
  const stub = fakeFetch();
  const { server, origin, logs } = await running(stub);
  t.after(() => server.close());

  const response = await post(origin, aviso());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: 1 });

  const [graph, rpc] = stub.calls;
  const graphUrl = new URL(graph.url);
  assert.equal(graphUrl.pathname, "/900000000000001");
  assert.equal(graphUrl.searchParams.get("access_token"), ACCESS_TOKEN);
  assert.equal(
    graphUrl.searchParams.get("appsecret_proof"),
    createHmac("sha256", APP_SECRET).update(ACCESS_TOKEN).digest("hex"),
  );

  assert.equal(rpc.url, `${SUPABASE}/rest/v1/rpc/nucleo_site_lead_receive`);
  assert.deepEqual(JSON.parse(rpc.init.body), {
    intake_token: INTAKE,
    lead: { nome: "Maria da Silva", telefone: "+5565999990000", email: "maria@exemplo.com", consentimento: true, origem: "meta_lead_ads" },
  });

  // Nada pessoal no log.
  const logText = JSON.stringify(logs);
  assert.ok(!logText.includes("Maria") && !logText.includes("99999") && !logText.includes("@"));
});

test("página sem campanha ligada não chama ninguém e não faz o Meta repetir", async (t) => {
  const stub = fakeFetch();
  const { server, origin } = await running(stub);
  t.after(() => server.close());

  const response = await post(origin, aviso("900000000000002", "111"));
  assert.equal(response.status, 200);
  assert.equal(stub.calls.length, 0);
});

test("Graph ou banco fora do ar devolve 500 para o Meta reenviar", async (t) => {
  const graphFora = await running(fakeFetch({ graph: () => ({ status: 503, body: {} }) }));
  const bancoFora = await running(fakeFetch({ rpc: () => ({ status: 503, body: { message: "upstream" } }) }));
  const teto = await running(fakeFetch({ rpc: () => ({ status: 400, body: { message: "too many leads in the last hour" } }) }));
  t.after(() => { graphFora.server.close(); bancoFora.server.close(); teto.server.close(); });

  assert.equal((await post(graphFora.origin, aviso())).status, 500);
  assert.equal((await post(bancoFora.origin, aviso())).status, 500);
  assert.equal((await post(teto.origin, aviso())).status, 500);
});

test("permissão faltando no Graph faz o Meta reenviar; lead apagado, não", async (t) => {
  const semPermissao = await running(fakeFetch({ graph: () => ({ status: 403, body: { error: { code: 200, message: "Permissions error" } } }) }));
  const apagado = await running(fakeFetch({ graph: () => ({ status: 400, body: { error: { code: 100, error_subcode: 33 } } }) }));
  t.after(() => { semPermissao.server.close(); apagado.server.close(); });

  assert.equal((await post(semPermissao.origin, aviso())).status, 500);
  assert.equal(semPermissao.logs.at(-1).detail.code, "graph-200");
  assert.equal((await post(apagado.origin, aviso())).status, 200);
  assert.equal(apagado.logs.at(-1).event, "rejected");
});

test("lead que a função recusa de vez não faz o Meta repetir", async (t) => {
  const stub = fakeFetch({ rpc: () => ({ status: 400, body: { message: "phone number is invalid" } }) });
  const { server, origin, logs } = await running(stub);
  t.after(() => server.close());

  assert.equal((await post(origin, aviso())).status, 200);
  assert.equal(logs.at(-1).event, "rejected");
});

test("sem configuração o webhook responde 503 e o portal continua de pé", async (t) => {
  const handler = createMetaLeadsHandler({});
  const server = createServer({ metaLeadsHandler: handler });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${base}/api/webhooks/meta-leads`)).status, 503);
  assert.equal((await fetch(`${base}/api/config`)).status, 200);
});

test("lê os campos padrão e as perguntas personalizadas do formulário", () => {
  assert.deepEqual(leadFromFieldData(FIELD_DATA), {
    nome: "Maria da Silva", telefone: "+5565999990000", email: "maria@exemplo.com", consentimento: true,
  });
  assert.deepEqual(
    leadFromFieldData([
      { name: "first_name", values: ["João"] },
      { name: "last_name", values: ["Souza"] },
      { name: "whatsapp", values: ["65 99999-0000"] },
      { name: "autoriza_contato_whatsapp", values: ["Não"] },
    ]),
    { nome: "João Souza", telefone: "65 99999-0000", email: "", consentimento: false },
  );
  assert.equal(leadFromFieldData([{ name: "consentimento", values: ["Sim"] }]).consentimento, true);
  assert.deepEqual(leadFromFieldData(undefined), { nome: "", telefone: "", email: "", consentimento: true });
});

test("confere assinatura e lê o mapa de páginas", () => {
  const body = Buffer.from(aviso());
  assert.equal(signatureIsValid(body, sign(body), APP_SECRET), true);
  assert.equal(signatureIsValid(body, sign(body), "outro-segredo"), false);
  assert.equal(signatureIsValid(body, "", APP_SECRET), false);

  assert.deepEqual([...parseIntakes(`{"${PAGE_ID}":"${"B".repeat(64)}"}`)], [[PAGE_ID, "b".repeat(64)]]);
  assert.equal(parseIntakes("").size, 0);
  assert.throws(() => parseIntakes("{"), /não é JSON/);
  assert.throws(() => parseIntakes(`{"${PAGE_ID}":"curto"}`), /inválida/);
});
