import { describe, expect, it, vi } from "vitest";
import { criarOperacoesAuth } from "./authProvider.js";

// Uma consulta por tabela, para o teste conferir o que foi pedido a cada uma.
function dependencias({ organizacao, linhaAtualizada = null, erroAoAtualizar = null }) {
  const consultas = {};
  const criarConsulta = (tabela) => {
    const consulta = {
      select: vi.fn(() => consulta),
      eq: vi.fn(() => consulta),
      update: vi.fn(() => consulta),
      maybeSingle: vi.fn(async () =>
        tabela === "organizations" ? { data: linhaAtualizada, error: erroAoAtualizar } : { data: null, error: null }
      ),
      then(resolve) {
        const membros = [{ role: "owner", status: "active", organization: organizacao }];
        return Promise.resolve({ data: tabela === "organization_members" ? membros : [], error: null }).then(resolve);
      },
    };
    return consulta;
  };
  const supabase = {
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1", email: "a@b.c", user_metadata: {} } } }, error: null })) },
    from: vi.fn((tabela) => (consultas[tabela] ||= criarConsulta(tabela))),
    consultas,
  };
  const area = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
  return { supabase, area };
}

describe("o fuso da empresa no portal", () => {
  it("a sessão traz o fuso, e pede `*` para não quebrar o login com o banco antigo", async () => {
    const deps = dependencias({ organizacao: { id: "o1", name: "Acme", slug: "acme", timezone: "America/Manaus", created_by: "u1" } });
    const estado = await criarOperacoesAuth(deps)["auth.estado"]();
    expect(estado.organizacaoAtual).toEqual({ id: "o1", name: "Acme", slug: "acme", timezone: "America/Manaus", papel: "owner" });
    expect(deps.supabase.consultas.organization_members.select).toHaveBeenCalledWith("role,status,organization:organizations(*)");
  });

  it("banco sem a coluna: a sessão abre com o fuso nulo", async () => {
    const deps = dependencias({ organizacao: { id: "o1", name: "Acme", slug: "acme" } });
    const estado = await criarOperacoesAuth(deps)["auth.estado"]();
    expect(estado.organizacaoAtual.timezone).toBeNull();
  });

  it("grava o fuso escolhido na empresa atual", async () => {
    const deps = dependencias({
      organizacao: { id: "o1", name: "Acme", slug: "acme", timezone: "America/Sao_Paulo" },
      linhaAtualizada: { id: "o1", name: "Acme", slug: "acme", timezone: "America/Recife" },
    });
    const salvo = await criarOperacoesAuth(deps)["organizacoes.definirFuso"]({ fuso: "America/Recife" });
    expect(deps.supabase.consultas.organizations.update).toHaveBeenCalledWith({ timezone: "America/Recife" });
    expect(deps.supabase.consultas.organizations.eq).toHaveBeenCalledWith("id", "o1");
    expect(salvo.timezone).toBe("America/Recife");
  });

  it("recusa fuso fora da lista antes de ir ao banco", async () => {
    const deps = dependencias({ organizacao: { id: "o1", name: "Acme", slug: "acme" } });
    await expect(criarOperacoesAuth(deps)["organizacoes.definirFuso"]({ fuso: "Europe/Lisbon" })).rejects.toMatchObject({
      codigo: "organizacao-fuso-invalido",
    });
    expect(deps.supabase.consultas.organizations).toBeUndefined();
  });

  it("atendente: o banco devolve zero linhas e a tela recebe o motivo", async () => {
    const deps = dependencias({ organizacao: { id: "o1", name: "Acme", slug: "acme" }, linhaAtualizada: null });
    await expect(criarOperacoesAuth(deps)["organizacoes.definirFuso"]({ fuso: "America/Recife" })).rejects.toMatchObject({
      codigo: "organizacao-sem-permissao",
    });
  });
});
