import { criarOperacoesAgenda } from "./agendaProvider.js";
import { criarOperacoesAuth } from "./authProvider.js";
import { obterSupabaseWeb } from "./supabaseClient.js";
import { criarOperacoesDadosWeb } from "./dataProvider.js";
import { criarOperacoesGateway } from "./gatewayProvider.js";
import { criarOperacoesConhecimento } from "./knowledgeProvider.js";
import { criarOperacoesAssistente } from "./assistantProvider.js";
import { criarOperacoesInteligencia } from "./intelligenceProvider.js";
import { webArea } from "./storage.js";

let operacoes;

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
    ...criarOperacoesGateway(),
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
