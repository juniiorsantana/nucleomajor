"""Revisão estática dos invariantes de segurança da migration da Fase C."""

from pathlib import Path
import re
import unittest


MIGRATION = Path(__file__).parent / "migrations" / "20260821180000_fase_c_contexto_ia.sql"


class PhaseCMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()

    def test_nao_guarda_token_nem_service_role(self):
        table = self.sql.split("create table public.connection_robot_credentials", 1)[1].split(");", 1)[0]
        self.assertNotIn("access_token", table)
        self.assertNotIn("refresh_token", table)
        self.assertNotIn("service_role", table)

    def test_robo_recebe_apenas_policies_select_no_crm(self):
        policies = re.findall(
            r"create policy (\w+_robot_\w+).*?;", self.sql, flags=re.DOTALL
        )
        self.assertTrue(policies)
        for name in policies:
            statement = re.search(
                rf"create policy {re.escape(name)}.*?;", self.sql, flags=re.DOTALL
            ).group(0)
            self.assertIn(" for select ", statement)
            self.assertNotIn(" for insert ", statement)
            self.assertNotIn(" for update ", statement)
            self.assertNotIn(" for delete ", statement)

    def test_funcoes_de_gestao_recusam_robo(self):
        for function in ("create_organization", "accept_organization_invite", "update_member_responsibility"):
            body = self.sql.split(f"function public.{function}", 1)[1].split("$$;", 1)[0]
            self.assertIn("if private.is_robot()", body)

    def test_contexto_confere_agente_ativo_e_retorna_responsabilidades(self):
        body = self.sql.split("function public.nucleo_agent_context", 1)[1].split("$$;", 1)[0]
        self.assertIn("member.status = 'active'", body)
        self.assertIn("'responsabilidade'", body)
        self.assertNotIn("email", body)


if __name__ == "__main__":
    unittest.main()
