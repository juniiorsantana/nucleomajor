import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Clock3, Megaphone, MessageCircle, MessageCircleOff, Plus, Sparkles, Users } from "lucide-react";
import { api } from "../../data/client";
import { formatPhone } from "../../lib/phone";
import { BotaoPrimario, CabecalhoTela } from "../ui";
import IaDaCampanha from "./campanhas/IaDaCampanha";
import {
  ROTULOS_DO_STATUS,
  fluxoDaCampanha,
  resumoDaCampanha,
  textoDaPrimeiraMensagem,
} from "./campanhas/resumoDaCampanha";
import { SITUACOES } from "./leads/conversaDoLead";
import { AvatarDoLead, SituacaoDaConversa } from "./leads/pecas";
import { useConversasDosLeads } from "./leads/useConversasDosLeads";

/**
 * Campanhas — um lugar só para elas.
 *
 * Antes a campanha morava dentro da Central de Inteligência, e quem não tinha
 * IA (o plano Base) não via nem a do formulário do Meta, que roda sem IA.
 * Aqui fica o que vale para todo plano — quem entrou, quem respondeu, qual
 * mensagem sai primeiro — e, para quem tem Inteligência, o bloco "IA da
 * campanha" na mesma página.
 */

const TOM_DO_STATUS = {
  active: "bg-success-soft text-success",
  test: "bg-accent-soft text-accent-forte",
};

function PilulaStatus({ status }) {
  return (
    <span className={`flex-none rounded-full px-2 py-0.5 text-[11.5px] font-medium ${TOM_DO_STATUS[status] || "bg-surface text-sub"}`}>
      {ROTULOS_DO_STATUS[status] || status}
    </span>
  );
}

const fmtChegada = (ms) =>
  ms ? new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function Numero({ icone: Icone, rotulo, valor, ativo, aoClicar }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-pressed={ativo}
      className={`flex min-w-0 flex-1 cursor-pointer flex-col gap-1 rounded-none border px-4 py-3 text-left transition-colors ${
        ativo ? "border-accent bg-accent-soft" : "border-line bg-bg hover:border-line-strong"
      }`}
    >
      <span className="flex items-center gap-1.5 text-[12.5px] text-sub">
        <Icone size={14} strokeWidth={1.8} />
        {rotulo}
      </span>
      <strong className="text-[22px] font-semibold tracking-tight text-fg">{valor}</strong>
    </button>
  );
}

function PrimeiraMensagem({ fluxo, aoAbrirChatbots }) {
  const texto = textoDaPrimeiraMensagem(fluxo);
  if (!fluxo) {
    return (
      <p className="rounded-ctl border border-dashed border-line px-4 py-3 text-[13px] text-sub">
        Nenhum fluxo manda mensagem automática para quem entra por esta campanha.
      </p>
    );
  }
  return (
    <div className="rounded-none border border-line bg-bg p-4">
      <div className="flex items-center gap-2 text-[12.5px] text-sub">
        <Bot size={15} strokeWidth={1.8} />
        <span className="min-w-0 flex-1 truncate">
          Enviada na hora pelo fluxo <strong className="font-medium text-fg">{fluxo.nome}</strong>
        </span>
        {aoAbrirChatbots && (
          <button type="button" onClick={aoAbrirChatbots} className="flex-none cursor-pointer font-medium text-accent-forte hover:underline">
            Ver em Fluxos
          </button>
        )}
      </div>
      {texto && (
        <div className="mt-3 flex justify-end">
          <p className="max-w-[520px] whitespace-pre-wrap rounded-none bg-accent-soft px-3.5 py-2.5 text-[13.5px] leading-[20px] text-fg">
            {texto.replaceAll("{nome}", "Maria")}
          </p>
        </div>
      )}
      {texto?.includes("{nome}") && (
        <p className="mt-2 text-right text-[11.5px] text-faint">“Maria” é o exemplo: sai o primeiro nome de cada lead.</p>
      )}
    </div>
  );
}

const FILTROS = {
  [SITUACOES.respondeu]: "Responderam",
  [SITUACOES.aguardando]: "Aguardando resposta",
  [SITUACOES.semConversa]: "Sem conversa",
};

function Detalhe({ campanha, dados, indice, temInteligencia, podeEditar, aoAbrirContato, aoAbrirConversa, aoAbrirChatbots, aoSalvarIa }) {
  const [filtro, setFiltro] = useState("");
  useEffect(() => setFiltro(""), [campanha.id]);

  const resumo = useMemo(
    () => resumoDaCampanha(campanha, dados.contatos, indice),
    [campanha, dados.contatos, indice],
  );
  const fluxo = fluxoDaCampanha(dados.chatbots, campanha.id);
  const linhas = filtro ? resumo.linhas.filter((linha) => linha.situacao === filtro) : resumo.linhas;
  const alternar = (situacao) => setFiltro((atual) => (atual === situacao ? "" : situacao));

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-tight text-fg">{campanha.nome}</h2>
        <PilulaStatus status={campanha.status} />
        {campanha.criadaEm && (
          <span className="text-[12.5px] text-faint">criada em {new Date(campanha.criadaEm).toLocaleDateString("pt-BR")}</span>
        )}
      </header>

      <div className="flex flex-wrap gap-3">
        <Numero icone={Users} rotulo={resumo.nestaSemana ? `Leads · ${resumo.nestaSemana} nesta semana` : "Leads"} valor={resumo.total} ativo={!filtro} aoClicar={() => setFiltro("")} />
        <Numero icone={MessageCircle} rotulo="Responderam" valor={resumo.respondeu} ativo={filtro === SITUACOES.respondeu} aoClicar={() => alternar(SITUACOES.respondeu)} />
        <Numero icone={Clock3} rotulo="Aguardando resposta" valor={resumo.aguardando} ativo={filtro === SITUACOES.aguardando} aoClicar={() => alternar(SITUACOES.aguardando)} />
        <Numero icone={MessageCircleOff} rotulo="Sem conversa" valor={resumo.semConversa} ativo={filtro === SITUACOES.semConversa} aoClicar={() => alternar(SITUACOES.semConversa)} />
      </div>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-fg">Primeira mensagem</h3>
        <PrimeiraMensagem fluxo={fluxo} aoAbrirChatbots={aoAbrirChatbots} />
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-fg">
          {filtro ? `${FILTROS[filtro]} · ${linhas.length}` : `Leads da campanha · ${resumo.total}`}
        </h3>
        <div className="overflow-hidden rounded-none border border-line bg-bg">
          {linhas.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13.5px] text-sub">
              {resumo.total === 0 ? "Ninguém entrou por esta campanha ainda." : "Nenhum lead nesta situação."}
            </p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line text-left text-[12.5px] text-sub">
                  <th className="px-4 py-3 font-medium">Lead</th>
                  <th className="px-4 py-3 font-medium">Chegou</th>
                  <th className="px-4 py-3 font-medium">Conversa</th>
                  <th className="w-16 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {linhas.map(({ lead, contato, conversa }) => (
                  <tr key={`${lead.contactId || lead.telefone}-${lead.chegouEm}`} className="border-b border-line last:border-b-0 hover:bg-surface-hover">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={!contato.id}
                        onClick={() => contato.id && aoAbrirContato?.(contato)}
                        className="flex min-w-0 cursor-pointer items-center gap-3 text-left disabled:cursor-default"
                      >
                        <AvatarDoLead contato={contato} conversa={conversa} tamanho={32} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-medium text-fg">
                            {contato.nome || conversa?.nome || "Sem nome"}
                          </span>
                          <span className="block truncate text-[12px] text-sub">
                            {formatPhone(contato.telefone || lead.telefone)}
                            {lead.envios > 1 && ` · enviou ${lead.envios} vezes`}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-sub">{fmtChegada(lead.chegouEm)}</td>
                    <td className="px-4 py-3"><SituacaoDaConversa conversa={conversa} /></td>
                    <td className="px-4 py-3 text-right">
                      {aoAbrirConversa && (contato.telefone || lead.telefone) && (
                        <button
                          type="button"
                          title={conversa ? "Abrir conversa" : "Começar conversa"}
                          aria-label={conversa ? "Abrir conversa" : "Começar conversa"}
                          onClick={() => aoAbrirConversa({ ...contato, telefone: contato.telefone || lead.telefone })}
                          className="cursor-pointer rounded-ctl p-1.5 text-sub hover:bg-surface-hover hover:text-accent-forte"
                        >
                          <MessageCircle size={17} strokeWidth={1.75} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {temInteligencia && (
        <section className="rounded-none border border-line bg-bg p-5">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
            <Sparkles size={16} className="text-accent-forte" />
            IA da campanha
          </h3>
          <p className="mb-4 mt-1 text-[12.5px] text-sub">
            O que a IA precisa saber para atender quem chega por esta campanha.
          </p>
          <IaDaCampanha campanhaId={campanha.id} podeEditar={podeEditar} aoSalvar={aoSalvarIa} />
        </section>
      )}
    </div>
  );
}

export default function Campanhas({ dados, sessao, temInteligencia, aoAbrirContato, aoAbrirConversa, aoAbrirChatbots }) {
  const [campanhas, setCampanhas] = useState(null);
  const [erro, setErro] = useState("");
  const [selecionada, setSelecionada] = useState(null); // id, ou "nova"
  const { indice } = useConversasDosLeads();
  const podeEditar = ["owner", "admin"].includes(sessao?.organizacaoAtual?.papel);

  const carregar = useCallback(async (reabrirPeloNome) => {
    try {
      const lista = await api.campanhas.listar();
      setCampanhas(lista);
      setErro("");
      if (reabrirPeloNome) {
        const salva = lista.find((item) => item.nome === reabrirPeloNome);
        if (salva) setSelecionada(salva.id);
      }
    } catch (falha) {
      setErro(falha?.message || "Não deu para carregar as campanhas.");
      setCampanhas((atual) => atual || []);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Abre a primeira campanha: com uma só (o caso comum), é ela que se quer ver.
  useEffect(() => {
    if (!selecionada && campanhas?.length) setSelecionada(campanhas[0].id);
  }, [campanhas, selecionada]);

  const semanal = (campanha) => resumoDaCampanha(campanha, dados.contatos, indice);
  const atual = campanhas?.find((item) => item.id === selecionada) || null;

  return (
    <>
      <CabecalhoTela
        titulo="Campanhas"
        acao={
          temInteligencia && podeEditar ? (
            <BotaoPrimario onClick={() => setSelecionada("nova")}>
              <Plus size={18} strokeWidth={2.4} />
              Nova campanha
            </BotaoPrimario>
          ) : null
        }
      />

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
        {erro && <p role="alert" className="mb-4 rounded-ctl bg-danger/10 px-4 py-3 text-[13px] text-danger">{erro}</p>}

        {campanhas === null ? (
          <p className="py-16 text-center text-[14px] text-sub">Carregando campanhas…</p>
        ) : campanhas.length === 0 && selecionada !== "nova" ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Megaphone size={36} className="text-faint" />
            <h2 className="mt-3 text-[16px] font-semibold text-fg">Nenhuma campanha ainda</h2>
            <p className="mt-1 max-w-[420px] text-[13.5px] text-sub">
              Quando um formulário de anúncio ou do site for ligado ao portal, a campanha aparece aqui com os leads que entraram por ela.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            <nav aria-label="Campanhas" className="grid content-start gap-2">
              {campanhas.map((campanha) => {
                const resumo = semanal(campanha);
                return (
                  <button
                    key={campanha.id}
                    type="button"
                    onClick={() => setSelecionada(campanha.id)}
                    aria-current={campanha.id === selecionada ? "true" : undefined}
                    className={`cursor-pointer rounded-none border p-3.5 text-left transition-colors ${
                      campanha.id === selecionada ? "border-accent bg-accent-soft" : "border-line bg-bg hover:border-line-strong"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <strong className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-fg">{campanha.nome}</strong>
                      <PilulaStatus status={campanha.status} />
                    </div>
                    <p className="mt-1.5 text-[12.5px] text-sub">
                      {resumo.total === 0
                        ? "Nenhum lead ainda"
                        : `${resumo.total} lead${resumo.total === 1 ? "" : "s"} · ${resumo.respondeu} respondeu${resumo.respondeu === 1 ? "" : "ram"}`}
                    </p>
                  </button>
                );
              })}
            </nav>

            <div className="min-w-0">
              {selecionada === "nova" ? (
                <section className="rounded-none border border-line bg-bg p-5">
                  <h2 className="mb-4 text-[18px] font-semibold text-fg">Nova campanha</h2>
                  <IaDaCampanha campanhaId={null} podeEditar={podeEditar} aoSalvar={(nome) => carregar(nome)} />
                </section>
              ) : atual ? (
                <Detalhe
                  campanha={atual}
                  dados={dados}
                  indice={indice}
                  temInteligencia={temInteligencia}
                  podeEditar={podeEditar}
                  aoAbrirContato={aoAbrirContato}
                  aoAbrirConversa={aoAbrirConversa}
                  aoAbrirChatbots={aoAbrirChatbots}
                  aoSalvarIa={(nome) => carregar(nome)}
                />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
