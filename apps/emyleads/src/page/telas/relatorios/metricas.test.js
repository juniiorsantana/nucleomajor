import { describe, expect, it } from "vitest";
import {
  aplicarFiltros, funilDaSafra, leadsDoPeriodo, metricasDoPeriodo, paraCsv, periodoDoPreset,
  periodoPersonalizado, porOrigem, serieMensal, variacao,
} from "./metricas.js";

const t = (a, m, d, h = 12) => new Date(a, m - 1, d, h).getTime();

const estagios = [
  { id: "lead", nome: "Lead", ordem: 0 },
  { id: "contato", nome: "Contato", ordem: 1 },
  { id: "proposta", nome: "Proposta", ordem: 3 },
  { id: "negociacao", nome: "Negociação", ordem: 4 },
  { id: "fechado", nome: "Fechado", ordem: 5 },
];

const contatos = [
  // Chegou em setembro e virou lead no mesmo dia.
  { id: "a", criadoEm: t(2026, 9, 2), leadEm: t(2026, 9, 2), origem: "Anúncio", responsavel: "Ana" },
  // Chegou em setembro, só contato.
  { id: "b", criadoEm: t(2026, 9, 5), leadEm: null, origem: "WhatsApp" },
  // Chegou em agosto, virou lead em setembro: lead de setembro, safra de agosto.
  { id: "c", criadoEm: t(2026, 8, 20), leadEm: t(2026, 9, 10), origem: "Anúncio", responsavel: "Bia" },
  // Chegou em setembro, lead, negócio perdido que passou por Proposta.
  { id: "d", criadoEm: t(2026, 9, 12), leadEm: t(2026, 9, 12), origem: "Site" },
];

const negocios = [
  { id: "n1", contactId: "a", stageId: "fechado", status: "ganho", valor: 1000, criadoEm: t(2026, 9, 3), atualizadoEm: t(2026, 9, 20), fechadoEm: t(2026, 9, 15) },
  { id: "n2", contactId: "c", stageId: "contato", status: "aberto", valor: 500, criadoEm: t(2026, 9, 11), atualizadoEm: t(2026, 9, 11), fechadoEm: null },
  { id: "n3", contactId: "d", stageId: "proposta", status: "perdido", motivoPerda: "Preço", valor: 800, criadoEm: t(2026, 9, 13), atualizadoEm: t(2026, 10, 2), fechadoEm: t(2026, 9, 25) },
];

const dados = { contatos, negocios, estagios };
const setembro = { inicio: t(2026, 9, 1, 0), fim: t(2026, 10, 1, 0) };

describe("metricasDoPeriodo", () => {
  it("conta contato pela criação, lead pela marca e fechamento pela data do banco", () => {
    const m = metricasDoPeriodo(dados, setembro);
    expect(m.contatosNovos).toBe(3);
    expect(m.leadsNovos).toBe(3);
    expect(m.negociosNovos).toBe(3);
    expect(m.ganhos).toBe(1);
    expect(m.valorGanho).toBe(1000);
    expect(m.perdidos).toBe(1);
    expect(m.taxaDeGanho).toBe(0.5);
    expect(m.motivosDePerda).toEqual([{ motivo: "Preço", total: 1 }]);
    expect(m.fechamentoAproximado).toBe(false);
  });

  it("sem a coluna no banco, lead fica nulo em vez de zero", () => {
    const semColuna = { ...dados, contatos: contatos.map(({ leadEm, ...c }) => c) };
    const m = metricasDoPeriodo(semColuna, setembro);
    expect(m.leadsNovos).toBeNull();
    expect(m.semMarcaDeLead).toBe(true);
  });

  it("sem closed_at, usa a última edição e avisa que é aproximado", () => {
    const antigo = { ...dados, negocios: negocios.map(({ fechadoEm, ...n }) => n) };
    const m = metricasDoPeriodo(antigo, setembro);
    expect(m.fechamentoAproximado).toBe(true);
    // n3 foi editado em outubro: sai de setembro.
    expect(m.perdidos).toBe(0);
  });
});

describe("funilDaSafra", () => {
  it("cada degrau é parte do anterior, e o histórico mostra a proposta do perdido", () => {
    const historico = [{ negocioId: "n3", paraEtapa: "proposta", paraStatus: "aberto", em: t(2026, 9, 20) }];
    const funil = funilDaSafra(dados, historico, setembro);
    expect(funil.map((d) => [d.id, d.total])).toEqual([
      ["contatos", 3], ["leads", 2], ["negocios", 2], ["proposta", 2], ["ganhos", 1],
    ]);
    expect(funil[1].doAnterior).toBeCloseTo(2 / 3);
    for (let i = 1; i < funil.length; i += 1) expect(funil[i].total).toBeLessThanOrEqual(funil[i - 1].total);
  });

  it("sem etapa de proposta, o degrau some", () => {
    const funil = funilDaSafra({ ...dados, estagios: estagios.filter((e) => e.id !== "proposta") }, [], setembro);
    expect(funil.some((d) => d.id === "proposta")).toBe(false);
  });
});

describe("filtros, origem e lista", () => {
  it("filtra pelo contato e leva os negócios dele junto", () => {
    const f = aplicarFiltros(dados, { origem: "Anúncio" });
    expect(f.contatos.map((c) => c.id)).toEqual(["a", "c"]);
    expect(f.negocios.map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("agrupa os leads do período por origem", () => {
    const linhas = porOrigem(dados, setembro);
    expect(linhas[0]).toMatchObject({ origem: "Anúncio", leads: 2, comNegocio: 2, ganhos: 1, valorGanho: 1000 });
  });

  it("lista os leads do período com a situação do negócio", () => {
    const lista = leadsDoPeriodo(dados, setembro);
    expect(lista.map((l) => [l.contato.id, l.situacao])).toEqual([["d", "Perdido"], ["c", "Contato"], ["a", "Ganho"]]);
  });
});

describe("períodos", () => {
  it("este mês vai até hoje e compara com os mesmos dias do mês anterior", () => {
    const p = periodoDoPreset("mes", t(2026, 9, 24));
    expect(p.inicio).toBe(t(2026, 9, 1, 0));
    expect(p.fim).toBe(t(2026, 9, 25, 0));
    expect(p.anterior).toEqual({ inicio: t(2026, 8, 1, 0), fim: t(2026, 8, 25, 0) });
  });

  it("no dia 31, o mês anterior de 30 dias não transborda", () => {
    const p = periodoDoPreset("mes", t(2026, 10, 31));
    expect(p.anterior.fim).toBe(t(2026, 10, 1, 0));
  });

  it("mês passado compara com o retrasado inteiro", () => {
    const p = periodoDoPreset("mes-anterior", t(2026, 9, 24));
    expect(p).toMatchObject({ inicio: t(2026, 8, 1, 0), fim: t(2026, 9, 1, 0) });
    expect(p.anterior).toEqual({ inicio: t(2026, 7, 1, 0), fim: t(2026, 8, 1, 0) });
  });

  it("personalizado inclui o último dia e aceita datas invertidas", () => {
    const p = periodoPersonalizado("2026-09-30", "2026-09-01");
    expect(p.inicio).toBe(t(2026, 9, 1, 0));
    expect(p.fim).toBe(t(2026, 10, 1, 0));
  });

  it("série mensal tem um item por mês, do mais antigo ao mais novo", () => {
    const serie = serieMensal(dados, [], { ate: t(2026, 9, 24), quantos: 3 });
    expect(serie.map((m) => m.rotulo)).toEqual(["jul/26", "ago/26", "set/26"]);
    expect(serie[2].leadsNovos).toBe(3);
    expect(serie[1].contatosNovos).toBe(1);
  });
});

describe("variacao e CSV", () => {
  it("não inventa variação sobre zero", () => {
    expect(variacao(5, 0)).toBeNull();
    expect(variacao(0, 0)).toBe(0);
    expect(variacao(6, 4)).toBe(0.5);
  });

  it("CSV com ponto e vírgula, BOM e aspas quando precisa", () => {
    const csv = paraCsv(["Nome", "Obs"], [["Ana; Silva", 'diz "oi"']]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Ana; Silva";"diz ""oi"""');
  });
});
