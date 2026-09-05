/**
 * Gestão de Agents — a camada que fala com o Supabase.
 *
 * FASE F. Segue a arquitetura que já existe em `intelligenceProvider.js`:
 * frontend → PostgREST com RLS para leitura e escrita simples, e RPC para o
 * que precisa ser atômico. Não inventa backend novo — o servidor Node não
 * participa desta tela (ele serve `/api/assistant` e `/api/invitations`).
 *
 * A autorização NÃO vem daqui. `organizationId` é resolvido pelo contexto da
 * sessão e a RLS de `assistant_profiles` (`is_org_member` para ler,
 * `can_manage_org` para escrever) é quem decide. Um `organizationId` mandado
 * pelo cliente não abre porta nenhuma: a policy compara com o JWT.
 *
 * As regras de domínio (agente nasce comum, audience imutável, isDefault fora
 * do patch) ficam em `packages/intelligence/src/agent-management.mjs`, puro e
 * testável sem banco.
 */

import {
  AGENT_ERRORS,
  AgentError,
  agentCommandToRow,
  agentPatchToRow,
  buildCreateAgentCommand,
  buildUpdateAgentCommand,
  mapDatabaseError,
} from "../../../../packages/intelligence/src/agent-management.mjs";
import { assistantProfileToAgentDefinition } from "../../../../packages/intelligence/src/agent.mjs";
import { obterSupabaseWeb } from "./supabaseClient.js";
import { webArea, WORKSPACE_KEY } from "./storage.js";

const COLUNAS = "id, organization_id, audience, display_name, slug, role, tone, soul_markdown, active, is_default, created_at, updated_at";

// A mesma fábrica dos outros providers web (`{ supabase, area }`), para entrar
// em `web/operations.js` sem exceção — e o mesmo `contexto`, que tira a
// organização da sessão em vez de aceitá-la do componente.
export function criarOperacoesAgents({ supabase = obterSupabaseWeb(), area = webArea } = {}) {
  const contexto = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const user = data?.session?.user;
    const organizationId = (await area.get(WORKSPACE_KEY))[WORKSPACE_KEY];
    if (!user || !organizationId) throw new Error("Entre em uma empresa para gerenciar agentes.");
    return { userId: user.id, organizationId };
  };

  // Toda resposta do PostgREST passa por aqui: erro de banco vira erro de
  // domínio antes de chegar na UI.
  const executar = async (query) => {
    const { data, error } = await query;
    if (error) throw mapDatabaseError(error) ?? error;
    return data ?? [];
  };

  const paraDominio = (row) => (row ? assistantProfileToAgentDefinition(row) : null);

  return {
    /** Lista os agentes da organização da sessão, padrão primeiro. */
    "agents.listar": async () => {
      const ctx = await contexto();
      const rows = await executar(
        supabase
          .from("assistant_profiles")
          .select(COLUNAS)
          .eq("organization_id", ctx.organizationId)
          .order("audience")
          .order("is_default", { ascending: false })
          .order("display_name"),
      );
      return rows.map(paraDominio);
    },

    "agents.ler": async ({ agentId }) => {
      const ctx = await contexto();
      const rows = await executar(
        supabase
          .from("assistant_profiles")
          .select(COLUNAS)
          .eq("organization_id", ctx.organizationId)
          .eq("id", agentId),
      );
      if (!rows[0]) throw new AgentError(AGENT_ERRORS.NOT_FOUND);
      return paraDominio(rows[0]);
    },

    /**
     * Cria um agente COMUM. Nunca padrão — promover é `agents.tornarPadrao`.
     */
    "agents.criar": async (entrada) => {
      const ctx = await contexto();
      const comando = buildCreateAgentCommand({
        ...entrada,
        organizationId: ctx.organizationId,
      });
      const rows = await executar(
        supabase
          .from("assistant_profiles")
          .insert(agentCommandToRow(comando, { actor: ctx.userId }))
          .select(COLUNAS),
      );
      if (!rows[0]) throw new AgentError(AGENT_ERRORS.FORBIDDEN);
      return paraDominio(rows[0]);
    },

    /**
     * Edita identidade e comportamento. `organizationId`, `audience` e
     * `isDefault` são recusados pela camada de domínio, não aqui.
     */
    "agents.editar": async ({ agentId, ...patch }) => {
      const ctx = await contexto();
      const comando = buildUpdateAgentCommand(patch);
      const rows = await executar(
        supabase
          .from("assistant_profiles")
          .update(agentPatchToRow(comando, { actor: ctx.userId }))
          .eq("organization_id", ctx.organizationId)
          .eq("id", agentId)
          .select(COLUNAS),
      );
      if (!rows[0]) throw new AgentError(AGENT_ERRORS.NOT_FOUND);
      return paraDominio(rows[0]);
    },

    /**
     * Liga/desliga. Desativar o padrão é permitido e NÃO promove ninguém: o
     * runtime recusa até que alguém decida (FASE D). A tela deve avisar; o
     * provider não decide por ela.
     */
    "agents.definirAtivo": async ({ agentId, active }) => {
      const ctx = await contexto();
      const rows = await executar(
        supabase
          .from("assistant_profiles")
          .update({ active: Boolean(active), updated_by: ctx.userId })
          .eq("organization_id", ctx.organizationId)
          .eq("id", agentId)
          .select(COLUNAS),
      );
      if (!rows[0]) throw new AgentError(AGENT_ERRORS.NOT_FOUND);
      return paraDominio(rows[0]);
    },

    /**
     * Troca o padrão da audience do agente, atomicamente, via RPC. Ver
     * `20260905120000_trocar_o_agente_padrao_e_um_ato_so.sql` para o porquê de
     * não serem dois updates daqui.
     */
    "agents.tornarPadrao": async ({ agentId }) => {
      await contexto();
      const { data, error } = await supabase.rpc("nucleo_agent_set_default", {
        target_agent: agentId,
      });
      if (error) throw mapDatabaseError(error) ?? error;
      return data;
    },

    "agents.listarSkills": async ({ agentId }) => {
      const ctx = await contexto();
      return executar(
        supabase
          .from("assistant_profile_skills")
          .select("skill_id, enabled, priority, configuration, updated_at")
          .eq("organization_id", ctx.organizationId)
          .eq("profile_id", agentId)
          .order("priority"),
      );
    },

    /**
     * Vincula/desvincula uma skill DESTE agente. A relação é N:N por
     * `profile_id`: desligar uma skill aqui não mexe em nenhum outro agente
     * que use a mesma skill.
     */
    "agents.definirSkill": async ({ agentId, skillId, enabled = true, priority = 100, configuration = {} }) => {
      const ctx = await contexto();
      const rows = await executar(
        supabase
          .from("assistant_profile_skills")
          .upsert(
            {
              organization_id: ctx.organizationId,
              profile_id: agentId,
              skill_id: skillId,
              enabled: Boolean(enabled),
              priority: Number(priority),
              configuration,
              updated_by: ctx.userId,
            },
            { onConflict: "profile_id,skill_id" },
          )
          .select("skill_id, enabled, priority, configuration"),
      );
      return rows[0] ?? null;
    },
  };
}
