import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createServer } from "../src/server.mjs";
import { createWhatsappCloudHandler, eventsFromWebhook, whatsappCloudHandlerFromEnv } from "../src/whatsappCloud.mjs";

const APP_SECRET = "segredo-do-app";
const VERIFY_TOKEN = "token-de-verificacao-do-whatsapp";
const INTAKE = "b".repeat(64);
const SUPABASE = "https://projeto.supabase.co";
const NUMERO = "1234567890123";

function sign(body) {
  return `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
}

const metadata = { display_phone_number: "556592175324", phone_number_id: NUMERO };

function aviso(changes) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "999", changes }],
  };
}

const mensagem = {
  field: "messages",
  value: {
    messaging_product: "whatsapp",
    metadata,
    contacts: [{ profile: { name: "Maria" }, wa_id: "5565999990000" }],
    messages: [{ from: "5565999990000", id: "wamid.A", timestamp: "1760000000", type: "text", text: { body: "oi" } }],
  },
};

const status = {
  field: "messages",
  value: {
    messaging_product: "whatsapp",
    metadata,
    statuses: [
      { id: "wamid.B", status: "delivered", timestamp: "1760000001", recipient_id: "5565999990000" },
      { id: "wamid.B", status: "read", timestamp: "1760000002", recipient_id: "5565999990000" },
    ],
  },
};

const eco = {
  field: "smb_message_echoes",
  value: {
    messaging_product: "whatsapp",
    metadata,
    message_echoes: [{ from: "556592175324", to: "5565999990000", id: "wamid.C", timestamp: "1760000003", type: "text", text: { body: "respondi pelo celular" } }],
  },
};

test("separa o aviso em mensagem, status e eco, com o número de cada um", () => {
  const { events, ignored } = eventsFromWebhook(aviso([mensagem, status, eco]));
  assert.deepEqual(
    events.map((item) => [item.kind, item.externalId, item.phoneNumberId]),
    [
      ["message", "wamid.A", NUMERO],
      ["status", "wamid.B:delivered", NUMERO],
      ["status", "wamid.B:read", NUMERO],
      ["echo", "wamid.C", NUMERO],
    ],
  );
  assert.deepEqual(ignored, {});
  // O adaptador remonta a mensagem sozinha: precisa do nome do perfil.
  assert.equal(events[0].payload.contacts[0].profile.name, "Maria");
  assert.equal(events[0].payload.metadata.phone_number_id, NUMERO);
});

test("o mesmo wamid em estados diferentes vira eventos diferentes", () => {
  // Sem o estado na chave, o banco descartaria o `read` como repetido do `delivered`.
  const { events } = eventsFromWebhook(aviso([status]));
  assert.notEqual(events[0].externalId, events[1].externalId);
});

test("o que ainda não é tratado é contado, não perdido em silêncio", () => {
  const historico = { field: "history", value: { metadata, history: [] } };
  const semNumero = { field: "messages", value: { messages: [{ id: "x" }] } };
  const { events, ignored } = eventsFromWebhook(aviso([historico, semNumero]));
  assert.equal(events.length, 0);
  assert.deepEqual(ignored, { history: 1, "messages-without-number": 1 });
  assert.deepEqual(eventsFromWebhook({ object: "page" }).ignored, { object: 1 });
});

function fakeRpc(reply = () => ({ status: 200, body: { accepted: 1, duplicates: 0, unknownNumber: 0, invalid: 0 } })) {
  const calls = [];
  const impl = async (input, init = {}) => {
    calls.push({ url: String(input), init, body: JSON.parse(init.body || "{}") });
    const answer = reply(calls.at(-1));
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } });
  };
  return { impl, calls };
}

async function running(fetchStub, overrides = {}) {
  const logs = [];
  const handler = createWhatsappCloudHandler({
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    intakeToken: INTAKE,
    supabaseUrl: SUPABASE,
    publishableKey: "sb_publishable_x",
    fetchImpl: fetchStub.impl,
    log: (event, detail) => logs.push({ event, detail }),
    ...overrides,
  });
  const server = createServer({
    apiHandler: async () => { throw new Error("não devia chegar na API autenticada"); },
    whatsappCloudHandler: handler,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}/api/webhooks/whatsapp-cloud`, logs };
}

test("responde o desafio da Meta só com o token certo", async () => {
  const { server, origin } = await running(fakeRpc());
  try {
    const ok = await fetch(`${origin}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "12345");
    const errado = await fetch(`${origin}?hub.mode=subscribe&hub.verify_token=outro&hub.challenge=12345`);
    assert.equal(errado.status, 403);
  } finally {
    server.close();
  }
});

test("recusa aviso sem a assinatura da Meta e não toca no banco", async () => {
  const rpc = fakeRpc();
  const { server, origin } = await running(rpc);
  try {
    const corpo = JSON.stringify(aviso([mensagem]));
    const sem = await fetch(origin, { method: "POST", body: corpo, headers: { "Content-Type": "application/json" } });
    assert.equal(sem.status, 401);
    const falsa = await fetch(origin, { method: "POST", body: corpo, headers: { "X-Hub-Signature-256": `sha256=${"0".repeat(64)}` } });
    assert.equal(falsa.status, 401);
    assert.equal(rpc.calls.length, 0);
  } finally {
    server.close();
  }
});

test("entrega os eventos à função do banco com o token do servidor", async () => {
  const rpc = fakeRpc();
  const { server, origin, logs } = await running(rpc);
  try {
    const corpo = JSON.stringify(aviso([mensagem, eco]));
    const response = await fetch(origin, { method: "POST", body: corpo, headers: { "X-Hub-Signature-256": sign(corpo) } });
    assert.equal(response.status, 200);
    assert.equal(rpc.calls.length, 1);
    assert.equal(rpc.calls[0].url, `${SUPABASE}/rest/v1/rpc/nucleo_whatsapp_cloud_receive`);
    assert.equal(rpc.calls[0].body.intake_token, INTAKE);
    assert.deepEqual(rpc.calls[0].body.events.map((item) => item.kind), ["message", "echo"]);
    // O log não carrega conteúdo de mensagem.
    assert.doesNotMatch(JSON.stringify(logs), /respondi pelo celular|"oi"|Maria/);
  } finally {
    server.close();
  }
});

test("banco fora devolve 500 para a Meta reenviar", async () => {
  const rpc = fakeRpc(() => ({ status: 503, body: { message: "upstream" } }));
  const { server, origin } = await running(rpc);
  try {
    const corpo = JSON.stringify(aviso([mensagem]));
    const response = await fetch(origin, { method: "POST", body: corpo, headers: { "X-Hub-Signature-256": sign(corpo) } });
    assert.equal(response.status, 500);
  } finally {
    server.close();
  }
});

test("aviso sem nada para tratar responde 200 sem chamar o banco", async () => {
  const rpc = fakeRpc();
  const { server, origin } = await running(rpc);
  try {
    const corpo = JSON.stringify(aviso([{ field: "account_update", value: { metadata } }]));
    const response = await fetch(origin, { method: "POST", body: corpo, headers: { "X-Hub-Signature-256": sign(corpo) } });
    assert.equal(response.status, 200);
    assert.equal(rpc.calls.length, 0);
  } finally {
    server.close();
  }
});

test("sem configuração o webhook responde 503 e o resto do portal segue", async () => {
  const handler = createWhatsappCloudHandler({});
  const server = createServer({ whatsappCloudHandler: handler });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/whatsapp-cloud`, { method: "POST", body: "{}" });
    assert.equal(response.status, 503);
  } finally {
    server.close();
  }
});

test("token de entrada fora do formato derruba a configuração na leitura", () => {
  assert.throws(() => whatsappCloudHandlerFromEnv({ WHATSAPP_CLOUD_INTAKE_TOKEN: "curto" }), /64 caracteres/);
});
