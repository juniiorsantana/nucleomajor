import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight, ArrowUpRight, CalendarRange, CircleAlert, Download, Filter, Handshake, Trophy, UserPlus, Users,
} from "lucide-react";
import { api } from "../../data/client";
import { fmtMoeda } from "../../lib/formato";
import { CabecalhoTela, Seletor } from "../ui";
import {
  PRESETS, aplicarFiltros, funilDaSafra, leadsDoPeriodo, metricasDoPeriodo, paraCsv, periodoDoMes,
  periodoDoPreset, periodoPersonalizado, porOrigem, rotuloDoMes, serieMensal, variacao,
} from "./relatorios/metricas";

/**
 * Relatórios: quantos contatos, leads e negócios entraram, e até onde foram.
 *
 * Os cartões e a tabela contam o PERÍODO; o funil conta a SAFRA (das pessoas
 * que chegaram no período, até onde cada uma foi). A diferença está explicada
 * em `relatorios/metricas.js` e, em uma linha, no subtítulo de cada bloco —
 * quem lê precisa saber qual das duas perguntas o número responde.
 *
 * Tudo sai do que o portal já carrega (`dados`), mais o histórico de etapas,
 * que só existe depois da migration 20260926150000. Sem ele o funil ainda
 * funciona pela etapa atual; só o negócio perdido que passou por Proposta
 * deixa de aparecer nesse degrau.
 */

const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const num = (v) => (v == null ? "—" : v.toLocaleString("pt-BR"));
const dia = (ts) => new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
const dataInput = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function baixar(nome, conteudo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function descreverPeriodo(p, presetId) {
  const ultimoDia = p.fim - 1;
  const mesmoMes = new Date(p.inicio).getMonth() === new Date(ultimoDia).getMonth()
    && new Date(p.inicio).getFullYear() === new Date(ultimoDia).getFullYear();
  const inteiro = new Date(p.inicio).getDate() === 1 && new Date(p.fim).getDate() === 1;
  const texto = mesmoMes && inteiro ? rotuloDoMes(p.inicio, true) : `${dia(p.inicio)} a ${dia(ultimoDia)}`;
  const anterior = p.anterior
    ? (presetId === "mes-anterior" || presetId?.startsWith("mes:")
      ? rotuloDoMes(p.anterior.inicio, true)
      : `${dia(p.anterior.inicio)} a ${dia(p.anterior.fim - 1)}`)
    : null;
  return { texto, anterior };
}

/* ------------------------------------------------------------ peças */

function Bloco({ titulo, subtitulo, acao, children, className = "" }) {
  return (
    <section className={`min-w-0 rounded-[12px] border border-line bg-bg ${className}`}>
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-3.5">
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-semibold text-fg">{titulo}</h2>
          {subtitulo && <p className="mt-0.5 text-[11.5px] leading-4 text-faint">{subtitulo}</p>}
        </div>
        {acao}
      </header>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

function BotaoCsv({ onClick, rotulo = "CSV" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-none cursor-pointer items-center gap-1.5 rounded-[8px] border border-line px-2.5 py-1.5 text-[11.5px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg"
    >
      <Download size={13} strokeWidth={1.9} />
      {rotulo}
    </button>
  );
}

function Variacao({ atual, anterior, rotuloAnterior }) {
  const v = variacao(atual, anterior);
  if (v == null) return <span className="text-[11px] text-faint">sem base para comparar</span>;
  if (v === 0) return <span className="text-[11px] text-faint">igual ao {rotuloAnterior}</span>;
  const sobe = v > 0;
  const Icone = sobe ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-[11px]">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${sobe ? "text-success" : "text-danger"}`}>
        <Icone size={12} strokeWidth={2.2} />
        {Math.abs(Math.round(v * 100))}%
      </span>
      <span className="text-faint">vs {rotuloAnterior} ({num(anterior)})</span>
    </span>
  );
}

function Cartao({ icone: Icone, rotulo, valor, detalhe, atual, anterior, rotuloAnterior, comparar = true, className = "" }) {
  return (
    <div className={`flex min-w-0 flex-col${className ? " " + className : ""} gap-1.5 rounded-[12px] border border-line bg-bg px-4 py-3.5`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-faint">{rotulo}</span>
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-[7px] bg-accent-soft text-accent-forte">
          <Icone size={14} strokeWidth={1.9} />
        </span>
      </div>
      <strong className="text-[26px] font-semibold leading-none tracking-tight text-fg">{valor}</strong>
      {detalhe && <span className="truncate text-[11.5px] text-sub">{detalhe}</span>}
      {comparar && <Variacao atual={atual} anterior={anterior} rotuloAnterior={rotuloAnterior} />}
    </div>
  );
}

function Aviso({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[12px] leading-[18px] text-sub">
      <CircleAlert size={15} className="mt-[1px] flex-none text-warning" />
      <div>{children}</div>
    </div>
  );
}

/** Barras horizontais: cada degrau em proporção ao primeiro. Uma série, uma cor. */
function FunilSafra({ degraus }) {
  const topo = degraus[0]?.total || 0;
  if (!topo) {
    return <p className="py-8 text-center text-[12.5px] text-faint">Nenhum contato novo neste período.</p>;
  }
  return (
    <ol className="flex flex-col gap-2.5" aria-label="Funil da safra do período">
      {degraus.map((d, i) => (
        <li key={d.id} className="grid grid-cols-[minmax(96px,132px)_1fr_auto] items-center gap-3">
          <span className="truncate text-[12.5px] text-sub">{d.rotulo}</span>
          <div className="h-6 rounded-[4px] bg-surface" title={`${d.rotulo}: ${num(d.total)} (${pct(d.doTopo)} dos contatos novos)`}>
            <div
              className="h-full rounded-[4px] bg-accent transition-[width] duration-300"
              style={{ width: `${Math.max(d.total ? 1.5 : 0, (d.doTopo || 0) * 100)}%`, opacity: 1 - i * 0.12 }}
            />
          </div>
          <span className="w-[92px] text-right tabular-nums">
            <strong className="text-[13.5px] font-semibold text-fg">{num(d.total)}</strong>
            {d.doAnterior != null && <span className="ml-1.5 text-[11px] text-faint">{pct(d.doAnterior)}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Leads (ou contatos) por mês; o mês do período aparece cheio, os outros claros. Clicar abre o mês. */
function BarrasPorMes({ meses, medida, rotuloMedida, periodo, aoEscolherMes }) {
  const [foco, setFoco] = useState(null);
  const maximo = Math.max(1, ...meses.map((m) => m[medida] || 0));
  const emFoco = foco != null ? meses[foco] : null;
  return (
    <div>
      <div className="relative flex h-[150px] items-end gap-1.5 border-b border-line pt-6" onMouseLeave={() => setFoco(null)}>
        {meses.map((m, i) => {
          const valor = m[medida] || 0;
          const noPeriodo = m.inicio < periodo.fim && m.fim > periodo.inicio;
          return (
            <button
              key={m.inicio}
              type="button"
              onMouseEnter={() => setFoco(i)}
              onFocus={() => setFoco(i)}
              onBlur={() => setFoco(null)}
              onClick={() => aoEscolherMes(m.inicio)}
              aria-label={`${rotuloDoMes(m.inicio, true)}: ${valor} ${rotuloMedida}. Abrir este mês.`}
              className="group relative flex h-full flex-1 cursor-pointer items-end justify-center"
            >
              {noPeriodo && valor > 0 && (
                <span className="absolute text-[10.5px] font-semibold tabular-nums text-fg" style={{ bottom: `calc(${Math.max(3, (valor / maximo) * 100)}% + 4px)` }}>
                  {valor}
                </span>
              )}
              <span
                className={`w-full max-w-[26px] rounded-t-[4px] transition-colors ${noPeriodo ? "bg-accent" : "bg-accent/30 group-hover:bg-accent/55"}`}
                style={{ height: `${valor ? Math.max(3, (valor / maximo) * 100) : 0}%` }}
              />
            </button>
          );
        })}
        {emFoco && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-[8px] border border-line bg-bg px-2.5 py-1.5 text-[11.5px] shadow-[0_4px_16px_rgba(18,23,48,0.12)]"
            style={{ left: `${((foco + 0.5) / meses.length) * 100}%` }}
          >
            <div className="font-semibold text-fg">{rotuloDoMes(emFoco.inicio, true)}</div>
            <div className="text-sub">
              {num(emFoco.contatosNovos)} contatos · {num(emFoco.leadsNovos)} leads · {num(emFoco.ganhos)} ganhos
            </div>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {meses.map((m) => (
          <span key={m.inicio} className="flex-1 text-center text-[10px] text-faint">{rotuloDoMes(m.inicio).split("/")[0]}</span>
        ))}
      </div>
    </div>
  );
}

const TH = "px-2.5 py-2 text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint first:pl-0 first:text-left";
const TD = "px-2.5 py-2 text-right tabular-nums text-fg first:pl-0 first:text-left";

/* ------------------------------------------------------------- tela */

export default function Relatorios({ dados, aoAbrirContato }) {
  const [presetId, setPresetId] = useState("mes");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [origem, setOrigem] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [historico, setHistorico] = useState(undefined);
  const [todosOsLeads, setTodosOsLeads] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.relatorios.historicoEtapas({})
      .then((h) => vivo && setHistorico(h ?? null))
      .catch(() => vivo && setHistorico(null));
    return () => { vivo = false; };
  }, []);

  const periodo = useMemo(() => {
    if (presetId === "personalizado") return periodoPersonalizado(de, ate) || periodoDoPreset("mes");
    if (presetId.startsWith("mes:")) return periodoDoMes(Number(presetId.slice(4)));
    return periodoDoPreset(presetId);
  }, [presetId, de, ate]);
  const { texto: textoPeriodo, anterior: textoAnterior } = descreverPeriodo(periodo, presetId);

  const origens = useMemo(
    () => [...new Set(dados.contatos.map((c) => (c.origem || "").trim()).filter(Boolean))].sort(),
    [dados.contatos]
  );
  const responsaveis = useMemo(
    () => [...new Set(dados.contatos.map((c) => (c.responsavel || "").trim()).filter(Boolean))].sort(),
    [dados.contatos]
  );

  const base = useMemo(
    () => ({ ...aplicarFiltros(dados, { origem, responsavel }), estagios: dados.estagios }),
    [dados, origem, responsavel]
  );
  const atual = useMemo(() => metricasDoPeriodo(base, periodo), [base, periodo]);
  const anterior = useMemo(() => metricasDoPeriodo(base, periodo.anterior), [base, periodo]);
  const safra = useMemo(() => funilDaSafra(base, historico || [], periodo), [base, historico, periodo]);
  // Os 12 meses terminam no mês corrente e ficam parados enquanto se escolhe
  // um mês neles — senão a linha clicada fugia do cursor. Só andam para trás
  // quando o período escolhido é mais antigo que a janela.
  const meses = useMemo(() => {
    const hoje = new Date();
    const inicioDaJanela = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1).getTime();
    const ate = periodo.inicio < inicioDaJanela ? periodo.fim - 1 : Date.now();
    return serieMensal(base, historico || [], { ate, quantos: 12 });
  }, [base, historico, periodo]);
  const origensDoPeriodo = useMemo(() => porOrigem(base, periodo), [base, periodo]);
  const leads = useMemo(() => leadsDoPeriodo(base, periodo), [base, periodo]);

  const semLead = atual.semMarcaDeLead;
  const medidaMensal = semLead ? "contatosNovos" : "leadsNovos";
  const nomeDe = (c) => c.nome || c.telefone || "Sem nome";

  const escolherPreset = (id) => {
    if (id === "personalizado" && !de) {
      setDe(dataInput(periodo.inicio));
      setAte(dataInput(periodo.fim - 1));
    }
    setPresetId(id);
  };

  const exportarMeses = () => baixar(
    `relatorio-mensal-${dataInput(Date.now())}.csv`,
    paraCsv(
      ["Mês", "Contatos novos", "Leads novos", "Negócios criados", "Valor criado", "Ganhos", "Valor ganho", "Perdidos", "Taxa de ganho", "Safra que fechou"],
      meses.map((m) => [rotuloDoMes(m.inicio, true), m.contatosNovos, m.leadsNovos ?? "", m.negociosNovos, m.valorCriado, m.ganhos, m.valorGanho, m.perdidos, pct(m.taxaDeGanho), pct(m.safraFechou)])
    )
  );
  const exportarLeads = () => baixar(
    `leads-${dataInput(periodo.inicio)}-a-${dataInput(periodo.fim - 1)}.csv`,
    paraCsv(
      ["Nome", "Telefone", "E-mail", "Origem", "Responsável", "Virou lead em", "Negócios", "Situação", "Valor"],
      leads.map(({ contato: c, negocios, situacao, valor }) => [
        nomeDe(c), c.telefone, c.email, c.origem, c.responsavel, new Date(c.leadEm).toLocaleString("pt-BR"), negocios, situacao, valor || "",
      ])
    )
  );
  const exportarOrigens = () => baixar(
    `origens-${dataInput(periodo.inicio)}-a-${dataInput(periodo.fim - 1)}.csv`,
    paraCsv(
      ["Origem", semLead ? "Contatos" : "Leads", "Com negócio", "Fecharam", "Valor ganho", "Conversão"],
      origensDoPeriodo.map((o) => [o.origem, o.leads, o.comNegocio, o.ganhos, o.valorGanho, pct(o.conversao)])
    )
  );

  const leadsVisiveis = todosOsLeads ? leads : leads.slice(0, 12);
  const chip = (ativo) =>
    `cursor-pointer whitespace-nowrap rounded-[7px] px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      ativo ? "bg-accent-soft text-accent-forte" : "text-sub hover:bg-surface hover:text-fg"
    }`;

  return (
    <>
      <CabecalhoTela
        titulo="Relatórios"
        acao={
          <div className="hidden items-center gap-2 text-[12.5px] text-sub md:flex">
            <CalendarRange size={15} className="text-faint" />
            <span className="font-medium text-fg">{textoPeriodo}</span>
            {textoAnterior && <span className="text-faint">· comparado com {textoAnterior}</span>}
          </div>
        }
      />

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-4 py-3 md:px-8 md:py-4">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-3">
          {/* Período e filtros numa linha só, acima de tudo que eles mudam. */}
          <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-bg px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Período">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" className={chip(presetId === p.id)} onClick={() => escolherPreset(p.id)} aria-pressed={presetId === p.id}>
                  {p.rotulo}
                </button>
              ))}
              <button type="button" className={chip(presetId === "personalizado")} onClick={() => escolherPreset("personalizado")} aria-pressed={presetId === "personalizado"}>
                Personalizado
              </button>
              {presetId.startsWith("mes:") && (
                <span className={chip(true)}>{rotuloDoMes(periodo.inicio, true)}</span>
              )}
            </div>
            {presetId === "personalizado" && (
              <div className="flex items-center gap-1.5 text-[12px] text-sub">
                <input type="date" value={de} onChange={(e) => setDe(e.target.value)} aria-label="De"
                  className="rounded-[8px] border border-line bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-accent" />
                <span>até</span>
                <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Até"
                  className="rounded-[8px] border border-line bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-accent" />
              </div>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Filter size={13} className="text-faint" />
              <Seletor compacto valor={origem} aoMudar={setOrigem} rotuloVazio="Todas as origens" opcoes={origens.map((o) => ({ id: o, rotulo: o }))} />
              <Seletor compacto valor={responsavel} aoMudar={setResponsavel} rotuloVazio="Todos os responsáveis" opcoes={responsaveis.map((r) => ({ id: r, rotulo: r }))} />
            </div>
          </div>

          <p className="text-[12px] text-sub md:hidden">
            <span className="font-medium text-fg">{textoPeriodo}</span>
            {textoAnterior && <> · comparado com {textoAnterior}</>}
          </p>

          {semLead && (
            <Aviso>
              A marca de lead ainda não está ativa no banco desta empresa, então leads aparecem como "—" e o funil para em
              contatos novos. Ela passa a contar assim que a atualização do banco for aplicada.
            </Aviso>
          )}
          {atual.fechamentoAproximado && (
            <Aviso>
              Parte dos negócios fechados neste período não tem a data exata de fechamento; para eles vale a data da última
              edição.
            </Aviso>
          )}

          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
            <Cartao icone={Users} rotulo="Contatos novos" valor={num(atual.contatosNovos)} detalhe="pessoas que entraram no CRM"
              atual={atual.contatosNovos} anterior={anterior.contatosNovos} rotuloAnterior="anterior" />
            <Cartao icone={UserPlus} rotulo="Leads novos" valor={num(atual.leadsNovos)} detalhe="contatos marcados como lead"
              atual={atual.leadsNovos} anterior={anterior.leadsNovos} rotuloAnterior="anterior" comparar={!semLead} />
            <Cartao icone={Handshake} rotulo="Negócios criados" valor={num(atual.negociosNovos)}
              detalhe={atual.valorCriado ? `${fmtMoeda(atual.valorCriado)} em oportunidades` : "no Funil"}
              atual={atual.negociosNovos} anterior={anterior.negociosNovos} rotuloAnterior="anterior" />
            <Cartao icone={Trophy} rotulo="Ganhos" valor={num(atual.ganhos)} detalhe={`${fmtMoeda(atual.valorGanho) || "R$ 0"} fechados`}
              atual={atual.ganhos} anterior={anterior.ganhos} rotuloAnterior="anterior" />
            <Cartao className="col-span-2 lg:col-span-1" icone={Filter} rotulo="Taxa de ganho" valor={pct(atual.taxaDeGanho)}
              detalhe={`${num(atual.ganhos)} ${atual.ganhos === 1 ? "ganho" : "ganhos"} · ${num(atual.perdidos)} ${atual.perdidos === 1 ? "perdido" : "perdidos"}`} comparar={false} />
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Bloco
              titulo="Funil da safra"
              subtitulo="Das pessoas que chegaram no período, até onde cada uma foi até hoje. O % é em relação ao degrau de cima."
            >
              <FunilSafra degraus={safra} />
              {historico === null && !semLead && (
                <p className="mt-3 text-[11px] leading-4 text-faint">
                  Sem histórico de etapas ainda: "Chegaram à proposta" conta pela etapa atual de cada negócio.
                </p>
              )}
            </Bloco>
            <Bloco
              titulo={semLead ? "Contatos novos por mês" : "Leads novos por mês"}
              subtitulo="Últimos 12 meses. Clique num mês para ver o relatório dele."
            >
              <BarrasPorMes
                meses={meses}
                medida={medidaMensal}
                rotuloMedida={semLead ? "contatos novos" : "leads novos"}
                periodo={periodo}
                aoEscolherMes={(inicio) => setPresetId(`mes:${inicio}`)}
              />
            </Bloco>
          </div>

          <Bloco
            titulo="Mês a mês"
            subtitulo='Cada linha conta o que aconteceu naquele mês. "Safra que fechou" é quanto dos contatos que chegaram no mês já virou negócio ganho.'
            acao={<BotaoCsv onClick={exportarMeses} />}
          >
            <div className="scrollbar-fina -mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-line">
                    {["Mês", "Contatos", "Leads", "Negócios", "Ganhos", "Valor ganho", "Perdidos", "Taxa de ganho", "Safra que fechou"].map((h) => (
                      <th key={h} className={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...meses].reverse().map((m) => {
                    const ativo = m.inicio < periodo.fim && m.fim > periodo.inicio;
                    return (
                      <tr
                        key={m.inicio}
                        onClick={() => setPresetId(`mes:${m.inicio}`)}
                        className={`cursor-pointer border-b border-line last:border-0 transition-colors hover:bg-surface ${ativo ? "bg-accent-soft/40" : ""}`}
                      >
                        <td className={`${TD} font-medium`}>{maiuscula(rotuloDoMes(m.inicio, true))}</td>
                        <td className={TD}>{num(m.contatosNovos)}</td>
                        <td className={TD}>{num(m.leadsNovos)}</td>
                        <td className={TD}>{num(m.negociosNovos)}</td>
                        <td className={TD}>{num(m.ganhos)}</td>
                        <td className={TD}>{m.valorGanho ? fmtMoeda(m.valorGanho) : "—"}</td>
                        <td className={TD}>{num(m.perdidos)}</td>
                        <td className={`${TD} text-sub`}>{pct(m.taxaDeGanho)}</td>
                        <td className={`${TD} text-sub`}>{pct(m.safraFechou)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Bloco>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Bloco
              titulo="Por origem"
              subtitulo={`${semLead ? "Contatos" : "Leads"} que entraram no período, e quantos já fecharam.`}
              acao={origensDoPeriodo.length ? <BotaoCsv onClick={exportarOrigens} /> : null}
            >
              {origensDoPeriodo.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-faint">Nada neste período.</p>
              ) : (
                <div className="scrollbar-fina -mx-4 overflow-x-auto px-4">
                  <table className="w-full min-w-[480px] border-collapse text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line">
                        {["Origem", semLead ? "Contatos" : "Leads", "Com negócio", "Fecharam", "Valor ganho", "Conversão"].map((h) => (
                          <th key={h} className={TH}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {origensDoPeriodo.map((o) => (
                        <tr key={o.origem} className="border-b border-line last:border-0">
                          <td className={`${TD} max-w-[200px] truncate font-medium`}>{o.origem}</td>
                          <td className={TD}>{num(o.leads)}</td>
                          <td className={TD}>{num(o.comNegocio)}</td>
                          <td className={TD}>{num(o.ganhos)}</td>
                          <td className={TD}>{o.valorGanho ? fmtMoeda(o.valorGanho) : "—"}</td>
                          <td className={`${TD} text-sub`}>{pct(o.conversao)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Bloco>
            <Bloco titulo="Motivos de perda" subtitulo="Negócios perdidos no período.">
              {atual.motivosDePerda.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-faint">Nenhum negócio perdido neste período.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {atual.motivosDePerda.slice(0, 8).map((m) => (
                    <li key={m.motivo} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                      <span className="truncate text-[12.5px] text-fg" title={m.motivo}>{m.motivo}</span>
                      <span className="text-[12.5px] font-semibold tabular-nums text-fg">{m.total}</span>
                      <div className="col-span-2 h-1.5 rounded-full bg-surface">
                        <div className="h-full rounded-full bg-accent/70" style={{ width: `${(m.total / atual.perdidos) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Bloco>
          </div>

          {!semLead && (
            <Bloco
              titulo={`Leads do período (${num(leads.length)})`}
              subtitulo="Quem virou lead no período, mais novos primeiro. Clique para abrir a ficha."
              acao={leads.length ? <BotaoCsv onClick={exportarLeads} rotulo="Exportar leads" /> : null}
            >
              {leads.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-faint">Nenhum lead neste período.</p>
              ) : (
                <>
                  <div className="scrollbar-fina -mx-4 overflow-x-auto px-4">
                    <table className="w-full min-w-[600px] border-collapse text-[12.5px]">
                      <thead>
                        <tr className="border-b border-line">
                          {["Lead", "Origem", "Responsável", "Virou lead", "Situação", "Valor"].map((h) => (
                            <th key={h} className={`${TH} [&:nth-child(-n+3)]:text-left`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {leadsVisiveis.map(({ contato: c, situacao, valor }) => (
                          <tr key={c.id} onClick={() => aoAbrirContato?.(c)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface">
                            <td className={`${TD} max-w-[220px] truncate font-medium`}>{nomeDe(c)}</td>
                            <td className={`${TD} max-w-[160px] truncate !text-left text-sub`}>{c.origem || "—"}</td>
                            <td className={`${TD} max-w-[140px] truncate !text-left text-sub`}>{c.responsavel || "—"}</td>
                            <td className={`${TD} text-sub`}>{dia(c.leadEm)}</td>
                            <td className={TD}>{situacao}</td>
                            <td className={TD}>{valor ? fmtMoeda(valor) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {leads.length > leadsVisiveis.length && (
                    <button type="button" onClick={() => setTodosOsLeads(true)} className="mt-2 cursor-pointer text-[12px] font-medium text-accent-forte hover:underline">
                      Ver todos os {num(leads.length)}
                    </button>
                  )}
                </>
              )}
            </Bloco>
          )}
        </div>
      </div>
    </>
  );
}
