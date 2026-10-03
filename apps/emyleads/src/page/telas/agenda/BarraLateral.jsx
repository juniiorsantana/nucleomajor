import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, Plus } from "lucide-react";
import MiniCalendario from "./MiniCalendario";
import { CaixaConcluir } from "./componentes";
import { horaLocal } from "./agendaUtils";

function Momento({ item, agora }) {
  if (item.tarefa) return <span className="w-11 flex-none text-right text-[12px] font-semibold tabular-nums text-sub">{item.hora}</span>;
  const inicio = new Date(item.evento.inicio);
  const fim = new Date(item.evento.fim);
  if (item.evento.diaInteiro) return <span className="w-11 flex-none text-right text-[10.5px] font-semibold uppercase text-faint">Dia</span>;
  if (inicio <= agora && fim > agora) return <span className="w-11 flex-none text-right text-[10.5px] font-bold uppercase text-accent-forte">Agora</span>;
  return <span className={`w-11 flex-none text-right text-[12px] font-semibold tabular-nums ${fim <= agora ? "text-faint" : "text-sub"}`}>{horaLocal(inicio)}</span>;
}

/**
 * O dia de hoje ao lado da grade, qualquer que seja a semana aberta.
 *
 * A agenda mostrava o período escolhido e mais nada: quem voltava duas
 * semanas para achar uma reunião perdia de vista o que ainda tinha hoje. Aqui
 * ficam o próximo compromisso e as tarefas do dia, com a caixinha para
 * concluir sem sair da agenda — o painel de tarefas antigo só abria a tarefa,
 * e abrir levava para outra tela.
 */
export default function BarraLateral({
  referencia,
  visualizacao,
  marcas,
  itensHoje,
  atrasadas,
  aoEscolherDia,
  aoAbrirEvento,
  aoAbrirTarefa,
  aoConcluirTarefa,
  aoNovaTarefa,
  aoIrParaTarefas,
}) {
  const [mes, setMes] = useState(() => new Date(referencia));
  useEffect(() => { setMes(new Date(referencia)); }, [referencia]);
  const agora = new Date();
  const pendentes = itensHoje.filter((item) => (item.tarefa ? true : new Date(item.evento.fim) > agora));

  return (
    <aside aria-label="Hoje e calendário" className="scrollbar-fina hidden w-[272px] flex-none flex-col gap-4 overflow-y-auto border-r border-line bg-bg px-4 py-4 lg:flex">
      <MiniCalendario
        mes={mes}
        selecionado={referencia}
        destacarSemana={visualizacao === "week"}
        marcas={marcas}
        aoEscolher={aoEscolherDia}
        aoMudarMes={(direcao) => setMes((atual) => new Date(atual.getFullYear(), atual.getMonth() + direcao, 1))}
      />

      <section className="border-t border-line pt-4">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold text-fg">Hoje</h2>
          <span className="text-[11.5px] first-letter:uppercase text-faint">
            {new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "short" }).format(agora).replaceAll(".", "")}
          </span>
        </div>
        {itensHoje.length === 0 ? (
          <p className="mt-3 text-[12px] leading-5 text-faint">Nada marcado para hoje.</p>
        ) : pendentes.length === 0 ? (
          <p className="mt-3 text-[12px] leading-5 text-faint">Tudo de hoje já passou. Bom trabalho.</p>
        ) : null}
        <ul className="mt-2 space-y-0.5">
          {itensHoje.map((item) => (
            <li key={item.chave} className="flex items-center gap-2">
              <Momento item={item} agora={agora} />
              <span className="h-5 w-[3px] flex-none rounded-full" style={{ backgroundColor: item.cor }} aria-hidden="true" />
              <button
                type="button"
                onClick={() => (item.tarefa ? aoAbrirTarefa(item.tarefa) : aoAbrirEvento(item.evento))}
                className={`min-h-8 min-w-0 flex-1 cursor-pointer truncate rounded-ctl px-1 text-left text-[12.5px] hover:bg-surface-hover ${!item.tarefa && new Date(item.evento.fim) <= agora ? "text-faint" : "text-fg"}`}
                title={item.titulo}
              >
                {item.titulo}
              </button>
              {item.tarefa && <CaixaConcluir marcada={false} aoMudar={() => aoConcluirTarefa(item.tarefa)} titulo={`Concluir “${item.titulo}”`} />}
            </li>
          ))}
        </ul>
        <button type="button" onClick={aoNovaTarefa} className="mt-2 flex min-h-8 cursor-pointer items-center gap-1.5 rounded-ctl px-1 text-[12px] font-semibold text-accent-forte hover:bg-accent-soft">
          <Plus size={14} />Tarefa para hoje
        </button>
      </section>

      {atrasadas > 0 && (
        <button type="button" onClick={aoIrParaTarefas} className="flex cursor-pointer items-center gap-2 rounded-ctl border border-danger/25 bg-danger/5 px-3 py-2.5 text-left text-[12px] text-danger hover:bg-danger/10">
          <AlertTriangle size={15} className="flex-none" />
          <span className="flex-1"><strong>{atrasadas}</strong> {atrasadas === 1 ? "tarefa atrasada" : "tarefas atrasadas"}</span>
          <ChevronRight size={15} />
        </button>
      )}
    </aside>
  );
}
