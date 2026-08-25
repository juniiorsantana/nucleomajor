import { describe, expect, it } from "vitest";
import { pontuarSkill, resolverRotaSkill } from "./intelligenceRouter";

const skill = (id, slug, keywords, { fallback = false, priority = 100, negative = [] } = {}) => ({
  id, slug, name: slug, status: "published", audience: "customer",
  spec: {
    activation: { keywords, negativeKeywords: negative },
    routing: { fallback, priority },
    workflow: { initialStage: "inicio", stages: [{ id: "inicio", allowedTools: [] }] },
  },
});

const skills = [
  skill("r", "recepcao", ["oi"], { fallback: true, priority: 1000 }),
  skill("v", "vendas", ["preço", "comprar"], { priority: 20, negative: ["erro no preço"] }),
  skill("s", "suporte", ["erro", "problema"], { priority: 10 }),
  skill("a", "agenda", ["agendar"], { priority: 10 }),
];

describe("roteador determinístico H.3", () => {
  it("usa Recepção quando não há intenção explícita", () => {
    expect(resolverRotaSkill({ skills, message: "boa tarde" }).skill.slug).toBe("recepcao");
  });
  it("seleciona a intenção explícita com maior prioridade", () => {
    expect(resolverRotaSkill({ skills, message: "deu erro e problema" }).skill.slug).toBe("suporte");
  });
  it("palavra negativa impede falso positivo", () => {
    expect(pontuarSkill(skills[1], "deu erro no preço")).toBe(-1);
    expect(resolverRotaSkill({ skills, message: "deu erro no preço" }).skill.slug).toBe("suporte");
  });
  it("mantém subfluxo se não houver intenção nova", () => {
    expect(resolverRotaSkill({ skills, message: "sim", currentSkillId: "v" }).reason).toBe("active-subflow");
  });
  it("ação sensível pendente sempre volta para Agenda", () => {
    const route = resolverRotaSkill({ skills, message: "sim", currentSkillId: "v", pendingSensitiveAction: true });
    expect(route.skill.slug).toBe("agenda");
    expect(route.stageId).toBe("confirmar");
  });
});
