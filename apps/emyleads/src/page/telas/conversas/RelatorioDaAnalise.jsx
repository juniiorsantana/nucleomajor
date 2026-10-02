import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, MessageSquareText } from "lucide-react";
import { api } from "../../../data/client";
import {
  NOME_DO_CRITERIO,
  ROTULO_DA_ACAO,
  ROTULO_DA_PRIORIDADE,
  ROTULO_DO_ALERTA,
  ROTULO_DO_ESTADO,
  TOM_DO_ESTADO,
  instanteDoPrazo,
  notaEmTexto,
  pontosDoCriterio,
  prazoDaAcao,
} from "../../../domain/analiseDaConversa";
import { TONS } from "../../../lib/formato";

// A duração do compromisso criado por "Agendar": a mesma da sugestão antiga.
const DURACAO_DO_COMPROMISSO_MS = 30 * 60 * 1000;

/**
 * O relatório da análise no formato v1 (ANALYSIS_SCHEMA_V1_NUCLEO_MAJOR.md,
 * seção 11): a nota, o resumo, o porquê, o que fazer agora, a ação, as
 * evidências e, por último, o detalhamento por critério.
 *
 * A nota vem pronta do banco (o motor de regras); aqui nada é calculado. O
 * Lead Score não aparece enquanto não houver esquema para ele. Critério que
 * ainda não dá para avaliar aparece como "—", nunca como zero.
 */
export function RelatorioDaAnalise({ analise, podeAgir, contato, negocio, aoUsarMensagem, aoVerMensagem, aoCriado, aoFechar }) {
  const relatorio = analise.relatorio || null;
  const diagnostico = relatorio?.diagnosis || analise.resultado || {};
  const atendimento = relatorio?.atendimento_score || null;
  const criterios = atendimento?.criteria || [];
  const alertas = relatorio?.red_flags || diagnostico.red_flags || [];
  const acoes = diagnostico.what_to_do_now || [];
  const sugerida = diagnostico.suggested_message?.applicable ? diagnostico.suggested_message.text : null;
  const parcial = atendimento && atendimento.score != null && atendimento.evaluated_weight < atendimento.max_weight;
  const [detalhe, setDetalhe] = useState(false);
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

  return (
    <div>
      <section aria-label="Atendimento Score" className="rounded-[12px] border border-line px-3.5 py-3">
        <span className="text-[10.5px] font-bold uppercase tracking-[.08em] text-faint">Atendimento Score</span>
        <p className="mt-0.5 text-[20px] font-semibold tabular-nums text-fg">{notaEmTexto(atendimento)}</p>
        {parcial && (
          <p className="mt-0.5 text-[11px] text-sub">Nota parcial: considera só os critérios que já dá para avaliar nesta conversa.</p>
        )}
      </section>

      {diagnostico.summary && <p className="mt-3 text-[13px] leading-[19px] text-fg">{diagnostico.summary}</p>}

      {diagnostico.main_bottleneck?.title && (
        <Bloco titulo="Principal gargalo">
          <p className="text-[12.5px] font-semibold text-fg">{diagnostico.main_bottleneck.title}</p>
          {diagnostico.main_bottleneck.explanation && (
            <p className="mt-0.5 text-[12px] leading-[17px] text-sub">{diagnostico.main_bottleneck.explanation}</p>
          )}
          <Evidencias ids={diagnostico.main_bottleneck.evidence_message_ids} aoVer={verEvidencia} />
        </Bloco>
      )}

      {diagnostico.why_this_score?.length > 0 && (
        <Bloco titulo="Por que essa nota?">
          <ul className="flex flex-col gap-2">
            {diagnostico.why_this_score.map((motivo, indice) => (
              <li key={indice} className="text-[12px] leading-[17px] text-fg">
                {motivo.criterion && (
                  <span className="mr-1.5 rounded-[5px] bg-surface-hover px-1.5 py-[1px] text-[10.5px] font-semibold text-sub">
                    {NOME_DO_CRITERIO[motivo.criterion] || motivo.criterion}
                  </span>
                )}
                {motivo.explanation}
                <Evidencias ids={motivo.evidence_message_ids} aoVer={verEvidencia} />
              </li>
            ))}
          </ul>
        </Bloco>
      )}

      {acoes.length > 0 && (
        <Bloco titulo="O que fazer agora">
          <div className="flex flex-col gap-2">
            {acoes.map((acao, indice) => (
              <div
                key={indice}
                className={`rounded-[10px] px-3 py-2 ${indice === 0 ? "bg-accent-soft" : "border border-line"}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-fg">{acao.title || acao.instruction}</span>
                  {acao.priority && <span className="flex-none text-[10.5px] text-faint">{ROTULO_DA_PRIORIDADE[acao.priority]}</span>}
                </div>
                {acao.instruction && acao.title && <p className="mt-0.5 text-[12px] leading-[17px] text-fg">{acao.instruction}</p>}
                {acao.reason && <p className="mt-0.5 text-[11px] leading-[15px] text-faint">{acao.reason}</p>}
                <Evidencias ids={acao.evidence_message_ids} aoVer={verEvidencia} />
                {podeAgir && (
                  <AcaoSugerida acao={acao} sugerida={sugerida} contato={contato} negocio={negocio} aoUsarMensagem={usarMensagem} aoCriado={aoCriado} />
                )}
              </div>
            ))}
          </div>
        </Bloco>
      )}

      {sugerida && (
        <Bloco titulo="Mensagem sugerida">
          <p className="whitespace-pre-wrap rounded-[10px] border border-line px-3 py-2 text-[12.5px] leading-[18px] text-fg">{sugerida}</p>
          {podeAgir && usarMensagem && (
            <button
              type="button"
              onClick={() => usarMensagem(sugerida)}
              className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-line px-2.5 py-1 text-[11.5px] font-semibold text-accent-forte hover:border-accent"
            >
              <MessageSquareText size={13} strokeWidth={2} />
              Usar mensagem sugerida
            </button>
          )}
        </Bloco>
      )}

      {alertas.length > 0 && (
        <Bloco titulo="Alertas">
          <ul className="flex flex-col gap-1.5">
            {alertas.map((alerta) => (
              <li key={alerta.code} className="flex items-start gap-2 text-[12px] leading-[17px]">
                <AlertTriangle size={13} className="mt-[2px] flex-none text-warning" />
                <span className="min-w-0">
                  <span className="font-semibold text-fg">{ROTULO_DO_ALERTA[alerta.code] || alerta.code}</span>
                  {alerta.reason && <span className="text-sub"> — {alerta.reason}</span>}
                  <Evidencias ids={alerta.evidence_message_ids} aoVer={verEvidencia} />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10.5px] text-faint">Alertas destacam riscos; não descontam da nota.</p>
        </Bloco>
      )}

      {criterios.length > 0 && (
        <section className="mt-4">
          <button
            type="button"
            aria-expanded={detalhe}
            onClick={() => setDetalhe((valor) => !valor)}
            className="inline-flex cursor-pointer items-center gap-1 text-[11.5px] font-semibold text-accent-forte"
          >
            <ChevronDown size={13} className={`transition-transform ${detalhe ? "rotate-180" : ""}`} />
            {detalhe ? "Esconder critérios" : "Ver critérios"}
          </button>
          {detalhe && (
            <table className="mt-2 w-full text-[12px]">
              <tbody>
                {criterios.map((criterio) => (
                  <tr key={criterio.key} className="border-t border-line align-top">
                    <td className="py-1.5 pr-2 text-fg">
                      {criterio.name || NOME_DO_CRITERIO[criterio.key] || criterio.key}
                      {criterio.reason && <span className="block text-[11px] leading-[15px] text-faint">{criterio.reason}</span>}
                    </td>
                    <td className={`whitespace-nowrap py-1.5 pr-2 text-[11px] ${TONS[TOM_DO_ESTADO[criterio.status]] || "text-sub"}`}>
                      {ROTULO_DO_ESTADO[criterio.status] || criterio.status}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right font-semibold tabular-nums text-fg">{pontosDoCriterio(criterio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {aviso && <p role="status" className="mt-3 text-[11.5px] text-sub">{aviso}</p>}
    </div>
  );
}

function Bloco({ titulo, children }) {
  return (
    <section className="mt-4">
      <h3 className="text-[10.5px] font-bold uppercase tracking-[.08em] text-faint">{titulo}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function Evidencias({ ids, aoVer }) {
  if (!aoVer || !ids?.length) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-2">
      {ids.map((id, indice) => (
        <button
          key={id}
          type="button"
          onClick={() => aoVer(id)}
          className="cursor-pointer text-[11px] font-semibold text-accent-forte underline-offset-2 hover:underline"
        >
          {ids.length > 1 ? `Ver evidência ${indice + 1}` : "Ver evidência"}
        </button>
      ))}
    </span>
  );
}

/**
 * O botão da ação sugerida. Ele só prepara: a mensagem vai para a caixa de
 * texto, e tarefa, follow-up e compromisso abrem um formulário preenchido
 * para a pessoa revisar antes de criar. Data sem hora fica sem hora.
 */
function AcaoSugerida({ acao, sugerida, contato, negocio, aoUsarMensagem, aoCriado }) {
  const prazo = prazoDaAcao(acao.due_at);
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState(acao.title || "");
  const [data, setData] = useState(prazo.data);
  const [hora, setHora] = useState(prazo.hora);
  const [estado, setEstado] = useState("livre"); // livre | salvando | feito
  const [erro, setErro] = useState("");
  const rotulo = ROTULO_DA_ACAO[acao.action_type];
  if (!rotulo) return null;

  if (acao.action_type === "reply") {
    if (!sugerida || !aoUsarMensagem) return null;
    return (
      <button
        type="button"
        onClick={() => aoUsarMensagem(sugerida)}
        className="mt-1.5 cursor-pointer rounded-[8px] border border-line bg-bg px-2.5 py-1 text-[11.5px] font-semibold text-accent-forte hover:border-accent"
      >
        {rotulo}
      </button>
    );
  }

  if (!contato) {
    return <p className="mt-1.5 text-[11px] text-faint">Crie o lead para {rotulo.toLowerCase()} por aqui.</p>;
  }
  if (estado === "feito") {
    return (
      <p className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-success">
        <Check size={13} strokeWidth={2.5} /> Criado
      </p>
    );
  }
  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="mt-1.5 cursor-pointer rounded-[8px] border border-line bg-bg px-2.5 py-1 text-[11.5px] font-semibold text-accent-forte hover:border-accent"
      >
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
    <form onSubmit={criar} className="mt-2 flex flex-col gap-1.5 rounded-[9px] border border-line bg-bg p-2">
      <input
        aria-label="Título"
        value={titulo}
        onChange={(evento) => setTitulo(evento.target.value)}
        className="rounded-[7px] border border-line bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-accent"
      />
      <div className="flex gap-1.5">
        <input
          type="date"
          aria-label="Data"
          value={data}
          onChange={(evento) => setData(evento.target.value)}
          className="min-w-0 flex-1 rounded-[7px] border border-line bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-accent"
        />
        <input
          type="time"
          aria-label="Hora"
          value={hora}
          onChange={(evento) => setHora(evento.target.value)}
          className="w-[96px] rounded-[7px] border border-line bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-accent"
        />
      </div>
      {!prazo.hora && prazo.data && <span className="text-[10.5px] text-faint">A conversa não diz o horário: escolha antes de criar.</span>}
      {erro && <span role="alert" className="text-[11px] text-danger">{erro}</span>}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={() => setAberto(false)} className="cursor-pointer px-2 py-1 text-[11.5px] text-sub hover:text-fg">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={estado === "salvando"}
          className="cursor-pointer rounded-[7px] bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-white disabled:opacity-50"
        >
          {estado === "salvando" ? "Criando…" : "Criar"}
        </button>
      </div>
    </form>
  );
}
