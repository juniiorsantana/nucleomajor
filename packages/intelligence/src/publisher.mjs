import { canonicalJson } from "./catalog.mjs";

function trimUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export class SupabaseSkillRepository {
  constructor({ url, serviceRoleKey, fetchImpl = fetch }) {
    this.url = trimUrl(url);
    this.serviceRoleKey = String(serviceRoleKey || "").trim();
    this.fetchImpl = fetchImpl;
    if (!this.url || !this.serviceRoleKey) {
      throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para publicar");
    }
  }

  async request(path, options = {}) {
    const response = await this.fetchImpl(`${this.url}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        "content-type": "application/json",
        accept: "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  }

  async findPlatformSkill(slug) {
    const query = new URLSearchParams({
      owner_type: "eq.platform",
      slug: `eq.${slug}`,
      select: "id,slug,name,description,audience,status,current_version,spec",
      limit: "1",
    });
    const rows = await this.request(`skill_definitions?${query}`);
    return rows?.[0] || null;
  }

  async insert(record) {
    const rows = await this.request("skill_definitions", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(record),
    });
    return rows?.[0] || null;
  }

  async update(id, record) {
    const query = new URLSearchParams({ id: `eq.${id}` });
    const { owner_type: _ownerType, organization_id: _organizationId, slug: _slug, ...changes } = record;
    const rows = await this.request(`skill_definitions?${query}`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(changes),
    });
    return rows?.[0] || null;
  }
}

function comparable(record) {
  return canonicalJson({
    name: record.name,
    description: record.description,
    audience: record.audience,
    status: record.status,
    spec: record.spec,
  });
}

export async function publishCatalog(catalog, repository, { apply = false } = {}) {
  const results = [];
  for (const entry of catalog) {
    const record = entry.record;
    const existing = await repository.findPlatformSkill(record.slug);
    if (existing && comparable(existing) === comparable(record)) {
      results.push({ slug: record.slug, action: "unchanged", version: existing.current_version });
      continue;
    }
    const action = existing ? "update" : "insert";
    if (!apply) {
      results.push({ slug: record.slug, action, currentVersion: existing?.current_version || 0, dryRun: true });
      continue;
    }
    const saved = existing ? await repository.update(existing.id, record) : await repository.insert(record);
    const verified = await repository.findPlatformSkill(record.slug);
    if (!verified || comparable(verified) !== comparable(record)) {
      throw new Error(`verificação pós-publicação falhou para ${record.slug}`);
    }
    results.push({
      slug: record.slug,
      action,
      version: verified.current_version || saved?.current_version || null,
      id: verified.id || saved?.id || existing?.id || null,
      contentHash: verified.spec?.source?.contentHash || null,
      verified: true,
    });
  }
  return results;
}
