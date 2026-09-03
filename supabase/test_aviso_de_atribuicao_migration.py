"""Revisão estática da migration do aviso de atribuição.

O que estes testes guardam não é sintaxe: é a diferença entre um aviso útil e
uma equipe que aprende a ignorar notificação. Três invariantes carregam quase
tudo — não avisar quem escreveu, não avisar duas vezes a mesma coisa, e não
deixar a lista de responsáveis crescer sem que o lembrete acompanhe.
"""

from pathlib import Path
import re
import unittest


MIGRATION = (
    Path(__file__).parent
    / "migrations"
    / "20260903210000_aviso_de_atribuicao_de_tarefa.sql"
)


class AvisoDeAtribuicaoMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()

    def function_body(self, name):
        marcador = "function %s" % name
        self.assertIn(marcador, self.sql, name)
        return self.sql.split(marcador, 1)[1].split("$$;", 1)[0]

    def test_o_indice_deixa_de_impedir_duas_pessoas_na_mesma_tarefa(self):
        indice = re.search(
            r"create unique index calendar_reminders_task_live_idx.*?;",
            self.sql,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(indice)
        colunas = indice.group(0)
        # Sem `owner_id` no índice, o segundo responsável colidia com o
        # primeiro e simplesmente não recebia lembrete nenhum.
        self.assertIn("owner_id", colunas)
        # Sem `kind`, um aviso de atribuição que caísse no mesmo instante de um
        # lembrete perderia a vaga em silêncio.
        self.assertIn("kind", colunas)

    def test_ninguem_e_avisado_do_que_acabou_de_escrever(self):
        corpo = self.function_body("private.task_assignee_notify")
        self.assertIn("if new.user_id = new.created_by then", corpo)
        # E se colocou a si mesmo, já assumiu: a tela não pode dizer
        # "aguardando o Lucas" numa tarefa que o Lucas acabou de criar.
        antes_do_return = corpo.split("if new.user_id = new.created_by then", 1)[1]
        self.assertIn("accepted_at = coalesce(accepted_at, now())", antes_do_return)

    def test_um_aviso_por_entrada_e_nao_um_por_gravacao(self):
        corpo = self.function_body("private.task_assignee_notify")
        # Quem grava a lista pode reescrevê-la inteira a cada salvamento. Sem
        # esta guarda, corrigir a data de uma tarefa reavisa todo mundo.
        self.assertIn("from public.calendar_reminders aviso", corpo)
        self.assertIn("aviso.kind = 'assignment'", corpo)
        self.assertIn("aviso.status <> 'cancelled'", corpo)

    def test_o_lembrete_sai_para_cada_responsavel(self):
        corpo = self.function_body("private.task_reschedule_reminders")
        self.assertIn("from public.task_assignees assignment", corpo)
        # E cai no principal quando não há vínculo nenhum, senão a tarefa
        # criada por um caminho que ainda não escreve em `task_assignees`
        # (a extensão) ficaria sem lembrete.
        self.assertIn("coalesce(new.owner_id, new.created_by)", corpo)

    def test_editar_a_tarefa_nao_apaga_o_aviso_de_atribuicao(self):
        corpo = self.function_body("private.task_reschedule_reminders")
        cancelamento = corpo.split("'source-updated'", 1)[1].split(";", 1)[0]
        # Só o LEMBRETE é remarcado. Cancelar a atribuição por causa de uma
        # troca de título faria a pessoa nunca saber que entrou na tarefa.
        self.assertIn("kind = 'reminder'", cancelamento)

    def test_concluir_a_tarefa_cala_o_aviso_que_ainda_nao_saiu(self):
        corpo = self.function_body("private.task_reschedule_reminders")
        self.assertIn("'task-closed'", corpo)

    def test_sair_da_tarefa_cancela_o_que_sobrou(self):
        corpo = self.function_body("private.task_assignee_reschedule_reminders")
        self.assertIn("'assignee-removed'", corpo)
        self.assertIn("owner_id = old.user_id", corpo)

    def test_so_se_responde_por_si_mesmo(self):
        corpo = self.function_body("public.task_assignment_respond")
        # Nem quem criou nem o dono da empresa assumem no lugar de alguém.
        self.assertIn("user_id = auth.uid()", corpo)
        self.assertNotIn("target_user", corpo)
        self.assertIn("private.is_org_member(target_organization)", corpo)

    def test_recusar_nao_apaga_o_vinculo(self):
        corpo = self.function_body("public.task_assignment_respond")
        # Sumir da lista seria a mesma coisa que nunca ter avisado: quem
        # delegou volta a não saber de nada.
        self.assertNotIn("delete from public.task_assignees", corpo)
        self.assertIn("declined_at = case when accept then null else now() end", corpo)

    def test_aceite_e_recusa_sao_exclusivos(self):
        self.assertIn(
            "check (accepted_at is null or declined_at is null)", self.sql
        )

    def test_o_que_ja_existia_conta_como_assumido(self):
        # Ninguém foi perguntado. Marcar as tarefas de ontem como pendentes
        # ensinaria a equipe a ignorar a pílula antes de ela significar algo.
        backfill = self.sql.split("update public.task_assignees\nset accepted_at = created_at", 1)
        self.assertEqual(len(backfill), 2, "backfill do aceite ausente")
        self.assertIn("where accepted_at is null and declined_at is null", backfill[1])

    def test_a_fila_distingue_lembrar_de_avisar(self):
        self.assertIn("check (kind in ('reminder', 'assignment'))", self.sql)
        corpo = self.function_body("public.calendar_notifications_list")
        self.assertIn("reminder.kind", corpo)

    def test_o_aviso_vale_para_tarefa_sem_prazo(self):
        corpo = self.function_body("private.enqueue_assignment_notice")
        # `starts_at_snapshot` é not null e a tarefa pode não ter vencimento.
        # A tarefa sem data é justamente a que mais precisa de alguém sabendo
        # que ela existe.
        self.assertIn("coalesce(target_due_at, now())", corpo)
        self.assertIn("'assignment'", corpo)

    def test_o_aviso_respeita_o_canal_escolhido_por_cada_um(self):
        corpo = self.function_body("private.enqueue_assignment_notice")
        self.assertIn("preference.in_app_enabled", corpo)
        self.assertIn("preference.whatsapp_enabled", corpo)
        # Sem preferência gravada, in-app ligado e WhatsApp desligado: ninguém
        # recebe mensagem no celular por omissão.
        self.assertIn("send_whatsapp := false", corpo)

    def test_quem_liga_o_whatsapp_recebe_das_tarefas_em_que_entrou(self):
        corpo = self.function_body("private.rebuild_member_calendar_reminders")
        self.assertIn("from public.task_assignees assignment", corpo)
        self.assertIn("assignment.user_id = target_owner", corpo)

    def test_as_funcoes_novas_nao_confiam_no_search_path(self):
        for nome in (
            "private.enqueue_assignment_notice",
            "private.task_assignee_notify",
            "private.task_assignee_reschedule_reminders",
            "public.task_assignment_respond",
            "public.calendar_notifications_list",
        ):
            self.assertIn("set search_path = ''", self.function_body(nome), nome)

    def test_o_worker_da_vps_passa_a_saber_o_tipo_do_aviso(self):
        corpo = self.function_body("public.notification_worker_claim_reminders")
        self.assertIn("reminder.kind", corpo)
        # No FIM do retorno, e não no meio: o worker lê a resposta por nome de
        # campo, então acrescentar é inofensivo — reordenar não seria.
        retorno = self.sql.split("reminder_id uuid,", 1)[1].split(")", 1)[0]
        self.assertTrue(retorno.strip().endswith("kind text"), retorno)

    def test_anon_nao_ganha_execucao_explicita(self):
        self.assertIn(
            "revoke all on function public.task_assignment_respond(uuid, uuid, boolean, text) from public",
            self.sql,
        )
        self.assertIn(
            "grant execute on function public.task_assignment_respond(uuid, uuid, boolean, text) to authenticated",
            self.sql,
        )


if __name__ == "__main__":
    unittest.main()
