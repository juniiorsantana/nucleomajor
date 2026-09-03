import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, Clock3, Hourglass, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { api } from "../../data/client";
import { tarefaAtrasada } from "../../domain/types";
import { fmtVencimento } from "../../lib/formato";
import {
  BotaoPrimario,
  CabecalhoTela,
  CampoBusca,
  CartaoIndicador,
  Caixa,
  Iniciais,
  Seletor,
} from "../ui";
import {
  CampoFormulario,
  dataInput,
  dataParaTimestamp,
  ENTRADA_GESTAO,
  EstadoVazio,
  ModalGestao,
  nomeDoContato,
  SeletorResponsaveis,
} from "./gestaoCompartilhados";
import { nomeCurto } from "../../ui/perfil";

/** Os ids de quem responde pela tarefa, com o principal como reserva. */
function idsDosResponsaveis(tarefa) {
  if (tarefa.responsaveis?.length) return tarefa.responsaveis;
  return tarefa.ownerId ? [tarefa.ownerId] : [];
}

/**
 * Assumiu, recusou, ou ainda não respondeu.
 *
 * Devolve `null` quando a tarefa não carrega `respostas` — é o caso da
 * extensão, que não sincroniza os vínculos. Ali a tela não pode afirmar
 * "aguardando": ninguém está aguardando nada, o dado é que não veio. Estado
 * inventado é pior que estado ausente, porque parece verdade.
 */
function respostaDoResponsavel(tarefa, id) {
  if (!tarefa.respostas) return null;
  const resposta = tarefa.respostas[id];
  if (!resposta) return null;
  if (resposta.recusadoEm) return { estado: "recusou", motivo: resposta.motivo };
  if (resposta.aceitoEm) return { estado: "assumiu", motivo: "" };
  return { estado: "aguardando", motivo: "" };
}

/**
 * Como os responsáveis aparecem em uma linha da lista.
 *
 * Resolve pelo id contra a equipe, e só cai no `owner_label` gravado quando
 * o id não é de ninguém da equipe hoje — tarefa antiga, feita quando o campo
 * era texto livre, ou de alguém que já saiu. O rótulo é uma fotografia do
 * nome no dia em que se gravou; o id é a pessoa.
 */
function nomesDosResponsaveis(tarefa, porId) {
  const nomes = idsDosResponsaveis(tarefa)
    .map((id) => porId.get(id))
    .filter(Boolean)
    .map((membro) => nomeCurto(membro.profile));
  if (nomes.length) return nomes;
  return tarefa.responsavel ? [tarefa.responsavel] : [];
}

const FILTROS_STATUS = [
  { id: "abertas", rotulo: "Abertas" },
  { id: "concluidas", rotulo: "Concluídas" },
  { id: "todas", rotulo: "Todas" },
];

const FILTROS_PRAZO = [
  { id: "atrasadas", rotulo: "Atrasadas" },
  { id: "hoje", rotulo: "Hoje" },
  { id: "proximas", rotulo: "Próximas" },
  { id: "sem-data", rotulo: "Sem data" },
];

function chaveDia(ts) {
  if (ts == null) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function grupoDaTarefa(tarefa, agora = Date.now()) {
  if (tarefa.concluida) return "concluidas";
  if (tarefa.venceEm == null) return "sem-data";
  const hoje = chaveDia(agora);
  const alvo = chaveDia(tarefa.venceEm);
  if (tarefaAtrasada(tarefa, agora) && alvo !== hoje) return "atrasadas";
  if (alvo === hoje) return "hoje";
  return "proximas";
}

function FormularioTarefa({ tarefa, contatoIdInicial, contatos, equipe, aoFechar, recarregar }) {
  // Sem contato pré-selecionado. O contato é o do CLIENTE e deixou de ser
  // obrigatório: escolher o primeiro da lista por conta própria prendia a
  // tarefa a quem estivesse no topo do alfabeto, e ninguém reparava.
  const [form, setForm] = useState(() => ({
    contactId: tarefa?.contactId || contatoIdInicial || "",
    titulo: tarefa?.titulo || "",
    venceEm: dataInput(tarefa?.venceEm),
    responsaveis: tarefa?.responsaveis?.length
      ? [...tarefa.responsaveis]
      : (tarefa?.ownerId ? [tarefa.ownerId] : []),
  }));
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const alterar = (campo, valor) => setForm((atual) => ({ ...atual, [campo]: valor }));

  const enviar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const principal = equipe.find((membro) => membro.user_id === form.responsaveis[0]);
      const dados = {
        contactId: form.contactId || null,
        titulo: form.titulo.trim(),
        venceEm: dataParaTimestamp(form.venceEm),
        responsaveis: form.responsaveis,
        // `owner_label` continua sendo gravado: é dele que a agenda e o
        // assistente leem o nome enquanto o perfil não é carregado, e o
        // banco o tem como `not null`.
        responsavel: principal ? nomeCurto(principal.profile, "") : "",
      };
      if (tarefa?.id) await api.tarefas.atualizar({ id: tarefa.id, patch: dados });
      else await api.tarefas.criar(dados);
      await recarregar();
      aoFechar();
    } catch (e) {
      setErro(e?.message || String(e));
    } finally {
      setSalvando(false);
    }
  };

  const remover = async () => {
    if (!tarefa?.id || !confirm("Excluir esta tarefa?")) return;
    setSalvando(true);
    try {
      await api.tarefas.remover({ id: tarefa.id });
      await recarregar();
      aoFechar();
    } catch (e) {
      setErro(e?.message || String(e));
      setSalvando(false);
    }
  };

  return (
    <ModalGestao titulo={tarefa?.id ? "Editar tarefa" : "Nova tarefa"} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        <div className="grid grid-cols-2 gap-3 px-5 py-4">
          <CampoFormulario rotulo="Título" className="col-span-2">
            <input
              required
              value={form.titulo}
              onChange={(e) => alterar("titulo", e.target.value)}
              className={ENTRADA_GESTAO}
              placeholder="Ex.: Retornar para o cliente"
            />
          </CampoFormulario>
          <CampoFormulario rotulo="Contato do cliente" className="col-span-2">
            <select
              value={form.contactId}
              onChange={(e) => alterar("contactId", e.target.value)}
              className={`${ENTRADA_GESTAO} cursor-pointer`}
            >
              <option value="">Nenhum</option>
              {contatos
                .slice()
                .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.nome || "Sem nome"}</option>
                ))}
            </select>
          </CampoFormulario>
          <CampoFormulario rotulo="Vencimento" className="col-span-2">
            <input
              type="date"
              value={form.venceEm}
              onChange={(e) => alterar("venceEm", e.target.value)}
              className={ENTRADA_GESTAO}
            />
          </CampoFormulario>
          <div className="col-span-2">
            <SeletorResponsaveis
              membros={equipe}
              valores={form.responsaveis}
              aoMudar={(valores) => alterar("responsaveis", valores)}
            />
          </div>
          {erro && <p className="col-span-2 text-[13px] text-danger">{erro}</p>}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          {tarefa?.id && (
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
            <button type="button" onClick={aoFechar} className="cursor-pointer rounded-[8px] px-3 py-2 text-[13px] font-medium text-sub hover:text-fg">
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

/**
 * Recusar pede um motivo, e não obriga.
 *
 * Obrigar transformaria "não é comigo" em três minutos de redação, e a
 * pessoa simplesmente não recusaria — ficaria pendente para sempre, que é o
 * estado pior. Pedir aumenta a chance de vir, e vazio continua sendo uma
 * resposta melhor que silêncio.
 */
function DialogoRecusa({ tarefa, aoFechar, aoConfirmar }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  return (
    <ModalGestao titulo="Recusar a tarefa" aoFechar={aoFechar}>
      <div className="px-5 py-4">
        <p className="text-[13px] text-fg">{tarefa.titulo || "Sem título"}</p>
        <p className="mt-1 text-[11.5px] text-sub">
          A tarefa não some: ela volta para quem atribuiu, com o que você escrever aqui.
        </p>
        <CampoFormulario rotulo="Motivo (opcional)" className="mt-3 block">
          <textarea
            rows={3}
            maxLength={280}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className={ENTRADA_GESTAO}
            placeholder="Ex.: estou fora esta semana"
          />
        </CampoFormulario>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" onClick={aoFechar} className="cursor-pointer rounded-[8px] px-3 py-2 text-[13px] font-medium text-sub hover:text-fg">
          Cancelar
        </button>
        <button
          type="button"
          disabled={salvando}
          onClick={async () => { setSalvando(true); await aoConfirmar(motivo); }}
          className="cursor-pointer rounded-[8px] bg-danger px-3.5 py-2 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-40"
        >
          {salvando ? "Recusando…" : "Recusar"}
        </button>
      </div>
    </ModalGestao>
  );
}

function LinhaTarefa({
  tarefa, contato, negocio, responsaveis, pendencias, minhaResposta,
  aoAlternar, aoEditar, aoRemover, aoAbrirContato, aoAssumir, aoRecusar,
}) {
  const vencimento = fmtVencimento(tarefa.venceEm);
  const tons = { faint: "text-faint", sub: "text-sub", warning: "text-warning", danger: "text-danger" };
  // Silêncio quando está tudo certo. A pílula só aparece quando há algo a
  // fazer — se ela aparecesse em toda tarefa, deixaria de ser sinal.
  const precisoResponder = minhaResposta?.estado === "aguardando" && !tarefa.concluida;
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <Caixa marcada={tarefa.concluida} aoMudar={() => aoAlternar(tarefa)} titulo={tarefa.concluida ? "Reabrir tarefa" : "Concluir tarefa"} />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[13.5px] ${tarefa.concluida ? "text-faint line-through" : "font-medium text-fg"}`}>
          {tarefa.titulo || "Sem título"}
        </p>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[11.5px] text-sub">
          {contato ? (
            <button
              type="button"
              onClick={() => aoAbrirContato?.(contato)}
              className="flex min-w-0 cursor-pointer items-center gap-1.5 truncate hover:text-accent-forte"
            >
              <Iniciais nome={contato?.nome} tamanho={19} />
              <span className="truncate">{contato?.nome || "Contato sem nome"}</span>
            </button>
          ) : (
            <span className="truncate text-faint">Sem contato</span>
          )}
          {negocio && <><span>·</span><span className="truncate">{negocio.titulo}</span></>}
        </div>
      </div>
      <div className="hidden w-28 flex-none text-[11.5px] sm:block">
        <span className={tarefa.concluida ? "text-faint" : tons[vencimento.tom]}>
          {tarefa.concluida ? "Concluída" : vencimento.texto}
        </span>
      </div>
      <span className="hidden w-36 flex-none md:block">
        <span title={responsaveis.join(", ")} className="block truncate text-[11.5px] text-sub">
          {/* Duas pessoas cabem; a partir da terceira o "+N" é o que mantém a
              coluna estreita sem esconder que há mais gente na tarefa. */}
          {responsaveis.length > 2
            ? `${responsaveis.slice(0, 2).join(", ")} +${responsaveis.length - 2}`
            : responsaveis.join(", ") || "—"}
        </span>
        {pendencias.length > 0 && !tarefa.concluida && (
          <span
            title={pendencias.map((p) => p.texto).join(" · ")}
            className={`mt-0.5 flex items-center gap-1 truncate text-[10px] ${
              pendencias.some((p) => p.estado === "recusou") ? "text-danger" : "text-warning"
            }`}
          >
            {pendencias.some((p) => p.estado === "recusou")
              ? <Undo2 size={10} className="flex-none" />
              : <Hourglass size={10} className="flex-none" />}
            <span className="truncate">{pendencias[0].texto}</span>
            {pendencias.length > 1 && <span className="flex-none">+{pendencias.length - 1}</span>}
          </span>
        )}
      </span>
      {precisoResponder && (
        <span className="flex flex-none items-center gap-1">
          <button
            type="button"
            onClick={() => aoAssumir(tarefa)}
            className="flex cursor-pointer items-center gap-1 rounded-[7px] bg-accent px-2 py-1 text-[11px] font-semibold text-white hover:brightness-110"
          >
            <Check size={12} strokeWidth={2.6} />Assumir
          </button>
          <button
            type="button"
            onClick={() => aoRecusar(tarefa)}
            className="cursor-pointer rounded-[7px] px-2 py-1 text-[11px] font-medium text-sub hover:bg-surface-hover hover:text-fg"
          >
            Recusar
          </button>
        </span>
      )}
      <button type="button" onClick={() => aoEditar(tarefa)} title="Editar tarefa" className="cursor-pointer rounded-[7px] p-1.5 text-sub hover:bg-surface-hover hover:text-fg">
        <Pencil size={14} />
      </button>
      <button type="button" onClick={() => aoRemover(tarefa)} title="Excluir tarefa" className="cursor-pointer rounded-[7px] p-1.5 text-sub hover:bg-danger/10 hover:text-danger">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export default function Tarefas({ dados, recarregar, aoAbrirContato, comando, aoConsumirComando, sessao }) {
  const { contatos, negocios, tarefas } = dados;
  const [equipe, setEquipe] = useState([]);
  const [recusando, setRecusando] = useState(null);
  const usuarioId = sessao?.usuario?.id || null;
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("abertas");
  const [filtroPrazo, setFiltroPrazo] = useState("");
  const [filtroResponsavel, setFiltroResponsavel] = useState("");
  const [editando, setEditando] = useState(undefined);
  const [erro, setErro] = useState(null);
  const agora = Date.now();

  // A equipe é da tela, e não do carregamento geral: uma falha aqui deixa o
  // seletor vazio e o resto das tarefas de pé. Foi o que Conhecimento já
  // fazia, e o motivo é o mesmo — a lista de gente é apoio, não conteúdo.
  useEffect(() => {
    let vivo = true;
    api.organizacoes.membros()
      .then((lista) => { if (vivo) setEquipe(lista.filter((m) => m.status === "active")); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!comando) return;
    if (comando.tipo === "nova-tarefa") setEditando({ contactId: comando.contatoId });
    if (comando.tipo === "editar-tarefa") setEditando(comando.item);
    if (comando.tipo === "nova-tarefa" || comando.tipo === "editar-tarefa") aoConsumirComando?.();
  }, [aoConsumirComando, comando]);

  const equipePorId = useMemo(
    () => new Map(equipe.filter((m) => m.user_id).map((m) => [m.user_id, m])),
    [equipe]
  );
  // O filtro passa a listar a EQUIPE, e não os nomes já digitados. Antes ele
  // se alimentava do próprio `owner_label`, então uma pessoa escrita de três
  // jeitos virava três filtros e nenhum deles achava tudo dela.
  const opcoesResponsavel = useMemo(
    () => equipe
      .filter((m) => m.user_id)
      .map((m) => ({ id: m.user_id, rotulo: nomeCurto(m.profile) }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR")),
    [equipe]
  );
  const nomesPorTarefa = useMemo(
    () => new Map(tarefas.map((t) => [t.id, nomesDosResponsaveis(t, equipePorId)])),
    [equipePorId, tarefas]
  );
  // Só o que está em aberto. Quem assumiu não vira linha na tela: a coluna
  // já diz que a tarefa é dele, e repetir "assumiu" em toda tarefa afogaria
  // as duas ou três que realmente esperam alguém.
  const pendenciasPorTarefa = useMemo(() => {
    const mapa = new Map();
    for (const t of tarefas) {
      const abertas = [];
      for (const id of idsDosResponsaveis(t)) {
        const resposta = respostaDoResponsavel(t, id);
        if (!resposta || resposta.estado === "assumiu") continue;
        const nome = nomeCurto(equipePorId.get(id)?.profile, "alguém");
        abertas.push({
          estado: resposta.estado,
          texto: resposta.estado === "recusou"
            ? `${nome} recusou${resposta.motivo ? `: ${resposta.motivo}` : ""}`
            : `aguardando ${nome}`,
        });
      }
      // Recusa primeiro: ela pede uma decisão de quem delegou, e a espera não.
      abertas.sort((a, b) => Number(b.estado === "recusou") - Number(a.estado === "recusou"));
      mapa.set(t.id, abertas);
    }
    return mapa;
  }, [equipePorId, tarefas]);
  const contatosPorId = useMemo(
    () => Object.fromEntries(contatos.map((c) => [c.id, c])),
    [contatos]
  );
  const negociosPorId = useMemo(
    () => Object.fromEntries(negocios.map((n) => [n.id, n])),
    [negocios]
  );

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return tarefas
      .filter((t) => {
        const contato = contatosPorId[t.contactId];
        const grupo = grupoDaTarefa(t, agora);
        if (filtroStatus === "abertas" && t.concluida) return false;
        if (filtroStatus === "concluidas" && !t.concluida) return false;
        if (filtroPrazo && grupo !== filtroPrazo) return false;
        if (filtroResponsavel && !idsDosResponsaveis(t).includes(filtroResponsavel)) return false;
        if (!termo) return true;
        return (
          t.titulo.toLowerCase().includes(termo) ||
          nomeDoContato(contatos, t.contactId).toLowerCase().includes(termo) ||
          (contato?.empresa || "").toLowerCase().includes(termo)
        );
      })
      .sort((a, b) => {
        if (a.concluida !== b.concluida) return Number(a.concluida) - Number(b.concluida);
        return (a.venceEm ?? Infinity) - (b.venceEm ?? Infinity);
      });
  }, [agora, busca, contatos, contatosPorId, filtroPrazo, filtroResponsavel, filtroStatus, tarefas]);

  const grupos = [
    ["atrasadas", "Atrasadas"],
    ["hoje", "Hoje"],
    ["proximas", "Próximas"],
    ["sem-data", "Sem data"],
    ["concluidas", "Concluídas"],
  ];
  const abertas = tarefas.filter((t) => !t.concluida);
  const atrasadas = abertas.filter((t) => grupoDaTarefa(t, agora) === "atrasadas");
  const hoje = abertas.filter((t) => grupoDaTarefa(t, agora) === "hoje");
  const concluidas = tarefas.filter((t) => t.concluida);

  const alternar = async (tarefa) => {
    try {
      await api.tarefas.concluir({ id: tarefa.id, concluida: !tarefa.concluida });
      await recarregar();
    } catch (e) {
      setErro(e?.message || String(e));
    }
  };

  const responder = async (tarefa, aceitar, motivo = "") => {
    try {
      await api.tarefas.responder({ id: tarefa.id, aceitar, motivo });
      await recarregar();
      setRecusando(null);
    } catch (e) {
      setErro(e?.message || String(e));
      setRecusando(null);
    }
  };

  const remover = async (tarefa) => {
    if (!confirm("Excluir esta tarefa?")) return;
    try {
      await api.tarefas.remover({ id: tarefa.id });
      await recarregar();
    } catch (e) {
      setErro(e?.message || String(e));
    }
  };

  return (
    <>
      <CabecalhoTela
        titulo="Tarefas"
        busca={<CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar tarefas..." />}
        acao={
          <BotaoPrimario onClick={() => setEditando(null)}>
            <Plus size={18} strokeWidth={2.4} />
            Nova tarefa
          </BotaoPrimario>
        }
      />

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="flex flex-col gap-6">
          <div className="flex gap-4">
            <CartaoIndicador icone={CheckCircle2} rotulo="Abertas" valor={abertas.length.toLocaleString("pt-BR")} nota={atrasadas.length ? `${atrasadas.length} atrasada${atrasadas.length === 1 ? "" : "s"}` : "sem atrasos"} tomNota={atrasadas.length ? "danger" : "success"} />
            <CartaoIndicador icone={Clock3} rotulo="Para hoje" valor={hoje.length.toLocaleString("pt-BR")} nota="vencimentos de hoje" />
            <CartaoIndicador icone={CheckCircle2} rotulo="Concluídas" valor={concluidas.length.toLocaleString("pt-BR")} nota="histórico total" />
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-bg p-4">
            <Seletor valor={filtroStatus} aoMudar={setFiltroStatus} rotuloVazio="Todos os status" opcoes={FILTROS_STATUS} />
            <Seletor valor={filtroPrazo} aoMudar={setFiltroPrazo} rotuloVazio="Todos os prazos" opcoes={FILTROS_PRAZO} />
            <Seletor
              valor={filtroResponsavel}
              aoMudar={setFiltroResponsavel}
              rotuloVazio="Todos os responsáveis"
              opcoes={opcoesResponsavel}
            />
            <span className="ml-auto text-[13px] text-sub">{filtradas.length} tarefa{filtradas.length === 1 ? "" : "s"}</span>
          </div>

          {erro && <p className="rounded-[10px] bg-danger/10 px-4 py-3 text-[13px] text-danger">{erro}</p>}

          {tarefas.length === 0 ? (
            <EstadoVazio titulo="Nenhuma tarefa cadastrada" descricao="Crie uma tarefa para não perder o próximo passo de cada contato." />
          ) : filtradas.length === 0 ? (
            <EstadoVazio titulo="Nenhuma tarefa encontrada" descricao="Ajuste os filtros ou crie uma nova tarefa." />
          ) : (
            <div className="overflow-hidden rounded-[14px] border border-line bg-bg">
              <div className="hidden items-center gap-3 border-b border-line bg-surface px-4 py-2 text-[11px] font-medium text-sub sm:flex">
                <span className="w-[18px]" />
                <span className="flex-1">Tarefa</span>
                <span className="w-28">Vencimento</span>
                <span className="w-36">Responsáveis</span>
                <span className="w-16" />
              </div>
              {grupos.map(([id, titulo]) => {
                const itens = filtradas.filter((t) => grupoDaTarefa(t, agora) === id);
                if (!itens.length) return null;
                return (
                  <section key={id}>
                    <div className="border-b border-line bg-surface px-4 py-2 text-[12px] font-semibold text-sub">{titulo} <span className="font-normal text-faint">· {itens.length}</span></div>
                    {itens.map((tarefa) => (
                      <LinhaTarefa
                        key={tarefa.id}
                        tarefa={tarefa}
                        contato={contatosPorId[tarefa.contactId]}
                        negocio={negociosPorId[tarefa.dealId]}
                        responsaveis={nomesPorTarefa.get(tarefa.id) || []}
                        pendencias={pendenciasPorTarefa.get(tarefa.id) || []}
                        minhaResposta={usuarioId ? respostaDoResponsavel(tarefa, usuarioId) : null}
                        aoAlternar={alternar}
                        aoEditar={setEditando}
                        aoRemover={remover}
                        aoAbrirContato={aoAbrirContato}
                        aoAssumir={(item) => responder(item, true)}
                        aoRecusar={setRecusando}
                      />
                    ))}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {recusando && (
        <DialogoRecusa
          tarefa={recusando}
          aoFechar={() => setRecusando(null)}
          aoConfirmar={(motivo) => responder(recusando, false, motivo)}
        />
      )}

      {editando !== undefined && (
        <FormularioTarefa
          key={editando?.id || "novo"}
          tarefa={editando}
          contatoIdInicial={editando?.contactId}
          contatos={contatos}
          equipe={equipe}
          aoFechar={() => setEditando(undefined)}
          recarregar={recarregar}
        />
      )}
    </>
  );
}
