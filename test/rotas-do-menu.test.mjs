import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Todo destino do menu precisa de um slug no roteador da web.
 *
 * Este teste nasceu de um bug que ficou em produção sem ninguém achar a causa:
 * clicar em "Conversas" abria o Assistente, e só o SEGUNDO clique ficava na
 * tela certa.
 *
 * A causa era uma linha ausente. `Gestao.jsx` lista os destinos em `TELAS`;
 * `web/main.jsx` traduz destino em URL com `screenToSlug`. "conversas" estava
 * na primeira lista e não na segunda. O clique trocava a tela e em seguida
 * navegava para `screenToSlug["conversas"]`, que era `undefined` e caía no
 * fallback — a URL virava outra coisa, e o efeito que sincroniza tela com URL
 * devolvia a tela. No segundo clique a URL já estava no fallback, não mudava, o
 * efeito não disparava, e aí ficava. Daí a sensação de "clica duas vezes".
 *
 * Nada disso dá erro: `undefined` num template vira o fallback, silenciosamente.
 * É por isso que a invariante precisa de teste em vez de atenção.
 *
 * A leitura é por regex, sem parser: `TELAS` não é exportado e importar
 * `Gestao.jsx` puxaria React, lucide e o app inteiro para um teste de Node que
 * responde uma pergunta de duas linhas.
 */

const arquivo = (caminho) =>
  readFileSync(fileURLToPath(new URL(caminho, import.meta.url)), "utf8");

/** Os `id` dos destinos declarados em `TELAS`. */
function destinosDoMenu(fonte) {
  const inicio = fonte.indexOf("const TELAS = [");
  assert.notEqual(inicio, -1, "TELAS não foi encontrado em Gestao.jsx");
  const bloco = fonte.slice(inicio, fonte.indexOf("\n];", inicio));
  return [...bloco.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** As telas que o roteador sabe transformar em URL. */
function telasComSlug(fonte) {
  const inicio = fonte.indexOf("const slugToScreen = {");
  assert.notEqual(inicio, -1, "slugToScreen não foi encontrado em main.jsx");
  const bloco = fonte.slice(inicio, fonte.indexOf("\n};", inicio));
  return new Set([...bloco.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]));
}

test("todo destino do menu tem slug no roteador da web", () => {
  const menu = destinosDoMenu(arquivo("../apps/emyleads/src/page/Gestao.jsx"));
  const comSlug = telasComSlug(arquivo("../apps/emyleads/src/web/main.jsx"));

  assert.ok(menu.length > 5, `TELAS veio quase vazio (${menu.length}); a regex quebrou`);
  assert.ok(comSlug.size > 5, `slugToScreen veio quase vazio (${comSlug.size}); a regex quebrou`);

  const semSlug = menu.filter((destino) => !comSlug.has(destino));
  assert.deepEqual(
    semSlug,
    [],
    `destino do menu sem slug (foi assim que Conversas precisava de dois cliques): ${semSlug.join(", ")}`,
  );
});

/**
 * O fallback do roteador precisa ser uma tela que existe no menu.
 *
 * Ele é usado três vezes: URL vazia, slug desconhecido e destino sem slug. Se
 * apontar para uma tela que saiu do painel — como o Assistente, removido em
 * 08/09/2026 — quem abrir `/app` cai num destino que o menu não oferece mais.
 */
test("o fallback do roteador aponta para uma tela do menu", () => {
  const fonteRoteador = arquivo("../apps/emyleads/src/web/main.jsx");
  const menu = new Set(destinosDoMenu(arquivo("../apps/emyleads/src/page/Gestao.jsx")));

  const fallbacks = [...fonteRoteador.matchAll(/\|\|\s*"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(fallbacks.length > 0, "nenhum fallback encontrado; a regex quebrou");

  for (const destino of new Set(fallbacks)) {
    assert.ok(
      menu.has(destino),
      `o roteador cai em "${destino}", que não está no menu`,
    );
  }
});
