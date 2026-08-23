import { describe, expect, it, vi } from "vitest";
import { criarOperacoesAuth } from "./authProvider";

function dependencias({ sessao = null, membros = [] } = {}) {
  const valores = {};
  const consulta = {
    select: vi.fn(() => consulta),
    eq: vi.fn(() => consulta),
    order: vi.fn(() => consulta),
    maybeSingle: vi.fn(async () => ({ data: membros[0] || null, error: null })),
    then(resolve) {
      return Promise.resolve({ data: membros, error: null }).then(resolve);
    },
  };
  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: sessao }, error: null })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signUp: vi.fn(async () => ({ data: { session: sessao, user: sessao?.user }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: vi.fn(() => consulta),
    rpc: vi.fn(async () => ({ data: "org-nova", error: null })),
  };
  const area = {
    get: vi.fn(async (chave) => ({ [chave]: valores[chave] })),
    set: vi.fn(async (novos) => Object.assign(valores, novos)),
    remove: vi.fn(async (chave) => delete valores[chave]),
  };
  return { supabase, area, valores };
}

describe("operações de autenticação", () => {
  it("retorna nulo sem uma sessão", async () => {
    const deps = dependencias();
    const operacoes = criarOperacoesAuth(deps);
    expect(await operacoes["auth.estado"]()).toBeNull();
    expect(deps.supabase.from).not.toHaveBeenCalled();
  });

  it("seleciona a primeira organização válida e persiste a escolha", async () => {
    const sessao = {
      user: { id: "user-1", email: "ana@empresa.com", user_metadata: { full_name: "Ana" } },
    };
    const deps = dependencias({
      sessao,
      membros: [
        { role: "owner", status: "active", organization: { id: "org-1", name: "Acme", slug: "acme" } },
      ],
    });
    const operacoes = criarOperacoesAuth(deps);

    const estado = await operacoes["auth.estado"]();

    expect(estado.usuario).toEqual({ id: "user-1", email: "ana@empresa.com", nome: "Ana" });
    expect(estado.organizacaoAtual.id).toBe("org-1");
    expect(deps.valores["emyleads.workspace.atual"]).toBe("org-1");
  });

  it("vincula a migração ao dono e persiste o adiamento por organização", async () => {
    const sessao = { user: { id: "user-1", email: "ana@empresa.com", user_metadata: {} } };
    const deps = dependencias({
      sessao,
      membros: [
        { role: "owner", status: "active", organization: { id: "org-1", name: "Acme", slug: "acme" } },
      ],
    });
    const operacoes = criarOperacoesAuth(deps);

    const origem = await operacoes["auth.migracaoControle"]({ organizationId: "org-1", acao: "registrar-origem" });
    expect(origem.origem).toMatchObject({ userId: "user-1", organizationId: "org-1" });

    const adiada = await operacoes["auth.migracaoControle"]({ organizationId: "org-1", acao: "adiar" });
    expect(adiada.preferencia.status).toBe("adiada");

    const lida = await operacoes["auth.migracaoControle"]({ organizationId: "org-1" });
    expect(lida.preferencia.status).toBe("adiada");

    const reaberta = await operacoes["auth.migracaoControle"]({ organizationId: "org-1", acao: "reabrir" });
    expect(reaberta.preferencia).toBeNull();
  });

  it("não registra origem de migração para um profissional membro", async () => {
    const sessao = { user: { id: "user-2", email: "bruno@empresa.com", user_metadata: {} } };
    const deps = dependencias({
      sessao,
      membros: [
        { role: "member", status: "active", organization: { id: "org-1", name: "Acme", slug: "acme" } },
      ],
    });
    const operacoes = criarOperacoesAuth(deps);

    const controle = await operacoes["auth.migracaoControle"]({ organizationId: "org-1", acao: "registrar-origem" });
    expect(controle.origem).toBeNull();
    expect(deps.valores["emyleads.migracao.controle"]).toBeUndefined();
  });

  it("não permite selecionar uma organização fora das associações", async () => {
    const sessao = { user: { id: "user-1", email: "ana@empresa.com", user_metadata: {} } };
    const deps = dependencias({ sessao, membros: [] });
    const operacoes = criarOperacoesAuth(deps);

    await expect(
      operacoes["organizacoes.selecionar"]({ id: "outra" })
    ).rejects.toMatchObject({ codigo: "organizacao-sem-acesso" });
  });

  it("exige a liberação comercial ao criar uma organização", async () => {
    const sessao = { user: { id: "user-1", email: "ana@empresa.com", user_metadata: {} } };
    const deps = dependencias({ sessao, membros: [] });
    const operacoes = criarOperacoesAuth(deps);

    await operacoes["organizacoes.criar"]({ nome: "Acme", codigo: "NM12-3456-7890-AB" });

    expect(deps.supabase.rpc).toHaveBeenCalledWith("create_organization", {
      organization_name: "Acme",
      access_code: "NM12-3456-7890-AB",
    });
  });

  it("somente expõe a administração da plataforma para um administrador cadastrado", async () => {
    const sessao = { user: { id: "user-1", email: "admin@nucleomajor.com", user_metadata: {} } };
    const deps = dependencias({ sessao, membros: [{ user_id: "user-1" }] });
    const operacoes = criarOperacoesAuth(deps);

    await expect(operacoes["plataforma.estado"]()).resolves.toEqual({ administrador: true });
  });

  it("emite uma liberação Full vinculada ao e-mail informado", async () => {
    const sessao = { user: { id: "user-1", email: "admin@nucleomajor.com", user_metadata: {} } };
    const deps = dependencias({ sessao });
    const liberacao = { access_code: "NM12-3456-7890-AB", email: "cliente@empresa.com" };
    deps.supabase.rpc.mockResolvedValueOnce({ data: [liberacao], error: null });
    const operacoes = criarOperacoesAuth(deps);

    await expect(operacoes["plataforma.emitirAcesso"]({ email: " cliente@empresa.com " })).resolves.toEqual(liberacao);
    expect(deps.supabase.rpc).toHaveBeenCalledWith("issue_onboarding_access", {
      target_email: "cliente@empresa.com",
      target_plan: "full",
      valid_days: 7,
    });
  });

  it("salva a responsabilidade no escopo da organização atual", async () => {
    const sessao = { user: { id: "user-1", email: "ana@empresa.com", user_metadata: {} } };
    const deps = dependencias({
      sessao,
      membros: [
        { role: "owner", status: "active", organization: { id: "org-1", name: "Acme", slug: "acme" } },
      ],
    });
    const operacoes = criarOperacoesAuth(deps);

    await operacoes["organizacoes.atualizarResponsabilidade"]({
      usuarioId: "user-2",
      responsabilidade: "  Cuida das propostas  ",
    });

    expect(deps.supabase.rpc).toHaveBeenCalledWith("update_member_responsibility", {
      target_organization: "org-1",
      target_user: "user-2",
      new_responsibility: "Cuida das propostas",
    });
  });

  it("revoga somente a credencial da conexão informada", async () => {
    const deps = dependencias();
    const operacoes = criarOperacoesAuth(deps);

    expect(await operacoes["organizacoes.revogarRobo"]({ conexaoId: "conn-1" })).toEqual({
      conexaoId: "conn-1",
      revogado: true,
    });
    expect(deps.supabase.rpc).toHaveBeenCalledWith("revoke_connection_robot", {
      target_connection: "conn-1",
    });
  });

  it("envia convites pelo portal autenticado, sem devolver token ao navegador", async () => {
    const sessao = {
      access_token: "jwt-do-administrador",
      user: { id: "user-1", email: "ana@empresa.com", user_metadata: {} },
    };
    const deps = dependencias({
      sessao,
      membros: [
        { role: "owner", status: "active", organization: { id: "org-1", name: "Acme", slug: "acme" } },
      ],
    });
    const resposta = { inviteId: "invite-1", email: "nova@empresa.com", delivery: "sent" };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => resposta }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const operacoes = criarOperacoesAuth(deps);
      await expect(operacoes["organizacoes.convidar"]({ email: "nova@empresa.com", papel: "member" })).resolves.toEqual(resposta);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/invitations"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer jwt-do-administrador" }),
          body: JSON.stringify({ organizationId: "org-1", email: "nova@empresa.com", role: "member" }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
