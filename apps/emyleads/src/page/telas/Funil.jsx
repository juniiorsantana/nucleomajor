import { useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  CalendarDays,
  Check,
  CircleDollarSign,
  Filter,
  Inbox,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
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
  StatusNegocio,
  Valor,
  valorInput,
} from "./gestaoCompartilhados";

function ResumoFunilCompacto({ abertos, ganhos, total }) {
  const valorAberto = abertos.reduce((s, n) => s + (n.valor || 0), 0);
  const valorGanho = ganhos.reduce((s, n) => s + (n.valor || 0), 0);
  const conversao = total ? Math.round((ganhos.length / total) * 100) : 0;
  const itens = [
    { rotulo: "Em andamento", valor: abertos.length.toLocaleString("pt-BR"), detalhe: `${abertos.length === 1 ? "neg\u00f3cio" : "neg\u00f3cios"}`, Icone: Briefcase, tom: "accent" },
    { rotulo: "Valor do pipeline", valor: fmtMoeda(valorAberto) || "R$ 0", detalhe: "neg\u00f3cios abertos", Icone: CircleDollarSign, tom: "neutral" },
    { rotulo: "Ganhos", valor: ganhos.length.toLocaleString("pt-BR"), detalhe: `${fmtMoeda(valorGanho) || "R$ 0"} convertido`, Icone: TrendingUp, tom: "success" },
    { rotulo: "Convers\u00e3o", valor: `${conversao}%`, detalhe: `de ${total} neg\u00f3cios`, Icone: Filter, tom: "accent" },
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

const STATUS = [
  { id: "aberto", rotulo: "Abertos" },
  { id: "ganho", rotulo: "Ganhos" },
  { id: "perdido", rotulo: "Perdidos" },
];

function ResumoFunil({ abertos, ganhos }) {
  const valorAberto = abertos.reduce((s, n) => s + (n.valor || 0), 0);
  const valorGanho = ganhos.reduce((s, n) => s + (n.valor || 0), 0);
  const itens = [
    ["Em andamento", abertos.length.toLocaleString("pt-BR"), `${fmtMoeda(valorAberto) || "R$ 0"} no pipeline`, "accent"],
    ["Valor do pipeline", fmtMoeda(valorAberto) || "R$ 0", "negócios abertos", "neutral"],
    ["Ganhos", ganhos.length.toLocaleString("pt-BR"), `${fmtMoeda(valorGanho) || "R$ 0"} convertido`, "success"],
  ];

  return (
    <div className="grid overflow-hidden rounded-[12px] border border-line bg-line sm:grid-cols-3">
      {itens.map(([rotulo, valor, detalhe, tom]) => (
        <div key={rotulo} className="bg-bg px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${tom === "accent" ? "bg-accent" : tom === "success" ? "bg-success" : "bg-line-strong"}`} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-sub">{rotulo}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <strong className="text-[21px] font-semibold leading-none tracking-tight text-fg">{valor}</strong>
            <span className="truncate text-[11px] text-faint">{detalhe}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function FormularioNegocio({ negocio, contatos, estagios, origens, aoFechar, recarregar }) {
  const vazio = {
    contactId: negocio?.contactId || contatos[0]?.id || "",
    titulo: "",
    valor: "",
    stageId: estagios[0]?.id || "",
    origem: "",
    status: "aberto",
    motivoPerda: "",
  };
  const [form, setForm] = useState(() => ({
    ...vazio,
    ...(negocio
      ? {
          contactId: negocio.contactId,
          titulo: negocio.titulo,
          valor: valorInput(negocio.valor),
          stageId: negocio.stageId,
          origem: negocio.origem,
          status: negocio.status,
          motivoPerda: negocio.motivoPerda || "",
        }
      : {}),
  }));
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const alterar = (campo, valor) => setForm((atual) => ({ ...atual, [campo]: valor }));

  const enviar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const dados = {
        contactId: form.contactId,
        titulo: form.titulo.trim(),
        valor: parseValor(form.valor),
        stageId: form.stageId,
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
          <CampoFormulario rotulo="Contato" className="col-span-2">
            <select
              required
              value={form.contactId}
              onChange={(e) => alterar("contactId", e.target.value)}
              className={`${ENTRADA_GESTAO} cursor-pointer`}
            >
              <option value="">Selecione um contato</option>
              {contatos
                .slice()
                .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome || "Sem nome"}
                    {c.empresa ? ` · ${c.empresa}` : ""}
                  </option>
                ))}
            </select>
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
          <CampoFormulario rotulo="Estágio">
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
          <CampoFormulario rotulo="Origem">
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
          <CampoFormulario rotulo="Status">
            <select
              value={form.status}
              onChange={(e) => alterar("status", e.target.value)}
              className={`${ENTRADA_GESTAO} cursor-pointer`}
            >
              <option value="aberto">Aberto</option>
              <option value="ganho">Ganho</option>
              <option value="perdido">Perdido</option>
            </select>
          </CampoFormulario>
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

function CardNegocio({ negocio, contato, estagios, aoEditar, aoMover, aoGanhar, aoPerder, aoAbrirContato }) {
  return (
    <article
      onClick={() => aoEditar(negocio)}
      className="group cursor-pointer rounded-[9px] border border-line bg-bg p-2.5 shadow-[0_1px_2px_rgba(18,23,48,0.03)] transition-shadow hover:shadow-md"
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
            <span className="truncate">{contato?.nome || "Contato sem nome"}</span>
          </button>
        </div>
        <StatusNegocio status={negocio.status} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-faint">
        <span className="flex min-w-0 items-center gap-1 truncate">
          <Inbox size={11} strokeWidth={1.8} />
          {negocio.origem || "Sem origem"}
        </span>
        <span className="flex flex-none items-center gap-1">
          <CalendarDays size={11} strokeWidth={1.8} />
          {fmtData(negocio.atualizadoEm)}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1 border-t border-line pt-2">
        <span className="mr-auto text-[11px] font-semibold text-fg"><Valor valor={negocio.valor} /></span>
        <select
          value={negocio.stageId}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => aoMover(negocio, e.target.value)}
          className="max-w-[82px] cursor-pointer rounded-[6px] border border-line bg-bg px-1.5 py-1 text-[10px] text-sub outline-none focus:border-accent"
          aria-label={`Mover ${negocio.titulo || "negócio"}`}
        >
          {estagios.map((estagio) => (
            <option key={estagio.id} value={estagio.id}>{estagio.nome}</option>
          ))}
        </select>
        {negocio.status === "aberto" && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                aoGanhar(negocio);
              }}
              title="Marcar como ganho"
              className="cursor-pointer rounded-[6px] p-1 text-success hover:bg-success-soft"
            >
              <Check size={13} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                aoPerder(negocio);
              }}
              title="Marcar como perdido"
              className="cursor-pointer rounded-[6px] p-1 text-danger hover:bg-danger/10"
            >
              <X size={13} strokeWidth={2.2} />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            aoEditar(negocio);
          }}
          title="Editar negócio"
          className="cursor-pointer rounded-[7px] p-1 text-sub hover:bg-surface-hover hover:text-fg"
        >
          <Pencil size={13} />
        </button>
      </div>
    </article>
  );
}

export default function Funil({ dados, recarregar, aoAbrirContato, comando, aoConsumirComando }) {
  const { contatos, negocios, estagios } = dados;
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("aberto");
  const [filtroOrigem, setFiltroOrigem] = useState("");
  const [filtroResponsavel, setFiltroResponsavel] = useState("");
  const [editando, setEditando] = useState(undefined);
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
  const estagiosOrdenados = useMemo(
    () => estagios.slice().sort((a, b) => a.ordem - b.ordem),
    [estagios]
  );
  const origens = useMemo(
    () => [...new Set(negocios.map((n) => n.origem).filter(Boolean))].sort(),
    [negocios]
  );
  const responsaveis = useMemo(
    () => [...new Set(contatos.map((c) => c.responsavel).filter(Boolean))].sort(),
    [contatos]
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return negocios
      .filter((n) => {
        const contato = contatosPorId[n.contactId];
        if (filtroStatus && n.status !== filtroStatus) return false;
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
  }, [busca, contatos, contatosPorId, filtroOrigem, filtroResponsavel, filtroStatus, negocios]);

  const abertos = negocios.filter((n) => n.status === "aberto");
  const ganhos = negocios.filter((n) => n.status === "ganho");

  const mover = async (negocio, stageId) => {
    try {
      await api.negocios.atualizar({ id: negocio.id, patch: { stageId } });
      await recarregar();
    } catch (e) {
      setErro(e?.message || String(e));
    }
  };

  const ganhar = async (negocio) => {
    try {
      await api.negocios.atualizar({ id: negocio.id, patch: { status: "ganho" } });
      await recarregar();
    } catch (e) {
      setErro(e?.message || String(e));
    }
  };

  const perder = (negocio) => setEditando({ ...negocio, status: "perdido" });

  return (
    <>
      <CabecalhoTela
        titulo="Funil"
        busca={<CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar negócios..." />}
        acao={
          <BotaoPrimario onClick={() => setEditando(null)}>
            <Plus size={18} strokeWidth={2.4} />
            Novo negócio
          </BotaoPrimario>
        }
      />

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-5 py-3">
        <div className="flex flex-col gap-3">
          <ResumoFunilCompacto abertos={abertos} ganhos={ganhos} total={negocios.length} />

          <div className="flex flex-wrap items-center gap-1.5 rounded-[9px] border border-line bg-bg px-2 py-1.5">
            <span className="mr-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
              <Filter size={12} strokeWidth={1.8} />
              Filtros
            </span>
            <Seletor compacto valor={filtroStatus} aoMudar={setFiltroStatus} rotuloVazio="Todos os status" opcoes={STATUS} />
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
            <span className="ml-auto text-[11px] text-sub">
              {filtrados.length} negócio{filtrados.length === 1 ? "" : "s"}
            </span>
            <span className="ml-1 flex items-center gap-0.5 border-l border-line pl-1">
              <button type="button" title="Visualização em kanban" className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-accent-soft text-accent-forte">
                <LayoutGrid size={13} strokeWidth={2} />
              </button>
              <button type="button" title="Lista em breve" disabled className="flex h-6 w-6 cursor-not-allowed items-center justify-center rounded-[6px] text-faint opacity-60">
                <List size={14} strokeWidth={2} />
              </button>
            </span>
          </div>

          {erro && <p className="rounded-[10px] bg-danger/10 px-4 py-3 text-[13px] text-danger">{erro}</p>}

          {negocios.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum negócio cadastrado"
              descricao="Crie a primeira oportunidade para começar a acompanhar seu pipeline."
            />
          ) : (
            <div className="scrollbar-fina flex min-h-[calc(100vh-300px)] gap-2 overflow-x-auto pb-2">
              {estagiosOrdenados.map((estagio) => {
                const daColuna = filtrados.filter((n) => n.stageId === estagio.id);
                return (
                  <section key={estagio.id} className="flex min-h-[390px] min-w-[214px] flex-1 flex-col rounded-[10px] border border-line bg-bg p-2.5">
                    <div className="mb-2.5 flex items-center gap-2 border-b border-line px-0.5 pb-2">
                      <h2 className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-fg">{estagio.nome}</h2>
                      <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-forte">{daColuna.length}</span>
                      <button type="button" title={`Ações de ${estagio.nome}`} className="flex h-5 w-5 items-center justify-center rounded-[5px] text-faint hover:bg-surface-hover hover:text-fg">
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                    <div className="flex flex-1 flex-col gap-2">
                      {daColuna.map((negocio) => (
                        <CardNegocio
                          key={negocio.id}
                          negocio={negocio}
                          contato={contatosPorId[negocio.contactId]}
                          estagios={estagiosOrdenados}
                          aoEditar={setEditando}
                          aoMover={mover}
                          aoGanhar={ganhar}
                          aoPerder={perder}
                          aoAbrirContato={aoAbrirContato}
                        />
                      ))}
                      {daColuna.length === 0 && <p className="px-2 py-8 text-center text-[12px] text-faint">Nenhum negócio</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {editando !== undefined && (
        <FormularioNegocio
          key={editando?.id || "novo"}
          negocio={editando}
          contatos={contatos}
          estagios={estagiosOrdenados}
          origens={origens}
          aoFechar={() => setEditando(undefined)}
          recarregar={recarregar}
        />
      )}
    </>
  );
}
