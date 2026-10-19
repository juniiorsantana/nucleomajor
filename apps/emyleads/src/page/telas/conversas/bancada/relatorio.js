/**
 * As contas e as tabelas do relatório da bancada.
 *
 * "Regime" é a média dos minutos depois do primeiro: o minuto 0 tem a
 * montagem da tela (lista, modelos, equipe, a primeira conversa), que é custo
 * de abrir a aba e não de mantê-la aberta. A meta do plano (menos de 50 linhas
 * por minuto por aba) vale para o regime.
 *
 * O aviso de realtime aparece à parte: é uma linha que chega à aba, mas não é
 * leitura do banco nem passa pelo PostgREST.
 */

const REALTIME = "realtime:";

const somar = (lista, campo) => lista.reduce((total, item) => total + (item?.[campo] || 0), 0);

function porOrigemDoRegime(contagem, minutos) {
  const origens = {};
  for (let m = 1; m < minutos; m += 1) {
    for (const [origem, valor] of Object.entries(contagem.porMinuto[m]?.porOrigem || {})) {
      const o = (origens[origem] ||= { pedidos: 0, linhas: 0, bytes: 0 });
      o.pedidos += valor.pedidos;
      o.linhas += valor.linhas;
      o.bytes += valor.bytes;
    }
  }
  const regime = Math.max(1, minutos - 1);
  return Object.fromEntries(
    Object.entries(origens).map(([origem, o]) => [
      origem,
      { pedidos: o.pedidos / regime, linhas: o.linhas / regime, bytes: o.bytes / regime },
    ])
  );
}

const semRealtime = (porOrigem) =>
  Object.entries(porOrigem).filter(([origem]) => !origem.startsWith(REALTIME)).map(([, v]) => v);

/** O resumo de uma aba medida. */
export function resumirAba({ contagem, reassinaturas, latencias, minutos }) {
  const minuto0 = semRealtime(contagem.porMinuto[0]?.porOrigem || {});
  const origens = porOrigemDoRegime(contagem, minutos);
  const leituras = semRealtime(origens);
  return {
    abertura: { pedidos: somar(minuto0, "pedidos"), linhas: somar(minuto0, "linhas"), bytes: somar(minuto0, "bytes") },
    regime: {
      pedidos: somar(leituras, "pedidos"),
      linhas: somar(leituras, "linhas"),
      bytes: somar(leituras, "bytes"),
      avisosDeRealtime: Object.entries(origens)
        .filter(([origem]) => origem.startsWith(REALTIME))
        .reduce((t, [, v]) => t + v.linhas, 0),
    },
    porOrigem: origens,
    reassinaturas: { ...reassinaturas },
    latencias: [...latencias].sort((a, b) => a - b),
  };
}

/** Junta as abas de uma rodada: médias por aba e o total das abas juntas. */
export function resumirRodada(rodada, abas) {
  const n = abas.length;
  const media = (f) => somar(abas.map((a) => ({ v: f(a) })), "v") / n;
  const latencias = abas.flatMap((a) => a.latencias).sort((a, b) => a - b);
  const quantil = (q) => (latencias.length ? latencias[Math.min(latencias.length - 1, Math.floor(q * latencias.length))] : null);
  const origens = {};
  for (const aba of abas) {
    for (const [origem, v] of Object.entries(aba.porOrigem)) {
      const o = (origens[origem] ||= { pedidos: 0, linhas: 0, bytes: 0 });
      o.pedidos += v.pedidos / n;
      o.linhas += v.linhas / n;
      o.bytes += v.bytes / n;
    }
  }
  return {
    ...rodada,
    abas: n,
    porAba: {
      aberturaLinhas: media((a) => a.abertura.linhas),
      aberturaBytes: media((a) => a.abertura.bytes),
      linhasPorMinuto: media((a) => a.regime.linhas),
      bytesPorMinuto: media((a) => a.regime.bytes),
      pedidosPorMinuto: media((a) => a.regime.pedidos),
      avisosPorMinuto: media((a) => a.regime.avisosDeRealtime),
    },
    todasAsAbas: {
      linhasPorMinuto: somar(abas.map((a) => a.regime), "linhas"),
      bytesPorMinuto: somar(abas.map((a) => a.regime), "bytes"),
      linhasPorHora: somar(abas.map((a) => a.regime), "linhas") * 60,
    },
    porOrigem: origens,
    reassinaturasAntesDeVencer: somar(abas.map((a) => a.reassinaturas), "antesDeVencer"),
    latencia: {
      amostras: latencias.length,
      mediana: quantil(0.5),
      p95: quantil(0.95),
      maxima: latencias.length ? latencias[latencias.length - 1] : null,
    },
  };
}

const n0 = (v) => Math.round(v).toLocaleString("pt-BR");
const kb = (v) => `${(v / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;
const seg = (ms) => (ms == null ? "—" : `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} s`);

/** A tabela principal, uma linha por rodada. */
export function tabelaDasRodadas(rodadas) {
  const linhas = [
    "| Rodada | Conversas / contatos | Realtime | Abertura por aba (linhas / bytes) | Regime por aba: linhas/min | bytes/min | pedidos/min | 5 abas: linhas/hora | Meta < 50 linhas/min |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rodadas) {
    linhas.push(
      `| ${r.nome} | ${r.conversas} / ${r.contatos} | ${r.realtime} | ${n0(r.porAba.aberturaLinhas)} / ${kb(r.porAba.aberturaBytes)} | ` +
        `**${n0(r.porAba.linhasPorMinuto)}** | ${kb(r.porAba.bytesPorMinuto)} | ${r.porAba.pedidosPorMinuto.toFixed(1)} | ` +
        `${n0(r.todasAsAbas.linhasPorHora)} | ${r.porAba.linhasPorMinuto < 50 ? "cumpre" : "não cumpre"} |`
    );
  }
  return linhas.join("\n");
}

/** De onde vêm as linhas do regime, por aba e por minuto. */
export function tabelaDeOrigens(rodada) {
  const linhas = [
    `| Origem (${rodada.nome}) | pedidos/min | linhas/min | bytes/min |`,
    "|---|---|---|---|",
  ];
  const ordenadas = Object.entries(rodada.porOrigem).sort((a, b) => b[1].linhas - a[1].linhas);
  for (const [origem, v] of ordenadas) {
    linhas.push(`| \`${origem}\` | ${v.pedidos.toFixed(1)} | ${n0(v.linhas)} | ${kb(v.bytes)} |`);
  }
  return linhas.join("\n");
}

export function tabelaDeLatencia(rodadas) {
  const linhas = [
    "| Rodada | Realtime | Mensagens na conversa aberta | Mediana | p95 | Máxima | Meta |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const r of rodadas) {
    const meta = r.realtime === "ativo" ? 3000 : 60000;
    const cumpre = r.latencia.maxima != null && r.latencia.maxima <= meta;
    linhas.push(
      `| ${r.nome} | ${r.realtime} | ${r.latencia.amostras} | ${seg(r.latencia.mediana)} | ${seg(r.latencia.p95)} | ` +
        `${seg(r.latencia.maxima)} | até ${meta / 1000} s: ${cumpre ? "cumpre" : "não cumpre"} |`
    );
  }
  return linhas.join("\n");
}
