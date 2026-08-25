export const normalizarIntencao = (value) => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

const bool = (value) => value === true || value === "true";

export function pontuarSkill(skill, message) {
  const text = normalizarIntencao(message);
  const spec = skill?.spec || {};
  const negative = (spec.activation?.negativeKeywords || []).map(normalizarIntencao);
  if (negative.some((keyword) => keyword && text.includes(keyword))) return -1;
  return (spec.activation?.keywords || []).map(normalizarIntencao)
    .filter((keyword) => keyword && text.includes(keyword)).length;
}

export function resolverRotaSkill({ skills = [], message = "", currentSkillId = null, pendingSensitiveAction = false, audience = "customer" } = {}) {
  const enabled = skills.filter((skill) => skill?.status === "published" && [audience, "both"].includes(skill.audience));
  const fallback = enabled.find((skill) => bool(skill.spec?.routing?.fallback)) || null;
  let selected = null;
  let reason = "fallback";
  if (pendingSensitiveAction) {
    selected = enabled.find((skill) => skill.slug === "agenda") || null;
    reason = "pending-sensitive-action";
  }
  if (!selected) {
    selected = enabled.map((skill) => ({ skill, score: pontuarSkill(skill, message) }))
      .filter((item) => item.score > 0 && !bool(item.skill.spec?.routing?.fallback))
      .sort((left, right) => right.score - left.score
        || Number(left.skill.spec?.routing?.priority ?? 1000) - Number(right.skill.spec?.routing?.priority ?? 1000)
        || left.skill.name.localeCompare(right.skill.name, "pt-BR"))[0]?.skill || null;
    if (selected) reason = "explicit-intent";
  }
  if (!selected && currentSkillId) {
    selected = enabled.find((skill) => skill.id === currentSkillId && !bool(skill.spec?.routing?.fallback)) || null;
    if (selected) reason = "active-subflow";
  }
  selected ||= fallback;
  const initialStage = pendingSensitiveAction && selected?.slug === "agenda"
    ? "confirmar" : selected?.spec?.workflow?.initialStage || "acolher";
  const stage = (selected?.spec?.workflow?.stages || []).find((item) => item.id === initialStage) || null;
  return { skill: selected, stage, stageId: initialStage, reason };
}
