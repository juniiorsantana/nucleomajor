import { CalendarPlus } from "lucide-react";
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
} from "./agendaUtils";

/**
 * Visão de lista para telas estreitas.
 *
 * A grade de horário precisa de 680px para não virar rolagem horizontal, e no
 * celular a rolagem horizontal briga com o gesto de arrastar para criar. Aqui
 * o eixo do tempo vira ordem de leitura: some a precisão de posição, mas cada
 * evento ganha nome, horário e responsável legíveis sem zoom.
 */
export default function VisaoLista({ dias, eventos, aoAbrir, aoCriar, modoCor = "categoria" }) {
  const hoje = chaveDia(new Date());
  const comEventos = dias.map((dia) => {
    const inicio = inicioDoDia(dia);
    const fim = adicionarDias(inicio, 1);
    const itens = eventos
      .filter((evento) => new Date(evento.inicio) < fim && new Date(evento.fim) > inicio)
      .sort((a, b) => {
        if (a.diaInteiro !== b.diaInteiro) return a.diaInteiro ? -1 : 1;
        return new Date(a.inicio) - new Date(b.inicio);
      });
    return { dia, itens };
  });

  const algumEvento = comEventos.some((grupo) => grupo.itens.length);

  return (
    <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto rounded-[14px] border border-line bg-bg">
      {!algumEvento && (
        <p className="px-4 py-16 text-center text-[12px] text-faint">
          Nenhum evento neste período. Toque em um dia para criar o primeiro.
        </p>
      )}
      {comEventos.map(({ dia, itens }) => {
        // Dia vazio some da lista quando há conteúdo em outros dias: no celular
        // uma pilha de "nada aqui" empurra para fora da tela o que importa.
        if (!itens.length && algumEvento) return null;
        const ehHoje = chaveDia(dia) === hoje;
        return (
          <section key={chaveDia(dia)} className="border-b border-line last:border-b-0">
            <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur">
              <span className={`text-[12px] font-semibold capitalize ${ehHoje ? "text-accent-forte" : "text-fg"}`}>
                {new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "short" }).format(dia).replaceAll(".", "")}
              </span>
              {ehHoje && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-accent-forte">Hoje</span>}
              <button
                type="button"
                onClick={() => aoCriar(dia, 9 * 60, 10 * 60)}
                aria-label="Criar evento neste dia"
                className="ml-auto cursor-pointer rounded-[8px] p-1.5 text-sub hover:bg-surface-hover hover:text-fg"
              >
                <CalendarPlus size={16} />
              </button>
            </header>
            <ul className="divide-y divide-line">
              {itens.map((evento) => {
                const cor = corDoEvento(evento, modoCor);
                return (
                  <li key={`${evento.sourceType}-${evento.id}`}>
                    <button
                      type="button"
                      onClick={() => aoAbrir(evento)}
                      className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left hover:bg-surface-hover"
                    >
                      <span className="mt-0.5 w-[46px] flex-none text-right">
                        {evento.diaInteiro ? (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">Dia</span>
                        ) : (
                          <>
                            <span className="block text-[12px] font-semibold tabular-nums text-fg">{horaLocal(evento.inicio)}</span>
                            <span className="block text-[10px] tabular-nums text-faint">{formatarDuracao(minutosVisiveis(evento))}</span>
                          </>
                        )}
                      </span>
                      <span className="mt-1 h-full min-h-[26px] w-[3px] flex-none rounded-full" style={{ backgroundColor: cor }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-fg">{evento.titulo}</span>
                        <span className="mt-0.5 block truncate text-[10.5px] text-faint">
                          {[evento.categoryName, evento.local].filter(Boolean).join(" · ") || "Sem categoria"}
                        </span>
                      </span>
                      {evento.ownerName && (
                        <span
                          title={evento.ownerName}
                          className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-[9px] font-bold text-white"
                          style={{ backgroundColor: corDaPessoa(idDoResponsavel(evento)) }}
                        >
                          {iniciaisDoNome(evento.ownerName)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
