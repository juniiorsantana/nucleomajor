import { criarOperacoesConversasWeb } from "./conversasProvider.js";
import { CACHE_LOCAL_LIGADO, criarCacheLocal } from "./cacheLocal.js";
import { criarOperacoesAgenda } from "./agendaProvider.js";
import { criarOperacoesAuth } from "./authProvider.js";
import { obterSupabaseWeb } from "./supabaseClient.js";
import { criarOperacoesDadosWeb } from "./dataProvider.js";
import { criarOperacoesGateway } from "./gatewayProvider.js";
import { criarOperacoesConhecimento } from "./knowledgeProvider.js";
import { criarOperacoesAssistente } from "./assistantProvider.js";
import { criarOperacoesInteligencia } from "./intelligenceProvider.js";
import { criarOperacoesAgents } from "./agentsProvider.js";
import { WORKSPACE_KEY, webArea } from "./storage.js";

let operacoes;

/**
 * A cópia local das Conversas (`cacheLocal.js`), desligada até o dono decidir.
 * A gaveta é do usuário da sessão na empresa aberta, lidos a cada chamada.
 */
function cacheDasConversas(supabase) {
  if (!CACHE_LOCAL_LIGADO) return null;
  return criarCacheLocal({
    escopo: async () => {
      const { data } = await supabase.auth.getSession();
      return {
        usuario: data?.session?.user?.id || null,
        organizacao: (await webArea.get(WORKSPACE_KEY))[WORKSPACE_KEY] || null,
      };
    },
  });
}

export function obterOperacoesWeb() {
  if (operacoes) return operacoes;
  const supabase = obterSupabaseWeb();
  operacoes = {
    ...criarOperacoesDadosWeb({ supabase, area: webArea }),
    ...criarOperacoesAuth({ supabase, area: webArea }),
    ...criarOperacoesAgenda({ supabase, area: webArea }),
    ...criarOperacoesConhecimento({ supabase, area: webArea }),
    ...criarOperacoesAssistente({ supabase, area: webArea }),
    ...criarOperacoesInteligencia({ supabase, area: webArea }),
    ...criarOperacoesAgents({ supabase, area: webArea }),
    ...criarOperacoesGateway(),
    // Conversas vêm do espelho que a VPS publica no Supabase, não do gateway:
    // o runtime empurra, o portal lê. Ver `conversasProvider.js`.
    ...criarOperacoesConversasWeb({ supabase, area: webArea, cache: cacheDasConversas(supabase) }),
  };
  return operacoes;
}

export async function chamarWeb(op, args = {}) {
  const executar = obterOperacoesWeb()[op];
  if (!executar) {
    const erro = new Error(`A operação ${op} ainda não está disponível no portal.`);
    erro.codigo = "operacao-web-indisponivel";
    throw erro;
  }
  return executar(args);
}
