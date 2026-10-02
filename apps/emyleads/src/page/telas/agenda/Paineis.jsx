import { useEffect, useState } from "react";
import { Check, Plus, UserRound } from "lucide-react";
import { api } from "../../../data/client";
import { Chip, SeletorContato, Segmentado } from "./componentes";
import { ROTULOS_STATUS_AVISO } from "./agendaUtils";

const entrada = "min-h-11 w-full rounded-ctl border border-line bg-bg px-3 text-[15px] text-fg outline-none focus:border-accent md:min-h-10 md:text-[13px]";
const botaoPrimario = "min-h-11 cursor-pointer rounded-ctl bg-accent px-4 text-[14px] font-semibold text-white hover:brightness-110 disabled:opacity-40 md:min-h-9 md:text-[12.5px]";
const tituloSecao = "text-[15px] font-semibold text-fg md:text-[13px]";
const textoAjuda = "mt-1 text-[13px] leading-5 text-sub md:text-[11.5px] md:leading-4";

export const VISUALIZACOES = [
  { id: "day", rotulo: "Dia", tecla: "d" },
  { id: "week", rotulo: "Semana", tecla: "s" },
  { id: "month", rotulo: "Mês", tecla: "m" },
];

export function formatarDataHora(valor) {
  if (!valor) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(valor)).replaceAll(".", "");
}

/**
 * Avisos primeiro, telefone depois.
 *
 * Antes a verificação do WhatsApp ocupava o topo do painel e o histórico de
 * avisos — o motivo de alguém tocar no sino — ficava embaixo dela.
 */
export function PainelNotificacoes({ contexto, notificacoes, aoAtualizar, aoMarcarLida }) {
  const [telefone, setTelefone] = useState("");
  const [verificacaoId, setVerificacaoId] = useState(null);
  const [codigo, setCodigo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const preferencia = contexto?.preference || {};
  const solicitar = async (e) => {
    e.preventDefault(); setOcupado(true); setErro("");
    try { const resposta = await api.agenda.telefoneSolicitar({ telefone }); setVerificacaoId(resposta.verificacaoId); }
    catch (falha) { setErro(falha?.message || String(falha)); }
    finally { setOcupado(false); }
  };
  const confirmar = async (e) => {
    e.preventDefault(); setOcupado(true); setErro("");
    try { await api.agenda.telefoneConfirmar({ verificacaoId, codigo }); setVerificacaoId(null); setCodigo(""); await aoAtualizar(); }
    catch (falha) { setErro(falha?.message || String(falha)); }
    finally { setOcupado(false); }
  };
  return (
    <div>
      <section className="p-4">
        <div className="space-y-2">
          {notificacoes.map((item) => {
            // Atribuição não tem horário para anunciar: o aviso de "você
            // entrou nesta tarefa" não pode sair com o vencimento colado.
            const atribuicao = item.tipo === "assignment";
            const naoLida = !item.lidaEm && item.status === "sent";
            return (
              <button key={item.id} type="button" onClick={() => aoMarcarLida(item)} className={`relative w-full cursor-pointer rounded-none border p-3 pl-4 text-left ${naoLida ? "border-accent/35 bg-accent-soft/45" : "border-line"}`}>
                {naoLida && <span className="absolute left-1.5 top-4 h-1.5 w-1.5 rounded-full bg-accent" aria-label="Não lido" />}
                {atribuicao && (
                  <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-forte md:text-[10px]">
                    <UserRound size={11} />Colocaram você numa tarefa
                  </span>
                )}
                <span className="block text-[15px] font-medium text-fg md:text-[12.5px]">{item.titulo}</span>
                <span className="mt-1 block text-[13px] text-faint md:text-[11px]">
                  {item.canal === "whatsapp" ? "WhatsApp" : "No portal"} · {formatarDataHora(item.lembrarEm)} · {item.erro ? `Falhou: ${item.erro}` : ROTULOS_STATUS_AVISO[item.status] || item.status}
                </span>
                {atribuicao && <span className="mt-1 block text-[13px] text-sub md:text-[11px]">Responda em Tarefas: assumir ou recusar.</span>}
              </button>
            );
          })}
          {!notificacoes.length && <p className="py-10 text-center text-[14px] text-faint md:text-[12px]">Nenhum aviso por enquanto.</p>}
        </div>
      </section>
      <section className="border-t border-line p-4">
        <h3 className={tituloSecao}>Receber lembretes no WhatsApp</h3>
        {preferencia.phoneVerified ? (
          <div className="mt-3 flex min-h-11 items-center gap-2 rounded-ctl border border-success/25 bg-success-soft px-3 text-[14px] text-success md:text-[12px]"><Check size={16} />Número terminado em {preferencia.phoneLast4} verificado</div>
        ) : verificacaoId ? (
          <form onSubmit={confirmar} className="mt-3">
            <p className={textoAjuda}>Digite o código de 6 números que chegou no seu WhatsApp.</p>
            <div className="mt-2 flex gap-2">
              <input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} className={`${entrada} min-w-0 flex-1 tracking-[0.3em]`} placeholder="000000" />
              <button disabled={ocupado} className={botaoPrimario}>Confirmar</button>
            </div>
          </form>
        ) : (
          <form onSubmit={solicitar} className="mt-2">
            <p className={textoAjuda}>O número da empresa manda os lembretes para o seu celular.</p>
            <div className="mt-2 flex gap-2">
              <input required type="tel" inputMode="tel" autoComplete="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} className={`${entrada} min-w-0 flex-1`} placeholder="+55 65 99999-9999" />
              <button disabled={ocupado} className={botaoPrimario}>Verificar</button>
            </div>
          </form>
        )}
        {erro && <p role="alert" className="mt-2 text-[13px] text-danger md:text-[11.5px]">{erro}</p>}
      </section>
    </div>
  );
}

const ROTULOS_SOLICITACAO = {
  awaiting_customer_confirmation: "Aguardando cliente",
  awaiting_team_approval: "Aguardando aprovação",
  completed: "Aprovada",
  rejected: "Recusada",
  expired: "Expirada",
  failed: "Falhou",
  cancelled: "Cancelada",
};

export function PainelSolicitacoes({ solicitacoes, ocupado, aoDecidir }) {
  const [motivos, setMotivos] = useState({});
  const pendentes = solicitacoes.filter((item) => item.status === "awaiting_team_approval");
  const historico = solicitacoes.filter((item) => item.status !== "awaiting_team_approval");
  const renderizar = (item) => (
    <article key={item.id} className="rounded-none border border-line bg-bg p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-fg md:text-[12.5px]">{item.subject || "Reunião"}</p>
          <p className="mt-1 text-[13px] text-sub md:text-[11px]">{item.customer_name || "Cliente"} · {item.responsible_name || "Profissional"}</p>
          <p className="mt-0.5 text-[13px] text-faint md:text-[11px]">{formatarDataHora(item.starts_at)} até {formatarDataHora(item.ends_at)}</p>
        </div>
        <span className={`flex-none rounded-full px-2 py-1 text-[11px] font-semibold md:text-[10px] ${item.status === "awaiting_team_approval" ? "bg-warning/10 text-warning" : item.status === "completed" ? "bg-success-soft text-success" : "bg-surface text-sub"}`}>
          {ROTULOS_SOLICITACAO[item.status] || item.status}
        </span>
      </div>
      {item.status === "awaiting_team_approval" && (
        <div className="mt-3">
          <input
            value={motivos[item.id] || ""}
            onChange={(e) => setMotivos((atual) => ({ ...atual, [item.id]: e.target.value }))}
            maxLength={500}
            className={entrada}
            placeholder="Motivo, se for recusar (opcional)"
          />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={ocupado === item.id} onClick={() => aoDecidir(item, "approve", "")} className="min-h-11 flex-1 cursor-pointer rounded-ctl bg-success px-3 text-[14px] font-semibold text-white disabled:opacity-40 md:min-h-9 md:text-[12px]">Aprovar</button>
            <button type="button" disabled={ocupado === item.id} onClick={() => aoDecidir(item, "reject", motivos[item.id] || "")} className="min-h-11 flex-1 cursor-pointer rounded-ctl border border-danger/30 px-3 text-[14px] font-semibold text-danger disabled:opacity-40 md:min-h-9 md:text-[12px]">Recusar</button>
          </div>
        </div>
      )}
      {item.decision_reason && <p className="mt-2 text-[12px] text-faint md:text-[11px]">Motivo: {item.decision_reason}</p>}
    </article>
  );
  return (
    <div className="p-4">
      <p className={textoAjuda}>Pedidos de clientes seguram o horário até alguém decidir. A primeira decisão encerra o pedido e o cliente é avisado.</p>
      <h3 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-faint md:text-[11px]">Aguardando ({pendentes.length})</h3>
      <div className="mt-2 space-y-2">{pendentes.map(renderizar)}{!pendentes.length && <p className="py-6 text-center text-[14px] text-faint md:text-[12px]">Nenhum pedido esperando.</p>}</div>
      <h3 className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-faint md:text-[11px]">Histórico</h3>
      <div className="mt-2 space-y-2">{historico.slice(0, 30).map(renderizar)}{!historico.length && <p className="py-6 text-center text-[14px] text-faint md:text-[12px]">O histórico aparece aqui.</p>}</div>
    </div>
  );
}

function LinhaCategoria({ categoria, aoSalvar }) {
  const [nome, setNome] = useState(categoria.name);
  const [cor, setCor] = useState(categoria.color);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { setNome(categoria.name); setCor(categoria.color); }, [categoria.color, categoria.name]);
  const mudou = nome !== categoria.name || cor !== categoria.color;
  return (
    <div className="flex items-center gap-2">
      <input type="color" aria-label={`Cor de ${categoria.name}`} value={cor} onChange={(e) => setCor(e.target.value.toUpperCase())} className="h-11 w-11 flex-none cursor-pointer rounded-ctl border border-line bg-bg p-1 md:h-9 md:w-10" />
      <input value={nome} maxLength={60} aria-label="Nome da categoria" onChange={(e) => setNome(e.target.value)} className={`${entrada} min-w-0 flex-1`} />
      {mudou && (
        <button type="button" disabled={ocupado || !nome.trim()} onClick={async () => { setOcupado(true); try { await aoSalvar({ id: categoria.id, nome, cor }); } finally { setOcupado(false); } }} className="min-h-11 flex-none cursor-pointer rounded-ctl border border-accent px-3 text-[13px] font-semibold text-accent-forte hover:bg-accent-soft disabled:opacity-40 md:min-h-9 md:text-[12px]">Salvar</button>
      )}
    </div>
  );
}

export function PainelPreferencias({ contexto, visualizacao, aoSalvar, aoSalvarCategoria }) {
  const preferencia = contexto?.preference || {};
  const categorias = contexto?.categories || [];
  const podeCategorias = ["owner", "admin"].includes(contexto?.papel);
  const [form, setForm] = useState(() => ({
    visualizacao: preferencia.defaultView || visualizacao,
    inicioDia: String(preferencia.dayStart || "08:00").slice(0, 5),
    fimDia: String(preferencia.dayEnd || "18:00").slice(0, 5),
    notificacaoInterna: preferencia.inAppEnabled !== false,
    whatsapp: Boolean(preferencia.whatsappEnabled),
  }));
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [novaCategoria, setNovaCategoria] = useState("");
  const [novaCor, setNovaCor] = useState("#8B7CFF");
  const enviar = async (e) => {
    e.preventDefault(); setSalvando(true); setMensagem("");
    try { await aoSalvar({ ...form, lembretes: preferencia.defaultReminderMinutes || [30] }); setMensagem("Preferências salvas."); }
    catch (erro) { setMensagem(erro?.message || String(erro)); }
    finally { setSalvando(false); }
  };
  const salvarCategoria = async (categoria) => {
    setMensagem("");
    try {
      await aoSalvarCategoria(categoria);
      setNovaCategoria("");
      setMensagem("Categorias atualizadas.");
    } catch (erro) { setMensagem(erro?.message || String(erro)); }
  };
  const rotuloCampo = "mb-1 block text-[13px] font-semibold text-sub md:text-[12px]";
  const caixa = "flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-ctl border border-line px-3 text-[15px] text-fg md:min-h-10 md:text-[13px]";
  return (
    <div>
      <form onSubmit={enviar} className="space-y-4 p-4">
        <h3 className={tituloSecao}>Minha agenda</h3>
        <div>
          <span className={rotuloCampo}>Abrir a agenda em</span>
          <Segmentado rotulo="Abrir a agenda em" cheio valor={form.visualizacao} aoMudar={(id) => setForm({ ...form, visualizacao: id })} opcoes={VISUALIZACOES} />
        </div>
        <div>
          <span className={rotuloCampo}>Meu expediente</span>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <input type="time" aria-label="Começa às" className={entrada} value={form.inicioDia} onChange={(e) => setForm({ ...form, inicioDia: e.target.value })} />
            <span className="text-[14px] text-faint">até</span>
            <input type="time" aria-label="Termina às" className={entrada} value={form.fimDia} onChange={(e) => setForm({ ...form, fimDia: e.target.value })} />
          </div>
          <p className={textoAjuda}>Fora desse horário a grade fica sombreada.</p>
        </div>
        <label className={caixa}>Avisar aqui no portal<input type="checkbox" role="switch" checked={form.notificacaoInterna} onChange={(e) => setForm({ ...form, notificacaoInterna: e.target.checked })} className="h-5 w-5 accent-accent" /></label>
        <label className={`${caixa} ${!preferencia.phoneVerified ? "opacity-60" : ""}`}>Avisar também no WhatsApp<input type="checkbox" role="switch" disabled={!preferencia.phoneVerified} checked={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.checked })} className="h-5 w-5 accent-accent" /></label>
        {!preferencia.phoneVerified && <p className={textoAjuda}>Para ligar, verifique seu número no sino de avisos.</p>}
        <button disabled={salvando} className={`${botaoPrimario} w-full`}>{salvando ? "Salvando…" : "Salvar preferências"}</button>
      </form>
      {podeCategorias && (
        <section className="border-t border-line p-4">
          <h3 className={tituloSecao}>Categorias da empresa</h3>
          <p className={textoAjuda}>Nome e cor valem para toda a equipe.</p>
          <div className="mt-3 space-y-2">{categorias.map((categoria) => <LinhaCategoria key={categoria.id} categoria={categoria} aoSalvar={salvarCategoria} />)}</div>
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <input type="color" aria-label="Cor da nova categoria" value={novaCor} onChange={(e) => setNovaCor(e.target.value.toUpperCase())} className="h-11 w-11 flex-none cursor-pointer rounded-ctl border border-line bg-bg p-1 md:h-9 md:w-10" />
            <input value={novaCategoria} maxLength={60} onChange={(e) => setNovaCategoria(e.target.value)} placeholder="Nova categoria" className={`${entrada} min-w-0 flex-1`} />
            <button type="button" aria-label="Adicionar categoria" disabled={!novaCategoria.trim()} onClick={() => salvarCategoria({ nome: novaCategoria, cor: novaCor })} className="flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-ctl bg-accent text-white disabled:opacity-40 md:h-9 md:w-9"><Plus size={16} /></button>
          </div>
        </section>
      )}
      {mensagem && <p role="status" className="px-4 pb-4 text-[13px] text-sub md:text-[11.5px]">{mensagem}</p>}
    </div>
  );
}

/**
 * Tudo o que recorta a agenda, num lugar só e com o nome escrito.
 *
 * Antes eram dois `<select>`, um filtro de contato escondido num painel de
 * contatos e dois botões só com ícone (pessoa, linhas) que se explicavam por
 * dica de mouse — que no toque não existe.
 */
export function PainelFiltros({ filtros, aoMudar, membros, usuarioId, categorias, contatos, podeAgrupar }) {
  const { profissional, categoria, contato, modoCor, agrupar } = filtros;
  const rotuloCampo = "mb-2 block text-[13px] font-semibold text-sub md:text-[12px]";
  return (
    <div className="space-y-5 p-4">
      <div>
        <span className={rotuloCampo}>Agenda de quem</span>
        <div className="flex flex-wrap gap-2">
          <Chip ativo={profissional === "mine"} aoClicar={() => aoMudar({ profissional: "mine" })}>Minha</Chip>
          <Chip ativo={profissional === "team"} aoClicar={() => aoMudar({ profissional: "team" })}>Toda a equipe</Chip>
          {membros.filter((membro) => membro.id !== usuarioId).map((membro) => (
            <Chip key={membro.id} ativo={profissional === membro.id} aoClicar={() => aoMudar({ profissional: membro.id })} cor={membro.color}>
              {membro.displayName || membro.name}
            </Chip>
          ))}
        </div>
      </div>
      {categorias.length > 0 && (
        <div>
          <span className={rotuloCampo}>Categoria</span>
          <div className="flex flex-wrap gap-2">
            <Chip ativo={!categoria} aoClicar={() => aoMudar({ categoria: "" })}>Todas</Chip>
            {categorias.map((item) => (
              <Chip key={item.id} ativo={categoria === item.id} aoClicar={() => aoMudar({ categoria: item.id })} cor={item.color}>{item.name}</Chip>
            ))}
          </div>
        </div>
      )}
      <SeletorContato rotulo="Só compromissos com o cliente" contatos={contatos} valor={contato} aoMudar={(id) => aoMudar({ contato: id })} />
      <div>
        <span className={rotuloCampo}>Colorir por</span>
        <Segmentado
          rotulo="Colorir por"
          cheio
          valor={modoCor === "pessoa" ? "pessoa" : "tipo"}
          aoMudar={(id) => aoMudar({ modoCor: id })}
          opcoes={[{ id: "tipo", rotulo: "Tipo de compromisso" }, { id: "pessoa", rotulo: "Pessoa" }]}
        />
      </div>
      {podeAgrupar && (
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-ctl border border-line px-3 text-[15px] text-fg md:min-h-10 md:text-[13px]">
          <span>Uma coluna por pessoa <span className="block text-[12px] text-faint md:text-[11px]">Na visão de dia, com a equipe toda.</span></span>
          <input type="checkbox" role="switch" checked={agrupar} onChange={(e) => aoMudar({ agrupar: e.target.checked })} className="h-5 w-5 accent-accent" />
        </label>
      )}
    </div>
  );
}

/** Quantos filtros estão fora do padrão — o número no botão "Filtros". */
export function contarFiltros({ profissional, categoria, contato }) {
  return (profissional !== "mine" ? 1 : 0) + (categoria ? 1 : 0) + (contato ? 1 : 0);
}
