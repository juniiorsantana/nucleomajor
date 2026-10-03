/**
 * Agentes da Equipe de IA (fluxo novo, 03/10/2026).
 *
 * A pergunta que guia a tela é "como uma empresa contrata e acompanha alguém
 * para fazer um trabalho". Três ideias:
 *   1. Tudo do agente numa página só, num ROTEIRO de seções na ordem em que se
 *      monta um: Personalidade, Conhecimento, Habilidades, Como vender, Onde
 *      atende (e Desempenho no fim).
 *   2. O roteiro diz o que falta (`domain/prontidaoDoAgente`), e a lista mostra
 *      de cada agente onde ele atende e o quanto está pronto.
 *   3. Testar fica a um clique, numa gaveta, sem ocupar a tela.
 *
 * Identidade: agente é QUADRADO (`MarcaDoAgente`), pessoa é círculo. O símbolo
 * e a cor vêm da aparência guardada, ou do próprio agente.
 *
 * Invariáveis que continuam valendo (e que os testes vigiam):
 *   - fala só com as operações `agents.*` da FASE F;
 *   - com quem o agente conversa é definido na criação e imutável depois;
 *   - nenhum agente nasce principal; trocar o principal é UMA chamada atômica;
 *   - agente novo nasce PAUSADO: ninguém fala com o que não foi testado;
 *   - toda escrita é seguida de recarga do servidor; nada otimista.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Play, Plus, Shuffle, X } from "lucide-react";
import { api } from "../../data/client";
import {
  AUDIENCIAS, PRESETS_DE_AGENTE, TONS_SUGERIDOS, agruparPorAudiencia,
  avisoAoDesativar, avisoAoTornarPadrao, descricaoDaSkill, mensagemDeErro,
  padraoDaAudiencia, rotuloDeAudiencia, separarSkills, skillsPreSelecionadas, tomPorId,
} from "../../domain/agents";
import { CORES_DE_AGENTE, aparenciaDoAgent, normalizarAparencia, sementeNova } from "../../domain/aparenciaDoAgente";
import { ondeAtende, prontidaoDoAgent } from "../../domain/prontidaoDoAgente";
import { slugFromAgentName } from "../../../../../packages/intelligence/src/agent.mjs";
import { DialogoConfirmar, MarcaDoAgente } from "../ui";

const entrada = "mt-1 w-full rounded-ctl border border-line-strong bg-bg px-3 py-2 text-[13px] text-fg outline-none focus:border-signal disabled:bg-surface disabled:text-faint";
const rotuloDeSecao = "text-[11px] font-semibold uppercase tracking-[.08em] text-faint";

function Campo({ rotulo, ajuda, children }) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-fg">{rotulo}</span>
      {children}
      {ajuda ? <span className="mt-1 block text-[11.5px] leading-4 text-faint">{ajuda}</span> : null}
    </label>
  );
}

/** Onde atende, em uma linha: o que a lista e o cabeçalho mostram. */
function TextoOnde({ onde, audience }) {
  const publico = rotuloDeAudiencia(audience).toLowerCase();
  if (onde.tipo === "pausado") return <span className="text-faint">Pausado</span>;
  if (onde.tipo === "principal") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="rounded-ctl bg-signal-soft px-1.5 py-px text-[11px] font-semibold text-signal">Principal</span>
        <span className="text-sub">recebe quem chega de {publico}</span>
      </span>
    );
  }
  if (onde.tipo === "campanhas") {
    return (
      <span className="text-fg">
        {onde.campanhas.length} {onde.campanhas.length === 1 ? "campanha" : "campanhas"}
        <span className="block truncate text-[11.5px] text-sub">{onde.campanhas.join(" · ")}</span>
      </span>
    );
  }
  return <span className="font-medium text-warning">Ainda não atende</span>;
}

function Prontidao({ prontidao }) {
  const { itens, prontos, total, primeiraFalta } = prontidao;
  return (
    <span className="grid gap-1.5" title={itens.map((i) => `${i.rotulo}: ${i.pronto === true ? "pronto" : i.pronto === false ? i.falta : "carregando"}`).join("\n")}>
      <span className="grid grid-cols-5 gap-0.5" aria-hidden="true">
        {itens.map((i) => (
          <span key={i.id} className={`h-1 ${i.pronto === true ? "bg-ia" : "bg-line"}`} />
        ))}
      </span>
      <span className={`text-[11.5px] ${primeiraFalta ? "text-warning" : "text-sub"}`}>
        {primeiraFalta ? primeiraFalta.falta : prontos === total ? "Pronto" : `${prontos} de ${total}`}
      </span>
    </span>
  );
}

/* ========================================================================== *
 * CRIAR — três passos curtos: para que serve, nome e jeito, revisar.
 * ========================================================================== */

const PASSOS = ["intencao", "jeito", "revisar"];

function estadoInicial() {
  return {
    audience: null, name: "", role: "", tomId: null, tone: "",
    soulMarkdown: "", slug: "", slugManual: false, skillIds: [],
    aparencia: { cor: 1, semente: sementeNova() },
  };
}

/** Escolha de cor e "Outro símbolo", usada na criação e na Personalidade. */
function EscolhaDeAparencia({ aparencia, aoMudar, desabilitado = false }) {
  return (
    <div className="flex items-center gap-4 border border-line p-3.5">
      <MarcaDoAgente aparencia={aparencia} tamanho={56} />
      <div className="grid gap-2">
        <span className="text-[12px] font-medium text-fg">Aparência</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Cor do agente">
          {Array.from({ length: CORES_DE_AGENTE }, (_, i) => i + 1).map((cor) => (
            <button
              key={cor}
              type="button"
              disabled={desabilitado}
              aria-label={`Cor ${cor}`}
              aria-pressed={aparencia.cor === cor}
              onClick={() => aoMudar({ ...aparencia, cor })}
              className={`h-6 w-6 cursor-pointer disabled:cursor-default ${aparencia.cor === cor ? "outline outline-2 outline-offset-2 outline-fg" : ""}`}
              style={{ background: `var(--el-ag-${cor})` }}
            />
          ))}
        </div>
        <button
          type="button"
          disabled={desabilitado}
          onClick={() => aoMudar({ ...aparencia, semente: sementeNova() })}
          className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-ctl border border-line-strong px-2.5 py-1 text-[11.5px] font-medium text-fg hover:bg-surface-hover disabled:cursor-default disabled:opacity-40"
        >
          <Shuffle size={13} />Outro símbolo
        </button>
      </div>
    </div>
  );
}

export function AssistenteDeCriacao({ catalogoSkills, aoFechar, aoCriar }) {
  const [passo, setPasso] = useState(0);
  const [form, setForm] = useState(estadoInicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const campo = (chave, valor) => setForm((atual) => ({ ...atual, [chave]: valor }));

  const escolherPreset = (preset) => {
    const indice = PRESETS_DE_AGENTE.findIndex((p) => p.id === preset.id);
    setForm({
      ...estadoInicial(),
      audience: preset.audience,
      role: preset.role,
      tomId: preset.tomSugerido,
      tone: tomPorId(preset.tomSugerido)?.texto ?? "",
      soulMarkdown: preset.soulSugerido,
      skillIds: skillsPreSelecionadas(catalogoSkills, preset),
      aparencia: { cor: (indice % CORES_DE_AGENTE) + 1, semente: sementeNova() },
    });
    // "Criar do zero" não traz público: ele é escolhido aqui mesmo, antes de seguir.
    if (preset.audience) setPasso(1);
  };

  const escolherAudience = (audience) => {
    campo("audience", audience);
    setPasso(1);
  };

  const digitarNome = (nome) => {
    setForm((atual) => ({
      ...atual,
      name: nome,
      slug: atual.slugManual ? atual.slug : slugFromAgentName(nome, atual.audience),
    }));
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
        // Nasce pausado: ninguém fala com um agente que ainda não foi testado.
        active: false,
        appearance: form.aparencia,
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(17,17,19,.44)] md:items-center md:p-4">
      <section role="dialog" aria-label="Novo agente" className="flex h-full w-full flex-col overflow-hidden border-line-strong bg-bg md:h-auto md:max-h-[92vh] md:max-w-xl md:border">
        <header className="flex flex-none items-center gap-3 border-b border-line px-5 py-4">
          {passo > 0 || form._escolhendoPublico ? (
            <button
              onClick={() => (passo > 0 ? voltar() : campo("_escolhendoPublico", false))}
              className="-ml-1.5 rounded-ctl p-1.5 text-sub hover:bg-surface-hover"
              aria-label="Voltar"
            >
              <ArrowLeft size={18} />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-faint">Novo agente</p>
            <div className="mt-1.5 grid grid-cols-3 gap-0.5" role="progressbar" aria-valuenow={passo + 1} aria-valuemax={PASSOS.length}>
              {["Para que serve", "Nome e jeito", "Revisar"].map((rotulo, index) => (
                <span key={rotulo} className={`grid gap-1 text-[11px] ${index <= passo ? "font-medium text-fg" : "text-faint"}`}>
                  <span className={`h-0.5 ${index <= passo ? "bg-ia" : "bg-line"}`} />
                  {rotulo}
                </span>
              ))}
            </div>
          </div>
          <button onClick={aoFechar} className="rounded-ctl p-2 text-sub hover:bg-surface-hover" aria-label="Fechar"><X size={18} /></button>
        </header>

        <div className="scrollbar-fina flex-1 overflow-y-auto p-5">
          {passo === 0 && !form._escolhendoPublico ? (
            <div className="grid gap-4">
              <div>
                <h2 className="text-[18px] font-semibold tracking-tight">Para que serve esse agente?</h2>
                <p className="mt-1 text-[12.5px] text-sub">A escolha já define com quem ele conversa, as habilidades e um texto de personalidade. Tudo dá para mudar depois.</p>
              </div>
              <div className="grid grid-cols-2 border border-line">
                {PRESETS_DE_AGENTE.map((preset, i) => (
                  <button
                    key={preset.id}
                    onClick={() => (preset.audience ? escolherPreset(preset) : setForm({ ...estadoInicial(), _escolhendoPublico: true }))}
                    className={`grid gap-0.5 p-3.5 text-left transition-colors hover:bg-ia-soft ${i % 2 === 0 ? "border-r border-line" : ""} ${i < PRESETS_DE_AGENTE.length - 2 ? "border-b border-line" : ""}`}
                  >
                    <span className="text-[13px] font-semibold text-fg">{preset.rotulo}</span>
                    <span className="text-[11.5px] leading-4 text-sub">{preset.descricao}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {passo === 0 && form._escolhendoPublico ? (
            <div className="grid gap-4">
              <div>
                <h2 className="text-[18px] font-semibold tracking-tight">Com quem esse agente vai conversar?</h2>
                <p className="mt-1 text-[12.5px] text-sub">Isso define o que ele pode ver e não muda depois de criado.</p>
              </div>
              <div className="grid border border-line">
                {AUDIENCIAS.map((audiencia, i) => (
                  <button key={audiencia.id} onClick={() => escolherAudience(audiencia.id)}
                    className={`grid gap-0.5 p-4 text-left transition-colors hover:bg-ia-soft ${i === 0 ? "border-b border-line" : ""}`}>
                    <span className="text-[13.5px] font-semibold">{audiencia.id === "customer" ? "Clientes e leads" : "Minha equipe"}</span>
                    <span className="text-[11.5px] text-sub">{audiencia.descricao}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {passo === 1 ? (
            <div className="grid gap-4">
              <h2 className="text-[18px] font-semibold tracking-tight">Como ele se chama e como conversa?</h2>
              <EscolhaDeAparencia aparencia={form.aparencia} aoMudar={(aparencia) => campo("aparencia", aparencia)} />
              <Campo rotulo="Nome">
                <input autoFocus value={form.name} onChange={(e) => digitarNome(e.target.value)} placeholder="Emília" className={entrada} />
              </Campo>
              <Campo rotulo="Função" ajuda="Como você chamaria esse papel dentro da empresa.">
                <input value={form.role} onChange={(e) => campo("role", e.target.value)} className={entrada} />
              </Campo>
              <div>
                <span className="text-[12px] font-medium">Como ele conversa</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {TONS_SUGERIDOS.map((tom) => (
                    <button key={tom.id} onClick={() => setForm((a) => ({ ...a, tomId: tom.id, tone: tom.texto }))}
                      className={`rounded-ctl border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                        form.tomId === tom.id ? "border-fg bg-fg text-bg" : "border-line-strong text-sub hover:text-fg"
                      }`}>
                      {tom.rotulo}
                    </button>
                  ))}
                </div>
              </div>
              <Campo rotulo="Instruções" ajuda="Texto sugerido pelo tipo de agente. Edite à vontade.">
                <textarea value={form.soulMarkdown} onChange={(e) => campo("soulMarkdown", e.target.value)} rows={5}
                  className={`${entrada} leading-5`}
                  placeholder="Ex.: recebe cada pessoa com atenção, entende o que ela precisa antes de responder e nunca soa como um robô de menu." />
              </Campo>
              <details className="border border-line">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium text-sub [&::-webkit-details-marker]:hidden">
                  <ChevronDown size={14} />Configurações avançadas
                </summary>
                <div className="border-t border-line p-3">
                  <Campo rotulo="Identificador técnico" ajuda="Gerado a partir do nome. Só mexa aqui se precisar de um valor específico.">
                    <input value={form.slug} onChange={(e) => setForm((a) => ({ ...a, slug: e.target.value, slugManual: true }))}
                      className={`${entrada} font-mono text-[12px]`} />
                  </Campo>
                </div>
              </details>
            </div>
          ) : null}

          {passo === 2 ? (
            <div className="grid gap-4">
              <h2 className="text-[18px] font-semibold tracking-tight">Confira antes de criar</h2>
              <div className="flex items-center gap-3">
                <MarcaDoAgente aparencia={form.aparencia} tamanho={44} />
                <div>
                  <p className="text-[15px] font-semibold">{form.name}</p>
                  <p className="text-[12px] text-sub">{form.role ? `${form.role} · ` : ""}Conversa com {rotuloDeAudiencia(form.audience).toLowerCase()} <span className="text-faint">(não muda depois)</span></p>
                </div>
              </div>
              <div>
                <p className={rotuloDeSecao}>O que ele sabe fazer</p>
                {habilidadesDisponiveis.length ? (
                  <div className="mt-2 grid border border-line">
                    {habilidadesDisponiveis.map((skill, i) => {
                      const marcada = form.skillIds.includes(skill.id);
                      return (
                        <label key={skill.id} className={`flex cursor-pointer items-start gap-3 p-3 ${i ? "border-t border-line" : ""}`}>
                          <input type="checkbox" checked={marcada} onChange={() => alternarSkill(skill.id)} className="mt-0.5 accent-[var(--el-ia)]" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12.5px] font-semibold">{skill.name}</span>
                            <span className="block text-[11.5px] text-sub">{descricaoDaSkill(skill)}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-[12px] text-sub">Nenhuma habilidade publicada para esse público ainda. Dá para ligar depois.</p>
                )}
              </div>
              <p className="bg-surface p-3 text-[12px] leading-5 text-sub">
                <strong className="text-fg">Ele nasce pausado.</strong> Depois de criar, você testa e escolhe onde ele
                atende. Quem responde primeiro continua sendo o agente principal até você mudar.
              </p>
              {erro ? <p className="text-[12px] text-danger" role="alert">{erro}</p> : null}
            </div>
          ) : null}
        </div>

        {passo > 0 ? (
          <footer className="flex flex-none justify-end gap-2 border-t border-line px-5 py-3">
            {passo === 1 ? (
              <button onClick={() => setPasso(2)} disabled={!nomeValido}
                className="rounded-ctl bg-accent px-4 py-2 text-[12.5px] font-semibold text-on-accent disabled:opacity-40">
                Continuar
              </button>
            ) : (
              <button onClick={concluir} disabled={salvando}
                className="inline-flex items-center gap-2 rounded-ctl bg-accent px-4 py-2 text-[12.5px] font-semibold text-on-accent disabled:opacity-40">
                <Check size={14} />{salvando ? "Criando…" : "Criar e abrir"}
              </button>
            )}
          </footer>
        ) : null}
      </section>
    </div>
  );
}

/* ========================================================================== *
 * PÁGINA DO AGENTE — o roteiro à esquerda, a seção ao lado.
 * ========================================================================== */

export const SECOES_DO_AGENTE = [
  ["personalidade", "Personalidade"],
  ["conhecimento", "Conhecimento"],
  ["habilidades", "Habilidades"],
  ["vender", "Como vender"],
  ["onde", "Onde atende"],
  ["desempenho", "Desempenho"],
];

function rascunhoDe(agent) {
  return {
    name: agent.name ?? "", slug: agent.slug ?? "", role: agent.role ?? "",
    tone: agent.tone ?? "", soulMarkdown: agent.soulMarkdown ?? "",
    aparencia: aparenciaDoAgent(agent),
  };
}

export function DetalheAgent({
  agent, catalogoSkills, canWrite, aoVoltar, acoes, extras = {},
  campanhas = [], temConhecimento = null, playbookPublicado = null,
}) {
  const [secao, setSecao] = useState("personalidade");
  const [testando, setTestando] = useState(false);
  const [bindings, setBindings] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState("");

  const original = useMemo(() => rascunhoDe(agent), [agent]);
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

  useEffect(() => {
    if (!testando) return undefined;
    const aoTeclar = (e) => { if (e.key === "Escape") setTestando(false); };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [testando]);

  const sujo = JSON.stringify(rascunho) !== JSON.stringify(original);
  const { vinculadas, disponiveis } = useMemo(
    () => separarSkills(catalogoSkills, bindings, agent.audience),
    [catalogoSkills, bindings, agent.audience],
  );
  const onde = ondeAtende(agent, campanhas);
  const prontidao = prontidaoDoAgent({ agent, habilidades: vinculadas.length, temConhecimento, playbookPublicado, onde });
  const itemDe = (id) => prontidao.itens.find((i) => i.id === id);

  const campo = (chave, valor) => { setSalvo(false); setRascunho((r) => ({ ...r, [chave]: valor })); };

  const salvar = async () => {
    setSalvando(true);
    setErro("");
    try {
      const { aparencia, ...campos } = rascunho;
      const mudouAparencia = JSON.stringify(aparencia) !== JSON.stringify(original.aparencia);
      await acoes.editar(agent.id, mudouAparencia ? { ...campos, appearance: normalizarAparencia(aparencia) } : campos);
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

  const resumoDaSecao = (id) => {
    if (id === "personalidade") return agent.role || "Quem ele é e como conversa";
    if (id === "conhecimento") return temConhecimento === false ? itemDe("conhecimento").falta : `O que ele consulta`;
    if (id === "habilidades") return vinculadas.length ? vinculadas.map((s) => s.name).join(", ") : "Nenhuma ligada";
    if (id === "vender") return playbookPublicado === false ? "Roteiro não publicado" : "Roteiro comercial da empresa";
    if (id === "onde") return onde.tipo === "principal" ? `Principal de ${rotuloDeAudiencia(agent.audience).toLowerCase()}` : onde.tipo === "campanhas" ? `${onde.campanhas.length} campanha(s)` : onde.tipo === "pausado" ? "Pausado" : "Ainda não atende";
    return "Conversas e avaliações";
  };

  const ctx = { ...extras, fechar: aoVoltar };
  const estadoGeral = onde.tipo === "pausado"
    ? <span className="rounded-ctl border border-line-strong px-1.5 py-px text-[11px] font-medium text-sub">Pausado</span>
    : onde.tipo === "nenhum"
      ? <span className="rounded-ctl bg-warning-soft px-1.5 py-px text-[11px] font-medium text-warning">Ainda não atende</span>
      : <span className="inline-flex items-center gap-1 rounded-ctl bg-success-soft px-1.5 py-px text-[11px] font-medium text-success"><span className="h-1.5 w-1.5 rounded-full bg-success" />Atendendo</span>;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-bg">
      <header className="flex flex-none flex-wrap items-center gap-3 border-b border-line px-4 py-3.5 md:px-6">
        <button onClick={aoVoltar} className="-ml-1 rounded-ctl p-1.5 text-sub hover:bg-surface-hover" aria-label="Voltar">
          <ArrowLeft size={18} />
        </button>
        <MarcaDoAgente agent={agent} aparencia={rascunho.aparencia} tamanho={44} titulo={`Símbolo de ${agent.name}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[19px] font-semibold tracking-tight">{agent.name}</h2>
            {estadoGeral}
          </div>
          <p className="mt-0.5 text-[12px] text-sub">
            {agent.role ? `${agent.role} · ` : ""}Conversa com {rotuloDeAudiencia(agent.audience).toLowerCase()}
            {agent.isDefault ? ` · Principal de ${rotuloDeAudiencia(agent.audience).toLowerCase()}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {extras.testar ? (
            <button onClick={() => setTestando(true)}
              className="inline-flex items-center gap-1.5 rounded-ctl border border-line-strong px-3 py-1.5 text-[12px] font-medium hover:bg-surface-hover">
              <Play size={13} />Testar
            </button>
          ) : null}
          {canWrite ? (
            <button onClick={() => acoes.alternarAtivo(agent)}
              className="inline-flex items-center gap-1.5 rounded-ctl border border-line-strong px-3 py-1.5 text-[12px] font-medium hover:bg-surface-hover">
              {agent.status === "active" ? "Pausar" : "Ativar"}
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <label className="flex flex-none items-center gap-2 border-b border-line px-4 py-2.5 text-[12px] text-sub md:hidden">
          <span>Seção</span>
          <select aria-label="Seção do agente" value={secao} onChange={(e) => setSecao(e.target.value)}
            className="flex-1 rounded-ctl border border-line-strong bg-bg px-2 py-1.5 text-[13px] text-fg">
            {SECOES_DO_AGENTE.map(([id, rotulo]) => <option key={id} value={id}>{rotulo}</option>)}
          </select>
        </label>

        <nav aria-label="Roteiro do agente" className="hidden w-[230px] flex-none flex-col border-r border-line py-3 md:flex">
          {SECOES_DO_AGENTE.map(([id, rotulo]) => {
            const item = itemDe(id);
            const ativo = secao === id;
            return (
              <button key={id} onClick={() => setSecao(id)} aria-current={ativo ? "step" : undefined}
                className={`grid grid-cols-[20px_1fr] items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface ${ativo ? "bg-surface-hover shadow-[inset_2px_0_0_var(--el-signal)]" : ""}`}>
                <span aria-hidden="true" className={`mt-0.5 flex h-[18px] w-[18px] items-center justify-center border ${
                  item?.pronto === true ? "border-ia bg-ia text-bg" : item?.pronto === false ? "border-warning text-warning" : "border-line-strong text-faint"
                }`}>
                  {item?.pronto === true ? <Check size={12} strokeWidth={2.5} /> : item?.pronto === false ? <span className="h-1 w-1 bg-warning" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">{rotulo}</span>
                  <span className={`block truncate text-[11.5px] ${item?.pronto === false ? "text-warning" : "text-sub"}`}>{resumoDaSecao(id)}</span>
                </span>
              </button>
            );
          })}
          <p className="mx-4 mt-auto border-t border-line pt-3 text-[11.5px] text-sub">
            {prontidao.prontos} de {prontidao.total} itens prontos
          </p>
        </nav>

        <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto">
          <div className="grid max-w-3xl gap-5 p-4 md:p-6">
            {erro && secao !== "personalidade" ? <p className="text-[12px] text-danger" role="alert">{erro}</p> : null}

            {secao === "personalidade" ? (
              <>
                <div>
                  <h3 className="text-[16px] font-semibold tracking-tight">Personalidade</h3>
                  <p className="mt-1 text-[12.5px] text-sub">
                    Explique como esse agente deve conversar, se comportar e representar sua empresa. O que vender e
                    como tratar objeção ficam em "Como vender".
                  </p>
                </div>
                <EscolhaDeAparencia aparencia={rascunho.aparencia} aoMudar={(a) => campo("aparencia", a)} desabilitado={!canWrite} />
                <Campo rotulo="Nome">
                  <input disabled={!canWrite} value={rascunho.name} onChange={(e) => campo("name", e.target.value)} className={entrada} />
                </Campo>
                <Campo rotulo="Função">
                  <input disabled={!canWrite} value={rascunho.role} onChange={(e) => campo("role", e.target.value)} className={entrada} />
                </Campo>
                <Campo rotulo="Como ele conversa" ajuda="Uma linha. As avaliações de conversa usam esta frase para dizer se o jeito foi seguido.">
                  <input disabled={!canWrite} value={rascunho.tone} onChange={(e) => campo("tone", e.target.value)} className={entrada} />
                </Campo>
                <Campo rotulo="Instruções" ajuda="Aceita Markdown. Vale para as conversas de verdade assim que você salvar.">
                  <textarea aria-label="Personalidade" disabled={!canWrite} value={rascunho.soulMarkdown}
                    onChange={(e) => campo("soulMarkdown", e.target.value)} rows={12}
                    className={`${entrada} leading-5`} />
                </Campo>
                <Campo rotulo="Com quem conversa" ajuda="Definido na criação e imutável depois: decide qual conhecimento o agente enxerga e quais habilidades podem ser ligadas.">
                  <input disabled readOnly value={rotuloDeAudiencia(agent.audience)} className={entrada} />
                </Campo>
                <details className="border border-line">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium text-sub [&::-webkit-details-marker]:hidden">
                    <ChevronDown size={14} />Configurações avançadas
                  </summary>
                  <div className="border-t border-line p-3">
                    <Campo rotulo="Identificador técnico" ajuda="Identidade interna e estável deste agente. Única por organização.">
                      <input disabled={!canWrite} value={rascunho.slug} onChange={(e) => campo("slug", e.target.value)} className={`${entrada} font-mono text-[12px]`} />
                    </Campo>
                  </div>
                </details>
              </>
            ) : null}

            {secao === "conhecimento" ? (extras.conhecimento ? extras.conhecimento(agent, ctx) : <Indisponivel />) : null}
            {secao === "vender" ? (extras.playbook ? extras.playbook(agent, ctx) : <Indisponivel />) : null}
            {secao === "desempenho" ? (extras.desempenho ? extras.desempenho(agent, ctx) : <Indisponivel />) : null}

            {secao === "habilidades" ? (
              <>
                <div>
                  <h3 className="text-[16px] font-semibold tracking-tight">Habilidades</h3>
                  <p className="mt-1 text-[12.5px] text-sub">O que {agent.name} pode fazer além de conversar. Ligar e desligar vale na hora.</p>
                </div>
                <section>
                  <p className={`${rotuloDeSecao} mb-2`}>Sabe fazer ({vinculadas.length})</p>
                  {vinculadas.length ? (
                    <div className="grid border border-line">
                      {vinculadas.map((skill, i) => (
                        <div key={skill.id} className={`flex items-center gap-3 p-3 ${i ? "border-t border-line" : ""}`}>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold">{skill.name}</p>
                            <p className="truncate text-[11.5px] text-sub">{descricaoDaSkill(skill)}</p>
                          </div>
                          {canWrite ? (
                            <button onClick={() => trocarSkill(skill.id, false)}
                              className="shrink-0 rounded-ctl border border-line-strong px-2.5 py-1 text-[11.5px] text-sub hover:border-danger hover:text-danger">
                              Remover
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-sub">Este agente ainda não sabe fazer nada. Ligue uma habilidade abaixo.</p>
                  )}
                </section>
                <section>
                  <p className={`${rotuloDeSecao} mb-2`}>Pode aprender ({disponiveis.length})</p>
                  {disponiveis.length ? (
                    <div className="grid border border-line">
                      {disponiveis.map((skill, i) => (
                        <div key={skill.id} className={`flex items-center gap-3 p-3 ${i ? "border-t border-line" : ""}`}>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold">{skill.name}</p>
                            <p className="truncate text-[11.5px] text-sub">{descricaoDaSkill(skill)}</p>
                          </div>
                          {canWrite ? (
                            <button onClick={() => trocarSkill(skill.id, true)}
                              className="shrink-0 rounded-ctl bg-ia-soft px-2.5 py-1 text-[11.5px] font-semibold text-ia hover:bg-ia hover:text-bg">
                              Adicionar
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-sub">Nenhuma outra habilidade publicada para este público.</p>
                  )}
                </section>
                <p className="text-[11.5px] leading-4 text-faint">A mesma habilidade pode ser usada por vários agentes. Remover aqui não afeta os outros.</p>
              </>
            ) : null}

            {secao === "onde" ? (
              <>
                <div>
                  <h3 className="text-[16px] font-semibold tracking-tight">Onde {agent.name} atende</h3>
                  <p className="mt-1 text-[12.5px] text-sub">Como as conversas chegam até ele.</p>
                </div>
                <div className="grid border border-line">
                  <div className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold">Principal de {rotuloDeAudiencia(agent.audience).toLowerCase()}</p>
                      <p className="text-[12px] text-sub">Recebe quem chega sem campanha e sem conversa em andamento com outro agente.</p>
                    </div>
                    {agent.isDefault ? (
                      <span className="rounded-ctl bg-signal-soft px-2 py-0.5 text-[11.5px] font-semibold text-signal">É o principal</span>
                    ) : canWrite ? (
                      <button onClick={() => acoes.tornarPadrao(agent)}
                        className="rounded-ctl border border-line-strong px-3 py-1.5 text-[12px] font-medium hover:bg-surface-hover">
                        Tornar principal
                      </button>
                    ) : null}
                  </div>
                  <div className="border-t border-line p-4">
                    <p className="text-[13px] font-semibold">Pelas campanhas</p>
                    {onde.campanhas.length ? (
                      <ul className="mt-1.5 grid gap-1 text-[12.5px] text-fg">
                        {onde.campanhas.map((nome) => <li key={nome} className="flex items-center gap-2"><ChevronRight size={13} className="text-faint" />{nome}</li>)}
                      </ul>
                    ) : (
                      <p className="mt-1 text-[12px] text-sub">Nenhuma campanha no ar aponta para {agent.name}. Escolha o agente dentro da campanha, em Campanhas.</p>
                    )}
                  </div>
                </div>
                {agent.status === "inactive" ? (
                  <p className="bg-warning-soft p-3 text-[12px] text-warning">Pausado: não responde ninguém, nem como principal nem pelas campanhas, até ser ativado.</p>
                ) : null}
                {(extras.quemAtende && extras.quemAtende(agent, ctx)) || null}
              </>
            ) : null}
          </div>
        </div>
      </div>

      {canWrite && secao === "personalidade" && (sujo || salvo || erro) ? (
        <footer className={`flex flex-none flex-wrap items-center gap-2 border-t border-line px-4 py-3 md:px-6 ${sujo ? "bg-warning-soft" : ""}`}>
          {erro ? <p className="text-[12px] text-danger" role="alert">{erro}</p> : null}
          {sujo ? <p className="flex-1 text-[12.5px] font-semibold text-warning">Alterações não salvas</p> : null}
          {!sujo && salvo ? <p className="flex-1 text-[12.5px] text-success">Salvo.</p> : null}
          {sujo ? (
            <>
              <button onClick={() => { setRascunho(original); setErro(""); }} disabled={salvando}
                className="rounded-ctl border border-line-strong bg-bg px-3 py-2 text-[12.5px] font-medium disabled:opacity-40">
                Descartar
              </button>
              <button onClick={salvar} disabled={salvando}
                className="inline-flex items-center gap-2 rounded-ctl bg-accent px-4 py-2 text-[12.5px] font-semibold text-on-accent disabled:opacity-40">
                <Check size={14} />{salvando ? "Salvando…" : "Salvar"}
              </button>
            </>
          ) : null}
        </footer>
      ) : null}

      {testando && extras.testar ? (
        <aside role="dialog" aria-label={`Testar ${agent.name}`}
          className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[460px] flex-col border-l border-line-strong bg-bg">
          <div className="flex flex-none items-center gap-3 border-b border-line px-4 py-3">
            <MarcaDoAgente agent={agent} tamanho={28} />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold">Testar {agent.name}</p>
              <p className="text-[11.5px] text-faint">Responde com o que está salvo. Nada vai para clientes.</p>
            </div>
            <button onClick={() => setTestando(false)} aria-label="Fechar teste" className="rounded-ctl p-1.5 text-sub hover:bg-surface-hover"><X size={17} /></button>
          </div>
          <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto p-4">{extras.testar(agent, ctx)}</div>
        </aside>
      ) : null}
    </div>
  );
}

function Indisponivel() {
  return <p className="text-[12.5px] text-sub">Disponível no portal, com a empresa conectada.</p>;
}

/* ========================================================================== *
 * RAIZ — a lista, ou a página do agente, com a criação por cima.
 * ========================================================================== */

export default function Agents({
  agents, catalogoSkills, bindings = [], aoAtualizarSkills, canWrite, recarregar, carregando, erro, extras,
  campanhas = [], conhecimentoPorPublico = {}, playbookPublicado = null,
}) {
  const [selecionadoId, setSelecionadoId] = useState(null);
  const [criando, setCriando] = useState(false);
  const [pedido, setPedido] = useState(null);
  const [falha, setFalha] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");

  const ativos = (agents ?? []).filter((agent) => agent.status === "active").length;
  const grupos = useMemo(() => agruparPorAudiencia((agents ?? [])
    .filter((agent) => filtroStatus === "todos" || agent.status === filtroStatus)
    .slice().sort((a, b) => Number(b.status === "active") - Number(a.status === "active"))), [agents, filtroStatus]);
  const selecionado = useMemo(
    () => (agents ?? []).find((agent) => agent.id === selecionadoId) ?? null,
    [agents, selecionadoId],
  );

  const conhecimentoDe = (agent) => conhecimentoPorPublico[agent.audience] ?? null;
  const habilidadesDe = (agent) => separarSkills(catalogoSkills, bindings.filter((b) => b.profile_id === agent.id), agent.audience).vinculadas.length;

  const acoes = {
    listarSkills: (agentId) => api.agents.listarSkills({ agentId }),
    definirSkill: async (agentId, skillId, enabled) => {
      const resultado = await api.agents.definirSkill({ agentId, skillId, enabled });
      await aoAtualizarSkills?.();
      return resultado;
    },
    editar: async (agentId, patch) => { await api.agents.editar({ agentId, ...patch }); await recarregar(); },

    alternarAtivo: (agent) => {
      const aplicar = async () => {
        setFalha("");
        try {
          await api.agents.definirAtivo({ agentId: agent.id, active: agent.status !== "active" });
          await recarregar();
        } catch (e) { setFalha(mensagemDeErro(e)); }
      };
      // Pausar o principal é permitido, e nada é promovido no lugar — mas
      // quem pausa precisa saber que aquele público para de ser atendido.
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
    setFalha("");
    const criado = await api.agents.criar(campos);
    if (skillIds?.length) {
      // O cadastro já existe: não reabrir criação nem esconder falha parcial.
      const resultados = await Promise.allSettled(
        skillIds.map((skillId) => api.agents.definirSkill({ agentId: criado.id, skillId, enabled: true })),
      );
      const falhas = resultados.filter((resultado) => resultado.status === "rejected");
      if (falhas.length) {
        setFalha(`O agente foi criado, mas ${falhas.length} habilidade(s) não foram vinculadas. Tente adicioná-las em Habilidades. ${mensagemDeErro(falhas[0].reason)}`);
      }
    }
    await recarregar();
    setCriando(false);
    if (criado?.id) setSelecionadoId(criado.id);
  };

  if (carregando) {
    return <div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando agentes…</div>;
  }
  if (erro) {
    return <div className="flex flex-1 items-center justify-center p-8 text-center text-[13px] text-danger" role="alert">{erro}</div>;
  }

  const lista = (
    <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="flex flex-wrap items-end gap-3 px-4 pb-3 pt-5 md:px-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold tracking-tight">Sua equipe de IA</h2>
          <p className="mt-0.5 text-[12.5px] text-sub">Cada agente conversa com um público e faz um trabalho definido.</p>
        </div>
        {canWrite ? (
          <button onClick={() => setCriando(true)} aria-label="Criar agente"
            className="inline-flex items-center gap-1.5 rounded-ctl bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-on-accent hover:opacity-90">
            <Plus size={16} />Novo agente
          </button>
        ) : null}
      </div>

      {falha ? <p className="mx-4 mb-3 bg-danger-soft p-2.5 text-[12px] text-danger md:mx-6" role="alert">{falha}</p> : null}

      <div className="flex gap-4 border-b border-line px-4 text-[12.5px] md:px-6" role="group" aria-label="Filtrar agentes">
        {[["todos", "Todos", (agents ?? []).length], ["active", "Ativos", ativos], ["inactive", "Pausados", (agents ?? []).length - ativos]].map(([status, rotulo, total]) => (
          <button type="button" key={status} aria-pressed={filtroStatus === status} onClick={() => setFiltroStatus(status)}
            className={`-mb-px border-b-2 pb-2 pt-1 ${filtroStatus === status ? "border-signal font-semibold text-fg" : "border-transparent text-sub hover:text-fg"}`}>
            {rotulo} <span className="tabular-nums text-faint">{total}</span>
          </button>
        ))}
      </div>

      {grupos.length ? (
        <div className="agents-lista">
          <div className="hidden grid-cols-[minmax(220px,1.4fr)_110px_minmax(180px,1.2fr)_160px_20px] gap-4 border-b border-line px-6 py-2 text-[11px] font-medium uppercase tracking-[.06em] text-faint lg:grid">
            <span>Agente</span><span>Conversa com</span><span>Onde atende</span><span>Pronto</span><span />
          </div>
          {grupos.flatMap((grupo) => grupo.agents.map((agent) => {
            const onde = ondeAtende(agent, campanhas);
            const prontidao = prontidaoDoAgent({ agent, habilidades: habilidadesDe(agent), temConhecimento: conhecimentoDe(agent), playbookPublicado, onde });
            return (
              <button key={agent.id} type="button" onClick={() => setSelecionadoId(agent.id)}
                className="agent-linha grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line px-4 py-3.5 text-left transition-colors hover:bg-surface md:px-6 lg:grid-cols-[minmax(220px,1.4fr)_110px_minmax(180px,1.2fr)_160px_20px]">
                <span className="flex min-w-0 items-center gap-3">
                  <MarcaDoAgente agent={agent} tamanho={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold">{agent.name}</span>
                    <span className="block truncate text-[12px] text-sub">{agent.role || rotuloDeAudiencia(agent.audience)}</span>
                  </span>
                </span>
                <span className="hidden lg:block"><span className="rounded-ctl border border-line-strong px-1.5 py-px text-[11.5px] text-sub">{rotuloDeAudiencia(agent.audience)}</span></span>
                <span className="hidden min-w-0 text-[12.5px] lg:block"><TextoOnde onde={onde} audience={agent.audience} /></span>
                <span className="hidden lg:block"><Prontidao prontidao={prontidao} /></span>
                <ChevronRight size={16} className="text-faint" />
              </button>
            );
          }))}
        </div>
      ) : (
        <p className="p-8 text-center text-[12.5px] text-sub">Nenhum agente configurado.</p>
      )}

      <p className="px-4 py-4 text-[12px] text-sub md:px-6">
        "Principal" é quem recebe primeiro, por público. Os outros atendem pelas campanhas que apontam para eles.
      </p>
    </div>
  );

  return (
    <>
      {selecionado ? (
        <DetalheAgent
          agent={selecionado} catalogoSkills={catalogoSkills} canWrite={canWrite}
          aoVoltar={() => setSelecionadoId(null)} acoes={acoes}
          extras={extras ? { ...extras, fechar: () => setSelecionadoId(null) } : undefined}
          campanhas={campanhas} temConhecimento={conhecimentoDe(selecionado)} playbookPublicado={playbookPublicado}
        />
      ) : lista}
      {selecionado && falha ? <p role="alert" className="border-t border-line bg-danger-soft p-3 text-[12px] text-danger">{falha}</p> : null}

      {criando ? (
        <AssistenteDeCriacao catalogoSkills={catalogoSkills} aoFechar={() => setCriando(false)} aoCriar={criarAgente} />
      ) : null}

      <DialogoConfirmar pedido={pedido} aoFechar={() => setPedido(null)} />
    </>
  );
}
