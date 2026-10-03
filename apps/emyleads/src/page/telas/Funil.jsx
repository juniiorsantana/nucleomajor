import { useEffect, useMemo, useRef, useState } from "react";
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
  TrendingUp,
  UserPlus,
  X,
} from "lucide-react";
import { api } from "../../data/client";
import { ehLead } from "../../domain/lead";
import { corDoEstagio } from "../../domain/types";
import { metricasDoPeriodo, periodoDoPreset, periodoPersonalizado, variacao } from "./relatorios/metricas";
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

/*
 * Os cartões contam um PERÍODO; o quadro abaixo continua mostrando tudo o que
 * está em aberto, porque é a mesa de trabalho. "Em andamento" é a única
 * exceção: é uma foto de agora, e diz isso no rótulo.
 */
const PERIODOS_DO_FUNIL = [
  { id: "mes", rotulo: "Este mês" },
  { id: "15d", rotulo: "15 dias" },
  { id: "30d", rotulo: "30 dias" },
  { id: "60d", rotulo: "60 dias" },
  { id: "90d", rotulo: "90 dias" },
  { id: "personalizado", rotulo: "Personalizado" },
];

const paraInputData = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function VariacaoCurta({ atual, anterior }) {
  const v = variacao(atual, anterior);
  if (v == null || v === 0) return null;
  return (
    <span className={`text-[10px] font-semibold ${v > 0 ? "text-success" : "text-danger"}`} title={`Período anterior: ${anterior}`}>
      {v > 0 ? "▲" : "▼"} {Math.abs(Math.round(v * 100))}%
    </span>
  );
}

function ResumoFunilCompacto({ dados, negocios, abertos, aoVerRelatorios }) {
  const [presetId, setPresetId] = useState("mes");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const periodo = useMemo(
    () => (presetId === "personalizado" ? periodoPersonalizado(de, ate) : null) || periodoDoPreset(presetId === "personalizado" ? "mes" : presetId),
    [presetId, de, ate]
  );
  const base = useMemo(() => ({ contatos: dados.contatos, negocios, estagios: dados.estagios }), [dados, negocios]);
  const atual = useMemo(() => metricasDoPeriodo(base, periodo), [base, periodo]);
  const anterior = useMemo(() => metricasDoPeriodo(base, periodo.anterior), [base, periodo]);
  const valorAberto = abertos.reduce((s, n) => s + (n.valor || 0), 0);

  const escolher = (id) => {
    if (id === "personalizado" && !de) {
      setDe(paraInputData(periodo.inicio));
      setAte(paraInputData(periodo.fim - 1));
    }
    setPresetId(id);
  };

  const itens = [
    { rotulo: "Novos negócios", valor: atual.negociosNovos.toLocaleString("pt-BR"), detalhe: atual.valorCriado ? `${fmtMoeda(atual.valorCriado)} criados` : "no período", Icone: Briefcase, tom: "accent", atual: atual.negociosNovos, anterior: anterior.negociosNovos },
    { rotulo: "Em andamento agora", valor: abertos.length.toLocaleString("pt-BR"), detalhe: `${fmtMoeda(valorAberto) || "R$ 0"} no pipeline`, Icone: CircleDollarSign, tom: "neutral" },
    { rotulo: "Fechados", valor: atual.ganhos.toLocaleString("pt-BR"), detalhe: `${fmtMoeda(atual.valorGanho) || "R$ 0"} convertido`, Icone: TrendingUp, tom: "success", atual: atual.ganhos, anterior: anterior.ganhos },
    { rotulo: "Taxa de ganho", valor: atual.taxaDeGanho == null ? "—" : `${Math.round(atual.taxaDeGanho * 100)}%`, detalhe: `${atual.ganhos} ${atual.ganhos === 1 ? "ganho" : "ganhos"} · ${atual.perdidos} ${atual.perdidos === 1 ? "perdido" : "perdidos"}`, Icone: Filter, tom: "accent" },
  ];

  const chip = (ativo) => `cursor-pointer whitespace-nowrap rounded-ctl px-2 py-1 text-[11.5px] font-medium transition-colors ${ativo ? "bg-fg text-bg" : "text-sub hover:bg-surface-hover hover:text-fg"}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
          <CalendarDays size={12} strokeWidth={1.8} />
          Período
        </span>
        {PERIODOS_DO_FUNIL.map((p) => (
          <button key={p.id} type="button" className={chip(presetId === p.id)} aria-pressed={presetId === p.id} onClick={() => escolher(p.id)}>
            {p.rotulo}
          </button>
        ))}
        {presetId === "personalizado" && (
          <span className="flex items-center gap-1 text-[11.5px] text-sub">
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} aria-label="De" className="rounded-ctl border border-line bg-bg px-1.5 py-0.5 text-[11.5px] text-fg outline-none focus:border-signal" />
            até
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Até" className="rounded-ctl border border-line bg-bg px-1.5 py-0.5 text-[11.5px] text-fg outline-none focus:border-signal" />
          </span>
        )}
        {aoVerRelatorios && (
          <button type="button" onClick={aoVerRelatorios} className="ml-auto flex cursor-pointer items-center gap-1 text-[11.5px] font-medium text-signal hover:underline">
            Ver relatórios
            <ArrowRight size={12} />
          </button>
        )}
      </div>
    {/* Uma faixa só, com régua entre os números: são quatro leituras do mesmo
        funil, e quatro caixas soltas pareciam quatro assuntos. */}
    <div className="grid border border-line bg-bg sm:grid-cols-2 xl:grid-cols-4">
      {itens.map(({ rotulo, valor, detalhe, atual: a, anterior: b }, i) => (
        <div
          key={rotulo}
          className={`min-w-0 px-4 py-3 ${i > 0 ? "border-t border-line sm:border-t-0" : ""} ${i % 2 === 1 ? "sm:border-l sm:border-line" : ""} ${i > 1 ? "sm:border-t sm:border-line xl:border-t-0" : ""} ${i > 0 ? "xl:border-l xl:border-line" : ""}`}
        >
          <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{rotulo}</span>
          <div className="mt-1.5 flex min-w-0 items-baseline gap-2">
            <strong className="truncate text-[22px] font-semibold leading-none tracking-tight tabular-nums text-fg">{valor}</strong>
            <VariacaoCurta atual={a} anterior={b} />
          </div>
          <span className="mt-1 block truncate text-[11px] text-faint">{detalhe}</span>
        </div>
      ))}
    </div>
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
      // Leads primeiro: negócio é para lead. O contato comum continua na
      // lista porque escolhê-lo é o jeito de transformá-lo em lead.
      .sort((a, b) => Number(ehLead(b)) - Number(ehLead(a)) || (a.nome || "").localeCompare(b.nome || "", "pt-BR"))
      .slice(0, 8);
  }, [contatos, termo]);

  if (escolhido && !aberto) {
    return (
      <div>
      <div className="flex items-center gap-2 rounded-ctl border border-line bg-bg px-2.5 py-1.5">
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
          className="cursor-pointer rounded-ctl px-2 py-1 text-[12px] font-medium text-accent-forte hover:bg-accent-soft"
        >
          Trocar
        </button>
      </div>
      {!ehLead(escolhido) && (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-ctl bg-warning/10 px-2.5 py-2 text-[12px] leading-[17px] text-fg">
          <UserPlus size={14} className="mt-[1px] flex-none text-warning" />
          <span>
            <strong className="font-semibold">{escolhido.nome || "Este contato"}</strong> ainda não é lead.
            Ao salvar o negócio, ele passa a ser lead.
          </span>
        </p>
      )}
      </div>
    );
  }

  return (
    <div className="rounded-ctl border border-line bg-bg focus-within:border-accent">
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
              {!ehLead(c) && <span className="flex-none rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-sub">Contato</span>}
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

function FormularioNegocio({ negocio, contatos, negocios = [], estagios, idFechado, origens, aoFechar, aoEditarExistente, recarregar }) {
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

  // Todo lead já entra no Funil sozinho. "Novo negócio" para quem já está lá
  // quase sempre quer dizer "dizer o que ele quer", e criar outro deixaria dois
  // cartões da mesma pessoa. Criar outro continua possível: há cliente que
  // compra duas coisas.
  const existente = !negocio?.id && form.contactId
    ? negocios.find((n) => n.contactId === form.contactId && n.status === "aberto")
    : null;

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
          {existente && (
            <div className="col-span-2 rounded-ctl border border-accent/30 bg-accent-soft/50 px-3 py-2.5 text-[12.5px] text-sub">
              Este lead já está no Funil
              {existente.titulo ? <> com <strong className="font-semibold text-fg">{existente.titulo}</strong></> : ""}.
              {aoEditarExistente && (
                <button
                  type="button"
                  onClick={() => aoEditarExistente(existente)}
                  className="ml-1 cursor-pointer font-semibold text-accent-forte hover:underline"
                >
                  Editar esse negócio
                </button>
              )}
              <span className="mt-0.5 block text-[11.5px] text-faint">Salvar aqui cria um segundo negócio para a mesma pessoa.</span>
            </div>
          )}
          <CampoFormulario rotulo="O que o cliente quer" className="col-span-2">
            <input
              value={form.titulo}
              onChange={(e) => alterar("titulo", e.target.value)}
              className={ENTRADA_GESTAO}
              placeholder="Ex.: produto, serviço ou plano de interesse"
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
              className="cursor-pointer rounded-ctl px-3 py-2 text-[13px] font-medium text-sub hover:text-fg"
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
          <button type="button" onClick={aoFechar} className="cursor-pointer rounded-ctl px-3 py-2 text-[13px] font-medium text-sub hover:text-fg">
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
                  className="flex w-full cursor-pointer items-center gap-2 rounded-ctl px-2 py-2 text-left text-[13px] text-fg hover:bg-surface-hover disabled:cursor-default disabled:bg-accent-soft disabled:text-accent-forte"
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
      className={`group cursor-grab rounded-none border border-line bg-bg p-2.5 transition-colors hover:border-line-strong active:cursor-grabbing ${arrastando ? "opacity-40" : ""}`}
    >
      <div className="flex items-start gap-2">
        <Iniciais nome={contato?.nome} tamanho={27} />
        {/*
          Quem é vem antes do que é: no kanban a equipe procura a pessoa. O
          negócio do lead que entrou sozinho no Funil nasce sem título, e o
          cartão diz que falta defini-lo em vez de repetir "Sem título".
        */}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold text-fg">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                aoAbrirContato?.(contato);
              }}
              title="Abrir ficha do contato"
              className="max-w-full cursor-pointer truncate text-left hover:underline"
            >
              {contato?.nome || "Lead sem nome"}
            </button>
          </h3>
          <p className={`mt-0.5 truncate text-[11.5px] ${negocio.titulo ? "text-sub" : "italic text-faint"}`}>
            {negocio.titulo || "Negócio a definir"}
          </p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            aoMenu(negocio);
          }}
          title="Mover ou editar"
          aria-label={`Mover ou editar ${negocio.titulo || "negócio"}`}
          className="-mr-1 -mt-0.5 flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-ctl text-faint hover:bg-surface-hover hover:text-fg"
        >
          <MoreHorizontal size={15} />
        </button>
      </div>

      {negocio.status === "perdido" && negocio.motivoPerda && (
        <p className="mt-2 truncate rounded-none bg-danger-soft px-2 py-1 text-[10.5px] text-danger" title={negocio.motivoPerda}>
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

// O que já tem gesto próprio: o card se arrasta entre colunas e o resto se clica.
const COM_GESTO_PROPRIO = "article, button, a, input, select, textarea, label";

// Mouse sem rodinha lateral não alcançava as colunas da direita. O fundo do
// quadro — tudo que não é card nem botão — vira alça: clicar e puxar move o
// quadro nos dois eixos, e a rodinha sobre ele anda para os lados até a
// ponta, onde devolve a rolagem para cima e para baixo.
function useQuadroArrastavel(ativo) {
  const quadro = useRef(null);
  const [puxando, setPuxando] = useState(false);

  useEffect(() => {
    const el = quadro.current;
    if (!ativo || !el) return;
    const rolagemVertical = el.closest(".overflow-y-auto");
    const noFundo = (alvo) => !alvo.closest(COM_GESTO_PROPRIO);
    let inicio = null;

    const aoRodar = (e) => {
      if (e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || !noFundo(e.target)) return;
      const fim = el.scrollWidth - el.clientWidth;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= fim - 1)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    };
    const aoApertar = (e) => {
      if (e.button !== 0 || e.pointerType !== "mouse" || !noFundo(e.target)) return;
      e.preventDefault();
      inicio = { x: e.clientX, y: e.clientY, esquerda: el.scrollLeft, topo: rolagemVertical?.scrollTop ?? 0 };
      el.setPointerCapture(e.pointerId);
      setPuxando(true);
    };
    const aoMover = (e) => {
      if (!inicio) return;
      el.scrollLeft = inicio.esquerda - (e.clientX - inicio.x);
      if (rolagemVertical) rolagemVertical.scrollTop = inicio.topo - (e.clientY - inicio.y);
    };
    const aoLargar = (e) => {
      if (!inicio) return;
      inicio = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      setPuxando(false);
    };

    el.addEventListener("wheel", aoRodar, { passive: false });
    el.addEventListener("pointerdown", aoApertar);
    el.addEventListener("pointermove", aoMover);
    el.addEventListener("pointerup", aoLargar);
    el.addEventListener("pointercancel", aoLargar);
    return () => {
      el.removeEventListener("wheel", aoRodar);
      el.removeEventListener("pointerdown", aoApertar);
      el.removeEventListener("pointermove", aoMover);
      el.removeEventListener("pointerup", aoLargar);
      el.removeEventListener("pointercancel", aoLargar);
    };
  }, [ativo]);

  return { quadro, puxando };
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
      className={`flex min-h-[390px] min-w-[224px] flex-1 flex-col border-l border-line p-2.5 transition-colors first:border-l-0 ${
        destacada ? "bg-signal-soft shadow-[inset_0_0_0_1px_var(--el-signal)]" : "bg-surface"
      }`}
    >
      <div className="mb-2.5 flex items-center gap-2 border-b border-line px-0.5 pb-2">
        {/* O quadrado é o degrau do estágio na escala do funil; Fechado e
            Perdido usam a cor de estado. */}
        <span aria-hidden="true" className="h-2.5 w-2.5 flex-none" style={{ background: coluna.marca }} />
        <h2 className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-fg">{coluna.nome}</h2>
        {valor > 0 && <span className="text-[10px] text-faint">{fmtMoeda(valor)}</span>}
        <span className="text-[11px] font-semibold tabular-nums text-sub">{total}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {children}
        {negocios.length === 0 && (
          <p className={`px-2 py-8 text-center text-[12px] ${destacada ? "font-medium text-signal" : "text-faint"}`}>
            {destacada ? "Solte aqui" : coluna.vazio || "Nenhum negócio"}
          </p>
        )}
      </div>
      {rodape}
    </section>
  );
}

export default function Funil({ dados, recarregar, aoAbrirContato, comando, aoConsumirComando, aoVerRelatorios }) {
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
  const { quadro, puxando } = useQuadroArrastavel(negocios.length > 0);

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
      ...estagiosOrdenados.map((e) => ({ id: colunaDoEstagio(e.id), nome: e.nome, marca: corDoEstagio(e).marca })),
      { id: COLUNA_GANHO, nome: "Fechado", marca: "var(--el-success)", vazio: "Arraste para cá o que fechou" },
      { id: COLUNA_PERDIDO, nome: "Perdido", marca: "var(--el-danger)", vazio: "Arraste para cá o que não fechou" },
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
          <ResumoFunilCompacto dados={dados} negocios={visiveis} abertos={abertos} aoVerRelatorios={aoVerRelatorios} />

          <div className="flex flex-wrap items-center gap-1.5">
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
            <span className="ml-auto hidden text-[11px] text-faint sm:inline">Arraste os cards entre as colunas · puxe o fundo ou use a rodinha para ver as outras</span>
          </div>

          {erro && (
            <p className="flex items-center gap-2 rounded-ctl bg-danger/10 px-4 py-3 text-[13px] text-danger">
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
            <div
              ref={quadro}
              className={`scrollbar-fina flex min-h-[calc(100vh-300px)] overflow-x-auto border border-line ${puxando ? "cursor-grabbing select-none" : "cursor-grab"}`}
            >
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
                          className="mt-2 cursor-pointer rounded-ctl py-1.5 text-[11px] font-medium text-sub hover:bg-surface-hover hover:text-fg"
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
          negocios={negocios}
          estagios={estagiosOrdenados}
          idFechado={idFechado}
          origens={origens}
          aoFechar={() => setEditando(undefined)}
          aoEditarExistente={(existente) => setEditando(existente)}
          recarregar={recarregar}
        />
      )}
    </>
  );
}
