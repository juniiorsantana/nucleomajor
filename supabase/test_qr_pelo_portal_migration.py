"""Prende o correio do QR: quem pode pedir, por quanto tempo, e o que sobra.

O que estes testes protegem não é o SQL — é a decisão. O QR é uma credencial:
quem o escaneia vincula um aparelho à conta. Uma guarda de papel trocada por
guarda de membro, ou uma imagem que fica guardada na linha, não produzem erro
nenhum no dia em que forem escritas.
"""

from pathlib import Path
import re
import unittest


MIGRATION = (
    Path(__file__).parent
    / "migrations"
    / "20260910010000_qr_do_whatsapp_pelo_portal.sql"
)

BLOCO = re.compile(r"/\*.*?\*/", re.DOTALL)
LINHA = re.compile(r"--[^\n]*")

TIPOS_ANTIGOS = (
    "operator_verification_send",
    "handoff_return_to_ai",
    "handoff_close",
    "conversation_send",
    "conversation_owner",
    "conversation_check",
)


def sem_comentarios(sql):
    return LINHA.sub(" ", BLOCO.sub(" ", sql))


class QrPeloPortalMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bruto = MIGRATION.read_text(encoding="utf-8")
        cls.sql = sem_comentarios(cls.bruto.casefold())

    def test_e_transacional(self):
        self.assertEqual(self.sql.count("begin;"), 1)
        self.assertEqual(self.sql.count("commit;"), 1)

    def test_nao_cria_nem_derruba_tabela(self):
        """Aditiva. A fila já existe desde 20260826010000."""
        self.assertNotIn("create table", self.sql)
        self.assertNotIn("drop table", self.sql)

    def test_a_lista_de_comandos_e_reescrita_inteira(self):
        """A lista mora num lugar só. Perder um tipo antigo calaria a fila."""
        self.assertIn("connection_pair_start", self.sql)
        self.assertIn("connection_pair_qr", self.sql)
        for tipo in TIPOS_ANTIGOS:
            self.assertIn(tipo, self.sql, f"o tipo {tipo} sumiu da lista")

    def test_as_duas_rpcs_exigem_cargo_e_nao_so_participacao(self):
        """`is_org_member` responde "trabalha aqui". Parear pede outra régua."""
        pedido = self._corpo("nucleo_connection_pair_request")
        desfecho = self._corpo("nucleo_connection_pair_status")
        for nome, corpo in (("request", pedido), ("status", desfecho)):
            self.assertIn("private.org_role(target_organization)", corpo, nome)
            self.assertIn("not in ('owner', 'admin')", corpo, nome)
            self.assertIn("organization admin required", corpo, nome)
            # A guarda fraca não pode ter sobrado em nenhuma das duas.
            self.assertNotIn("is_org_member", corpo, nome)

    def test_as_duas_rpcs_sao_definer_com_search_path_vazio(self):
        for nome in ("nucleo_connection_pair_request", "nucleo_connection_pair_status"):
            corpo = self._corpo(nome)
            self.assertIn("security definer", corpo, nome)
            self.assertIn("set search_path = ''", corpo, nome)

    def test_nada_sensivel_vai_na_ida(self):
        """Os dois passos são ordens sem argumento: o payload privado é vazio."""
        pedido = self._corpo("nucleo_connection_pair_request")
        self.assertIn("target_organization, conexao, passo, '{}'::jsonb", pedido)

    def test_a_conexao_precisa_ser_da_organizacao(self):
        pedido = self._corpo("nucleo_connection_pair_request")
        self.assertIn("connection.organization_id = target_organization", pedido)
        self.assertIn("connection.status <> 'revoked'", pedido)
        self.assertIn("connection is not available for this organization", pedido)

    def test_abrir_e_ler_tem_tetos_separados(self):
        """Contar leitura junto com abertura fecharia a porta no meio do
        primeiro pareamento: o código gira a cada ~20s e a tela pergunta de
        novo a cada volta."""
        pedido = self._corpo("nucleo_connection_pair_request")
        self.assertIn("command.command_type = 'connection_pair_start'", pedido)
        self.assertIn("command.command_type = 'connection_pair_qr'", pedido)
        self.assertIn("aberturas >= 10", pedido)
        self.assertIn("too many pairing attempts in the last hour", pedido)
        self.assertIn("leituras >= 400", pedido)
        self.assertIn("too many pairing reads in the last hour", pedido)

    def test_a_validade_e_de_segundos(self):
        """QR guardado é chave esquecida na porta."""
        pedido = self._corpo("nucleo_connection_pair_request")
        self.assertIn("validade := interval '1 minute'", pedido)
        self.assertIn("validade := interval '30 seconds'", pedido)

    def test_repetir_o_clientid_pergunta_de_novo(self):
        """O contrário da fila de conversas, e de propósito: lá, repetir manda
        a mesma mensagem duas vezes; aqui, devolver o guardado entregaria à
        tela um QR que já expirou."""
        pedido = self._corpo("nucleo_connection_pair_request")
        self.assertIn("on conflict (organization_id, idempotency_key) do update", pedido)
        self.assertIn("'completed', 'failed', 'expired'", pedido)
        self.assertIn("public_result = case", pedido)

    def test_a_imagem_nao_fica_guardada(self):
        """A tela pode parar de perguntar a qualquer momento — fechando o
        navegador, por exemplo. A limpeza não pode depender dela."""
        desfecho = self._corpo("nucleo_connection_pair_status")
        self.assertIn("set public_result = '{}'::jsonb", desfecho)
        self.assertIn("updated_at < now() - interval '2 minutes'", desfecho)
        # E o comando vencido volta sem resultado nenhum.
        self.assertIn("public_result = '{}'::jsonb,", desfecho)
        self.assertIn("error_code = 'expired'", desfecho)

    def test_o_desfecho_so_enxerga_comando_de_pareamento(self):
        """Sem isso, esta função viraria um leitor genérico da fila — e a de
        conversas não exige cargo."""
        desfecho = self._corpo("nucleo_connection_pair_status")
        self.assertEqual(
            desfecho.count("command_type in ('connection_pair_start', 'connection_pair_qr')"),
            3,
            "os tres caminhos (limpeza, expiracao e busca) precisam do filtro",
        )
        self.assertIn("pairing command not found", desfecho)

    def test_as_duas_rpcs_sao_chamaveis_pelo_portal(self):
        self.assertIn(
            "grant execute on function "
            "public.nucleo_connection_pair_request(uuid, uuid, text, jsonb) to authenticated",
            self.sql,
        )
        self.assertIn(
            "grant execute on function "
            "public.nucleo_connection_pair_status(uuid, uuid) to authenticated",
            self.sql,
        )

    def test_a_migration_prova_a_si_mesma(self):
        """O bloco `do` roda na mesma transação: um check não reescrito falha
        aqui, e não no primeiro uso em produção."""
        self.assertIn("pg_get_constraintdef", self.sql)
        self.assertIn("o check nao aceita os comandos de pareamento", self.sql)
        self.assertIn("a lista de command_type perdeu um tipo antigo", self.sql)
        self.assertIn("uma rpc de pareamento nao exige cargo de administrador", self.sql)

    def _corpo(self, nome):
        """O corpo de uma função, do `create` dela até o `$$;` que a fecha."""
        inicio = self.sql.index(f"create or replace function public.{nome}")
        fim = self.sql.index("$$;", inicio)
        return self.sql[inicio:fim]


if __name__ == "__main__":
    unittest.main()
