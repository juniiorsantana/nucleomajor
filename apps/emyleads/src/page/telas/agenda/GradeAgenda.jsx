import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  fundoDoEvento,
  horaLocal,
  idDoResponsavel,
  iniciaisDoNome,
  inicioDoDia,
  minutosVisiveis,
  passoParaAltura,
  segmentosDoDia,
  tipoDoEvento,
} from "./agendaUtils";

const LARGURA_REGUA = 62;

/**
 * Sobreposição em cascata.
 *
 * `DESLOCAMENTO` é quanto cada bloco do mesmo horário recorre para a direita:
 * 26px deixam ver o trilho colorido e um naco do fundo de quem está atrás -
 * o suficiente para contar quantos são e de que tipo. `MAX_CASCATA` é onde a
 * conta para de fechar: no quarto bloco a largura útil cairia abaixo do que
 * cabe um título, então o excedente vira uma faixa contada em vez de mais uma
 * fatia ilegível.
 */
const DESLOCAMENTO = 26;
const MAX_CASCATA = 3;

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

/**
 * Ícone do tipo, quando o tipo precisa de um.
 *
 * Compromisso e bloqueio não recebem: um é o caso comum, que não deve gastar
 * pixel para dizer que é comum; o outro já se anuncia pela hachura. Marcar
 * tudo é o mesmo que não marcar nada.
 */
function IconeTipo({ tipo }) {
  if (tipo.id === "task") return <Clock3 size={11} className="flex-none" />;
  if (tipo.id === "event") return <BriefcaseBusiness size={11} className="flex-none" />;
  if (tipo.id === "unavailable") return <LockKeyhole size={10} className="flex-none" />;
  return null;
}

/**
 * Selo de identidade do responsável.
 *
 * Só aparece quando a coluna NÃO é a da própria pessoa: numa faixa por
 * profissional o nome já está no cabeçalho, e repetir a inicial em cada bloco
 * só gasta os poucos pixels que o título precisa.
 *
 * Neutro de propósito. Pintá-lo com a cor da pessoa reintroduziria o problema
 * que o bloco acabou de resolver - metade da paleta de pessoas não sustenta
 * texto branco - e seria redundante, já que nesse modo o bloco inteiro está
 * pintado com a cor dela.
 */
function SeloPessoa({ nome }) {
  return (
    <span
      title={nome || "Sem responsável"}
      className="flex h-[15px] min-w-[15px] flex-none items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--el-fg)_12%,transparent)] px-[3px] text-[8.5px] font-bold leading-none text-fg"
    >
      {iniciaisDoNome(nome)}
    </span>
  );
}

// Estáticas de propósito: o Tailwind só gera a classe que enxerga escrita por
// inteiro, então `z-[${i}]` interpolado não produziria regra nenhuma.
const Z_CASCATA = ["z-[2]", "z-[3]", "z-[4]", "z-[5]", "z-[6]", "z-[7]"];

/**
 * Junta os segmentos visíveis por aglomerado e separa o que não cabe.
 *
 * Quem sobra não é escondido: vira uma faixa contada, e a faixa leva para a
 * visão de Dia, onde a coluna é larga o bastante para todos caberem na
 * cascata. É por isso que `maximo` varia com a visão em vez de ser fixo -
 * prometer "veja no dia" e mostrar o mesmo corte lá seria mentira.
 */
function agruparParaCascata(segmentos, maximo) {
  const grupos = new Map();
  for (const segmento of segmentos) {
    const chave = segmento.grupo ?? `solo-${segmento.inicioMinutos}-${segmento.evento.id}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(segmento);
  }
  return [...grupos.values()].map((lista) => ({
    chave: `g-${lista[0].evento.sourceType}-${lista[0].evento.id}-${lista[0].inicioMinutos}`,
    mostrados: lista.slice(0, maximo),
    excedente: lista.slice(maximo),
  }));
}

function BlocoEvento({
  segmento,
  inicioMinuto,
  alturaPorMinuto,
  modoCor,
  mostrarResponsavel,
  indiceCascata = 0,
  totalCascata = 1,
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
  const tipo = tipoDoEvento(evento);
  const tarefa = tipo.id === "task";
  const apagado = tipo.id === "block" || tipo.id === "unavailable";
  const provisorio = evento.status === "tentative";
  const cor = corDoEvento(evento, modoCor);
  const editavel = podeMover(evento);
  const densidade = densidadeDoBloco(altura);

  // Diluído no fundo da tela, não preenchido com a cor cheia: é o que deixa o
  // texto ser sempre --el-fg. Provisório recebe metade da força - marcado, mas
  // ainda não confirmado, e a diferença precisa ser visível de longe.
  const fundo = fundoDoEvento(cor, provisorio ? 8 : 16);
  const hachura = "repeating-linear-gradient(45deg, color-mix(in srgb, var(--el-sub) 18%, transparent) 0 5px, transparent 5px 10px)";

  return (
    <button
      type="button"
      data-agenda-evento="true"
      draggable={editavel}
      onDragStart={(e) => aoDragStart(e, evento)}
      onClick={(e) => { e.stopPropagation(); aoAbrir(evento); }}
      className={`group absolute flex flex-col overflow-hidden rounded-[8px] border-l-[3px] px-2 py-1 text-left text-fg shadow-[0_1px_2px_rgba(18,23,48,0.06)] transition-[box-shadow,transform] hover:z-[20] hover:shadow-[0_4px_12px_rgba(18,23,48,0.18)] ${Z_CASCATA[indiceCascata] || "z-[2]"} ${tarefa ? "border-dashed" : ""} ${editavel ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
      style={{
        top: topo,
        height: altura,
        // Cascata: cada bloco do mesmo horário recua para a direita e o de
        // cima aparece inteiro, em vez de todos dividirem a largura até
        // nenhum caber um título.
        left: 2 + indiceCascata * DESLOCAMENTO,
        right: 2 + (totalCascata - 1 - indiceCascata) * DESLOCAMENTO,
        background: apagado ? `${hachura}, ${fundo}` : fundo,
        borderLeftColor: cor,
        ...(provisorio ? { borderTop: `1px dashed ${cor}`, borderRight: `1px dashed ${cor}`, borderBottom: `1px dashed ${cor}` } : null),
        ...(indiceCascata > 0 ? { boxShadow: "-3px 0 8px rgba(18,23,48,.13)" } : null),
      }}
      title={`${evento.titulo} · ${horaLocal(evento.inicio)}–${horaLocal(evento.fim)} · ${tipo.rotulo}${evento.categoryName ? ` · ${evento.categoryName}` : ""} · ${evento.ownerName || "Sem responsável"}`}
    >
      {densidade === "minima" ? (
        // Sem altura para duas linhas, o título ganha a única que existe: saber
        // O QUE é vale mais do que reler um horário que a posição já diz.
        <span className={`flex min-w-0 items-center gap-1 text-[10.5px] font-semibold leading-none ${apagado ? "text-sub" : ""}`}>
          {mostrarResponsavel && <SeloPessoa nome={evento.ownerName} />}
          <span className="truncate">{evento.titulo}</span>
        </span>
      ) : (
        <>
          <span className="flex min-w-0 items-center gap-1 text-[10px] font-semibold leading-[13px] text-sub">
            <IconeTipo tipo={tipo} />
            <span className="truncate tabular-nums">{horaLocal(evento.inicio)}–{horaLocal(evento.fim)}</span>
            {mostrarResponsavel && (
              <span className="ml-auto flex-none">
                <SeloPessoa nome={evento.ownerName} />
              </span>
            )}
          </span>
          <span className={`block truncate text-[11.5px] font-semibold leading-[15px] ${apagado ? "text-sub" : ""}`}>{evento.titulo}</span>
          {/* A categoria perdeu a cor do bloco para o tipo e volta aqui, como
              etiqueta: o ponto guarda a cor que a empresa configurou e o nome
              diz qual é, sem disputar a leitura do título. */}
          {densidade === "completa" && (
            <span className="mt-auto flex min-w-0 items-center gap-1.5 text-[10px] leading-[13px] text-sub">
              {evento.categoryName && (
                <span className="h-[7px] w-[7px] flex-none rounded-full" style={{ backgroundColor: evento.categoryColor || "#8B7CFF" }} />
              )}
              <span className="truncate">
                {[evento.categoryName, evento.local].filter(Boolean).join(" · ") || evento.ownerName}
              </span>
            </span>
          )}
        </>
      )}
      {editavel && !tarefa && (
        <span
          aria-hidden="true"
          onPointerDown={(e) => { e.stopPropagation(); aoIniciarResize(e, evento); }}
          className="absolute inset-x-0 bottom-0 flex h-3 cursor-ns-resize items-center justify-center text-sub opacity-0 transition-opacity group-hover:opacity-80"
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
  modoCor = "tipo",
  agruparPorPessoa = false,
  membros = [],
  podeMover,
  aoAbrir,
  aoCriar,
  aoMover,
  aoRedimensionar,
  aoAjustarZoom,
  aoVerDia = () => {},
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
  // Uma coluna larga aguenta mais gente na cascata. É o que dá sentido ao
  // "+N às 10:00" da semana: ele leva para o Dia, e lá os mesmos eventos
  // aparecem inteiros em vez de repetirem o corte.
  const maxCascata = colunas.length <= 2 ? Z_CASCATA.length : MAX_CASCATA;

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
          {/* A régua acompanha a rolagem horizontal. Sem isto, arrastar a
              semana para ver domingo levava junto a coluna das horas - e a
              grade perdia justamente a referência que a torna legível. */}
          <div className="sticky left-0 z-10 border-r border-line bg-bg" />
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
          <div className="sticky left-0 z-10 border-r border-line bg-surface px-2 py-2 text-right text-[10px] font-medium text-sub">Dia</div>
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
                      className="mb-1 block w-full cursor-pointer truncate rounded-[6px] border-l-[3px] px-2 py-1 text-left text-[10.5px] font-semibold text-fg"
                      style={{ background: fundoDoEvento(cor), borderLeftColor: cor }}
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
          <div className="sticky left-0 z-[9] border-r border-line bg-bg shadow-[4px_0_6px_-4px_rgba(18,23,48,0.12)]" style={{ height: altura }}>
            {/* 11px em `sub` e não 9,5px em `faint`: em branco o faint dá
                2,58:1, e a régua é a única coisa da tela que se lê o dia
                inteiro sem querer. */}
            {horas.map((minuto) => (
              <span
                key={minuto}
                className="absolute right-2.5 -translate-y-1/2 text-[11px] font-medium tabular-nums text-sub"
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
                {agruparParaCascata(visiveis, maxCascata).map(({ chave, mostrados, excedente }) => (
                  <Fragment key={chave}>
                {mostrados.map((segmento, indiceCascata) => (
                  <BlocoEvento
                    key={`${segmento.evento.sourceType}-${segmento.evento.id}-${segmento.inicioMinutos}`}
                    segmento={segmento}
                    inicioMinuto={inicioMinuto}
                    alturaPorMinuto={alturaPorMinuto}
                    modoCor={modoCor}
                    mostrarResponsavel={!coluna.pessoaId && modoCor === "pessoa"}
                    indiceCascata={indiceCascata}
                    totalCascata={mostrados.length}
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
                    {excedente.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); aoVerDia(coluna.dia); }}
                        title={excedente.map((item) => `${horaLocal(item.evento.inicio)} ${item.evento.titulo}`).join("\n")}
                        className="absolute inset-x-0.5 z-[8] flex cursor-pointer items-center justify-center gap-1 rounded-[6px] bg-fg px-2 text-[9.5px] font-bold text-bg hover:brightness-110"
                        style={{
                          top: (Math.max(mostrados[0].inicioMinutos, inicioMinuto) - inicioMinuto) * alturaPorMinuto
                            + Math.max(18, (mostrados[0].fimMinutos - Math.max(mostrados[0].inicioMinutos, inicioMinuto)) * alturaPorMinuto - 2) + 2,
                          height: 16,
                        }}
                      >
                        {excedente.slice(0, 3).map((item) => (
                          <span
                            key={`${item.evento.sourceType}-${item.evento.id}`}
                            className="h-[5px] w-[5px] flex-none rounded-full"
                            style={{ backgroundColor: corDoEvento(item.evento, modoCor) }}
                          />
                        ))}
                        +{excedente.length} às {horaLocal(mostrados[0].evento.inicio)}
                      </button>
                    )}
                  </Fragment>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
