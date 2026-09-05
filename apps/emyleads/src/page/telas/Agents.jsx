/**
 * Central de Inteligência — Agents.
 *
 * FASE G: a primeira tela realmente multi-agent. Consome as operações da
 * FASE F (`agents.*`) e nada mais — nenhuma escrita direta em tabela, e a
 * troca de padrão passa obrigatoriamente pela RPC atômica.
 *
 * O que esta tela NÃO faz, de propósito: não escolhe agente por
 * `.find(audience)` (trabalha com a coleção inteira), não promove ninguém
 * sozinha quando o padrão é desligado, não deixa editar `audience` depois da
 * criação, e não oferece "nascer padrão" na criação.
 *
 * Rollout, marca e política de sessão continuam na aba Assistentes: eles ainda
 * não têm operação equivalente na FASE F, e migrá-los sem isso quebraria o
 * piloto de atendimento.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Bot, Check, Plus, Power, ShieldCheck, Sparkles, Star, Users, X,
} from "lucide-react";
import { api } from "../../data/client";
import {
  AUDIENCIAS, agruparPorAudiencia, avisoAoDesativar, avisoAoTornarPadrao,
  mensagemDeErro, padraoDaAudiencia, rotuloDeAudiencia, selosDoAgent, separarSkills,
} from "../../domain/agents";
import { DialogoConfirmar } from "../ui";

const TOM_DO_SELO = {
  destaque: "bg-accent-soft text-accent-forte",
  vivo: "bg-success/10 text-success",
  apagado: "bg-surface text-faint",
};

function Selo({ texto, tom }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${TOM_DO_SELO[tom] || TOM_DO_SELO.apagado}`}>
      {texto}
    </span>
  );
}

function Campo({ rotulo, ajuda, children }) {
  return (
    <label className="block">
      <span className="text-[10.5px] font-semibold text-sub">{rotulo}</span>
      {children}
      {ajuda ? <span className="mt-1 block text-[10px] leading-4 text-faint">{ajuda}</span> : null}
    </label>
  );
}

const entrada = "mt-1 w-full rounded-[9px] border border-line bg-bg px-3 py-2 text-[12.5px] outline-none focus:border-accent disabled:bg-surface disabled:text-faint";

/** Cartão da lista. Um agente é uma entidade, não uma linha de formulário. */
function CartaoAgent({ agent, ativo, aoAbrir }) {
  const interno = agent.audience === "internal";
  return (
    <button
      type="button"
      onClick={() => aoAbrir(agent)}
      aria-pressed={ativo}
      className={`group relative w-full overflow-hidden rounded-[13px] border p-3.5 text-left transition ${
        ativo ? "border-accent bg-accent-soft/40" : "border-line bg-bg hover:border-faint"
      } ${agent.status === "inactive" ? "opacity-70" : ""}`}
    >
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${
          interno ? "bg-accent-soft text-accent-forte" : "bg-[#e6f6f2] text-[#08796e]"
        }`}>
          {interno ? <Users size={17} /> : <Bot size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-[13.5px] font-semibold">{agent.name}</h3>
            {selosDoAgent(agent).map((selo) => <Selo key={selo.id} texto={selo.texto} tom={selo.tom} />)}
          </div>
          <p className="mt-0.5 truncate text-[10.5px] text-sub">
            {agent.role || rotuloDeAudiencia(agent.audience)}
            <span className="text-faint"> · {agent.slug}</span>
          </p>
        </div>
      </div>
    </button>
  );
}

/** Criação. `audience` só é editável aqui — depois vira leitura. */
export function NovoAgent({ aoFechar, aoCriar }) {
  const [form, setForm] = useState({ name: "", audience: "customer", role: "", tone: "", soulMarkdown: "" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const campo = (chave, valor) => setForm((atual) => ({ ...atual, [chave]: valor }));

  const salvar = async () => {
    setSalvando(true);
    setErro("");
    try {
      await aoCriar(form);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0f1424]/55 backdrop-blur-[2px] md:items-center md:p-4">
      <section className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[16px] border border-line bg-bg shadow-2xl md:rounded-[16px]">
        <header className="flex items-center border-b border-line px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.13em] text-accent">Central de Inteligência</p>
            <h2 className="text-[17px] font-semibold">Novo agente</h2>
          </div>
          <button onClick={aoFechar} className="ml-auto p-2 text-sub" aria-label="Fechar"><X size={18} /></button>
        </header>

        <div className="scrollbar-fina flex-1 space-y-3.5 overflow-y-auto p-5">
          <Campo rotulo="Nome">
            <input value={form.name} onChange={(e) => campo("name", e.target.value)}
              placeholder="Emília" className={entrada} />
          </Campo>

          <Campo rotulo="Audiência" ajuda="Definida agora e imutável depois: ela decide qual conhecimento o agente enxerga e quais skills podem ser amarradas.">
            <div className="mt-1 grid gap-2">
              {AUDIENCIAS.map((audiencia) => (
                <label key={audiencia.id}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-[10px] border p-3 ${
                    form.audience === audiencia.id ? "border-accent bg-accent-soft" : "border-line"
                  }`}>
                  <input type="radio" name="audiencia" className="mt-0.5"
                    checked={form.audience === audiencia.id}
                    onChange={() => campo("audience", audiencia.id)} />
                  <span>
                    <span className="block text-[12.5px] font-semibold">{audiencia.rotulo}</span>
                    <span className="block text-[10.5px] text-sub">{audiencia.descricao}</span>
                  </span>
                </label>
              ))}
            </div>
          </Campo>

          <Campo rotulo="Função" ajuda="Opcional. Ex.: pré-qualificação, suporte, agendamento.">
            <input value={form.role} onChange={(e) => campo("role", e.target.value)} className={entrada} />
          </Campo>

          <Campo rotulo="Tom" ajuda="Opcional. Até 500 caracteres.">
            <input value={form.tone} onChange={(e) => campo("tone", e.target.value)} className={entrada} />
          </Campo>

          <Campo rotulo="Soul" ajuda="Define personalidade, postura, princípios e estilo de comunicação. Não coloque aqui ferramentas, permissões ou regras de segurança.">
            <textarea value={form.soulMarkdown} onChange={(e) => campo("soulMarkdown", e.target.value)}
              rows={5} className={`${entrada} font-mono text-[11.5px]`} />
          </Campo>

          <p className="rounded-[10px] bg-surface p-3 text-[10.5px] leading-4 text-sub">
            O agente nasce <strong>comum</strong>. Quem responde continua sendo o agente padrão da
            audiência — promover é uma ação separada, depois de criado.
          </p>

          {erro ? <p className="text-[11.5px] text-danger" role="alert">{erro}</p> : null}
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
          <button onClick={aoFechar} className="px-3 py-2 text-[11.5px] text-sub">Cancelar</button>
          <button onClick={salvar} disabled={salvando || form.name.trim().length < 2}
            className="ml-auto inline-flex items-center gap-2 rounded-[9px] bg-accent px-4 py-2.5 text-[12px] font-semibold text-white disabled:opacity-40">
            <Check size={14} />{salvando ? "Criando…" : "Criar agente"}
          </button>
        </footer>
      </section>
    </div>
  );
}

/** Detalhe: Geral, Soul, Skills. */
export function DetalheAgent({ agent, catalogoSkills, canWrite, aoVoltar, acoes }) {
  const [aba, setAba] = useState("geral");
  const [bindings, setBindings] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState("");

  const original = useMemo(() => ({
    name: agent.name ?? "", slug: agent.slug ?? "", role: agent.role ?? "",
    tone: agent.tone ?? "", soulMarkdown: agent.soulMarkdown ?? "",
  }), [agent]);

  // O rascunho nasce preenchido, e não dentro de um efeito. Semear por efeito
  // fazia o detalhe renderizar vazio no primeiro passe — uma piscada na tela
  // de verdade, e nada em render estático.
  const [rascunho, setRascunho] = useState(original);

  useEffect(() => {
    setRascunho(original);
    setSalvo(false);
    setErro("");
    let vivo = true;
    acoes.listarSkills(agent.id)
      .then((linhas) => { if (vivo) setBindings(linhas); })
      .catch(() => { if (vivo) setBindings([]); });
    return () => { vivo = false; };
  }, [agent.id]);

  const sujo = Boolean(rascunho && JSON.stringify(rascunho) !== JSON.stringify(original));
  const { vinculadas, disponiveis } = useMemo(
    () => separarSkills(catalogoSkills, bindings, agent.audience),
    [catalogoSkills, bindings, agent.audience],
  );

  const campo = (chave, valor) => { setSalvo(false); setRascunho((r) => ({ ...r, [chave]: valor })); };

  const salvar = async () => {
    setSalvando(true);
    setErro("");
    try {
      await acoes.editar(agent.id, rascunho);
      setSalvo(true);
    } catch (falha) {
      // Sem estado otimista: o rascunho continua na tela e nada é dado como
      // salvo. Quem digitou corrige e tenta de novo sem perder o texto.
      setErro(mensagemDeErro(falha));
    } finally {
      setSalvando(false);
    }
  };

  const trocarSkill = async (skillId, enabled) => {
    setErro("");
    try {
      await acoes.definirSkill(agent.id, skillId, enabled);
      setBindings(await acoes.listarSkills(agent.id));
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  };

  const abas = [["geral", "Geral"], ["soul", "Soul"], ["skills", "Skills"]];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex-none border-b border-line px-4 pt-4 md:px-6">
        <div className="flex items-start gap-3">
          <button onClick={aoVoltar} className="-ml-1 rounded-[8px] p-1.5 text-sub md:hidden" aria-label="Voltar">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[19px] font-semibold tracking-tight">{agent.name}</h2>
              {selosDoAgent(agent).map((selo) => <Selo key={selo.id} texto={selo.texto} tom={selo.tom} />)}
            </div>
            <p className="mt-0.5 text-[11px] text-sub">
              {rotuloDeAudiencia(agent.audience)} · <span className="text-faint">{agent.slug}</span>
            </p>
          </div>
        </div>

        {canWrite ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {agent.isDefault ? (
              <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-soft px-3 py-1.5 text-[11px] font-semibold text-accent-forte">
                <ShieldCheck size={13} />Agente padrão desta audiência
              </span>
            ) : (
              <button onClick={() => acoes.tornarPadrao(agent)}
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-3 py-1.5 text-[11px] font-semibold hover:border-accent">
                <Star size={13} />Tornar padrão
              </button>
            )}
            <button onClick={() => acoes.alternarAtivo(agent)}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-3 py-1.5 text-[11px] font-semibold hover:border-accent">
              <Power size={13} />{agent.status === "active" ? "Desativar" : "Ativar"}
            </button>
          </div>
        ) : null}

        <div className="mt-3 flex gap-1 overflow-x-auto">
          {abas.map(([id, rotulo]) => (
            <button key={id} onClick={() => setAba(id)}
              className={`min-w-fit rounded-t-[8px] border-b-2 px-3 py-2 text-[11.5px] font-semibold ${
                aba === id ? "border-accent text-accent-forte" : "border-transparent text-sub"
              }`}>{rotulo}</button>
          ))}
        </div>
      </header>

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {aba === "geral" ? (
          <div className="grid max-w-xl gap-3.5">
            <Campo rotulo="Nome">
              <input disabled={!canWrite} value={rascunho.name}
                onChange={(e) => campo("name", e.target.value)} className={entrada} />
            </Campo>
            <Campo rotulo="Identificador (slug)" ajuda="Identidade técnica e estável do agente. Única por organização.">
              <input disabled={!canWrite} value={rascunho.slug}
                onChange={(e) => campo("slug", e.target.value)} className={`${entrada} font-mono text-[11.5px]`} />
            </Campo>
            <Campo rotulo="Audiência" ajuda="Imutável depois da criação: ela decide qual conhecimento o agente enxerga, quais skills podem ser amarradas e qual padrão ele disputa.">
              <input disabled readOnly value={rotuloDeAudiencia(agent.audience)} className={entrada} />
            </Campo>
            <Campo rotulo="Função">
              <input disabled={!canWrite} value={rascunho.role}
                onChange={(e) => campo("role", e.target.value)} className={entrada} />
            </Campo>
            <Campo rotulo="Tom">
              <input disabled={!canWrite} value={rascunho.tone}
                onChange={(e) => campo("tone", e.target.value)} className={entrada} />
            </Campo>
          </div>
        ) : null}

        {aba === "soul" ? (
          <div className="grid max-w-2xl gap-2">
            <p className="text-[11px] leading-4 text-sub">
              Define personalidade, postura, princípios e estilo de comunicação do agente.
              Aceita Markdown.
            </p>
            <p className="rounded-[10px] bg-surface p-3 text-[10.5px] leading-4 text-sub">
              O Soul não concede permissão. Ferramentas, acessos e regras de segurança são
              decididos fora dele — pedir aqui não libera nada.
            </p>
            <textarea disabled={!canWrite} value={rascunho.soulMarkdown}
              onChange={(e) => campo("soulMarkdown", e.target.value)} rows={16}
              className={`${entrada} font-mono text-[11.5px] leading-5`} />
          </div>
        ) : null}

        {aba === "skills" ? (
          <div className="grid max-w-2xl gap-5">
            <section>
              <p className="mb-2 text-[10.5px] font-semibold text-sub">Vinculadas ({vinculadas.length})</p>
              {vinculadas.length ? (
                <div className="grid gap-2">
                  {vinculadas.map((skill) => (
                    <div key={skill.id} className="flex items-center gap-3 rounded-[10px] border border-line p-3">
                      <Sparkles size={15} className="shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold">{skill.name}</p>
                        <p className="truncate text-[10.5px] text-sub">{skill.description || skill.slug}</p>
                      </div>
                      {canWrite ? (
                        <button onClick={() => trocarSkill(skill.id, false)}
                          className="shrink-0 rounded-[7px] border border-line px-2.5 py-1 text-[10.5px] text-sub hover:border-danger hover:text-danger">
                          Desvincular
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-[10px] border border-dashed border-line p-4 text-center text-[11px] text-sub">
                  Nenhuma skill vinculada a este agente.
                </p>
              )}
            </section>

            <section>
              <p className="mb-2 text-[10.5px] font-semibold text-sub">Disponíveis ({disponiveis.length})</p>
              {disponiveis.length ? (
                <div className="grid gap-2">
                  {disponiveis.map((skill) => (
                    <div key={skill.id} className="flex items-center gap-3 rounded-[10px] border border-line bg-surface/50 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold">{skill.name}</p>
                        <p className="truncate text-[10.5px] text-sub">{skill.description || skill.slug}</p>
                      </div>
                      {canWrite ? (
                        <button onClick={() => trocarSkill(skill.id, true)}
                          className="shrink-0 rounded-[7px] bg-accent px-2.5 py-1 text-[10.5px] font-semibold text-white">
                          Vincular
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-[10px] border border-dashed border-line p-4 text-center text-[11px] text-sub">
                  Nenhuma outra skill publicada para esta audiência.
                </p>
              )}
            </section>

            <p className="text-[10.5px] leading-4 text-faint">
              A mesma skill pode estar em vários agentes. Desvincular aqui não a remove de nenhum outro.
            </p>
          </div>
        ) : null}
      </div>

      {canWrite && aba !== "skills" ? (
        <footer className="flex flex-none items-center gap-3 border-t border-line px-4 py-3 md:px-6">
          {erro ? <p className="text-[11.5px] text-danger" role="alert">{erro}</p> : null}
          {salvo && !sujo ? <p className="text-[11.5px] text-success">Salvo.</p> : null}
          <button onClick={salvar} disabled={!sujo || salvando}
            className="ml-auto inline-flex items-center gap-2 rounded-[9px] bg-accent px-4 py-2.5 text-[12px] font-semibold text-white disabled:opacity-40">
            <Check size={14} />{salvando ? "Salvando…" : "Salvar"}
          </button>
        </footer>
      ) : null}
    </div>
  );
}

export default function Agents({ agents, catalogoSkills, canWrite, recarregar, carregando, erro }) {
  const [selecionadoId, setSelecionadoId] = useState(null);
  const [criando, setCriando] = useState(false);
  const [pedido, setPedido] = useState(null);
  const [falha, setFalha] = useState("");

  const grupos = useMemo(() => agruparPorAudiencia(agents), [agents]);
  const selecionado = useMemo(
    () => (agents ?? []).find((agent) => agent.id === selecionadoId) ?? null,
    [agents, selecionadoId],
  );

  const acoes = {
    listarSkills: (agentId) => api.agents.listarSkills({ agentId }),
    definirSkill: (agentId, skillId, enabled) => api.agents.definirSkill({ agentId, skillId, enabled }),
    editar: async (agentId, patch) => { await api.agents.editar({ agentId, ...patch }); await recarregar(); },

    alternarAtivo: (agent) => {
      const aplicar = async () => {
        setFalha("");
        try {
          await api.agents.definirAtivo({ agentId: agent.id, active: agent.status !== "active" });
          await recarregar();
        } catch (e) { setFalha(mensagemDeErro(e)); }
      };
      // Desligar o padrão é permitido, e nada é promovido no lugar — mas quem
      // desliga precisa saber que aquela audiência para de ser atendida.
      const aviso = avisoAoDesativar(agent);
      if (!aviso) return aplicar();
      return setPedido({ ...aviso, confirmar: aplicar });
    },

    tornarPadrao: (agent) => {
      setPedido({
        ...avisoAoTornarPadrao(agent, padraoDaAudiencia(agents, agent.audience)),
        confirmar: async () => {
          setFalha("");
          try {
            // UMA chamada. Rebaixar o antigo e promover este é trabalho da RPC.
            await api.agents.tornarPadrao({ agentId: agent.id });
            await recarregar();
          } catch (e) { setFalha(mensagemDeErro(e)); }
        },
      });
    },
  };

  if (carregando) {
    return <div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando agentes…</div>;
  }
  if (erro) {
    return <div className="flex flex-1 items-center justify-center p-8 text-center text-[12.5px] text-danger" role="alert">{erro}</div>;
  }

  const lista = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2 px-4 pt-4 md:px-5">
        <div>
          <h2 className="text-[15px] font-semibold">Agentes</h2>
          <p className="text-[10.5px] text-sub">{(agents ?? []).length} nesta organização</p>
        </div>
        {canWrite ? (
          <button onClick={() => setCriando(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-[9px] bg-accent px-3 py-2 text-[11.5px] font-semibold text-white">
            <Plus size={14} />Novo agente
          </button>
        ) : null}
      </div>

      {falha ? <p className="mx-4 mt-3 rounded-[9px] bg-danger/10 p-2.5 text-[11.5px] text-danger md:mx-5" role="alert">{falha}</p> : null}

      <div className="scrollbar-fina min-h-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-5">
        {grupos.length ? grupos.map((grupo) => (
          <section key={grupo.id}>
            <p className="mb-2 text-[9.5px] font-bold uppercase tracking-[.12em] text-faint">{grupo.rotulo}</p>
            <div className="grid gap-2">
              {grupo.agents.map((agent) => (
                <CartaoAgent key={agent.id} agent={agent}
                  ativo={agent.id === selecionadoId} aoAbrir={(a) => setSelecionadoId(a.id)} />
              ))}
            </div>
          </section>
        )) : (
          <p className="rounded-[12px] border border-dashed border-line p-8 text-center text-[12px] text-sub">
            Nenhum agente configurado.
          </p>
        )}
        <p className="pt-1 text-[10px] leading-4 text-faint">
          Rollout, marca e política de sessão continuam na aba Assistentes.
        </p>
      </div>
    </div>
  );

  const detalhe = selecionado ? (
    <DetalheAgent agent={selecionado} catalogoSkills={catalogoSkills} canWrite={canWrite}
      aoVoltar={() => setSelecionadoId(null)} acoes={acoes} />
  ) : null;

  return (
    <>
      {/* Desktop: mestre/detalhe. Mobile: uma coisa de cada vez. */}
      <div className="hidden min-h-0 flex-1 md:grid md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-line bg-bg">{lista}</aside>
        <main className="flex min-h-0 flex-col bg-bg">
          {detalhe || (
            <div className="flex min-h-[420px] flex-1 flex-col items-center justify-center px-8 text-center">
              <Bot size={34} className="text-faint" />
              <h3 className="mt-3 text-[15px] font-semibold">Selecione um agente</h3>
              <p className="mt-1 max-w-sm text-[11.5px] text-sub">
                Cada agente tem identidade, comportamento e skills próprios. Quem responde a uma
                audiência é sempre o agente padrão dela.
              </p>
            </div>
          )}
        </main>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-bg md:hidden">
        {detalhe || lista}
      </div>

      {criando ? (
        <NovoAgent aoFechar={() => setCriando(false)}
          aoCriar={async (form) => {
            const criado = await api.agents.criar(form);
            await recarregar();
            setCriando(false);
            if (criado?.id) setSelecionadoId(criado.id);
          }} />
      ) : null}

      <DialogoConfirmar pedido={pedido} aoFechar={() => setPedido(null)} />
    </>
  );
}
