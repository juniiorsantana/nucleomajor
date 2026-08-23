import { useMemo, useRef, useState } from "react";
import { BriefcaseBusiness, Clock3, GripHorizontal, LockKeyhole } from "lucide-react";
import {
  ALTURA_HORA,
  PASSO_MINUTOS,
  adicionarDias,
  arredondarMinutos,
  chaveDia,
  formatarDuracao,
  horaLocal,
  inicioDoDia,
  minutosVisiveis,
  segmentosDoDia,
} from "./agendaUtils";

const CLARA = "#FFFFFF";

function contraste(hex) {
  const valor = String(hex || "#CBD5E1").replace("#", "");
  if (valor.length !== 6) return "#121730";
  const [r, g, b] = [0, 2, 4].map((indice) => parseInt(valor.slice(indice, indice + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#121730" : CLARA;
}

function rotuloDia(dia, compacto = false) {
  return new Intl.DateTimeFormat("pt-BR", compacto
    ? { weekday: "short", day: "2-digit" }
    : { weekday: "short", day: "2-digit", month: "short" })
    .format(dia)
    .replaceAll(".", "");
}

function IconeTipo({ evento }) {
  if (evento.sourceType === "task") return <Clock3 size={11} />;
  if (evento.visibilidade === "personal") return <LockKeyhole size={10} />;
  return <BriefcaseBusiness size={11} />;
}

function BlocoEvento({ segmento, inicioMinuto, alturaPorMinuto, podeMover, aoAbrir, aoIniciarResize, aoDragStart }) {
  const { evento } = segmento;
  const inicio = Math.max(segmento.inicioMinutos, inicioMinuto);
  const fim = Math.max(inicio, segmento.fimMinutos);
  const topo = (inicio - inicioMinuto) * alturaPorMinuto;
  const altura = Math.max(24, (fim - inicio) * alturaPorMinuto - 2);
  const largura = 100 / segmento.colunas;
  const privada = evento.titulo === "Indisponível";
  const tarefa = evento.sourceType === "task";
  const cor = privada ? "#CBD5E1" : evento.categoryColor || (tarefa ? "#F59E0B" : "#8B7CFF");
  const editavel = podeMover(evento);

  return (
    <button
      type="button"
      data-agenda-evento="true"
      draggable={editavel}
      onDragStart={(e) => aoDragStart(e, evento)}
      onClick={(e) => { e.stopPropagation(); aoAbrir(evento); }}
      className={`group absolute z-[2] overflow-hidden rounded-[8px] border-l-[3px] px-2 py-1 text-left shadow-sm transition-[filter,box-shadow] hover:z-[4] hover:brightness-[0.98] hover:shadow-md ${tarefa ? "border-dashed" : ""} ${editavel ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
      style={{
        top: topo,
        height: altura,
        left: `calc(${segmento.coluna * largura}% + 2px)`,
        width: `calc(${largura}% - 4px)`,
        backgroundColor: cor,
        borderColor: privada ? "#94A3B8" : cor,
        color: contraste(cor),
      }}
      title={`${evento.titulo} · ${horaLocal(evento.inicio)}–${horaLocal(evento.fim)} · ${evento.ownerName || "Sem responsável"}`}
    >
      <span className="flex min-w-0 items-center gap-1 text-[10px] font-semibold leading-3 opacity-80">
        <IconeTipo evento={evento} />
        <span className="truncate">{horaLocal(evento.inicio)}–{horaLocal(evento.fim)}</span>
      </span>
      {altura >= 38 && <span className="mt-0.5 block truncate text-[11.5px] font-semibold leading-4">{evento.titulo}</span>}
      {altura >= 58 && <span className="block truncate text-[10px] leading-4 opacity-75">{evento.ownerName}</span>}
      {editavel && !tarefa && (
        <span
          aria-hidden="true"
          onPointerDown={(e) => { e.stopPropagation(); aoIniciarResize(e, evento); }}
          className="absolute inset-x-0 bottom-0 flex h-3 cursor-ns-resize items-center justify-center opacity-0 transition-opacity group-hover:opacity-80"
        >
          <GripHorizontal size={12} />
        </span>
      )}
    </button>
  );
}

export default function GradeAgenda({
  dias,
  eventos,
  inicioMinuto,
  fimMinuto,
  podeMover,
  aoAbrir,
  aoCriar,
  aoMover,
  aoRedimensionar,
}) {
  const alturaPorMinuto = ALTURA_HORA / 60;
  const altura = (fimMinuto - inicioMinuto) * alturaPorMinuto;
  const [selecao, setSelecao] = useState(null);
  const raizRef = useRef(null);
  const horas = useMemo(() => {
    const lista = [];
    for (let minuto = Math.ceil(inicioMinuto / 60) * 60; minuto <= fimMinuto; minuto += 60) lista.push(minuto);
    return lista;
  }, [fimMinuto, inicioMinuto]);

  const minutosNoPonteiro = (e, elemento) => {
    const rect = elemento.getBoundingClientRect();
    return arredondarMinutos(inicioMinuto + ((e.clientY - rect.top) / rect.height) * (fimMinuto - inicioMinuto));
  };

  const iniciarSelecao = (e, dia) => {
    if (e.button !== 0 || e.target.closest("[data-agenda-evento]")) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const minuto = minutosNoPonteiro(e, e.currentTarget);
    setSelecao({ dia, inicio: minuto, fim: Math.min(minuto + PASSO_MINUTOS, fimMinuto), pointerId: e.pointerId });
  };

  const moverSelecao = (e) => {
    if (!selecao || selecao.pointerId !== e.pointerId) return;
    const minuto = minutosNoPonteiro(e, e.currentTarget);
    setSelecao((atual) => ({ ...atual, fim: Math.max(inicioMinuto, Math.min(fimMinuto, minuto + PASSO_MINUTOS)) }));
  };

  const concluirSelecao = (e) => {
    if (!selecao || selecao.pointerId !== e.pointerId) return;
    const inicio = Math.min(selecao.inicio, selecao.fim - PASSO_MINUTOS);
    const fim = Math.max(selecao.inicio + PASSO_MINUTOS, selecao.fim);
    aoCriar(selecao.dia, inicio, fim);
    setSelecao(null);
  };

  const iniciarResize = (e, evento) => {
    const inicialY = e.clientY;
    const duracaoInicial = minutosVisiveis(evento);
    const bloco = e.currentTarget?.closest("[data-agenda-evento]");
    const deltaEmPassos = (clientY) => Math.round(((clientY - inicialY) / alturaPorMinuto) / PASSO_MINUTOS) * PASSO_MINUTOS;
    const mover = (movimento) => {
      const delta = deltaEmPassos(movimento.clientY);
      const duracao = Math.max(PASSO_MINUTOS, duracaoInicial + delta);
      bloco?.style.setProperty("height", `${duracao * alturaPorMinuto - 2}px`);
    };
    const soltar = (fim) => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      const delta = deltaEmPassos(fim.clientY);
      aoRedimensionar(evento, Math.max(PASSO_MINUTOS, duracaoInicial + delta));
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar, { once: true });
  };

  const agora = new Date();
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
  const temHoje = dias.some((dia) => chaveDia(dia) === chaveDia(agora));

  return (
    <div ref={raizRef} className="scrollbar-fina min-h-0 flex-1 overflow-auto rounded-[14px] border border-line bg-bg">
      <div className="min-w-[760px]" style={{ width: dias.length === 1 ? "100%" : `${Math.max(760, dias.length * 150)}px` }}>
        <div className="sticky top-0 z-20 grid border-b border-line bg-bg/95 backdrop-blur" style={{ gridTemplateColumns: `58px repeat(${dias.length}, minmax(0, 1fr))` }}>
          <div className="border-r border-line" />
          {dias.map((dia) => (
            <div key={chaveDia(dia)} className={`border-r border-line px-2 py-2.5 text-center last:border-r-0 ${chaveDia(dia) === chaveDia(agora) ? "bg-accent-soft" : ""}`}>
              <span className={`text-[11.5px] font-semibold capitalize ${chaveDia(dia) === chaveDia(agora) ? "text-accent-forte" : "text-sub"}`}>{rotuloDia(dia, dias.length > 3)}</span>
            </div>
          ))}
        </div>

        <div className="grid border-b border-line bg-surface/60" style={{ gridTemplateColumns: `58px repeat(${dias.length}, minmax(0, 1fr))` }}>
          <div className="border-r border-line px-2 py-2 text-right text-[9px] font-semibold uppercase tracking-wide text-faint">Dia</div>
          {dias.map((dia) => {
            const inicio = inicioDoDia(dia);
            const fim = adicionarDias(inicio, 1);
            const inteiros = eventos.filter((evento) => evento.diaInteiro && new Date(evento.inicio) < fim && new Date(evento.fim) > inicio);
            return (
              <div key={chaveDia(dia)} className="min-h-9 border-r border-line p-1 last:border-r-0">
                {inteiros.map((evento) => (
                  <button key={`${evento.sourceType}-${evento.id}`} type="button" onClick={() => aoAbrir(evento)} className="mb-1 block w-full cursor-pointer truncate rounded-[6px] px-2 py-1 text-left text-[10.5px] font-semibold" style={{ backgroundColor: evento.categoryColor || "#C4B5FD", color: contraste(evento.categoryColor || "#C4B5FD") }}>{evento.titulo}</button>
                ))}
              </div>
            );
          })}
        </div>

        <div className="grid" style={{ gridTemplateColumns: `58px repeat(${dias.length}, minmax(0, 1fr))` }}>
          <div className="relative border-r border-line bg-surface/35" style={{ height: altura }}>
            {horas.map((minuto) => (
              <span key={minuto} className="absolute right-2 -translate-y-1/2 text-[9.5px] tabular-nums text-faint" style={{ top: (minuto - inicioMinuto) * alturaPorMinuto }}>{String(Math.floor(minuto / 60)).padStart(2, "0")}:00</span>
            ))}
          </div>
          {dias.map((dia) => {
            const segmentos = segmentosDoDia(eventos, dia).filter((segmento) => segmento.fimMinutos > inicioMinuto && segmento.inicioMinutos < fimMinuto);
            const selecionando = selecao && chaveDia(selecao.dia) === chaveDia(dia);
            return (
              <div
                key={chaveDia(dia)}
                className="relative touch-none border-r border-line last:border-r-0"
                style={{ height: altura, backgroundImage: "linear-gradient(to bottom, var(--el-line) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--el-line) 55%, transparent) 1px, transparent 1px)", backgroundSize: `100% ${ALTURA_HORA}px, 100% ${ALTURA_HORA / 2}px` }}
                onPointerDown={(e) => iniciarSelecao(e, dia)}
                onPointerMove={moverSelecao}
                onPointerUp={concluirSelecao}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  try {
                    const bruto = e.dataTransfer.getData("application/x-emyleads-agenda") || e.dataTransfer.getData("text/plain");
                    const payload = JSON.parse(bruto);
                    aoMover(payload, dia, minutosNoPonteiro(e, e.currentTarget));
                  } catch { /* arraste externo não pertence à agenda */ }
                }}
              >
                {selecionando && (
                  <div className="pointer-events-none absolute inset-x-1 z-[3] rounded-[7px] border border-accent bg-accent-soft/80" style={{ top: (Math.min(selecao.inicio, selecao.fim) - inicioMinuto) * alturaPorMinuto, height: Math.max(PASSO_MINUTOS, Math.abs(selecao.fim - selecao.inicio)) * alturaPorMinuto }}>
                    <span className="px-2 text-[10px] font-semibold text-accent-forte">{formatarDuracao(Math.max(PASSO_MINUTOS, Math.abs(selecao.fim - selecao.inicio)))}</span>
                  </div>
                )}
                {temHoje && chaveDia(dia) === chaveDia(agora) && minutosAgora >= inicioMinuto && minutosAgora <= fimMinuto && (
                  <div className="pointer-events-none absolute inset-x-0 z-[5] border-t border-accent" style={{ top: (minutosAgora - inicioMinuto) * alturaPorMinuto }}><span className="absolute -left-1 -top-1.5 h-3 w-3 rounded-full bg-accent" /></div>
                )}
                {segmentos.map((segmento) => (
                  <BlocoEvento
                    key={`${segmento.evento.sourceType}-${segmento.evento.id}-${segmento.inicioMinutos}`}
                    segmento={segmento}
                    inicioMinuto={inicioMinuto}
                    alturaPorMinuto={alturaPorMinuto}
                    podeMover={podeMover}
                    aoAbrir={aoAbrir}
                    aoIniciarResize={iniciarResize}
                    aoDragStart={(e, evento) => {
                      e.dataTransfer.effectAllowed = "move";
                      const payload = JSON.stringify({
                        id: evento.id,
                        sourceType: evento.sourceType,
                        inicio: evento.inicio,
                        fim: evento.fim,
                      });
                      e.dataTransfer.setData("application/x-emyleads-agenda", payload);
                      e.dataTransfer.setData("text/plain", payload);
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
