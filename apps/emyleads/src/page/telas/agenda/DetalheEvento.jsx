import { Bell, CalendarDays, CheckCircle2, ContactRound, LockKeyhole, MapPin, Pencil, Trash2, UserRound } from "lucide-react";
import { Folha } from "./componentes";
import { eventoPessoalDeOutro, formatarDuracao, horaLocal, minutosVisiveis, tipoDoEvento } from "./agendaUtils";

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

const REAGENDAR = [
  { id: "30m", rotulo: "+30 min", delta: HORA / 2 },
  { id: "1h", rotulo: "+1 hora", delta: HORA },
  { id: "amanha", rotulo: "Amanhã", delta: DIA },
  { id: "semana", rotulo: "+1 semana", delta: 7 * DIA },
];

function textoLembrete(minutos) {
  if (minutos === 0) return "na hora";
  if (minutos < 60) return `${minutos} min antes`;
  if (minutos === 60) return "1 hora antes";
  if (minutos === 1440) return "1 dia antes";
  return `${formatarDuracao(minutos)} antes`;
}

function quando(evento) {
  const inicio = new Date(evento.inicio);
  const dia = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(inicio);
  if (evento.diaInteiro) return { dia, hora: "Dia inteiro" };
  if (evento.sourceType === "task") return { dia, hora: `Prazo às ${horaLocal(evento.inicio)}` };
  return { dia, hora: `${horaLocal(evento.inicio)} – ${horaLocal(evento.fim)} · ${formatarDuracao(minutosVisiveis(evento))}` };
}

function Linha({ icone: Icone, rotulo, children }) {
  return (
    <div className="flex gap-3 py-2.5">
      <Icone size={17} className="mt-0.5 flex-none text-faint" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <dt className="sr-only">{rotulo}</dt>
        <dd className="text-[15px] text-fg md:text-[13px]">{children}</dd>
      </div>
    </div>
  );
}

/**
 * O que é, quando é e o que dá para fazer com ele.
 *
 * Tocar num compromisso abria direto o formulário de edição — ou, sem
 * permissão, uma caixa de leitura sem nenhuma ação. Agora é sempre este
 * resumo primeiro, com as ações que cabem a quem está vendo. É também onde
 * mora o "reagendar rápido": no telefone não existe arraste, e antes mudar um
 * horário exigia achar o campo certo no formulário inteiro.
 */
export default function DetalheEvento({
  evento,
  usuarioId,
  contato,
  podeEditar,
  podeMover,
  podeConcluir,
  aoEditar,
  aoExcluir,
  aoReagendar,
  aoConcluir,
  aoAbrirContato,
  aoFechar,
}) {
  const tarefa = evento.sourceType === "task";
  const tipo = tipoDoEvento(evento);
  const pessoalDeOutro = eventoPessoalDeOutro(evento, usuarioId);
  const { dia, hora } = quando(evento);
  const cor = evento.categoryColor || "#8B7CFF";
  const temAcoes = tarefa ? (podeConcluir || podeEditar) : podeEditar;

  return (
    <Folha
      lado="direita"
      semCabecalho
      rotuloAcessivel={evento.titulo || "Detalhes do compromisso"}
      aoFechar={aoFechar}
      rodape={temAcoes ? (
        <>
          {!tarefa && podeEditar && (
            <button type="button" onClick={aoExcluir} aria-label="Excluir compromisso" className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[10px] px-2.5 text-[14px] font-medium text-danger hover:bg-danger/10 md:min-h-9 md:text-[13px]">
              <Trash2 size={16} /><span className="hidden sm:inline">Excluir</span>
            </button>
          )}
          {tarefa && podeConcluir && (
            <button type="button" onClick={aoConcluir} className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] bg-success px-3 text-[14px] font-semibold text-white hover:brightness-105 md:min-h-9 md:flex-none md:text-[13px]">
              <CheckCircle2 size={16} />Concluir
            </button>
          )}
          {podeEditar && (
            <button type="button" onClick={aoEditar} className={`flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] px-4 text-[14px] font-semibold md:min-h-9 md:text-[13px] ${tarefa ? "flex-1 border border-line text-fg hover:border-line-strong md:flex-none" : "ml-auto flex-1 bg-accent text-white hover:brightness-110 md:flex-none"}`}>
              <Pencil size={15} />{tarefa ? "Abrir tarefa" : "Editar"}
            </button>
          )}
        </>
      ) : null}
    >
      <div className="px-4 pb-4 pt-2 md:px-5 md:pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-1.5 h-3.5 w-3.5 flex-none rounded-[4px]" style={{ backgroundColor: cor }} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-semibold leading-6 text-fg md:text-[17px]">{evento.titulo || "Sem título"}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-surface px-2.5 py-0.5 text-[12px] font-medium text-sub md:text-[11px]">{tipo.rotulo}</span>
              {!tarefa && (
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-[12px] font-medium text-sub md:text-[11px]">
                  {evento.visibilidade === "organization" ? "Da empresa" : "Pessoal"}
                </span>
              )}
              {evento.status === "tentative" && <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-[12px] font-medium text-warning md:text-[11px]">Provisório</span>}
              {evento.categoryName && !tarefa && (
                <span className="flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-[12px] font-medium text-sub md:text-[11px]">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cor }} />{evento.categoryName}
                </span>
              )}
            </div>
          </div>
          <button type="button" onClick={aoFechar} aria-label="Fechar" className="-mr-2 -mt-1 flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-[10px] text-sub hover:bg-surface-hover hover:text-fg md:h-9 md:w-9">
            <span aria-hidden="true" className="text-[22px] leading-none">×</span>
          </button>
        </div>

        <dl className="mt-3 divide-y divide-line">
          <Linha icone={CalendarDays} rotulo="Quando">
            <span className="block first-letter:uppercase">{dia}</span>
            <span className="block text-sub">{hora}</span>
          </Linha>
          <Linha icone={UserRound} rotulo="Responsável">{evento.ownerName || "Não informado"}</Linha>
          {pessoalDeOutro ? (
            <div className="flex gap-3 py-3">
              <LockKeyhole size={17} className="mt-0.5 flex-none text-faint" />
              <p className="text-[14px] leading-5 text-sub md:text-[12.5px]">
                Compromisso pessoal de {evento.ownerName || "outra pessoa"}. Só ela vê os detalhes e mexe no horário.
              </p>
            </div>
          ) : (
            <>
              {contato && (
                <Linha icone={ContactRound} rotulo="Cliente">
                  <button type="button" onClick={() => aoAbrirContato(contato)} className="cursor-pointer font-medium text-accent-forte hover:underline">
                    {contato.nome || "Contato sem nome"}
                  </button>
                  {(contato.empresa || contato.telefone) && <span className="block text-[13px] text-sub md:text-[12px]">{contato.empresa || contato.telefone}</span>}
                </Linha>
              )}
              {evento.local && <Linha icone={MapPin} rotulo="Local">{evento.local}</Linha>}
              {!tarefa && evento.lembretes?.length > 0 && (
                <Linha icone={Bell} rotulo="Lembretes">{evento.lembretes.slice().sort((a, b) => a - b).map(textoLembrete).join(" · ")}</Linha>
              )}
              {evento.descricao && (
                <div className="py-3">
                  <dt className="sr-only">Descrição</dt>
                  <dd className="whitespace-pre-wrap text-[15px] leading-6 text-fg md:text-[13px] md:leading-5">{evento.descricao}</dd>
                </div>
              )}
            </>
          )}
        </dl>

        {podeMover && !evento.diaInteiro && (
          <section className="mt-2 rounded-[12px] border border-line p-3">
            <h3 className="text-[13px] font-semibold text-sub md:text-[12px]">{tarefa ? "Adiar o prazo" : "Mudar o horário"}</h3>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {REAGENDAR.map((opcao) => (
                <button
                  key={opcao.id}
                  type="button"
                  onClick={() => aoReagendar(opcao.delta, opcao.rotulo)}
                  className="min-h-11 cursor-pointer rounded-[9px] border border-line px-1 text-[13px] font-semibold text-fg hover:border-accent hover:bg-accent-soft hover:text-accent-forte md:min-h-9 md:text-[12px]"
                >
                  {opcao.rotulo}
                </button>
              ))}
            </div>
            {podeEditar && (
              <button type="button" onClick={aoEditar} className="mt-2 min-h-9 cursor-pointer text-[13px] font-medium text-accent-forte hover:underline md:text-[12px]">
                Escolher outro dia e hora…
              </button>
            )}
          </section>
        )}
      </div>
    </Folha>
  );
}
