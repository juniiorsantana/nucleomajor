import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Pencil, Plus, Trash2 } from "lucide-react";
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
} from "./gestaoCompartilhados";

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

function FormularioTarefa({ tarefa, contatoIdInicial, contatos, negocios, aoFechar, recarregar }) {
  const contatoInicial = tarefa?.contactId || contatoIdInicial || contatos[0]?.id || "";
  const negociosDoContato = (contactId) => negocios.filter((n) => n.contactId === contactId);
  const [form, setForm] = useState(() => ({
    contactId: contatoInicial,
    dealId: tarefa?.dealId || "",
    titulo: tarefa?.titulo || "",
    venceEm: dataInput(tarefa?.venceEm),
    responsavel: tarefa?.responsavel || "",
  }));
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const deals = negociosDoContato(form.contactId);

  const alterar = (campo, valor) => setForm((atual) => ({ ...atual, [campo]: valor }));
  const alterarContato = (valor) =>
    setForm((atual) => ({
      ...atual,
      contactId: valor,
      dealId: negociosDoContato(valor).some((n) => n.id === atual.dealId) ? atual.dealId : "",
    }));

  const enviar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const dados = {
        contactId: form.contactId,
        dealId: form.dealId || null,
        titulo: form.titulo.trim(),
        venceEm: dataParaTimestamp(form.venceEm),
        responsavel: form.responsavel.trim(),
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
          <CampoFormulario rotulo="Contato" className="col-span-2">
            <select
              required
              value={form.contactId}
              onChange={(e) => alterarContato(e.target.value)}
              className={`${ENTRADA_GESTAO} cursor-pointer`}
            >
              <option value="">Selecione um contato</option>
              {contatos
                .slice()
                .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.nome || "Sem nome"}</option>
                ))}
            </select>
          </CampoFormulario>
          <CampoFormulario rotulo="Negócio relacionado">
            <select
              value={form.dealId}
              onChange={(e) => alterar("dealId", e.target.value)}
              className={`${ENTRADA_GESTAO} cursor-pointer`}
            >
              <option value="">Nenhum</option>
              {deals.map((n) => <option key={n.id} value={n.id}>{n.titulo || "Sem título"}</option>)}
            </select>
          </CampoFormulario>
          <CampoFormulario rotulo="Vencimento">
            <input
              type="date"
              value={form.venceEm}
              onChange={(e) => alterar("venceEm", e.target.value)}
              className={ENTRADA_GESTAO}
            />
          </CampoFormulario>
          <CampoFormulario rotulo="Responsável" className="col-span-2">
            <input
              value={form.responsavel}
              onChange={(e) => alterar("responsavel", e.target.value)}
              className={ENTRADA_GESTAO}
              placeholder="Quem ficará responsável?"
            />
          </CampoFormulario>
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

function LinhaTarefa({ tarefa, contato, negocio, aoAlternar, aoEditar, aoRemover, aoAbrirContato }) {
  const vencimento = fmtVencimento(tarefa.venceEm);
  const tons = { faint: "text-faint", sub: "text-sub", warning: "text-warning", danger: "text-danger" };
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <Caixa marcada={tarefa.concluida} aoMudar={() => aoAlternar(tarefa)} titulo={tarefa.concluida ? "Reabrir tarefa" : "Concluir tarefa"} />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[13.5px] ${tarefa.concluida ? "text-faint line-through" : "font-medium text-fg"}`}>
          {tarefa.titulo || "Sem título"}
        </p>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[11.5px] text-sub">
          <button
            type="button"
            onClick={() => aoAbrirContato?.(contato)}
            className="flex min-w-0 cursor-pointer items-center gap-1.5 truncate hover:text-accent-forte"
          >
            <Iniciais nome={contato?.nome} tamanho={19} />
            <span className="truncate">{contato?.nome || "Contato sem nome"}</span>
          </button>
          {negocio && <><span>·</span><span className="truncate">{negocio.titulo}</span></>}
        </div>
      </div>
      <div className="hidden w-28 flex-none text-[11.5px] sm:block">
        <span className={tarefa.concluida ? "text-faint" : tons[vencimento.tom]}>
          {tarefa.concluida ? "Concluída" : vencimento.texto}
        </span>
      </div>
      <span className="hidden w-28 truncate text-[11.5px] text-sub md:block">{tarefa.responsavel || "—"}</span>
      <button type="button" onClick={() => aoEditar(tarefa)} title="Editar tarefa" className="cursor-pointer rounded-[7px] p-1.5 text-sub hover:bg-surface-hover hover:text-fg">
        <Pencil size={14} />
      </button>
      <button type="button" onClick={() => aoRemover(tarefa)} title="Excluir tarefa" className="cursor-pointer rounded-[7px] p-1.5 text-sub hover:bg-danger/10 hover:text-danger">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export default function Tarefas({ dados, recarregar, aoAbrirContato, comando, aoConsumirComando }) {
  const { contatos, negocios, tarefas } = dados;
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("abertas");
  const [filtroPrazo, setFiltroPrazo] = useState("");
  const [filtroResponsavel, setFiltroResponsavel] = useState("");
  const [editando, setEditando] = useState(undefined);
  const [erro, setErro] = useState(null);
  const agora = Date.now();

  useEffect(() => {
    if (!comando) return;
    if (comando.tipo === "nova-tarefa") setEditando({ contactId: comando.contatoId });
    if (comando.tipo === "editar-tarefa") setEditando(comando.item);
    if (comando.tipo === "nova-tarefa" || comando.tipo === "editar-tarefa") aoConsumirComando?.();
  }, [aoConsumirComando, comando]);

  const responsaveis = useMemo(
    () => [...new Set(tarefas.map((t) => t.responsavel).filter(Boolean))].sort(),
    [tarefas]
  );
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
        if (filtroResponsavel && t.responsavel !== filtroResponsavel) return false;
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
              opcoes={responsaveis.map((r) => ({ id: r, rotulo: r }))}
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
                <span className="w-28">Responsável</span>
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
                        aoAlternar={alternar}
                        aoEditar={setEditando}
                        aoRemover={remover}
                        aoAbrirContato={aoAbrirContato}
                      />
                    ))}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {editando !== undefined && (
        <FormularioTarefa
          key={editando?.id || "novo"}
          tarefa={editando}
          contatoIdInicial={editando?.contactId}
          contatos={contatos}
          negocios={negocios}
          aoFechar={() => setEditando(undefined)}
          recarregar={recarregar}
        />
      )}
    </>
  );
}
