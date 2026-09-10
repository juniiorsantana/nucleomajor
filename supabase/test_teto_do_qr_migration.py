"""Prende o teto do pareamento no tamanho de um pareamento.

Em 10/09/2026 o teto de 400 leituras por hora fechou dezessete minutos depois
de a frente entrar no ar, com alguém de celular na mão esperando o QR. A causa
imediata foi a cadência da tela (corrigida no portal); a causa de desenho foi
contar em horas — um engano de trinta segundos virava uma hora sem conectar.
"""

from pathlib import Path
import re
import unittest


MIGRATION = (
    Path(__file__).parent
    / "migrations"
    / "20260910020000_o_teto_do_qr_cabe_no_pareamento.sql"
)

BLOCO = re.compile(r"/\*.*?\*/", re.DOTALL)
LINHA = re.compile(r"--[^\n]*")


def sem_comentarios(sql):
    return LINHA.sub(" ", BLOCO.sub(" ", sql))


class TetoDoQrMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = sem_comentarios(MIGRATION.read_text(encoding="utf-8").casefold())

    def test_e_transacional_e_aditiva(self):
        self.assertEqual(self.sql.count("begin;"), 1)
        self.assertEqual(self.sql.count("commit;"), 1)
        self.assertNotIn("create table", self.sql)
        self.assertNotIn("drop function", self.sql)

    def test_a_janela_deixa_de_ser_de_uma_hora(self):
        """Um teto que tranca por uma hora é indisponibilidade, não proteção."""
        self.assertNotIn("interval '1 hour'", self.sql)
        self.assertIn("janela := interval '10 minutes'", self.sql)
        self.assertIn("janela := interval '5 minutes'", self.sql)

    def test_o_teto_cabe_num_pareamento(self):
        """8 leituras por pareamento, a 15s de cadência. 60 em 5 minutos deixa
        margem para várias tentativas seguidas."""
        self.assertIn("teto := 60", self.sql)
        self.assertIn("teto := 10", self.sql)

    def test_a_contagem_e_por_passo(self):
        """Contar leitura junto com abertura fecharia a porta no meio do
        primeiro pareamento."""
        self.assertIn("command.command_type = passo", self.sql)
        self.assertIn("command.created_at > now() - janela", self.sql)
        self.assertIn("recentes >= teto", self.sql)

    def test_a_recusa_diz_o_prazo(self):
        """"Tente de novo" sem prazo faz a pessoa recarregar por uma hora."""
        self.assertIn("too many pairing requests: % in the last %", self.sql)

    def test_a_guarda_de_cargo_sobreviveu_a_reescrita(self):
        """O teto protege contra desperdício; quem protege a credencial é esta."""
        self.assertIn("private.org_role(target_organization)", self.sql)
        self.assertIn("not in ('owner', 'admin')", self.sql)
        self.assertIn("organization admin required", self.sql)
        self.assertNotIn("is_org_member", self.sql)

    def test_a_validade_curta_dos_comandos_sobreviveu(self):
        self.assertIn("validade := interval '1 minute'", self.sql)
        self.assertIn("validade := interval '30 seconds'", self.sql)

    def test_continua_definer_com_search_path_vazio(self):
        self.assertIn("security definer", self.sql)
        self.assertIn("set search_path = ''", self.sql)

    def test_a_migration_prova_a_si_mesma(self):
        self.assertIn("a janela de uma hora voltou", self.sql)
        self.assertIn("a reescrita perdeu a guarda de cargo", self.sql)


if __name__ == "__main__":
    unittest.main()
