// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__EMYLEADS_PLATFORM__ = "web";

/**
 * A bancada de carga da tela de Conversas.
 *
 * Roda o hook de verdade (`useConversas`), o provider de verdade
 * (`web/conversasProvider.js`) e o realtime de verdade (`web/gatewayProvider.js`)
 * sobre o banco falso de `bancoFalso.js`, com timers falsos, e conta o que
 * cada aba lê por minuto.
 *
 * Em `npm test` roda só a rodada curta (prova de que a bancada funciona).
 * A rodada completa, que gera o relatório:
 *
 *   BANCADA=antes  BANCADA_SAIDA=<pasta> npx vitest run src/page/telas/conversas/bancada
 *   BANCADA=depois BANCADA_SAIDA=<pasta> npx vitest run src/page/telas/conversas/bancada
 *
 * `antes` mede só o banco de hoje; `depois` mede o banco de hoje (o portal novo
 * precisa cair na reserva) e o banco da escala.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { criarBancoFalso, criarClienteFalso } from "./bancoFalso.js";
import { ORGANIZACAO, aplicar, gerarEmpresa, linhaDoTempo, popular, rotinaDasAbas } from "./cenario.js";
import { resumirAba, resumirRodada, tabelaDasRodadas, tabelaDeLatencia, tabelaDeOrigens } from "./relatorio.js";

vi.mock("../../../../data/client", () => ({
  api: new Proxy(
    {},
    {
      get: (_, ns) =>
        new Proxy({}, { get: (__, fn) => (args) => globalThis.__BANCADA__.chamar(`${ns}.${fn}`, args) }),
    }
  ),
}));
vi.mock("../../../../web/supabaseClient.js", () => ({
  obterSupabaseWeb: () => globalThis.__BANCADA__.cliente,
}));

const { useConversas } = await import("../useConversas.js");
const { criarOperacoesConversasWeb } = await import("../../../../web/conversasProvider.js");
const { criarOperacoesGateway } = await import("../../../../web/gatewayProvider.js");

const INICIO = Date.UTC(2026, 9, 20, 13, 0, 0);
const area = { get: async (chave) => ({ [chave]: ORGANIZACAO }) };

let estado = null;
function Harness() {
  estado = useConversas(ORGANIZACAO);
  return null;
}

/**
 * Mede uma aba: monta a tela, deixa o tempo correr `minutos` minutos com a
 * linha do tempo do banco e a rotina da aba, e devolve a contagem.
 */
async function medirAba({ esquema, realtime, empresa, eventos, rotina, minutos, passoMs = 250 }) {
  vi.useFakeTimers({ now: INICIO });
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  const banco = criarBancoFalso({ esquema });
  popular(banco, empresa);
  const cliente = criarClienteFalso(banco, { realtime });
  const ops = {
    ...criarOperacoesGateway(),
    ...criarOperacoesConversasWeb({ supabase: cliente, area, cache: null }),
    "organizacoes.membros": async () => [],
  };
  globalThis.__BANCADA__ = {
    cliente,
    chamar: (op, args) =>
      ops[op] ? Promise.resolve().then(() => ops[op](args)) : Promise.reject(new Error(`bancada sem ${op}`)),
  };

  // A mensagem que chega na conversa aberta: quando chegou ao banco.
  const esperando = new Map();
  const latencias = [];
  for (const evento of eventos) {
    setTimeout(() => {
      if (evento.tipo === "mensagem" && estado?.atual === evento.id) {
        esperando.set(evento.messageId, { desde: Date.now(), conversa: evento.id });
      }
      aplicar(banco, evento);
    }, evento.t);
  }
  for (const passo of rotina) setTimeout(() => estado?.setAtual(passo.id), passo.t);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  cliente.zerarRelogio();
  await act(async () => {
    root.render(<Harness />);
  });

  for (let t = 0; t < minutos * 60_000; t += passoMs) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(passoMs);
    });
    for (const [id, { desde, conversa }] of esperando) {
      if (estado?.atual !== conversa) esperando.delete(id);
      else if (estado.mensagens.some((m) => m.messageId === id)) {
        latencias.push(Date.now() - desde);
        esperando.delete(id);
      }
    }
  }
  // O que não apareceu até o fim da rodada conta como o resto da rodada: uma
  // mensagem que nunca aparece não pode sumir da estatística.
  for (const [, { desde }] of esperando) latencias.push(Date.now() - desde);

  const conversasNaTela = estado?.conversas?.length ?? 0;
  act(() => root.unmount());
  container.remove();
  cliente.fechar();
  vi.useRealTimers();
  return { ...resumirAba({ ...cliente, latencias, minutos }), conversasNaTela };
}

async function rodar({ nome, esquema, realtime, conversas, abas, minutos }) {
  const empresa = gerarEmpresa({ conversas, inicio: INICIO });
  const rotinas = rotinaDasAbas({ empresa, abas, minutos });
  const eventos = linhaDoTempo({ empresa, rotinas, minutos });
  const medidas = [];
  for (const rotina of rotinas) {
    medidas.push(await medirAba({ esquema, realtime, empresa, eventos, rotina, minutos }));
  }
  return {
    ...resumirRodada(
      { nome, esquema, realtime, conversas, contatos: empresa.contatos.length, minutos },
      medidas
    ),
    conversasNaTela: medidas.map((m) => m.conversasNaTela),
  };
}

afterEach(() => {
  vi.useRealTimers();
  estado = null;
});

describe("bancada de carga: rodada curta", () => {
  it("mede leituras por minuto e a mensagem nova chega à conversa aberta", async () => {
    const r = await rodar({ nome: "curta", esquema: "hoje", realtime: "ativo", conversas: 40, abas: 1, minutos: 2 });
    expect(r.conversasNaTela).toEqual([40]);
    expect(r.porAba.aberturaLinhas).toBeGreaterThan(0);
    expect(r.porAba.linhasPorMinuto).toBeGreaterThan(0);
    expect(r.latencia.amostras).toBeGreaterThan(0);
    expect(r.latencia.maxima).toBeLessThanOrEqual(60_000);
  }, 60_000);
});

const MODO = process.env.BANCADA || "";

describe.skipIf(!MODO)("bancada de carga: rodadas completas", () => {
  it(`gera o relatório (${MODO})`, async () => {
    const minutos = Number(process.env.BANCADA_MINUTOS || 10);
    const esquemas = MODO === "depois" ? ["hoje", "escala"] : ["hoje"];
    const rodadas = [];
    for (const esquema of esquemas) {
      for (const [conversas, realtime] of [[300, "ativo"], [300, "caido"], [461, "ativo"], [461, "caido"]]) {
        const nome = `${conversas} conversas, realtime ${realtime}, banco ${esquema}`;
        const inicio = performance.now();
        rodadas.push(await rodar({ nome, esquema, realtime, conversas, abas: 5, minutos }));
        console.log(`${nome}: ${Math.round(performance.now() - inicio)} ms`);
      }
    }

    const md = [
      `# Bancada de carga das Conversas: ${MODO}`,
      "",
      `Rodadas de ${minutos} min simulados, 5 abas, passo de 250 ms. Médias por aba no regime (minutos 1 a ${minutos - 1}).`,
      "",
      tabelaDasRodadas(rodadas),
      "",
      "## Mensagem nova na conversa aberta",
      "",
      tabelaDeLatencia(rodadas),
      "",
      "## De onde vêm as linhas",
      "",
      ...rodadas.flatMap((r) => [tabelaDeOrigens(r), ""]),
      "## Fotos e mídia reassinadas antes de vencer (5 abas, rodada inteira)",
      "",
      ...rodadas.map((r) => `- ${r.nome}: ${r.reassinaturasAntesDeVencer.toLocaleString("pt-BR")}`),
      "",
    ].join("\n");
    console.log(md);
    const saida = process.env.BANCADA_SAIDA;
    if (saida) {
      mkdirSync(saida, { recursive: true });
      writeFileSync(join(saida, `bancada-${MODO}.md`), md);
      writeFileSync(join(saida, `bancada-${MODO}.json`), JSON.stringify(rodadas, null, 2));
    }
    expect(rodadas.length).toBe(esquemas.length * 4);
  }, 3_600_000);
});
