from pathlib import Path
import re
import unittest


MIGRATION = Path(__file__).parent / "migrations" / "20261012100000_a_troca_voluntaria_de_numero.sql"


class TrocaVoluntariaMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.lower = cls.sql.lower()

    def _function(self, name):
        match = re.search(
            rf"create (?:or replace )?function {re.escape(name)}\(.*?\n\$\$;",
            self.sql,
            re.S,
        )
        self.assertIsNotNone(match, name)
        return match.group(0)

    def test_transactional_and_guarded(self):
        self.assertEqual(self.lower.count("begin;"), 1)
        self.assertEqual(self.lower.count("commit;"), 1)
        self.assertIn("esta migration ja foi aplicada", self.sql)

    def test_the_switch_starts_off_and_every_mutation_checks_it(self):
        body = self._function("private.connection_change_enabled")
        self.assertIn("select false;", body)
        guard = self._function("private.connection_change_guard")
        self.assertIn("if not private.connection_change_enabled() then", guard)
        for rpc in ("start", "resend", "confirm", "cancel", "retry"):
            self.assertIn(
                "private.connection_change_guard(",
                self._function(f"public.nucleo_connection_change_{rpc}"),
                rpc,
            )

    def test_people_only_never_runtime_credentials(self):
        guard = self._function("private.connection_change_guard")
        self.assertIn("if private.is_robot() or private.is_notification_worker() then", guard)
        self.assertIn("private.can_manage_org(target_organization)", guard)
        self.assertIn("private.org_access_state(target_organization) = 'blocked'", guard)
        self.assertIn("for update;", guard)

    def test_code_is_hashed_salted_and_only_in_the_private_payload(self):
        send = self._function("private.connection_change_send_code")
        self.assertIn("encode(extensions.gen_random_bytes(4), 'hex')", send)
        self.assertIn("'code', codigo", send)
        self.assertIn("code_hash = private.connection_change_code_hash(pedido.id, codigo)", send)
        self.assertIn("interval '10 minutes'", send)
        view = self._function("private.connection_change_view")
        self.assertNotIn("code_hash", view)
        self.assertNotIn("'code'", view)
        self.assertNotIn("phone_hash", view)

    def test_confirmation_counts_attempts_without_raising_and_only_the_requester(self):
        confirm = self._function("public.nucleo_connection_change_confirm")
        self.assertIn("if pedido.requested_by <> auth.uid() then", confirm)
        self.assertIn("set code_attempts = code_attempts + 1", confirm)
        self.assertIn("'result', 'invalid-code'", confirm)
        self.assertIn("if pedido.code_attempts >= 5 then", confirm)
        self.assertIn("geracao := conexao.control_generation + 1;", confirm)
        # O número esperado não muda na confirmação: só quando a VPS aplicar.
        self.assertNotIn("expected_phone_hash =", confirm)

    def test_identity_changes_only_when_the_runtime_confirms(self):
        track = self._function("private.connection_change_track_command")
        self.assertIn("(resultado ->> 'generation')::bigint = pedido.generation", track)
        self.assertIn("set expected_phone_hash = pedido.new_phone_hash", track)
        self.assertIn("exception when others then", track)
        self.assertIn("raise warning", track)

    def test_tables_closed_to_direct_reads(self):
        self.assertIn("revoke all on public.whatsapp_connection_identities from anon, authenticated;", self.sql)
        self.assertIn("revoke all on public.whatsapp_connection_change_requests from anon, authenticated;", self.sql)
        self.assertNotIn("grant select on public.whatsapp_connection_identities", self.sql)

    def test_command_types_are_appended_not_rewritten(self):
        self.assertIn("connection_runtime_commands_command_type_check", self.sql)
        for tipo in ("connection_confirmation_send", "connection_logout", "connection_identity_replace"):
            self.assertIn(f"'{tipo}'", self.sql)
        self.assertIn("tipos := tipos || array[novo];", self.sql)

    def test_voluntary_reason_only(self):
        self.assertIn("reason text not null default 'voluntary' check (reason = 'voluntary')", self.sql)


if __name__ == "__main__":
    unittest.main()
