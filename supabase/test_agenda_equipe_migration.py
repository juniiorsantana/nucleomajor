"""Revisão estática da migration que abre o evento da empresa e divide a tarefa.

Estes testes leem o arquivo, e não o banco. Servem para o que revisão de código
esquece com facilidade: que abrir a CRIAÇÃO de um evento corporativo não abriu
junto a EDIÇÃO, e que a tarefa compartilhada volta uma linha só do RPC — porque
duplicá-la ali resolveria a grade por pessoa e quebraria o mês.
"""

from pathlib import Path
import re
import unittest


MIGRATION = (
    Path(__file__).parent
    / "migrations"
    / "20260903190000_agenda_e_tarefas_da_equipe.sql"
)


class AgendaEquipeMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").casefold()

    def policy(self, name):
        trecho = re.search(
            rf"create policy {name} on public\.calendar_events.*?;\n",
            self.sql,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(trecho, name)
        return trecho.group(0)

    def function_body(self, name):
        return self.sql.split(f"function public.{name}", 1)[1].split("$$;", 1)[0]

    def test_todo_membro_cria_evento_da_empresa(self):
        insert = self.policy("calendar_events_insert")
        self.assertNotIn("can_manage_org", insert)
        # Continua sendo do próprio autor: `created_by = auth.uid()` é o que
        # impede lançar evento em nome de outra pessoa.
        self.assertIn("created_by = auth.uid()", insert)
        self.assertIn("visibility = 'personal' and owner_id = auth.uid()", insert)

    def test_criar_nao_virou_editar(self):
        # O ponto inteiro da mudança: a criação abriu, a edição não. Sem isto,
        # qualquer membro passaria a mexer no evento corporativo de qualquer um.
        for nome in ("calendar_events_update", "calendar_events_delete"):
            policy = self.policy(nome)
            self.assertIn("created_by = auth.uid()", policy, nome)
            self.assertIn("private.can_manage_org(organization_id)", policy, nome)
            self.assertIn(
                "visibility = 'personal' and owner_id = auth.uid()", policy, nome
            )

    def test_evento_pessoal_de_outro_segue_intocavel(self):
        # Cargo gerencial nunca autorizou editar evento pessoal alheio
        # (`20260828170000`), e abrir a agenda da empresa não podia mudar isso.
        for nome in ("calendar_events_update", "calendar_events_delete"):
            policy = self.policy(nome)
            self.assertNotIn("visibility = 'personal' and private.can_manage", policy)

    def test_responsaveis_da_tarefa_ficam_na_mesma_organizacao(self):
        tabela = self.sql.split("create table if not exists public.task_assignees", 1)[
            1
        ].split(");", 1)[0]
        # A FK composta é o que impede pendurar responsável de uma empresa numa
        # tarefa de outra: `task_id` sozinho não carrega a organização.
        self.assertIn("foreign key (task_id, organization_id)", tabela)
        self.assertIn("references public.tasks(id, organization_id)", tabela)
        self.assertIn("on delete cascade", tabela)

    def test_rls_dos_responsaveis_acompanha_a_da_tarefa(self):
        policy = re.search(
            r"create policy task_assignees_all on public\.task_assignees.*?;\n",
            self.sql,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(policy)
        self.assertIn("private.is_org_member(organization_id)", policy.group(0))

    def test_backfill_nao_deixa_tarefa_sem_responsavel(self):
        backfill = self.sql.split("insert into public.task_assignees", 1)[1].split(
            ";", 1
        )[0]
        self.assertIn("coalesce(t.owner_id, t.created_by)", backfill)
        self.assertIn("on conflict do nothing", backfill)

    def test_rpc_devolve_uma_linha_por_tarefa_com_a_lista_dentro(self):
        corpo = self.function_body("calendar_events_list")
        self.assertIn("assignee_ids uuid[]", corpo)
        # `left join lateral` com `array_agg`: um join direto em task_assignees
        # multiplicaria a linha da tarefa por responsável, e o mês mostraria a
        # mesma tarefa três vezes.
        self.assertIn("left join lateral", corpo)
        self.assertIn("array_agg(assignment.user_id", corpo)

    def test_tarefa_sem_lista_cai_no_responsavel_principal(self):
        corpo = self.function_body("calendar_events_list")
        self.assertIn(
            "array_remove(array[coalesce(task.owner_id, task.created_by)], null::uuid)",
            corpo,
        )

    def test_contexto_devolve_a_cor_do_perfil(self):
        corpo = self.function_body("calendar_context")
        # A cor mora em `profiles` e não em `organization_members`: ela
        # acompanha a pessoa quando ela troca de empresa.
        self.assertIn("'color', profile.color", corpo)
        self.assertIn("'displayname', profile.display_name", corpo)

    def test_funcoes_seguem_fechadas_para_anon_no_grant(self):
        self.assertIn(
            "revoke all on function public.calendar_events_list(uuid, timestamptz, timestamptz) from public",
            self.sql,
        )
        self.assertIn(
            "grant execute on function public.calendar_events_list(uuid, timestamptz, timestamptz) to authenticated",
            self.sql,
        )

    def test_as_funcoes_nao_confiam_no_search_path(self):
        for nome in ("calendar_context", "calendar_events_list"):
            self.assertIn("set search_path = ''", self.function_body(nome), nome)


if __name__ == "__main__":
    unittest.main()
