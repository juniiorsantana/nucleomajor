import { obterSupabaseWeb } from "./supabaseClient.js";
import { webArea, WORKSPACE_KEY } from "./storage.js";

const mapDocument = (row) => ({
  id: row.id,
  organizationId: row.organization_id,
  escopo: row.scope_type,
  usuarioId: row.scope_user_id || null,
  caminho: row.path,
  titulo: row.title,
  conteudo: row.content_markdown || "",
  status: row.status,
  versao: Number(row.version || 1),
  criadoEm: row.created_at,
  atualizadoEm: row.updated_at,
});

export function criarOperacoesConhecimento({ supabase = obterSupabaseWeb(), area = webArea } = {}) {
  const contexto = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const user = data?.session?.user;
    const organizationId = (await area.get(WORKSPACE_KEY))[WORKSPACE_KEY];
    if (!user || !organizationId) throw new Error("Entre em uma empresa para acessar o conhecimento.");
    return { userId: user.id, organizationId };
  };

  return {
    "conhecimento.listar": async () => {
      const ctx = await contexto();
      const { data, error } = await supabase.from("knowledge_documents")
        .select("id,organization_id,scope_type,scope_user_id,path,title,content_markdown,status,version,created_at,updated_at")
        .eq("organization_id", ctx.organizationId).is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapDocument);
    },

    "conhecimento.salvar": async ({ id = null, escopo, caminho, titulo, conteudo = "" }) => {
      const ctx = await contexto();
      const payload = {
        scope_type: escopo,
        scope_user_id: escopo === "personal" ? ctx.userId : null,
        path: String(caminho || "").trim(),
        title: String(titulo || "").trim(),
        content_markdown: String(conteudo || ""),
        status: "active",
        updated_by: ctx.userId,
      };
      const query = id
        ? supabase.from("knowledge_documents").update(payload)
          .eq("organization_id", ctx.organizationId).eq("id", id)
        : supabase.from("knowledge_documents").insert({
          ...payload, organization_id: ctx.organizationId, created_by: ctx.userId,
        });
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return mapDocument(data);
    },

    "conhecimento.versoes": async ({ id }) => {
      const ctx = await contexto();
      const { data, error } = await supabase.from("knowledge_document_versions")
        .select("id,document_id,version,path,title,content_markdown,status,changed_by,created_at")
        .eq("organization_id", ctx.organizationId).eq("document_id", id)
        .order("version", { ascending: false });
      if (error) throw error;
      return data || [];
    },

    "conhecimento.arquivar": async ({ id }) => {
      const ctx = await contexto();
      const { error } = await supabase.from("knowledge_documents")
        .update({ status: "archived", updated_by: ctx.userId })
        .eq("organization_id", ctx.organizationId).eq("id", id);
      if (error) throw error;
      return { id, arquivado: true };
    },
  };
}
