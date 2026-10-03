import { ChevronLeft, ChevronRight } from "lucide-react";
import { adicionarDias, chaveDia, inicioDaSemana, inicioDoMes } from "./agendaUtils";

const INICIAIS = ["S", "T", "Q", "Q", "S", "S", "D"];

/**
 * Mês em miniatura para navegar e para ver onde há compromisso.
 *
 * Serve três lugares: a coluna lateral do computador, o seletor de período do
 * telefone e o Mês do telefone — onde a grade de 760px de largura obrigava a
 * rolar para o lado. `grande` troca as células de 32px pelas de 44px, que é o
 * alvo de toque.
 *
 * `marcas` é um mapa `chaveDia → [cores]`: até três pontos por dia, na cor do
 * que está marcado, para a pessoa ver de longe que dia está cheio.
 */
export default function MiniCalendario({ mes, selecionado, marcas = new Map(), aoEscolher, aoMudarMes, grande = false, destacarSemana = false }) {
  const primeiro = inicioDoMes(mes);
  const inicio = inicioDaSemana(primeiro);
  const dias = Array.from({ length: 42 }, (_, i) => adicionarDias(inicio, i));
  // Seis linhas só quando o mês pede; a sexta vazia empurrava o resto da
  // coluna lateral para baixo sem mostrar nada.
  const linhas = dias[35].getMonth() === primeiro.getMonth() ? 6 : 5;
  const hoje = chaveDia(new Date());
  const escolhido = selecionado ? chaveDia(selecionado) : null;
  const semanaEscolhida = selecionado ? chaveDia(inicioDaSemana(selecionado)) : null;
  const titulo = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(primeiro);
  const celula = grande ? "h-11 text-[15px]" : "h-8 text-[12px]";

  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <span className={`flex-1 font-semibold first-letter:uppercase text-fg ${grande ? "text-[16px]" : "text-[13px]"}`}>{titulo}</span>
        <button type="button" aria-label="Mês anterior" onClick={() => aoMudarMes(-1)} className={`flex cursor-pointer items-center justify-center rounded-[8px] text-sub hover:bg-surface-hover hover:text-fg ${grande ? "h-11 w-11" : "h-8 w-8"}`}><ChevronLeft size={grande ? 20 : 16} /></button>
        <button type="button" aria-label="Próximo mês" onClick={() => aoMudarMes(1)} className={`flex cursor-pointer items-center justify-center rounded-[8px] text-sub hover:bg-surface-hover hover:text-fg ${grande ? "h-11 w-11" : "h-8 w-8"}`}><ChevronRight size={grande ? 20 : 16} /></button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {INICIAIS.map((letra, i) => (
          <span key={i} aria-hidden="true" className={`py-1 font-semibold text-faint ${grande ? "text-[12px]" : "text-[10.5px]"}`}>{letra}</span>
        ))}
        {dias.slice(0, linhas * 7).map((dia) => {
          const chave = chaveDia(dia);
          const doMes = dia.getMonth() === primeiro.getMonth();
          const ehHoje = chave === hoje;
          const ehEscolhido = chave === escolhido;
          const naSemana = destacarSemana && chaveDia(inicioDaSemana(dia)) === semanaEscolhida;
          const cores = marcas.get(chave) || [];
          return (
            <button
              key={chave}
              type="button"
              onClick={() => aoEscolher(dia)}
              aria-label={new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(dia) + (cores.length ? ", com compromissos" : "")}
              aria-current={ehHoje ? "date" : undefined}
              aria-pressed={ehEscolhido}
              className={`relative flex cursor-pointer flex-col items-center justify-center tabular-nums ${celula} ${naSemana && !ehEscolhido ? "bg-accent-soft/60" : ""}`}
            >
              <span className={`flex items-center justify-center rounded-full ${grande ? "h-9 w-9" : "h-7 w-7"} ${
                ehEscolhido ? "bg-accent font-bold text-white"
                  : ehHoje ? "font-bold text-accent-forte ring-1 ring-accent"
                    : doMes ? "font-medium text-fg hover:bg-surface-hover" : "text-faint hover:bg-surface-hover"
              }`}
              >
                {dia.getDate()}
              </span>
              {cores.length > 0 && (
                <span aria-hidden="true" className={`absolute flex gap-[2px] ${grande ? "bottom-0" : "-bottom-0.5"}`}>
                  {cores.slice(0, 3).map((cor, i) => (
                    <span key={i} className="h-[4px] w-[4px] rounded-full" style={{ backgroundColor: cor }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Mapa `chaveDia → cores` a partir dos eventos, para os pontos do calendário. */
export function marcasDosEventos(eventos, corDe) {
  const mapa = new Map();
  for (const evento of eventos) {
    const inicio = new Date(evento.inicio);
    const fim = new Date(evento.fim);
    for (let dia = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate()); dia < fim; dia = adicionarDias(dia, 1)) {
      const chave = chaveDia(dia);
      const lista = mapa.get(chave) || [];
      const cor = corDe(evento);
      // Cores diferentes primeiro: três pontos da mesma cor dizem menos que
      // "tem reunião e tem tarefa".
      if (lista.length < 3 && !lista.includes(cor)) lista.push(cor);
      mapa.set(chave, lista);
    }
  }
  return mapa;
}
