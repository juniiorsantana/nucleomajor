import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { existsSync } from "node:fs";
import { createServer, isPainelHost } from "../src/server.mjs";

// `fetch` não deixa trocar o `Host`; `http.request` deixa. É assim que o
// mesmo servidor responde por nucleomajor.com e por painel.nucleomajor.com.
function pedir(origin, path, host) {
  const { port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers: { Host: host } }, (res) => {
      const partes = [];
      res.on("data", (parte) => partes.push(parte));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(partes).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function servidor(apiHandler) {
  const server = createServer({ apiHandler });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

const PAINEL = "painel.nucleomajor.com";
const origemPublica = String(process.env.PUBLIC_ORIGIN || "https://nucleomajor.com").replace(/\/$/, "");
const origemDoPainel = String(process.env.PAINEL_ORIGIN || "https://painel.nucleomajor.com").replace(/\/$/, "");

test("reconhece o host do painel, com ou sem porta, e só ele", () => {
  assert.equal(isPainelHost(PAINEL), true);
  assert.equal(isPainelHost("Painel.NucleoMajor.com:443"), true);
  assert.equal(isPainelHost("painel.localhost:3000"), true);
  assert.equal(isPainelHost("nucleomajor.com"), false);
  assert.equal(isPainelHost("painel.nucleomajor.com.evil.example"), false);
  assert.equal(isPainelHost(""), false);
});

test("no host do painel, a raiz e as rotas sem extensão são o painel", { skip: !existsSync("public/painel/index.html") && "rode npm run build antes" }, async (t) => {
  const { server, origin } = await servidor();
  t.after(() => server.close());

  for (const rota of ["/", "/empresas/600d6eb8-4ffe-4523-a920-679105c2bc95", "/historico", "/liberar"]) {
    const resposta = await pedir(origin, rota, PAINEL);
    assert.equal(resposta.status, 200, rota);
    assert.match(resposta.body, /Painel da plataforma/, rota);
    assert.equal(resposta.headers["x-frame-options"], "DENY");
  }

  // O arquivo do painel responde na raiz do subdomínio.
  const marca = await pedir(origin, "/icons/marca.png", PAINEL);
  assert.equal(marca.status, 200);

  // A página do site e o app dos clientes não são servidos aqui.
  const inexistente = await pedir(origin, "/convite/index.html", PAINEL);
  assert.equal(inexistente.status, 404);
  const fuga = await pedir(origin, "/assets/%2e%2e%2f%2e%2e%2fapp%2findex.html", PAINEL);
  assert.equal(fuga.status, 404);
});

test("no host do painel, /app volta para o domínio principal", async (t) => {
  const { server, origin } = await servidor();
  t.after(() => server.close());

  for (const [rota, destino] of [["/app", "/app"], ["/app/contatos", "/app/contatos"], ["/app/ativar?c=1", "/app/ativar?c=1"]]) {
    const resposta = await pedir(origin, rota, PAINEL);
    assert.equal(resposta.status, 302, rota);
    assert.equal(resposta.headers.location, `${origemPublica}${destino}`);
  }
});

test("no host do painel, a API continua a mesma", async (t) => {
  const chamadas = [];
  const { server, origin } = await servidor(async (req, res, url) => {
    chamadas.push(url.pathname);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
  t.after(() => server.close());

  const config = await pedir(origin, "/api/config", PAINEL);
  assert.equal(config.status, 200);
  assert.equal(JSON.parse(config.body).painelOrigin, origemDoPainel);
  await pedir(origin, "/api/billing/activations/x/resend", PAINEL);
  assert.deepEqual(chamadas, ["/api/billing/activations/x/resend"]);
});

test("no domínio principal, /painel leva ao subdomínio e o app segue igual", async (t) => {
  const { server, origin } = await servidor();
  t.after(() => server.close());

  const painel = await pedir(origin, "/painel", "nucleomajor.com");
  assert.equal(painel.status, 302);
  assert.equal(painel.headers.location, `${origemDoPainel}/`);
  const funda = await pedir(origin, "/painel/empresas/abc", "nucleomajor.com");
  assert.equal(funda.headers.location, `${origemDoPainel}/empresas/abc`);

  const app = await pedir(origin, "/app", "nucleomajor.com");
  assert.equal(app.status, 200);
  assert.match(app.body, /EmyLeads · Núcleo Major/);
});
