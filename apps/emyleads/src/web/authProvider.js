import { obterSupabaseWeb } from "./supabaseClient.js";
import { webArea } from "./storage.js";

const CHAVE_WORKSPACE = "emyleads.workspace.atual";
const CHAVE_MIGRACAO_CONTROLE = "emyleads.migracao.controle";
const PORTAL_URL = "";

const chaveMigracao = (userId, organizationId) => `${userId}:${organizationId}`;

function erroDaResposta(error, codigo = "supabase-erro") {
  const mensagens = {
    "Invalid login credentials": "E-mail ou senha incorretos.",
    "Email not confirmed": "Confirme seu e-mail antes de entrar.",
    "User already registered": "Já existe uma conta com este e-mail.",
  };
  const erro = new Error(mensagens[error?.message] || error?.message || "Falha no Supabase.");
  erro.codigo = codigo;
  return erro;
}

function usuarioPublico(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email || "",
    nome: user.user_metadata?.full_name || "",
  };
}

export function criarOperacoesAuth({ supabase = obterSupabaseWeb(), area = webArea } = {}) {
  const portalRequest = async (path, { method = "GET", body } = {}) => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw erroDaResposta(error, "sessao-falhou");
    const token = data?.session?.access_token;
    if (!token) {
      const erro = new Error("Sua sessão expirou. Entre novamente.");
      erro.codigo = "auth-expirada";
      throw erro;
    }
    const response = await fetch(`${PORTAL_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const erro = new Error(payload?.error || "Não foi possível concluir a operação do convite.");
      erro.codigo = payload?.code || "portal-convite-falhou";
      throw erro;
    }
    return payload;
  };

  const listarOrganizacoes = async (userId) => {
    const { data, error } = await supabase
      .from("organization_members")
      .select("role,status,organization:organizations(id,name,slug)")
      .eq("user_id", userId)
      .eq("status", "active");
    if (error) throw erroDaResposta(error, "organizacoes-lista-falhou");

    return (data || [])
      .map((item) => ({ ...item.organization, papel: item.role }))
      .filter((item) => item.id)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  };

  const estado = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw erroDaResposta(error, "sessao-falhou");
    const user = data?.session?.user;
    if (!user) {
      return null;
    }

    const organizacoes = await listarOrganizacoes(user.id);
    const salvo = (await area.get(CHAVE_WORKSPACE))[CHAVE_WORKSPACE];
    const organizacaoAtual =
      organizacoes.find((org) => org.id === salvo) || organizacoes[0] || null;
    if (organizacaoAtual?.id !== salvo) {
      if (organizacaoAtual) await area.set({ [CHAVE_WORKSPACE]: organizacaoAtual.id });
      else await area.remove(CHAVE_WORKSPACE);
    }

    return { usuario: usuarioPublico(user), organizacoes, organizacaoAtual };
  };

  return {
    "auth.estado": estado,

    "auth.migracaoControle": async ({ organizationId, acao = "ler" } = {}) => {
      const atual = await estado();
      const organizacao = atual?.organizacaoAtual;
      const userId = atual?.usuario?.id;
      const orgId = organizationId || organizacao?.id;
      if (!userId || !orgId) return { origem: null, preferencia: null };

      const armazenado = (await area.get(CHAVE_MIGRACAO_CONTROLE))[CHAVE_MIGRACAO_CONTROLE] || {};
      let proximo = {
        origem: armazenado.origem || null,
        preferencias: armazenado.preferencias || {},
      };
      const mesmaOrigem = proximo.origem?.userId === userId && proximo.origem?.organizationId === orgId;
      let alterado = false;

      if (acao === "registrar-origem" && !proximo.origem && organizacao?.papel === "owner") {
        proximo = {
          ...proximo,
          origem: { userId, organizationId: orgId, registradoEm: Date.now() },
        };
        alterado = true;
      }

      if (acao === "adiar" && mesmaOrigem && organizacao?.papel === "owner") {
        proximo = {
          ...proximo,
          preferencias: {
            ...proximo.preferencias,
            [chaveMigracao(userId, orgId)]: { status: "adiada", atualizadoEm: Date.now() },
          },
        };
        alterado = true;
      }

      if (acao === "reabrir" && mesmaOrigem) {
        const preferencias = { ...proximo.preferencias };
        delete preferencias[chaveMigracao(userId, orgId)];
        proximo = { ...proximo, preferencias };
        alterado = true;
      }

      if (alterado) await area.set({ [CHAVE_MIGRACAO_CONTROLE]: proximo });

      return {
        origem: proximo.origem,
        preferencia: proximo.preferencias[chaveMigracao(userId, orgId)] || null,
      };
    },

    "auth.cadastrar": async ({ email, senha, nome = "" }) => {
      const { data, error } = await supabase.auth.signUp({
        email: email?.trim(),
        password: senha,
        options: { data: { full_name: nome.trim() } },
      });
      if (error) throw erroDaResposta(error, "cadastro-falhou");
      if (!data.session) {
        return { confirmacaoPendente: true, email: data.user?.email || email?.trim() };
      }
      return estado();
    },

    "auth.entrar": async ({ email, senha }) => {
      const { error } = await supabase.auth.signInWithPassword({
        email: email?.trim(),
        password: senha,
      });
      if (error) throw erroDaResposta(error, "login-falhou");
      return estado();
    },

    "auth.sair": async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw erroDaResposta(error, "logout-falhou");
      await area.remove(CHAVE_WORKSPACE);
      return { ok: true };
    },

    "organizacoes.listar": async () => {
      const atual = await estado();
      return atual?.organizacoes || [];
    },

    "plataforma.estado": async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return { administrador: false };
      const { data, error } = await supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) throw erroDaResposta(error, "plataforma-estado-falhou");
      return { administrador: Boolean(data) };
    },

    "plataforma.emitirAcesso": async ({ email, plano = "full", dias = 7 }) => {
      const { data, error } = await supabase.rpc("issue_onboarding_access", {
        target_email: email?.trim(),
        target_plan: plano,
        valid_days: dias,
      });
      if (error) throw erroDaResposta(error, "plataforma-acesso-falhou");
      return Array.isArray(data) ? data[0] : data;
    },

    "organizacoes.criar": async ({ nome, codigo }) => {
      const { data, error } = await supabase.rpc("create_organization", {
        organization_name: nome?.trim(),
        access_code: codigo?.trim(),
      });
      if (error) throw erroDaResposta(error, "organizacao-criacao-falhou");
      await area.set({ [CHAVE_WORKSPACE]: data });
      return estado();
    },

    "organizacoes.selecionar": async ({ id }) => {
      const atual = await estado();
      const organizacao = atual?.organizacoes.find((item) => item.id === id);
      if (!organizacao) {
        const erro = new Error("Você não participa desta empresa.");
        erro.codigo = "organizacao-sem-acesso";
        throw erro;
      }
      await area.set({ [CHAVE_WORKSPACE]: id });
      return { ...atual, organizacaoAtual: organizacao };
    },

    "organizacoes.membros": async () => {
      const atual = await estado();
      if (!atual?.organizacaoAtual) return [];
      const { data, error } = await supabase
        .from("organization_members")
        .select("user_id,role,status,responsibility,joined_at,profile:profiles(id,full_name,avatar_path)")
        .eq("organization_id", atual.organizacaoAtual.id)
        .order("joined_at", { ascending: true });
      if (error) throw erroDaResposta(error, "membros-lista-falhou");
      return data || [];
    },

    "organizacoes.operadores": async ({ connectionId } = {}) => {
      const atual = await estado();
      const organizacao = atual?.organizacaoAtual?.id;
      if (!organizacao || !connectionId) return [];
      const { data, error } = await supabase.rpc("whatsapp_operator_list", {
        target_organization: organizacao,
        target_connection: connectionId,
      });
      if (error) throw erroDaResposta(error, "operadores-lista-falhou");
      return data || [];
    },

    "organizacoes.iniciarVerificacaoOperador": async ({ connectionId, usuarioId, telefone } = {}) => {
      const atual = await estado();
      const organizacao = atual?.organizacaoAtual?.id;
      if (!organizacao) throw new Error("Nenhuma empresa selecionada.");
      if (!connectionId || !usuarioId) throw new Error("Selecione a conexão e o profissional.");
      const { data, error } = await supabase.rpc("whatsapp_operator_verification_begin", {
        target_organization: organizacao,
        target_connection: connectionId,
        target_user: usuarioId,
        target_phone: String(telefone || "").trim(),
      });
      if (error) throw erroDaResposta(error, "operador-verificacao-inicio-falhou");
      return Array.isArray(data) ? data[0] || null : data;
    },

    "organizacoes.revogarOperador": async ({ operadorId } = {}) => {
      const atual = await estado();
      const organizacao = atual?.organizacaoAtual?.id;
      if (!organizacao) throw new Error("Nenhuma empresa selecionada.");
      const { data, error } = await supabase.rpc("whatsapp_operator_revoke", {
        target_organization: organizacao,
        target_operator: operadorId,
      });
      if (error) throw erroDaResposta(error, "operador-revogacao-falhou");
      return Array.isArray(data) ? data[0] || null : data;
    },

    "organizacoes.convidar": async ({ email, papel = "member" }) => {
      const atual = await estado();
      if (!atual?.organizacaoAtual) {
        const erro = new Error("Nenhuma empresa selecionada.");
        erro.codigo = "workspace-ausente";
        throw erro;
      }
      return portalRequest("/api/invitations", {
        method: "POST",
        body: { organizationId: atual.organizacaoAtual.id, email: email?.trim(), role: papel },
      });
    },

    "organizacoes.convites": async () => {
      const atual = await estado();
      if (!atual?.organizacaoAtual) return [];
      const result = await portalRequest(`/api/invitations?organizationId=${encodeURIComponent(atual.organizacaoAtual.id)}`);
      return result?.invitations || [];
    },

    "organizacoes.reenviarConvite": async ({ conviteId }) => {
      const atual = await estado();
      if (!atual?.organizacaoAtual) throw new Error("Nenhuma empresa selecionada.");
      return portalRequest(`/api/invitations/${encodeURIComponent(conviteId)}/resend`, {
        method: "POST",
        body: { organizationId: atual.organizacaoAtual.id },
      });
    },

    "organizacoes.cancelarConvite": async ({ conviteId }) => {
      const atual = await estado();
      if (!atual?.organizacaoAtual) throw new Error("Nenhuma empresa selecionada.");
      return portalRequest(`/api/invitations/${encodeURIComponent(conviteId)}/cancel`, {
        method: "POST",
        body: { organizationId: atual.organizacaoAtual.id },
      });
    },

    "organizacoes.aceitarConvite": async ({ token }) => {
      const { data, error } = await supabase.rpc("accept_organization_invite", {
        target_token: token?.trim(),
      });
      if (error) throw erroDaResposta(error, "convite-aceite-falhou");
      await area.set({ [CHAVE_WORKSPACE]: data });
      return estado();
    },

    "organizacoes.alterarPapel": async ({ usuarioId, papel }) => {
      const atual = await estado();
      const { error } = await supabase.rpc("change_organization_member_role", {
        target_organization: atual?.organizacaoAtual?.id,
        target_user: usuarioId,
        target_role: papel,
      });
      if (error) throw erroDaResposta(error, "papel-alteracao-falhou");
      return criarOperacoesAuth({ supabase, area })["organizacoes.membros"]();
    },

    "organizacoes.removerMembro": async ({ usuarioId }) => {
      const atual = await estado();
      const { error } = await supabase.rpc("remove_organization_member", {
        target_organization: atual?.organizacaoAtual?.id,
        target_user: usuarioId,
      });
      if (error) throw erroDaResposta(error, "membro-remocao-falhou");
      return criarOperacoesAuth({ supabase, area })["organizacoes.membros"]();
    },

    "organizacoes.atualizarResponsabilidade": async ({ usuarioId, responsabilidade = "" }) => {
      const atual = await estado();
      const { error } = await supabase.rpc("update_member_responsibility", {
        target_organization: atual?.organizacaoAtual?.id,
        target_user: usuarioId,
        new_responsibility: responsabilidade.trim(),
      });
      if (error) throw erroDaResposta(error, "responsabilidade-alteracao-falhou");
      return criarOperacoesAuth({ supabase, area })["organizacoes.membros"]();
    },

    "organizacoes.robos": async () => {
      const atual = await estado();
      if (!atual?.organizacaoAtual) return [];
      const { data, error } = await supabase
        .from("connection_robot_credentials")
        .select("connection_id,organization_id,status,created_at,last_used_at,revoked_at")
        .eq("organization_id", atual.organizacaoAtual.id);
      if (error) throw erroDaResposta(error, "robos-lista-falhou");
      return data || [];
    },

    "organizacoes.revogarRobo": async ({ conexaoId }) => {
      const { error } = await supabase.rpc("revoke_connection_robot", {
        target_connection: conexaoId,
      });
      if (error) throw erroDaResposta(error, "robo-revogacao-falhou");
      return { conexaoId, revogado: true };
    },
  };
}
