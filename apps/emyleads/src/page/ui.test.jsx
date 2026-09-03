import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Seletor } from "./ui";
import { OPCOES_DE_PAPEL, PAPEIS } from "../ui/papeis";

/**
 * A opção vazia do `Seletor` já mandou papel em branco para o banco.
 *
 * A Equipe passava `rotuloVazio="Atendente"` com a intenção de rotular o
 * padrão, e o componente respondia com um `<option value="">Atendente</option>`
 * acima do "Atendente" de verdade. Escolher o primeiro dos dois gravava
 * `role = ""`. O teste existe porque o defeito é invisível na tela: dois itens
 * com o mesmo texto parecem um item só.
 */
describe("Seletor", () => {
  const opcoes = [
    { id: "a", rotulo: "Primeira" },
    { id: "b", rotulo: "Segunda" },
  ];

  it("sem rotuloVazio, não oferece opção de valor vazio", () => {
    const html = renderToStaticMarkup(
      <Seletor valor="a" aoMudar={() => {}} opcoes={opcoes} />
    );
    expect(html).not.toContain('value=""');
    expect(html.match(/<option/g)).toHaveLength(opcoes.length);
  });

  it("com rotuloVazio, oferece a opção vazia que os filtros precisam", () => {
    const html = renderToStaticMarkup(
      <Seletor valor="" aoMudar={() => {}} opcoes={opcoes} rotuloVazio="Todos os status" />
    );
    expect(html).toContain('value=""');
    expect(html).toContain("Todos os status");
    expect(html.match(/<option/g)).toHaveLength(opcoes.length + 1);
  });

  it("o seletor de papel da Equipe não repete 'Atendente'", () => {
    const html = renderToStaticMarkup(
      <Seletor valor="member" aoMudar={() => {}} opcoes={OPCOES_DE_PAPEL} />
    );
    expect(html.match(new RegExp(PAPEIS.member, "g"))).toHaveLength(1);
  });
});
