import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConnectionChangeNotice,
  deliverConnectionChangeNotices,
  startConnectionChangeNotices,
} from "../src/connectionChangeNotice.mjs";

const PEDIDO = "51bd34ab-4712-46a9-aeb2-27a2d661ec6d";
const OUTRO = "6f1d3e0c-9a2b-4c1e-8f77-2b0a5d4e9c31";

function aviso(extra = {}) {
  return {
    requestId: PEDIDO,
    organizationName: "Núcleo Major",
    kind: "change_number",
    oldLast4: "8362",
    newLast4: "7777",
    appliedAt: "2026-10-10T18:00:00Z",
    requesterEmail: "dono@exemplo.invalido",
    remoteLogout: true,
    recipients: ["dono@exemplo.invalido", "adm@exemplo.invalido"],
    ...extra,
  };
}

test("a troca diz de que final para que final, quando e quem pediu", () => {
  const { subject, text, html } = buildConnectionChangeNotice(aviso());
  assert.equal(subject, "O WhatsApp de Núcleo Major foi trocado");
  assert.match(text, /do número final 8362 para o número final 7777, em 10\/10\/2026, 15:00/);
  assert.match(text, /Quem pediu: dono@exemplo\.invalido\./);
  assert.match(text, /Se ninguém da sua equipe pediu isso/);
  assert.match(html, /^<!doctype html>/);
});

test("a desconexão tem o próprio texto, e o desligamento não confirmado pede para remover o aparelho", () => {
  const { subject, text } = buildConnectionChangeNotice(aviso({ kind: "disconnect", newLast4: null, remoteLogout: false }));
  assert.equal(subject, "O WhatsApp de Núcleo Major foi desconectado");
  assert.match(text, /O WhatsApp final 8362 de Núcleo Major foi desconectado/);
  assert.match(text, /Aparelhos conectados/);
  assert.doesNotMatch(buildConnectionChangeNotice(aviso()).text, /Aparelhos conectados/);
});

test("nome hostil não quebra o assunto nem o HTML, e final estranho vira ????", () => {
  const { subject, html, text } = buildConnectionChangeNotice(aviso({
    organizationName: "<script>x</script>\nBcc: alguem@fora.com",
    oldLast4: "83a2",
  }));
  assert.doesNotMatch(subject, /[\r\n]/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(text, /número final \?\?\?\?/);
});

test("uma volta manda um e-mail por destinatário válido e registra o desfecho", async () => {
  const enviados = [];
  const desfechos = [];
  const logs = [];
  const resultado = await deliverConnectionChangeNotices({
    claim: async () => ({
      notices: [
        aviso({ recipients: ["Dono@Exemplo.invalido", "dono@exemplo.invalido", "nao-e-email", "adm@exemplo.invalido"] }),
        aviso({ requestId: OUTRO, kind: "disconnect", recipients: ["adm@exemplo.invalido"] }),
      ],
    }),
    send: async ({ to, message }) => { enviados.push({ to, subject: message.subject }); },
    done: async (...args) => { desfechos.push(args); },
    log: (linha) => logs.push(linha),
  });
  assert.deepEqual(enviados.map((e) => e.to), ["dono@exemplo.invalido", "adm@exemplo.invalido", "adm@exemplo.invalido"]);
  assert.deepEqual(desfechos, [[PEDIDO, 2, 0], [OUTRO, 1, 0]]);
  assert.deepEqual(resultado, { notices: 2, delivered: 3, failed: 0 });
  assert.ok(logs.every((linha) => !linha.includes("@")), "o log não leva endereço");
});

test("a falha de um envio conta, não segura os outros, e o log não leva o endereço", async () => {
  const desfechos = [];
  const logs = [];
  await deliverConnectionChangeNotices({
    claim: async () => ({ notices: [aviso()] }),
    send: async ({ to }) => { if (to.startsWith("dono")) throw new Error(`550 mailbox ${to} unavailable`); },
    done: async (...args) => { desfechos.push(args); },
    log: (linha) => logs.push(linha),
  });
  assert.deepEqual(desfechos, [[PEDIDO, 1, 1]]);
  assert.ok(logs.every((linha) => !linha.includes("@")));
});

test("sem destinatário válido, o aviso volta como falha para nova tentativa", async () => {
  const desfechos = [];
  await deliverConnectionChangeNotices({
    claim: async () => ({ notices: [aviso({ recipients: [] })] }),
    send: async () => { throw new Error("não deveria enviar"); },
    done: async (...args) => { desfechos.push(args); },
  });
  assert.deepEqual(desfechos, [[PEDIDO, 0, 0]]);
});

test("o banco fora ou o registro que falha não derrubam a volta", async () => {
  const logs = [];
  const semBanco = await deliverConnectionChangeNotices({
    claim: async () => { throw new Error("rpc nucleo_connection_change_notices_claim failed"); },
    send: async () => {},
    done: async () => {},
    log: (linha) => logs.push(linha),
  });
  assert.deepEqual(semBanco, { notices: 0, delivered: 0, failed: 0 });
  assert.match(logs[0], /claim failed/);

  const semRegistro = await deliverConnectionChangeNotices({
    claim: async () => ({ notices: [aviso(), aviso({ requestId: OUTRO })] }),
    send: async () => {},
    done: async () => { throw new Error("notice token is invalid"); },
    log: (linha) => logs.push(linha),
  });
  assert.equal(semRegistro.delivered, 4);
  assert.ok(logs.some((linha) => linha.includes("could not record")));
});

test("sem token válido, o envio periódico não liga", () => {
  let agendados = 0;
  const agendar = () => { agendados += 1; return { unref() {} }; };
  assert.equal(startConnectionChangeNotices({ token: "", deps: () => ({}), setIntervalFn: agendar }), null);
  assert.equal(startConnectionChangeNotices({ token: "curto", deps: () => ({}), setIntervalFn: agendar }), null);
  assert.equal(agendados, 0);
});

test("com token, agenda sem segurar o processo e não roda duas voltas ao mesmo tempo", async () => {
  let unref = false;
  let tokenRecebido = "";
  let pegas = 0;
  let liberar;
  const travado = new Promise((resolve) => { liberar = resolve; });
  const job = startConnectionChangeNotices({
    token: "AB".repeat(32),
    deps: (token) => {
      tokenRecebido = token;
      return {
        claim: async () => { pegas += 1; await travado; return { notices: [] }; },
        send: async () => {},
        done: async () => {},
      };
    },
    setIntervalFn: () => ({ unref() { unref = true; } }),
    clearIntervalFn: () => {},
  });
  assert.ok(job);
  assert.equal(unref, true);
  const primeira = job.tick();
  assert.equal(await job.tick(), null, "a segunda volta não começa com a primeira em curso");
  liberar();
  await primeira;
  assert.equal(pegas, 1);
  assert.equal(tokenRecebido, "ab".repeat(32));
});
