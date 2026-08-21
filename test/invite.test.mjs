import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInviteEmail,
  escapeHtml,
  inviteUrl,
  normalizeInviteId,
  normalizeInviteInput,
} from "../src/invite.mjs";

test("normaliza convite e monta link com e-mail", () => {
  const input = normalizeInviteInput({
    organizationId: "338e44ca-36ab-437c-b8ac-aa7c60fee64a",
    email: "  Pessoa@Empresa.COM ",
    role: "admin",
  });
  assert.deepEqual(input, {
    organizationId: "338e44ca-36ab-437c-b8ac-aa7c60fee64a",
    email: "pessoa@empresa.com",
    role: "admin",
  });
  const link = inviteUrl({
    publicOrigin: "https://nucleomajor.com/",
    token: "a".repeat(64),
    email: input.email,
  });
  assert.equal(link, `https://nucleomajor.com/convite?token=${"a".repeat(64)}&email=pessoa%40empresa.com`);
});

test("rejeita organização, papel e id fora do formato", () => {
  assert.throws(() => normalizeInviteInput({ organizationId: "org", email: "a@b.com" }), /Organização inválida/);
  assert.throws(() => normalizeInviteInput({ organizationId: "338e44ca-36ab-437c-b8ac-aa7c60fee64a", email: "a@b.com", role: "owner" }), /Papel/);
  assert.throws(() => normalizeInviteId("não-é-uuid"), /Convite inválido/);
  assert.throws(() => inviteUrl({ publicOrigin: "http://localhost", token: "a".repeat(64) }), /HTTPS/);
});

test("escapa conteúdo controlado pelo administrador no e-mail", () => {
  const message = buildInviteEmail({
    organizationName: "<Empresa> & Co",
    email: "pessoa@example.com",
    role: "member",
    link: `https://nucleomajor.com/convite?token=${"b".repeat(64)}`,
    token: "b".repeat(64),
    expiresAt: "2026-08-28T12:00:00.000Z",
  });
  assert.match(message.text, /Código reserva/);
  assert.match(message.html, /&lt;Empresa&gt; &amp; Co/);
  assert.doesNotMatch(message.html, /<Empresa>/);
});
