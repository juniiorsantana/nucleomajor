import { useEffect, useMemo, useState } from "react";
import {
  Bot, BookOpen, Check, ChevronLeft, ChevronRight, FlaskConical, History,
  Layers3, Megaphone, MessageCircle, Plus, RotateCcw, Save,
  ShieldCheck, Sparkles, WandSparkles, X,
} from "lucide-react";
import { api } from "../../data/client";
import { CUSTOMER_ROLLOUT_MODES, maskPhone, rolloutMode } from "../../domain/customerAssistant";
import { resolverRotaSkill } from "../../domain/intelligenceRouter";
import Conhecimento from "./Conhecimento";
import Agentes from "./inteligencia/Agentes";

const tabs = [
  ["assistants", "Agentes", Bot], ["knowledge", "Conhecimento", BookOpen],
  ["skills", "Habilidades", WandSparkles], ["campaigns", "Campanhas", Megaphone],
  ["simulator", "Testar agente", FlaskConical], ["history", "Histórico", History],
  ["access", "Acessos", ShieldCheck],
];
const list = (value) => String(value || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
const date = (value) => value ? new Date(value).toLocaleString("pt-BR") : "—";
const emptyData = { profiles: [], skills: [], skillVersions: [], bindings: [], collections: [], documentCollections: [], campaigns: [], sources: [], campaignSkills: [], campaignCollections: [], audit: [], pilotContacts: [], contacts: [] };

function Trail({ context }) {
  const items = [["Assistente", context?.assistente?.nome], ["Skill", context?.skillAtivo?.nome], ["Campanha", context?.campanha?.nome || "Sem campanha"], ["Conhecimento", `${context?.colecoesPermitidas?.length || 0} coleção(ões)`]];
  return <div className="flex flex-wrap items-center gap-1.5 rounded-[12px] border border-accent/20 bg-accent-soft/60 p-2.5">{items.map(([label, value], index) => <div key={label} className="flex items-center gap-1.5"><span className="rounded-[8px] border border-line bg-bg px-2.5 py-1.5 text-[10.5px] text-sub"><strong className="mr-1 text-fg">{label}</strong>{value || "Não definido"}</span>{index < items.length - 1 && <ChevronRight size={13} className="text-accent-forte" />}</div>)}</div>;
}


function RolloutControl({ draft, contacts, update, disabled }) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const visible = contacts.filter((contact) => !term || [contact.name, contact.company, contact.phone, contact.whatsapp_id].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(term)));
  const toggleContact = (contactId, checked) => update("pilotContactIds", checked ? [...new Set([...draft.pilotContactIds, contactId])] : draft.pilotContactIds.filter((id) => id !== contactId));
  return <fieldset disabled={disabled} className="grid gap-3 border-t border-line pt-5"><legend className="mb-1 flex items-center gap-2 text-[12px] font-semibold"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0f9f8f] text-[10px] font-bold text-white">4</span>Liberação do atendimento</legend><p className="-mt-2 pl-8 text-[10.5px] text-sub">Defina com segurança quem pode receber respostas pelo WhatsApp principal.</p><div className="grid gap-2 md:grid-cols-3">{CUSTOMER_ROLLOUT_MODES.map((mode, index) => { const selected = draft.rolloutMode === mode.id; return <label key={mode.id} className={`relative cursor-pointer rounded-[11px] border p-3 transition ${selected ? "border-[#0f9f8f] bg-[#e6f6f2] shadow-sm" : "border-line bg-bg hover:border-faint"}`}><input type="radio" name="customer-rollout" value={mode.id} checked={selected} onChange={() => update("rolloutMode", mode.id)} className="sr-only" /><span className="flex items-center gap-2"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold ${selected ? "bg-[#0f9f8f] text-white" : "bg-surface text-faint"}`}>{index + 1}</span><strong className="text-[11px]">{mode.label}</strong></span><span className="mt-2 block text-[9.5px] leading-4 text-sub">{mode.description}</span></label>; })}</div>{draft.rolloutMode === "pilot" && <div className="rounded-[12px] border border-[#0f9f8f]/25 bg-[#f5fbfa] p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center"><div><strong className="text-[11px]">Contatos autorizados no piloto</strong><p className="mt-0.5 text-[9.5px] text-sub">Eles continuam sendo clientes no CRM; não recebem permissão de operador.</p></div><span className="rounded-full bg-[#e6f6f2] px-2.5 py-1 text-[9px] font-semibold text-[#08796e] sm:ml-auto">{draft.pilotContactIds.length} selecionado(s)</span></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, empresa ou telefone" className="mt-3 w-full rounded-[9px] border border-line bg-bg px-3 py-2 text-[11px] outline-none focus:border-[#0f9f8f]" /><div className="scrollbar-fina mt-2 max-h-48 overflow-y-auto rounded-[9px] border border-line bg-bg">{visible.length ? visible.map((contact) => <label key={contact.id} className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2.5 last:border-0 hover:bg-surface"><input type="checkbox" checked={draft.pilotContactIds.includes(contact.id)} onChange={(event) => toggleContact(contact.id, event.target.checked)} className="accent-[#0f9f8f]" /><span className="min-w-0 flex-1"><strong className="block truncate text-[10.5px]">{contact.name || "Contato sem nome"}</strong><span className="block truncate text-[9px] text-sub">{contact.company || "Sem empresa"} · {maskPhone(contact.phone || contact.whatsapp_id)}</span></span></label>) : <p className="p-5 text-center text-[10px] text-sub">Nenhum contato encontrado. Cadastre o número de teste em Contatos primeiro.</p>}</div></div>}</fieldset>;
}

const accessDraft = (profile, data) => ({
  rolloutMode: rolloutMode(profile),
  pilotContactIds: data.pilotContacts.filter((item) => item.profile_id === profile.id && item.active).map((item) => item.contact_id),
});

function AccessTab({ data, canWrite, reload, fail }) {
  const customer = data.profiles.find((profile) => profile.audience === "customer");
  const [draft, setDraft] = useState(() => customer ? accessDraft(customer, data) : null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (customer) setDraft(accessDraft(customer, data)); }, [customer, data.pilotContacts]);
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  if (!customer || !draft) return <div className="flex flex-1 items-center justify-center p-8 text-center text-[12px] text-sub">Nenhum assistente de atendimento a clientes foi configurado para esta organização.</div>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(accessDraft(customer, data));
  const save = async () => {
    if (draft.rolloutMode === "pilot" && !draft.pilotContactIds.length) { fail("Selecione ao menos um contato do CRM para ativar o piloto."); return; }
    setSaving(true); setSaved(false); fail("");
    try {
      await api.inteligencia.configurarRollout({ profileId: customer.id, mode: draft.rolloutMode, contactIds: draft.pilotContactIds });
      await reload();
      setSaved(true);
    } catch (error) { fail(error.message); }
    finally { setSaving(false); }
  };
  return <div className="scrollbar-fina flex-1 overflow-y-auto p-4 md:p-7"><div className="mx-auto max-w-4xl">
    <p className="text-[10px] font-bold uppercase tracking-[.14em] text-accent">Central de inteligência</p>
    <h2 className="mt-1 text-[20px] font-semibold tracking-tight">Acessos</h2>
    <p className="mt-1 max-w-2xl text-[12px] leading-5 text-sub">Defina com segurança quem, no WhatsApp principal, pode receber respostas automáticas de clientes.</p>
    <div className="mt-6 rounded-[16px] border border-line bg-bg p-5">
      <RolloutControl draft={draft} contacts={data.contacts} update={update} disabled={!canWrite} />
      {canWrite && <div className="mt-5 flex items-center gap-2 border-t border-line pt-5"><span className={`text-[10px] ${dirty ? "text-[#b56a15]" : saved ? "text-success" : "text-faint"}`}>{dirty ? "Alterações não salvas" : saved ? "Alterações salvas" : "Tudo salvo"}</span><button type="button" onClick={save} disabled={!dirty || saving} className="ml-auto inline-flex items-center gap-1.5 rounded-[9px] bg-[#0f9f8f] px-4 py-2 text-[10.5px] font-semibold text-white disabled:opacity-35"><Save size={13} />{saving ? "Salvando…" : "Salvar mudanças"}</button></div>}
    </div>
  </div></div>;
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

function Skills({ data, canWrite, reload, fail }) {
  const [wizard, setWizard] = useState(false);
  const usadaPor = (skillId) => new Set(data.bindings.filter((item) => item.skill_id === skillId && item.enabled).map((item) => item.profile_id)).size;
  return <div className="scrollbar-fina flex-1 overflow-y-auto p-4 md:p-7"><div className="mx-auto max-w-6xl">
    <div className="flex items-end gap-3">
      <div><h2 className="text-[18px] font-semibold">Habilidades</h2><p className="mt-1 text-[12px] text-sub">Habilidades são o que os agentes sabem fazer. Oficiais evoluem centralmente; privadas pertencem só a esta organização.</p></div>
      {canWrite && <button onClick={() => setWizard(true)} className="ml-auto inline-flex items-center gap-2 rounded-[9px] bg-accent px-4 py-2.5 text-[12px] font-semibold text-white"><Plus size={15} />Criar habilidade</button>}
    </div>
    <div className="mt-5 overflow-hidden rounded-[12px] border border-line bg-bg">
      {data.skills.map((skill) => {
        const contagem = usadaPor(skill.id);
        return <div key={skill.id} className="flex items-start gap-2.5 border-b border-line px-4 py-3.5 last:border-b-0">
          <Sparkles size={15} className={`mt-0.5 flex-none ${skill.owner_type === "platform" ? "text-accent-forte" : "text-[#08796e]"}`} />
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-[13px] font-semibold text-fg">{skill.name}</strong>
            {skill.description && <p className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-sub">{skill.description}</p>}
            <p className="mt-1.5 text-[11.5px] text-faint">
              {skill.owner_type === "platform" ? "Núcleo" : "Privada"} · v{skill.current_version} · usada por {contagem} {contagem === 1 ? "agente" : "agentes"}
            </p>
          </div>
        </div>;
      })}
      {!data.skills.length && <p className="p-8 text-center text-[11.5px] text-sub">Nenhuma habilidade cadastrada.</p>}
    </div>
  </div>{wizard && <SkillWizard data={data} close={() => setWizard(false)} saved={reload} fail={fail} />}</div>;
}

const emptyCampaign = { id: null, nome: "", status: "draft", objetivo: "", oferta: "", publico: "", resultado: "", padrao: false, fontes: "keyword:", skillIds: [], collectionIds: [] };
function Campaigns({ data, canWrite, reload, fail }) {
  const [draft, setDraft] = useState(null); const customer = data.profiles.find((item) => item.audience === "customer");
  const open = (campaign) => setDraft({ id: campaign.id, nome: campaign.name, status: campaign.status, objetivo: campaign.objective, oferta: campaign.offer, publico: campaign.audience_description, resultado: campaign.desired_outcome, padrao: campaign.is_default, fontes: data.sources.filter((item) => item.campaign_id === campaign.id).map((item) => `${item.source_type}:${item.source_value}`).join("\n"), skillIds: data.campaignSkills.filter((item) => item.campaign_id === campaign.id).map((item) => item.skill_id), collectionIds: data.campaignCollections.filter((item) => item.campaign_id === campaign.id).map((item) => item.collection_id) });
  const save = async () => { try { const fontes = list(draft.fontes).map((line, index) => { const at = line.indexOf(":"); return { tipo: at > 0 ? line.slice(0, at).trim() : "keyword", valor: at > 0 ? line.slice(at + 1).trim() : line, prioridade: index * 10 + 10 }; }); await api.inteligencia.salvarCampanha({ ...draft, profileId: customer.id, fontes }); setDraft(null); await reload(); } catch (error) { fail(error.message); } };
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
          <div><h2 className="text-[17px] font-semibold">Testar agente</h2><p className="text-[11px] text-sub">Teste o roteamento sem alterar CRM ou agenda.</p></div>
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
  const [tab, setTab] = useState("assistants"); const [data, setData] = useState(emptyData); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const canWrite = ["owner", "admin"].includes(sessao?.organizacaoAtual?.papel);
  const load = async () => setData(await api.inteligencia.carregar());
  useEffect(() => { load().catch((failure) => setError(failure.message)).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando inteligência…</div>;
  return <div className="flex min-h-0 flex-1 flex-col bg-surface"><header className="flex-none border-b border-line bg-bg px-4 pt-4 md:px-7"><div className="flex items-start gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-accent">Núcleo de Conhecimento</p><h1 className="text-[22px] font-semibold tracking-tight">Central de Inteligência</h1><p className="mt-1 text-[11px] text-sub">Agentes, habilidades, campanhas e informação com fronteiras claras.</p></div><span className="ml-auto hidden items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[10px] text-sub md:flex"><ShieldCheck size={14} className="text-success" />Isolada por organização</span></div><nav className="scrollbar-fina mt-4 flex gap-1 overflow-x-auto">{tabs.map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={`flex min-w-fit items-center gap-2 border-b-2 px-3 py-2.5 text-[11.5px] font-medium ${tab === id ? "border-accent text-accent-forte" : "border-transparent text-sub"}`}><Icon size={15} />{label}</button>)}</nav></header>{error && <div role="alert" className="mx-4 mt-3 rounded-[9px] bg-danger/10 px-4 py-3 text-[12px] text-danger md:mx-7">{error}</div>}{tab === "knowledge" && <Conhecimento sessao={sessao} inteligencia={data} embedded />}{tab === "assistants" && <Agentes data={data} canWrite={canWrite} reload={load} fail={setError} onTest={() => setTab("simulator")} onManageSkills={() => setTab("skills")} onOpenAccess={() => setTab("access")} onOpenKnowledge={() => setTab("knowledge")} />}{tab === "skills" && <Skills data={data} canWrite={canWrite} reload={load} fail={setError} />}{tab === "campaigns" && <Campaigns data={data} canWrite={canWrite} reload={load} fail={setError} />}{tab === "simulator" && <Simulator reload={load} fail={setError} />}{tab === "history" && <Audit data={data} canWrite={canWrite} reload={load} fail={setError} />}{tab === "access" && <AccessTab data={data} canWrite={canWrite} reload={load} fail={setError} />}</div>;
}
