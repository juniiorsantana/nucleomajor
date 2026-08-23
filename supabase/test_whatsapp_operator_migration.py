from pathlib import Path
import unittest


MIGRATION = Path(__file__).parent / "migrations" / "20260822010000_operadores_whatsapp_pessoais.sql"


class WhatsappOperatorMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")

    def test_migration_is_transactional(self):
        self.assertTrue(self.sql.lstrip().startswith("-- Operadores pessoais"))
        self.assertEqual(self.sql.lower().count("begin;"), 1)
        self.assertEqual(self.sql.lower().count("commit;"), 1)

    def test_operator_identity_is_scoped_and_phone_is_hashed(self):
        self.assertIn("create table public.whatsapp_connection_operators", self.sql)
        self.assertIn("unique index whatsapp_operator_one_active_phone", self.sql)
        self.assertIn("phone_hash text not null", self.sql)
        self.assertIn("create or replace function private.whatsapp_operator_phone_hash", self.sql)
        self.assertIn("status in ('pending', 'active', 'blocked', 'revoked')", self.sql)
        self.assertIn("foreign key (connection_id, organization_id)", self.sql)

    def test_verification_is_single_use_and_robot_scoped(self):
        self.assertIn("create table public.whatsapp_operator_verifications", self.sql)
        self.assertIn("consumed_at timestamptz", self.sql)
        self.assertIn("verification.attempts < 5", self.sql)
        self.assertIn("create or replace function public.nucleo_operator_verification_confirm", self.sql)
        self.assertIn("private.robot_organization()", self.sql)
        self.assertIn("update public.whatsapp_operator_verifications", self.sql)

    def test_multi_participant_booking_has_availability_and_idempotency(self):
        self.assertIn("create table public.calendar_event_participants", self.sql)
        self.assertIn("create table public.calendar_operator_bookings", self.sql)
        self.assertIn("create or replace function public.nucleo_calendar_operator_availability", self.sql)
        self.assertIn("create or replace function public.nucleo_calendar_operator_booking_create", self.sql)
        self.assertIn("unique (organization_id, connection_id, request_key)", self.sql)
        self.assertIn("'participantesIndisponiveis'", self.sql)

    def test_direct_table_access_is_closed(self):
        self.assertIn("revoke all on public.whatsapp_connection_operators from anon, authenticated", self.sql)
        self.assertIn("revoke all on public.whatsapp_operator_verifications from anon, authenticated", self.sql)
        self.assertIn("revoke all on public.calendar_operator_bookings from anon, authenticated", self.sql)
        self.assertIn("grant execute on function public.nucleo_calendar_operator_booking_create", self.sql)


if __name__ == "__main__":
    unittest.main()
