import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Bot, Cable, MessageSquare, Settings, SquareCheckBig, Workflow } from "lucide-react";
import { Marca, Rail } from "./ui";

/**
 * O trilho Instrumento (Sistema Grafite, 02/10/2026).
 *
 * O que ele promete e um teste consegue ver sem navegador: os destinos de
 * trabalho e de automação ficam no trilho; os da organização saem dele; e
 * contagem só aparece quando chega, nunca um zero inventado.
 */
const TELAS = [
  { id: "conversas", rotulo: "Conversas", icone: MessageSquare, grupo: "Atendimento", atalho: "C" },
  { id: "tarefas", rotulo: "Tarefas", icone: SquareCheckBig, grupo: "Gestão", atalho: "T" },
  { id: "conhecimento", rotulo: "Equipe de IA", icone: Bot, grupo: "Automação", atalho: "I", tom: "ia" },
  { id: "chatbots", rotulo: "Fluxos", icone: Workflow, grupo: "Automação", atalho: "X", tom: "flow" },
  { id: "conexoes", rotulo: "Conexões", icone: Cable, grupo: "Ambiente" },
  { id: "config", rotulo: "Configurações", icone: Settings, grupo: "Ambiente" },
];

const trilho = (props = {}) =>
  renderToStaticMarkup(<Rail telas={TELAS} ativa="conversas" aoTrocar={() => {}} {...props} />).split("Navegação móvel")[0];

describe("trilho Instrumento", () => {
  it("desenha trabalho e automação, e deixa a organização para o menu de baixo", () => {
    const html = trilho();
    for (const rotulo of ["Conversas", "Tarefas", "Equipe de IA", "Fluxos"]) expect(html).toContain(`aria-label="${rotulo}"`);
    expect(html).not.toContain('aria-label="Conexões"');
    expect(html).not.toContain('aria-label="Configurações"');
  });

  it("IA e Fluxos levam a cor do ator", () => {
    const html = trilho();
    expect(html).toMatch(/aria-label="Equipe de IA"[^>]*text-ia/);
    expect(html).toMatch(/aria-label="Fluxos"[^>]*text-flow/);
  });

  it("marca o destino ativo e mostra o atalho na dica", () => {
    const html = trilho();
    expect(html).toMatch(/aria-current="page"[^>]*aria-label="Conversas"/);
    expect(html).toContain("G C");
  });

  it("contagem só aparece quando chega, e diz o que está esperando", () => {
    expect(trilho()).not.toMatch(/bg-signal px-1/);
    const html = trilho({ contagens: { tarefas: { numero: 3, texto: "3 suas para hoje" } } });
    expect(html).toContain('aria-label="Tarefas, 3 suas para hoje"');
    expect(html).toContain(">3<");
  });

  it("acima de 99, a contagem vira 99+", () => {
    const html = trilho({ contagens: { tarefas: { numero: 140, texto: "140 suas para hoje" } } });
    expect(html).toContain(">99+<");
  });
});

describe("Marca", () => {
  it("é Núcleo Major, não mais EmyLeads", () => {
    const html = renderToStaticMarkup(<Marca />);
    expect(html).toContain("Núcleo Major");
    expect(html).not.toContain("Emy");
  });
});
