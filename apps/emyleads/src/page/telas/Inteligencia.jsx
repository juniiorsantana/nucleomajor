import { useEffect, useMemo, useState } from "react";
import {
  Bot, BookOpen, Check, ChevronLeft, ChevronRight, FlaskConical, History,
  Eye, Layers3, LayoutGrid, List, Megaphone, MessageCircle, Plus, RotateCcw,
  Save, Settings2, ShieldCheck, Sparkles, Users, WandSparkles, X,
} from "lucide-react";
import { api } from "../../data/client";
import { CUSTOMER_ROLLOUT_MODES, maskPhone, rolloutMode } from "../../domain/customerAssistant";
import { resolverRotaSkill } from "../../domain/intelligenceRouter";
import Conhecimento from "./Conhecimento";
import Agents from "./Agents";
import "./skills-catalog.css";

// ETAPA 12B.1: a ordem prioriza o que o usuário administra primeiro — os
// agentes — e empurra o que é avançado/legado para o fim. "Habilidades" aqui
// é o catálogo (criar/publicar/versionar); dentro de um agente, a mesma
// coisa aparece como "O que sabe fazer" — nomes diferentes de propósito,
// porque são perguntas diferentes ("o que existe" vs "o que ESTE usa").
// "Assistentes" virou "Liberação e marca": é o que ela de fato configura
// (rollout, marca, política de sessão) — ela continua existindo porque a
// FASE F ainda não tem operação equivalente para essas três coisas.
const tabs = [
  ["agents", "Agentes", Bot],
  ["knowledge", "Conhecimento", BookOpen],
  ["skills", "Habilidades", WandSparkles],
  ["campaigns", "Campanhas", Megaphone],
  ["history", "Histórico", History],
  ["simulator", "Simulador", FlaskConical],
  ["assistants", "Liberação e marca", Settings2],
];
const list = (value) => String(value || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
const date = (value) => value ? new Date(value).toLocaleString("pt-BR") : "—";
const emptyData = { profiles: [], skills: [], skillVersions: [], bindings: [], collections: [], documentCollections: [], campaigns: [], sources: [], campaignSkills: [], campaignCollections: [], audit: [], pilotContacts: [], contacts: [] };

function Trail({ context }) {
  const items = [["Assistente", context?.assistente?.nome], ["Skill", context?.skillAtivo?.nome], ["Campanha", context?.campanha?.nome || "Sem campanha"], ["Conhecimento", `${context?.colecoesPermitidas?.length || 0} coleção(ões)`]];
  return <div className="flex flex-wrap items-center gap-1.5 rounded-[12px] border border-accent/20 bg-accent-soft/60 p-2.5">{items.map(([label, value], index) => <div key={label} className="flex items-center gap-1.5"><span className="rounded-[8px] border border-line bg-bg px-2.5 py-1.5 text-[10.5px] text-sub"><strong className="mr-1 text-fg">{label}</strong>{value || "Não definido"}</span>{index < items.length - 1 && <ChevronRight size={13} className="text-accent-forte" />}</div>)}</div>;
}

const assistantDraft = (profile, data = emptyData) => ({
  nome: profile.display_name || "", tom: profile.tone || "", ativo: profile.active ?? true,
  marca: profile.brand_config?.brandName || "", saudacao: profile.brand_config?.greeting || "",
  processo: profile.process_config?.instructions || "",
  contextoHoras: profile.process_config?.sessionPolicy?.contextHours ?? 24,
  subfluxoHoras: profile.process_config?.sessionPolicy?.subflowHours ?? 2,
  confirmacaoMinutos: profile.process_config?.sessionPolicy?.confirmationMinutes ?? 30,
  rolloutMode: rolloutMode(profile),
  pilotContactIds: data.pilotContacts.filter((item) => item.profile_id === profile.id && item.active).map((item) => item.contact_id),
});
const tonePresets = [
  ["Natural e profissional", "Cordial, natural, profissional e objetivo. Use linguagem simples, demonstre interesse genuíno e evite respostas robóticas."],
  ["Direto e organizado", "Claro, direto, colaborativo e organizado. Responda de forma natural, com passos curtos e sem expor termos técnicos internos."],
  ["Consultivo e acolhedor", "Acolhedor, consultivo e paciente. Entenda o contexto antes de orientar e faça uma pergunta por vez."],
];

function RolloutControl({ draft, contacts, update, disabled }) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const visible = contacts.filter((contact) => !term || [contact.name, contact.company, contact.phone, contact.whatsapp_id].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(term)));
  const toggleContact = (contactId, checked) => update("pilotContactIds", checked ? [...new Set([...draft.pilotContactIds, contactId])] : draft.pilotContactIds.filter((id) => id !== contactId));
  return <fieldset disabled={disabled} className="grid gap-3 border-t border-line pt-5"><legend className="mb-1 flex items-center gap-2 text-[12px] font-semibold"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0f9f8f] text-[10px] font-bold text-white">4</span>Liberação do atendimento</legend><p className="-mt-2 pl-8 text-[10.5px] text-sub">Defina com segurança quem pode receber respostas pelo WhatsApp principal.</p><div className="grid gap-2 md:grid-cols-3">{CUSTOMER_ROLLOUT_MODES.map((mode, index) => { const selected = draft.rolloutMode === mode.id; return <label key={mode.id} className={`relative cursor-pointer rounded-[11px] border p-3 transition ${selected ? "border-[#0f9f8f] bg-[#e6f6f2] shadow-sm" : "border-line bg-bg hover:border-faint"}`}><input type="radio" name="customer-rollout" value={mode.id} checked={selected} onChange={() => update("rolloutMode", mode.id)} className="sr-only" /><span className="flex items-center gap-2"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold ${selected ? "bg-[#0f9f8f] text-white" : "bg-surface text-faint"}`}>{index + 1}</span><strong className="text-[11px]">{mode.label}</strong></span><span className="mt-2 block text-[9.5px] leading-4 text-sub">{mode.description}</span></label>; })}</div>{draft.rolloutMode === "pilot" && <div className="rounded-[12px] border border-[#0f9f8f]/25 bg-[#f5fbfa] p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center"><div><strong className="text-[11px]">Contatos autorizados no piloto</strong><p className="mt-0.5 text-[9.5px] text-sub">Eles continuam sendo clientes no CRM; não recebem permissão de operador.</p></div><span className="rounded-full bg-[#e6f6f2] px-2.5 py-1 text-[9px] font-semibold text-[#08796e] sm:ml-auto">{draft.pilotContactIds.length} selecionado(s)</span></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, empresa ou telefone" className="mt-3 w-full rounded-[9px] border border-line bg-bg px-3 py-2 text-[11px] outline-none focus:border-[#0f9f8f]" /><div className="scrollbar-fina mt-2 max-h-48 overflow-y-auto rounded-[9px] border border-line bg-bg">{visible.length ? visible.map((contact) => <label key={contact.id} className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2.5 last:border-0 hover:bg-surface"><input type="checkbox" checked={draft.pilotContactIds.includes(contact.id)} onChange={(event) => toggleContact(contact.id, event.target.checked)} className="accent-[#0f9f8f]" /><span className="min-w-0 flex-1"><strong className="block truncate text-[10.5px]">{contact.name || "Contato sem nome"}</strong><span className="block truncate text-[9px] text-sub">{contact.company || "Sem empresa"} · {maskPhone(contact.phone || contact.whatsapp_id)}</span></span></label>) : <p className="p-5 text-center text-[10px] text-sub">Nenhum contato encontrado. Cadastre o número de teste em Contatos primeiro.</p>}</div></div>}</fieldset>;
}

function Assistants({ data, canWrite, reload, fail, onTest, onManageSkills }) {
  const [drafts, setDrafts] = useState({}); const [selectedId, setSelectedId] = useState(data.profiles[0]?.id || null); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false);
  useEffect(() => { setDrafts(Object.fromEntries(data.profiles.map((profile) => [profile.id, assistantDraft(profile, data)]))); setSelectedId((current) => data.profiles.some((profile) => profile.id === current) ? current : data.profiles[0]?.id || null); }, [data.profiles, data.pilotContacts]);
  const selected = data.profiles.find((profile) => profile.id === selectedId) || data.profiles[0]; const draft = selected ? drafts[selected.id] || assistantDraft(selected, data) : null; const original = selected ? assistantDraft(selected, data) : null;
  const dirty = Boolean(draft && original && JSON.stringify(draft) !== JSON.stringify(original));
  const boundFor = (profile) => data.bindings.filter((item) => item.profile_id === profile.id && item.enabled).map((item) => data.skills.find((skill) => skill.id === item.skill_id)).filter(Boolean);
  const update = (key, value) => setDrafts((current) => ({ ...current, [selected.id]: { ...current[selected.id], [key]: value } }));
  const choose = (profile) => { if (profile.id === selectedId) return; if (dirty && !confirm("Descartar as alterações ainda não salvas deste assistente?")) return; setSaved(false); setSelectedId(profile.id); };
  const discard = () => { if (selected) setDrafts((current) => ({ ...current, [selected.id]: assistantDraft(selected, data) })); setSaved(false); };
  const save = async () => { if (!selected || !draft || !dirty) return; if (selected.audience === "customer" && draft.rolloutMode === "pilot" && !draft.pilotContactIds.length) { fail("Selecione ao menos um contato do CRM para ativar o piloto."); return; } setSaving(true); setSaved(false); fail(""); try { await api.inteligencia.salvarPerfil({ id: selected.id, nome: draft.nome, tom: draft.tom, ativo: draft.ativo, marca: { ...selected.brand_config, brandName: draft.marca, greeting: draft.saudacao }, processo: { ...selected.process_config, instructions: draft.processo, sessionPolicy: { contextHours: Number(draft.contextoHoras), subflowHours: Number(draft.subfluxoHoras), confirmationMinutes: Number(draft.confirmacaoMinutos) } } }); if (selected.audience === "customer") await api.inteligencia.configurarRollout({ profileId: selected.id, mode: draft.rolloutMode, contactIds: draft.pilotContactIds }); await reload(); setSaved(true); } catch (error) { fail(error.message); } finally { setSaving(false); } };
  if (!selected || !draft) return <div className="flex flex-1 items-center justify-center p-8 text-center text-[12px] text-sub">Nenhum assistente foi configurado para esta organização.</div>;
  const internal = selected.audience === "internal"; const bound = boundFor(selected); const previewName = draft.marca.trim() || draft.nome.trim() || (internal ? "Assistente interno" : "Assistente da empresa"); const previewGreeting = draft.saudacao.trim() || (internal ? "Olá! Como posso ajudar você agora?" : "Olá! Como posso ajudar você hoje?");
  return <div className="scrollbar-fina flex-1 overflow-y-auto p-4 md:p-7"><div className="mx-auto max-w-6xl"><div className="flex flex-col gap-2 md:flex-row md:items-end"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-accent">Configuração dos assistentes</p><h2 className="mt-1 text-[20px] font-semibold tracking-tight">Quem o assistente atende?</h2><p className="mt-1 max-w-2xl text-[12px] leading-5 text-sub">Escolha um público para configurar sua identidade, forma de conversar e habilidades. Cada fronteira protege um tipo de informação.</p></div><span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-bg px-3 py-1.5 text-[10px] text-sub md:ml-auto"><ShieldCheck size={13} className="text-success" />Permissões protegidas</span></div>
    <div className="mt-5 grid gap-3 md:grid-cols-2">{data.profiles.map((profile) => { const profileDraft = drafts[profile.id] || assistantDraft(profile, data); const profileInternal = profile.audience === "internal"; const skills = boundFor(profile); const active = selected.id === profile.id; const rolloutLabel = CUSTOMER_ROLLOUT_MODES.find((item) => item.id === profileDraft.rolloutMode)?.label; return <button type="button" key={profile.id} onClick={() => choose(profile)} aria-pressed={active} className={`group relative overflow-hidden rounded-[15px] border bg-bg p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active ? profileInternal ? "border-accent shadow-[0_8px_30px_rgba(79,70,229,.10)]" : "border-[#0f9f8f] shadow-[0_8px_30px_rgba(15,159,143,.10)]" : "border-line hover:border-faint"}`}><span className={`absolute inset-y-0 left-0 w-1 ${profileInternal ? "bg-accent" : "bg-[#0f9f8f]"}`} /><div className="flex items-start gap-3 pl-1"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] ${profileInternal ? "bg-accent-soft text-accent-forte" : "bg-[#e6f6f2] text-[#08796e]"}`}>{profileInternal ? <Users size={20} /> : <MessageCircle size={20} />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-[9.5px] font-bold uppercase tracking-[.12em] text-faint">{profileInternal ? "Equipe e profissionais" : "Atendimento a clientes"}</p><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ${profileDraft.ativo ? "bg-success/10 text-success" : "bg-surface text-faint"}`}><span className={`h-1.5 w-1.5 rounded-full ${profileDraft.ativo ? "bg-success" : "bg-faint"}`} />{profileDraft.ativo ? profileInternal ? "Ativo" : rolloutLabel : "Pausado"}</span></div><h3 className="mt-1 truncate text-[15px] font-semibold">{profileDraft.marca || profileDraft.nome || "Sem nome definido"}</h3><p className="mt-1 line-clamp-2 text-[10.5px] leading-4 text-sub">{profileInternal ? "Ajuda profissionais usando cargo, agenda e conhecimento interno autorizado." : "Conversa com clientes usando somente conteúdo externo publicado."}</p><div className="mt-3 flex flex-wrap items-center gap-1.5"><span className="rounded-full bg-surface px-2 py-1 text-[9px] text-sub">{skills.length} {skills.length === 1 ? "habilidade" : "habilidades"}</span><span className="rounded-full bg-surface px-2 py-1 text-[9px] text-sub">{profileInternal ? "Conteúdo interno" : "Conteúdo publicado"}</span></div></div><span className={`mt-1 rounded-[8px] px-2.5 py-1.5 text-[9.5px] font-semibold ${active ? profileInternal ? "bg-accent text-white" : "bg-[#0f9f8f] text-white" : "bg-surface text-sub group-hover:text-fg"}`}>{active ? "Configurando" : "Configurar"}</span></div></button>; })}</div>
    <section className="mt-5 overflow-hidden rounded-[16px] border border-line bg-bg"><header className="flex flex-col gap-3 border-b border-line bg-surface/50 px-4 py-4 md:flex-row md:items-center md:px-5"><div className="flex items-center gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-[11px] ${internal ? "bg-accent-soft text-accent-forte" : "bg-[#e6f6f2] text-[#08796e]"}`}><Settings2 size={18} /></span><div><p className="text-[9.5px] font-bold uppercase tracking-[.12em] text-faint">Editando</p><h3 className="text-[14px] font-semibold">{internal ? "Assistente da equipe" : "Assistente de atendimento"}</h3></div></div><div className="flex items-center gap-2 md:ml-auto"><span className={`text-[10px] ${dirty ? "text-[#b56a15]" : saved ? "text-success" : "text-faint"}`}>{dirty ? "Alterações não salvas" : saved ? "Alterações salvas" : "Tudo salvo"}</span><button type="button" role="switch" aria-label="Ativar ou pausar assistente" aria-checked={draft.ativo} disabled={!canWrite} onClick={() => update("ativo", !draft.ativo)} className={`relative h-6 w-11 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 ${draft.ativo ? internal ? "bg-accent" : "bg-[#0f9f8f]" : "bg-faint/50"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${draft.ativo ? "left-6" : "left-1"}`} /></button><span className="text-[10.5px] font-medium text-sub">{draft.ativo ? "Ativo" : "Pausado"}</span></div></header>
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_340px]"><div className="min-w-0 p-4 md:p-6"><div className="grid gap-6"><fieldset disabled={!canWrite} className="grid gap-3"><legend className="mb-1 flex items-center gap-2 text-[12px] font-semibold"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ${internal ? "bg-accent" : "bg-[#0f9f8f]"}`}>1</span>Identidade</legend><p className="-mt-2 pl-8 text-[10.5px] text-sub">O nome e a primeira mensagem que as pessoas reconhecem.</p><label className="text-[10.5px] font-semibold text-sub">Nome exibido<input value={draft.marca} onChange={(event) => update("marca", event.target.value)} placeholder={internal ? "Ex.: Núcleo Major" : "Ex.: Assistente Major"} className="mt-1.5 w-full rounded-[9px] border border-line bg-bg px-3 py-2.5 text-[12.5px] font-normal outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10" /></label><label className="text-[10.5px] font-semibold text-sub">Saudação inicial<textarea value={draft.saudacao} onChange={(event) => update("saudacao", event.target.value)} placeholder="Como iniciar uma nova conversa" rows={2} className="mt-1.5 w-full resize-y rounded-[9px] border border-line bg-bg px-3 py-2.5 text-[12.5px] font-normal leading-5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10" /></label></fieldset>
        <fieldset disabled={!canWrite} className="grid gap-3 border-t border-line pt-5"><legend className="mb-1 flex items-center gap-2 text-[12px] font-semibold"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ${internal ? "bg-accent" : "bg-[#0f9f8f]"}`}>2</span>Forma de conversar</legend><p className="-mt-2 pl-8 text-[10.5px] text-sub">Escolha um ponto de partida e personalize com suas palavras.</p><div className="flex flex-wrap gap-2">{tonePresets.map(([label, value]) => <button type="button" key={label} onClick={() => update("tom", value)} className={`rounded-full border px-3 py-1.5 text-[9.5px] transition ${draft.tom === value ? internal ? "border-accent bg-accent-soft text-accent-forte" : "border-[#0f9f8f] bg-[#e6f6f2] text-[#08796e]" : "border-line bg-bg text-sub hover:border-faint"}`}>{label}</button>)}</div><label className="text-[10.5px] font-semibold text-sub">Tom de voz<textarea value={draft.tom} onChange={(event) => update("tom", event.target.value)} rows={3} className="mt-1.5 w-full resize-y rounded-[9px] border border-line bg-bg px-3 py-2.5 text-[12.5px] font-normal leading-5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10" /></label></fieldset>
        <fieldset disabled={!canWrite} className="grid gap-3 border-t border-line pt-5"><legend className="mb-1 flex items-center gap-2 text-[12px] font-semibold"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ${internal ? "bg-accent" : "bg-[#0f9f8f]"}`}>3</span>Como este assistente deve trabalhar</legend><p className="-mt-2 pl-8 text-[10.5px] text-sub">Descreva processo, limites e situações que precisam de uma pessoa.</p><textarea value={draft.processo} onChange={(event) => update("processo", event.target.value)} placeholder="Ex.: entenda a necessidade antes de apresentar uma solução; não invente condições; transfira exceções comerciais..." rows={8} className="w-full resize-y rounded-[9px] border border-line bg-bg p-3 text-[12.5px] leading-5 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10" />{!internal && <div className="rounded-[11px] border border-line bg-surface/70 p-3"><p className="text-[10.5px] font-semibold text-fg">Memória da conversa</p><p className="mt-1 text-[9.5px] text-sub">Após estes períodos, o atendimento volta com segurança para a Recepção.</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{[["contextoHoras", "Conversa", "horas", 1, 168], ["subfluxoHoras", "Habilidade", "horas", 1, 24], ["confirmacaoMinutos", "Confirmação", "minutos", 5, 120]].map(([key, label, suffix, min, max]) => <label key={key} className="text-[9.5px] font-semibold text-sub">{label}<span className="mt-1 flex items-center rounded-[8px] border border-line bg-bg"><input type="number" min={min} max={max} value={draft[key]} onChange={(event) => update(key, event.target.value)} className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-[11.5px] font-normal outline-none" /><span className="pr-2 text-[8.5px] text-faint">{suffix}</span></span></label>)}</div></div>}</fieldset>
        {!internal && <RolloutControl draft={draft} contacts={data.contacts} update={update} disabled={!canWrite} />}
        <div className="border-t border-line pt-5"><div className="flex items-center gap-2"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ${internal ? "bg-accent" : "bg-[#0f9f8f]"}`}>{internal ? 4 : 5}</span><h4 className="text-[12px] font-semibold">Habilidades disponíveis</h4><button type="button" onClick={onManageSkills} className="ml-auto text-[10px] font-semibold text-accent-forte hover:underline">Ver catálogo</button></div><p className="mt-1 pl-8 text-[10.5px] text-sub">Cada habilidade define ações e limites específicos.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{bound.map((skill) => <div key={skill.id} className="rounded-[10px] border border-line bg-surface/60 p-3"><div className="flex items-center gap-2"><Sparkles size={14} className={internal ? "text-accent-forte" : "text-[#08796e]"} /><strong className="text-[11px]">{skill.name}</strong><span className="ml-auto text-[8.5px] text-faint">v{skill.current_version}</span></div><p className="mt-1 line-clamp-2 text-[9.5px] leading-4 text-sub">{skill.description}</p></div>)}{!bound.length && <p className="rounded-[10px] border border-dashed border-line p-4 text-center text-[10.5px] text-sub sm:col-span-2">Nenhuma habilidade vinculada.</p>}</div></div></div></div>
        <aside className="min-w-0 border-t border-line bg-[#f7f7fb] p-4 lg:border-l lg:border-t-0 lg:p-5"><div className="sticky top-4"><div className="flex items-center gap-2"><Eye size={15} className="text-accent-forte" /><h4 className="text-[12px] font-semibold">Prévia da conversa</h4><span className="ml-auto rounded-full bg-bg px-2 py-1 text-[8.5px] text-faint">Ilustrativa</span></div><p className="mt-1 text-[10px] leading-4 text-sub">Veja como identidade e saudação aparecem para este público.</p><div className="mt-4 overflow-hidden rounded-[16px] border border-line bg-[#efeae2] shadow-sm"><div className="flex items-center gap-2 bg-[#075e54] px-3 py-2.5 text-white"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15"><Bot size={16} /></span><div className="min-w-0"><p className="truncate text-[10.5px] font-semibold">{previewName}</p><p className="text-[8.5px] text-white/70">online</p></div></div><div className="min-h-64 space-y-2.5 p-3 text-[10px] leading-4"><div className="max-w-[88%] rounded-[8px] rounded-tl-none bg-white px-3 py-2 shadow-sm">{previewGreeting}<span className="ml-2 whitespace-nowrap text-[7.5px] text-faint">09:41</span></div><div className="ml-auto max-w-[84%] rounded-[8px] rounded-tr-none bg-[#d9fdd3] px-3 py-2 shadow-sm">{internal ? "Pode consultar minha agenda de amanhã?" : "Olá, quero entender como funciona."}<span className="ml-2 whitespace-nowrap text-[7.5px] text-faint">09:42</span></div><div className="max-w-[88%] rounded-[8px] rounded-tl-none bg-white px-3 py-2 shadow-sm">{internal ? "Claro! Vou consultar seus compromissos respeitando suas permissões." : "Claro! Primeiro quero entender o que você precisa para orientar o melhor próximo passo."}<span className="ml-2 whitespace-nowrap text-[7.5px] text-faint">09:42</span></div></div></div><div className={`mt-3 rounded-[10px] border px-3 py-2.5 text-[9.5px] leading-4 ${internal ? "border-accent/20 bg-accent-soft/60 text-accent-forte" : "border-[#0f9f8f]/20 bg-[#e6f6f2] text-[#08796e]"}`}><strong className="block">Fronteira protegida</strong>{internal ? "Usa cargo e conhecimento interno autorizado." : "Usa somente conhecimento publicado para clientes."}</div></div></aside></div>
      <footer className="flex flex-col gap-3 border-t border-line bg-bg px-4 py-4 sm:flex-row sm:items-center md:px-6"><div className="text-[9.5px] text-sub">{dirty ? "Salve as mudanças antes de testar no simulador." : "As alterações salvas são usadas nas próximas conversas."}</div><div className="flex flex-wrap items-center gap-2 sm:ml-auto">{canWrite && <button type="button" onClick={discard} disabled={!dirty || saving} className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-2 text-[10.5px] font-semibold text-sub disabled:opacity-35"><RotateCcw size={13} />Descartar</button>}<button type="button" onClick={onTest} disabled={dirty} title={dirty ? "Salve as mudanças antes de testar" : "Abrir simulador"} className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-2 text-[10.5px] font-semibold text-fg disabled:cursor-not-allowed disabled:opacity-35"><FlaskConical size={13} />Testar no simulador</button>{canWrite && <button type="button" onClick={save} disabled={!dirty || saving || !draft.nome.trim()} className={`inline-flex items-center gap-1.5 rounded-[9px] px-4 py-2 text-[10.5px] font-semibold text-white disabled:opacity-35 ${internal ? "bg-accent" : "bg-[#0f9f8f]"}`}><Save size={13} />{saving ? "Salvando…" : "Salvar mudanças"}</button>}</div></footer></section></div></div>;
}

const steps = ["Objetivo", "Público", "Gatilhos", "Dados", "Perguntas", "Conhecimento", "Ações", "Limites", "Testes", "Publicar"];
const emptySkill = { nome: "", descricao: "", objetivo: "", audiencia: "customer", gatilhos: "", dados: "", perguntas: "", colecoes: [], acoes: "", limites: "", transferencia: "", testes: "" };
function SkillWizard({ data, close, saved, fail }) {
  const [step, setStep] = useState(0); const [form, setForm] = useState(emptySkill); const [saving, setSaving] = useState(false);
  const field = (key, value) => setForm({ ...form, [key]: value });
  const area = (key, placeholder) => <textarea value={form[key]} onChange={(event) => field(key, event.target.value)} placeholder={placeholder} className="min-h-36 w-full rounded-[10px] border border-line p-3 text-[12.5px] leading-5 outline-none focus:border-accent" />;
  const publish = async () => { setSaving(true); try { await api.inteligencia.salvarSkill({ nome: form.nome, descricao: form.descricao, audiencia: form.audiencia, profileIds: data.profiles.filter((profile) => form.audiencia === "both" || profile.audience === form.audiencia).map((profile) => profile.id), spec: { objective: form.objetivo, activation: { keywords: list(form.gatilhos) }, requiredFields: list(form.dados), questions: list(form.perguntas), knowledgeCollections: form.colecoes, allowedTools: list(form.acoes), guardrails: list(form.limites), handoff: list(form.transferencia), evaluations: list(form.testes) } }); await saved(); close(); } catch (error) { fail(error.message); } finally { setSaving(false); } };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-3"><section className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[15px] border border-line bg-bg shadow-2xl"><header className="flex items-center border-b border-line px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-accent">Skill privado</p><h2 className="text-[17px] font-semibold">Editor assistido</h2></div><button onClick={close} className="ml-auto p-2 text-sub"><X size={18} /></button></header><div className="flex gap-1 overflow-x-auto border-b border-line px-4 py-2">{steps.map((label, index) => <button key={label} onClick={() => setStep(index)} className={`min-w-fit rounded-full px-2.5 py-1 text-[9.5px] ${index === step ? "bg-accent text-white" : index < step ? "bg-accent-soft text-accent-forte" : "bg-surface text-sub"}`}>{index + 1}. {label}</button>)}</div><div className="scrollbar-fina flex-1 overflow-y-auto p-5"><h3 className="mb-1 text-[16px] font-semibold">{steps[step]}</h3><p className="mb-4 text-[11.5px] text-sub">Permissões continuam validadas pelo Núcleo; o skill não pode ampliá-las.</p>{step === 0 && <div className="grid gap-3"><input value={form.nome} onChange={(e) => field("nome", e.target.value)} placeholder="Nome do skill" className="rounded-[9px] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-accent" /><input value={form.objetivo} onChange={(e) => field("objetivo", e.target.value)} placeholder="Qual resultado este skill produz?" className="rounded-[9px] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-accent" />{area("descricao", "Descrição curta para o catálogo")}</div>}{step === 1 && <div className="grid gap-2">{[["internal", "Somente profissionais"], ["customer", "Somente clientes"], ["both", "Os dois públicos"]].map(([value, label]) => <label key={value} className={`flex items-center gap-3 rounded-[10px] border p-3 ${form.audiencia === value ? "border-accent bg-accent-soft" : "border-line"}`}><input type="radio" checked={form.audiencia === value} onChange={() => field("audiencia", value)} />{label}</label>)}</div>}{step === 2 && area("gatilhos", "Uma expressão por linha\npreço\nquero contratar")}{step === 3 && area("dados", "Um dado obrigatório por linha\nnome\nnecessidade\nprazo")}{step === 4 && area("perguntas", "Uma pergunta permitida por linha")}{step === 5 && <div className="grid gap-2">{data.collections.filter((item) => form.audiencia === "internal" ? item.audience === "internal" : item.audience === "external").map((collection) => <label key={collection.id} className="flex items-center gap-3 rounded-[10px] border border-line p-3 text-[12px]"><input type="checkbox" checked={form.colecoes.includes(collection.id)} onChange={(event) => field("colecoes", event.target.checked ? [...form.colecoes, collection.id] : form.colecoes.filter((id) => id !== collection.id))} />{collection.name}</label>)}</div>}{step === 6 && area("acoes", "Uma ação permitida por linha\ncrm.contact.upsert\nconversation.handoff")}{step === 7 && <div className="grid gap-3">{area("limites", "Um limite obrigatório por linha")}{area("transferencia", "Quando transferir para uma pessoa")}</div>}{step === 8 && area("testes", "Uma mensagem de teste por linha")}{step === 9 && <div className="rounded-[12px] border border-line bg-surface p-4"><p className="text-[14px] font-semibold">{form.nome || "Skill sem nome"}</p><p className="mt-1 text-[11.5px] text-sub">{form.objetivo || "Objetivo não informado"}</p><div className="mt-4 grid gap-2 text-[11px] md:grid-cols-2"><span>{list(form.gatilhos).length} gatilhos</span><span>{list(form.dados).length} dados obrigatórios</span><span>{list(form.acoes).length} ações permitidas</span><span>{list(form.testes).length} testes</span></div><div className="mt-4 flex items-center gap-2 text-[10.5px] text-success"><ShieldCheck size={15} />Regras centrais protegidas.</div></div>}</div><footer className="flex items-center gap-2 border-t border-line px-5 py-3"><button disabled={!step} onClick={() => setStep(step - 1)} className="inline-flex items-center gap-1 px-3 py-2 text-[11.5px] text-sub disabled:opacity-30"><ChevronLeft size={14} />Voltar</button>{step < steps.length - 1 ? <button onClick={() => setStep(step + 1)} className="ml-auto inline-flex items-center gap-1 rounded-[8px] bg-accent px-4 py-2 text-[11.5px] font-semibold text-white">Continuar<ChevronRight size={14} /></button> : <button disabled={saving || !form.nome.trim() || !form.objetivo.trim()} onClick={publish} className="ml-auto inline-flex items-center gap-2 rounded-[8px] bg-accent px-4 py-2 text-[11.5px] font-semibold text-white disabled:opacity-40"><Check size={14} />{saving ? "Publicando…" : "Publicar skill"}</button>}</footer></section></div>;
}

/**
 * Recolher ou espalhar o catálogo é preferência, e preferência atravessa
 * recarga — mesma decisão do menu lateral, mesmo motivo: quem prefere varrer a
 * lista densa quer ela amanhã de novo, sem um clique diário.
 */
const CHAVE_DA_VISAO = "emyleads.skills.visao";

function visaoInicial() {
  try {
    return window.localStorage.getItem(CHAVE_DA_VISAO) === "lista" ? "lista" : "grade";
  } catch {
    // Janela anônima ou cookies bloqueados: abre na grade, que é o padrão.
    return "grade";
  }
}

/**
 * Um desenho por habilidade, no lugar do mesmo `Sparkles` oito vezes.
 *
 * Os oficiais são reconhecidos pelo `slug`, que é estável — o nome não é, pois
 * pode ser renomeado. Um skill PRIVADO, que nasce com slug que ninguém aqui
 * conhece, herda o desenho da família de ferramenta que ele efetivamente toca:
 * quem mexe em `calendar.*` recebe o calendário. Assim a tela nunca cai num
 * ícone genérico só porque a habilidade é nova.
 */
const GLIFO = {
  entrada: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3",
  funil: "M22 3H2l8 9.46V19l4 2v-8.54L22 3z",
  etiqueta: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7.5 7.5h.01",
  boia: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M14.83 9.17l4.24-4.24M4.93 19.07l4.24-4.24",
  agendaMais: "M8 2v4M16 2v4M3 10h18M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8M16 19h6M19 16v6",
  agendaOk: "M8 2v4M16 2v4M3 10h18M21 14V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7M16 20l2 2 4-4",
  checklist: "M21 10.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11M9 11l3 3L22 4",
  livro: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20",
  contato: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M22 21v-2a4 4 0 0 0-3-3.87",
  no: "M12 2 3 7v10l9 5 9-5V7z",
};

const GLIFO_POR_SLUG = {
  recepcao: GLIFO.entrada,
  "pre-qualificacao": GLIFO.funil,
  vendas: GLIFO.etiqueta,
  suporte: GLIFO.boia,
  "solicitacao-agenda": GLIFO.agendaMais,
  agenda: GLIFO.agendaOk,
  tarefas: GLIFO.checklist,
};

function glifoDoSkill(skill) {
  const conhecido = GLIFO_POR_SLUG[skill.slug];
  if (conhecido) return conhecido;
  const tools = skill.spec?.allowedTools || [];
  const toca = (prefixo) => tools.some((tool) => String(tool).startsWith(prefixo));
  if (toca("calendar.")) return GLIFO.agendaOk;
  if (toca("task.")) return GLIFO.checklist;
  if (toca("crm.deal")) return GLIFO.funil;
  if (toca("conversation.")) return GLIFO.boia;
  if (toca("crm.")) return GLIFO.contato;
  if (toca("knowledge.")) return GLIFO.livro;
  return GLIFO.no;
}

function Glifo({ d, tamanho = 20 }) {
  return <svg viewBox="0 0 24 24" width={tamanho} height={tamanho} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

/** O que a máquina sabe do skill, pronto para as duas visões. */
function fichaDoSkill(skill) {
  const tools = skill.spec?.allowedTools || [];
  const keywords = skill.spec?.activation?.keywords || [];
  const privado = skill.owner_type !== "platform";
  return {
    skill,
    glifo: glifoDoSkill(skill),
    privado,
    nivel: privado ? "Privado" : "Núcleo",
    versao: `v${skill.current_version}`,
    gatilhos: keywords.slice(0, 3).join("  "),
    // O identificador REAL da ferramenta. É o que faz a tela parecer
    // instrumento e não cartão decorado — e ele já existia no spec.
    tool: tools[0] || "—",
    maisTools: tools.length > 1 ? `+${tools.length - 1}` : "",
  };
}

function Skills({ data, canWrite, reload, fail }) {
  const [wizard, setWizard] = useState(false);
  const [visao, setVisao] = useState(visaoInicial);
  const fichas = useMemo(() => data.skills.map(fichaDoSkill), [data.skills]);

  const trocarVisao = (proxima) => {
    setVisao(proxima);
    try {
      window.localStorage.setItem(CHAVE_DA_VISAO, proxima);
    } catch {
      // Sem onde guardar, a escolha vale só nesta sessão — e continua valendo.
    }
  };

  return <div className="skills-catalogo scrollbar-fina"><div className="skills-interno">
    <div className="skills-cabeca">
      <div>
        <p className="skills-eyebrow font-mono">Núcleo de conhecimento</p>
        <h2>Catálogo de habilidades</h2>
        <p className="sub">Oficiais evoluem centralmente; privados pertencem somente à organização.</p>
      </div>
      <div className="skills-acoes">
        <div className="skills-alternador" role="group" aria-label="Visualização do catálogo">
          <button type="button" onClick={() => trocarVisao("grade")} aria-pressed={visao === "grade"} title="Ver em grade" aria-label="Ver em grade"><LayoutGrid size={15} /></button>
          <button type="button" onClick={() => trocarVisao("lista")} aria-pressed={visao === "lista"} title="Ver em lista" aria-label="Ver em lista"><List size={15} /></button>
        </div>
        {canWrite && <button type="button" onClick={() => setWizard(true)} className="skills-criar"><Plus size={14} />Criar skill</button>}
      </div>
    </div>

    {!fichas.length ? <p className="skills-vazio">Nenhuma habilidade no catálogo.</p> : visao === "grade" ? (
      <div className="skills-grade">
        {fichas.map((f) => <article key={f.skill.id} className={`skill-card ${f.privado ? "skill-privado" : ""}`}>
          <div className="skill-topo">
            <span className="skill-glifo"><Glifo d={f.glifo} /></span>
            <span className="skill-meta font-mono">
              <i className="skill-ponto" />
              <span className="skill-nivel">{f.nivel}</span>
              <span>{f.versao}</span>
            </span>
          </div>
          <h3 className="skill-nome">{f.skill.name}</h3>
          <p className="skill-desc">{f.skill.description}</p>
          <div className="skill-pe">
            <div className="skill-filete" />
            <div className="skill-campo font-mono"><span className="skill-rot">ativa</span><span className="skill-val">{f.gatilhos || "—"}</span></div>
            <div className="skill-campo font-mono"><span className="skill-rot">usa</span><span className="skill-val"><b>{f.tool}</b>{f.maisTools && <span className="skill-mais"> {f.maisTools}</span>}</span></div>
          </div>
        </article>)}
      </div>
    ) : (
      <div className="skills-lista">
        <div className="skill-linha skill-linha--cabeca font-mono" aria-hidden="true">
          <span />
          <span>Habilidade</span>
          <span className="skill-oculta-sm">O que faz</span>
          <span className="skill-oculta-md skill-oculta-sm">Ativa com</span>
          <span className="skill-oculta-sm">Ferramentas</span>
          <span style={{ textAlign: "right" }}>Nível</span>
        </div>
        {fichas.map((f) => <article key={f.skill.id} className={`skill-linha skill-linha--item ${f.privado ? "skill-privado" : ""}`}>
          <span className="skill-glifo"><Glifo d={f.glifo} tamanho={18} /></span>
          <span className="skill-nome">{f.skill.name}</span>
          <span className="skill-desc skill-oculta-sm">{f.skill.description}</span>
          <span className="skill-cel font-mono skill-oculta-md skill-oculta-sm">{f.gatilhos || "—"}</span>
          <span className="skill-cel font-mono skill-oculta-sm"><b>{f.tool}</b>{f.maisTools && <span className="skill-mais"> {f.maisTools}</span>}</span>
          <span className="skill-nivel-cel font-mono"><i className="skill-ponto" />{f.nivel} {f.versao}</span>
        </article>)}
      </div>
    )}
  </div>{wizard && <SkillWizard data={data} close={() => setWizard(false)} saved={reload} fail={fail} />}</div>;
}

const emptyCampaign = { id: null, nome: "", status: "draft", objetivo: "", oferta: "", publico: "", resultado: "", padrao: false, fontes: "keyword:", skillIds: [], collectionIds: [] };
function Campaigns({ data, canWrite, reload, fail }) {
  const [draft, setDraft] = useState(null); const customer = data.profiles.find((item) => item.audience === "customer" && item.is_default);
  const open = (campaign) => setDraft({ id: campaign.id, nome: campaign.name, status: campaign.status, objetivo: campaign.objective, oferta: campaign.offer, publico: campaign.audience_description, resultado: campaign.desired_outcome, padrao: campaign.is_default, fontes: data.sources.filter((item) => item.campaign_id === campaign.id).map((item) => `${item.source_type}:${item.source_value}`).join("\n"), skillIds: data.campaignSkills.filter((item) => item.campaign_id === campaign.id).map((item) => item.skill_id), collectionIds: data.campaignCollections.filter((item) => item.campaign_id === campaign.id).map((item) => item.collection_id) });
  const save = async () => { if (!customer) { fail("Nenhum assistente de clientes está marcado como padrão nesta organização."); return; } try { const fontes = list(draft.fontes).map((line, index) => { const at = line.indexOf(":"); return { tipo: at > 0 ? line.slice(0, at).trim() : "keyword", valor: at > 0 ? line.slice(at + 1).trim() : line, prioridade: index * 10 + 10 }; }); await api.inteligencia.salvarCampanha({ ...draft, profileId: customer.id, fontes }); setDraft(null); await reload(); } catch (error) { fail(error.message); } };
  return <div className="scrollbar-fina flex-1 overflow-y-auto p-4 md:p-7"><div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[290px_minmax(0,1fr)]"><section><div className="flex items-center"><div><h2 className="text-[17px] font-semibold">Campanhas</h2><p className="text-[11px] text-sub">Contextos no mesmo WhatsApp.</p></div>{canWrite && <button onClick={() => setDraft(emptyCampaign)} className="ml-auto rounded-[8px] bg-accent p-2 text-white"><Plus size={15} /></button>}</div><div className="mt-3 grid gap-2">{data.campaigns.length ? data.campaigns.map((campaign) => <button key={campaign.id} onClick={() => open(campaign)} className={`rounded-[11px] border p-3 text-left ${draft?.id === campaign.id ? "border-accent bg-accent-soft" : "border-line bg-bg"}`}><div className="flex gap-2"><strong className="min-w-0 flex-1 truncate text-[12.5px]">{campaign.name}</strong><span className={campaign.status === "active" ? "text-[9.5px] text-success" : "text-[9.5px] text-sub"}>{campaign.status}</span></div><p className="mt-1 line-clamp-2 text-[10.5px] text-sub">{campaign.objective || "Sem objetivo definido"}</p></button>) : <p className="rounded-[11px] border border-dashed border-line p-6 text-center text-[11px] text-sub">Nenhuma campanha.</p>}</div></section><section className="rounded-[14px] border border-line bg-bg p-5">{!draft ? <div className="flex min-h-[430px] flex-col items-center justify-center text-center"><Megaphone size={34} className="text-faint" /><h3 className="mt-3 text-[15px] font-semibold">Selecione uma campanha</h3><p className="mt-1 text-[11.5px] text-sub">Configure oferta, público, sinais, skills e conhecimento.</p></div> : <div className="grid gap-4"><div className="grid gap-3 md:grid-cols-[1fr_150px]"><label className="text-[10.5px] font-semibold text-sub">Nome<input disabled={!canWrite} value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} className="mt-1 w-full rounded-[8px] border border-line px-3 py-2 text-[12px] font-normal" /></label><label className="text-[10.5px] font-semibold text-sub">Status<select disabled={!canWrite} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className="mt-1 w-full rounded-[8px] border border-line px-3 py-2 text-[12px] font-normal"><option value="draft">Rascunho</option><option value="test">Teste</option><option value="active">Ativa</option><option value="paused">Pausada</option><option value="closed">Encerrada</option></select></label></div>{[["objetivo", "Objetivo"], ["oferta", "Oferta autorizada"], ["publico", "Público"], ["resultado", "Resultado esperado"]].map(([key, label]) => <label key={key} className="text-[10.5px] font-semibold text-sub">{label}<textarea disabled={!canWrite} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className="mt-1 min-h-16 w-full rounded-[8px] border border-line p-3 text-[12px] font-normal" /></label>)}<label className="text-[10.5px] font-semibold text-sub">Sinais de origem<textarea disabled={!canWrite} value={draft.fontes} onChange={(e) => setDraft({ ...draft, fontes: e.target.value })} placeholder="ad:meta-123\nkeyword:quero saber" className="mt-1 min-h-24 w-full rounded-[8px] border border-line p-3 font-mono text-[11px] font-normal" /></label><Picker title="Skills" items={data.skills.filter((item) => item.audience !== "internal")} selected={draft.skillIds} label="name" disabled={!canWrite} change={(skillIds) => setDraft({ ...draft, skillIds })} /><Picker title="Conhecimento publicado" items={data.collections.filter((item) => item.audience === "external")} selected={draft.collectionIds} label="name" disabled={!canWrite} change={(collectionIds) => setDraft({ ...draft, collectionIds })} /><label className="text-[11px] text-sub"><input type="checkbox" disabled={!canWrite} checked={draft.padrao} onChange={(e) => setDraft({ ...draft, padrao: e.target.checked })} className="mr-2" />Campanha padrão quando nenhum sinal corresponder</label>{canWrite && <button onClick={save} disabled={!draft.nome.trim()} className="ml-auto inline-flex items-center gap-2 rounded-[9px] bg-accent px-4 py-2.5 text-[12px] font-semibold text-white disabled:opacity-40"><Save size={14} />Salvar campanha</button>}</div>}</section></div></div>;
}
function Picker({ title, items, selected, label, change, disabled }) { return <div><p className="mb-2 text-[10.5px] font-semibold text-sub">{title}</p><div className="flex flex-wrap gap-2">{items.map((item) => <label key={item.id} className="rounded-full border border-line px-2.5 py-1 text-[10px]"><input type="checkbox" disabled={disabled} checked={selected.includes(item.id)} onChange={(event) => change(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} className="mr-1.5" />{item[label]}</label>)}</div></div>; }

function SimulatorLegacy({ reload, fail }) {
  const [audience, setAudience] = useState("customer"); const [message, setMessage] = useState(""); const [source, setSource] = useState(""); const [result, setResult] = useState(null); const [loading, setLoading] = useState(false);
  const run = async () => { setLoading(true); try { const origin = {}; for (const line of list(source)) { const at = line.indexOf(":"); if (at > 0) origin[line.slice(0, at).trim()] = line.slice(at + 1).trim(); } setResult(await api.inteligencia.simular({ audiencia: audience, mensagem: message, origem: origin })); await reload(); } catch (error) { fail(error.message); } finally { setLoading(false); } };
  return <div className="scrollbar-fina flex-1 overflow-y-auto p-4 md:p-7"><div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-2"><section className="rounded-[14px] border border-line bg-bg p-5"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-accent-soft text-accent-forte"><FlaskConical size={21} /></span><div><h2 className="text-[17px] font-semibold">Simular uma conversa</h2><p className="text-[11px] text-sub">Sem enviar mensagem nem alterar CRM ou agenda.</p></div></div><div className="mt-5 grid gap-4"><label className="text-[10.5px] font-semibold text-sub">Público<select value={audience} onChange={(e) => setAudience(e.target.value)} className="mt-1 w-full rounded-[8px] border border-line px-3 py-2 text-[12px] font-normal"><option value="customer">Cliente</option><option value="internal">Profissional interno</option></select></label><label className="text-[10.5px] font-semibold text-sub">Mensagem<textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Olá, vi o anúncio e quero saber o valor" className="mt-1 min-h-36 w-full rounded-[10px] border border-line p-3 text-[13px] font-normal" /></label><label className="text-[10.5px] font-semibold text-sub">Origem opcional<input value={source} onChange={(e) => setSource(e.target.value)} placeholder="ad:meta-123" className="mt-1 w-full rounded-[8px] border border-line px-3 py-2 font-mono text-[11px] font-normal" /></label><button onClick={run} disabled={loading || !message.trim()} className="inline-flex items-center justify-center gap-2 rounded-[9px] bg-accent px-4 py-2.5 text-[12px] font-semibold text-white disabled:opacity-40"><Sparkles size={15} />{loading ? "Resolvendo…" : "Resolver contexto"}</button></div></section><section className="rounded-[14px] border border-line bg-bg p-5"><h3 className="text-[14px] font-semibold">Por que responderia assim?</h3><p className="mt-1 text-[11px] text-sub">A decisão do servidor antes do modelo conversar.</p>{result ? <div className="mt-5"><Trail context={result} /><div className="mt-4 rounded-[10px] bg-surface p-3"><p className="text-[9.5px] font-bold uppercase text-faint">Skills permitidos</p><div className="mt-2 flex flex-wrap gap-1.5">{(result.skillsPermitidos || []).map((skill) => <span key={skill.id} className="rounded-full border border-line bg-bg px-2.5 py-1 text-[10px] text-sub">{skill.nome} · v{skill.versao}</span>)}</div></div></div> : <div className="flex min-h-[330px] flex-col items-center justify-center text-center"><Layers3 size={32} className="text-faint" /><p className="mt-3 text-[11.5px] text-sub">Execute uma simulação para visualizar a trilha.</p></div>}</section></div></div>;
}

function Simulator({ reload, fail }) {
  const [audience, setAudience] = useState("customer");
  const [message, setMessage] = useState("");
  const [source, setSource] = useState("");
  const [history, setHistory] = useState([]);
  const [activeSkillId, setActiveSkillId] = useState(null);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setHistory([]);
    setActiveSkillId(null);
    setMessage("");
  };

  const run = async () => {
    const cleanMessage = message.trim();
    if (!cleanMessage || loading) return;
    setLoading(true);
    fail("");
    try {
      const origin = {};
      for (const line of list(source)) {
        const at = line.indexOf(":");
        if (at > 0) origin[line.slice(0, at).trim()] = line.slice(at + 1).trim();
      }
      const [preview, intelligence] = await Promise.all([
        api.inteligencia.simular({ audiencia: audience, mensagem: cleanMessage, origem: origin }),
        api.inteligencia.carregar(),
      ]);
      const skills = intelligence.skills.map((skill) => ({
        ...skill,
        status: skill.status || (skill.current_version ? "published" : "draft"),
        audience: skill.audience || "customer",
        spec: skill.spec || skill.spec_json || {},
      }));
      const route = resolverRotaSkill({
        skills,
        message: cleanMessage,
        currentSkillId: activeSkillId,
        audience,
      });
      setActiveSkillId(route.skill?.id || null);
      setHistory((current) => [...current, {
        id: `${Date.now()}-${current.length}`,
        message: cleanMessage,
        preview,
        route,
      }]);
      setMessage("");
      await reload();
    } catch (error) {
      fail(error.message);
    } finally {
      setLoading(false);
    }
  };

  return <div className="scrollbar-fina flex-1 overflow-y-auto p-4 md:p-7">
    <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
      <section className="h-fit rounded-[14px] border border-line bg-bg p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-accent-soft text-accent-forte"><FlaskConical size={21} /></span>
          <div><h2 className="text-[17px] font-semibold">Simular uma conversa</h2><p className="text-[11px] text-sub">Teste o roteamento sem alterar CRM ou agenda.</p></div>
        </div>
        <label className="mt-5 block text-[10.5px] font-semibold text-sub">Público
          <select value={audience} onChange={(event) => { setAudience(event.target.value); reset(); }} className="mt-1.5 w-full rounded-[9px] border border-line bg-bg px-3 py-2.5 text-[12px] outline-none focus:border-accent">
            <option value="customer">Cliente</option><option value="internal">Profissional</option>
          </select>
        </label>
        <label className="mt-3 block text-[10.5px] font-semibold text-sub">Origem confiável <span className="font-normal text-faint">(opcional)</span>
          <textarea value={source} onChange={(event) => setSource(event.target.value)} rows={3} placeholder={'utm_campaign: lancamento\nkeyword: consultoria'} className="mt-1.5 w-full resize-y rounded-[9px] border border-line p-3 font-mono text-[10.5px] outline-none focus:border-accent" />
        </label>
        <label className="mt-3 block text-[10.5px] font-semibold text-sub">Mensagem
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); run(); } }} rows={4} placeholder="Ex.: Quero saber valores e marcar uma conversa" className="mt-1.5 w-full resize-y rounded-[9px] border border-line p-3 text-[12px] outline-none focus:border-accent" />
        </label>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={run} disabled={!message.trim() || loading} className="inline-flex flex-1 items-center justify-center gap-2 rounded-[9px] bg-accent px-4 py-2.5 text-[11.5px] font-semibold text-white disabled:opacity-40"><WandSparkles size={14} />{loading ? "Analisando…" : "Enviar teste"}</button>
          <button type="button" onClick={reset} disabled={!history.length} className="rounded-[9px] border border-line px-3 text-sub disabled:opacity-35" title="Nova conversa"><RotateCcw size={15} /></button>
        </div>
      </section>
      <section className="min-h-[480px] rounded-[14px] border border-line bg-bg p-5">
        <div className="flex items-center gap-2"><MessageCircle size={17} className="text-accent-forte" /><h2 className="text-[15px] font-semibold">Resultado da conversa</h2><span className="ml-auto rounded-full bg-surface px-2 py-1 text-[9px] text-sub">Fase H.3 · sem efeitos reais</span></div>
        {!history.length ? <div className="flex min-h-[390px] flex-col items-center justify-center text-center"><FlaskConical size={34} className="text-faint" /><h3 className="mt-3 text-[14px] font-semibold">Envie a primeira mensagem</h3><p className="mt-1 max-w-sm text-[11px] leading-5 text-sub">Você verá qual habilidade recebeu a conversa, por qual motivo e em qual etapa ela começou.</p></div> : <div className="mt-5 space-y-5">{history.map((item) => <article key={item.id} className="border-b border-line pb-5 last:border-0">
          <div className="ml-auto max-w-[82%] rounded-[10px] rounded-tr-none bg-accent px-3 py-2.5 text-[11px] leading-5 text-white">{item.message}</div>
          <div className="mt-3 rounded-[12px] border border-line bg-surface/60 p-4">
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-accent-soft px-2.5 py-1 text-[9.5px] font-semibold text-accent-forte">{item.route.skill?.name || "Sem habilidade"}</span><span className="rounded-full bg-bg px-2.5 py-1 text-[9.5px] text-sub">Etapa: {item.route.stageId}</span><span className="text-[9.5px] text-faint">Motivo: {item.route.reason}</span></div>
            <p className="mt-3 text-[10.5px] leading-5 text-sub">{item.route.stage?.objective || item.route.skill?.description || "Nenhuma rota publicada foi encontrada para esta mensagem."}</p>
            {item.preview?.campaign?.name && <p className="mt-2 text-[9.5px] text-sub"><strong>Campanha:</strong> {item.preview.campaign.name}</p>}
          </div>
        </article>)}</div>}
      </section>
    </div>
  </div>;
}

function Audit({ data, canWrite, reload, fail }) {
  const privateSkills = data.skills.filter((skill) => skill.owner_type === "organization");
  const restore = async (skill, version) => {
    if (!confirm(`Restaurar “${skill.name}” a partir da versão ${version.version}? Uma nova versão será criada.`)) return;
    try { await api.inteligencia.restaurarSkill({ skillId: skill.id, versao: version.version }); await reload(); }
    catch (error) { fail(error.message); }
  };
  return <div className="scrollbar-fina flex-1 overflow-y-auto p-4 md:p-7"><div className="mx-auto max-w-5xl"><h2 className="text-[18px] font-semibold">Histórico de inteligência</h2><p className="mt-1 text-[12px] text-sub">Alterações sem armazenar mensagens ou argumentos sensíveis.</p>{privateSkills.some((skill) => data.skillVersions.some((version) => version.skill_id === skill.id)) && <section className="mt-5 rounded-[13px] border border-line bg-bg p-4"><h3 className="text-[13px] font-semibold">Rollback de skills privados</h3><p className="mt-1 text-[10.5px] text-sub">Restaurar preserva o histórico e cria uma versão nova.</p><div className="mt-3 grid gap-2 md:grid-cols-2">{privateSkills.map((skill) => { const versions = data.skillVersions.filter((version) => version.skill_id === skill.id).slice(0, 4); return versions.length ? <div key={skill.id} className="rounded-[10px] bg-surface p-3"><strong className="text-[11.5px]">{skill.name}</strong><div className="mt-2 flex flex-wrap gap-1.5">{versions.map((version) => <button key={version.id} disabled={!canWrite || version.version === skill.current_version} onClick={() => restore(skill, version)} className="rounded-full border border-line bg-bg px-2.5 py-1 text-[9.5px] text-sub disabled:opacity-35">v{version.version}</button>)}</div></div> : null; })}</div></section>}<div className="mt-5 overflow-hidden rounded-[13px] border border-line bg-bg">{data.audit.length ? data.audit.map((entry) => <div key={entry.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0"><span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-surface text-sub"><History size={14} /></span><div className="min-w-0 flex-1"><p className="text-[11.5px] font-semibold">{entry.metadata?.name || entry.entity_type}</p><p className="text-[10px] text-sub">{entry.action} · {entry.entity_type}{entry.version ? ` · v${entry.version}` : ""}</p></div><time className="text-[9.5px] text-faint">{date(entry.created_at)}</time></div>) : <p className="p-8 text-center text-[11.5px] text-sub">Nenhuma alteração registrada.</p>}</div></div></div>;
}

export default function Inteligencia({ sessao }) {
  const [tab, setTab] = useState("agents"); const [data, setData] = useState(emptyData); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const canWrite = ["owner", "admin"].includes(sessao?.organizacaoAtual?.papel);
  const [agents, setAgents] = useState([]); const [agentsErro, setAgentsErro] = useState("");
  const load = async () => setData(await api.inteligencia.carregar());
  const carregarAgents = async () => {
    try { setAgents(await api.agents.listar()); setAgentsErro(""); }
    catch (falha) { setAgentsErro(falha.message); }
  };
  useEffect(() => { load().catch((failure) => setError(failure.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => { carregarAgents(); }, []);
  if (loading) return <div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando inteligência…</div>;
  return <div className="flex min-h-0 flex-1 flex-col bg-surface"><header className="flex-none border-b border-line bg-bg px-4 pt-4 md:px-7"><div className="flex items-start gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-accent">Núcleo de Conhecimento</p><h1 className="text-[22px] font-semibold tracking-tight">Central de Inteligência</h1><p className="mt-1 text-[11px] text-sub">Agentes, habilidades, campanhas e informação com fronteiras claras.</p></div><span className="ml-auto hidden items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[10px] text-sub md:flex"><ShieldCheck size={14} className="text-success" />Isolada por organização</span></div><nav className="scrollbar-fina mt-4 flex gap-1 overflow-x-auto">{tabs.map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={`flex min-w-fit items-center gap-2 border-b-2 px-3 py-2.5 text-[11.5px] font-medium ${tab === id ? "border-accent text-accent-forte" : "border-transparent text-sub"}`}><Icon size={15} />{label}</button>)}</nav></header>{error && <div role="alert" className="mx-4 mt-3 rounded-[9px] bg-danger/10 px-4 py-3 text-[12px] text-danger md:mx-7">{error}</div>}{tab === "agents" && <Agents aoAtualizarSkills={load} bindings={data.bindings} agents={agents} catalogoSkills={data.skills} canWrite={canWrite} recarregar={async () => { await carregarAgents(); await load(); }} carregando={false} erro={agentsErro} />}{tab === "knowledge" && <div className="flex min-h-0 flex-1 flex-col"><p className="mx-4 mt-3 rounded-[9px] bg-surface px-3 py-2 text-[11px] text-sub md:mx-7">Conhecimento é o que seus agentes podem <strong>consultar</strong> ao responder — diferente de Habilidades, que é o que eles sabem <strong>fazer</strong>.</p><Conhecimento sessao={sessao} inteligencia={data} embedded /></div>}{tab === "assistants" && <Assistants data={data} canWrite={canWrite} reload={load} fail={setError} onTest={() => setTab("simulator")} onManageSkills={() => setTab("skills")} />}{tab === "skills" && <div className="flex min-h-0 flex-1 flex-col"><p className="mx-4 mt-3 rounded-[9px] bg-surface px-3 py-2 text-[11px] text-sub md:mx-7">Habilidades é o que seus agentes sabem <strong>fazer</strong> — diferente de Conhecimento, que é o que eles podem <strong>consultar</strong>. Aqui você cria e publica; dentro de cada agente, em "O que sabe fazer", você escolhe quais delas ele usa.</p><Skills data={data} canWrite={canWrite} reload={load} fail={setError} /></div>}{tab === "campaigns" && <Campaigns data={data} canWrite={canWrite} reload={load} fail={setError} />}{tab === "simulator" && <Simulator reload={load} fail={setError} />}{tab === "history" && <Audit data={data} canWrite={canWrite} reload={load} fail={setError} />}</div>;
}
