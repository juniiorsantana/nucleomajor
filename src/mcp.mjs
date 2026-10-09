/**
 * O MCP do portal: Claude e ChatGPT (inclusive no celular) perguntam ao
 * Núcleo Major em nome de quem entrou. Só leitura.
 *
 * Como entra a pessoa: o Supabase Auth é o servidor OAuth 2.1 (descoberta,
 * registro dinâmico e PKCE). O cliente chega aqui sem token, recebe 401 com
 * o endereço do `.well-known`, descobre o Supabase, faz o login e aprova na
 * tela `/app/oauth/consent`. O token que volta é um JWT da própria pessoa,
 * repassado ao PostgREST: a RLS decide o que ela vê, sem `service_role`.
 *
 * O protocolo é o Streamable HTTP sem sessão e com resposta JSON: cada POST
 * é independente, sem SSE nem conexão longa (a Hostinger não precisa
 * segurar nada aberto). Escrito à mão porque são quatro métodos; o SDK
 * oficial traria express, hono e mais quinze pacotes para isso.
 */

import { TOOLS, ToolError, runTool } from "./mcpTools.mjs";

const VERSOES = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const LIMITE_CORPO = 64_000;
const TEMPO_LIMITE_MS = 10_000;
const PAGINA = 1000; // o teto de linhas por resposta do PostgREST no Supabase
const MAX_LINHAS = 10_000;

const INSTRUCOES = [
  "Dados do Núcleo Major (CRM, WhatsApp, tarefas e agenda) das empresas em que a pessoa participa. Só leitura.",
  "Para perguntas gerais do dia ('como está hoje?', 'tem algo pendente?'), use resumo_do_dia.",
  "Horários e 'hoje' são de Brasília. Responda em português, curto, pensando na leitura no celular.",
].join(" ");

class McpHttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function enviar(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(payload === undefined ? "" : JSON.stringify(payload));
}

async function lerCorpo(req) {
  let total = 0;
  const partes = [];
  for await (const parte of req) {
    total += parte.length;
    if (total > LIMITE_CORPO) throw new McpHttpError(413, "A requisição é grande demais.", "payload-too-large");
    partes.push(parte);
  }
  return Buffer.concat(partes).toString("utf8");
}

function tokenDe(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Acesso ao Supabase com o token da pessoa. `count` usa `Prefer:
 * count=exact` sem baixar linhas; `selectAll` pagina, porque o Supabase
 * corta cada resposta em mil linhas sem avisar.
 */
export function supabaseDb({ supabaseUrl, publishableKey, token, fetchImpl = fetch }) {
  async function pedir(path, { method = "GET", body, headers = {} } = {}) {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
    let resposta;
    try {
      resposta = await fetchImpl(`${supabaseUrl}${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controle.signal,
        headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
      });
    } catch {
      throw new McpHttpError(504, "O banco demorou a responder. Tente de novo.", "supabase-timeout");
    } finally {
      clearTimeout(relogio);
    }
    if (resposta.status === 401) throw new McpHttpError(401, "Sua sessão expirou. Conecte de novo.", "auth-expired");
    if (!resposta.ok) {
      const detalhe = await resposta.text().catch(() => "");
      console.error("mcp supabase failed", resposta.status, path.split("?")[0], detalhe.slice(0, 200));
      const erro = new McpHttpError(502, "O banco recusou a consulta.", "supabase-failed");
      erro.upstream = resposta.status;
      throw erro;
    }
    return resposta;
  }

  return {
    async select(path) {
      const resposta = await pedir(path);
      return resposta.json();
    },
    async selectAll(path) {
      const linhas = [];
      for (let inicio = 0; inicio < MAX_LINHAS; inicio += PAGINA) {
        const resposta = await pedir(path, { headers: { "Range-Unit": "items", Range: `${inicio}-${inicio + PAGINA - 1}` } });
        const pagina = await resposta.json();
        linhas.push(...pagina);
        if (pagina.length < PAGINA) return linhas;
      }
      console.warn("mcp selectAll truncated", path.split("?")[0]);
      return linhas;
    },
    async count(path) {
      const resposta = await pedir(path, { method: "HEAD", headers: { Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" } });
      const total = Number(String(resposta.headers.get("content-range") || "").split("/")[1]);
      if (!Number.isFinite(total)) throw new McpHttpError(502, "O banco não devolveu a contagem.", "supabase-count-missing");
      return total;
    },
    async rpc(fn, body) {
      const resposta = await pedir(`/rest/v1/rpc/${fn}`, { method: "POST", body });
      return resposta.json();
    },
  };
}

function erroRpc(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export function createMcp({ publicOrigin, supabaseUrl, publishableKey, fetchImpl = fetch, now = () => new Date() }) {
  const origem = String(publicOrigin).replace(/\/$/, "");
  const recurso = `${origem}/mcp`;
  const metadataUrl = `${origem}/.well-known/oauth-protected-resource`;
  const servidorDeAutorizacao = `${supabaseUrl}/auth/v1`;
  const desafio = (extra = "") => ({ "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}"${extra}` });

  function metadataDoRecurso() {
    return {
      resource: recurso,
      authorization_servers: [servidorDeAutorizacao],
      bearer_methods_supported: ["header"],
      resource_name: "Núcleo Major",
      resource_documentation: `${origem}/app`,
    };
  }

  async function usuarioDoToken(token) {
    if (!supabaseUrl || !publishableKey) throw new McpHttpError(503, "O portal ainda não está conectado ao banco.", "supabase-not-configured");
    const db = supabaseDb({ supabaseUrl, publishableKey, token, fetchImpl });
    let user;
    try {
      user = await db.select("/auth/v1/user");
    } catch (error) {
      // O Auth responde 401 ou 403 a token ruim; 5xx é queda, não é token.
      if (error.status === 401 || [400, 403].includes(error.upstream)) throw new McpHttpError(401, "Token inválido ou expirado.", "invalid-token");
      throw error;
    }
    if (!user?.id) throw new McpHttpError(401, "Token inválido ou expirado.", "invalid-token");
    return { user, db };
  }

  async function atender(mensagem, contexto) {
    const { id, method, params } = mensagem;
    if (method === "initialize") {
      const pedida = params?.protocolVersion;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "nucleo-major", title: "Núcleo Major", version: "0.1.0" },
          instructions: INSTRUCOES,
        },
      };
    }
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    if (method === "tools/call") {
      const nome = String(params?.name || "");
      const inicio = Date.now();
      try {
        const saida = await runTool(nome, params?.arguments, { db: contexto.db, user: contexto.user, agora: now() });
        registrar(contexto.user, nome, saida.empresa, inicio, "ok");
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: saida.text }], structuredContent: saida.data } };
      } catch (error) {
        if (error instanceof ToolError) {
          registrar(contexto.user, nome, null, inicio, "recusa");
          return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: error.message }], isError: true } };
        }
        registrar(contexto.user, nome, null, inicio, error?.code || "erro");
        if (error?.status === 401) throw error;
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: error?.message || "Não foi possível consultar agora." }], isError: true } };
      }
    }
    return erroRpc(id, -32601, `Método não suportado: ${method}`);
  }

  async function handle(req, res, url) {
    const caminho = url.pathname.replace(/\/$/, "") || "/";

    if (caminho === "/.well-known/oauth-protected-resource" || caminho === "/.well-known/oauth-protected-resource/mcp") {
      if (req.method !== "GET") return enviar(res, 405, { error: "method-not-allowed" }, { Allow: "GET" });
      return enviar(res, 200, metadataDoRecurso(), { "Cache-Control": "public, max-age=300" });
    }

    // Clientes da especificação antiga procuram o servidor de autorização no
    // próprio host do recurso. Repassa o do Supabase como ele é.
    if (caminho === "/.well-known/oauth-authorization-server" || caminho === "/.well-known/oauth-authorization-server/mcp") {
      if (!supabaseUrl) return enviar(res, 503, { error: "supabase-not-configured" });
      const resposta = await fetchImpl(`${supabaseUrl}/.well-known/oauth-authorization-server/auth/v1`).catch(() => null);
      if (!resposta?.ok) return enviar(res, 502, { error: "authorization-server-unavailable" });
      return enviar(res, 200, await resposta.json(), { "Cache-Control": "public, max-age=300" });
    }

    // caminho === "/mcp"
    if (req.method !== "POST") return enviar(res, 405, { error: "method-not-allowed" }, { Allow: "POST" });

    const token = tokenDe(req);
    if (!token) return enviar(res, 401, { error: "Entre com sua conta do Núcleo Major.", code: "auth-required" }, desafio());

    let contexto;
    try {
      contexto = await usuarioDoToken(token);
    } catch (error) {
      if (error.status === 401) return enviar(res, 401, { error: error.message, code: error.code }, desafio(', error="invalid_token"'));
      throw error;
    }

    let mensagem;
    try {
      mensagem = JSON.parse(await lerCorpo(req));
    } catch (error) {
      if (error instanceof McpHttpError) throw error;
      return enviar(res, 400, erroRpc(null, -32700, "JSON inválido."));
    }
    if (Array.isArray(mensagem) || !mensagem || typeof mensagem !== "object" || mensagem.jsonrpc !== "2.0") {
      return enviar(res, 400, erroRpc(mensagem?.id, -32600, "Requisição JSON-RPC inválida."));
    }
    // Notificação ou resposta: nada a devolver.
    if (mensagem.id === undefined || mensagem.method === undefined) return enviar(res, 202);

    try {
      return enviar(res, 200, await atender(mensagem, contexto));
    } catch (error) {
      if (error.status === 401) return enviar(res, 401, { error: error.message, code: error.code }, desafio(', error="invalid_token"'));
      throw error;
    }
  }

  return {
    matches(pathname) {
      const caminho = pathname.replace(/\/$/, "");
      return caminho === "/mcp" || caminho.startsWith("/.well-known/oauth-protected-resource") || caminho.startsWith("/.well-known/oauth-authorization-server");
    },
    handle,
  };
}

/** Uma linha por chamada: quem, o quê, de qual empresa. Nunca o conteúdo. */
function registrar(user, ferramenta, empresa, inicio, resultado) {
  console.log(JSON.stringify({
    evento: "mcp.tool",
    usuario: String(user?.id || "").slice(0, 8),
    ferramenta,
    empresa: empresa ? String(empresa.id).slice(0, 8) : null,
    ms: Date.now() - inicio,
    resultado,
  }));
}
