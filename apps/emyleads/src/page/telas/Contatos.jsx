import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDollarSign,
  Download,
  MoreVertical,
  Plus,
  SlidersHorizontal,
  Users,
  Wallet,
} from "lucide-react";
import { api } from "../../data/client";
import { corDoEstagio } from "../../domain/types";
import { fmtInteracao, fmtMoeda } from "../../lib/formato";
import { formatPhone } from "../../lib/phone";
import {
  BotaoPrimario,
  CabecalhoTela,
  CampoBusca,
  CartaoIndicador,
  Caixa,
  Iniciais,
  Paginacao,
  PilulaEstagio,
  SeloWhatsApp,
  Seletor,
} from "../ui";

const POR_PAGINA = 25;
const SEMANA = 7 * 24 * 60 * 60 * 1000;

/**
 * Contatos — a visão de carteira.
 *
 * O painel dentro do WhatsApp responde "quem é essa pessoa"; esta tela
 * responde "como está o conjunto". São perguntas diferentes e por isso a
 * densidade também é: aqui cabe respiro, lá não cabia.
 */
export default function Contatos({ dados, recarregar, aoAbrirContato }) {
  const { contatos, negocios, tarefas, estagios } = dados;

  const [busca, setBusca] = useState("");
  const [filtroEstagio, setFiltroEstagio] = useState("");
  const [filtroOrigem, setFiltroOrigem] = useState("");
  const [filtroResponsavel, setFiltroResponsavel] = useState("");
  const [maisFiltros, setMaisFiltros] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [marcados, setMarcados] = useState(() => new Set());

  /* --- derivações ------------------------------------------------- */

  const estagioPorId = useMemo(
    () => Object.fromEntries(estagios.map((e) => [e.id, e])),
    [estagios],
  );

  /**
   * Estágio exibido na linha do contato.
   *
   * Derivado, não guardado: o estágio pertence ao NEGÓCIO no modelo de dados,
   * porque um contato pode ter mais de uma oportunidade. Mostrar na linha é
   * conveniência de leitura — duplicar o campo criaria duas verdades.
   */
  const estagioDoContato = useMemo(() => {
    const mapa = {};
    for (const n of negocios) {
      const atual = mapa[n.contactId];
      const prefere =
        !atual ||
        (atual.status !== "aberto" && n.status === "aberto") ||
        (atual.status === n.status && n.criadoEm > atual.criadoEm);
      if (prefere) mapa[n.contactId] = n;
    }
    return Object.fromEntries(
      Object.entries(mapa).map(([id, n]) => [
        id,
        estagioPorId[n.stageId] || null,
      ]),
    );
  }, [negocios, estagioPorId]);

  const origens = useMemo(
    () =>
      [...new Set(contatos.map((c) => c.origem).filter(Boolean))]
        .sort()
        .map((o) => ({ id: o, rotulo: o })),
    [contatos],
  );

  const responsaveis = useMemo(
    () =>
      [...new Set(contatos.map((c) => c.responsavel).filter(Boolean))]
        .sort()
        .map((r) => ({ id: r, rotulo: r })),
    [contatos],
  );

  /**
   * Mais recente primeiro. Ordem de inserção é ordem nenhuma — numa carteira
   * de contatos, quem falou com você agora tem que estar no topo, senão a
   * primeira tela é sempre aleatória.
   */
  const recencia = (c) => c.ultimaEm ?? c.atualizadoEm ?? c.criadoEm ?? 0;

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const digitos = q.replace(/\D/g, "");
    return contatos
      .slice()
      .sort((a, b) => recencia(b) - recencia(a))
      .filter((c) => {
        if (filtroOrigem && c.origem !== filtroOrigem) return false;
        if (filtroResponsavel && c.responsavel !== filtroResponsavel)
          return false;
        if (filtroEstagio && estagioDoContato[c.id]?.id !== filtroEstagio)
          return false;
        if (!q) return true;
        return (
          c.nome.toLowerCase().includes(q) ||
          (c.empresa || "").toLowerCase().includes(q) ||
          (digitos && (c.telefone || "").includes(digitos))
        );
      });
  }, [
    contatos,
    busca,
    filtroOrigem,
    filtroResponsavel,
    filtroEstagio,
    estagioDoContato,
  ]);

  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const pAtual = Math.min(pagina, paginas);
  const visiveis = filtrados.slice(
    (pAtual - 1) * POR_PAGINA,
    pAtual * POR_PAGINA,
  );

  useEffect(
    () => setPagina(1),
    [busca, filtroEstagio, filtroOrigem, filtroResponsavel],
  );

  /* --- indicadores ------------------------------------------------ */

  const agora = Date.now();
  const abertos = negocios.filter((n) => n.status === "aberto");
  const indicadores = [
    {
      icone: Users,
      rotulo: "Contatos",
      valor: contatos.length.toLocaleString("pt-BR"),
      nota: (() => {
        const n = contatos.filter((c) => agora - c.criadoEm < SEMANA).length;
        return n ? `${n} nesta semana` : null;
      })(),
    },
    {
      icone: CircleDollarSign,
      rotulo: "Negócios abertos",
      valor: abertos.length.toLocaleString("pt-BR"),
      nota: (() => {
        const n = negocios.filter((d) => d.status === "ganho").length;
        return n ? `${n} ganho${n === 1 ? "" : "s"}` : null;
      })(),
    },
    {
      icone: Wallet,
      rotulo: "Em aberto",
      valor:
        fmtMoeda(abertos.reduce((s, n) => s + (n.valor || 0), 0)) || "R$ 0",
      nota: (() => {
        const v = negocios
          .filter((d) => d.status === "ganho")
          .reduce((s, n) => s + (n.valor || 0), 0);
        return v ? `${fmtMoeda(v)} ganho` : null;
      })(),
    },
    (() => {
      const atrasadas = tarefas.filter(
        (t) => !t.concluida && t.venceEm != null && t.venceEm < agora,
      ).length;
      return {
        icone: CheckCircle2,
        rotulo: "Tarefas abertas",
        valor: tarefas
          .filter((t) => !t.concluida)
          .length.toLocaleString("pt-BR"),
        nota: atrasadas
          ? `${atrasadas} atrasada${atrasadas === 1 ? "" : "s"}`
          : null,
        tomNota: "danger",
      };
    })(),
  ];

  /* --- ações ------------------------------------------------------ */

  const temFiltro = busca || filtroEstagio || filtroOrigem || filtroResponsavel;
  const limpar = () => {
    setBusca("");
    setFiltroEstagio("");
    setFiltroOrigem("");
    setFiltroResponsavel("");
  };

  const exportar = async () => {
    const pacote = await api.dados.exportar();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(pacote, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `emyleads-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const removerMarcados = async () => {
    if (
      !confirm(
        `Excluir ${marcados.size} contato(s)? Negócios, tarefas e notas vão junto.`,
      )
    )
      return;
    for (const id of marcados) await api.contatos.remover({ id });
    setMarcados(new Set());
    await recarregar();
  };

  const todosMarcados =
    visiveis.length > 0 && visiveis.every((c) => marcados.has(c.id));
  const alternarTodos = () =>
    setMarcados((s) => {
      const n = new Set(s);
      visiveis.forEach((c) => (todosMarcados ? n.delete(c.id) : n.add(c.id)));
      return n;
    });

  const Cabecalho = ({ children, className = "" }) => (
    <th
      className={`px-4 py-3 text-left text-[12.5px] font-medium text-sub ${className}`}
    >
      {children}
    </th>
  );

  return (
    <>
      <CabecalhoTela
        titulo="Contatos"
        busca={
          <CampoBusca
            valor={busca}
            aoMudar={setBusca}
            placeholder="Buscar contatos..."
          />
        }
        acao={
          <BotaoPrimario onClick={() => aoAbrirContato?.()}>
            <Plus size={18} strokeWidth={2.4} />
            Adicionar contato
          </BotaoPrimario>
        }
      />

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <h2 className="mb-4 text-[19px] font-semibold tracking-tight text-fg">
          Visão geral
        </h2>

        <div className="flex gap-4">
          {indicadores.map((i) => (
            <CartaoIndicador key={i.rotulo} {...i} />
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-bg p-4">
          <Seletor
            valor={filtroEstagio}
            aoMudar={setFiltroEstagio}
            rotuloVazio="Todos os status"
            opcoes={estagios.map((e) => ({ id: e.id, rotulo: e.nome }))}
          />
          <Seletor
            valor={filtroOrigem}
            aoMudar={setFiltroOrigem}
            rotuloVazio="Origem"
            opcoes={origens}
          />
          <Seletor
            valor={filtroResponsavel}
            aoMudar={setFiltroResponsavel}
            rotuloVazio="Responsável"
            opcoes={responsaveis}
          />
          <button
            onClick={() => setMaisFiltros(!maisFiltros)}
            className={`flex cursor-pointer items-center gap-2 rounded-[10px] border px-4 py-2.5 text-[13.5px] font-medium transition-colors ${
              maisFiltros
                ? "border-accent text-accent-forte"
                : "border-line text-sub hover:border-line-strong hover:text-fg"
            }`}
          >
            <SlidersHorizontal size={16} />
            Mais filtros
          </button>

          <div className="ml-auto flex items-center gap-3">
            {marcados.size > 0 && (
              <button
                onClick={removerMarcados}
                className="cursor-pointer text-[13.5px] font-medium text-danger hover:underline"
              >
                Excluir {marcados.size}
              </button>
            )}
            {temFiltro && (
              <button
                onClick={limpar}
                className="cursor-pointer text-[13.5px] font-medium text-accent-forte hover:underline"
              >
                Limpar filtros
              </button>
            )}
            <button
              onClick={exportar}
              className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-line px-4 py-2.5 text-[13.5px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg"
            >
              <Download size={16} />
              Exportar
            </button>
          </div>

          {maisFiltros && (
            <p className="w-full border-t border-line pt-3 text-[12.5px] text-faint">
              Filtro por tag entra quando a tela de Configurações permitir
              gerenciá-las.
            </p>
          )}
        </div>

        <div className="mt-6 overflow-hidden rounded-[14px] border border-line bg-bg">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <Cabecalho className="w-12">
                  <Caixa
                    marcada={todosMarcados}
                    aoMudar={alternarTodos}
                    titulo="Selecionar página"
                  />
                </Cabecalho>
                <Cabecalho>Nome</Cabecalho>
                <Cabecalho>Telefone</Cabecalho>
                <Cabecalho>Status</Cabecalho>
                <Cabecalho>Origem</Cabecalho>
                <Cabecalho>Responsável</Cabecalho>
                <Cabecalho>Última interação</Cabecalho>
                <Cabecalho className="w-24 text-right">Ações</Cabecalho>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c) => {
                const estagio = estagioDoContato[c.id];
                return (
                  <tr
                    key={c.id}
                    className="border-b border-line last:border-b-0 transition-colors hover:bg-surface-hover"
                  >
                    <td className="px-4 py-3">
                      <Caixa
                        marcada={marcados.has(c.id)}
                        aoMudar={() =>
                          setMarcados((s) => {
                            const n = new Set(s);
                            n.has(c.id) ? n.delete(c.id) : n.add(c.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => aoAbrirContato?.(c)}
                        className="flex cursor-pointer items-center gap-3 text-left"
                      >
                        <Iniciais nome={c.nome} />
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-medium text-fg hover:text-accent-forte">
                            {c.nome || "Sem nome"}
                          </div>
                          {c.empresa && (
                            <div className="truncate text-[12.5px] text-sub">
                              {c.empresa}
                            </div>
                          )}
                        </div>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] text-fg">
                          {c.telefone ? formatPhone(c.telefone) : "—"}
                        </span>
                        {c.telefone && <SeloWhatsApp />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <PilulaEstagio
                        nome={estagio?.nome}
                        cor={corDoEstagio(estagio?.ordem)}
                      />
                    </td>
                    <td className="px-4 py-3 text-[13.5px] text-sub">
                      {c.origem || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {c.responsavel ? (
                        <div className="flex items-center gap-2">
                          <Iniciais nome={c.responsavel} tamanho={26} />
                          <span className="text-[13.5px] text-fg">
                            {c.responsavel}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[13.5px] text-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[13.5px] text-sub">
                      {fmtInteracao(c.ultimaEm ?? c.atualizadoEm)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          title="Mais ações"
                          onClick={() => aoAbrirContato?.(c)}
                          className="cursor-pointer rounded-[8px] p-1.5 text-sub transition-colors hover:bg-surface-hover hover:text-fg"
                        >
                          <MoreVertical size={17} strokeWidth={1.75} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {visiveis.length === 0 && (
            <p className="px-4 py-16 text-center text-[14px] text-sub">
              {contatos.length === 0
                ? "Nenhum contato ainda. Importe do WhatsApp pelo painel, dentro de uma conversa."
                : "Nenhum contato bate com os filtros."}
            </p>
          )}

          {filtrados.length > 0 && (
            <div className="flex items-center gap-4 border-t border-line px-4 py-3">
              <span className="text-[13.5px] text-sub">
                Mostrando {(pAtual - 1) * POR_PAGINA + 1} a{" "}
                {Math.min(pAtual * POR_PAGINA, filtrados.length)} de{" "}
                {filtrados.length} contatos
              </span>
              <div className="ml-auto">
                <Paginacao pagina={pAtual} paginas={paginas} aoIr={setPagina} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
