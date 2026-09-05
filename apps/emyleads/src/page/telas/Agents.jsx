/**
 * Central de Agentes.
 *
 * ETAPA 12B.1 (redesenho de UX). A pergunta que guiou esta versão não foi
 * "como melhorar a tela anterior", foi "como uma empresa pensaria em
 * contratar e gerenciar gente para fazer um trabalho": o usuário pensa
 * "quero alguém para vender", não `assistant_profile`/`audience`/`slug`.
 * Esses conceitos continuam existindo — só que atrás da tela, não na frente
 * dela. A tabela completa termo técnico → termo mostrado está em
 * `docs/intelligence/MULTI-AGENT-MIGRATION.md`.
 *
 * Continua consumindo só as operações da FASE F (`agents.*`) — nenhuma
 * escrita direta em tabela, e a troca de agente principal passa
 * obrigatoriamente pela RPC atômica. O redesenho é só como a tela FALA sobre
 * o que já existia.
 *
 * O que esta tela NÃO faz, de propósito: não escolhe agente por
 * `.find(audience)` (trabalha com a coleção inteira), não promove ninguém
 * sozinha quando o principal é desligado, não deixa editar quem o agente
 * atende depois da criação, e nenhum preset do assistente de criação nasce
 * "principal" — isso continua sendo uma ação separada e explícita.
 *
 * Liberação de atendimento, marca e política de sessão continuam na aba
 * "Liberação e marca": elas ainda não têm operação equivalente na FASE F, e
 * migrá-las agora quebraria o piloto de atendimento.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Bot, Calendar, Check, ChevronDown, Handshake, LifeBuoy,
  MessageCircle, Plus, Power, Receipt, ShieldCheck, Sparkles, Star, Target,
  Users, Wand2, X,
} from "lucide-react";
import { api } from "../../data/client";
import {
  AUDIENCIAS, PRESETS_DE_AGENTE, TONS_SUGERIDOS, agruparPorAudiencia,
  avisoAoDesativar, avisoAoTornarPadrao, corDoAgent, descricaoDaSkill,
  mensagemDeErro, padraoDaAudiencia, presetPorId, rotuloDeAudiencia,
  selosDoAgent, separarSkills, skillsPreSelecionadas, tomPorId,
} from "../../domain/agents";
import { slugFromAgentName } from "../../../../../packages/intelligence/src/agent.mjs";
import { DialogoConfirmar, Iniciais } from "../ui";

const TOM_DO_SELO = {
  destaque: "bg-accent-soft text-accent-forte",
  vivo: "bg-success/10 text-success",
  apagado: "bg-surface text-faint",
};

const ICONE_DO_PRESET = {
  atendimento: MessageCircle,
  vendas: Handshake,
  qualificacao: Target,
  agenda: Calendar,
  suporte: LifeBuoy,
  cobranca: Receipt,
  equipe: Users,
  zero: Wand2,
};

function Selo({ texto, tom }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${TOM_DO_SELO[tom] || TOM_DO_SELO.apagado}`}>
      {texto}
    </span>
  );
}

/**
 * O "perfil" do agente — mesmo componente e mesmo algoritmo de cor que o
 * produto já usa para pessoas (`Iniciais`, `corDerivada`). É isso que dá a
 * cada agente uma cara reconhecível de relance, como em qualquer rede social,
 * sem depender de upload de foto — que exigiria bucket de arquivo e coluna
 * novos no banco (fora do escopo desta etapa; registrado como oportunidade
 * futura em vez de implementado às pressas).
 */
function Avatar({ agent, tamanho = 40 }) {
  return <Iniciais nome={agent?.name} tamanho={tamanho} cor={corDoAgent(agent)} />;
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

/** Cartão da lista. Um agente é uma entidade com cara própria, não uma linha de formulário. */
function CartaoAgent({ agent, ativo, aoAbrir }) {
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
        <Avatar agent={agent} tamanho={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-[13.5px] font-semibold">{agent.name}</h3>
            {selosDoAgent(agent).map((selo) => <Selo key={selo.id} texto={selo.texto} tom={selo.tom} />)}
          </div>
          <p className="mt-0.5 truncate text-[10.5px] text-sub">
            {agent.role || rotuloDeAudiencia(agent.audience)}
          </p>
        </div>
      </div>
    </button>
  );
}

/* ========================================================================== *
 * ASSISTENTE DE CRIAÇÃO — cinco telas curtas, uma decisão por tela.
 *
 * Não começa por formulário técnico. Começa pela intenção ("o que você quer
 * que esse agente faça?"), e só depois pergunta identidade, personalidade e
 * habilidades. `audience`, `slug` e o restante do vocabulário interno nunca
 * aparecem — a única exceção deliberada é o identificador técnico, que fica
 * dentro de "Configurações avançadas", fechado por padrão.
 * ========================================================================== */

const PASSOS = ["intencao", "publico", "identidade", "personalidade", "habilidades"];

function estadoInicial() {
  return {
    audience: null, name: "", role: "", tomId: null, tone: "",
    soulMarkdown: "", slug: "", slugManual: false, skillIds: [],
  };
}

export function AssistenteDeCriacao({ catalogoSkills, aoFechar, aoCriar }) {
  const [passo, setPasso] = useState(0);
  const [form, setForm] = useState(estadoInicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const campo = (chave, valor) => setForm((atual) => ({ ...atual, [chave]: valor }));

  const escolherPreset = (preset) => {
    setForm({
      ...estadoInicial(),
      audience: preset.audience,
      role: preset.role,
      tomId: preset.tomSugerido,
      tone: tomPorId(preset.tomSugerido)?.texto ?? "",
      soulMarkdown: preset.soulSugerido,
      skillIds: skillsPreSelecionadas(catalogoSkills, preset),
    });
    setPasso(1);
  };

  const escolherAudience = (audience) => {
    campo("audience", audience);
    setPasso(2);
  };

  const escolherTom = (tom) => {
    campo("tomId", tom.id);
    campo("tone", tom.texto);
  };

  const digitarNome = (nome) => {
    campo("name", nome);
    if (!form.slugManual) campo("slug", slugFromAgentName(nome, form.audience));
  };

  const digitarSlug = (slug) => {
    campo("slugManual", true);
    campo("slug", slug);
  };

  const habilidadesDisponiveis = useMemo(
    () => (catalogoSkills ?? []).filter(
      (skill) => skill?.status === "published" && [form.audience, "both"].includes(skill.audience),
    ),
    [catalogoSkills, form.audience],
  );

  const alternarSkill = (skillId) => {
    setForm((atual) => ({
      ...atual,
      skillIds: atual.skillIds.includes(skillId)
        ? atual.skillIds.filter((id) => id !== skillId)
        : [...atual.skillIds, skillId],
    }));
  };

  const concluir = async () => {
    setSalvando(true);
    setErro("");
    try {
      await aoCriar({
        name: form.name.trim(),
        audience: form.audience,
        role: form.role.trim(),
        tone: form.tone,
        soulMarkdown: form.soulMarkdown,
        slug: form.slug || undefined,
        skillIds: form.skillIds,
      });
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setSalvando(false);
    }
  };

  const voltar = () => setPasso((p) => Math.max(0, p - 1));
  const nomeValido = form.name.trim().length >= 2;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0f1424]/55 backdrop-blur-[2px] md:items-center md:p-4">
      <section className="flex h-full w-full flex-col overflow-hidden bg-bg md:h-auto md:max-h-[92vh] md:max-w-lg md:rounded-[16px] md:border md:border-line md:shadow-2xl">
        <header className="flex flex-none items-center gap-3 border-b border-line px-5 py-4">
          {passo > 0 ? (
            <button onClick={voltar} className="-ml-1.5 rounded-[8px] p-1.5 text-sub" aria-label="Voltar">
              <ArrowLeft size={18} />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[.13em] text-accent">Novo agente</p>
            <div className="mt-1 flex gap-1" role="progressbar" aria-valuenow={passo + 1} aria-valuemax={PASSOS.length}>
              {PASSOS.map((id, index) => (
                <span key={id} className={`h-1 flex-1 rounded-full ${index <= passo ? "bg-accent" : "bg-line"}`} />
              ))}
            </div>
          </div>
          <button onClick={aoFechar} className="p-2 text-sub" aria-label="Fechar"><X size={18} /></button>
        </header>

        <div className="scrollbar-fina flex-1 overflow-y-auto p-5">
          {passo === 0 ? (
            <div className="grid gap-4">
              <div>
                <h2 className="text-[17px] font-semibold">O que você quer que esse agente faça?</h2>
                <p className="mt-1 text-[11.5px] text-sub">Escolha um ponto de partida — você pode ajustar tudo depois.</p>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {PRESETS_DE_AGENTE.map((preset) => {
                  const Icone = ICONE_DO_PRESET[preset.id] ?? Bot;
                  return (
                    <button key={preset.id} onClick={() => escolherPreset(preset)}
                      className="flex flex-col items-start gap-2 rounded-[12px] border border-line bg-bg p-3.5 text-left transition hover:border-accent hover:bg-accent-soft/30">
                      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-accent-soft text-accent-forte">
                        <Icone size={17} />
                      </span>
                      <span>
                        <span className="block text-[12.5px] font-semibold">{preset.rotulo}</span>
                        <span className="block text-[10px] leading-4 text-sub">{preset.descricao}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {passo === 1 ? (
            <div className="grid gap-4">
              <div>
                <h2 className="text-[17px] font-semibold">Com quem esse agente vai conversar?</h2>
                <p className="mt-1 text-[11.5px] text-sub">Isso define o que ele pode ver e quais habilidades fazem sentido para ele.</p>
              </div>
              <div className="grid gap-2.5">
                {AUDIENCIAS.map((audiencia) => (
                  <button key={audiencia.id} onClick={() => escolherAudience(audiencia.id)}
                    className={`flex items-center gap-3 rounded-[12px] border p-4 text-left transition ${
                      form.audience === audiencia.id ? "border-accent bg-accent-soft" : "border-line hover:border-faint"
                    }`}>
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${
                      audiencia.id === "internal" ? "bg-accent-soft text-accent-forte" : "bg-[#e6f6f2] text-[#08796e]"
                    }`}>
                      {audiencia.id === "internal" ? <Users size={18} /> : <MessageCircle size={18} />}
                    </span>
                    <span>
                      <span className="block text-[13px] font-semibold">
                        {audiencia.id === "customer" ? "Clientes e leads" : "Minha equipe"}
                      </span>
                      <span className="block text-[10.5px] text-sub">{audiencia.descricao}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {passo === 2 ? (
            <div className="grid gap-4">
              <div className="flex items-center gap-3">
                <Avatar agent={{ id: "novo-agente-preview", name: form.name || "?" }} tamanho={40} />
                <div>
                  <h2 className="text-[16px] font-semibold">Como ele se chama?</h2>
                  <p className="text-[10.5px] text-sub">Atende: {rotuloDeAudiencia(form.audience)}</p>
                </div>
              </div>

              <Campo rotulo="Nome">
                <input autoFocus value={form.name} onChange={(e) => digitarNome(e.target.value)}
                  placeholder="Emília" className={entrada} />
              </Campo>

              <Campo rotulo="Função" ajuda="Como você chamaria esse papel dentro da empresa.">
                <input value={form.role} onChange={(e) => campo("role", e.target.value)} className={entrada} />
              </Campo>

              <div>
                <span className="text-[10.5px] font-semibold text-sub">Como ele deve conversar?</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {TONS_SUGERIDOS.map((tom) => (
                    <button key={tom.id} onClick={() => escolherTom(tom)}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                        form.tomId === tom.id ? "border-accent bg-accent text-white" : "border-line text-sub hover:border-accent"
                      }`}>
                      {tom.rotulo}
                    </button>
                  ))}
                </div>
                <textarea value={form.tone} onChange={(e) => { campo("tone", e.target.value); campo("tomId", null); }}
                  rows={2} placeholder="Ou descreva com suas próprias palavras…"
                  className={`${entrada} mt-2`} />
              </div>

              <details className="rounded-[10px] border border-line">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold text-sub [&::-webkit-details-marker]:hidden">
                  <ChevronDown size={14} />Configurações avançadas
                </summary>
                <div className="border-t border-line p-3">
                  <Campo rotulo="Identificador técnico" ajuda="Gerado automaticamente a partir do nome. Só mexa aqui se precisar de um valor específico.">
                    <input value={form.slug} onChange={(e) => digitarSlug(e.target.value)}
                      className={`${entrada} font-mono text-[11.5px]`} />
                  </Campo>
                </div>
              </details>

              {erro ? <p className="text-[11.5px] text-danger" role="alert">{erro}</p> : null}
              <button onClick={() => setPasso(3)} disabled={!nomeValido}
                className="rounded-[9px] bg-accent px-4 py-2.5 text-[12px] font-semibold text-white disabled:opacity-40">
                Continuar
              </button>
            </div>
          ) : null}

          {passo === 3 ? (
            <div className="grid gap-3">
              <div className="flex items-center gap-3">
                <Avatar agent={{ id: "novo-agente-preview", name: form.name }} tamanho={40} />
                <div>
                  <h2 className="text-[16px] font-semibold">Personalidade e instruções</h2>
                  <p className="text-[10.5px] text-sub">{form.name}{form.role ? ` · ${form.role}` : ""}</p>
                </div>
              </div>
              <p className="text-[11px] leading-4 text-sub">
                Explique como esse agente deve conversar, se comportar e representar sua empresa.
              </p>
              <textarea value={form.soulMarkdown} onChange={(e) => campo("soulMarkdown", e.target.value)}
                rows={8} className={`${entrada} leading-5`}
                placeholder="Ex.: recebe cada pessoa com atenção, entende o que ela precisa antes de responder e nunca soa como um robô de menu." />
              <button onClick={() => setPasso(4)}
                className="rounded-[9px] bg-accent px-4 py-2.5 text-[12px] font-semibold text-white">
                Continuar
              </button>
            </div>
          ) : null}

          {passo === 4 ? (
            <div className="grid gap-3">
              <div>
                <h2 className="text-[17px] font-semibold">O que esse agente sabe fazer?</h2>
                <p className="mt-1 text-[11.5px] text-sub">Marque as habilidades que ele pode usar. Dá para ajustar isso depois.</p>
              </div>
              {habilidadesDisponiveis.length ? (
                <div className="grid gap-2">
                  {habilidadesDisponiveis.map((skill) => {
                    const marcada = form.skillIds.includes(skill.id);
                    return (
                      <label key={skill.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-[10px] border p-3 ${
                          marcada ? "border-accent bg-accent-soft/40" : "border-line"
                        }`}>
                        <input type="checkbox" checked={marcada} onChange={() => alternarSkill(skill.id)}
                          className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-semibold">{skill.name}</span>
                          <span className="block text-[10.5px] text-sub">{descricaoDaSkill(skill)}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-[10px] border border-dashed border-line p-4 text-center text-[11px] text-sub">
                  Nenhuma habilidade publicada para essa audiência ainda. Você pode vincular depois.
                </p>
              )}

              <p className="rounded-[10px] bg-surface p-3 text-[10.5px] leading-4 text-sub">
                {form.name || "Esse agente"} vai atender como um agente comum. Quem responde primeiro continua
                sendo o agente principal — você pode tornar {form.name || "este"} o principal depois de criado.
              </p>

              {erro ? <p className="text-[11.5px] text-danger" role="alert">{erro}</p> : null}
              <button onClick={concluir} disabled={salvando}
                className="inline-flex items-center justify-center gap-2 rounded-[9px] bg-accent px-4 py-2.5 text-[12px] font-semibold text-white disabled:opacity-40">
                <Check size={14} />{salvando ? "Criando…" : "Concluir"}
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/* ========================================================================== *
 * DETALHE DO AGENTE — Geral, Personalidade, O que sabe fazer.
 * ========================================================================== */

export function DetalheAgent({ agent, catalogoSkills, canWrite, aoVoltar, acoes }) {
  const [aba, setAba] = useState("geral");
  const [avancado, setAvancado] = useState(false);
  const [bindings, setBindings] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState("");

  const original = useMemo(() => ({
    name: agent.name ?? "", slug: agent.slug ?? "", role: agent.role ?? "",
    tone: agent.tone ?? "", soulMarkdown: agent.soulMarkdown ?? "",
  }), [agent]);

  const [rascunho, setRascunho] = useState(original);

  useEffect(() => {
    setRascunho(original);
    setSalvo(false);
    setErro("");
    setAvancado(false);
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

  const abas = [["geral", "Geral"], ["personalidade", "Personalidade"], ["habilidades", "O que sabe fazer"]];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex-none border-b border-line px-4 pt-4 md:px-6">
        <div className="flex items-start gap-3">
          <button onClick={aoVoltar} className="-ml-1 rounded-[8px] p-1.5 text-sub md:hidden" aria-label="Voltar">
            <ArrowLeft size={18} />
          </button>
          <Avatar agent={agent} tamanho={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[19px] font-semibold tracking-tight">{agent.name}</h2>
              {selosDoAgent(agent).map((selo) => <Selo key={selo.id} texto={selo.texto} tom={selo.tom} />)}
            </div>
            <p className="mt-0.5 text-[11px] text-sub">
              {agent.role ? `${agent.role} · ` : ""}Atende: {rotuloDeAudiencia(agent.audience)}
            </p>
          </div>
        </div>

        {canWrite ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {agent.isDefault ? (
              <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent-soft px-3 py-1.5 text-[11px] font-semibold text-accent-forte">
                <ShieldCheck size={13} />Agente principal de {rotuloDeAudiencia(agent.audience).toLowerCase()}
              </span>
            ) : (
              <button onClick={() => acoes.tornarPadrao(agent)}
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-3 py-1.5 text-[11px] font-semibold hover:border-accent">
                <Star size={13} />Tornar principal
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
            <Campo rotulo="Função">
              <input disabled={!canWrite} value={rascunho.role}
                onChange={(e) => campo("role", e.target.value)} className={entrada} />
            </Campo>
            <Campo rotulo="Como ele conversa">
              <input disabled={!canWrite} value={rascunho.tone}
                onChange={(e) => campo("tone", e.target.value)} className={entrada} />
            </Campo>
            <Campo rotulo="Quem ele atende" ajuda="Definido na criação e imutável depois — decide qual conhecimento o agente enxerga e quais habilidades podem ser vinculadas.">
              <input disabled readOnly value={rotuloDeAudiencia(agent.audience)} className={entrada} />
            </Campo>

            <details open={avancado} onToggle={(e) => setAvancado(e.target.open)}
              className="rounded-[10px] border border-line">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold text-sub [&::-webkit-details-marker]:hidden">
                <ChevronDown size={14} />Configurações avançadas
              </summary>
              <div className="border-t border-line p-3">
                <Campo rotulo="Identificador técnico" ajuda="Identidade interna e estável deste agente. Única por organização.">
                  <input disabled={!canWrite} value={rascunho.slug}
                    onChange={(e) => campo("slug", e.target.value)} className={`${entrada} font-mono text-[11.5px]`} />
                </Campo>
              </div>
            </details>
          </div>
        ) : null}

        {aba === "personalidade" ? (
          <div className="grid max-w-2xl gap-2">
            <p className="text-[11px] leading-4 text-sub">
              Explique como esse agente deve conversar, se comportar e representar sua empresa. Aceita Markdown.
            </p>
            <textarea disabled={!canWrite} value={rascunho.soulMarkdown}
              onChange={(e) => campo("soulMarkdown", e.target.value)} rows={16}
              className={`${entrada} font-mono text-[11.5px] leading-5`} />
          </div>
        ) : null}

        {aba === "habilidades" ? (
          <div className="grid max-w-2xl gap-5">
            <section>
              <p className="mb-2 text-[10.5px] font-semibold text-sub">Sabe fazer ({vinculadas.length})</p>
              {vinculadas.length ? (
                <div className="grid gap-2">
                  {vinculadas.map((skill) => (
                    <div key={skill.id} className="flex items-center gap-3 rounded-[10px] border border-line p-3">
                      <Sparkles size={15} className="shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold">{skill.name}</p>
                        <p className="truncate text-[10.5px] text-sub">{descricaoDaSkill(skill)}</p>
                      </div>
                      {canWrite ? (
                        <button onClick={() => trocarSkill(skill.id, false)}
                          className="shrink-0 rounded-[7px] border border-line px-2.5 py-1 text-[10.5px] text-sub hover:border-danger hover:text-danger">
                          Remover
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-[10px] border border-dashed border-line p-4 text-center text-[11px] text-sub">
                  Este agente ainda não sabe fazer nada. Adicione abaixo.
                </p>
              )}
            </section>

            <section>
              <p className="mb-2 text-[10.5px] font-semibold text-sub">Pode aprender ({disponiveis.length})</p>
              {disponiveis.length ? (
                <div className="grid gap-2">
                  {disponiveis.map((skill) => (
                    <div key={skill.id} className="flex items-center gap-3 rounded-[10px] border border-line bg-surface/50 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold">{skill.name}</p>
                        <p className="truncate text-[10.5px] text-sub">{descricaoDaSkill(skill)}</p>
                      </div>
                      {canWrite ? (
                        <button onClick={() => trocarSkill(skill.id, true)}
                          className="shrink-0 rounded-[7px] bg-accent px-2.5 py-1 text-[10.5px] font-semibold text-white">
                          Adicionar
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-[10px] border border-dashed border-line p-4 text-center text-[11px] text-sub">
                  Nenhuma outra habilidade publicada para esta audiência.
                </p>
              )}
            </section>

            <p className="text-[10.5px] leading-4 text-faint">
              A mesma habilidade pode ser usada por vários agentes. Remover aqui não afeta os outros.
            </p>
          </div>
        ) : null}
      </div>

      {canWrite && aba !== "habilidades" ? (
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

/* ========================================================================== *
 * RAIZ — a lista + o detalhe (ou o assistente de criação por cima dos dois).
 * ========================================================================== */

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
      // Desligar o principal é permitido, e nada é promovido no lugar — mas
      // quem desliga precisa saber que aquela audiência para de ser atendida.
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

  const criarAgente = async ({ skillIds, ...campos }) => {
    const criado = await api.agents.criar(campos);
    if (skillIds?.length) {
      // Melhor esforço: o agente já foi criado, então uma habilidade que não
      // vinculou não pode travar o fim do assistente — o usuário ainda pode
      // adicioná-la depois, na aba "O que sabe fazer".
      await Promise.allSettled(
        skillIds.map((skillId) => api.agents.definirSkill({ agentId: criado.id, skillId, enabled: true })),
      );
    }
    await recarregar();
    setCriando(false);
    if (criado?.id) setSelecionadoId(criado.id);
  };

  if (carregando) {
    return <div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando agentes…</div>;
  }
  if (erro) {
    return <div className="flex flex-1 items-center justify-center p-8 text-center text-[12.5px] text-danger" role="alert">{erro}</div>;
  }

  const lista = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none px-4 pt-4 md:px-5">
        <h2 className="text-[19px] font-semibold tracking-tight">Seus agentes</h2>
        <p className="mt-1 text-[11.5px] text-sub">
          Crie agentes especializados para atender seus clientes e ajudar sua equipe.
        </p>
        {canWrite ? (
          <button onClick={() => setCriando(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-[9px] bg-accent px-3.5 py-2.5 text-[12px] font-semibold text-white">
            <Plus size={15} />Criar agente
          </button>
        ) : null}
      </div>

      {falha ? <p className="mx-4 mt-3 rounded-[9px] bg-danger/10 p-2.5 text-[11.5px] text-danger md:mx-5" role="alert">{falha}</p> : null}

      <div className="scrollbar-fina min-h-0 flex-1 space-y-5 overflow-y-auto p-4 pt-4 md:p-5">
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
          Liberação de atendimento, marca e política de sessão continuam em “Liberação e marca”.
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
                Cada agente tem identidade, personalidade e habilidades próprias. Quem responde a uma
                audiência é sempre o agente principal dela.
              </p>
            </div>
          )}
        </main>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-bg md:hidden">
        {detalhe || lista}
      </div>

      {criando ? (
        <AssistenteDeCriacao catalogoSkills={catalogoSkills} aoFechar={() => setCriando(false)} aoCriar={criarAgente} />
      ) : null}

      <DialogoConfirmar pedido={pedido} aoFechar={() => setPedido(null)} />
    </>
  );
}
