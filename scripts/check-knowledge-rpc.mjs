import "dotenv/config";

const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const secret = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "");

if (!baseUrl || !secret) {
  throw new Error("Configure SUPABASE_URL e SUPABASE_SECRET_KEY para verificar o runtime de conhecimento.");
}

const headers = { apikey: secret, "Content-Type": "application/json" };
if (!secret.startsWith("sb_secret_")) headers.Authorization = `Bearer ${secret}`;

const response = await fetch(`${baseUrl}/rest/v1/rpc/nucleo_knowledge_save`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    target_organization: "00000000-0000-0000-0000-000000000000",
    target_document: null,
    document_scope: "personal",
    document_path: "verificacao/nao-gravar.md",
    document_title: "Verificação sem gravação",
    document_content: "",
    document_audience: "internal",
    collection_ids: [],
    publish_document: false,
  }),
});

const body = await response.text();
if (response.status === 404 || /PGRST202|Could not find the function/i.test(body)) {
  console.error("CONHECIMENTO_RPC_AUSENTE");
  process.exitCode = 1;
} else if (/authentication required|organization membership required/i.test(body)) {
  console.log("CONHECIMENTO_RPC_DISPONIVEL");
} else {
  console.error(`CONHECIMENTO_RPC_INCONCLUSIVO status=${response.status}`);
  process.exitCode = 2;
}
