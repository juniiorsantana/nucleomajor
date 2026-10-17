"""Revisão estática do fechamento das funções para quem não fez login.

O risco desta migration é fechar uma porta que alguém usa sem sessão. A lista
de portas da migration tem de bater com as RPCs que o servidor chama só com a
chave publicável; se alguém criar uma porta nova sem login, este teste lembra
de incluí-la (e de conferir que ela valida um token por dentro).
"""

from pathlib import Path
import re
import unittest


RAIZ = Path(__file__).parent.parent
MIGRATION = RAIZ / "supabase" / "migrations" / "20261017100000_sem_login_so_as_seis_portas.sql"


def rpcs_sem_sessao():
    nomes = set()
    server = (RAIZ / "src" / "server.mjs").read_text(encoding="utf-8")
    nomes.update(re.findall(r'publicRpc\("([a-z_]+)"', server))
    for arquivo in ("metaLeads.mjs", "whatsappCloud.mjs"):
        texto = (RAIZ / "src" / arquivo).read_text(encoding="utf-8")
        nomes.update(re.findall(r"rest/v1/rpc/([a-z_]+)", texto))
    return nomes


class SemLoginSoAsSeisPortasTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        bloco = cls.sql.split("portas constant text[] := array[", 1)[1].split("];", 1)[0]
        cls.portas = set(re.findall(r"'([a-z_]+)\(", bloco))

    def test_as_portas_sao_as_rpcs_que_o_servidor_chama_sem_sessao(self):
        self.assertEqual(rpcs_sem_sessao(), self.portas)
        self.assertEqual(len(self.portas), 6)

    def test_cada_porta_confere_um_token_por_dentro(self):
        migrations = "\n".join(
            p.read_text(encoding="utf-8") for p in sorted(MIGRATION.parent.glob("*.sql"))
        )
        for nome in self.portas:
            self.assertRegex(migrations, r"function public\.%s\(\s*intake_token text" % nome, nome)

    def test_o_portal_nao_perde_nada(self):
        # Antes de tirar PUBLIC, concede nominalmente o que authenticated e
        # service_role já tinham; e o fim confere que não houve perda.
        self.assertIn("grant execute on function %s to authenticated", self.sql)
        self.assertIn("grant execute on function %s to service_role", self.sql)
        self.assertIn("o portal perderia acesso a", self.sql)

    def test_funcoes_novas_nascem_fechadas(self):
        self.assertIn("alter default privileges for role postgres revoke execute on functions from public;", self.sql)
        self.assertIn("in schema public revoke execute on functions from anon;", self.sql)
        self.assertIn("in schema private grant execute on functions to authenticated;", self.sql)

    def test_as_policies_continuam_com_seus_ajudantes(self):
        bloco = self.sql.split("internas constant text[] := array[", 1)[1].split("];", 1)[0]
        for ajudante in ("is_org_member", "can_manage_org", "org_role", "is_robot",
                         "robot_can_access", "robot_organization", "storage_organization_id"):
            self.assertNotIn("'%s'" % ajudante, bloco)


if __name__ == "__main__":
    unittest.main()
