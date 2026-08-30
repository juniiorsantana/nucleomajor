import { obterSupabaseWeb } from "./supabaseClient.js";
import { webArea, WORKSPACE_KEY } from "./storage.js";

const slug = (value) => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const array = (value) => Array.isArray(value) ? value : [];

export function criarOperacoesInteligencia({ supabase = obterSupabaseWeb(), area = webArea } = {}) {
  const contexto = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const user = data?.session?.user;
    const organizationId = (await area.get(WORKSPACE_KEY))[WORKSPACE_KEY];
    if (!user || !organizationId) throw new Error("Entre em uma empresa para configurar a inteligência.");
    return { userId: user.id, organizationId };
  };

  const executar = async (promise) => {
    const { data, error } = await promise;
    if (error) throw error;
    return data || [];
  };

  return {
    "inteligencia.carregar": async () => {
      const ctx = await contexto();
      const org = ctx.organizationId;
      const [templates, profiles, skills, skillVersions, bindings, collections, documentCollections, campaigns,
        sources, campaignSkills, campaignCollections, simulations, audit, pilotContacts, contacts] = await Promise.all([
        executar(supabase.from("assistant_templates").select("*").order("audience")),
        executar(supabase.from("assistant_profiles").select("*").eq("organization_id", org).order("audience")),
        executar(supabase.from("skill_definitions").select("*").or(`owner_type.eq.platform,organization_id.eq.${org}`).order("owner_type").order("name")),
        // Sem o `spec`. A tela usa apenas `id`, `skill_id` e `version` para
        // montar os botões de rollback — a restauração acontece na RPC
        // `intelligence_skill_rollback`, que lê o spec no banco. Trazer
        // `select("*")` carregava a especificação completa de até 200 versões,
        // com o `instructionsMarkdown` de cada uma, para o navegador.
        //
        // Não há filtro de organização porque `skill_versions` não tem essa
        // coluna: o isolamento vem da policy `skill_versions_read`, que junta
        // com `skill_definitions` e exige plataforma publicada ou participação
        // na organização dona.
        executar(supabase.from("skill_versions")
          .select("id,skill_id,version,name,description,audience,status,changed_by,created_at")
          .order("created_at", { ascending: false }).limit(200)),
        executar(supabase.from("assistant_profile_skills").select("*").eq("organization_id", org).order("priority")),
        executar(supabase.from("knowledge_collections").select("*").eq("organization_id", org).order("audience").order("name")),
        executar(supabase.from("knowledge_document_collections").select("*").eq("organization_id", org)),
        executar(supabase.from("organization_campaigns").select("*").eq("organization_id", org).order("updated_at", { ascending: false })),
        executar(supabase.from("campaign_sources").select("*").eq("organization_id", org).order("priority")),
        executar(supabase.from("campaign_skills").select("*").eq("organization_id", org).order("priority")),
        executar(supabase.from("campaign_knowledge_collections").select("*").eq("organization_id", org)),
        executar(supabase.from("intelligence_simulations").select("id,audience,input_excerpt,resolved_context,created_at").eq("organization_id", org).order("created_at", { ascending: false }).limit(20)),
        executar(supabase.from("intelligence_audit_log").select("id,entity_type,entity_id,action,version,metadata,created_at").eq("organization_id", org).order("created_at", { ascending: false }).limit(80)),
        executar(supabase.from("customer_assistant_pilot_contacts").select("*").eq("organization_id", org).eq("active", true)),
        executar(supabase.from("contacts").select("id,name,phone,whatsapp_id,company,updated_at").eq("organization_id", org).is("deleted_at", null).order("name")),
      ]);
      return { templates, profiles, skills, skillVersions, bindings, collections, documentCollections, campaigns, sources, campaignSkills, campaignCollections, simulations, audit, pilotContacts, contacts };
    },

    "inteligencia.salvarPerfil": async ({ id, nome, tom, marca = {}, processo = {}, ativo = true }) => {
      const ctx = await contexto();
      const rows = await executar(supabase.from("assistant_profiles").update({
        display_name: String(nome || "").trim(), tone: String(tom || "").trim(),
        brand_config: marca, process_config: processo, active: Boolean(ativo), updated_by: ctx.userId,
      }).eq("organization_id", ctx.organizationId).eq("id", id).select("*"));
      if (!rows[0]) throw new Error("Assistente não encontrado ou sem permissão para editar.");
      return rows[0];
    },

    "inteligencia.configurarRollout": async ({ profileId, mode, contactIds = [] }) => {
      await contexto();
      const { data, error } = await supabase.rpc("customer_assistant_rollout_update", {
        target_profile: profileId,
        rollout_mode: mode,
        selected_contacts: array(contactIds),
      });
      if (error) throw error;
      return data;
    },

    "inteligencia.listarAtendimentos": async () => {
      const ctx = await contexto();
      return executar(supabase.from("customer_handoff_requests")
        .select("id,status,reason_code,summary,requested_at:created_at,accepted_at,completed_at,accepted_by,last_error_code,contact:contacts!customer_handoff_requests_contact_id_fkey(id,name,phone,whatsapp_id,company)")
        .eq("organization_id", ctx.organizationId)
        .order("requested_at", { ascending: false })
        .limit(200));
    },

    "inteligencia.transicionarAtendimento": async ({ requestId, action }) => {
      await contexto();
      const { data, error } = await supabase.rpc("customer_handoff_transition", {
        target_request: requestId,
        requested_action: action,
      });
      if (error) throw error;
      return data;
    },

    "inteligencia.salvarSkill": async ({ id = null, nome, descricao = "", audiencia = "customer", spec = {}, profileIds = [] }) => {
      const ctx = await contexto();
      const payload = {
        name: String(nome || "").trim(), description: String(descricao || "").trim(),
        audience: audiencia, spec, status: "published", updated_by: ctx.userId,
      };
      const rows = id
        ? await executar(supabase.from("skill_definitions").update(payload)
          .eq("organization_id", ctx.organizationId).eq("owner_type", "organization").eq("id", id).select("*"))
        : await executar(supabase.from("skill_definitions").insert({
          ...payload, owner_type: "organization", organization_id: ctx.organizationId,
          slug: slug(nome), created_by: ctx.userId,
        }).select("*"));
      const skill = rows[0];
      if (!skill) throw new Error("Skill não encontrado ou sem permissão para editar.");
      for (const profileId of array(profileIds)) {
        await executar(supabase.from("assistant_profile_skills").upsert({
          organization_id: ctx.organizationId, profile_id: profileId, skill_id: skill.id,
          enabled: true, priority: 100, updated_by: ctx.userId,
        }, { onConflict: "profile_id,skill_id" }));
      }
      return skill;
    },

    "inteligencia.configurarSkill": async ({ profileId, skillId, enabled, priority = 100, configuration = {} }) => {
      const ctx = await contexto();
      const rows = await executar(supabase.from("assistant_profile_skills").upsert({
        organization_id: ctx.organizationId, profile_id: profileId, skill_id: skillId,
        enabled: Boolean(enabled), priority: Number(priority), configuration, updated_by: ctx.userId,
      }, { onConflict: "profile_id,skill_id" }).select("*"));
      return rows[0];
    },

    "inteligencia.salvarColecao": async ({ id = null, nome, descricao = "", audiencia = "internal", escopo = "organization" }) => {
      const ctx = await contexto();
      const payload = {
        name: String(nome || "").trim(), description: String(descricao || "").trim(),
        audience: audiencia, scope_type: escopo, updated_by: ctx.userId,
      };
      const rows = id
        ? await executar(supabase.from("knowledge_collections").update(payload)
          .eq("organization_id", ctx.organizationId).eq("id", id).select("*"))
        : await executar(supabase.from("knowledge_collections").insert({
          ...payload, organization_id: ctx.organizationId, slug: slug(nome),
          created_by: ctx.userId, scope_user_id: escopo === "personal" ? ctx.userId : null,
        }).select("*"));
      return rows[0];
    },

    "inteligencia.salvarCampanha": async ({ id = null, nome, status = "draft", objetivo = "", oferta = "", publico = "", resultado = "", padrao = false, inicio = null, fim = null, configuracao = {}, profileId, fontes = [], skillIds = [], collectionIds = [] }) => {
      const ctx = await contexto();
      const payload = {
        name: String(nome || "").trim(), status, objective: objetivo, offer: oferta,
        audience_description: publico, desired_outcome: resultado, is_default: Boolean(padrao),
        starts_at: inicio || null, ends_at: fim || null, configuration: configuracao,
        assistant_profile_id: profileId, updated_by: ctx.userId,
      };
      const rows = id
        ? await executar(supabase.from("organization_campaigns").update(payload)
          .eq("organization_id", ctx.organizationId).eq("id", id).select("*"))
        : await executar(supabase.from("organization_campaigns").insert({
          ...payload, organization_id: ctx.organizationId, created_by: ctx.userId,
        }).select("*"));
      const campaign = rows[0];
      if (!campaign) throw new Error("Campanha não encontrada ou sem permissão para editar.");

      await Promise.all([
        executar(supabase.from("campaign_sources").delete().eq("organization_id", ctx.organizationId).eq("campaign_id", campaign.id)),
        executar(supabase.from("campaign_skills").delete().eq("organization_id", ctx.organizationId).eq("campaign_id", campaign.id)),
        executar(supabase.from("campaign_knowledge_collections").delete().eq("organization_id", ctx.organizationId).eq("campaign_id", campaign.id)),
      ]);
      const sourceRows = array(fontes).filter((item) => item?.tipo).map((item, index) => ({
        organization_id: ctx.organizationId, campaign_id: campaign.id,
        source_type: item.tipo, source_value: String(item.valor || "").trim(),
        priority: Number(item.prioridade ?? index * 10 + 10), active: item.ativo !== false,
      }));
      if (sourceRows.length) await executar(supabase.from("campaign_sources").insert(sourceRows));
      if (array(skillIds).length) await executar(supabase.from("campaign_skills").insert(array(skillIds).map((skillId, index) => ({
        organization_id: ctx.organizationId, campaign_id: campaign.id, skill_id: skillId, priority: index * 10 + 10,
      }))));
      if (array(collectionIds).length) await executar(supabase.from("campaign_knowledge_collections").insert(array(collectionIds).map((collectionId) => ({
        organization_id: ctx.organizationId, campaign_id: campaign.id, collection_id: collectionId,
      }))));
      return campaign;
    },

    "inteligencia.simular": async ({ audiencia = "customer", mensagem, origem = {} }) => {
      const ctx = await contexto();
      const { data, error } = await supabase.rpc("intelligence_context_preview", {
        target_organization: ctx.organizationId, target_audience: audiencia,
        incoming_text: String(mensagem || "").trim(), source_data: origem,
      });
      if (error) throw error;
      return data;
    },

    "inteligencia.restaurarSkill": async ({ skillId, versao }) => {
      await contexto();
      const { data, error } = await supabase.rpc("intelligence_skill_rollback", {
        target_skill: skillId,
        target_version: Number(versao),
      });
      if (error) throw error;
      return data;
    },
  };
}
