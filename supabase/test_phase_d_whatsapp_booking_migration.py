"""Revisão estática dos limites da escrita de agenda pelo agente."""

from pathlib import Path
import unittest


MIGRATION = (
    Path(__file__).parent
    / "migrations"
    / "20260821230000_fase_d_agendamento_whatsapp.sql"
)


class WhatsappBookingMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()
        cls.function = cls.sql.split(
            "function public.nucleo_calendar_booking_create", 1
        )[1].split("$$;", 1)[0]

    def test_rpc_deriva_organizacao_e_conexao_da_credencial(self):
        self.assertIn("private.robot_organization()", self.function)
        self.assertIn("public.connection_robot_credentials", self.function)
        self.assertIn("credential.auth_user_id = auth.uid()", self.function)
        self.assertIn("connection.status <> 'revoked'", self.function)

    def test_profissional_precisa_ser_membro_ativo(self):
        self.assertIn("member.user_id = selected_agent", self.function)
        self.assertIn("member.status = 'active'", self.function)

    def test_confirmacao_do_cliente_e_obrigatoria(self):
        self.assertIn("customer_confirmed is not true", self.function)
        self.assertIn("customer confirmation is required", self.function)

    def test_operacao_e_idempotente_e_serializada(self):
        self.assertIn("unique (organization_id, connection_id, request_key)", self.sql)
        self.assertIn("pg_advisory_xact_lock", self.function)
        self.assertIn("existing_booking.payload_hash <> operation_hash", self.function)
        self.assertIn("booking.payload_hash = operation_hash", self.function)
        self.assertIn("'jaexistia', true", self.function)

    def test_rpc_so_cria_compromisso_corporativo_do_agente(self):
        self.assertIn("'appointment', 'organization'", self.function)
        self.assertIn("robot_org, selected_agent", self.function)
        self.assertNotIn("insert into public.tasks", self.function)

    def test_conflito_e_corrida_nao_criam_evento_duplicado(self):
        self.assertIn("event.starts_at < booking_ends_at", self.function)
        self.assertIn("event.ends_at > booking_starts_at", self.function)
        self.assertIn("exception when exclusion_violation", self.function)
        self.assertIn("'conflito', true", self.function)

    def test_limite_por_conversa_e_grant_estreito(self):
        self.assertIn("booking.created_at > now() - interval '1 hour'", self.function)
        self.assertIn(") >= 8", self.function)
        signature = (
            "public.nucleo_calendar_booking_create(\n"
            "  uuid, text, text, text, text, text, timestamptz, timestamptz,"
        )
        self.assertIn(f"revoke all on function {signature}", self.sql)
        self.assertIn(f"grant execute on function {signature}", self.sql)


if __name__ == "__main__":
    unittest.main()
