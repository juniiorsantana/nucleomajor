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
  audiencia: row.audience || "internal",
  publicadoEm: row.published_at || null,
  versao: Number(row.version || 1),
  criadoEm: row.created_at,
  atualizadoEm: row.updated_at,
  // A lista mostra "há 3 dias · Juniior". O nome não vem daqui: a tela cruza
  // este id com `organizacoes.membros`, que já traz o perfil. Puxar o join
  // aqui exigiria a policy de profiles valer para knowledge_documents.
  atualizadoPor: row.updated_by || null,
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
        .select("id,organization_id,scope_type,scope_user_id,path,title,content_markdown,status,audience,published_at,version,created_at,updated_at,updated_by")
        .eq("organization_id", ctx.organizationId).is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapDocument);
    },

    /** Documento e coleções são salvos pela mesma transação no banco. */
    "conhecimento.salvar": async ({ id = null, escopo, caminho, titulo, conteudo = "", audiencia = "internal", colecoesIds = null, publicado = false }) => {
      const ctx = await contexto();
      const { data, error } = await supabase.rpc("nucleo_knowledge_save", {
        target_organization: ctx.organizationId,
        target_document: id,
        document_scope: escopo,
        document_path: String(caminho || "").trim(),
        document_title: String(titulo || "").trim(),
        document_content: String(conteudo || ""),
        document_audience: audiencia === "external" ? "external" : "internal",
        collection_ids: Array.isArray(colecoesIds) ? [...new Set(colecoesIds)] : [],
        publish_document: Boolean(publicado),
      });
      if (error) throw error;
      return mapDocument(data);
    },

    /**
     * A prévia da etapa de revisão.
     *
     * Não passa pela busca real de propósito: o documento em teste ainda é
     * rascunho, e desde 20260828170000 rascunho não é encontrado. A RPC recebe
     * o texto que está na tela — inclusive o que nunca foi salvo — e responde
     * com o mesmo Postgres, o mesmo dicionário e os mesmos pesos que a busca
     * de verdade usaria depois de publicado.
     */
    "conhecimento.testar": async ({ titulo = "", caminho = "", conteudo = "", pergunta = "" }) => {
      await contexto();
      const { data, error } = await supabase.rpc("nucleo_knowledge_preview", {
        document_title: String(titulo || ""),
        document_path: String(caminho || ""),
        document_text: String(conteudo || ""),
        question: String(pergunta || ""),
      });
      if (error) throw error;
      return {
        consulta: data?.consulta || "",
        casou: Boolean(data?.casou),
        trecho: data?.trecho || "",
        relevancia: Number(data?.relevancia || 0),
      };
    },

    "conhecimento.versoes": async ({ id }) => {
      const ctx = await contexto();
      const { data, error } = await supabase.from("knowledge_document_versions")
        .select("id,document_id,version,path,title,content_markdown,status,audience,published_at,changed_by,created_at")
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
