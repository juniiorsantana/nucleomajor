"""Prende a proteção aditiva do nome das conversas de grupo."""

from pathlib import Path
import re
import unittest


MIGRATION = (
    Path(__file__).parent
    / "migrations"
    / "20260908191820_preservar_nome_grupo.sql"
)

BLOCO = re.compile(r"/\*.*?\*/", re.DOTALL)
LINHA = re.compile(r"--[^\n]*")


def sem_comentarios(sql):
    return LINHA.sub(" ", BLOCO.sub(" ", sql))


class PreservarNomeGrupoMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = sem_comentarios(MIGRATION.read_text(encoding="utf-8").casefold())

    def test_e_aditiva_e_transacional(self):
        self.assertEqual(self.sql.count("begin;"), 1)
        self.assertEqual(self.sql.count("commit;"), 1)
        self.assertNotIn("create table", self.sql)
        self.assertNotIn("alter table", self.sql)

    def test_preserva_nome_anterior_quando_grupo_chega_sem_nome(self):
        self.assertIn("new.chat_kind = 'grupo'", self.sql)
        self.assertIn(
            "pg_catalog.btrim(pg_catalog.coalesce(new.contact_name, '')) = ''",
            self.sql,
        )
        self.assertIn("new.contact_name := old.contact_name", self.sql)
        self.assertIn("before update of contact_name, chat_kind", self.sql)
        self.assertIn("on public.whatsapp_conversations", self.sql)

    def test_funcao_do_gatilho_tem_contexto_seguro_e_nao_e_api(self):
        self.assertIn("set search_path = ''", self.sql)
        self.assertNotIn("security definer", self.sql)
        self.assertIn(
            "revoke all on function private.preservar_nome_grupo() from public",
            self.sql,
        )
        self.assertNotIn("grant execute", self.sql)


if __name__ == "__main__":
    unittest.main()
