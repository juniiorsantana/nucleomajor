import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  CalendarDays,
  CircleDollarSign,
  Filter,
  GripVertical,
  Inbox,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ThumbsDown,
  Trophy,
  TrendingUp,
  X,
} from "lucide-react";
import { api } from "../../data/client";
import { fmtData, fmtMoeda } from "../../lib/formato";
import {
  BotaoPrimario,
  CabecalhoTela,
  CampoBusca,
  Iniciais,
  Seletor,
} from "../ui";
import {
  CampoFormulario,
  ENTRADA_GESTAO,
  EstadoVazio,
  ModalGestao,
  nomeDoContato,
  parseValor,
  Valor,
  valorInput,
} from "./gestaoCompartilhados";

/*
 * As colunas de fim de funil só mostram o que fechou nos últimos 30 dias.
 * Sem esse corte, Fechado e Perdido crescem para sempre e empurram o quadro
 * para baixo. O resto fica a um clique ("ver todos").
 */
const JANELA_FECHADOS = 30 * 24 * 60 * 60 * 1000;

const COLUNA_GANHO = "status:ganho";
const COLUNA_PERDIDO = "status:perdido";
const colunaDoEstagio = (id) => `estagio:${id}`;

/*
 * Toda organização nasce com a etapa "Fechado" (o seed do banco cria). Ela
 * não vira uma coluna comum: é a mesma coisa que a coluna Fechado do fim do
 * quadro. Antes a etapa e o botão de ganho eram duas verdades que podiam
 * discordar — um negócio "ganho" parado em Proposta, ou um "aberto" em
 * Fechado. Agora estar na etapa Fechado OU com status ganho dá no mesmo lugar,
 * e mover para lá grava as duas coisas juntas.
 */
const normalizar = (texto) =>
  String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

function acharEstagioFechado(estagios) {
  return estagios.find((e) => e.id === "fechado" || normalizar(e.nome) === "fechado") || null;
}

function colunaDoNegocio(negocio, idFechado) {
  if (negocio.status === "perdido") return COLUNA_PERDIDO;
  if (negocio.status === "ganho" || (idFechado && negocio.stageId === idFechado)) return COLUNA_GANHO;
  return colunaDoEstagio(negocio.stageId);
}

function patchParaColuna(coluna, idFechado) {
  if (coluna === COLUNA_GANHO) return { status: "ganho", motivoPerda: "", ...(idFechado ? { stageId: idFechado } : {}) };
  if (coluna === COLUNA_PERDIDO) return { status: "perdido" };
  const stageId = coluna.slice("estagio:".length);
  return { stageId, status: "aberto", motivoPerda: "" };
}

function ResumoFunilCompacto({ abertos, ganhos, total }) {
  const valorAberto = abertos.reduce((s, n) => s + (n.valor || 0), 0);
  const valorGanho = ganhos.reduce((s, n) => s + (n.valor || 0), 0);
  const conversao = total ? Math.round((ganhos.length / total) * 100) : 0;
  const itens = [
    { rotulo: "Em andamento", valor: abertos.length.toLocaleString("pt-BR"), detalhe: `${abertos.length === 1 ? "negócio" : "negócios"}`, Icone: Briefcase, tom: "accent" },
    { rotulo: "Valor do pipeline", valor: fmtMoeda(valorAberto) || "R$ 0", detalhe: "negócios abertos", Icone: CircleDollarSign, tom: "neutral" },
    { rotulo: "Fechados", valor: ganhos.length.toLocaleString("pt-BR"), detalhe: `${fmtMoeda(valorGanho) || "R$ 0"} convertido`, Icone: TrendingUp, tom: "success" },
    { rotulo: "Conversão", valor: `${conversao}%`, detalhe: `de ${total} negócios`, Icone: Filter, tom: "accent" },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {itens.map(({ rotulo, valor, detalhe, Icone, tom }) => (
        <div key={rotulo} className="flex min-w-0 items-center justify-between rounded-[10px] border border-line bg-bg px-3.5 py-2.5 shadow-[0_1px_2px_rgba(18,23,48,0.03)]">
          <div className="min-w-0">
            <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-faint">{rotulo}</span>
            <div className="mt-1 flex min-w-0 items-baseline gap-2">
              <strong className="truncate text-[18px] font-semibold leading-none tracking-tight text-fg">{valor}</strong>
              <span className="truncate text-[10px] text-faint">{detalhe}</span>
            </div>
          </div>
          <span className={`ml-2 flex h-7 w-7 flex-none items-center justify-center rounded-[7px] ${tom === "success" ? "bg-success-soft text-success" : tom === "neutral" ? "bg-surface text-sub" : "bg-accent-soft text-accent-forte"}`}>
            <Icone size={14} strokeWidth={1.9} />
          </span>
        </div>
      ))}
    </div>
  );
}

/*
 * Escolha do lead por digitação. O <select> antigo listava todos os contatos
 * em ordem alfabética, e com algumas centenas de leads achar um virava rolar
 * a lista inteira.
 */
function SeletorDeLead({ contatos, valor, aoMudar }) {
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState(!valor);
  const escolhido = contatos.find((c) => c.id === valor);

  const opcoes = useMemo(() => {
    const t = termo.trim().toLowerCase();
    return contatos
      .filter((c) => !t || `${c.nome || ""} ${c.empresa || ""} ${c.telefone || ""}`.toLowerCase().includes(t))
      .sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"))
      .slice(0, 8);
  }, [contatos, termo]);

  if (escolhido && !aberto) {
    return (
      <div className="flex items-center gap-2 rounded-[8px] border border-line bg-bg px-2.5 py-1.5">
        <Iniciais nome={escolhido.nome} tamanho={24} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-fg">{escolhido.nome || "Sem nome"}</div>
          {(escolhido.empresa || escolhido.telefone) && (
            <div className="truncate text-[11px] text-faint">{escolhido.empresa || escolhido.telefone}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="cursor-pointer rounded-[6px] px-2 py-1 text-[12px] font-medium text-accent-forte hover:bg-accent-soft"
        >
          Trocar
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[8px] border border-line bg-bg focus-within:border-accent">
      <div className="flex items-center gap-2 px-3">
        <Search size={14} className="flex-none text-faint" />
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          autoFocus={!!valor}
          placeholder="Digite o nome, empresa ou telefone do lead"
          className="w-full bg-transparent py-2 text-[13px] text-fg outline-none"
        />
      </div>
      {/* A lista só abre depois da primeira letra: aberta de cara, ela
          despejava todos os leads no formulário antes de qualquer busca. */}
      {contatos.length === 0 && (
        <p className="border-t border-line px-3 py-3 text-center text-[12px] text-faint">
          Nenhum lead salvo ainda. Crie um lead pela conversa.
        </p>
      )}
      {contatos.length > 0 && termo.trim() && (
      <ul className="max-h-[208px] overflow-y-auto border-t border-line py-1">
        {opcoes.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => {
                aoMudar(c.id);
                setAberto(false);
                setTermo("");
              }}
              className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-hover ${c.id === valor ? "bg-accent-soft" : ""}`}
            >
              <Iniciais nome={c.nome} tamanho={22} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{c.nome || "Sem nome"}</span>
              {c.empresa && <span className="truncate text-[11px] text-faint">{c.empresa}</span>}
            </button>
          </li>
        ))}
        {opcoes.length === 0 && (
          <li className="px-3 py-3 text-center text-[12px] text-faint">Nenhum lead com esse nome.</li>
        )}
      </ul>
      )}
    </div>
  );
}

function FormularioNegocio({ negocio, contatos, estagios, idFechado, origens, aoFechar, recarregar }) {
  const vazio = {
    contactId: negocio?.contactId || "",
    titulo: "",
    valor: "",
    stageId: estagios[0]?.id || "",
    origem: "",
    status: "aberto",
    motivoPerda: "",
  };
  const [form, setForm] = useState(() => ({
    ...vazio,
    ...(negocio?.id
      ? {
          contactId: negocio.contactId,
          titulo: negocio.titulo,
          valor: valorInput(negocio.valor),
          // A etapa Fechado não aparece na lista de etapas; um negócio parado
          // nela é mostrado como Fechado no campo Resultado.
          stageId: negocio.stageId === idFechado ? estagios[0]?.id || "" : negocio.stageId,
          origem: negocio.origem,
          status: negocio.stageId === idFechado && negocio.status === "aberto" ? "ganho" : negocio.status,
          motivoPerda: negocio.motivoPerda || "",
        }
      : {}),
  }));
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const alterar = (campo, valor) => setForm((atual) => ({ ...atual, [campo]: valor }));

  const enviar = async (event) => {
    event.preventDefault();
    if (!form.contactId) {
      setErro("Escolha o lead deste negócio.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const dados = {
        contactId: form.contactId,
        titulo: form.titulo.trim(),
        valor: parseValor(form.valor),
        stageId: form.status === "ganho" && idFechado ? idFechado : form.stageId,
        origem: form.origem.trim(),
        status: form.status,
        motivoPerda: form.status === "perdido" ? form.motivoPerda.trim() : "",
      };
      if (negocio?.id) {
        await api.negocios.atualizar({ id: negocio.id, patch: dados });
      } else {
        await api.negocios.criar(dados);
      }
      await recarregar();
      aoFechar();
    } catch (e) {
      setErro(e?.message || String(e));
    } finally {
      setSalvando(false);
    }
  };

  const remover = async () => {
    if (!negocio?.id || !confirm("Excluir este negócio?")) return;
    setSalvando(true);
    try {
      await api.negocios.remover({ id: negocio.id });
      await recarregar();
      aoFechar();
    } catch (e) {
      setErro(e?.message || String(e));
      setSalvando(false);
    }
  };

  return (
    <ModalGestao
      titulo={negocio?.id ? "Editar negócio" : "Novo negócio"}
      aoFechar={aoFechar}
    >
      <form onSubmit={enviar}>
        <div className="grid grid-cols-2 gap-3 px-5 py-4">
          <CampoFormulario rotulo="Lead" className="col-span-2">
            <SeletorDeLead contatos={contatos} valor={form.contactId} aoMudar={(id) => alterar("contactId", id)} />
          </CampoFormulario>
          <CampoFormulario rotulo="Título" className="col-span-2">
            <input
              required
              value={form.titulo}
              onChange={(e) => alterar("titulo", e.target.value)}
              className={ENTRADA_GESTAO}
              placeholder="Ex.: Site institucional"
            />
          </CampoFormulario>
          <CampoFormulario rotulo="Valor">
            <input
              inputMode="decimal"
              value={form.valor}
              onChange={(e) => alterar("valor", e.target.value)}
              className={ENTRADA_GESTAO}
              placeholder="R$ 0,00"
            />
          </CampoFormulario>
          <CampoFormulario rotulo="Etapa">
            <select
              required
              value={form.stageId}
              onChange={(e) => alterar("stageId", e.target.value)}
              className={`${ENTRADA_GESTAO} cursor-pointer`}
            >
              {estagios.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </CampoFormulario>
          <CampoFormulario rotulo="Origem" className={negocio?.id ? "" : "col-span-2"}>
            <input
              list="origens-negocio"
              value={form.origem}
              onChange={(e) => alterar("origem", e.target.value)}
              className={ENTRADA_GESTAO}
              placeholder="Instagram, indicação..."
            />
            <datalist id="origens-negocio">
              {origens.map((origem) => <option key={origem} value={origem} />)}
            </datalist>
          </CampoFormulario>
          {/* Negócio novo sempre nasce aberto; o resultado se decide no quadro. */}
          {negocio?.id && (
            <CampoFormulario rotulo="Resultado">
              <select
                value={form.status}
                onChange={(e) => alterar("status", e.target.value)}
                className={`${ENTRADA_GESTAO} cursor-pointer`}
              >
                <option value="aberto">Em andamento</option>
                <option value="ganho">Fechado</option>
                <option value="perdido">Perdido</option>
              </select>
            </CampoFormulario>
          )}
          {form.status === "perdido" && (
            <CampoFormulario rotulo="Motivo da perda" className="col-span-2">
              <input
                value={form.motivoPerda}
                onChange={(e) => alterar("motivoPerda", e.target.value)}
                className={ENTRADA_GESTAO}
                placeholder="Ex.: prazo, preço, sem retorno..."
              />
            </CampoFormulario>
          )}
          {erro && <p className="col-span-2 text-[13px] text-danger">{erro}</p>}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          {negocio?.id && (
            <button
              type="button"
              onClick={remover}
              disabled={salvando}
              className="cursor-pointer text-[13px] font-medium text-danger hover:underline disabled:opacity-40"
            >
              Excluir
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={aoFechar}
              className="cursor-pointer rounded-[8px] px-3 py-2 text-[13px] font-medium text-sub hover:text-fg"
            >
              Cancelar
            </button>
            <BotaoPrimario type="submit" disabled={salvando} className="!py-2">
              {salvando ? "Salvando…" : "Salvar"}
            </BotaoPrimario>
          </div>
        </div>
      </form>
    </ModalGestao>
  );
}

/* Soltar em Perdido pergunta o motivo — é o dado que ensina o que corrigir. */
function ModalPerda({ negocio, aoConfirmar, aoFechar }) {
  const [motivo, setMotivo] = useState(negocio.motivoPerda || "");
  return (
    <ModalGestao titulo="Marcar como perdido" aoFechar={aoFechar}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          aoConfirmar(motivo.trim());
        }}
      >
        <div className="px-5 py-4">
          <p className="mb-3 text-[13px] text-sub">
            <strong className="font-semibold text-fg">{negocio.titulo || "Negócio"}</strong> vai para a coluna Perdido.
          </p>
          <CampoFormulario rotulo="Por que foi perdido?">
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className={ENTRADA_GESTAO}
              placeholder="Ex.: preço, prazo, sem retorno..."
            />
          </CampoFormulario>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={aoFechar} className="cursor-pointer rounded-[8px] px-3 py-2 text-[13px] font-medium text-sub hover:text-fg">
            Cancelar
          </button>
          <BotaoPrimario type="submit" className="!py-2">Marcar perdido</BotaoPrimario>
        </div>
      </form>
    </ModalGestao>
  );
}

/*
 * "Mover para" pelo menu ⋯ do card. Existe para o celular, onde arrastar
 * dentro de um quadro que também rola para o lado não funciona bem, e para
 * quem prefere teclado.
 */
function ModalMover({ negocio, colunas, idFechado, aoMover, aoEditar, aoFechar }) {
  const atual = colunaDoNegocio(negocio, idFechado);
  return (
    <ModalGestao titulo={negocio.titulo || "Mover negócio"} aoFechar={aoFechar}>
      <div className="px-3 py-3">
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Mover para</p>
        <ul className="flex flex-col gap-0.5">
          {colunas.map((coluna) => {
            const aqui = coluna.id === atual;
            return (
              <li key={coluna.id}>
                <button
                  type="button"
                  disabled={aqui}
                  onClick={() => aoMover(coluna.id)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[13px] text-fg hover:bg-surface-hover disabled:cursor-default disabled:bg-accent-soft disabled:text-accent-forte"
                >
                  <coluna.Icone size={14} className={coluna.cor} />
                  <span className="flex-1">{coluna.nome}</span>
                  {aqui ? <span className="text-[11px]">atual</span> : <ArrowRight size={13} className="text-faint" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="border-t border-line px-5 py-3">
        <button type="button" onClick={aoEditar} className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-accent-forte hover:underline">
          <Pencil size={13} />
          Editar negócio
        </button>
      </div>
    </ModalGestao>
  );
}

function CardNegocio({ negocio, contato, arrastando, aoArrastar, aoSoltarCard, aoEditar, aoMenu, aoAbrirContato }) {
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", negocio.id);
        aoArrastar(negocio.id);
      }}
      onDragEnd={aoSoltarCard}
      onClick={() => aoEditar(negocio)}
      className={`group cursor-grab rounded-[9px] border border-line bg-bg p-2.5 shadow-[0_1px_2px_rgba(18,23,48,0.03)] transition-all hover:border-line-strong hover:shadow-md active:cursor-grabbing ${arrastando ? "opacity-40" : ""}`}
    >
      <div className="flex items-start gap-2">
        <Iniciais nome={contato?.nome} tamanho={27} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold text-fg">{negocio.titulo || "Sem título"}</h3>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              aoAbrirContato?.(contato);
            }}
            className="mt-0.5 flex max-w-full cursor-pointer items-center gap-1 text-left text-[10.5px] text-sub hover:text-accent-forte"
          >
            <span className="truncate">{contato?.nome || "Lead sem nome"}</span>
          </button>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            aoMenu(negocio);
          }}
          title="Mover ou editar"
          aria-label={`Mover ou editar ${negocio.titulo || "negócio"}`}
          className="-mr-1 -mt-0.5 flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-[6px] text-faint hover:bg-surface-hover hover:text-fg"
        >
          <MoreHorizontal size={15} />
        </button>
      </div>

      {negocio.status === "perdido" && negocio.motivoPerda && (
        <p className="mt-2 truncate rounded-[6px] bg-danger/5 px-2 py-1 text-[10.5px] text-danger" title={negocio.motivoPerda}>
          {negocio.motivoPerda}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2 text-[10px] text-faint">
        <span className="text-[11px] font-semibold text-fg"><Valor valor={negocio.valor} /></span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 items-center gap-1 truncate">
            <Inbox size={11} strokeWidth={1.8} />
            {negocio.origem || "Sem origem"}
          </span>
          <span className="flex flex-none items-center gap-1">
            <CalendarDays size={11} strokeWidth={1.8} />
            {fmtData(negocio.atualizadoEm)}
          </span>
        </span>
        <GripVertical size={12} className="hidden flex-none text-line-strong group-hover:block" />
      </div>
    </article>
  );
}

function Coluna({ coluna, negocios, total, destacada, aoEntrar, aoSair, aoSoltar, rodape, children }) {
  const valor = negocios.reduce((s, n) => s + (n.valor || 0), 0);
  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        aoEntrar(coluna.id);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) aoSair(coluna.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        aoSoltar(e.dataTransfer.getData("text/plain"), coluna.id);
      }}
      className={`flex min-h-[390px] min-w-[224px] flex-1 flex-col rounded-[10px] border p-2.5 transition-colors ${
        destacada ? "border-accent bg-accent-soft/40" : `border-line ${coluna.fundo || "bg-bg"}`
      }`}
    >
      <div className="mb-2.5 flex items-center gap-2 border-b border-line px-0.5 pb-2">
        {coluna.Icone && <coluna.Icone size={13} className={coluna.cor} />}
        <h2 className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-fg">{coluna.nome}</h2>
        {valor > 0 && <span className="text-[10px] text-faint">{fmtMoeda(valor)}</span>}
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${coluna.pilula || "bg-accent-soft text-accent-forte"}`}>{total}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {children}
        {negocios.length === 0 && (
          <p className={`rounded-[8px] px-2 py-8 text-center text-[12px] ${destacada ? "text-accent-forte" : "text-faint"}`}>
            {destacada ? "Solte aqui" : coluna.vazio || "Nenhum negócio"}
          </p>
        )}
      </div>
      {rodape}
    </section>
  );
}

export default function Funil({ dados, recarregar, aoAbrirContato, comando, aoConsumirComando }) {
  const { contatos, negocios, estagios } = dados;
  const [busca, setBusca] = useState("");
  const [filtroOrigem, setFiltroOrigem] = useState("");
  const [filtroResponsavel, setFiltroResponsavel] = useState("");
  const [editando, setEditando] = useState(undefined);
  const [perdendo, setPerdendo] = useState(null);
  const [menuDe, setMenuDe] = useState(null);
  const [arrastando, setArrastando] = useState(null);
  const [colunaAlvo, setColunaAlvo] = useState(null);
  const [verTodosFechados, setVerTodosFechados] = useState(false);
  // Movimentos ainda não confirmados pelo banco. O card muda de coluna na
  // hora; se o salvamento falhar, a entrada sai daqui e ele volta sozinho.
  const [pendentes, setPendentes] = useState({});
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (!comando) return;
    if (comando.tipo === "novo-negocio") setEditando({ contactId: comando.contatoId });
    if (comando.tipo === "editar-negocio") setEditando(comando.item);
    if (comando.tipo === "novo-negocio" || comando.tipo === "editar-negocio") aoConsumirComando?.();
  }, [aoConsumirComando, comando]);

  const contatosPorId = useMemo(
    () => Object.fromEntries(contatos.map((c) => [c.id, c])),
    [contatos]
  );
  const idFechado = acharEstagioFechado(estagios)?.id || null;
  // Só as etapas de negócio em andamento; a "Fechado" é a coluna do fim.
  const estagiosOrdenados = useMemo(
    () => estagios.filter((e) => e.id !== idFechado).sort((a, b) => a.ordem - b.ordem),
    [estagios, idFechado]
  );
  const origens = useMemo(
    () => [...new Set(negocios.map((n) => n.origem).filter(Boolean))].sort(),
    [negocios]
  );
  const responsaveis = useMemo(
    () => [...new Set(contatos.map((c) => c.responsavel).filter(Boolean))].sort(),
    [contatos]
  );

  const visiveis = useMemo(
    () => negocios.map((n) => (pendentes[n.id] ? { ...n, ...pendentes[n.id] } : n)),
    [negocios, pendentes]
  );

  const colunas = useMemo(
    () => [
      ...estagiosOrdenados.map((e) => ({ id: colunaDoEstagio(e.id), nome: e.nome, Icone: Briefcase, cor: "text-faint" })),
      { id: COLUNA_GANHO, nome: "Fechado", Icone: Trophy, cor: "text-success", fundo: "bg-success-soft/30", pilula: "bg-success-soft text-success", vazio: "Arraste para cá o que fechou" },
      { id: COLUNA_PERDIDO, nome: "Perdido", Icone: ThumbsDown, cor: "text-danger", fundo: "bg-danger/[0.03]", pilula: "bg-danger/10 text-danger", vazio: "Arraste para cá o que não fechou" },
    ],
    [estagiosOrdenados]
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return visiveis
      .filter((n) => {
        const contato = contatosPorId[n.contactId];
        if (filtroOrigem && n.origem !== filtroOrigem) return false;
        if (filtroResponsavel && contato?.responsavel !== filtroResponsavel) return false;
        if (!termo) return true;
        return (
          n.titulo.toLowerCase().includes(termo) ||
          nomeDoContato(contatos, n.contactId).toLowerCase().includes(termo) ||
          (contato?.empresa || "").toLowerCase().includes(termo)
        );
      })
      .sort((a, b) => (b.atualizadoEm || b.criadoEm) - (a.atualizadoEm || a.criadoEm));
  }, [busca, contatos, contatosPorId, filtroOrigem, filtroResponsavel, visiveis]);

  const abertos = visiveis.filter((n) => colunaDoNegocio(n, idFechado).startsWith("estagio:"));
  const ganhos = visiveis.filter((n) => colunaDoNegocio(n, idFechado) === COLUNA_GANHO);

  const aplicar = async (negocio, patch) => {
    setErro(null);
    setPendentes((p) => ({ ...p, [negocio.id]: patch }));
    try {
      await api.negocios.atualizar({ id: negocio.id, patch });
      await recarregar();
    } catch (e) {
      setErro(e?.message || String(e));
    } finally {
      setPendentes(({ [negocio.id]: _, ...resto }) => resto);
    }
  };

  const moverPara = (negocio, coluna) => {
    if (!negocio || colunaDoNegocio(negocio, idFechado) === coluna) return;
    if (coluna === COLUNA_PERDIDO) {
      setPerdendo(negocio);
      return;
    }
    aplicar(negocio, patchParaColuna(coluna, idFechado));
  };

  const soltar = (id, coluna) => {
    setArrastando(null);
    setColunaAlvo(null);
    moverPara(visiveis.find((n) => n.id === id), coluna);
  };

  const agora = Date.now();
  const recente = (n) => agora - (n.atualizadoEm || n.criadoEm || 0) < JANELA_FECHADOS;

  return (
    <>
      <CabecalhoTela
        titulo="Funil"
        busca={<CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar negócios ou leads..." />}
        acao={
          <BotaoPrimario onClick={() => setEditando(null)}>
            <Plus size={18} strokeWidth={2.4} />
            Novo negócio
          </BotaoPrimario>
        }
      />

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-5 py-3">
        <div className="flex flex-col gap-3">
          <ResumoFunilCompacto abertos={abertos} ganhos={ganhos} total={visiveis.length} />

          <div className="flex flex-wrap items-center gap-1.5 rounded-[9px] border border-line bg-bg px-2 py-1.5">
            <span className="mr-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
              <Filter size={12} strokeWidth={1.8} />
              Filtros
            </span>
            <Seletor
              compacto
              valor={filtroOrigem}
              aoMudar={setFiltroOrigem}
              rotuloVazio="Todas as origens"
              opcoes={origens.map((o) => ({ id: o, rotulo: o }))}
            />
            <Seletor
              compacto
              valor={filtroResponsavel}
              aoMudar={setFiltroResponsavel}
              rotuloVazio="Todos os responsáveis"
              opcoes={responsaveis.map((r) => ({ id: r, rotulo: r }))}
            />
            <span className="ml-auto hidden text-[11px] text-faint sm:inline">Arraste os cards entre as colunas</span>
          </div>

          {erro && (
            <p className="flex items-center gap-2 rounded-[10px] bg-danger/10 px-4 py-3 text-[13px] text-danger">
              <span className="flex-1">Não deu para mover: {erro}</span>
              <button type="button" onClick={() => setErro(null)} className="cursor-pointer" aria-label="Fechar aviso"><X size={14} /></button>
            </p>
          )}

          {negocios.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum negócio ainda"
              descricao="Crie um lead pela conversa e abra um negócio para ele — ou use o botão Novo negócio."
            />
          ) : (
            <div className="scrollbar-fina flex min-h-[calc(100vh-300px)] gap-2 overflow-x-auto pb-2">
              {colunas.map((coluna) => {
                const fechada = coluna.id === COLUNA_GANHO || coluna.id === COLUNA_PERDIDO;
                const daColuna = filtrados.filter((n) => colunaDoNegocio(n, idFechado) === coluna.id);
                const mostrados = fechada && !verTodosFechados ? daColuna.filter(recente) : daColuna;
                const escondidos = daColuna.length - mostrados.length;
                return (
                  <Coluna
                    key={coluna.id}
                    coluna={coluna}
                    negocios={mostrados}
                    total={daColuna.length}
                    destacada={arrastando && colunaAlvo === coluna.id}
                    aoEntrar={(id) => colunaAlvo !== id && setColunaAlvo(id)}
                    aoSair={(id) => colunaAlvo === id && setColunaAlvo(null)}
                    aoSoltar={soltar}
                    rodape={
                      fechada && (escondidos > 0 || verTodosFechados) ? (
                        <button
                          type="button"
                          onClick={() => setVerTodosFechados((v) => !v)}
                          className="mt-2 cursor-pointer rounded-[7px] py-1.5 text-[11px] font-medium text-sub hover:bg-surface-hover hover:text-fg"
                        >
                          {verTodosFechados ? "Mostrar só os últimos 30 dias" : `Ver mais ${escondidos} antigo${escondidos === 1 ? "" : "s"}`}
                        </button>
                      ) : null
                    }
                  >
                    {mostrados.map((negocio) => (
                      <CardNegocio
                        key={negocio.id}
                        negocio={negocio}
                        contato={contatosPorId[negocio.contactId]}
                        arrastando={arrastando === negocio.id}
                        aoArrastar={setArrastando}
                        aoSoltarCard={() => {
                          setArrastando(null);
                          setColunaAlvo(null);
                        }}
                        aoEditar={setEditando}
                        aoMenu={setMenuDe}
                        aoAbrirContato={aoAbrirContato}
                      />
                    ))}
                  </Coluna>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {menuDe && (
        <ModalMover
          negocio={menuDe}
          colunas={colunas}
          idFechado={idFechado}
          aoFechar={() => setMenuDe(null)}
          aoEditar={() => {
            setEditando(menuDe);
            setMenuDe(null);
          }}
          aoMover={(coluna) => {
            const negocio = menuDe;
            setMenuDe(null);
            moverPara(negocio, coluna);
          }}
        />
      )}

      {perdendo && (
        <ModalPerda
          negocio={perdendo}
          aoFechar={() => setPerdendo(null)}
          aoConfirmar={(motivoPerda) => {
            const negocio = perdendo;
            setPerdendo(null);
            aplicar(negocio, { status: "perdido", motivoPerda });
          }}
        />
      )}

      {editando !== undefined && (
        <FormularioNegocio
          key={editando?.id || "novo"}
          negocio={editando}
          contatos={contatos}
          estagios={estagiosOrdenados}
          idFechado={idFechado}
          origens={origens}
          aoFechar={() => setEditando(undefined)}
          recarregar={recarregar}
        />
      )}
    </>
  );
}
