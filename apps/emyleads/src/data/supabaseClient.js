import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

let cliente;

function configuracao() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const erro = new Error(
      "Supabase não configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY."
    );
    erro.codigo = "supabase-nao-configurado";
    throw erro;
  }

  let url;
  try {
    url = new URL(SUPABASE_URL);
  } catch {
    const erro = new Error("A URL configurada para o Supabase é inválida.");
    erro.codigo = "supabase-url-invalida";
    throw erro;
  }

  if (url.protocol !== "https:") {
    const erro = new Error("A conexão com o Supabase precisa usar HTTPS.");
    erro.codigo = "supabase-url-insegura";
    throw erro;
  }

  return { url: url.toString().replace(/\/$/, ""), chave: SUPABASE_PUBLISHABLE_KEY };
}

/** Persistência de sessão que continua disponível quando o worker MV3 hiberna. */
export function criarStorageChrome(area = chrome.storage.local) {
  return {
    async getItem(chave) {
      const resultado = await area.get(chave);
      return resultado[chave] ?? null;
    },
    async setItem(chave, valor) {
      await area.set({ [chave]: valor });
    },
    async removeItem(chave) {
      await area.remove(chave);
    },
  };
}

/** Sessão do portal: mesma interface assíncrona do storage da extensão. */
export function criarStorageWeb(area = globalThis.localStorage) {
  return {
    async getItem(chave) {
      return area?.getItem(chave) ?? null;
    },
    async setItem(chave, valor) {
      area?.setItem(chave, valor);
    },
    async removeItem(chave) {
      area?.removeItem(chave);
    },
  };
}

export function obterSupabase() {
  if (cliente) return cliente;

  const { url, chave } = configuracao();
  cliente = createClient(url, chave, {
    auth: {
      storage: typeof chrome !== "undefined" && chrome?.storage?.local
        ? criarStorageChrome()
        : criarStorageWeb(),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: typeof window !== "undefined",
      storageKey: "emyleads.supabase.auth",
    },
  });

  return cliente;
}

/**
 * Verifica rede, gateway e Auth sem criar registros no projeto remoto.
 * A publishable key nunca faz parte do retorno nem dos erros serializados.
 */
export async function verificarConexaoSupabase({ fetchImpl = fetch, supabase } = {}) {
  const { url, chave } = configuracao();
  const inicio = Date.now();

  try {
    const resposta = await fetchImpl(`${url}/auth/v1/settings`, {
      method: "GET",
      headers: { apikey: chave },
    });

    if (!resposta.ok) {
      const erro = new Error(`O Supabase recusou a conexão (HTTP ${resposta.status}).`);
      erro.codigo = resposta.status === 401 ? "supabase-chave-invalida" : "supabase-indisponivel";
      throw erro;
    }

    const instancia = supabase || obterSupabase();
    const { data, error } = await instancia.auth.getSession();
    if (error) throw error;

    return {
      conectado: true,
      projeto: new URL(url).hostname.split(".")[0],
      auth: "disponivel",
      autenticado: Boolean(data?.session),
      latenciaMs: Date.now() - inicio,
    };
  } catch (causa) {
    if (causa?.codigo) throw causa;
    const erro = new Error("Não foi possível conectar ao Supabase. Verifique sua internet.");
    erro.codigo = "supabase-inacessivel";
    erro.causa = causa;
    throw erro;
  }
}
