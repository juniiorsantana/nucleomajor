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
import { normalizarAparencia } from "../domain/aparenciaDoAgente.js";
import { obterSupabaseWeb } from "./supabaseClient.js";
import { webArea, WORKSPACE_KEY } from "./storage.js";

const COLUNAS = "id, organization_id, audience, display_name, slug, role, tone, soul_markdown, active, is_default, created_at, updated_at";

/**
 * A coluna `appearance` chega pela migration 20261006100000. Até ela ser
 * aplicada, ler ou gravar a coluna falha com "coluna não existe" — e a tela de
 * agentes não pode cair por isso. O provider tenta com ela, e se o banco disser
 * que não existe, lembra e segue sem: o símbolo continua derivado do id.
 */
export function faltaColunaDeAparencia(error) {
  if (!error) return false;
  const texto = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`;
  return (error.code === "42703" || error.code === "PGRST204") && /appearance/.test(texto);
}

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

  const paraDominio = (row) => (row
    ? { ...assistantProfileToAgentDefinition(row), appearance: normalizarAparencia(row.appearance) }
    : null);

  // `undefined` = ainda não sabemos; `false` = o banco não tem a coluna.
  let comAparencia;
  const colunas = () => (comAparencia === false ? COLUNAS : `${COLUNAS}, appearance`);

  /**
   * Roda a consulta com a coluna de aparência e, se o banco disser que ela não
   * existe, refaz sem. `montar(usaAparencia)` devolve a consulta.
   */
  const comOuSemAparencia = async (montar) => {
    if (comAparencia !== false) {
      const { data, error } = await montar(true);
      if (!error) { comAparencia = true; return data ?? []; }
      if (!faltaColunaDeAparencia(error)) throw mapDatabaseError(error) ?? error;
      comAparencia = false;
    }
    return executar(montar(false));
  };

  return {
    /** Lista os agentes da organização da sessão, padrão primeiro. */
    "agents.listar": async () => {
      const ctx = await contexto();
      const rows = await comOuSemAparencia((usa) =>
        supabase
          .from("assistant_profiles")
          .select(usa ? `${COLUNAS}, appearance` : COLUNAS)
          .eq("organization_id", ctx.organizationId)
          .order("audience")
          .order("is_default", { ascending: false })
          .order("display_name"),
      );
      return rows.map(paraDominio);
    },

    "agents.ler": async ({ agentId }) => {
      const ctx = await contexto();
      const rows = await comOuSemAparencia((usa) =>
        supabase
          .from("assistant_profiles")
          .select(usa ? `${COLUNAS}, appearance` : COLUNAS)
          .eq("organization_id", ctx.organizationId)
          .eq("id", agentId),
      );
      if (!rows[0]) throw new AgentError(AGENT_ERRORS.NOT_FOUND);
      return paraDominio(rows[0]);
    },

    /**
     * Cria um agente COMUM. Nunca padrão — promover é `agents.tornarPadrao`.
     */
    "agents.criar": async ({ appearance, ...entrada }) => {
      const ctx = await contexto();
      const comando = buildCreateAgentCommand({
        ...entrada,
        organizationId: ctx.organizationId,
      });
      const aparencia = normalizarAparencia(appearance);
      const temAparencia = Object.keys(aparencia).length > 0;
      const templates = await executar(
        supabase.from("assistant_templates").select("id")
          .eq("audience", comando.audience).eq("status", "published")
          .eq("slug", comando.audience === "internal" ? "assistente-interno" : "assistente-atendimento"),
      );
      if (!templates[0]) throw new Error("O template deste público não está disponível. Contate o administrador.");
      const linha = { ...agentCommandToRow(comando, { actor: ctx.userId }), template_id: templates[0].id };
      // A aparência só vai quando foi escolhida: o agente criado sem ela fica
      // com o símbolo derivado do id, e o insert não depende da migration.
      const rows = temAparencia
        ? await comOuSemAparencia((usa) =>
          supabase.from("assistant_profiles")
            .insert(usa ? { ...linha, appearance: aparencia } : linha)
            .select(usa ? `${COLUNAS}, appearance` : COLUNAS))
        : await executar(supabase.from("assistant_profiles").insert(linha).select(colunas()));
      if (!rows[0]) throw new AgentError(AGENT_ERRORS.FORBIDDEN);
      return paraDominio(rows[0]);
    },

    /**
     * Edita identidade e comportamento. `organizationId`, `audience` e
     * `isDefault` são recusados pela camada de domínio, não aqui.
     */
    "agents.editar": async ({ agentId, appearance, ...patch }) => {
      const ctx = await contexto();
      const mudaAparencia = appearance !== undefined;
      // Só a aparência mudou: o domínio recusa patch vazio, então a linha é
      // montada aqui, só com ela.
      const linha = Object.keys(patch).length
        ? agentPatchToRow(buildUpdateAgentCommand(patch), { actor: ctx.userId })
        : { updated_by: ctx.userId };
      if (!mudaAparencia && !Object.keys(patch).length) buildUpdateAgentCommand(patch);
      if (mudaAparencia && comAparencia === false && !Object.keys(patch).length) {
        throw new Error("Guardar a aparência depende de uma atualização do banco que ainda não foi aplicada.");
      }
      const aparencia = normalizarAparencia(appearance);
      const rows = await comOuSemAparencia((usa) =>
        supabase
          .from("assistant_profiles")
          .update(usa && mudaAparencia ? { ...linha, appearance: aparencia } : linha)
          .eq("organization_id", ctx.organizationId)
          .eq("id", agentId)
          .select(usa ? `${COLUNAS}, appearance` : COLUNAS),
      );
      if (!rows[0]) throw new AgentError(AGENT_ERRORS.NOT_FOUND);
      // O banco ainda não tem a coluna: o resto foi salvo, a aparência não. Dizer
      // que salvou seria sucesso inventado.
      if (mudaAparencia && comAparencia === false) {
        throw new Error("O agente foi salvo, mas a aparência não: falta uma atualização do banco.");
      }
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
          .select(colunas()),
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
      const comportamento = {
        enabled: Boolean(enabled), priority: Number(priority), configuration, updated_by: ctx.userId,
      };
      // DO NOTHING não exige UPDATE das chaves protegidas. Se já existir,
      // atualizamos apenas o comportamento, mantendo o vínculo imutável.
      const rows = await executar(
        supabase
          .from("assistant_profile_skills")
          .upsert(
            {
              organization_id: ctx.organizationId,
              profile_id: agentId,
              skill_id: skillId,
              ...comportamento,
            },
            { onConflict: "profile_id,skill_id", ignoreDuplicates: true },
          )
          .select("skill_id, enabled, priority, configuration"),
      );
      if (rows[0]) return rows[0];
      const updated = await executar(
        supabase.from("assistant_profile_skills").update(comportamento)
          .eq("organization_id", ctx.organizationId).eq("profile_id", agentId).eq("skill_id", skillId)
          .select("skill_id, enabled, priority, configuration"),
      );
      if (!updated[0]) throw new AgentError(AGENT_ERRORS.FORBIDDEN);
      return updated[0];
    },
  };
}
