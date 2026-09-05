import { useEffect, useState } from "react";
import {
  ArrowLeft, Bot, BookOpen, Eye, FlaskConical, Plus,
  RotateCcw, Save, Sparkles,
} from "lucide-react";
import { api } from "../../../data/client";
import { CUSTOMER_ROLLOUT_MODES, rolloutMode } from "../../../domain/customerAssistant";
import { Iniciais } from "../../ui";
import { publicoDoDocumento, situacaoDoDocumento } from "../conhecimento/conhecimentoDados";

/**
 * "Agentes" é a Central vista pelo que ela é: uma equipe, não um formulário.
 *
 * O banco hoje só permite 1 perfil por público (`internal`/`customer`) por
 * organização — não existe rota para criar um terceiro. Por isso a home
 * mostra exatamente os agentes reais, agrupados por quem atendem, e o botão
 * "Novo agente" fica visível porém desativado: sinaliza o roadmap sem
 * prometer uma ação que ainda não existe.
 */

const assistantDraft = (profile, data) => ({
  nome: profile.display_name || "", tom: profile.tone || "", ativo: profile.active ?? true,
  marca: profile.brand_config?.brandName || "", saudacao: profile.brand_config?.greeting || "",
  processo: profile.process_config?.instructions || "",
  contextoHoras: profile.process_config?.sessionPolicy?.contextHours ?? 24,
  subfluxoHoras: profile.process_config?.sessionPolicy?.subflowHours ?? 2,
  confirmacaoMinutos: profile.process_config?.sessionPolicy?.confirmationMinutes ?? 30,
  rolloutMode: rolloutMode(profile),
});

const tonePresets = [
  ["Natural e profissional", "Cordial, natural, profissional e objetivo. Use linguagem simples, demonstre interesse genuíno e evite respostas robóticas."],
  ["Direto e organizado", "Claro, direto, colaborativo e organizado. Responda de forma natural, com passos curtos e sem expor termos técnicos internos."],
  ["Consultivo e acolhedor", "Acolhedor, consultivo e paciente. Entenda o contexto antes de orientar e faça uma pergunta por vez."],
];

const DETAIL_TABS = [
  ["overview", "Visão geral"], ["personality", "Personalidade"],
  ["skills", "Habilidades"], ["knowledge", "Conhecimento"],
];

/** Mesma frase em toda parte: o card e o cabeçalho do detalhe não podem divergir. */
const funcaoDoAgente = (internal) => (internal ? "Apoio interno" : "Atendimento a clientes");

/**
 * Cartão de perfil, não linha de cadastro.
 *
 * "Principal" está sempre certo hoje porque só existe 1 perfil por público —
 * é o próprio, por ser o único, quem atende aquele público. O dia em que o
 * banco permitir mais de um por público (ver docs/intelligence/
 * MULTI-AGENT-MIGRATION.md), isto passa a ler um campo real em vez de `true`.
 */
function AgentCard({ profile, draft, bound, onOpen }) {
  const internal = profile.audience === "internal";
  const nome = draft.marca.trim() || draft.nome.trim() || (internal ? "Assistente interno" : "Assistente da empresa");
  const descricao = internal
    ? "Ajuda a equipe com agenda, tarefas e informações internas."
    : "Atende clientes, responde dúvidas e qualifica leads pelo WhatsApp.";
  const rolloutLabel = !internal && CUSTOMER_ROLLOUT_MODES.find((mode) => mode.id === draft.rolloutMode)?.label;
  const statusLabel = draft.ativo ? (internal ? "Ativo" : rolloutLabel) : "Pausado";
  const principal = true;
  const tags = [internal ? "Equipe" : "Clientes", ...bound.slice(0, 2).map((skill) => skill.name), "WhatsApp"].slice(0, 4);
  const banner = internal
    ? "linear-gradient(160deg, var(--el-accent-soft), var(--el-bg))"
    : "linear-gradient(160deg, #e6f6f2, var(--el-bg))";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col overflow-hidden rounded-[16px] border border-line bg-bg text-left transition hover:border-line-strong hover:shadow-[0_12px_28px_-20px_rgba(18,23,48,.35)]"
    >
      <div className="relative flex h-[92px] flex-none items-center justify-center" style={{ background: banner }}>
        <Iniciais nome={nome} tamanho={44} cor={internal ? "var(--el-accent)" : "#0f9f8f"} />
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
          <span className={`h-1.5 w-1.5 rounded-full ${draft.ativo ? "bg-success" : "bg-white/50"}`} />
          {statusLabel}
        </span>
        {principal && (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.1 6.5L12 17.5l-5.8 3 1.1-6.5-4.8-4.6 6.6-.9z" /></svg>
            Principal
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div>
          <strong className="block truncate text-[14px] font-semibold text-fg">{nome}</strong>
          <p className="mt-0.5 text-[11.5px] text-sub">{funcaoDoAgente(internal)}</p>
        </div>
        <p className="text-[11.5px] leading-[1.35] text-sub">{descricao}</p>
        <div className="mt-auto flex flex-wrap gap-1 pt-1">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full bg-surface px-2 py-0.5 text-[9.5px] font-medium text-sub">{tag}</span>
          ))}
        </div>
      </div>
    </button>
  );
}

function AgentKnowledgeTab({ internal, onOpenKnowledge }) {
  const [documentos, setDocumentos] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let cancelado = false;
    api.conhecimento.listar()
      .then((dados) => { if (!cancelado) setDocumentos(dados || []); })
      .catch((e) => { if (!cancelado) setErro(e.message); });
    return () => { cancelado = true; };
  }, []);

  const alvo = internal ? "equipe" : "clientes";
  const visiveis = (documentos || []).filter(
    (documento) => publicoDoDocumento(documento) === alvo && situacaoDoDocumento(documento) === "publicado",
  );

  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[.09em] text-sub">Conhecimento que este agente consulta</p>
      {documentos === null && !erro && <p className="mt-3 text-[11.5px] text-sub">Carregando…</p>}
      {erro && <p className="mt-3 text-[11.5px] text-danger">{erro}</p>}
      {documentos !== null && (
        <>
          <p className="mt-1 text-[10.5px] text-sub">{visiveis.length} documento(s) publicado(s) para {internal ? "a equipe" : "clientes"}.</p>
          <div className="mt-3 grid gap-2">
            {visiveis.slice(0, 6).map((documento) => (
              <div key={documento.id} className="flex items-center gap-2 rounded-[10px] border border-line bg-surface/60 px-3 py-2.5">
                <BookOpen size={14} className="flex-none text-sub" />
                <strong className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-fg">{documento.titulo}</strong>
              </div>
            ))}
            {!visiveis.length && (
              <p className="rounded-[10px] border border-dashed border-line p-4 text-center text-[10.5px] text-sub">
                Nenhum documento publicado para este público ainda.
              </p>
            )}
          </div>
          <button type="button" onClick={onOpenKnowledge} className="mt-3 text-[11px] font-semibold text-accent-forte hover:underline">
            Abrir Conhecimento
          </button>
        </>
      )}
    </div>
  );
}

function AgentDetail({
  profile, draft, dirty, update, canWrite, saving, saved,
  discard, save, onTest, onManageSkills, onOpenAccess, onOpenKnowledge, bound, onBack,
}) {
  const [tab, setTab] = useState("overview");
  const internal = profile.audience === "internal";
  const previewName = draft.marca.trim() || draft.nome.trim() || (internal ? "Assistente interno" : "Assistente da empresa");
  const previewGreeting = draft.saudacao.trim() || (internal ? "Olá! Como posso ajudar você agora?" : "Olá! Como posso ajudar você hoje?");
  const accentBg = internal ? "bg-accent" : "bg-[#0f9f8f]";
  const rolloutLabel = !internal && CUSTOMER_ROLLOUT_MODES.find((mode) => mode.id === draft.rolloutMode)?.label;

  return (
    <div className="scrollbar-fina flex-1 overflow-y-auto p-4 md:p-7">
      <div className="mx-auto max-w-6xl">

        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[12.5px] text-sub hover:text-fg">
          <ArrowLeft size={15} /> Agentes
        </button>

        <div className="mt-3 flex flex-wrap items-start gap-4">
          <Iniciais nome={previewName} tamanho={56} cor={internal ? null : "#0f9f8f"} />
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-[22px] font-semibold tracking-tight">{previewName}</h2>
            <p className="mt-0.5 text-[12.5px] text-sub">{funcaoDoAgente(internal)}</p>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button" role="switch" aria-label="Ativar ou pausar agente" aria-checked={draft.ativo}
              disabled={!canWrite} onClick={() => update("ativo", !draft.ativo)}
              className={`relative h-6 w-11 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 ${draft.ativo ? accentBg : "bg-faint/50"}`}
            >
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${draft.ativo ? "left-6" : "left-1"}`} />
            </button>
            <span className="text-[11.5px] font-medium text-sub">{draft.ativo ? "Ativo" : "Pausado"}</span>
          </div>
        </div>

        <nav className="mt-6 flex gap-6 overflow-x-auto border-b border-line">
          {DETAIL_TABS.map(([id, label]) => (
            <button
              key={id} type="button" onClick={() => setTab(id)}
              className={`min-w-fit border-b-2 pb-2.5 text-[13px] ${tab === id ? "border-accent font-semibold text-fg" : "border-transparent font-medium text-sub"}`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">

            {tab === "overview" && (
              <div className="grid gap-7">
                <fieldset disabled={!canWrite} className="grid gap-3">
                  <label className="text-[10.5px] font-semibold text-sub">Nome exibido
                    <input
                      value={draft.marca} onChange={(event) => update("marca", event.target.value)}
                      placeholder={internal ? "Ex.: Núcleo Major" : "Ex.: Assistente Major"}
                      className="mt-1.5 w-full rounded-[9px] border border-line bg-bg px-3 py-2.5 text-[12.5px] font-normal outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
                    />
                  </label>
                  <label className="text-[10.5px] font-semibold text-sub">Saudação inicial
                    <textarea
                      value={draft.saudacao} onChange={(event) => update("saudacao", event.target.value)}
                      placeholder="Como iniciar uma nova conversa" rows={2}
                      className="mt-1.5 w-full resize-y rounded-[9px] border border-line bg-bg px-3 py-2.5 text-[12.5px] font-normal leading-5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
                    />
                  </label>
                </fieldset>

                <fieldset disabled={!canWrite} className="grid gap-3 border-t border-line pt-6">
                  <p className="text-[11px] font-bold uppercase tracking-[.09em] text-sub">Como este agente deve trabalhar</p>
                  <textarea
                    value={draft.processo} onChange={(event) => update("processo", event.target.value)}
                    placeholder="Ex.: entenda a necessidade antes de apresentar uma solução; não invente condições; transfira exceções comerciais…"
                    rows={7}
                    className="w-full resize-y rounded-[9px] border border-line bg-bg p-3 text-[12.5px] leading-5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
                  />
                  {!internal && (
                    <div className="rounded-[11px] border border-line bg-surface/70 p-3">
                      <p className="text-[10.5px] font-semibold text-fg">Memória da conversa</p>
                      <p className="mt-1 text-[9.5px] text-sub">Após estes períodos, o atendimento volta com segurança para a Recepção.</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        {[["contextoHoras", "Conversa", "horas", 1, 168], ["subfluxoHoras", "Habilidade", "horas", 1, 24], ["confirmacaoMinutos", "Confirmação", "minutos", 5, 120]].map(([key, label, suffix, min, max]) => (
                          <label key={key} className="text-[9.5px] font-semibold text-sub">{label}
                            <span className="mt-1 flex items-center rounded-[8px] border border-line bg-bg">
                              <input type="number" min={min} max={max} value={draft[key]} onChange={(event) => update(key, event.target.value)} className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-[11.5px] font-normal outline-none" />
                              <span className="pr-2 text-[8.5px] text-faint">{suffix}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </fieldset>

                {!internal && (
                  <div className="flex items-center gap-2 border-t border-line pt-5 text-[12px]">
                    <span className="text-sub">Liberação para clientes: <strong className="text-fg">{rolloutLabel}</strong></span>
                    <button type="button" onClick={onOpenAccess} className="ml-auto text-[11px] font-semibold text-accent-forte hover:underline">
                      Gerenciar em Acessos
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === "personality" && (
              <fieldset disabled={!canWrite} className="grid gap-3">
                <p className="text-[11px] font-bold uppercase tracking-[.09em] text-sub">Forma de conversar</p>
                <div className="flex flex-wrap gap-2">
                  {tonePresets.map(([label, value]) => (
                    <button
                      type="button" key={label} onClick={() => update("tom", value)}
                      className={`rounded-full border px-3 py-1.5 text-[9.5px] transition ${draft.tom === value ? (internal ? "border-accent bg-accent-soft text-accent-forte" : "border-[#0f9f8f] bg-[#e6f6f2] text-[#08796e]") : "border-line bg-bg text-sub hover:border-faint"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={draft.tom} onChange={(event) => update("tom", event.target.value)} rows={6}
                  className="mt-1 w-full resize-y rounded-[9px] border border-line bg-bg px-3 py-2.5 text-[12.5px] font-normal leading-5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10"
                />
              </fieldset>
            )}

            {tab === "skills" && (
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-[.09em] text-sub">Habilidades disponíveis</p>
                  <button type="button" onClick={onManageSkills} className="ml-auto text-[11px] font-semibold text-accent-forte hover:underline">Ver catálogo</button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {bound.map((skill) => (
                    <div key={skill.id} className="rounded-[10px] border border-line bg-surface/60 p-3">
                      <div className="flex items-center gap-2">
                        <Sparkles size={14} className={internal ? "text-accent-forte" : "text-[#08796e]"} />
                        <strong className="text-[11px]">{skill.name}</strong>
                        <span className="ml-auto text-[8.5px] text-faint">v{skill.current_version}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[9.5px] leading-4 text-sub">{skill.description}</p>
                    </div>
                  ))}
                  {!bound.length && <p className="rounded-[10px] border border-dashed border-line p-4 text-center text-[10.5px] text-sub sm:col-span-2">Nenhuma habilidade vinculada.</p>}
                </div>
              </div>
            )}

            {tab === "knowledge" && <AgentKnowledgeTab internal={internal} onOpenKnowledge={onOpenKnowledge} />}

          </div>

          <aside className="min-w-0">
            <div className="sticky top-4">
              <div className="flex items-center gap-2"><Eye size={15} className="text-accent-forte" /><h4 className="text-[12px] font-semibold">Prévia da conversa</h4></div>
              <p className="mt-1 text-[10px] leading-4 text-sub">Ilustrativa — como identidade e saudação aparecem.</p>
              <div className="mt-3 overflow-hidden rounded-[16px] border border-line bg-[#efeae2] shadow-sm">
                <div className="flex items-center gap-2 bg-[#075e54] px-3 py-2.5 text-white">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15"><Bot size={16} /></span>
                  <div className="min-w-0"><p className="truncate text-[10.5px] font-semibold">{previewName}</p><p className="text-[8.5px] text-white/70">online</p></div>
                </div>
                <div className="min-h-56 space-y-2.5 p-3 text-[10px] leading-4">
                  <div className="max-w-[88%] rounded-[8px] rounded-tl-none bg-white px-3 py-2 shadow-sm">{previewGreeting}</div>
                  <div className="ml-auto max-w-[84%] rounded-[8px] rounded-tr-none bg-[#d9fdd3] px-3 py-2 shadow-sm">{internal ? "Pode consultar minha agenda de amanhã?" : "Olá, quero entender como funciona."}</div>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <footer className="mt-8 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
          <span className={`text-[10px] ${dirty ? "text-[#b56a15]" : saved ? "text-success" : "text-faint"}`}>
            {dirty ? "Alterações não salvas" : saved ? "Alterações salvas" : "Tudo salvo"}
          </span>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {canWrite && (
              <button type="button" onClick={discard} disabled={!dirty || saving} className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-2 text-[10.5px] font-semibold text-sub disabled:opacity-35">
                <RotateCcw size={13} />Descartar
              </button>
            )}
            <button
              type="button" onClick={onTest} disabled={dirty}
              title={dirty ? "Salve as mudanças antes de testar" : "Abrir teste do agente"}
              className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-2 text-[10.5px] font-semibold text-fg disabled:cursor-not-allowed disabled:opacity-35"
            >
              <FlaskConical size={13} />Testar agente
            </button>
            {canWrite && (
              <button type="button" onClick={save} disabled={!dirty || saving || !draft.nome.trim()} className={`inline-flex items-center gap-1.5 rounded-[9px] px-4 py-2 text-[10.5px] font-semibold text-white disabled:opacity-35 ${accentBg}`}>
                <Save size={13} />{saving ? "Salvando…" : "Salvar mudanças"}
              </button>
            )}
          </div>
        </footer>

      </div>
    </div>
  );
}

export default function Agentes({ data, canWrite, reload, fail, onTest, onManageSkills, onOpenAccess, onOpenKnowledge }) {
  const [drafts, setDrafts] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDrafts(Object.fromEntries(data.profiles.map((profile) => [profile.id, assistantDraft(profile, data)])));
  }, [data.profiles, data.pilotContacts]);

  const boundFor = (profile) => data.bindings.filter((item) => item.profile_id === profile.id && item.enabled)
    .map((item) => data.skills.find((skill) => skill.id === item.skill_id)).filter(Boolean);

  const selected = data.profiles.find((profile) => profile.id === selectedId) || null;
  const draft = selected ? drafts[selected.id] || assistantDraft(selected, data) : null;
  const original = selected ? assistantDraft(selected, data) : null;
  const dirty = Boolean(draft && original && JSON.stringify(draft) !== JSON.stringify(original));

  const update = (key, value) => setDrafts((current) => ({ ...current, [selected.id]: { ...current[selected.id], [key]: value } }));

  const discard = () => {
    if (selected) setDrafts((current) => ({ ...current, [selected.id]: assistantDraft(selected, data) }));
    setSaved(false);
  };

  const save = async () => {
    if (!selected || !draft || !dirty) return;
    setSaving(true); setSaved(false); fail("");
    try {
      await api.inteligencia.salvarPerfil({
        id: selected.id, nome: draft.nome, tom: draft.tom, ativo: draft.ativo,
        marca: { ...selected.brand_config, brandName: draft.marca, greeting: draft.saudacao },
        processo: {
          ...selected.process_config, instructions: draft.processo,
          sessionPolicy: {
            contextHours: Number(draft.contextoHoras), subflowHours: Number(draft.subfluxoHoras),
            confirmationMinutes: Number(draft.confirmacaoMinutos),
          },
        },
      });
      await reload();
      setSaved(true);
    } catch (error) { fail(error.message); }
    finally { setSaving(false); }
  };

  const openProfile = (profile) => { setSaved(false); setSelectedId(profile.id); };
  const back = () => {
    if (dirty && !confirm("Descartar as alterações ainda não salvas deste agente?")) return;
    setSelectedId(null); setSaved(false);
  };

  if (selected && draft) {
    return (
      <AgentDetail
        profile={selected} draft={draft} dirty={dirty} update={update} canWrite={canWrite}
        saving={saving} saved={saved} discard={discard} save={save} onTest={onTest}
        onManageSkills={onManageSkills} onOpenAccess={onOpenAccess} onOpenKnowledge={onOpenKnowledge}
        bound={boundFor(selected)} onBack={back}
      />
    );
  }

  const customer = data.profiles.find((profile) => profile.audience === "customer");
  const internal = data.profiles.find((profile) => profile.audience === "internal");

  return (
    <div className="scrollbar-fina flex-1 overflow-y-auto p-4 md:p-7">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.14em] text-accent">Central de inteligência</p>
            <h2 className="mt-1 text-[20px] font-semibold tracking-tight">Sua equipe de IA</h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-5 text-sub">Cada agente atende um público certo e possui responsabilidades específicas.</p>
          </div>
          <button
            type="button" disabled
            title="Em breve — criar novos agentes depende de uma atualização futura"
            className="mt-2 inline-flex w-fit cursor-not-allowed items-center gap-2 rounded-[9px] bg-accent px-4 py-2.5 text-[12px] font-semibold text-white opacity-40 md:ml-auto"
          >
            <Plus size={15} />Novo agente
            <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide">em breve</span>
          </button>
        </div>

        {customer && (
          <div className="mt-7">
            <p className="text-[11px] font-bold uppercase tracking-[.10em] text-sub">Atende clientes</p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <AgentCard profile={customer} draft={drafts[customer.id] || assistantDraft(customer, data)} bound={boundFor(customer)} onOpen={() => openProfile(customer)} />
            </div>
          </div>
        )}

        {internal && (
          <div className="mt-9">
            <p className="text-[11px] font-bold uppercase tracking-[.10em] text-sub">Equipe interna</p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <AgentCard profile={internal} draft={drafts[internal.id] || assistantDraft(internal, data)} bound={boundFor(internal)} onOpen={() => openProfile(internal)} />
            </div>
          </div>
        )}

        {!customer && !internal && (
          <div className="mt-10 flex flex-1 items-center justify-center p-8 text-center text-[12px] text-sub">
            Nenhum agente foi configurado para esta organização.
          </div>
        )}
      </div>
    </div>
  );
}
