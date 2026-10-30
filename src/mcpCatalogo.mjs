/**
 * O catálogo do MCP: as perguntas de leitura (`mcpTools.mjs`), os
 * relatórios e a qualidade do atendimento (`mcpRelatorios.mjs`) e as
 * escritas (`mcpEscrita.mjs`).
 *
 * Leitura vale para qualquer empresa da pessoa, como desde a v1. Relatório e
 * escrita só para as empresas liberadas: o dono decidiu em 29/10/2026 abrir
 * primeiro para a Major. Abrir para os clientes pede o interruptor por
 * empresa no banco (docs/mcp/README.md, "Fora desta versão"), e então esta
 * lista sai daqui.
 */

import { TOOLS as LEITURA, ToolError, empresasDoUsuario, escolherEmpresa, runTool as rodarLeitura } from "./mcpTools.mjs";
import { TOOLS_RELATORIOS, rodarRelatorio } from "./mcpRelatorios.mjs";
import { TOOLS_ESCRITA, rodarEscrita } from "./mcpEscrita.mjs";

export { ToolError };

/** Núcleo Major. */
export const EMPRESAS_LIBERADAS = new Set(["338e44ca-36ab-437c-b8ac-aa7c60fee64a"]);

export const TOOLS = [...LEITURA, ...TOOLS_RELATORIOS, ...TOOLS_ESCRITA];

const RELATORIOS = new Set(TOOLS_RELATORIOS.map((tool) => tool.name));
const ESCRITAS = new Set(TOOLS_ESCRITA.map((tool) => tool.name));

export async function runTool(name, args, { db, user, agora = new Date(), liberadas = EMPRESAS_LIBERADAS }) {
  if (!RELATORIOS.has(name) && !ESCRITAS.has(name)) return rodarLeitura(name, args, { db, user, agora });
  const entrada = args && typeof args === "object" ? args : {};
  const empresa = escolherEmpresa(await empresasDoUsuario(db, user.id), entrada.empresa);
  if (!(liberadas || EMPRESAS_LIBERADAS).has(empresa.id)) {
    throw new ToolError(`Relatórios e alterações pelo Claude e pelo ChatGPT ainda não estão liberados para ${empresa.nome}. As consultas continuam valendo.`);
  }
  const contexto = { db, user, agora, empresa };
  const saida = ESCRITAS.has(name) ? await rodarEscrita(name, entrada, contexto) : await rodarRelatorio(name, entrada, contexto);
  return { text: `${empresa.nome}\n${saida.text}`, data: { empresa: { id: empresa.id, nome: empresa.nome }, ...saida.data }, empresa };
}
