import { createClient } from "@supabase/supabase-js";

let client;

export function obterSupabaseWeb() {
  if (client) return client;
  const runtime = globalThis.__NUCLEO_CONFIG__ || {};
  const url = String(runtime.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(runtime.supabasePublishableKey || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "");
  if (!url || !key) {
    const error = new Error("O portal ainda não está conectado ao Supabase.");
    error.codigo = "supabase-nao-configurado";
    throw error;
  }
  if (!/^https:\/\//i.test(url)) throw new Error("A conexão com o Supabase precisa usar HTTPS.");
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "emyleads.supabase.auth",
    },
  });
  return client;
}
