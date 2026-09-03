import { ArrowRight, CalendarPlus, DollarSign, SquareCheckBig, StickyNote, X } from "lucide-react";
import { corDoEstagio } from "../../../domain/types";
import { TONS, fmtMoeda, fmtRelativo, fmtVencimento } from "../../../lib/formato";
import { formatPhone } from "../../../lib/phone";
import { Iniciais, PilulaEstagio, SeloWhatsApp } from "../../ui";

/**
 * A ficha do contato, ao lado da conversa.
 *
 * Fecha pelo botão do cabeçalho da conversa. Fechada, ela e o menu recolhido
 * devolvem 550px para a conversa — que é o que se lê o dia inteiro.
 *
 * O que aparece aqui é dado REAL: negócio, tarefa, nota e etiquetas saem do
 * mesmo `dados` que a tela de Contatos usa. Só o histórico de mensagens é de
 * demonstração; a ficha nunca foi.
 */

const ATALHOS_DA_FICHA = [
  { id: "tarefa", rotulo: "Tarefa", icone: SquareCheckBig },
  { id: "agenda", rotulo: "Agenda", icone: CalendarPlus },
  { id: "nota", rotulo: "Nota", icone: StickyNote },
  { id: "negocio", rotulo: "Negócio", icone: DollarSign },
];

function Linha({ rotulo, children }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-[92px] flex-none text-[11.5px] text-faint">{rotulo}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function FichaLateral({
  conversa,
  contato,
  negocio,
  estagio,
  tarefa,
  nota,
  etiquetas,
  aoFechar,
  aoAtalho,
  aoAbrirFicha,
}) {
  const vencimento = tarefa ? fmtVencimento(tarefa.venceEm) : null;

  return (
    <aside className="hidden w-[296px] flex-none flex-col border-l border-line bg-bg lg:flex">
      <div className="flex flex-none items-center px-3.5 pt-3.5">
        <span className="text-[11px] font-bold uppercase tracking-[.08em] text-faint">
          Ficha do contato
        </span>
        <button
          onClick={aoFechar}
          title="Fechar ficha"
          className="ml-auto flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[9px] text-sub transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <X size={15} strokeWidth={2.2} />
        </button>
      </div>

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-3.5 pb-4 pt-3">
        <div className="flex flex-col items-center text-center">
          <Iniciais nome={conversa.nome} tamanho={62} />
          <span className="mt-2.5 text-[15.5px] font-semibold text-fg">{conversa.nome}</span>
          {(conversa.cargo || conversa.empresa) && (
            <span className="mt-0.5 text-[12px] text-sub">
              {[conversa.cargo, conversa.empresa].filter(Boolean).join(" · ")}
            </span>
          )}
          {conversa.telefone && (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-sub">
              <SeloWhatsApp tamanho={12} />
              {formatPhone(conversa.telefone)}
            </span>
          )}
        </div>

        <div className="mt-3.5 grid grid-cols-4 gap-1.5">
          {ATALHOS_DA_FICHA.map((a) => (
            <button
              key={a.id}
              onClick={() => aoAtalho(a.id)}
              className="flex cursor-pointer flex-col items-center gap-1.5 rounded-[10px] border border-line px-1 py-2.5 text-[10.5px] font-medium text-sub transition-colors hover:border-accent hover:text-accent-forte"
            >
              <a.icone size={15} strokeWidth={1.9} />
              {a.rotulo}
            </button>
          ))}
        </div>

        {negocio ? (
          <div className="mt-3.5 rounded-[11px] border border-line px-3 py-2.5">
            <div className="flex items-center gap-2">
              <PilulaEstagio nome={estagio?.nome} cor={corDoEstagio(estagio?.ordem)} />
              {negocio.valor != null && (
                <span className="ml-auto text-[14px] font-semibold tabular-nums text-fg">
                  {fmtMoeda(negocio.valor)}
                </span>
              )}
            </div>
            <div className="mt-1.5 text-[12.5px] font-medium text-fg">{negocio.titulo}</div>
            <div className="mt-0.5 text-[11px] text-faint">
              aberto {fmtRelativo(negocio.criadoEm)}
              {negocio.origem ? ` · origem ${negocio.origem}` : ""}
            </div>
          </div>
        ) : (
          <div className="mt-3.5 rounded-[11px] border border-dashed border-line px-3 py-2.5 text-[11.5px] text-faint">
            Nenhum negócio aberto com este contato.
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[.08em] text-faint">Tarefas</span>
        </div>
        {tarefa ? (
          <div
            className={`mt-1.5 flex items-start gap-2 rounded-[10px] border px-2.5 py-2.5 ${
              vencimento?.tom === "danger" ? "border-danger/25 bg-danger/5" : "border-line"
            }`}
          >
            <span className="mt-0.5 block h-[15px] w-[15px] flex-none rounded-[5px] border border-line-strong bg-bg" />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium text-fg">{tarefa.titulo}</span>
              <span className={`mt-0.5 block text-[10.5px] font-semibold ${TONS[vencimento.tom]}`}>
                {vencimento.texto}
              </span>
            </span>
          </div>
        ) : (
          <div className="mt-1.5 text-[11.5px] text-faint">Nada pendente.</div>
        )}

        <div className="mt-3.5 flex flex-col gap-2">
          <Linha rotulo="Responsável">
            <span className="text-[12px] text-fg">{contato?.responsavel || "—"}</span>
          </Linha>
          <Linha rotulo="Origem">
            <span className="text-[12px] text-fg">{contato?.origem || "—"}</span>
          </Linha>
          <Linha rotulo="Etiquetas">
            {etiquetas.length ? (
              <span className="flex flex-wrap gap-1">
                {etiquetas.map((t) => (
                  <span
                    key={t.id}
                    className="rounded-[5px] bg-surface px-1.5 py-0.5 text-[10.5px] text-sub"
                  >
                    {t.nome}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-[12px] text-faint">—</span>
            )}
          </Linha>
        </div>

        <div className="mt-3.5 border-t border-line pt-2.5">
          <span className="text-[11px] font-bold uppercase tracking-[.08em] text-faint">
            Última nota
          </span>
          {nota ? (
            <>
              <p className="mt-1.5 text-[12px] leading-[18px] text-sub">{nota.texto}</p>
              <span className="mt-1 block text-[10.5px] text-faint">
                {[nota.autor, fmtRelativo(nota.criadoEm)].filter(Boolean).join(" · ")}
              </span>
            </>
          ) : (
            <p className="mt-1.5 text-[12px] text-faint">Nenhuma nota ainda.</p>
          )}
        </div>
      </div>

      <div className="flex-none border-t border-line px-3.5 py-2.5">
        <button
          onClick={aoAbrirFicha}
          disabled={!contato}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border border-line py-2.5 text-[12.5px] font-semibold text-accent-forte transition-colors hover:border-accent disabled:cursor-default disabled:opacity-40"
        >
          Abrir ficha completa
          <ArrowRight size={14} strokeWidth={2} />
        </button>
      </div>
    </aside>
  );
}
