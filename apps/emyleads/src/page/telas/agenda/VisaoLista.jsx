import { CalendarPlus, LockKeyhole, MapPin } from "lucide-react";
import { CaixaConcluir } from "./componentes";
import {
  adicionarDias,
  chaveDia,
  corDaPessoa,
  corDoEvento,
  formatarDuracao,
  horaLocal,
  idDoResponsavel,
  iniciaisDoNome,
  inicioDoDia,
  minutosVisiveis,
  tipoDoEvento,
} from "./agendaUtils";

function itensDoDia(eventos, dia) {
  const inicio = inicioDoDia(dia);
  const fim = adicionarDias(inicio, 1);
  return eventos
    .filter((evento) => new Date(evento.inicio) < fim && new Date(evento.fim) > inicio)
    .sort((a, b) => {
      if (a.diaInteiro !== b.diaInteiro) return a.diaInteiro ? -1 : 1;
      return new Date(a.inicio) - new Date(b.inicio);
    });
}

function ItemLista({ evento, cor, cores, agora, podeConcluir, aoAbrir, aoConcluir }) {
  const tarefa = evento.sourceType === "task";
  const tipo = tipoDoEvento(evento);
  const inicio = new Date(evento.inicio);
  const fim = new Date(evento.fim);
  const acontecendo = !evento.diaInteiro && !tarefa && inicio <= agora && fim > agora;
  const passou = !evento.diaInteiro && (tarefa ? inicio < agora : fim <= agora);
  const detalhe = tarefa
    ? "Tarefa"
    : [evento.categoryName, evento.local].filter(Boolean).join(" · ") || tipo.rotulo;
  return (
    <li className="relative">
      <div className={`flex items-stretch gap-3 px-4 py-3 ${acontecendo ? "bg-accent-soft/50" : ""}`}>
        <button type="button" onClick={() => aoAbrir(evento)} className="flex w-[52px] flex-none cursor-pointer flex-col items-end pt-0.5 text-right" tabIndex={-1} aria-hidden="true">
          {evento.diaInteiro ? (
            <span className="text-[12px] font-semibold uppercase tracking-wide text-faint">Dia</span>
          ) : (
            <>
              <span className={`text-[15px] font-semibold tabular-nums md:text-[13px] ${passou ? "text-faint" : "text-fg"}`}>{horaLocal(evento.inicio)}</span>
              {!tarefa && <span className="text-[12px] tabular-nums text-faint md:text-[11px]">{formatarDuracao(minutosVisiveis(evento))}</span>}
            </>
          )}
        </button>
        <span className="w-1 flex-none rounded-full" style={{ backgroundColor: cor, opacity: passou ? 0.45 : 1 }} aria-hidden="true" />
        <button type="button" onClick={() => aoAbrir(evento)} className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center text-left">
          <span className={`flex items-center gap-1.5 text-[16px] font-medium leading-5 md:text-[13.5px] ${passou ? "text-sub" : "text-fg"}`}>
            {tipo.id === "unavailable" && <LockKeyhole size={13} className="flex-none text-faint" />}
            <span className="truncate">{evento.titulo}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-faint md:text-[11.5px]">
            {evento.local && !tarefa && <MapPin size={12} className="flex-none" />}
            <span className="truncate">{detalhe}</span>
            {acontecendo && <span className="ml-1 flex-none rounded-full bg-accent px-1.5 text-[11px] font-bold uppercase tracking-wide text-white md:text-[9.5px]">Agora</span>}
          </span>
        </button>
        {tarefa && podeConcluir ? (
          <span className="flex items-center"><CaixaConcluir marcada={false} aoMudar={() => aoConcluir(evento)} titulo={`Concluir “${evento.titulo}”`} /></span>
        ) : evento.ownerName ? (
          <span
            title={evento.ownerName}
            className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center self-start rounded-full text-[10px] font-bold text-white"
            style={{ backgroundColor: corDaPessoa(idDoResponsavel(evento), cores) }}
          >
            {iniciaisDoNome(evento.ownerName)}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Lista do dia ou da semana — o jeito de ver a agenda no telefone.
 *
 * A grade de horário precisa de 680px para não virar rolagem lateral, e no
 * toque a rolagem lateral briga com o arraste. Aqui o tempo vira ordem de
 * leitura, com texto de 15–16px: a lista antiga tinha horário de 10px, que no
 * telefone se lia forçando a vista.
 *
 * Na semana, o dia vazio aparece como uma linha curta "Livre": saber que a
 * quinta está livre é informação para quem vai marcar alguma coisa.
 */
export default function VisaoLista({ dias, eventos, aoAbrir, aoCriar, aoConcluir, podeConcluir = () => false, modoCor = "tipo", cores, rotuloDia = true }) {
  const hoje = chaveDia(new Date());
  const agora = new Date();
  const grupos = dias.map((dia) => ({ dia, itens: itensDoDia(eventos, dia) }));
  const umDia = dias.length === 1;

  return (
    <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto rounded-none border border-line bg-bg">
      {/* O respiro do fim deixa o último compromisso sair de trás do "+". */}
      {grupos.map(({ dia, itens }) => {
        const ehHoje = chaveDia(dia) === hoje;
        const titulo = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "short" }).format(dia).replaceAll(".", "");
        if (!itens.length && !umDia) {
          return (
            <section key={chaveDia(dia)} className="flex min-h-12 items-center gap-2 border-b border-line px-4 last:border-b-0">
              <span className={`text-[14px] font-semibold first-letter:uppercase md:text-[12.5px] ${ehHoje ? "text-accent-forte" : "text-sub"}`}>{titulo}</span>
              <span className="text-[13px] text-faint md:text-[11.5px]">· Livre</span>
              <button type="button" onClick={() => aoCriar(dia)} aria-label={`Marcar compromisso em ${titulo}`} className="ml-auto flex h-11 w-11 cursor-pointer items-center justify-center rounded-ctl text-sub hover:bg-surface-hover hover:text-fg md:h-9 md:w-9">
                <CalendarPlus size={18} />
              </button>
            </section>
          );
        }
        return (
          <section key={chaveDia(dia)} className="border-b border-line last:border-b-0">
            {(rotuloDia || !umDia) && (
              <header className="sticky top-0 z-10 flex min-h-12 items-center gap-2 border-b border-line bg-bg/95 px-4 backdrop-blur">
                <span className={`text-[15px] font-semibold first-letter:uppercase md:text-[13px] ${ehHoje ? "text-accent-forte" : "text-fg"}`}>{titulo}</span>
                {ehHoje && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent-forte md:text-[9.5px]">Hoje</span>}
                <span className="text-[13px] text-faint md:text-[11px]">· {itens.length} {itens.length === 1 ? "item" : "itens"}</span>
                <button type="button" onClick={() => aoCriar(dia)} aria-label={`Marcar compromisso em ${titulo}`} className="ml-auto flex h-11 w-11 cursor-pointer items-center justify-center rounded-ctl text-sub hover:bg-surface-hover hover:text-fg md:h-9 md:w-9">
                  <CalendarPlus size={18} />
                </button>
              </header>
            )}
            {itens.length ? (
              <ul className="divide-y divide-line">
                {itens.map((evento) => (
                  <ItemLista
                    key={`${evento.sourceType}-${evento.id}`}
                    evento={evento}
                    cor={corDoEvento(evento, modoCor, cores)}
                    cores={cores}
                    agora={agora}
                    podeConcluir={podeConcluir(evento)}
                    aoAbrir={aoAbrir}
                    aoConcluir={aoConcluir}
                  />
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center px-6 py-14 text-center">
                <p className="text-[16px] font-medium text-fg md:text-[14px]">{ehHoje ? "Nada marcado para hoje" : "Dia livre"}</p>
                <p className="mt-1 text-[14px] text-sub md:text-[12.5px]">Nenhum compromisso nem tarefa com prazo neste dia.</p>
                <button type="button" onClick={() => aoCriar(dia)} className="mt-4 flex min-h-11 cursor-pointer items-center gap-2 rounded-ctl border border-line px-4 text-[14px] font-semibold text-fg hover:border-accent hover:text-accent-forte md:min-h-9 md:text-[13px]">
                  <CalendarPlus size={16} />Marcar compromisso
                </button>
              </div>
            )}
          </section>
        );
      })}
      <div aria-hidden="true" className="h-20 md:hidden" />
    </div>
  );
}
