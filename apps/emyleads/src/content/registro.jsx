import { useState } from "react";
import { ArrowRight, CalendarDays, Check, CircleDollarSign, Clock3, CornerDownLeft, FileText } from "lucide-react";
import { api } from "../data/client";
import { fmtRelativo } from "../lib/formato";

/**
 * O painel escreve, não só mostra.
 *
 * Três seções separadas — Tarefas, Notas, Negócios — respondiam "o que está
 * pendente", que é a pergunta da tela de gestão. Aqui, com o WhatsApp aberto e
 * a conversa acontecendo, a pergunta é outra: "o que ficou disso?". Por isso um
 * campo só no topo e uma linha do tempo embaixo, no lugar de três caixas com
 * três botões de "+" e três formulários.
 */

const TIPOS = [
  { id: "nota", rotulo: "Nota", Icone: FileText },
  { id: "tarefa", rotulo: "Tarefa", Icone: CalendarDays },
  { id: "negocio", rotulo: "Negócio", Icone: CircleDollarSign },
];

/**
 * Junta em uma lista só o que aconteceu com o contato.
 *
 * As entradas saem das ENTIDADES, não do log de eventos: assim o título e o
 * estado que aparecem são os de agora, não os de quando o evento foi gravado.
 * Uma tarefa renomeada e concluída aparece com o nome novo e como concluída.
 *
 * A exceção é a mudança de estágio, que não é um objeto - é algo que
 * aconteceu. Essa vem do log, onde `carga.estagio` guarda de onde para onde
 * (ver `atualizarNegocio` no localProvider). Eventos gravados antes disso não
 * têm o par, e viram só "estágio alterado" em vez de sumir.
 */
export function montarLinhaDoTempo(ficha, estagios = []) {
  if (!ficha) return [];
  const nomeDoEstagio = (id) => estagios.find((e) => e.id === id)?.nome || "outro estágio";
  const itens = [];

  for (const nota of ficha.notas || []) {
    itens.push({
      chave: `nota-${nota.id}`,
      tipo: "nota",
      texto: nota.texto,
      meta: nota.autor ? `nota · ${nota.autor}` : "nota",
      quando: nota.criadoEm,
    });
  }

  for (const tarefa of ficha.tarefas || []) {
    const prazo = tarefa.venceEm ? `vence ${fmtRelativo(tarefa.venceEm)}` : "sem prazo";
    itens.push({
      chave: `tarefa-${tarefa.id}`,
      tipo: "tarefa",
      texto: tarefa.titulo,
      meta: tarefa.concluida ? "tarefa concluída" : `tarefa aberta · ${prazo}`,
      concluida: tarefa.concluida,
      // Uma tarefa pertence ao momento em que ela importa, não ao em que foi
      // digitada: ordenar pela criação jogaria o follow-up de amanhã para o
      // fundo do feed junto com o dia em que alguém pensou nele.
      quando: tarefa.concluida ? tarefa.concluidaEm || tarefa.criadoEm : tarefa.venceEm || tarefa.criadoEm,
    });
  }

  for (const negocio of ficha.negocios || []) {
    itens.push({
      chave: `negocio-${negocio.id}`,
      tipo: "negocio",
      texto: negocio.titulo || "Oportunidade sem título",
      meta: `negócio criado · ${nomeDoEstagio(negocio.stageId)}`,
      quando: negocio.criadoEm,
    });
  }

  for (const evento of ficha.eventos || []) {
    if (evento.tipo !== "deal.updated") continue;
    const mudanca = evento.carga?.estagio;
    if (!mudanca && !evento.carga?.campos?.includes("stageId")) continue;
    itens.push({
      chave: `estagio-${evento.id}`,
      tipo: "estagio",
      texto: mudanca
        ? `${nomeDoEstagio(mudanca.de)} → ${nomeDoEstagio(mudanca.para)}`
        : "Estágio alterado",
      meta: "estágio",
      quando: evento.ocorridoEm || evento.criadoEm,
    });
  }

  return itens.sort((a, b) => (b.quando || 0) - (a.quando || 0));
}

const APARENCIA = {
  nota: { Icone: FileText, fundo: "bg-surface", cor: "text-sub" },
  tarefa: { Icone: CalendarDays, fundo: "bg-accent-soft", cor: "text-accent-forte" },
  negocio: { Icone: CircleDollarSign, fundo: "bg-success-soft", cor: "text-success" },
  estagio: { Icone: ArrowRight, fundo: "bg-accent-soft", cor: "text-accent-forte" },
};

function Entrada({ item }) {
  const { Icone, fundo, cor } = APARENCIA[item.tipo] || APARENCIA.nota;
  return (
    <div className="flex gap-2.5 border-t border-line px-3 py-2.5 first:border-t-0">
      <span className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full ${fundo} ${cor}`}>
        {item.concluida ? <Check size={12} strokeWidth={2.4} /> : <Icone size={12} strokeWidth={2} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[12px] leading-4 ${item.concluida ? "text-sub line-through" : "text-fg"}`}>
          {item.texto}
        </span>
        <span className="mt-0.5 block text-[10px] text-faint">{item.meta}</span>
      </span>
      <span className="flex-none text-[10px] text-faint">{fmtRelativo(item.quando)}</span>
    </div>
  );
}

const FILTROS = [
  { id: "tudo", rotulo: "tudo" },
  { id: "tarefa", rotulo: "tarefas" },
  { id: "nota", rotulo: "notas" },
];

export function LinhaDoTempo({ itens }) {
  const [filtro, setFiltro] = useState("tudo");
  const [tudo, setTudo] = useState(false);

  const filtrados = filtro === "tudo" ? itens : itens.filter((i) => i.tipo === filtro);
  const visiveis = tudo ? filtrados : filtrados.slice(0, 5);
  const ocultos = filtrados.length - visiveis.length;

  return (
    <section className="overflow-hidden rounded-el-lg border border-line bg-bg">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="flex-1 text-[9.5px] font-bold uppercase tracking-[0.07em] text-sub">Linha do tempo</span>
        {/* O preço de juntar tudo num feed é perder "o que está pendente" de
            vista. O filtro é a devolução dessa pergunta, sem desfazer o feed. */}
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => { setFiltro(f.id); setTudo(false); }}
            className={`cursor-pointer rounded-el px-1.5 py-0.5 text-[10px] ${
              filtro === f.id ? "bg-surface font-semibold text-fg" : "text-faint hover:text-sub"
            }`}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {visiveis.map((item) => <Entrada key={item.chave} item={item} />)}

      {!filtrados.length && (
        <p className="border-t border-line px-3 py-6 text-center text-[11px] text-faint">
          {filtro === "tudo" ? "Nada registrado ainda." : `Nenhuma ${filtro} por aqui.`}
        </p>
      )}

      {ocultos > 0 && (
        <button
          type="button"
          onClick={() => setTudo(true)}
          className="w-full cursor-pointer border-t border-line py-2 text-center text-[10.5px] text-sub hover:bg-surface-hover"
        >
          ver mais {ocultos}
        </button>
      )}
    </section>
  );
}

/**
 * O campo único.
 *
 * A pilha escolhida decide o que o texto vira. Só isso - sem data, sem valor,
 * sem estágio: se o registro precisar de mais, `aoDetalhar` abre o formulário
 * completo que já existe, com o texto já digitado. O caminho rápido é o comum,
 * e o completo continua a um clique.
 */
export function Registrador({ contactId, estagios, recarregar, aoDetalhar }) {
  const [tipo, setTipo] = useState("nota");
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  const limpo = texto.trim();

  const registrar = async () => {
    if (!limpo || ocupado) return;
    setOcupado(true);
    setErro("");
    try {
      if (tipo === "nota") await api.notas.criar({ contactId, texto: limpo });
      else if (tipo === "tarefa") await api.tarefas.criar({ contactId, titulo: limpo });
      else await api.negocios.criar({ contactId, titulo: limpo, stageId: estagios[0]?.id });
      setTexto("");
      await recarregar();
    } catch (falha) {
      setErro(falha?.message || String(falha));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="rounded-el-lg border border-line-strong bg-bg p-3 shadow-[0_1px_3px_rgba(18,23,48,0.05)]">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          // Enter envia porque a mão já está no teclado, vindo da conversa.
          // Shift+Enter continua quebrando linha, para a nota que precisa.
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); registrar(); }
        }}
        rows={texto ? 3 : 1}
        placeholder="O que ficou dessa conversa?"
        className="scrollbar-fina w-full resize-none border-0 bg-transparent p-0 text-[12.5px] text-fg outline-none placeholder:text-faint"
      />

      <div className="mt-2.5 flex items-center gap-1.5">
        {TIPOS.map(({ id, rotulo, Icone }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTipo(id)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              tipo === id
                ? "border-accent bg-accent-soft text-accent-forte"
                : "border-line text-sub hover:border-line-strong"
            }`}
          >
            <Icone size={12} strokeWidth={2} />
            {rotulo}
          </button>
        ))}

        <button
          type="button"
          disabled={!limpo || ocupado}
          onClick={registrar}
          title="Registrar (Enter)"
          className="ml-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded-el-lg bg-accent text-white transition-opacity disabled:opacity-30"
        >
          {ocupado ? <Clock3 size={14} strokeWidth={2.2} /> : <CornerDownLeft size={14} strokeWidth={2.2} />}
        </button>
      </div>

      {limpo && (
        <button
          type="button"
          onClick={() => aoDetalhar(tipo, limpo)}
          className="mt-2 cursor-pointer text-[10.5px] text-sub hover:text-accent-forte"
        >
          precisa de prazo, valor ou estágio? abrir o formulário
        </button>
      )}

      {erro && <p className="mt-2 text-[10.5px] text-danger">{erro}</p>}
    </section>
  );
}
