import "dotenv/config";

const baseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const secret = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const organizationId = String(process.argv[2] || "").trim();

if (!baseUrl || !secret) {
  throw new Error("Configure SUPABASE_URL e SUPABASE_SECRET_KEY para executar o diagnóstico.");
}
if (!/^[0-9a-f-]{36}$/i.test(organizationId)) {
  throw new Error("Informe o UUID da organização como primeiro argumento.");
}

const headers = {
  apikey: secret,
  Authorization: `Bearer ${secret}`,
  Accept: "application/json",
};

async function read(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(`Supabase respondeu ${response.status} em ${path.split("?")[0]} (${payload.code || "sem-codigo"}).`);
  }
  return response.json();
}

const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
const org = encodeURIComponent(organizationId);
const created = encodeURIComponent(since);
const [events, actions] = await Promise.all([
  read(`/rest/v1/calendar_events?select=id,owner_id,starts_at,ends_at,status,visibility,deleted_at,created_at&organization_id=eq.${org}&created_at=gte.${created}&order=created_at.desc&limit=50`),
  read(`/rest/v1/assistant_pending_actions?select=id,operator_user_id,kind,status,expires_at,last_error_code,created_at,updated_at,payload&organization_id=eq.${org}&created_at=gte.${created}&order=created_at.desc&limit=50`),
]);

const safeEvents = events.map((item) => ({
  id: item.id,
  ownerId: item.owner_id,
  inicio: item.starts_at,
  fim: item.ends_at,
  status: item.status,
  visibilidade: item.visibility,
  excluido: Boolean(item.deleted_at),
  criadoEm: item.created_at,
}));
const safeActions = actions.map((item) => ({
  id: item.id,
  userId: item.operator_user_id,
  tipo: item.kind,
  status: item.status,
  inicio: item.payload?.inicio || null,
  fim: item.payload?.fim || null,
  erro: item.last_error_code || null,
  expiraEm: item.expires_at,
  criadoEm: item.created_at,
  atualizadoEm: item.updated_at,
}));

console.log(JSON.stringify({ events: safeEvents, pendingActions: safeActions }, null, 2));
