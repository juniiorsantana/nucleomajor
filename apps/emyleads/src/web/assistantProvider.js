import { obterSupabaseWeb } from "./supabaseClient.js";
import { webArea, WORKSPACE_KEY } from "./storage.js";

const origin = "";

export function criarOperacoesAssistente({ supabase = obterSupabaseWeb(), area = webArea } = {}) {
  const request = async (path, options = {}) => {
    const { onProgress, ...fetchOptions } = options;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const token = data?.session?.access_token;
    const organizationId = (await area.get(WORKSPACE_KEY))[WORKSPACE_KEY];
    if (!token || !organizationId) throw new Error("Sua sessão expirou.");
    const response = await fetch(`${origin}${path}`, {
      ...fetchOptions,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(fetchOptions.headers || {}),
      },
    });
    if (/text\/event-stream/i.test(response.headers.get("content-type") || "")) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("O navegador não conseguiu acompanhar a resposta do assistente.");
      const decoder = new TextDecoder();
      let buffer = "";
      let result = null;
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const event = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
          const raw = frame.match(/^data:\s*(.+)$/m)?.[1];
          const payload = raw ? JSON.parse(raw) : {};
          if (event === "status") onProgress?.(payload.message || "Processando…");
          if (event === "result") result = payload;
          if (event === "error") {
            const failure = new Error(payload.error || "O assistente não respondeu.");
            failure.codigo = payload.code || "assistant-failed";
            throw failure;
          }
        }
        if (done) break;
      }
      if (!result) throw new Error("O assistente encerrou a resposta antes de concluir.");
      return { ...result, organizationId };
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const failure = new Error(payload?.error || "O assistente não respondeu.");
      failure.codigo = payload?.code || "assistant-failed";
      throw failure;
    }
    return { ...payload, organizationId };
  };

  const organization = async () => (await area.get(WORKSPACE_KEY))[WORKSPACE_KEY];

  return {
    "assistente.conversas": async () => {
      const organizationId = await organization();
      return request(`/api/assistant/threads?organizationId=${encodeURIComponent(organizationId)}`);
    },
    "assistente.mensagens": async ({ threadId }) => {
      const organizationId = await organization();
      return request(`/api/assistant/messages?organizationId=${encodeURIComponent(organizationId)}&threadId=${encodeURIComponent(threadId)}`);
    },
    "assistente.enviar": async ({ threadId = null, content, onProgress = null }) => {
      const organizationId = await organization();
      return request("/api/assistant/messages", {
        method: "POST",
        headers: { Accept: "text/event-stream" },
        body: JSON.stringify({ organizationId, threadId, content }),
        onProgress,
      });
    },
    "assistente.decidir": async ({ toolRunId, decision }) => {
      const organizationId = await organization();
      return request(`/api/assistant/tool-runs/${encodeURIComponent(toolRunId)}/decision`, {
        method: "POST",
        body: JSON.stringify({ organizationId, decision }),
      });
    },
  };
}
