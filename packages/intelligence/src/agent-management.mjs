/**
 * Gestão de Agents — o vocabulário das operações de escrita.
 *
 * FASE F de docs/intelligence/MULTI-AGENT-MIGRATION.md. A FASE E liberou o
 * modelo de dados (N agentes por audience); esta camada dá as operações para
 * usá-lo sem reintroduzir, na aplicação, as ambiguidades que as FASES C–E
 * tiraram do banco.
 *
 * Este módulo é PURO: valida comandos, normaliza entrada e traduz erro de
 * banco em erro de domínio. Ele não fala com o Supabase — quem fala é
 * `apps/emyleads/src/web/agentsProvider.js`, seguindo a arquitetura que já
 * existe no produto (frontend → PostgREST com RLS, mais RPC para o que
 * precisa ser atômico). A separação é a mesma de `agent.mjs`, `catalog.mjs` e
 * `contracts/`.
 *
 * TRÊS REGRAS QUE ESTA CAMADA NÃO PODE AFROUXAR:
 *
 * 1. **Agente novo nasce comum.** `isDefault` nunca é escolhido pelo chamador
 *    de `createAgent`. Promover é ato explícito e separado (`setDefaultAgent`),
 *    e é assim porque promover por efeito colateral de criação é como uma
 *    conversa migra de agente sem ninguém ter decidido nada.
 *
 * 2. **`active` e `isDefault` são ortogonais.** Desativar o padrão NÃO promove
 *    ninguém. O runtime já sabe recusar (FASE D), e recusar é a resposta certa:
 *    um agente não herda a conversa de outro por acidente de disponibilidade.
 *
 * 3. **`soulMarkdown` é persona, não permissão.** Vale o mesmo contrato de
 *    `agent.mjs`: o Soul descreve como o agente se comporta, nunca o que ele
 *    pode fazer. Autorização é do Permission Engine, e Skills continuam
 *    entidade separada em `assistant_profile_skills`.
 */

import {
  AGENT_AUDIENCES,
  slugFromAgentName,
  validateAgentDefinition,
} from "./agent.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Erros de domínio. A UI precisa distinguir "esse nome já existe" de "o banco
 * caiu", e `23505` cru não diz isso a ninguém.
 */
export const AGENT_ERRORS = Object.freeze({
  SLUG_ALREADY_EXISTS: "AGENT_SLUG_ALREADY_EXISTS",
  DEFAULT_ALREADY_EXISTS: "AGENT_DEFAULT_ALREADY_EXISTS",
  NOT_FOUND: "AGENT_NOT_FOUND",
  FORBIDDEN: "AGENT_FORBIDDEN",
  INVALID: "AGENT_INVALID",
  AUDIENCE_IMMUTABLE: "AGENT_AUDIENCE_IMMUTABLE",
  ORGANIZATION_IMMUTABLE: "AGENT_ORGANIZATION_IMMUTABLE",
});

const MENSAGENS = Object.freeze({
  [AGENT_ERRORS.SLUG_ALREADY_EXISTS]:
    "Já existe um agente com esse identificador nesta organização.",
  [AGENT_ERRORS.DEFAULT_ALREADY_EXISTS]:
    "Esta audiência já tem um agente padrão. Troque o padrão em vez de criar outro.",
  [AGENT_ERRORS.NOT_FOUND]: "Agente não encontrado.",
  [AGENT_ERRORS.FORBIDDEN]: "Sem permissão para gerenciar agentes desta organização.",
  [AGENT_ERRORS.INVALID]: "Dados do agente inválidos.",
  [AGENT_ERRORS.AUDIENCE_IMMUTABLE]:
    "A audiência de um agente não pode ser alterada. Crie outro agente.",
  [AGENT_ERRORS.ORGANIZATION_IMMUTABLE]:
    "Um agente não pode ser movido de organização.",
});

export class AgentError extends Error {
  constructor(code, { details = null, cause = null } = {}) {
    super(MENSAGENS[code] ?? MENSAGENS[AGENT_ERRORS.INVALID]);
    this.name = "AgentError";
    this.code = code;
    this.details = details;
    if (cause) this.cause = cause;
  }
}

/**
 * Campos que `updateAgent` aceita. `organizationId` e `audience` ficam de
 * fora de propósito — ver `assertUpdatable`.
 */
export const AGENT_UPDATABLE_FIELDS = Object.freeze([
  "name",
  "slug",
  "role",
  "tone",
  "soulMarkdown",
  "active",
]);

function textoOuNulo(valor, { max = Infinity } = {}) {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  if (!texto) return null;
  return texto.slice(0, max);
}

/**
 * Normaliza o comando de criação. O slug sai da REGRA CANÔNICA
 * (`slugFromAgentName`, a mesma que `private.agent_slug` espelha e que
 * `test/agent-slug-equivalence.test.mjs` prova equivalente) — esta camada não
 * cria uma terceira implementação.
 *
 * `isDefault` é sempre `false`: agente nasce comum. Ver regra 1 do cabeçalho.
 */
export function buildCreateAgentCommand(input) {
  if (!input || typeof input !== "object") {
    throw new AgentError(AGENT_ERRORS.INVALID, { details: ["comando deve ser um objeto"] });
  }

  const organizationId = String(input.organizationId ?? "");
  const audience = input.audience;
  const name = String(input.name ?? "").trim();
  const slug = input.slug ? String(input.slug).trim() : slugFromAgentName(name, audience);

  const comando = {
    organizationId,
    audience,
    name,
    slug,
    role: textoOuNulo(input.role),
    tone: textoOuNulo(input.tone, { max: 500 }),
    soulMarkdown: textoOuNulo(input.soulMarkdown),
    active: input.active === undefined ? true : Boolean(input.active),
    isDefault: false,
  };

  const errors = [];
  if (!UUID_PATTERN.test(comando.organizationId)) {
    errors.push("organizationId deve ser um uuid");
  }
  if (!AGENT_AUDIENCES.has(comando.audience)) {
    errors.push("audience deve ser internal ou customer");
  }
  if (comando.name.length < 2 || comando.name.length > 100) {
    errors.push("name deve ser um texto entre 2 e 100 caracteres");
  }
  if (!SLUG_PATTERN.test(comando.slug)) {
    errors.push("slug possui formato inválido");
  }
  if (comando.tone !== null && comando.tone.length > 500) {
    errors.push("tone deve ter até 500 caracteres");
  }
  if (errors.length) throw new AgentError(AGENT_ERRORS.INVALID, { details: errors });

  return comando;
}

/**
 * Recusa mudança de identidade estrutural.
 *
 * `organizationId` nunca muda: mover agente de organização atravessaria o
 * isolamento que toda a RLS do produto sustenta.
 *
 * `audience` também não. Ela não é um atributo de exibição — decide qual
 * conhecimento o agente enxerga (`interno` vs `externo`), quais skills podem
 * ser amarradas, se há transferência humana, e qual índice parcial de padrão
 * ele disputa. Um agente de clientes com contexto, skills e campanhas
 * amarradas que virasse `internal` levaria tudo isso junto para um público que
 * nunca deveria ver. Trocar audiência é criar outro agente, e é mais barato
 * dizer isso do que migrar as consequências.
 */
export function assertUpdatable(patch) {
  if (!patch || typeof patch !== "object") {
    throw new AgentError(AGENT_ERRORS.INVALID, { details: ["patch deve ser um objeto"] });
  }
  if ("organizationId" in patch || "organization_id" in patch) {
    throw new AgentError(AGENT_ERRORS.ORGANIZATION_IMMUTABLE);
  }
  if ("audience" in patch) {
    throw new AgentError(AGENT_ERRORS.AUDIENCE_IMMUTABLE);
  }
  if ("isDefault" in patch || "is_default" in patch) {
    // Trocar padrão é `setDefaultAgent`, que é atômico. Deixar isso passar por
    // um patch genérico reabriria o "update um false, update outro true" que a
    // FASE F existe para fechar.
    throw new AgentError(AGENT_ERRORS.INVALID, {
      details: ["isDefault não é editável por updateAgent; use setDefaultAgent"],
    });
  }
  return true;
}

/**
 * Normaliza o patch de atualização, mantendo só os campos permitidos.
 */
export function buildUpdateAgentCommand(patch) {
  assertUpdatable(patch);

  const comando = {};
  if ("name" in patch) {
    const name = String(patch.name ?? "").trim();
    if (name.length < 2 || name.length > 100) {
      throw new AgentError(AGENT_ERRORS.INVALID, {
        details: ["name deve ser um texto entre 2 e 100 caracteres"],
      });
    }
    comando.name = name;
  }
  if ("slug" in patch) {
    const slug = String(patch.slug ?? "").trim();
    if (!SLUG_PATTERN.test(slug)) {
      throw new AgentError(AGENT_ERRORS.INVALID, { details: ["slug possui formato inválido"] });
    }
    comando.slug = slug;
  }
  if ("role" in patch) comando.role = textoOuNulo(patch.role);
  if ("tone" in patch) comando.tone = textoOuNulo(patch.tone, { max: 500 });
  if ("soulMarkdown" in patch) comando.soulMarkdown = textoOuNulo(patch.soulMarkdown);
  if ("active" in patch) comando.active = Boolean(patch.active);

  if (!Object.keys(comando).length) {
    throw new AgentError(AGENT_ERRORS.INVALID, { details: ["nada para atualizar"] });
  }
  return comando;
}

/**
 * Um AgentDefinition (camelCase, do domínio) vira a linha de
 * `assistant_profiles` (snake_case, do banco).
 */
export function agentCommandToRow(comando, { actor }) {
  return {
    organization_id: comando.organizationId,
    audience: comando.audience,
    display_name: comando.name,
    slug: comando.slug,
    role: comando.role,
    tone: comando.tone ?? undefined,
    soul_markdown: comando.soulMarkdown,
    active: comando.active,
    is_default: false,
    created_by: actor,
    updated_by: actor,
  };
}

export function agentPatchToRow(comando, { actor }) {
  const row = { updated_by: actor };
  if ("name" in comando) row.display_name = comando.name;
  if ("slug" in comando) row.slug = comando.slug;
  if ("role" in comando) row.role = comando.role;
  if ("tone" in comando) row.tone = comando.tone;
  if ("soulMarkdown" in comando) row.soul_markdown = comando.soulMarkdown;
  if ("active" in comando) row.active = comando.active;
  return row;
}

/**
 * Traduz erro do Postgres/PostgREST em erro de domínio.
 *
 * A UI não pode receber `23505` cru: os dois índices únicos de
 * `assistant_profiles` que um gestor consegue violar significam coisas
 * diferentes e pedem ações diferentes — renomear o agente, ou trocar o padrão
 * em vez de criar outro.
 */
export function mapDatabaseError(error) {
  if (!error) return null;
  const code = error.code ?? error.status ?? null;
  const texto = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();

  if (code === "23505" || texto.includes("duplicate key")) {
    if (texto.includes("one_default")) {
      return new AgentError(AGENT_ERRORS.DEFAULT_ALREADY_EXISTS, { cause: error });
    }
    if (texto.includes("slug")) {
      return new AgentError(AGENT_ERRORS.SLUG_ALREADY_EXISTS, { cause: error });
    }
    return new AgentError(AGENT_ERRORS.SLUG_ALREADY_EXISTS, { cause: error });
  }
  if (code === "42501" || texto.includes("row-level security") || texto.includes("permission denied")) {
    return new AgentError(AGENT_ERRORS.FORBIDDEN, { cause: error });
  }
  if (texto.includes("agent not found")) {
    return new AgentError(AGENT_ERRORS.NOT_FOUND, { cause: error });
  }
  if (texto.includes("organization management required")) {
    return new AgentError(AGENT_ERRORS.FORBIDDEN, { cause: error });
  }
  return null;
}

/**
 * Valida a lista devolvida pela leitura, para a UI não receber linha meia-boca
 * sem perceber. Reusa `validateAgentDefinition` de `agent.mjs`.
 */
export function assertAgentsValid(agents) {
  const problemas = [];
  for (const agent of agents) {
    const errors = validateAgentDefinition(agent);
    if (errors.length) problemas.push({ id: agent?.id ?? null, errors });
  }
  return problemas;
}
