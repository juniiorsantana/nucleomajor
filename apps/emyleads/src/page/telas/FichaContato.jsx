import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  Clipboard,
  ChevronDown,
  Database,
  Mail,
  Pencil,
  Phone,
  Plus,
  UserRound,
  X,
} from "lucide-react";
import { fmtData, fmtMoeda, fmtVencimento } from "../../lib/formato";
import { formatPhone } from "../../lib/phone";
import { camposTecnicosDoContato, resumoValorTecnico, valorTecnico, fotoPersistidaDoContato } from "../../lib/contatoTecnico";
import { Iniciais, PilulaEstagio } from "../ui";
import { StatusNegocio, Valor } from "./gestaoCompartilhados";

function LinhaDado({ icone: Icone, children, vazio = false }) {
  return (
    <div className={`flex min-w-0 items-center gap-2 text-[12px] ${vazio ? "text-faint" : "text-sub"}`}>
      <Icone size={14} strokeWidth={1.8} className="flex-none text-faint" />
      <span className="min-w-0 truncate">{children || "Não informado"}</span>
    </div>
  );
}

function BlocoTitulo({ children, acao }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h3 className="flex-1 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">{children}</h3>
      {acao}
    </div>
  );
}

function AvatarContato({ contato, tamanho = 42 }) {
  const foto = fotoPersistidaDoContato(contato);
  const [visivel, setVisivel] = useState(Boolean(foto));

  useEffect(() => setVisivel(Boolean(foto)), [foto]);

  if (foto && visivel) {
    return (
      <img
        src={foto}
        alt=""
        onError={() => setVisivel(false)}
        className="flex-none rounded-full object-cover"
        style={{ width: tamanho, height: tamanho }}
      />
    );
  }
  return <Iniciais nome={contato.nome} tamanho={tamanho} />;
}

function CampoTecnico({ chave, valor, aoCopiar, copiado }) {
  const texto = valorTecnico(valor);
  const exibicao = resumoValorTecnico(valor);
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-line/70 py-1.5 last:border-b-0">
      <code className="w-24 flex-none text-[10px] text-faint">{chave}</code>
      <code title={texto} className="min-w-0 flex-1 truncate text-[10.5px] text-sub">{exibicao}</code>
      <button type="button" onClick={() => aoCopiar(texto, chave)} className="flex-none cursor-pointer text-[10px] text-faint hover:text-accent-forte">
        {copiado === chave ? "copiado" : "copiar"}
      </button>
    </div>
  );
}

function rotuloEvento(evento) {
  const rotulos = {
    "contact.created": "Contato criado",
    "contact.updated": "Contato atualizado",
    "deal.created": "Negócio criado",
    "deal.updated": "Negócio atualizado",
    "task.created": "Tarefa criada",
    "task.updated": "Tarefa atualizada",
    "task.completed": "Tarefa concluída",
    "task.reopened": "Tarefa reaberta",
    "note.created": "Nota adicionada",
    "note.updated": "Nota atualizada",
  };
  return rotulos[evento.tipo] || evento.tipo || "Atividade registrada";
}

export default function FichaContato({
  contato,
  negocios,
  tarefas,
  notas,
  eventos = [],
  estagios,
  aoFechar,
  aoEditar,
  aoCriarNegocio,
  aoCriarTarefa,
  aoCriarNota,
  aoAbrirNegocio,
  aoAbrirTarefa,
}) {
  const [copiado, setCopiado] = useState(false);
  const [copiadoCampo, setCopiadoCampo] = useState(null);
  const [tecnicosAbertos, setTecnicosAbertos] = useState(true);
  const estagioPorId = useMemo(
    () => Object.fromEntries(estagios.map((e) => [e.id, e])),
    [estagios],
  );
  const negociosDoContato = negocios
    .filter((n) => n.contactId === contato.id)
    .sort((a, b) => (b.atualizadoEm || b.criadoEm) - (a.atualizadoEm || a.criadoEm));
  const tarefasDoContato = tarefas
    .filter((t) => t.contactId === contato.id)
    .sort((a, b) => Number(a.concluida) - Number(b.concluida) || (a.venceEm ?? Infinity) - (b.venceEm ?? Infinity));
  const notasDoContato = (notas || [])
    .filter((n) => n.contactId === contato.id)
    .sort((a, b) => b.criadoEm - a.criadoEm);
  const eventosDoContato = (eventos || [])
    .filter((evento) => evento.contactId === contato.id)
    .sort((a, b) => (b.ocorridoEm || b.criadoEm) - (a.ocorridoEm || a.criadoEm));
  const abertas = negociosDoContato.filter((n) => n.status === "aberto");
  const tarefasAbertas = tarefasDoContato.filter((t) => !t.concluida);
  const valorAberto = abertas.reduce((s, n) => s + (n.valor || 0), 0);

  const copiarTelefone = async () => {
    if (!contato.telefone) return;
    try {
      await navigator.clipboard.writeText(contato.telefone);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1600);
    } catch {
      setCopiado(false);
    }
  };

  const copiarTecnico = async (texto, chave) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiadoCampo(chave);
      window.setTimeout(() => setCopiadoCampo(null), 1400);
    } catch {
      setCopiadoCampo(null);
    }
  };

  const camposTecnicos = camposTecnicosDoContato(contato);

  return (
    <div className="fixed inset-0 z-40 bg-black/25" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[440px] flex-col border-l border-line bg-bg shadow-2xl">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <AvatarContato contato={contato} tamanho={42} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-semibold tracking-tight text-fg">{contato.nome || "Sem nome"}</h2>
            <p className="mt-0.5 truncate text-[12px] text-sub">{contato.empresa || "Contato sem empresa"}</p>
          </div>
          <button type="button" title="Fechar ficha" onClick={aoFechar} className="cursor-pointer rounded-[8px] p-1.5 text-sub hover:bg-surface-hover hover:text-fg">
            <X size={18} />
          </button>
        </header>

        <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto">
          <section className="border-b border-line px-5 py-4">
            <div className="flex items-center gap-2">
              <button type="button" onClick={aoEditar} className="flex flex-1 items-center justify-center gap-2 rounded-[8px] bg-accent px-3 py-2 text-[12px] font-semibold text-white hover:brightness-110">
                <Pencil size={14} />
                Editar contato
              </button>
              <button type="button" onClick={copiarTelefone} disabled={!contato.telefone} className="flex items-center gap-2 rounded-[8px] border border-line px-3 py-2 text-[12px] font-semibold text-sub hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40">
                <Clipboard size={14} />
                {copiado ? "Copiado" : "Copiar telefone"}
              </button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-[8px] bg-surface px-2.5 py-2">
                <span className="block text-[10px] text-faint">Negócios abertos</span>
                <strong className="mt-1 block text-[16px] font-semibold text-fg">{abertas.length}</strong>
              </div>
              <div className="rounded-[8px] bg-surface px-2.5 py-2">
                <span className="block text-[10px] text-faint">Valor em aberto</span>
                <strong className="mt-1 block truncate text-[14px] font-semibold text-fg">{fmtMoeda(valorAberto) || "R$ 0"}</strong>
              </div>
              <div className="rounded-[8px] bg-surface px-2.5 py-2">
                <span className="block text-[10px] text-faint">Tarefas abertas</span>
                <strong className="mt-1 block text-[16px] font-semibold text-fg">{tarefasAbertas.length}</strong>
              </div>
            </div>
          </section>

          <section className="border-b border-line px-5 py-3">
            <button type="button" onClick={() => setTecnicosAbertos(!tecnicosAbertos)} className="flex w-full items-center gap-2 text-left">
              <Database size={14} className="text-faint" />
              <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Dados técnicos · {camposTecnicos.length}</span>
              <ChevronDown size={14} className={`text-faint transition-transform ${tecnicosAbertos ? "rotate-180" : ""}`} />
            </button>
            {tecnicosAbertos && (
              <div className="mt-2 rounded-[8px] bg-surface px-2">
                {camposTecnicos.map(([chave, valor]) => (
                  <CampoTecnico key={chave} chave={chave} valor={valor} aoCopiar={copiarTecnico} copiado={copiadoCampo} />
                ))}
              </div>
            )}
          </section>

          <section className="border-b border-line px-5 py-4">
            <BlocoTitulo>Dados do contato</BlocoTitulo>
            <div className="grid gap-2.5">
              <LinhaDado icone={Phone}>{contato.telefone ? formatPhone(contato.telefone) : null}</LinhaDado>
              <LinhaDado icone={Mail}>{contato.email}</LinhaDado>
              <LinhaDado icone={UserRound}>{contato.cargo || contato.responsavel ? [contato.cargo, contato.responsavel && `Responsável: ${contato.responsavel}`].filter(Boolean).join(" · ") : null}</LinhaDado>
              <LinhaDado icone={CalendarDays}>Última interação: {fmtData(contato.ultimaEm ?? contato.atualizadoEm)}</LinhaDado>
            </div>
          </section>

          <section className="border-b border-line px-5 py-4">
            <BlocoTitulo acao={<button type="button" onClick={aoCriarNegocio} className="flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[11px] font-semibold text-accent-forte hover:bg-accent-soft"><Plus size={13} /> Novo</button>}>Negócios · {negociosDoContato.length}</BlocoTitulo>
            {negociosDoContato.length ? (
              <div className="grid gap-2">
                {negociosDoContato.map((negocio) => {
                  const estagio = estagioPorId[negocio.stageId];
                  return (
                    <button key={negocio.id} type="button" onClick={() => aoAbrirNegocio?.(negocio)} className="flex items-center gap-2 rounded-[8px] border border-line px-3 py-2 text-left hover:border-line-strong hover:bg-surface-hover">
                      <CircleDollarSign size={15} className="flex-none text-accent-forte" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-fg">{negocio.titulo || "Sem título"}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-sub"><Valor valor={negocio.valor} /> · {estagio?.nome || "Sem estágio"}</span>
                      </span>
                      <StatusNegocio status={negocio.status} />
                    </button>
                  );
                })}
              </div>
            ) : <p className="text-[12px] text-faint">Nenhum negócio vinculado.</p>}
          </section>

          <section className="px-5 py-4">
            <BlocoTitulo acao={<button type="button" onClick={aoCriarTarefa} className="flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[11px] font-semibold text-accent-forte hover:bg-accent-soft"><Plus size={13} /> Nova</button>}>Tarefas · {tarefasDoContato.length}</BlocoTitulo>
            {tarefasDoContato.length ? (
              <div className="grid gap-1">
                {tarefasDoContato.map((tarefa) => {
                  const vencimento = tarefa.venceEm ? fmtVencimento(tarefa.venceEm) : null;
                  return (
                    <button key={tarefa.id} type="button" onClick={() => aoAbrirTarefa?.(tarefa)} className="flex items-center gap-2 rounded-[8px] px-2 py-2 text-left hover:bg-surface-hover">
                      <CheckSquare size={15} className={`flex-none ${tarefa.concluida ? "text-success" : "text-sub"}`} />
                      <span className={`min-w-0 flex-1 truncate text-[12px] ${tarefa.concluida ? "text-faint line-through" : "text-fg"}`}>{tarefa.titulo || "Sem título"}</span>
                      {vencimento && <span className={`flex-none text-[10.5px] ${tarefa.concluida ? "text-faint" : vencimento.tom === "danger" ? "text-danger" : "text-sub"}`}>{tarefa.concluida ? "Concluída" : vencimento.texto}</span>}
                    </button>
                  );
                })}
              </div>
            ) : <p className="text-[12px] text-faint">Nenhuma tarefa vinculada.</p>}
          </section>

          <section className="border-t border-line px-5 py-4">
            <BlocoTitulo acao={<button type="button" onClick={aoCriarNota} className="flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[11px] font-semibold text-accent-forte hover:bg-accent-soft"><Plus size={13} /> Nova</button>}>Notas · {notasDoContato.length}</BlocoTitulo>
            {notasDoContato.length ? (
              <div className="grid gap-2">
                {notasDoContato.slice(0, 3).map((nota) => (
                  <div key={nota.id} className="rounded-[8px] bg-surface px-3 py-2">
                    <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-fg">{nota.texto}</p>
                    <p className="mt-1 text-[10px] text-faint">{nota.autor ? `${nota.autor} · ` : ""}{fmtData(nota.criadoEm)}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-[12px] text-faint">Nenhuma nota registrada.</p>}
          </section>

          <section className="border-t border-line px-5 py-4">
            <BlocoTitulo>Histórico · {eventosDoContato.length}</BlocoTitulo>
            {eventosDoContato.length ? (
              <div className="relative ml-1 grid gap-3 border-l border-line pl-4">
                {eventosDoContato.slice(0, 12).map((evento) => (
                  <div key={evento.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" />
                    <p className="text-[12px] font-medium text-fg">{rotuloEvento(evento)}</p>
                    <p className="mt-0.5 text-[10px] text-faint">{fmtData(evento.ocorridoEm || evento.criadoEm)}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-[12px] text-faint">Nenhuma atividade registrada.</p>}
          </section>
        </div>
      </aside>
    </div>
  );
}
