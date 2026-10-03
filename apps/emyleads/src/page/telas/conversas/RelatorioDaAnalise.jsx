import { useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Map as IconeMapa } from "lucide-react";
import { api } from "../../../data/client";
import {
  NOME_DO_CRITERIO,
  NOME_LONGO_DO_CRITERIO,
  ROTULO_DA_ACAO,
  ROTULO_DO_ALERTA,
  coberturaDaNota,
  contaDaNota,
  criteriosEmOrdem,
  faixaDosPontos,
  instanteDoPrazo,
  instanteEmTexto,
  linhaDoTempo,
  momentosDaConversa,
  motivoDoCriterio,
  notaEmTexto,
  periodoDaLinha,
  pontosDoCriterio,
  prazoDaAcao,
  prazoEmTexto,
  resumoParaCopiar,
  rotuloDoCriterio,
  semNumerosInternos as limpo,
  tomDoCriterio,
} from "../../../domain/analiseDaConversa";
import { MapaDaConversa } from "./MapaDaConversa";

// A duração do compromisso criado por "Agendar": a mesma da sugestão antiga.
const DURACAO_DO_COMPROMISSO_MS = 30 * 60 * 1000;

// As cores dos estados. Ficam escritas por inteiro para o Tailwind achar.
const CHIP = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  faint: "bg-surface-hover text-sub",
};
const CHEIO = { success: "bg-success", warning: "bg-warning", danger: "bg-danger" };
const CLARO = { success: "bg-success-soft", warning: "bg-warning-soft", danger: "bg-danger-soft" };
const ARO = { accent: "border-signal", warning: "border-warning", danger: "border-danger" };
const LEGENDA = { accent: "text-sub", warning: "text-warning", danger: "text-danger" };
const LISTRADO = { background: "repeating-linear-gradient(135deg, var(--el-line) 0 5px, var(--el-surface) 5px 10px)" };

const ROTULO_DO_TIPO = {
  reply: "Responder",
  create_follow_up: "Follow-up",
  schedule_meeting: "Reunião",
  create_task: "Tarefa",
  review: "Revisar",
};

const PRIORIDADE_CURTA = { alta: "Alta", media: "Média", baixa: "Baixa" };

const CARTAO = "rounded-none border border-line bg-bg p-4 lg:p-6";
const ROTULO = "text-[12px] font-semibold text-sub";
const BOTAO =
  "inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-ctl border border-line-strong bg-bg px-4 text-[13px] font-semibold text-fg transition-colors hover:border-accent hover:text-accent-forte";
const BOTAO_FORTE =
  "inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-ctl bg-accent px-4 text-[13px] font-semibold text-on-accent transition-opacity hover:opacity-90";

/**
 * O relatório da análise no formato v1 (ANALYSIS_SCHEMA_V1_NUCLEO_MAJOR.md,
 * seção 11), no desenho do relatório visual: a nota e quanto dela foi
 * avaliado, o problema em uma frase, o que fazer agora, por que a nota e
 * onde aconteceu na conversa. No celular, o que fazer sobe para logo depois
 * da nota.
 *
 * A nota vem pronta do banco (o motor de regras); aqui nada é calculado. Não
 * há faixa de qualidade da nota ("boa", "regular"): a especificação não
 * define. Critério que ainda não dá para avaliar aparece como "—", nunca como
 * zero.
 */
export function RelatorioDaAnalise({ analise, nome = "", podeAgir, contato, negocio, aoUsarMensagem, aoVerMensagem, aoCriado, aoFechar }) {
  const relatorio = analise.relatorio || null;
  const diagnostico = relatorio?.diagnosis || analise.resultado || {};
  const atendimento = relatorio?.atendimento_score || null;
  const criterios = atendimento?.criteria || [];
  const alertas = relatorio?.red_flags || diagnostico.red_flags || [];
  const acoes = diagnostico.what_to_do_now || [];
  const sugerida = diagnostico.suggested_message?.applicable ? diagnostico.suggested_message.text : null;
  const linha = useMemo(() => linhaDoTempo(analise.linhaDoTempo, alertas), [analise.linhaDoTempo, alertas]);
  const [verMapa, setVerMapa] = useState(false);
  const [aviso, setAviso] = useState("");

  const verEvidencia = aoVerMensagem
    ? (id) => {
        if (aoVerMensagem(id)) aoFechar?.();
        else setAviso("Essa mensagem não está entre as carregadas na conversa. Role a conversa para cima e tente de novo.");
      }
    : null;
  const usarMensagem = aoUsarMensagem
    ? (texto) => {
        aoUsarMensagem(texto);
        aoFechar?.();
      }
    : null;
  const copiar = async (texto, feito) => {
    try {
      await navigator.clipboard.writeText(texto);
      setAviso(feito);
    } catch {
      setAviso("Não foi possível copiar. Selecione o texto e copie à mão.");
    }
  };

  const meta = [periodoDaLinha(linha), analise.concluidaEm ? `analisada em ${instanteEmTexto(new Date(analise.concluidaEm).getTime())}` : ""]
    .filter(Boolean)
    .join(" · ");

  if (verMapa) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setVerMapa(false)} className={BOTAO}>
            Voltar ao relatório
          </button>
          <span className="text-[12px] text-sub">Exportar em imagem ou PDF vem na próxima etapa.</span>
        </div>
        <MapaDaConversa nome={nome} periodo={meta} atendimento={atendimento} gargalo={diagnostico.main_bottleneck} acao={acoes[0]} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2 lg:col-span-2">
        <span className="text-[12.5px] text-sub">{meta}</span>
        <div className="flex flex-wrap gap-2">
          {criterios.length > 0 && (
            <button type="button" onClick={() => setVerMapa(true)} className={BOTAO}>
              <IconeMapa size={15} strokeWidth={2} /> Ver mapa
            </button>
          )}
          <button type="button" onClick={() => copiar(resumoParaCopiar({ nome, relatorio: { ...relatorio, diagnosis: diagnostico } }), "Resumo copiado.")} className={BOTAO}>
            <Copy size={15} strokeWidth={2} /> Copiar resumo
          </button>
        </div>
      </div>

      <CartaoDaNota atendimento={atendimento} leadScore={relatorio?.lead_score} />

      <div className="order-3 lg:order-none">
        <CartaoDoProblema diagnostico={diagnostico} alertas={alertas} criterios={criterios} aoVer={verEvidencia} />
      </div>

      {acoes.length > 0 && (
        <div className="order-2 lg:order-none lg:col-span-2">
          <OQueFazer
            acoes={acoes}
            sugerida={sugerida}
            podeAgir={podeAgir}
            contato={contato}
            negocio={negocio}
            aoUsarMensagem={usarMensagem}
            aoCopiar={(texto) => copiar(texto, "Mensagem copiada.")}
            aoVer={verEvidencia}
            aoCriado={aoCriado}
          />
        </div>
      )}

      {criterios.length > 0 && (
        <div className="order-4 lg:order-none lg:col-span-2">
          <PorQueEssaNota atendimento={atendimento} motivos={diagnostico.why_this_score || []} aoVer={verEvidencia} />
        </div>
      )}

      {linha && (
        <div className="order-5 lg:order-none lg:col-span-2">
          <OndeAconteceu linha={linha} aoVer={verEvidencia} />
        </div>
      )}

      {aviso && (
        <p role="status" className="order-6 text-[12px] text-sub lg:order-none lg:col-span-2">
          {aviso}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- a nota

function CartaoDaNota({ atendimento, leadScore }) {
  const cobertura = coberturaDaNota(atendimento);
  const conta = contaDaNota(atendimento);
  const baixa = cobertura && !cobertura.conclusiva;
  return (
    <section aria-label="Atendimento Score" className={`${CARTAO} order-1 flex flex-col gap-4 lg:order-none`}>
      <h2 className={ROTULO}>Nota do atendimento</h2>
      <div className="flex items-center gap-4 lg:gap-5">
        <Anel nota={cobertura ? atendimento.score : null} cobertura={cobertura?.porcento ?? 0} baixa={baixa} />
        <div className="flex min-w-0 flex-col gap-3">
          <p data-nota className={`font-semibold tabular-nums ${baixa || !cobertura ? "text-[15px] text-sub" : "text-[17px] text-fg"}`}>
            {cobertura ? `${atendimento.score}/100` : notaEmTexto(atendimento)}
            {/* No computador, a cobertura vai na linha de baixo e o travessão some. */}
            {cobertura && (
              <span className="text-[13px] font-semibold text-signal lg:block">
                <span className="lg:hidden"> — </span>
                {cobertura.porcento}% dos critérios avaliados
              </span>
            )}
          </p>
          {cobertura && (
            <ul className="hidden flex-col gap-2 text-[12px] text-sub lg:flex">
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-[4px] h-2.5 w-2.5 flex-none rounded-ctl bg-fg" />
                anel de dentro: a nota
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-[4px] h-2.5 w-2.5 flex-none rounded-ctl bg-signal" />
                anel de fora: quanto da conversa deu para avaliar
              </li>
            </ul>
          )}
        </div>
      </div>
      {cobertura && (
        <p className={`rounded-none px-3.5 py-3 text-[12.5px] leading-[18px] ${baixa ? "bg-warning-soft text-warning" : "bg-surface text-fg"}`}>
          {baixa ? (
            "Poucos critérios avaliados: a nota ainda não é conclusiva."
          ) : (
            <>
              {conta.avaliados} de {conta.total} critérios avaliados. A equipe fez{" "}
              <b>
                {String(conta.pontos).replace(".", ",")} dos {conta.pesoAvaliado} pontos
              </b>{" "}
              que dava para avaliar.
              {cobertura.porcento < 100 && <span className="block text-sub">Nota até aqui: só os critérios que já dá para avaliar entram na conta.</span>}
            </>
          )}
        </p>
      )}
      <div className="flex items-center justify-between border-t border-line pt-3">
        <div>
          <p className="text-[13px] font-semibold text-fg">Lead Score</p>
          <p className="text-[11.5px] text-sub">chance de fechar</p>
        </div>
        <span className="rounded-ctl bg-surface-hover px-2.5 py-1 text-[11.5px] font-semibold text-sub">
          {leadScore == null ? "em breve" : `${leadScore}/100`}
        </span>
      </div>
    </section>
  );
}

// Dois anéis: o de dentro é a nota; o de fora, quanto do peso foi avaliado.
// Cobertura baixa: a nota não tem arco, só o trilho tracejado.
function Anel({ nota, cobertura, baixa }) {
  const fora = 2 * Math.PI * 80;
  const dentro = 2 * Math.PI * 62;
  return (
    <div className="relative h-[112px] w-[112px] flex-none lg:h-[168px] lg:w-[168px]">
      <svg viewBox="0 0 176 176" className="h-full w-full" aria-hidden="true">
        <circle cx="88" cy="88" r="80" fill="none" strokeWidth="7" style={{ stroke: "var(--el-signal-soft)" }} />
        {cobertura > 0 && (
          <circle
            cx="88" cy="88" r="80" fill="none" strokeWidth="7" strokeLinecap="round" transform="rotate(-90 88 88)"
            strokeDasharray={`${(fora * cobertura) / 100} ${fora}`} style={{ stroke: "var(--el-signal)" }}
          />
        )}
        <circle cx="88" cy="88" r="62" fill="none" strokeWidth="15" strokeDasharray={baixa ? "6 6" : undefined} style={{ stroke: "var(--el-surface-hover)" }} />
        {nota != null && !baixa && nota > 0 && (
          <circle
            cx="88" cy="88" r="62" fill="none" strokeWidth="15" strokeLinecap="round" transform="rotate(-90 88 88)"
            strokeDasharray={`${(dentro * nota) / 100} ${dentro}`} style={{ stroke: "var(--el-fg)" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-bold leading-none tabular-nums ${baixa ? "text-[22px] text-sub lg:text-[26px]" : "text-[32px] text-fg lg:text-[46px]"}`}>
          {nota ?? "—"}
        </span>
        <span className="text-[11px] text-sub lg:text-[13px]">de 100</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- o problema

function CartaoDoProblema({ diagnostico, alertas, criterios, aoVer }) {
  const gargalo = diagnostico.main_bottleneck;
  const doGargalo = gargalo?.criterion ? criterios.find((c) => c.key === gargalo.criterion) : null;
  return (
    <section className={`${CARTAO} flex h-full flex-col gap-5`}>
      {diagnostico.summary && (
        <div className="flex flex-col gap-1.5">
          <h2 className={ROTULO}>Em uma frase</h2>
          <p className="text-[16px] font-medium leading-[23px] text-fg lg:text-[19px] lg:leading-[27px]">{limpo(diagnostico.summary)}</p>
        </div>
      )}

      {gargalo?.title && (
        <div className="flex gap-3.5 rounded-none bg-danger-soft p-4">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-ctl bg-danger text-on-accent" aria-hidden="true">
            <AlertTriangle size={18} strokeWidth={2.2} />
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 className="text-[11.5px] font-bold uppercase tracking-[.05em] text-danger">Principal gargalo</h2>
            <p className="text-[17px] font-bold leading-[23px] text-fg">{limpo(gargalo.title)}</p>
            {gargalo.explanation && <p className="text-[13px] leading-[19px] text-fg/80">{limpo(gargalo.explanation)}</p>}
            {doGargalo && (
              <span className="mt-1 self-start rounded-ctl border border-danger/40 bg-bg px-2.5 py-[3px] text-[11.5px] font-semibold text-danger">
                {NOME_DO_CRITERIO[doGargalo.key] || doGargalo.name} · {doGargalo.points_awarded == null ? "não avaliado" : `${pontosDoCriterio(doGargalo).replace("/", " de ")}`}
              </span>
            )}
            <Evidencias ids={gargalo.evidence_message_ids} aoVer={aoVer} />
          </div>
        </div>
      )}

      {alertas.length > 0 && (
        <div className="flex flex-col">
          <h2 className={`${ROTULO} mb-1.5`}>Alertas · {alertas.length}</h2>
          <ul>
            {alertas.map((alerta) => {
              const forte = alerta.code === "conversation_left_open" || alerta.code === "critical_information_ignored";
              const primeira = alerta.evidence_message_ids?.[0];
              return (
                <li key={alerta.code} className="flex min-h-[48px] items-center gap-3 border-t border-line py-2">
                  <span aria-hidden="true" className={`h-2.5 w-2.5 flex-none rounded-full ${forte ? "bg-danger" : "bg-warning"}`} />
                  <span className="min-w-0 flex-1 text-[13px] leading-[18px]">
                    <b className="font-semibold text-fg">{ROTULO_DO_ALERTA[alerta.code] || alerta.code}</b>
                    {alerta.reason && <span className="text-sub"> · {limpo(alerta.reason)}</span>}
                  </span>
                  {aoVer && primeira && (
                    <button type="button" onClick={() => aoVer(primeira)} className="flex-none cursor-pointer text-[12.5px] font-semibold text-accent-forte hover:underline">
                      Ver mensagem
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[11px] text-faint">Alertas destacam riscos; não descontam da nota.</p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- o que fazer

const COLUNAS_DAS_ACOES = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]",
};

function OQueFazer({ acoes, sugerida, podeAgir, contato, negocio, aoUsarMensagem, aoCopiar, aoVer, aoCriado }) {
  // A mensagem sugerida vai na ação de responder; sem ela, na primeira.
  const comMensagem = Math.max(0, acoes.findIndex((acao) => acao.action_type === "reply"));
  return (
    <section className={CARTAO}>
      <div className="mb-3 flex items-baseline justify-between gap-3 lg:mb-4">
        <h2 className="text-[16px] font-bold text-fg lg:text-[18px]">O que fazer agora</h2>
        <span className="text-[12px] text-sub">em ordem de prioridade</span>
      </div>
      <div className={`grid gap-3 lg:gap-4 ${COLUNAS_DAS_ACOES[acoes.length] || "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]"}`}>
        {acoes.map((acao, indice) => {
          const primeira = indice === 0;
          const prazo = prazoEmTexto(acao.due_at);
          const tipo = ROTULO_DO_TIPO[acao.action_type];
          return (
            <article
              key={indice}
              className={`flex flex-col gap-3 rounded-none p-4 lg:p-[18px] ${
                primeira ? "bg-accent text-on-accent lg:border lg:border-fg lg:bg-bg lg:text-fg" : "border border-line text-fg"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span
                  className={`rounded-ctl px-2.5 py-[3px] font-bold ${
                    primeira ? "bg-bg text-fg lg:bg-accent lg:text-on-accent" : acao.priority === "media" ? "bg-accent-soft text-accent-forte" : "bg-surface-hover text-sub"
                  }`}
                >
                  {indice + 1}
                  {acao.priority ? ` · ${PRIORIDADE_CURTA[acao.priority] || acao.priority}` : ""}
                </span>
                {(tipo || prazo) && (
                  <span className={primeira ? "text-on-accent/85 lg:text-sub" : "text-sub"}>{[tipo, prazo && `até ${prazo}`].filter(Boolean).join(" · ")}</span>
                )}
              </div>
              <h3 className="text-[17px] font-bold leading-[23px]">{limpo(acao.title || acao.instruction)}</h3>
              {acao.instruction && acao.title && <p className={`text-[13px] leading-[19px] ${primeira ? "text-on-accent/90 lg:text-fg" : "text-fg"}`}>{limpo(acao.instruction)}</p>}
              {acao.reason && <p className={`text-[12.5px] leading-[18px] ${primeira ? "text-on-accent/80 lg:text-sub" : "text-sub"}`}>{limpo(acao.reason)}</p>}

              {sugerida && indice === comMensagem && (
                <div className="flex flex-col gap-1.5 rounded-none bg-bg p-3.5 text-fg lg:bg-surface">
                  <span className="text-[11.5px] font-semibold text-sub">Mensagem sugerida</span>
                  <p className="whitespace-pre-wrap text-[13.5px] leading-[20px]">{sugerida}</p>
                </div>
              )}

              <div className="mt-auto flex flex-wrap gap-2">
                {sugerida && indice === comMensagem && (
                  <>
                    {podeAgir && aoUsarMensagem && (
                      <button type="button" onClick={() => aoUsarMensagem(sugerida)} className={`${BOTAO_FORTE} max-lg:bg-bg max-lg:text-fg`}>
                        Usar na conversa
                      </button>
                    )}
                    <button type="button" onClick={() => aoCopiar(sugerida)} className={BOTAO}>
                      Copiar
                    </button>
                  </>
                )}
                {podeAgir && acao.action_type !== "reply" && (
                  <AcaoSugerida acao={acao} contato={contato} negocio={negocio} claro={primeira} aoCriado={aoCriado} />
                )}
              </div>
              <Evidencias ids={acao.evidence_message_ids} aoVer={aoVer} claro={primeira} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- por que

function PorQueEssaNota({ atendimento, motivos, aoVer }) {
  const criterios = criteriosEmOrdem(atendimento.criteria || []);
  // O motivo que não é de um critério da tabela (o Analista pode explicar
  // algo da conversa toda) aparece embaixo, para não se perder.
  const gerais = motivos.filter((motivo) => motivo?.explanation && !criterios.some((c) => c.key === motivo.criterion));
  const faixa = faixaDosPontos(atendimento.criteria || []);
  const conta = contaDaNota(atendimento);
  const LINHA = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 lg:grid-cols-[210px_140px_70px_140px_minmax(0,1fr)] lg:gap-x-4";
  return (
    <section className={`${CARTAO} flex flex-col gap-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-bold text-fg lg:text-[18px]">Por que essa nota</h2>
        {atendimento.score != null && (
          <span className="text-[12px] text-sub">
            nota = pontos ganhos ÷ peso avaliado · {String(conta.pontos).replace(".", ",")} ÷ {conta.pesoAvaliado} = {atendimento.score}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold text-sub">Os 100 pontos possíveis, por critério</span>
        <div className="flex h-[22px] gap-[3px] overflow-hidden rounded-none lg:h-[30px]" aria-hidden="true">
          {faixa.map((pedaco) => (
            <div key={pedaco.key} className={`flex ${pedaco.avaliado ? CLARO[pedaco.tom] || "bg-surface-hover" : ""}`} style={{ flex: `${pedaco.peso} 1 0`, ...(pedaco.avaliado ? {} : LISTRADO) }}>
              {pedaco.avaliado && pedaco.ganho > 0 && <div className={CHEIO[pedaco.tom] || "bg-sub"} style={{ width: `${pedaco.ganho}%` }} />}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-sub">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-ctl bg-success" />parte cheia: pontos ganhos</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-ctl bg-danger-soft" />parte clara: pontos perdidos</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-ctl" style={LISTRADO} />listrado: não avaliado, fica fora da conta</span>
        </div>
      </div>

      <div role="table" aria-label="Critérios da nota" className="flex flex-col">
        <div role="row" className={`${LINHA} hidden border-b border-line py-2 text-[12px] font-semibold text-sub lg:grid`}>
          <span role="columnheader">Critério</span>
          <span role="columnheader">Estado</span>
          <span role="columnheader">Pontos</span>
          <span role="columnheader" aria-label="Barra" />
          <span role="columnheader">Por quê</span>
        </div>
        {criterios.map((criterio) => {
          const tom = tomDoCriterio(criterio);
          const avaliado = criterio.points_awarded != null;
          const pontos = pontosDoCriterio(criterio);
          const ganho = avaliado ? (100 * Number(criterio.points_awarded)) / Number(criterio.weight) : 0;
          const motivo = motivoDoCriterio(criterio);
          return (
            <div key={criterio.key} role="row" className={`${LINHA} border-b border-line/60 py-3 last:border-b-0 ${avaliado ? "" : "text-sub"}`}>
              <span role="cell" className="text-[13.5px] font-semibold">
                <span className="lg:hidden">{NOME_DO_CRITERIO[criterio.key] || criterio.name}</span>
                <span className="hidden lg:inline">{NOME_LONGO_DO_CRITERIO[criterio.key] || criterio.name}</span>
              </span>
              <span role="cell">
                <span className={`inline-block whitespace-nowrap rounded-ctl px-2.5 py-[3px] text-[11.5px] font-semibold ${CHIP[tom]}`}>
                  {rotuloDoCriterio(criterio)}
                  {avaliado && <span className="lg:hidden"> · {pontos}</span>}
                </span>
              </span>
              <span role="cell" className="hidden text-[13px] tabular-nums lg:block">
                {avaliado ? pontos.replace("/", " / ") : "—"}
              </span>
              <span role="cell" aria-hidden="true" className="hidden lg:block">
                <span className={`flex h-2 overflow-hidden rounded-none ${avaliado ? CLARO[tom] || "bg-surface-hover" : ""}`} style={avaliado ? undefined : LISTRADO}>
                  {avaliado && ganho > 0 && <span className={CHEIO[tom] || "bg-sub"} style={{ width: `${ganho}%` }} />}
                </span>
              </span>
              <span role="cell" className="col-span-2 text-[12.5px] leading-[18px] lg:col-span-1 lg:text-[13px]">
                <span className={avaliado ? "text-fg/85" : ""}>{motivo}</span>
                <Evidencias ids={criterio.evidence_message_ids} aoVer={aoVer} />
              </span>
            </div>
          );
        })}
      </div>

      {gerais.length > 0 && (
        <ul className="flex flex-col gap-2 border-t border-line pt-3">
          {gerais.map((motivo, indice) => (
            <li key={indice} className="text-[13px] leading-[19px] text-fg">
              {limpo(motivo.explanation)}
              <Evidencias ids={motivo.evidence_message_ids} aoVer={aoVer} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- onde aconteceu

const LADO_Y = { cliente: 56, equipe: 136 };

/** As legendas não se atropelam: cada uma vai na primeira fileira livre. */
function fileiras(mensagens) {
  const fim = { cliente: [], equipe: [] };
  return Object.fromEntries(
    mensagens
      .filter((m) => m.legenda)
      .map((m) => {
        const largura = Math.min(24, m.legenda.length * 0.62 + 2);
        const de = m.x - largura / 2;
        const linhas = fim[m.lado];
        let fileira = linhas.findIndex((ate) => ate <= de);
        if (fileira < 0) fileira = linhas.length < 2 ? linhas.length : 1;
        linhas[fileira] = m.x + largura / 2;
        return [m.id, fileira];
      })
  );
}

function OndeAconteceu({ linha, aoVer }) {
  const momentos = momentosDaConversa(linha);
  const fileira = fileiras(linha.mensagens);
  const ultima = linha.mensagens[linha.mensagens.length - 1];
  const legendaY = (m) => (m.lado === "cliente" ? 16 - 18 * fileira[m.id] : 156 + 18 * fileira[m.id]);
  const alinhar = (x) => (x < 8 ? "translate-x-0" : x > 92 ? "-translate-x-full" : "-translate-x-1/2");
  return (
    <section className={`${CARTAO} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-bold text-fg lg:text-[18px]">
          <span className="lg:hidden">Momentos da conversa</span>
          <span className="hidden lg:inline">Onde aconteceu na conversa</span>
        </h2>
        {aoVer && <span className="hidden text-[12px] text-sub lg:inline">clique num ponto para abrir a mensagem</span>}
      </div>

      {/* Computador: a linha do tempo em duas faixas, cliente e equipe. */}
      <div className="hidden lg:block">
        <div className="relative h-[216px]">
          <span className="absolute left-0 top-[47px] text-[12px] font-semibold text-sub">Cliente</span>
          <span className="absolute left-0 top-[127px] text-[12px] font-semibold text-sub">Equipe</span>
          <div className="absolute bottom-0 left-[76px] right-0 top-0">
            <div className="absolute left-0 right-0 top-[56px] h-px bg-line" />
            <div className="absolute left-0 right-0 top-[136px] h-px bg-line" />
            {linha.parada && (
              <div className="absolute top-[34px] flex h-[124px] items-center justify-center rounded-none px-2 text-center" style={{ left: `${linha.parada.x1}%`, right: 0, ...LISTRADO }}>
                <span className="text-[12.5px] font-semibold text-sub">{linha.parada.rotulo}</span>
              </div>
            )}
            {linha.dias.map((dia) => (
              <div key={`${dia.x}-${dia.rotulo}`}>
                <div className="absolute top-[30px] h-[128px] w-px bg-line-strong" style={{ left: `${dia.x}%` }} />
                <span className="absolute top-[24px] pl-1.5 text-[11px] text-sub" style={{ left: `${dia.x}%` }}>{dia.rotulo}</span>
              </div>
            ))}
            {linha.pausas.map((pausa) => (
              <div key={pausa.desde}>
                <div className="absolute top-[95px] border-t-2 border-dashed border-line-strong" style={{ left: `${pausa.x1 + 0.8}%`, width: `${Math.max(0, pausa.x2 - pausa.x1 - 1.6)}%` }} />
                <span className="absolute top-[72px] -translate-x-1/2 whitespace-nowrap text-[11.5px] text-sub" style={{ left: `${(pausa.x1 + pausa.x2) / 2}%` }}>
                  {pausa.rotulo}
                </span>
              </div>
            ))}
            {linha.mensagens.map((m) => {
              const ia = m.lado === "equipe" && (m.autor === "ia" || m.autor === "bot");
              // A IA tem a cor dela (Sistema Grafite); a pessoa da equipe é o grafite.
              const cor = m.lado === "cliente" ? "bg-line-strong" : ia ? "bg-ia" : "bg-fg";
              const quem = m.lado === "cliente" ? "Cliente" : ia ? "IA" : "Equipe";
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={!aoVer}
                  onClick={() => aoVer?.(m.id)}
                  title={`${quem} · ${instanteEmTexto(m.em)}${m.trecho ? ` · ${m.trecho}` : ""}`}
                  aria-label={`${quem}, ${instanteEmTexto(m.em)}${m.legenda ? `: ${m.legenda}` : ""}`}
                  className="absolute flex h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full disabled:cursor-default"
                  style={{ left: `${m.x}%`, top: LADO_Y[m.lado] }}
                >
                  {m.tom && <span className={`absolute inset-0 rounded-full border-[3px] bg-bg ${ARO[m.tom]}`} />}
                  <span className={`relative h-3 w-3 rounded-full ${cor}`} />
                </button>
              );
            })}
            {linha.mensagens
              .filter((m) => m.legenda)
              .map((m) => (
                <span
                  key={`legenda-${m.id}`}
                  className={`absolute max-w-[24%] truncate text-[12px] ${m.tom === "accent" ? "text-fg/80" : `font-semibold ${LEGENDA[m.tom]}`} ${alinhar(m.x)}`}
                  style={{ left: `${m.x}%`, top: legendaY(m) }}
                >
                  {m.legenda}
                </span>
              ))}
            <span className="absolute top-[194px] text-[11px] text-sub" style={{ left: `${linha.mensagens[0].x}%` }}>
              {instanteEmTexto(linha.inicio)}
            </span>
            {linha.total > 1 && ultima.x - linha.mensagens[0].x > 18 && (
              <span className="absolute top-[194px] -translate-x-1/2 text-[11px] text-sub" style={{ left: `${ultima.x}%` }}>
                {instanteEmTexto(linha.fim)}
              </span>
            )}
            {linha.parada && <span className="absolute right-0 top-[194px] text-[11px] text-sub">na análise</span>}
          </div>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-sub">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-line-strong" />cliente</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-fg" />equipe</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ia" />IA ou robô</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-danger" />mensagem citada num alerta</span>
        </div>
      </div>

      {/* Celular: os momentos que importam, de cima para baixo. */}
      <ol className="flex flex-col lg:hidden">
        {momentos.map((momento, indice) => {
          const ultimo = indice === momentos.length - 1;
          return (
            <li key={`${momento.tipo}-${momento.em}-${momento.id || ""}`} className="flex gap-3">
              <span className="flex w-3.5 flex-none flex-col items-center" aria-hidden="true">
                {momento.tipo === "pausa" ? (
                  <span className="w-0 flex-1 border-l-2 border-dashed border-line-strong" />
                ) : (
                  <>
                    <span
                      className={`mt-[5px] flex-none rounded-full ${
                        momento.tipo === "parada"
                          ? "h-2.5 w-2.5 bg-line-strong"
                          : momento.tom && momento.tom !== "accent"
                            ? `h-3.5 w-3.5 border-[3px] bg-bg ${ARO[momento.tom]}`
                            : `h-2.5 w-2.5 ${momento.lado === "cliente" ? "bg-line-strong" : "bg-fg"}`
                      }`}
                    />
                    {!ultimo && <span className="w-0.5 flex-1 bg-line" />}
                  </>
                )}
              </span>
              <div className={ultimo ? "pb-0" : "pb-3.5"}>
                {momento.tipo === "mensagem" && (
                  <p className="text-[12px] text-sub">
                    {instanteEmTexto(momento.em)} · {momento.lado}
                  </p>
                )}
                {momento.tipo === "parada" && <p className="text-[12px] text-sub">na análise</p>}
                <p className={`text-[14px] ${momento.tipo === "pausa" ? "text-[13px] text-sub" : momento.tom && momento.tom !== "accent" ? `font-semibold ${LEGENDA[momento.tom]}` : "text-fg"}`}>
                  {momento.texto}
                </p>
                {momento.tipo === "mensagem" && aoVer && (
                  <button type="button" onClick={() => aoVer(momento.id)} className="min-h-[32px] cursor-pointer text-[13px] font-semibold text-accent-forte">
                    Abrir mensagem
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {momentos.length === 0 && <li className="text-[13px] text-sub">Nenhuma mensagem citada e nenhuma espera longa.</li>}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- peças

function Evidencias({ ids, aoVer, claro = false }) {
  if (!aoVer || !ids?.length) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-3">
      {ids.map((id, indice) => (
        <button
          key={id}
          type="button"
          onClick={() => aoVer(id)}
          className={`cursor-pointer text-[12px] font-semibold underline-offset-2 hover:underline ${claro ? "text-on-accent lg:text-accent-forte" : "text-accent-forte"}`}
        >
          {ids.length > 1 ? `Ver evidência ${indice + 1}` : "Ver evidência"}
        </button>
      ))}
    </span>
  );
}

/**
 * O botão da ação sugerida. Ele só prepara: tarefa, follow-up e compromisso
 * abrem um formulário preenchido para a pessoa revisar antes de criar. Data
 * sem hora fica sem hora.
 */
function AcaoSugerida({ acao, contato, negocio, claro, aoCriado }) {
  const prazo = prazoDaAcao(acao.due_at);
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState(acao.title || "");
  const [data, setData] = useState(prazo.data);
  const [hora, setHora] = useState(prazo.hora);
  const [estado, setEstado] = useState("livre"); // livre | salvando | feito
  const [erro, setErro] = useState("");
  const rotulo = ROTULO_DA_ACAO[acao.action_type];
  if (!rotulo) return null;

  if (!contato) {
    return <p className={`text-[12px] ${claro ? "text-on-accent/80 lg:text-faint" : "text-faint"}`}>Crie o lead para {rotulo.toLowerCase()} por aqui.</p>;
  }
  if (estado === "feito") {
    return (
      <p className={`inline-flex items-center gap-1 text-[12.5px] font-semibold ${claro ? "text-on-accent lg:text-success" : "text-success"}`}>
        <Check size={14} strokeWidth={2.5} /> Criado
      </p>
    );
  }
  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className={BOTAO}>
        {rotulo}
      </button>
    );
  }

  const criar = async (evento) => {
    evento.preventDefault();
    const instante = instanteDoPrazo({ data, hora });
    if (!titulo.trim()) return setErro("Dê um título.");
    if (!instante) return setErro("Escolha a data e a hora.");
    setEstado("salvando");
    setErro("");
    try {
      if (acao.action_type === "schedule_meeting") {
        await api.agenda.criar({
          titulo: titulo.trim(),
          descricao: acao.instruction || "",
          inicio: instante.toISOString(),
          fim: new Date(instante.getTime() + DURACAO_DO_COMPROMISSO_MS).toISOString(),
          contactId: contato.id,
        });
      } else {
        await api.tarefas.criar({ titulo: titulo.trim(), venceEm: instante.getTime(), contactId: contato.id, dealId: negocio?.id || null });
      }
      setEstado("feito");
      await aoCriado?.();
    } catch (falha) {
      setErro(falha?.message || "Não foi possível criar.");
      setEstado("livre");
    }
  };

  return (
    <form onSubmit={criar} className="flex w-full flex-col gap-2 rounded-none border border-line bg-bg p-2.5 text-fg">
      <input
        aria-label="Título"
        value={titulo}
        onChange={(evento) => setTitulo(evento.target.value)}
        className="min-h-[40px] rounded-ctl border border-line bg-bg px-2.5 text-[13px] text-fg outline-none focus:border-accent"
      />
      <div className="flex gap-2">
        <input
          type="date"
          aria-label="Data"
          value={data}
          onChange={(evento) => setData(evento.target.value)}
          className="min-h-[40px] min-w-0 flex-1 rounded-ctl border border-line bg-bg px-2.5 text-[13px] text-fg outline-none focus:border-accent"
        />
        <input
          type="time"
          aria-label="Hora"
          value={hora}
          onChange={(evento) => setHora(evento.target.value)}
          className="min-h-[40px] w-[104px] rounded-ctl border border-line bg-bg px-2.5 text-[13px] text-fg outline-none focus:border-accent"
        />
      </div>
      {!prazo.hora && prazo.data && <span className="text-[11.5px] text-faint">A conversa não diz o horário: escolha antes de criar.</span>}
      {erro && <span role="alert" className="text-[12px] text-danger">{erro}</span>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setAberto(false)} className="min-h-[40px] cursor-pointer px-3 text-[12.5px] text-sub hover:text-fg">
          Cancelar
        </button>
        <button type="submit" disabled={estado === "salvando"} className={`${BOTAO_FORTE} min-h-[40px] disabled:opacity-50`}>
          {estado === "salvando" ? "Criando…" : "Criar"}
        </button>
      </div>
    </form>
  );
}
