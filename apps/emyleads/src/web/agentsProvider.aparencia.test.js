import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { criarOperacoesAgents, faltaColunaDeAparencia } from "./agentsProvider.js";
import { WORKSPACE_KEY } from "./storage.js";

const org = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";
const actor = "987e6f46-81ed-4056-a06a-c8b2197add27";
const migracao = (nome) => readFileSync(new URL(`../../../../supabase/migrations/${nome}`, import.meta.url), "utf8");
const grants = migracao("20260905160000_protege_campos_estruturais_dos_agentes.sql") + migracao("20261006100000_aparencia_do_agente.sql");

/** Colunas que `authenticated` pode gravar, somando todas as migrations lidas. */
function permitidas(operacao) {
  const re = new RegExp(`grant ${operacao} \\(([^)]*)\\)\\s*on public\\.assistant_profiles to authenticated`, "gi");
  return [...grants.matchAll(re)].flatMap((m) => m[1].split(",").map((c) => c.trim()));
}

function montar({ temColuna }) {
  const pedidos = [];
  const fetch = vi.fn(async (input, options) => {
    const url = new URL(input);
    const corpo = options.body ? JSON.parse(options.body) : null;
    pedidos.push({ metodo: options.method, url, corpo });
    const responder = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    const pedeAparencia = (url.searchParams.get("select") || "").includes("appearance") || (corpo && "appearance" in corpo);
    if (!temColuna && pedeAparencia) {
      return responder({ code: "42703", message: "column assistant_profiles.appearance does not exist" }, 400);
    }
    if (options.method === "PATCH") {
      const fora = Object.keys(corpo).filter((k) => !permitidas("update").includes(k));
      if (fora.length) return responder({ code: "42501", message: `permission denied: ${fora}` }, 403);
      return responder([{ id: "a1", display_name: "Emília", audience: "customer", active: true, ...(temColuna ? { appearance: corpo.appearance ?? {} } : {}) }]);
    }
    return responder([{ id: "a1", display_name: "Emília", audience: "customer", active: true, ...(temColuna ? { appearance: { cor: 6 } } : {}) }]);
  });
  const supabase = createClient("https://test.supabase.co", "test-key", { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } });
  vi.spyOn(supabase.auth, "getSession").mockResolvedValue({ data: { session: { user: { id: actor } } }, error: null });
  return { api: criarOperacoesAgents({ supabase, area: { get: async () => ({ [WORKSPACE_KEY]: org }) } }), pedidos };
}

describe("aparência do agente no provider", () => {
  it("reconhece o erro de coluna que ainda não existe", () => {
    expect(faltaColunaDeAparencia({ code: "42703", message: "column assistant_profiles.appearance does not exist" })).toBe(true);
    expect(faltaColunaDeAparencia({ code: "PGRST204", message: "Could not find the 'appearance' column" })).toBe(true);
    expect(faltaColunaDeAparencia({ code: "42703", message: "column outra does not exist" })).toBe(false);
  });

  it("sem a migration, a lista continua abrindo, com a aparência vazia", async () => {
    const { api, pedidos } = montar({ temColuna: false });
    const [agente] = await api["agents.listar"]();
    expect(agente.name).toBe("Emília");
    expect(agente.appearance).toEqual({});
    // tentou com a coluna uma vez e refez sem; na próxima, já vai direto
    await api["agents.listar"]();
    expect(pedidos.filter((p) => (p.url.searchParams.get("select") || "").includes("appearance"))).toHaveLength(1);
  });

  it("com a migration, lê a escolha guardada", async () => {
    const { api } = montar({ temColuna: true });
    const [agente] = await api["agents.listar"]();
    expect(agente.appearance).toEqual({ cor: 6 });
  });

  it("salvar só a aparência grava só colunas permitidas", async () => {
    const { api, pedidos } = montar({ temColuna: true });
    const salvo = await api["agents.editar"]({ agentId: "a1", appearance: { cor: 3, semente: "k2x9" } });
    expect(salvo.appearance).toEqual({ cor: 3, semente: "k2x9" });
    const patch = pedidos.find((p) => p.metodo === "PATCH");
    expect(Object.keys(patch.corpo).sort()).toEqual(["appearance", "updated_by"]);
  });

  it("sem a migration, salvar a aparência avisa em vez de fingir que salvou", async () => {
    const { api } = montar({ temColuna: false });
    await expect(api["agents.editar"]({ agentId: "a1", name: "Emília", appearance: { cor: 3 } })).rejects.toThrow(/aparência não/);
  });
});
