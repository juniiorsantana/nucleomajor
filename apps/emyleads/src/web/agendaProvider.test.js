import { describe, expect, it, vi } from "vitest";
import { criarOperacoesAgenda } from "./agendaProvider";

function bancada(insertError = null) {
  const member = {
    select: () => member,
    eq: () => member,
    maybeSingle: async () => ({ data: { role: "member", status: "active" }, error: null }),
  };
  const events = {
    insert: vi.fn(() => events),
    select: () => events,
    single: async () => ({
      data: {
        id: "event-1", organization_id: "org-1", owner_id: "user-1",
        title: "Compromisso pessoal", description: "", starts_at: "2026-08-31T23:00:00.000Z",
        ends_at: "2026-09-01T01:00:00.000Z", all_day: false, kind: "appointment",
        visibility: "personal", status: "scheduled",
      },
      error: insertError,
    }),
  };
  return {
    events,
    deps: {
      area: { get: vi.fn(async (key) => ({ [key]: "org-1" })) },
      supabase: {
        auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: "user-1" } } }, error: null })) },
        from: vi.fn((table) => table === "organization_members" ? member : events),
      },
    },
  };
}

const NOTURNO = {
  titulo: "Compromisso pessoal",
  inicio: "2026-08-31T20:00:00-03:00",
  fim: "2026-08-31T22:00:00-03:00",
  visibilidade: "personal",
  categoryId: "category-1",
};

describe("provider web da Agenda", () => {
  it("mantém paridade e permite compromisso pessoal noturno", async () => {
    const { deps, events } = bancada();
    await criarOperacoesAgenda(deps)["agenda.criar"](NOTURNO);
    expect(events.insert).toHaveBeenCalledWith(expect.objectContaining({
      starts_at: "2026-08-31T23:00:00.000Z",
      ends_at: "2026-09-01T01:00:00.000Z",
      visibility: "personal",
    }));
  });

  it("traduz a restrição de sobreposição", async () => {
    const { deps } = bancada({ code: "23P01", message: "exclusion constraint" });
    await expect(criarOperacoesAgenda(deps)["agenda.criar"](NOTURNO))
      .rejects.toMatchObject({ codigo: "agenda-conflito" });
  });
});

