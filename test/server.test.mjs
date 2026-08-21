import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function runningServer(apiHandler) {
  const server = createServer({ apiHandler });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

test("publica configuração, a página SaaS e a página de convite", async (t) => {
  const { server, origin } = await runningServer();
  t.after(() => server.close());

  const configResponse = await fetch(`${origin}/api/config`);
  assert.equal(configResponse.status, 200);
  assert.equal(configResponse.headers.get("cache-control"), "no-store");
  const config = await configResponse.json();
  assert.equal(config.publicOrigin, "https://nucleomajor.com");

  const landingResponse = await fetch(`${origin}/`);
  assert.equal(landingResponse.status, 200);
  assert.match(await landingResponse.text(), /Núcleo Major|Onde a sua equipe atende/i);

  const pageResponse = await fetch(`${origin}/convite`);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /EmyLeads/i);
  assert.equal(pageResponse.headers.get("x-frame-options"), "DENY");
});

test("aceita as rotas de reenvio e cancelamento com id UUID", async (t) => {
  const calls = [];
  const { server, origin } = await runningServer(async (req, res, url) => {
    calls.push(url.pathname);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  t.after(() => server.close());
  const id = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";
  const headers = { Authorization: "Bearer test", "Content-Type": "application/json" };
  assert.equal((await fetch(`${origin}/api/invitations/${id}/resend`, { method: "POST", headers, body: "{}" })).status, 201);
  assert.equal((await fetch(`${origin}/api/invitations/${id}/cancel`, { method: "POST", headers, body: "{}" })).status, 201);
  assert.deepEqual(calls, [`/api/invitations/${id}/resend`, `/api/invitations/${id}/cancel`]);
});
