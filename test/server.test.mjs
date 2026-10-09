import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.mjs";

async function runningServer(apiHandler) {
  const server = createServer({ apiHandler });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

test("publica configuração, a página SaaS, o app e a página de convite", async (t) => {
  const { server, origin } = await runningServer();
  t.after(() => server.close());

  const configResponse = await fetch(`${origin}/api/config`);
  assert.equal(configResponse.status, 200);
  assert.equal(configResponse.headers.get("cache-control"), "no-store");
  const config = await configResponse.json();
  // O padrão de produção, e não um literal: cravar "https://nucleomajor.com"
  // fazia o teste quebrar em qualquer ambiente que definisse PUBLIC_ORIGIN —
  // era o que mantinha o CI vermelho, porque o workflow injetava um valor
  // http. `src/server.mjs` lê a variável uma vez, no carregamento do módulo,
  // então não adianta mexer nela aqui: o jeito honesto é afirmar a mesma
  // regra de resolução.
  const origemEsperada = String(process.env.PUBLIC_ORIGIN || "https://nucleomajor.com").replace(/\/$/, "");
  assert.equal(config.publicOrigin, origemEsperada);
  assert.ok(!config.publicOrigin.endsWith("/"), "a origem publicada não pode terminar em barra");

  const runtimeConfigResponse = await fetch(`${origin}/api/config.js`);
  assert.equal(runtimeConfigResponse.status, 200);
  assert.match(runtimeConfigResponse.headers.get("content-type"), /javascript/);
  assert.match(await runtimeConfigResponse.text(), /__NUCLEO_CONFIG__/);

  const landingResponse = await fetch(`${origin}/`);
  assert.equal(landingResponse.status, 200);
  assert.match(await landingResponse.text(), /Núcleo Major|Onde a sua equipe atende/i);

  const pageResponse = await fetch(`${origin}/convite`);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /EmyLeads/i);
  assert.equal(pageResponse.headers.get("x-frame-options"), "DENY");

  // O Meta só publica o app dos formulários com esta URL respondendo.
  for (const caminho of ["/privacidade", "/privacidade/"]) {
    const privacidade = await fetch(`${origin}${caminho}`);
    assert.equal(privacidade.status, 200, caminho);
    assert.match(await privacidade.text(), /Política de privacidade/);
  }

  const appResponse = await fetch(`${origin}/app`);
  assert.equal(appResponse.status, 200);
  assert.match(await appResponse.text(), /EmyLeads · Núcleo Major/i);

  for (const route of ["assistente", "contatos", "agenda", "conhecimento", "chatbots", "conexoes", "equipe", "configuracoes"]) {
    const nestedAppResponse = await fetch(`${origin}/app/${route}`);
    assert.equal(nestedAppResponse.status, 200);
    assert.match(await nestedAppResponse.text(), /id="raiz"/);
  }
});

// Link na bio do Juniior (Instagram @juniiorsantana7). Os caminhos da página são
// relativos, então o endereço curto precisa levar à pasta com a barra no fim; e
// todo arquivo citado no HTML e no CSS tem de existir, senão some uma imagem só
// em produção.
test("publica o link na bio do Juniior em /juniiorsantana7/", async (t) => {
  const { server, origin } = await runningServer();
  t.after(() => server.close());

  const curto = await fetch(`${origin}/juniiorsantana7?utm_source=instagram`, { redirect: "manual" });
  assert.equal(curto.status, 302);
  assert.equal(curto.headers.get("location"), "/juniiorsantana7/?utm_source=instagram");

  const pagina = await fetch(`${origin}/juniiorsantana7/`);
  assert.equal(pagina.status, 200);
  assert.match(pagina.headers.get("content-type"), /text\/html/);
  const html = await pagina.text();
  assert.match(html, /Conheça os meus projetos/);

  const css = await (await fetch(`${origin}/juniiorsantana7/estilo.css`)).text();
  const citados = new Set([...`${html}\n${css}`.matchAll(/\b(?:assets|fontes)\/[\w.-]+\.(?:webp|png|svg|woff2)\b/g)].map((m) => m[0]));
  assert.ok(citados.size > 20, `esperava as imagens da página, achei ${citados.size}`);
  for (const caminho of ["estilo.css", "app.js", ...citados]) {
    const resposta = await fetch(`${origin}/juniiorsantana7/${caminho}`);
    assert.equal(resposta.status, 200, caminho);
  }
  assert.match((await fetch(`${origin}/juniiorsantana7/assets/ellipse7.svg`)).headers.get("content-type"), /image\/svg\+xml/);
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
