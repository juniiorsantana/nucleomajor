"""Guarda as invariantes do espelho de conversas.

A tabela de mensagens é a primeira do projeto a guardar conteúdo de conversa, e
o `SPEC-DATA-SECURITY.md` classifica isso como *Sensível*: "minimizar, mascarar
e limitar retenção". Estes testes prendem justamente o que faz a migration
cumprir a regra — a ausência de material de mídia, a janela de retenção, a
escrita só por RPC e a derivação da organização pela credencial — para que uma
migration futura não afrouxe nenhuma delas sem alguém perceber.
"""

from pathlib import Path
import re
import unittest


MIGRATION = (
    Path(__file__).parent
    / "migrations"
    / "20260902120000_conversas_espelhadas_do_bridge.sql"
)

BLOCO = re.compile(r"/\*.*?\*/", re.DOTALL)
LINHA = re.compile(r"--[^\n]*")


def sem_comentarios(sql):
    """O que o teste afirma é sobre o schema, não sobre a prosa que o explica.

    O cabeçalho desta migration cita `media_key` e `file_sha256` justamente para
    dizer que eles NÃO entram; sem esta limpeza, a explicação derrubaria o teste
    que ela existe para descrever.
    """
    return LINHA.sub(" ", BLOCO.sub(" ", sql))


class ConversasMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = sem_comentarios(MIGRATION.read_text(encoding="utf-8").casefold())

    def test_is_transactional(self):
        self.assertEqual(self.sql.count("begin;"), 1)
        self.assertEqual(self.sql.count("commit;"), 1)

    def test_as_duas_tabelas_sao_escopadas_por_organizacao(self):
        for tabela in ("whatsapp_conversations", "whatsapp_messages"):
            self.assertIn(f"create table if not exists public.{tabela}", self.sql)
            self.assertIn(f"alter table public.{tabela} enable row level security", self.sql)
            self.assertIn(f"revoke all on public.{tabela} from anon, authenticated", self.sql)
            self.assertIn(f"grant select on public.{tabela} to authenticated", self.sql)
            self.assertIn(f"create policy {tabela}_select", self.sql)
        # A chave estrangeira composta impede que uma linha aponte para a
        # conexão de outro inquilino.
        self.assertEqual(
            self.sql.count(
                "references public.whatsapp_connections(id, organization_id) on delete cascade"
            ),
            2,
        )
        self.assertEqual(self.sql.count("private.is_org_member(organization_id)"), 2)

    def test_o_navegador_so_le(self):
        """Escrita é exclusividade da RPC: nenhuma policy de insert/update/delete."""
        for verbo in ("for insert", "for update", "for delete", "for all"):
            self.assertNotIn(verbo, self.sql)
        self.assertNotIn("grant insert", self.sql)
        self.assertNotIn("grant update", self.sql)
        self.assertNotIn("grant delete", self.sql)
        self.assertNotIn("service_role", self.sql)
        self.assertNotIn("to anon", self.sql)

    def test_a_rpc_deriva_a_conexao_da_credencial(self):
        self.assertIn("create or replace function public.nucleo_conversation_sync", self.sql)
        self.assertIn("security definer", self.sql)
        self.assertIn("set search_path = ''", self.sql)
        self.assertIn("private.robot_organization()", self.sql)
        self.assertIn("robot credential is inactive or connection was revoked", self.sql)
        self.assertIn("robot connection is inactive or revoked", self.sql)
        self.assertIn("credential.status = 'active'", self.sql)
        self.assertIn("connection.status <> 'revoked'", self.sql)
        self.assertIn(
            "revoke all on function public.nucleo_conversation_sync(jsonb) from public",
            self.sql,
        )
        self.assertIn(
            "grant execute on function public.nucleo_conversation_sync(jsonb) to authenticated",
            self.sql,
        )

    def test_o_payload_tem_teto(self):
        self.assertIn("jsonb_typeof(sync_payload) <> 'object'", self.sql)
        self.assertIn("octet_length(sync_payload::text) > 262144", self.sql)
        self.assertIn("conversation sync batch is too large", self.sql)

    def test_a_sincronia_e_idempotente(self):
        """Reenviar o mesmo lote não pode duplicar nem reescrever mensagem."""
        self.assertIn("on conflict (connection_id, contact_phone) do update set", self.sql)
        self.assertIn(
            "on conflict (connection_id, contact_phone, message_id) do nothing", self.sql
        )

    def test_nao_guarda_material_de_midia(self):
        """O que permitiria reconstruir o anexo fica na VPS."""
        for proibido in ("media_key", "file_sha256", "file_enc_sha256", "file_length"):
            self.assertNotIn(proibido, self.sql)
        self.assertIn("media_type", self.sql)
        self.assertIn("media_filename", self.sql)

    def test_a_retencao_e_limitada_e_barata(self):
        self.assertIn("sent_at < now() - interval '90 days'", self.sql)
        # Podar em lote: sem o limite, a primeira varredura depois de um período
        # parado rodaria inteira dentro da transação de quem só publicava.
        self.assertIn("limit 500", self.sql)
        self.assertIn("create index if not exists whatsapp_messages_retention_idx", self.sql)

    def test_grupo_nao_entrava_nesta_leva(self):
        """Histórico: era assim, e deixou de ser em 20260902200000.

        A Leva 1 recusava grupo pelo check do identificador. A conta medida em
        produção — 94 das 169 conversas do Bridge são grupos — derrubou a
        decisão, e a Leva 2 afrouxou o check para caber o traço do grupo antigo.
        O teste fica porque este arquivo descreve ESTA migration; quem guarda o
        estado atual é `test_conversas_escrita_migration.py`.
        """
        self.assertIn("contact_phone ~ '^[0-9]{6,20}$'", self.sql)

    def test_o_realtime_avisa_pela_lista_e_nao_por_mensagem(self):
        self.assertIn("private.portal_realtime_notify('conversas')", self.sql)
        self.assertIn("on public.whatsapp_conversations", self.sql)
        self.assertNotIn(
            "after insert or update or delete on public.whatsapp_messages", self.sql
        )
        # O check é reescrito por inteiro na mesma migration que instala o
        # gatilho — a lição de 20260829190000.
        self.assertIn(
            "check (topic in ('connections', 'operators', 'intelligence', "
            "'handoffs', 'conversas'))",
            self.sql,
        )


if __name__ == "__main__":
    unittest.main()
