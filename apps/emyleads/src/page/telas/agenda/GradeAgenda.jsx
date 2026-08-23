import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BriefcaseBusiness, Clock3, GripHorizontal, LockKeyhole } from "lucide-react";
import {
  adicionarDias,
  arredondarMinutos,
  chaveDia,
  corDaPessoa,
  corDoEvento,
  densidadeDoBloco,
  faixasPorPessoa,
  formatarDuracao,
  horaLocal,
  idDoResponsavel,
  iniciaisDoNome,
  inicioDoDia,
  minutosVisiveis,
  passoParaAltura,
  segmentosDoDia,
} from "./agendaUtils";

const CLARA = "#FFFFFF";
const LARGURA_REGUA = 58;

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

function ehFimDeSemana(dia) {
  const semana = dia.getDay();
  return semana === 0 || semana === 6;
}

function IconeTipo({ evento }) {
  if (evento.sourceType === "task") return <Clock3 size={11} />;
  if (evento.visibilidade === "personal") return <LockKeyhole size={10} />;
  return <BriefcaseBusiness size={11} />;
}

/**
 * Selo de identidade do responsável.
 *
 * Só aparece quando a coluna NÃO é a da própria pessoa: numa faixa por
 * profissional o nome já está no cabeçalho, e repetir a inicial em cada bloco
 * só gasta os poucos pixels que o título precisa.
 */
function SeloPessoa({ nome, corTexto }) {
  return (
    <span
      title={nome || "Sem responsável"}
      className="flex h-[15px] min-w-[15px] flex-none items-center justify-center rounded-full px-[3px] text-[8.5px] font-bold leading-none"
      style={{
        // Véu da própria cor do texto: contrasta com qualquer cor de bloco sem
        // precisar de uma segunda paleta só para o selo.
        backgroundColor: `${corTexto === CLARA ? "#FFFFFF" : "#121730"}26`,
        color: corTexto,
      }}
    >
      {iniciaisDoNome(nome)}
    </span>
  );
}

function BlocoEvento({
  segmento,
  inicioMinuto,
  alturaPorMinuto,
  modoCor,
  mostrarResponsavel,
  podeMover,
  aoAbrir,
  aoIniciarResize,
  aoDragStart,
}) {
  const { evento } = segmento;
  const inicio = Math.max(segmento.inicioMinutos, inicioMinuto);
  const fim = Math.max(inicio, segmento.fimMinutos);
  const topo = (inicio - inicioMinuto) * alturaPorMinuto;
  const altura = Math.max(18, (fim - inicio) * alturaPorMinuto - 2);
  const largura = 100 / segmento.colunas;
  const privada = evento.titulo === "Indisponível";
  const tarefa = evento.sourceType === "task";
  const cor = corDoEvento(evento, modoCor);
  const corTexto = contraste(cor);
  const editavel = podeMover(evento);
  const densidade = densidadeDoBloco(altura);

  return (
    <button
      type="button"
      data-agenda-evento="true"
      draggable={editavel}
      onDragStart={(e) => aoDragStart(e, evento)}
      onClick={(e) => { e.stopPropagation(); aoAbrir(evento); }}
      className={`group absolute z-[2] flex flex-col overflow-hidden rounded-[7px] border-l-[3px] px-1.5 py-[3px] text-left shadow-[0_1px_2px_rgba(18,23,48,0.08)] transition-[filter,box-shadow,transform] hover:z-[4] hover:brightness-[0.97] hover:shadow-[0_4px_10px_rgba(18,23,48,0.16)] ${tarefa ? "border-dashed" : ""} ${editavel ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
      style={{
        top: topo,
        height: altura,
        left: `calc(${segmento.coluna * largura}% + 2px)`,
        width: `calc(${largura}% - 4px)`,
        backgroundColor: cor,
        borderColor: privada ? "#94A3B8" : cor,
        color: corTexto,
      }}
      title={`${evento.titulo} · ${horaLocal(evento.inicio)}–${horaLocal(evento.fim)} · ${evento.ownerName || "Sem responsável"}`}
    >
      {densidade === "minima" ? (
        // Sem altura para duas linhas, o título ganha a única que existe: saber
        // O QUE é vale mais do que reler um horário que a posição já diz.
        <span className="flex min-w-0 items-center gap-1 text-[10px] font-semibold leading-none">
          {mostrarResponsavel && <SeloPessoa nome={evento.ownerName} corTexto={corTexto} />}
          <span className="truncate">{evento.titulo}</span>
        </span>
      ) : (
        <>
          <span className="flex min-w-0 items-center gap-1 text-[9.5px] font-semibold leading-[13px] opacity-85">
            <IconeTipo evento={evento} />
            <span className="truncate tabular-nums">{horaLocal(evento.inicio)}–{horaLocal(evento.fim)}</span>
            {mostrarResponsavel && (
              <span className="ml-auto flex-none">
                <SeloPessoa nome={evento.ownerName} corTexto={corTexto} />
              </span>
            )}
          </span>
          <span className="block truncate text-[11.5px] font-semibold leading-[15px]">{evento.titulo}</span>
          {densidade === "completa" && (
            <span className="mt-auto block truncate text-[10px] leading-[13px] opacity-75">
              {evento.local || evento.ownerName}
            </span>
          )}
        </>
      )}
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
  inicioExpediente,
  fimExpediente,
  alturaHora,
  modoCor = "categoria",
  agruparPorPessoa = false,
  membros = [],
  podeMover,
  aoAbrir,
  aoCriar,
  aoMover,
  aoRedimensionar,
  aoAjustarZoom,
}) {
  const alturaPorMinuto = alturaHora / 60;
  const altura = (fimMinuto - inicioMinuto) * alturaPorMinuto;
  const passo = passoParaAltura(alturaHora);
  const [selecao, setSelecao] = useState(null);
  const rolagemRef = useRef(null);
  const jaCentralizou = useRef(false);

  /**
   * Colunas da grade, unificando as duas leituras possíveis do mesmo dia.
   *
   * Por dia é a agenda de sempre. Por pessoa existe porque a visão de equipe
   * empilhava todo mundo na mesma coluna: cada profissional passa a ter a
   * largura inteira da própria faixa, e o vazio dela vira informação -
   * é ali que dá para marcar reunião.
   */
  const colunas = useMemo(() => {
    if (agruparPorPessoa && dias.length === 1) {
      return faixasPorPessoa(eventos, dias[0], membros).map((faixa) => ({
        chave: `pessoa-${faixa.id}`,
        dia: dias[0],
        titulo: faixa.nome,
        pessoaId: faixa.id,
        segmentos: faixa.segmentos,
        hoje: chaveDia(dias[0]) === chaveDia(new Date()),
        fimDeSemana: ehFimDeSemana(dias[0]),
      }));
    }
    return dias.map((dia) => ({
      chave: chaveDia(dia),
      dia,
      titulo: rotuloDia(dia, dias.length > 3),
      pessoaId: null,
      segmentos: segmentosDoDia(eventos, dia),
      hoje: chaveDia(dia) === chaveDia(new Date()),
      fimDeSemana: ehFimDeSemana(dia),
    }));
  }, [agruparPorPessoa, dias, eventos, membros]);

  // Com a régua muito comprimida os rótulos de hora encostam um no outro;
  // pular de duas em duas horas mantém a referência sem virar borrão.
  const intervaloRotulo = alturaHora < 44 ? 120 : 60;
  const horas = useMemo(() => {
    const lista = [];
    const primeiro = Math.ceil(inicioMinuto / intervaloRotulo) * intervaloRotulo;
    // `< 24 * 60` e não `<=`: quando a faixa se estica até a meia-noite por
    // causa de um evento tarde, o último rótulo sairia como "24:00".
    for (let minuto = primeiro; minuto <= fimMinuto && minuto < 24 * 60; minuto += intervaloRotulo) lista.push(minuto);
    return lista;
  }, [fimMinuto, inicioMinuto, intervaloRotulo]);

  /**
   * Sombra sobre o que está fora do expediente.
   *
   * A faixa agora se estica para caber qualquer evento, então o expediente
   * perdeu o papel de limite. Ele volta como leitura visual: o miolo claro é o
   * horário de trabalho, as bordas escuras são o que veio de fora dele.
   */
  const forasDoExpediente = useMemo(() => {
    if (inicioExpediente == null || fimExpediente == null) return [];
    const faixas = [];
    if (inicioExpediente > inicioMinuto) {
      faixas.push({ chave: "antes", topo: 0, altura: (Math.min(inicioExpediente, fimMinuto) - inicioMinuto) * alturaPorMinuto });
    }
    if (fimExpediente < fimMinuto) {
      const de = Math.max(fimExpediente, inicioMinuto);
      faixas.push({ chave: "depois", topo: (de - inicioMinuto) * alturaPorMinuto, altura: (fimMinuto - de) * alturaPorMinuto });
    }
    return faixas.filter((faixa) => faixa.altura > 0);
  }, [alturaPorMinuto, fimExpediente, fimMinuto, inicioExpediente, inicioMinuto]);

  /**
   * Leva a rolagem para o horário que interessa.
   *
   * Sem isto a grade abria em `dayStart` - que sem preferência salva é 05:00 -
   * e a primeira coisa que a pessoa via ao abrir a agenda era a madrugada.
   */
  useLayoutEffect(() => {
    const caixa = rolagemRef.current;
    if (!caixa || jaCentralizou.current) return;
    const agora = new Date();
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
    const temHoje = dias.some((dia) => chaveDia(dia) === chaveDia(agora));
    const alvo = temHoje && minutosAgora > inicioMinuto && minutosAgora < fimMinuto
      ? minutosAgora
      : Math.max(inicioMinuto, 8 * 60);
    // Um terço acima do alvo: mostra o que vem a seguir sem esconder o que
    // acabou de passar.
    caixa.scrollTop = Math.max(0, (alvo - inicioMinuto) * alturaPorMinuto - caixa.clientHeight / 3);
    jaCentralizou.current = true;
  }, [alturaPorMinuto, dias, fimMinuto, inicioMinuto]);

  /**
   * Zoom com Ctrl/⌘ + roda, ancorado no ponteiro.
   *
   * Sem a âncora, aproximar jogaria a pessoa para outro horário e ela perderia
   * o evento que estava justamente tentando enxergar melhor.
   */
  const aoRolar = useCallback((e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    if (!aoAjustarZoom) return;
    e.preventDefault();
    const caixa = rolagemRef.current;
    if (!caixa) return;
    const rect = caixa.getBoundingClientRect();
    const deslocamentoNoPonteiro = e.clientY - rect.top + caixa.scrollTop;
    const minutoAncora = inicioMinuto + deslocamentoNoPonteiro / alturaPorMinuto;
    const proxima = aoAjustarZoom(e.deltaY < 0 ? 1 : -1);
    if (!proxima || proxima === alturaHora) return;
    requestAnimationFrame(() => {
      const atual = rolagemRef.current;
      if (!atual) return;
      atual.scrollTop = Math.max(0, (minutoAncora - inicioMinuto) * (proxima / 60) - (e.clientY - rect.top));
    });
  }, [alturaHora, alturaPorMinuto, aoAjustarZoom, inicioMinuto]);

  useEffect(() => {
    const caixa = rolagemRef.current;
    if (!caixa) return undefined;
    // Nativo e não-passivo: o React registra wheel como passivo e ali o
    // preventDefault não segura o zoom do navegador.
    caixa.addEventListener("wheel", aoRolar, { passive: false });
    return () => caixa.removeEventListener("wheel", aoRolar);
  }, [aoRolar]);

  const minutosNoPonteiro = (e, elemento) => {
    const rect = elemento.getBoundingClientRect();
    return arredondarMinutos(inicioMinuto + ((e.clientY - rect.top) / rect.height) * (fimMinuto - inicioMinuto), passo);
  };

  const iniciarSelecao = (e, coluna) => {
    if (e.button !== 0 || e.target.closest("[data-agenda-evento]")) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const minuto = minutosNoPonteiro(e, e.currentTarget);
    setSelecao({
      dia: coluna.dia,
      pessoaId: coluna.pessoaId,
      inicio: minuto,
      fim: Math.min(minuto + passo, fimMinuto),
      pointerId: e.pointerId,
    });
  };

  const moverSelecao = (e) => {
    if (!selecao || selecao.pointerId !== e.pointerId) return;
    const minuto = minutosNoPonteiro(e, e.currentTarget);
    setSelecao((atual) => ({ ...atual, fim: Math.max(inicioMinuto, Math.min(fimMinuto, minuto + passo)) }));
  };

  const concluirSelecao = (e) => {
    if (!selecao || selecao.pointerId !== e.pointerId) return;
    const inicio = Math.min(selecao.inicio, selecao.fim - passo);
    const fim = Math.max(selecao.inicio + passo, selecao.fim);
    aoCriar(selecao.dia, inicio, fim, { ownerId: selecao.pessoaId });
    setSelecao(null);
  };

  const iniciarResize = (e, evento) => {
    const inicialY = e.clientY;
    const duracaoInicial = minutosVisiveis(evento);
    const bloco = e.currentTarget?.closest("[data-agenda-evento]");
    const deltaEmPassos = (clientY) => Math.round(((clientY - inicialY) / alturaPorMinuto) / passo) * passo;
    const mover = (movimento) => {
      const delta = deltaEmPassos(movimento.clientY);
      const duracao = Math.max(passo, duracaoInicial + delta);
      bloco?.style.setProperty("height", `${duracao * alturaPorMinuto - 2}px`);
    };
    const soltar = (fim) => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      const delta = deltaEmPassos(fim.clientY);
      aoRedimensionar(evento, Math.max(passo, duracaoInicial + delta));
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar, { once: true });
  };

  const agora = new Date();
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
  const larguraMinima = agruparPorPessoa ? Math.max(680, colunas.length * 210) : Math.max(680, dias.length * 150);
  const gradeColunas = `${LARGURA_REGUA}px repeat(${colunas.length}, minmax(0, 1fr))`;

  if (!colunas.length) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-[14px] border border-line bg-bg text-[12px] text-faint">
        Nenhum profissional para exibir com os filtros atuais.
      </div>
    );
  }

  return (
    <div ref={rolagemRef} className="scrollbar-fina min-h-0 flex-1 overflow-auto rounded-[14px] border border-line bg-bg">
      <div style={{ width: dias.length === 1 && !agruparPorPessoa ? "100%" : `${larguraMinima}px`, minWidth: "100%" }}>
        <div className="sticky top-0 z-20 grid border-b border-line bg-bg/95 backdrop-blur" style={{ gridTemplateColumns: gradeColunas }}>
          <div className="border-r border-line" />
          {colunas.map((coluna) => {
            const minutos = coluna.segmentos.reduce((soma, item) => soma + (item.fimMinutos - item.inicioMinutos), 0);
            return (
              <div
                key={coluna.chave}
                className={`flex items-center justify-center gap-2 border-r border-line px-2 py-2 last:border-r-0 ${coluna.hoje && !coluna.pessoaId ? "bg-accent-soft" : ""}`}
              >
                {coluna.pessoaId && (
                  <span
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[9.5px] font-bold text-white"
                    style={{ backgroundColor: corDaPessoa(coluna.pessoaId) }}
                  >
                    {iniciaisDoNome(coluna.titulo)}
                  </span>
                )}
                <span className="min-w-0">
                  <span className={`block truncate text-[11.5px] font-semibold capitalize ${coluna.hoje && !coluna.pessoaId ? "text-accent-forte" : "text-fg"}`}>
                    {coluna.titulo}
                  </span>
                  <span className="block text-[9.5px] leading-3 text-faint">
                    {coluna.segmentos.length
                      ? `${coluna.segmentos.length} ${coluna.segmentos.length === 1 ? "item" : "itens"} · ${formatarDuracao(minutos)}`
                      : "Livre"}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="grid border-b border-line bg-surface/60" style={{ gridTemplateColumns: gradeColunas }}>
          <div className="border-r border-line px-2 py-2 text-right text-[9px] font-semibold uppercase tracking-wide text-faint">Dia</div>
          {colunas.map((coluna) => {
            const inicio = inicioDoDia(coluna.dia);
            const fim = adicionarDias(inicio, 1);
            const inteiros = eventos.filter((evento) => evento.diaInteiro
              && new Date(evento.inicio) < fim
              && new Date(evento.fim) > inicio
              && (!coluna.pessoaId || idDoResponsavel(evento) === coluna.pessoaId));
            return (
              <div key={coluna.chave} className="min-h-9 border-r border-line p-1 last:border-r-0">
                {inteiros.map((evento) => {
                  const cor = corDoEvento(evento, modoCor);
                  return (
                    <button
                      key={`${evento.sourceType}-${evento.id}`}
                      type="button"
                      onClick={() => aoAbrir(evento)}
                      className="mb-1 block w-full cursor-pointer truncate rounded-[6px] px-2 py-1 text-left text-[10.5px] font-semibold"
                      style={{ backgroundColor: cor, color: contraste(cor) }}
                    >
                      {evento.titulo}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="grid" style={{ gridTemplateColumns: gradeColunas }}>
          <div className="relative border-r border-line bg-surface/35" style={{ height: altura }}>
            {horas.map((minuto) => (
              <span
                key={minuto}
                className="absolute right-2 -translate-y-1/2 text-[9.5px] tabular-nums text-faint"
                style={{ top: (minuto - inicioMinuto) * alturaPorMinuto }}
              >
                {String(Math.floor(minuto / 60)).padStart(2, "0")}:{String(minuto % 60).padStart(2, "0")}
              </span>
            ))}
          </div>
          {colunas.map((coluna) => {
            const visiveis = coluna.segmentos.filter((segmento) => segmento.fimMinutos > inicioMinuto && segmento.inicioMinutos < fimMinuto);
            const selecionando = selecao
              && chaveDia(selecao.dia) === chaveDia(coluna.dia)
              && selecao.pessoaId === coluna.pessoaId;
            return (
              <div
                key={coluna.chave}
                className={`relative touch-none border-r border-line last:border-r-0 ${coluna.fimDeSemana && !coluna.pessoaId ? "bg-surface/40" : ""}`}
                style={{
                  height: altura,
                  backgroundImage: "linear-gradient(to bottom, var(--el-line) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--el-line) 55%, transparent) 1px, transparent 1px)",
                  backgroundSize: `100% ${alturaHora}px, 100% ${alturaHora / 2}px`,
                }}
                onPointerDown={(e) => iniciarSelecao(e, coluna)}
                onPointerMove={moverSelecao}
                onPointerUp={concluirSelecao}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  try {
                    const bruto = e.dataTransfer.getData("application/x-emyleads-agenda") || e.dataTransfer.getData("text/plain");
                    const payload = JSON.parse(bruto);
                    // Numa faixa por pessoa, soltar na coluna de outro
                    // profissional pareceria transferir o evento. Trocar
                    // responsável tem consequência de permissão e não pode
                    // acontecer como efeito colateral de um arraste.
                    if (coluna.pessoaId && payload.ownerId && payload.ownerId !== coluna.pessoaId) return;
                    aoMover(payload, coluna.dia, minutosNoPonteiro(e, e.currentTarget));
                  } catch { /* arraste externo não pertence à agenda */ }
                }}
              >
                {forasDoExpediente.map((faixa) => (
                  <div
                    key={faixa.chave}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 z-[1] bg-surface/55"
                    style={{ top: faixa.topo, height: faixa.altura }}
                  />
                ))}
                {selecionando && (
                  <div
                    className="pointer-events-none absolute inset-x-1 z-[3] rounded-[7px] border border-accent bg-accent-soft/80"
                    style={{
                      top: (Math.min(selecao.inicio, selecao.fim) - inicioMinuto) * alturaPorMinuto,
                      height: Math.max(passo, Math.abs(selecao.fim - selecao.inicio)) * alturaPorMinuto,
                    }}
                  >
                    <span className="px-2 text-[10px] font-semibold text-accent-forte">
                      {formatarDuracao(Math.max(passo, Math.abs(selecao.fim - selecao.inicio)))}
                    </span>
                  </div>
                )}
                {coluna.hoje && minutosAgora >= inicioMinuto && minutosAgora <= fimMinuto && (
                  <div className="pointer-events-none absolute inset-x-0 z-[5] border-t border-accent" style={{ top: (minutosAgora - inicioMinuto) * alturaPorMinuto }}>
                    <span className="absolute -left-1 -top-1.5 h-3 w-3 rounded-full bg-accent" />
                  </div>
                )}
                {visiveis.map((segmento) => (
                  <BlocoEvento
                    key={`${segmento.evento.sourceType}-${segmento.evento.id}-${segmento.inicioMinutos}`}
                    segmento={segmento}
                    inicioMinuto={inicioMinuto}
                    alturaPorMinuto={alturaPorMinuto}
                    modoCor={modoCor}
                    mostrarResponsavel={!coluna.pessoaId && modoCor === "pessoa"}
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
                        ownerId: idDoResponsavel(evento),
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
