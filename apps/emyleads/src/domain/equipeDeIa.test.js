import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LIMITES,
  MODELOS,
  aplicarModelo,
  avaliacaoParaTela,
  chaveDe,
  chaveUnica,
  desempenhoDoAgente,
  itensDoPlaybook,
  limparPlaybook,
  normalizarPlaybook,
  playbookVazio,
  problemaDoPlaybook,
  resumoDaAvaliacao,
  sinaisParaOPlaybook,
} from "./equipeDeIa";

const MIGRATION = new URL("../../../../supabase/migrations/20261001100000_equipe_de_ia_playbook_e_jev.sql", import.meta.url);

describe("chaves", () => {
  it("nascem do nome, sem acento e começando por letra", () => {
    expect(chaveDe("Aula experimental")).toBe("aula_experimental");
    expect(chaveDe("Preço alto!")).toBe("preco_alto");
    expect(chaveDe("24 horas")).toBe("x_24_horas");
    expect(chaveDe("")).toBe("");
    expect(chaveDe("a".repeat(60)).length).toBeLessThanOrEqual(31);
  });

  it("não repetem dentro da lista", () => {
    expect(chaveUnica("Preço", ["preco"])).toBe("preco_2");
    expect(chaveUnica("Preço", ["preco", "preco_2"])).toBe("preco_3");
  });
});

describe("playbook", () => {
  it("normaliza o que vier do banco com todas as partes", () => {
    expect(normalizarPlaybook(null)).toEqual(playbookVazio());
    expect(normalizarPlaybook({ objecoes: [{ chave: "preco" }] }).objecoes[0]).toEqual({ chave: "preco", nome: "", resposta: "" });
  });

  it("limpar tira linha vazia e dá chave a quem não tem", () => {
    const limpo = limparPlaybook({
      objecoes: [{ nome: " Preço " }, { nome: "" }, { nome: "Preço" }],
      criterios: [{ pergunta: "Ofereceu a aula?", sim: "Sim" }],
      clienteIdeal: { atende: ["quem treina", " "], naoAtende: [] },
    });
    expect(limpo.objecoes.map((o) => o.chave)).toEqual(["preco", "preco_2"]);
    expect(limpo.objecoes[0].nome).toBe("Preço");
    expect(limpo.criterios[0].chave).toBe("ofereceu_a_aula");
    expect(limpo.clienteIdeal.atende).toEqual(["quem treina"]);
    expect(problemaDoPlaybook(limpo)).toBe("");
  });

  it("recusa o mesmo que o banco recusa", () => {
    expect(problemaDoPlaybook({ objecoes: [{ chave: "Preço!", nome: "x" }] })).toMatch(/chave inválida/);
    expect(problemaDoPlaybook({ objecoes: [{ chave: "preco", nome: "a" }, { chave: "preco", nome: "b" }] })).toMatch(/mesma chave/);
    expect(problemaDoPlaybook({ proximosPassos: Array.from({ length: 7 }, (_, i) => ({ chave: `passo_${i}`, nome: "x" })) })).toMatch(/no máximo 6/);
    expect(problemaDoPlaybook({ criterios: [{ chave: "abc", pergunta: "oi" }] })).toMatch(/5 a 300/);
    expect(problemaDoPlaybook({ oferta: [{ nome: "" }] })).toMatch(/precisa de nome/);
  });

  it("os limites da tela são os do banco", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const limites = JSON.parse(sql.match(/limites constant jsonb := '([^']+)'/)[1]);
    expect(limites).toEqual({
      oferta: LIMITES.oferta,
      objecoes: LIMITES.objecoes,
      proximosPassos: LIMITES.proximosPassos,
      criterios: LIMITES.criterios,
    });
    expect(sql).toContain(`> ${LIMITES.texto} then`);
  });

  it("modelo soma ao que existe e não traz preço", () => {
    const atual = { objecoes: [{ chave: "preco", nome: "Preço do dono", resposta: "a minha" }] };
    const pb = aplicarModelo(atual, "academia");
    expect(pb.objecoes[0]).toEqual({ chave: "preco", nome: "Preço do dono", resposta: "a minha" });
    expect(pb.objecoes.length).toBe(MODELOS.academia.objecoes.length);
    expect(pb.oferta).toEqual([]);
    expect(pb.segmento).toBe("academia");
    for (const segmento of Object.keys(MODELOS)) {
      expect(problemaDoPlaybook(aplicarModelo(playbookVazio(), segmento))).toBe("");
    }
  });
});

const PLAYBOOK = {
  objecoes: [{ chave: "preco", nome: "Preço" }],
  proximosPassos: [{ chave: "aula_experimental", nome: "Aula experimental" }],
  criterios: [{ chave: "ofereceu_aula", pergunta: "Ofereceu a aula experimental?" }],
};

describe("o que o Jev diz", () => {
  it("jeito, próximo passo e critérios ganham rótulo do playbook", () => {
    const itens = itensDoPlaybook({
      segue_o_jeito: { a: "nao", p: 0.8 },
      proximo_passo_oferecido: { a: "aula_experimental", p: 0.9 },
      pb_ofereceu_aula: { a: "sim", p: 0.55 },
    }, PLAYBOOK);
    expect(itens.map((i) => [i.rotulo, i.valor])).toEqual([
      ["Seguiu o jeito do agente", "Não"],
      ["Próximo passo oferecido", "Aula experimental"],
      ["Ofereceu a aula experimental?", "Incerto"],
    ]);
  });

  it("a avaliação de teste vira grupos da tela", () => {
    const resultado = { r: { segue_o_jeito: ["sim", 0.9], pergunta_sem_resposta: ["sim", 0.8], temperatura: ["quente", 0.7], lixo: "x" }, pb: 1 };
    expect(resumoDaAvaliacao(resultado)).toEqual({
      segue_o_jeito: { a: "sim", p: 0.9 },
      pergunta_sem_resposta: { a: "sim", p: 0.8 },
      temperatura: { a: "quente", p: 0.7 },
    });
    const grupos = avaliacaoParaTela(resultado, PLAYBOOK);
    expect(grupos.map((g) => g.titulo)).toEqual(["Jeito e playbook", "O atendimento", "O lead"]);
    expect(avaliacaoParaTela({}, PLAYBOOK)).toEqual([]);
  });
});

const leitura = (agente, summary, extra = {}) => ({ assistant_profile_id: agente, summary, ai_messages: 0, team_messages: 0, ...extra });

describe("desempenho do agente", () => {
  const leituras = [
    leitura("a1", { pergunta_sem_resposta: { a: "sim", p: 0.9 }, temperatura: { a: "quente", p: 0.8 }, segue_o_jeito: { a: "sim", p: 0.7 } }, { ai_messages: 3 }),
    leitura("a1", { pergunta_sem_resposta: { a: "nao", p: 0.9 }, temperatura: { a: "morno", p: 0.5 } }, { ai_messages: 1, team_messages: 2 }),
    leitura("a2", { pergunta_sem_resposta: { a: "sim", p: 0.9 } }, { team_messages: 1 }),
    leitura(null, { pergunta_sem_resposta: { a: "sim", p: 0.9 } }),
  ];

  it("conta só as leituras do agente e só respostas confiáveis", () => {
    const d = desempenhoDoAgente(leituras, "a1");
    expect(d.conversas).toBe(2);
    expect(d.perguntaSemResposta).toEqual({ total: 2, sim: 1, pct: 50 });
    expect(d.temperatura).toEqual({ frio: 0, morno: 0, quente: 1 });
    expect(d.seguiuOJeito).toEqual({ total: 1, sim: 1, pct: 100 });
    expect(d.quemAtendeu).toEqual({ soIa: 1, soEquipe: 0, ambos: 1, ninguem: 0 });
    expect(d.insatisfeito.pct).toBeNull();
  });

  it("a porta de entrada pode levar as leituras sem agente", () => {
    expect(desempenhoDoAgente(leituras, "a1", { incluirSemAgente: true }).conversas).toBe(3);
    expect(desempenhoDoAgente(leituras, "a1", { incluirSemAgente: true }).semAgente).toBe(1);
  });
});

describe("sinais para o playbook", () => {
  it("conta as objeções e separa as que caem em outra", () => {
    const s = sinaisParaOPlaybook([
      { contact_phone: "1", created_at: "2026-10-01", summary: { objecao_principal: { a: "preco", p: 0.9 } } },
      { contact_phone: "2", created_at: "2026-10-01", summary: { objecao_principal: { a: "preco", p: 0.8 } } },
      { contact_phone: "3", created_at: "2026-10-01", summary: { objecao_principal: { a: "outra", p: 0.7 } } },
      { contact_phone: "4", created_at: "2026-10-01", summary: { objecao_principal: { a: "concorrente", p: 0.7 } } },
      { contact_phone: "5", created_at: "2026-10-01", summary: { objecao_principal: { a: "nenhuma", p: 0.9 } } },
      { contact_phone: "6", created_at: "2026-10-01", summary: { objecao_principal: { a: "outra", p: 0.4 } } },
    ], PLAYBOOK);
    expect(s.objecoes).toEqual([
      { chave: "preco", nome: "Preço", qtd: 2, doPlaybook: true },
      { chave: "concorrente", nome: "Concorrente", qtd: 1, doPlaybook: false },
    ]);
    expect(s.totalOutras).toBe(1);
    expect(s.outras[0].telefone).toBe("3");
  });
});
