import { adicionarDias, chaveDia, horaLocal, inicioDoDia } from "./agendaUtils";

const DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function eventosNoDia(eventos, dia) {
  const inicio = inicioDoDia(dia);
  const fim = adicionarDias(inicio, 1);
  return eventos
    .filter((evento) => new Date(evento.inicio) < fim && new Date(evento.fim) > inicio)
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
}

export default function VisaoMes({ dias, referencia, eventos, aoAbrir, aoCriar, aoVerDia }) {
  const hoje = chaveDia(new Date());
  return (
    <div className="scrollbar-fina min-h-0 flex-1 overflow-auto rounded-[14px] border border-line bg-bg">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-7 border-b border-line bg-surface/70">
          {DIAS_SEMANA.map((dia) => <div key={dia} className="border-r border-line px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint last:border-r-0">{dia}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {dias.map((dia) => {
            const itens = eventosNoDia(eventos, dia);
            const atual = dia.getMonth() === referencia.getMonth();
            return (
              <section key={chaveDia(dia)} className={`min-h-[128px] border-b border-r border-line p-2 last:border-r-0 ${atual ? "bg-bg" : "bg-surface/45"}`}>
                <button type="button" onClick={() => aoCriar(dia, 9 * 60, 10 * 60)} className={`mb-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[11px] font-semibold ${chaveDia(dia) === hoje ? "bg-accent text-white" : atual ? "text-sub hover:bg-surface-hover" : "text-faint hover:bg-surface-hover"}`}>{dia.getDate()}</button>
                <div className="space-y-1">
                  {itens.slice(0, 4).map((evento) => (
                    <button
                      key={`${evento.sourceType}-${evento.id}`}
                      type="button"
                      onClick={() => aoAbrir(evento)}
                      className="flex w-full cursor-pointer items-center gap-1.5 truncate rounded-[5px] border px-1.5 py-1 text-left text-[10px] font-medium text-fg transition-colors hover:bg-surface-hover"
                      style={{ borderColor: `${evento.categoryColor || "#8B7CFF"}99`, backgroundColor: `${evento.categoryColor || "#8B7CFF"}22` }}
                      title={`${evento.titulo} · ${evento.ownerName || "Sem responsável"}`}
                    >
                      <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: evento.categoryColor || "#8B7CFF" }} />
                      {!evento.diaInteiro && <span className="flex-none tabular-nums text-faint">{horaLocal(evento.inicio)}</span>}
                      <span className="truncate">{evento.titulo}</span>
                    </button>
                  ))}
                  {itens.length > 4 && <button type="button" onClick={() => aoVerDia(dia)} className="cursor-pointer px-1 text-[10px] font-medium text-accent-forte hover:underline">+{itens.length - 4} itens</button>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
