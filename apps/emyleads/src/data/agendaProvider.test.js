import { describe, expect, it, vi } from "vitest";
import { criarOperacoesAgenda } from "./agendaProvider";

function dependencias({ role = "member", evento = null, rpcData = [] } = {}) {
  const valores = { "emyleads.workspace.atual": "org-1" };
  const auth = { getSession: vi.fn(async () => ({ data: { session: { user: { id: "user-1" } } }, error: null })) };
  const membro = {
    select: () => membro,
    eq: () => membro,
    maybeSingle: async () => ({ data: { role, status: "active" }, error: null }),
  };
  const calendario = {
    select: () => calendario,
    eq: () => calendario,
    maybeSingle: async () => ({ data: { organization_id: "org-1", provider: "google", calendar_id: null, display_name: "Agenda compartilhada", enabled: false }, error: null }),
  };
  const categorias = {
    select: () => categorias,
    eq: () => categorias,
    order: () => categorias,
    limit: () => categorias,
    maybeSingle: async () => ({ data: { id: "category-1", position: 4 }, error: null }),
    single: async () => ({ data: { id: "category-2", name: "Visita", color: "#123ABC", active: true }, error: null }),
  };
  categorias.insert = vi.fn(() => categorias);
  categorias.update = vi.fn(() => categorias);
  const inserted = { data: evento || { id: "event-1", title: "Reunião", description: "", starts_at: "2026-08-21T12:00:00.000Z", ends_at: "2026-08-21T13:00:00.000Z", all_day: false, kind: "appointment", visibility: "personal", owner_id: "user-1", organization_id: "org-1" }, error: null };
  const eventos = {
    select: () => eventos,
    single: async () => inserted,
  };
  const atualizacao = {
    eq: () => atualizacao,
    select: () => atualizacao,
    single: async () => inserted,
  };
  const supabase = {
    auth,
    from: vi.fn((nome) => nome === "organization_members" ? membro : nome === "organization_calendars" ? calendario : nome === "calendar_categories" ? categorias : eventos),
    rpc: vi.fn(async () => ({ data: rpcData, error: null })),
  };
  eventos.insert = vi.fn(() => eventos);
  eventos.update = vi.fn(() => atualizacao);
  atualizacao.update = vi.fn(() => atualizacao);
  const area = {
    get: vi.fn(async (chave) => ({ [chave]: valores[chave] })),
    set: vi.fn(),
  };
  return { supabase, area, eventos, atualizacao, categorias };
}

const janela = {
  de: "2026-08-17T03:00:00.000Z",
  ate: "2026-08-24T03:00:00.000Z",
};

describe("provider da Agenda compartilhada", () => {
  it("lista eventos e tarefas pelo RPC com o contrato em português", async () => {
    const deps = dependencias({ rpcData: [{
      id: "event-1",
      source_type: "event",
      task_id: null,
      organization_id: "org-1",
      owner_id: "user-1",
      owner_name: "Ana",
      title: "Reunião",
      description: "Pauta",
      starts_at: "2026-08-21T12:00:00.000Z",
      ends_at: "2026-08-21T13:00:00.000Z",
      all_day: false,
      kind: "appointment",
      visibility: "organization",
      contact_id: null,
      status: "scheduled",
    }] });
    const operacoes = criarOperacoesAgenda(deps);

    const lista = await operacoes["agenda.listar"](janela);

    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: "event-1", titulo: "Reunião", visibilidade: "organization", ownerName: "Ana" });
    expect(deps.supabase.rpc).toHaveBeenCalledWith("calendar_events_list", expect.objectContaining({ target_organization: "org-1" }));
  });

  it("cria evento pessoal com o usuário atual como dono", async () => {
    const deps = dependencias();
    const operacoes = criarOperacoesAgenda(deps);

    await operacoes["agenda.criar"]({
      titulo: "Bloqueio pessoal",
      inicio: "2026-08-21T10:00:00-03:00",
      fim: "2026-08-21T11:00:00-03:00",
      tipo: "block",
      visibilidade: "personal",
      categoryId: "category-1",
    });

    expect(deps.eventos.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: "org-1",
      owner_id: "user-1",
      created_by: "user-1",
      kind: "block",
      visibility: "personal",
    }));
  });

  it("recusa evento da empresa para membro comum antes do RLS", async () => {
    const deps = dependencias({ role: "member" });
    const operacoes = criarOperacoesAgenda(deps);

    await expect(operacoes["agenda.criar"]({
      titulo: "Evento corporativo",
      inicio: "2026-08-21T10:00:00-03:00",
      fim: "2026-08-21T11:00:00-03:00",
      tipo: "event",
      visibilidade: "organization",
      categoryId: "category-1",
    })).rejects.toMatchObject({ codigo: "agenda-organizacional-sem-permissao" });
    expect(deps.eventos.insert).not.toHaveBeenCalled();
  });

  it("não aceita intervalo invertido", async () => {
    const deps = dependencias();
    const operacoes = criarOperacoesAgenda(deps);

    await expect(operacoes["agenda.criar"]({
      titulo: "Horário inválido",
      inicio: "2026-08-21T11:00:00-03:00",
      fim: "2026-08-21T10:00:00-03:00",
    })).rejects.toMatchObject({ codigo: "agenda-intervalo-invalido" });
  });

  it("carrega contexto multi-profissional sem consultar dados sensíveis diretamente", async () => {
    const contexto = { members: [{ id: "user-1", name: "Ana" }], categories: [{ id: "category-1", name: "Reunião" }] };
    const deps = dependencias({ role: "admin", rpcData: contexto });
    const operacoes = criarOperacoesAgenda(deps);

    await expect(operacoes["agenda.contexto"]()).resolves.toMatchObject({
      organizationId: "org-1",
      userId: "user-1",
      papel: "admin",
      members: contexto.members,
    });
    expect(deps.supabase.rpc).toHaveBeenCalledWith("calendar_context", { target_organization: "org-1" });
  });

  it("permite que administrador crie categoria da organização", async () => {
    const deps = dependencias({ role: "admin" });
    const operacoes = criarOperacoesAgenda(deps);

    await operacoes["agenda.categoriaSalvar"]({ nome: "Visita", cor: "#123abc" });

    expect(deps.categorias.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: "org-1",
      created_by: "user-1",
      name: "Visita",
      color: "#123ABC",
      position: 5,
    }));
  });

  it("recusa configuração de categoria para membro comum", async () => {
    const deps = dependencias({ role: "member" });
    const operacoes = criarOperacoesAgenda(deps);
    await expect(operacoes["agenda.categoriaSalvar"]({ nome: "Visita", cor: "#123ABC" }))
      .rejects.toMatchObject({ codigo: "agenda-categoria-sem-permissao" });
    expect(deps.categorias.insert).not.toHaveBeenCalled();
  });
});
