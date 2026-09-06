import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { criarOperacoesAgents } from "./agentsProvider.js";
import { WORKSPACE_KEY } from "./storage.js";

const org = "338e44ca-36ab-437c-b8ac-aa7c60fee64a";
const actor = "987e6f46-81ed-4056-a06a-c8b2197add27";
const template = "10000000-0000-0000-0000-000000000002";
const grants = readFileSync(new URL("../../../../supabase/migrations/20260905160000_protege_campos_estruturais_dos_agentes.sql", import.meta.url), "utf8");
function allowed(operation, table) {
  return grants.match(new RegExp(`grant ${operation} \\(([^)]*)\\)\\s*on public\\.${table} to authenticated`, "i"))[1]
    .split(",").map((column) => column.trim());
}

function setup({ templates = [{ id: template }], existing = false, denied = false } = {}) {
  const requests = [];
  let binding = existing;
  const fetch = vi.fn(async (input, options) => {
    const url = new URL(input);
    const table = url.pathname.split("/").pop();
    const body = options.body ? JSON.parse(options.body) : null;
    const method = options.method;
    requests.push({ table, method, body, url, headers: new Headers(options.headers) });
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (method === "GET") return reply(templates);
    const columns = allowed(method === "PATCH" ? "update" : "insert", table);
    if (denied || Object.keys(body).some((key) => !columns.includes(key))) {
      return reply({ code: "42501", message: "permission denied" }, 403);
    }
    if (table === "assistant_profiles") {
      if (!body.template_id) return reply({ code: "23502", message: "template_id violates not-null constraint" }, 400);
      return reply([{ ...body, id: "new-agent", is_default: false }], 201);
    }
    if (method === "POST") {
      if (!new Headers(options.headers).get("Prefer")?.includes("resolution=ignore-duplicates")) {
        return reply({ code: "42501", message: "upsert updates protected keys" }, 403);
      }
      const previous = binding;
      binding = true;
      return reply(previous ? [] : [body], 201);
    }
    return reply(binding ? [{ skill_id: "skill", ...body }] : []);
  });
  const supabase = createClient("https://test.supabase.co", "test-key", {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
  });
  vi.spyOn(supabase.auth, "getSession").mockResolvedValue({ data: { session: { user: { id: actor } } }, error: null });
  const api = criarOperacoesAgents({ supabase, area: { get: async () => ({ [WORKSPACE_KEY]: org }) } });
  return { api, requests };
}

describe("cadastro com contrato dos grants e cliente Supabase real (HTTP simulado)", () => {
  it.each(["customer", "internal"])("cria %s com template publicado e default controlado pelo banco", async (audience) => {
    const { api, requests } = setup();
    const agent = await api["agents.criar"]({ name: "SDR", audience, isDefault: true });
    expect(agent.isDefault).toBe(false);
    const read = requests.find((r) => r.table === "assistant_templates");
    expect(read.url.searchParams.get("audience")).toBe(`eq.${audience}`);
    expect(read.url.searchParams.get("status")).toBe("eq.published");
    const insert = requests.find((r) => r.method === "POST");
    expect(insert.body).toMatchObject({ template_id: template, organization_id: org, created_by: actor });
    expect(insert.body).not.toHaveProperty("is_default");
  });

  it("não grava se não há template publicado", async () => {
    const { api, requests } = setup({ templates: [] });
    await expect(api["agents.criar"]({ name: "SDR", audience: "customer" })).rejects.toThrow(/template/i);
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  it.each([false, true])("salva habilidade sem atualizar identidade (existente=%s)", async (existing) => {
    const { api, requests } = setup({ existing });
    const row = await api["agents.definirSkill"]({ agentId: "agent", skillId: "skill", enabled: false, priority: 20 });
    expect(row).toMatchObject({ enabled: false, priority: 20 });
    for (const request of requests.filter((r) => r.method === "PATCH")) {
      expect(request.body).not.toHaveProperty("profile_id");
      expect(request.url.searchParams.get("organization_id")).toBe(`eq.${org}`);
      expect(request.url.searchParams.get("profile_id")).toBe("eq.agent");
      expect(request.url.searchParams.get("skill_id")).toBe("eq.skill");
    }
  });

  it("mantém a recusa real de permissão", async () => {
    const { api } = setup({ denied: true });
    await expect(api["agents.criar"]({ name: "SDR", audience: "customer" })).rejects.toMatchObject({ code: "AGENT_FORBIDDEN" });
  });
});
