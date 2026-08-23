"""Revisão estática dos invariantes críticos da migration da Fase D."""

from pathlib import Path
import re
import unittest


MIGRATION = Path(__file__).parent / "migrations" / "20260821210000_fase_d_agenda_integrada.sql"


class PhaseDMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()

    def function_body(self, name):
        return self.sql.split(f"function public.{name}", 1)[1].split("$$;", 1)[0]

    def test_worker_registry_never_stores_runtime_tokens(self):
        table = self.sql.split(
            "create table public.connection_notification_credentials", 1
        )[1].split(");", 1)[0]
        self.assertNotIn("access_token", table)
        self.assertNotIn("refresh_token", table)
        self.assertNotIn("service_role", table)

    def test_exactly_one_live_whatsapp_per_organization(self):
        index = re.search(
            r"create unique index if not exists whatsapp_connections_one_live_per_org.*?;",
            self.sql,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(index)
        self.assertIn("organization_id", index.group(0))
        self.assertIn("revoked_at is null", index.group(0))

    def test_admin_nao_recebe_detalhes_pessoais_pela_tabela(self):
        policy = re.search(
            r"create policy calendar_events_select.*?;", self.sql, flags=re.DOTALL
        ).group(0)
        self.assertNotIn("can_manage_org", policy)
        self.assertIn("owner_id = auth.uid()", policy)
        self.assertIn("visibility = 'organization'", policy)

    def test_rpc_da_agenda_mascara_todos_os_metadados_privados(self):
        body = self.function_body("calendar_events_list")
        for field in (
            "event.title",
            "event.description",
            "event.kind",
            "event.contact_id",
            "event.google_event_id",
            "event.google_calendar_id",
            "event.category_id",
            "event.location",
            "event.tags",
            "event.reminder_minutes",
        ):
            nearby = body[body.index(field) - 160 : body.index(field) + len(field) + 80]
            self.assertIn("case when", nearby, field)

    def test_worker_rpc_confere_identidade_e_organizacao(self):
        for function in (
            "notification_worker_claim_verifications",
            "notification_worker_set_verification_code",
            "notification_worker_complete_verification",
            "notification_worker_claim_reminders",
            "notification_worker_complete_reminder",
        ):
            body = self.function_body(function)
            self.assertIn("private.notification_worker_organization()", body)
            self.assertIn("private.notification_worker_connection()", body)

    def test_lembrete_tem_trava_e_limite_de_tentativas(self):
        body = self.function_body("notification_worker_claim_reminders")
        self.assertIn("for update of reminder skip locked", body)
        self.assertIn("attempt_count >= 3", body)
        self.assertIn("claim_expires_at", body)

    def test_mcp_continua_sem_rpc_de_escrita(self):
        body = self.function_body("nucleo_calendar_list")
        self.assertIn("'indisponível'", body)
        self.assertNotIn("insert into public.calendar_events", body)
        self.assertNotIn("update public.calendar_events", body)


if __name__ == "__main__":
    unittest.main()
