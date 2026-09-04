/**
 * AgentDefinition — o conceito canônico de "agente" no domínio.
 *
 * Hoje a persistência ainda é `assistant_profiles`, com
 * `unique (organization_id, audience)`: exatamente um agente interno e um
 * de cliente por organização. Este módulo NÃO muda isso. Ele cria o
 * vocabulário do modelo multi-agent e um adapter puro
 * (`assistantProfileToAgentDefinition`) para ler o modelo antigo com o nome
 * novo:
 *
 *   assistant_profiles (persistência atual)
 *          ↓ adapter
 *   AgentDefinition (conceito novo)
 *
 * Ver docs/intelligence/MULTI-AGENT-MIGRATION.md para o plano de fases e
 * para a lista dos pontos que hoje assumem unicidade.
 *
 * DUAS REGRAS ARQUITETURAIS DESTE MÓDULO:
 *
 * 1. `soulMarkdown` é persona, não permissão. Descreve quem o agente é e
 *    como se comporta. Autorização (que ferramenta pode usar, que dado pode
 *    ler) NUNCA vive aqui — isso é do Permission Engine, que ainda não
 *    existe. Um `soulMarkdown` pode pedir "seja formal"; não pode conceder
 *    `crm.contact.upsert`.
 *
 * 2. Skills não são copiadas para dentro do agente. A relação
 *    agente ↔ skills já existe em `assistant_profile_skills` (N:N por
 *    `profile_id`, não por audience) e continua sendo uma entidade
 *    independente. AgentDefinition não tem — e não deve ganhar — campo
 *    `skills`, `allowedTools` ou equivalente.
 */

export const AGENT_AUDIENCES = Object.freeze(new Set(["internal", "customer"]));
export const AGENT_STATUSES = Object.freeze(new Set(["active", "inactive"]));

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Espelha os limites reais das colunas de assistant_profiles:
// display_name → length(trim()) between 2 and 100; tone → length <= 500.
const NAME_MIN = 2;
const NAME_MAX = 100;
const TONE_MAX = 500;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableText(value, { max = Infinity } = {}) {
  if (value === null) return true;
  return typeof value === "string" && value.length <= max;
}

/**
 * A REGRA CANÔNICA de slug de agente. Existe em dois lugares, de propósito:
 * aqui, e em `private.agent_slug` (migration
 * 20260904160000_identidade_do_agente_em_assistant_profiles.sql), que fez o
 * backfill e preenche toda linha nova. Os dois NÃO podem divergir — a
 * equivalência é provada em `test/agent-slug-equivalence.test.mjs` e por um
 * bloco de prova dentro da própria migration, ambos rodando o corpus de
 * `test/fixtures/agent/agent-slug-cases.json`. Mudar esta função sem
 * mudar a SQL (e o corpus) quebra os dois testes de propósito.
 *
 * `slug` é identidade TÉCNICA e estável: calculada uma vez, não reescrita
 * quando `display_name` muda. `name`/`display_name` é a identidade HUMANA.
 * Os dois não são equivalentes e não devem ser tratados como tal.
 *
 * Enquanto a unicidade por audience existir, um slug por organização não
 * colide na prática; num mundo multi-agent, dois agentes de mesmo nome na
 * mesma organização gerariam o mesmo slug — a análise de colisão está em
 * docs/intelligence/MULTI-AGENT-MIGRATION.md.
 */
export function slugFromAgentName(name, audience) {
  const slug = String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `agente-${audience}`;
}

/**
 * Valida um AgentDefinition. Retorna uma lista de erros (vazia = válido),
 * no mesmo estilo de `validateSkillPackage` (catalog.mjs) e
 * `validateIntelligenceRequest` (contracts/).
 */
export function validateAgentDefinition(agent) {
  const errors = [];
  if (!isObject(agent)) return ["AgentDefinition deve ser um objeto"];

  if (typeof agent.id !== "string" || !UUID_PATTERN.test(agent.id)) {
    errors.push("id deve ser um uuid");
  }
  if (typeof agent.organizationId !== "string" || !UUID_PATTERN.test(agent.organizationId)) {
    errors.push("organizationId deve ser um uuid");
  }
  const name = typeof agent.name === "string" ? agent.name.trim() : "";
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    errors.push(`name deve ser um texto entre ${NAME_MIN} e ${NAME_MAX} caracteres`);
  }
  if (typeof agent.slug !== "string" || !SLUG_PATTERN.test(agent.slug)) {
    errors.push("slug possui formato inválido");
  }
  if (!AGENT_AUDIENCES.has(agent.audience)) {
    errors.push("audience deve ser internal ou customer");
  }
  if (!AGENT_STATUSES.has(agent.status)) {
    errors.push("status deve ser active ou inactive");
  }
  if (!isNullableText(agent.role)) {
    errors.push("role deve ser um texto ou null");
  }
  if (!isNullableText(agent.tone, { max: TONE_MAX })) {
    errors.push(`tone deve ser um texto de até ${TONE_MAX} caracteres ou null`);
  }
  if (!isNullableText(agent.soulMarkdown)) {
    errors.push("soulMarkdown deve ser um texto ou null");
  }
  if (typeof agent.isDefault !== "boolean") {
    errors.push("isDefault deve ser booleano");
  }

  return errors;
}

/**
 * Adapter puro: uma linha de `assistant_profiles` (como o Postgres a
 * devolve, em snake_case) vira um AgentDefinition. Não toca no banco, não
 * altera query nenhuma, não inventa permissão.
 *
 * Desde a FASE B (migration
 * 20260904160000_identidade_do_agente_em_assistant_profiles.sql), o BANCO é
 * a fonte da verdade de `slug`, `role` e `soul_markdown`. O adapter lê as
 * colunas.
 *
 * O fallback de `slug` (derivar de `display_name`) continua aqui como
 * COMPATIBILIDADE DE TRANSIÇÃO — para linha vinda de fixture antiga ou de
 * um banco onde a migration ainda não foi aplicada. Ele não é fonte da
 * verdade: assim que a migration estiver implantada em todos os ambientes,
 * esse ramo deixa de ser exercitado por dados reais (no banco a coluna é
 * `not null`, e um gatilho preenche toda linha nova). `role` e
 * `soul_markdown` não têm fallback nenhum: sem coluna, saem `null`, porque
 * inventar persona é pior do que não ter.
 *
 * Desde a FASE C (migration `20260904190000_agente_padrao_explicito.sql`),
 * `is_default` é coluna: o banco é a fonte da verdade de quem é o agente
 * padrão. O fallback `true` continua apenas como compatibilidade de
 * transição, para linha de fixture antiga ou banco sem a migration — e ele é
 * correto só porque `unique (organization_id, audience)` ainda existe, o que
 * torna a única linha daquela audience necessariamente a padrão. Quando a
 * FASE E remover essa unique, este fallback deixa de ser defensável e precisa
 * sair junto.
 *
 * `isDefault` é ortogonal a `status`: um agente padrão pode estar inativo.
 * Quem decide o que fazer nesse caso é o resolvedor (recusar, não escolher
 * outro), não este adapter.
 *
 * Colunas reais deliberadamente não representadas (registradas, não
 * descartadas em silêncio): `template_id`, `brand_config`, `process_config`
 * (que hoje carrega rollout e sessionPolicy), `created_by`/`updated_by`,
 * `created_at`/`updated_at`.
 */
export function assistantProfileToAgentDefinition(row) {
  if (!isObject(row)) return null;
  const name = typeof row.display_name === "string" ? row.display_name.trim() : "";
  const slugPersistido = typeof row.slug === "string" && row.slug.trim() ? row.slug.trim() : null;
  return {
    id: row.id ?? null,
    organizationId: row.organization_id ?? null,
    name,
    slug: slugPersistido ?? slugFromAgentName(name, row.audience),
    audience: row.audience ?? null,
    role: typeof row.role === "string" ? row.role : null,
    tone: typeof row.tone === "string" ? row.tone : null,
    soulMarkdown: typeof row.soul_markdown === "string" ? row.soul_markdown : null,
    status: row.active === false ? "inactive" : "active",
    isDefault: typeof row.is_default === "boolean" ? row.is_default : true,
  };
}
