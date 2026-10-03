import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Cable, CalendarDays, ChartColumn, ChevronDown, CircleUser, Filter, LogOut, Megaphone, MessageSquare, Settings, SquareCheckBig, Users, UsersRound, Workflow } from "lucide-react";
import { api } from "../data/client";
import { TIPOS_GATILHO, gatilhoDo } from "../domain/chatbots";
import { PAPEIS } from "../ui/papeis";
import { NOMES_DOS_PLANOS_COM_IA, planoLibera } from "./plano";
import { corDaPessoa, nomeCurto } from "../ui/perfil";
import { paraSlug } from "../lib/texto";
import Contatos from "./telas/Contatos";
import FichaContato from "./telas/FichaContato";
import Funil from "./telas/Funil";
import Tarefas from "./telas/Tarefas";
import { CampoFormulario, ENTRADA_GESTAO, ModalGestao } from "./telas/gestaoCompartilhados";
import { BotaoPrimario, CabecalhoTela, DicaDoTrilho, GRUPO_DA_ORGANIZACAO, Iniciais, Rail } from "./ui";
import { idsDosResponsaveis } from "./telas/tarefas/tarefasUtils";

const Agenda = lazy(() => import("./telas/Agenda"));
const Conversas = lazy(() => import("./telas/Conversas"));
const Relatorios = lazy(() => import("./telas/Relatorios"));
const Campanhas = lazy(() => import("./telas/Campanhas"));
const Inteligencia = lazy(() => import("./telas/Inteligencia"));
const Chatbots = lazy(() => import("./telas/Chatbots"));
const ChatbotEditor = lazy(() => import("./telas/ChatbotEditor"));
const Conexoes = lazy(() => import("./telas/Conexoes"));
const Equipe = lazy(() => import("./telas/Equipe"));
const Configuracoes = lazy(() => import("./telas/Configuracoes"));
const MinhaConta = lazy(() => import("./telas/MinhaConta"));

const PLATAFORMA_WEB = typeof __EMYLEADS_PLATFORM__ !== "undefined" && __EMYLEADS_PLATFORM__ === "web";


/**
 * `grupo` é o rótulo que o menu desenha acima do bloco, não uma chave.
 *
 * Onze destinos numa lista chapada é uma lista que ninguém varre: lê-se do
 * começo toda vez. Quatro blocos de dois a quatro itens cada um cabem de
 * relance. O rótulo vai no dado porque é aqui que a ORDEM vive — separar os
 * dois criaria duas listas para manter em sincronia.
 */
const TELAS = [
  ...(PLATAFORMA_WEB
    ? [
        // O Assistente saiu do painel em 08/09/2026: a tela existia e não
        // funcionava, e um destino que não entrega nada gasta a atenção de quem
        // varre o menu toda manhã. O arquivo continua em `telas/Assistente.jsx`
        // — o que se removeu foi a porta, não o cômodo.
        //
        // Só no portal. Dentro da extensão a conversa já está na tela — é o
        // WhatsApp com o painel do EmyLeads do lado. Uma caixa de entrada
        // dentro dela seria a mesma conversa duas vezes.
        { id: "conversas", rotulo: "Conversas", icone: MessageSquare, grupo: "Atendimento", atalho: "C" },
      ]
    : []),
  { id: "contatos", rotulo: "Leads", icone: Users, grupo: "Gestão", atalho: "L" },
  // Só no portal: lê as campanhas e os leads delas no banco. Liberada pelo
  // CRM, e não pela Inteligência, para o plano Base ver as campanhas dele.
  ...(PLATAFORMA_WEB ? [{ id: "campanhas", rotulo: "Campanhas", icone: Megaphone, grupo: "Gestão", atalho: "P" }] : []),
  { id: "funil", rotulo: "Funil", icone: Filter, grupo: "Gestão", atalho: "F" },
  // Só no portal: conta pela marca de lead e pelo histórico de etapas, que
  // moram no banco; a extensão guarda os dados no navegador e não tem nenhum dos dois.
  ...(PLATAFORMA_WEB ? [{ id: "relatorios", rotulo: "Relatórios", icone: ChartColumn, grupo: "Gestão", atalho: "R" }] : []),
  { id: "tarefas", rotulo: "Tarefas", icone: SquareCheckBig, grupo: "Gestão", atalho: "T" },
  { id: "agenda", rotulo: "Agenda", icone: CalendarDays, grupo: "Gestão", atalho: "A" },
  ...(PLATAFORMA_WEB ? [{ id: "conhecimento", rotulo: "Equipe de IA", icone: Bot, grupo: "Automação", atalho: "I", tom: "ia" }] : []),
  // "Fluxos" e não "Chatbots": a tela é o construtor de fluxos, e o nome
  // casa com a cor do ator Fluxo, a mesma da bolha e da lista de conversas.
  { id: "chatbots", rotulo: "Fluxos", icone: Workflow, grupo: "Automação", atalho: "X", tom: "flow" },
  { id: "conexoes", rotulo: "Conexões", icone: Cable, grupo: "Ambiente" },
  { id: "equipe", rotulo: "Equipe", icone: UsersRound, grupo: "Ambiente" },
  { id: "config", rotulo: "Configurações", icone: Settings, grupo: "Ambiente" },
];

/**
 * Toda tela do menu depende de uma chave do plano, combinado com os ajustes
 * que a Major fez para a empresa. Tela desligada sai do menu e, se alguém
 * chegar pela rota direta, encontra o aviso em vez de uma tela que não faz
 * nada. A regra de cada recurso (e o que acontece sem o estado da assinatura)
 * mora em `./plano`. Configurações e Minha conta não têm chave: são a porta
 * para sair de qualquer situação, e nunca somem.
 */
const RECURSO_DA_TELA = {
  conversas: "whatsapp_web",
  conexoes: "whatsapp_web",
  contatos: "crm",
  campanhas: "crm",
  funil: "crm",
  relatorios: "crm",
  tarefas: "crm",
  agenda: "agenda",
  equipe: "team_management",
  conhecimento: "inteligencia",
  chatbots: "chatbots",
};

export function telaLiberada(id, recursos) {
  const recurso = RECURSO_DA_TELA[id];
  return !recurso || planoLibera(recursos, recurso);
}

const TELA_PADRAO = PLATAFORMA_WEB ? "conversas" : "contatos";

/**
 * A entrada do portal é Conversas: é para lá que `/app` leva quem não escolheu
 * nada. Se Conversas estiver desligada para a empresa, abrir no aviso seria
 * receber o cliente com uma porta fechada — então a entrada vira a primeira
 * tela liberada do menu. Uma rota escolhida de propósito (outra tela
 * desligada) continua mostrando o aviso, que explica o que aconteceu.
 */
export function telaDeEntrada(tela, recursos) {
  if (tela !== TELA_PADRAO || telaLiberada(tela, recursos)) return tela;
  return TELAS.find((item) => telaLiberada(item.id, recursos))?.id || "config";
}

function DisponivelNoPlano({ tela, recursos }) {
  // Inteligência, para quem não tem IA nenhuma, continua com o convite para
  // mudar de plano. Chatbots não: desde 23/09/2026 o construtor de fluxos faz
  // parte de todos os planos, inclusive o Base, e chatbot desligado é decisão
  // da Major para aquela empresa. Qualquer outra trava idem, e o texto não
  // pode prometer que trocar de plano resolve.
  const semIA = tela === "conhecimento" && !planoLibera(recursos, "inteligencia");
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-[420px] rounded-none border border-line bg-bg px-6 py-6 text-center">
        {semIA ? (
          <>
            <h2 className="text-[16px] font-semibold text-fg">Disponível nos planos com IA</h2>
            <p className="mt-2 text-[13px] leading-5 text-sub">
              O seu plano inclui WhatsApp no portal, contatos, funil, tarefas, agenda e equipe.
              Agentes de IA fazem parte dos planos {NOMES_DOS_PLANOS_COM_IA} — fale com a equipe do
              Núcleo Major para mudar de plano.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-[16px] font-semibold text-fg">Função não liberada</h2>
            <p className="mt-2 text-[13px] leading-5 text-sub">
              Esta função não está liberada para a sua empresa. Fale com a Major.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function AvisoAssinatura({ acesso }) {
  if (acesso?.estado !== "past_due") return null;
  const quando = acesso.bloqueiaEm
    ? new Date(acesso.bloqueiaEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : null;
  return (
    <div role="status" className="mx-6 mt-4 rounded-ctl border border-warning/30 bg-warning/10 px-4 py-3 text-[12.5px] text-fg">
      Pagamento em atraso.{quando ? ` O acesso será suspenso em ${quando}` : " O acesso será suspenso em breve"} se a cobrança não for
      paga — o link está no e-mail enviado pelo Asaas.
    </div>
  );
}

const VAZIO = {
  nome: "",
  telefone: "",
  empresa: "",
  cargo: "",
  email: "",
  origem: "",
  responsavel: "",
};

/* ------------------------------------------------------------------ */

function ModalContato({ contato, aoFechar, aoSalvar }) {
  const [form, setForm] = useState(() => ({ ...VAZIO, ...(contato || {}) }));
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const campos = [
    { chave: "nome", rotulo: "Nome", obrigatorio: true },
    { chave: "telefone", rotulo: "Telefone" },
    { chave: "empresa", rotulo: "Empresa" },
    { chave: "cargo", rotulo: "Cargo" },
    { chave: "email", rotulo: "E-mail" },
    { chave: "origem", rotulo: "Origem" },
    { chave: "responsavel", rotulo: "Responsável" },
  ];

  const enviar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      if (contato?.id) {
        const patch = Object.fromEntries(campos.map((c) => [c.chave, form[c.chave] || ""]));
        await api.contatos.atualizar({ id: contato.id, patch });
      } else {
        await api.contatos.criar(form);
      }
      await aoSalvar();
      aoFechar();
    } catch (err) {
      setErro(err?.message || String(err));
      setSalvando(false);
    }
  };

  const remover = async () => {
    if (!confirm("Excluir este lead? Negócios, tarefas e notas vão junto.")) return;
    await api.contatos.remover({ id: contato.id });
    await aoSalvar();
    aoFechar();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-md overflow-hidden rounded-none border border-line bg-bg ">
        <form onSubmit={enviar}>
          <div className="border-b border-line px-5 py-4 text-[16px] font-semibold text-fg">
            {contato?.id ? "Editar lead" : "Criar lead"}
          </div>

          <div className="grid grid-cols-2 gap-3 px-5 py-4">
            {campos.map((c) => (
              <label key={c.chave} className={c.chave === "nome" ? "col-span-2" : ""}>
                <span className="mb-1 block text-[12px] font-medium text-sub">
                  {c.rotulo}
                </span>
                <input
                  required={c.obrigatorio}
                  value={form[c.chave] || ""}
                  onChange={(e) => setForm({ ...form, [c.chave]: e.target.value })}
                  className="w-full rounded-ctl border border-line bg-bg px-3 py-2 text-[13.5px] text-fg outline-none transition-colors focus:border-accent"
                />
              </label>
            ))}
            {erro && <p className="col-span-2 text-[13px] text-danger">{erro}</p>}
          </div>

          <div className="flex items-center gap-2 border-t border-line px-5 py-3">
            {contato?.id && (
              <button
                type="button"
                onClick={remover}
                className="cursor-pointer text-[13.5px] font-medium text-danger hover:underline"
              >
                Excluir
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={aoFechar}
                className="cursor-pointer rounded-ctl px-3 py-2 text-[13.5px] font-medium text-sub transition-colors hover:text-fg"
              >
                Cancelar
              </button>
              <BotaoPrimario type="submit" disabled={salvando} className="!py-2">
                {salvando ? "Salvando…" : "Salvar"}
              </BotaoPrimario>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalNota({ contato, aoFechar, aoSalvar }) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const enviar = async (evento) => {
    evento.preventDefault();
    const conteudo = texto.trim();
    if (!conteudo) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.notas.criar({ contactId: contato.id, texto: conteudo });
      await aoSalvar();
      aoFechar();
    } catch (err) {
      setErro(err?.message || String(err));
      setSalvando(false);
    }
  };

  return (
    <ModalGestao titulo={`Nova nota · ${contato.nome || "Lead"}`} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        <div className="px-5 py-4">
          <CampoFormulario rotulo="Anotação">
            <textarea
              autoFocus
              rows={5}
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              placeholder="Registre informações úteis para o próximo atendimento."
              className={`${ENTRADA_GESTAO} resize-y`}
            />
          </CampoFormulario>
          {erro && <p className="mt-2 text-[12px] text-danger">{erro}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={aoFechar} className="rounded-ctl px-3 py-2 text-[13px] font-medium text-sub hover:text-fg">
            Cancelar
          </button>
          <BotaoPrimario type="submit" disabled={salvando || !texto.trim()} className="!py-2">
            {salvando ? "Salvando…" : "Salvar nota"}
          </BotaoPrimario>
        </div>
      </form>
    </ModalGestao>
  );
}

/* ------------------------------------------------------------------ */

function EmConstrucao({ titulo }) {
  return (
    <>
      <CabecalhoTela titulo={titulo} busca={<span />} acao={<span />} />
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[14px] text-sub">Em construção.</p>
      </div>
    </>
  );
}

function AvisoMigracao({ migracao }) {
  if (!migracao) return null;
  return (
    <div className="mx-6 mt-4 flex flex-wrap items-center gap-3 rounded-ctl border border-accent/25 bg-accent-soft px-4 py-3 text-[12.5px] text-sub">
      <span className="min-w-0 flex-1">
        Há dados antigos neste navegador aguardando migração para esta organização.
      </span>
      <button
        type="button"
        onClick={migracao.aoReabrir}
        className="cursor-pointer rounded-ctl px-3 py-1.5 font-semibold text-accent-forte hover:bg-bg"
      >
        Revisar migração
      </button>
    </div>
  );
}

/**
 * O rodapé é o único lugar do app onde pessoa e empresa aparecem juntas — e
 * por isso é a porta da conta.
 *
 * O botão mostrava a empresa e o e-mail, mas o menu só oferecia empresas: a
 * pessoa aparecia sem ser clicável, e não havia para onde ir. Agora o menu
 * segue a mesma separação do modelo de dados: quem você é em cima, em que
 * empresa você está embaixo.
 */
function RodapeWorkspace({ sessao, aoTrocar, aoAbrirConta, compacto = false, telasDaOrganizacao = [], ativa = null, aoAbrirTela = null }) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState("");
  const caixa = useRef(null);

  // Clique fora ou Esc fecham o menu. Sem isso ele ficava aberto por cima da
  // tela até alguém clicar de novo no mesmo botão.
  useEffect(() => {
    if (!aberto) return undefined;
    const aoClicar = (e) => { if (!caixa.current?.contains(e.target)) setAberto(false); };
    const aoTeclar = (e) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", aoClicar);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicar);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  const sair = async () => {
    try {
      await api.auth.sair();
      window.location.reload();
    } catch (e) {
      setErro(e?.message || "Não foi possível sair.");
    }
  };

  const trocar = async (id) => {
    if (id === sessao?.organizacaoAtual?.id) return setAberto(false);
    try {
      const proximo = await api.organizacoes.selecionar({ id });
      setAberto(false);
      await aoTrocar(proximo);
    } catch (e) {
      setErro(e?.message || "Não foi possível trocar de empresa.");
    }
  };

  if (!sessao?.organizacaoAtual) return null;

  const perfil = sessao.usuario?.perfil;
  const apelido = nomeCurto(perfil, sessao.usuario?.email || "Conta");
  const cor = corDaPessoa(perfil);
  const papel = PAPEIS[sessao.organizacaoAtual.papel] || "";
  const empresa = sessao.organizacaoAtual.name || "Empresa";
  const iniciaisDaEmpresa = empresa
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase() || "NM";
  const organizacoes = sessao.organizacoes || [];

  const item = "flex w-full cursor-pointer items-center gap-2.5 rounded-ctl px-2.5 py-2 text-left text-[12.5px] text-sub hover:bg-surface-hover hover:text-fg";

  const menu = (
    <div
      role="menu"
      className={`absolute z-40 overflow-hidden rounded-none border border-line-strong bg-bg p-1 ${
        compacto ? "bottom-0 left-[calc(100%+10px)] w-[264px]" : "bottom-[calc(100%+8px)] left-0 right-0"
      }`}
    >
      {compacto && (
        <>
          <div className="-m-1 mb-1 border-b border-line px-3.5 py-3">
            <span className="block truncate text-[13px] font-semibold text-fg">{empresa}</span>
            {papel && <span className="block truncate text-[11.5px] text-faint">Você é {papel.toLowerCase()}</span>}
          </div>
          {telasDaOrganizacao.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitem"
              aria-current={t.id === ativa ? "page" : undefined}
              onClick={() => {
                setAberto(false);
                aoAbrirTela?.(t.id);
              }}
              className={`${item} ${t.id === ativa ? "bg-surface-hover font-medium text-fg shadow-[inset_2px_0_0_var(--el-signal)]" : ""}`}
            >
              <t.icone size={15} strokeWidth={1.75} aria-hidden="true" /> {t.rotulo}
            </button>
          ))}
          {telasDaOrganizacao.length > 0 && <div className="my-1 border-t border-line" />}
        </>
      )}
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <Iniciais nome={perfil?.full_name || apelido} tamanho={28} cor={cor} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-fg">{apelido}</span>
          <span className="block truncate text-[11px] text-sub">{sessao.usuario?.email || "Conta conectada"}</span>
        </span>
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setAberto(false);
          aoAbrirConta?.();
        }}
        className={item}
      >
        <CircleUser size={15} strokeWidth={1.75} aria-hidden="true" /> Minha conta
      </button>

      {organizacoes.length > 1 && (
        <>
          <div className="my-1 border-t border-line" />
          <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
            Trocar de empresa
          </p>
          {organizacoes.map((org) => (
            <button key={org.id} type="button" role="menuitem" onClick={() => trocar(org.id)} className={item}>
              <span className="min-w-0 flex-1 truncate">{org.name}</span>
              {org.id === sessao.organizacaoAtual.id && <span className="text-[11px] font-medium text-signal">Atual</span>}
            </button>
          ))}
        </>
      )}
      <div className="my-1 border-t border-line" />
      <button type="button" role="menuitem" onClick={sair} className="flex w-full cursor-pointer items-center gap-2.5 rounded-ctl px-2.5 py-2 text-left text-[12.5px] text-danger hover:bg-danger-soft">
        <LogOut size={14} aria-hidden="true" /> Sair
      </button>
      {erro && <p className="px-2.5 pb-1 text-[11px] text-danger">{erro}</p>}
    </div>
  );

  if (compacto) {
    const naOrganizacao = telasDaOrganizacao.some((t) => t.id === ativa);
    return (
      <div ref={caixa} className="relative">
        <button
          type="button"
          onClick={() => setAberto(!aberto)}
          aria-haspopup="menu"
          aria-expanded={aberto}
          aria-label={`${empresa}: conexões, equipe, configurações e conta`}
          className={`group relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-ctl border text-[11.5px] font-semibold tracking-tight transition-colors ${
            aberto || naOrganizacao ? "border-fg bg-bg text-fg" : "border-line-strong bg-bg text-sub hover:border-faint hover:text-fg"
          }`}
        >
          {iniciaisDaEmpresa}
          {!aberto && <DicaDoTrilho rotulo={empresa} estado="ajustes e conta" />}
        </button>
        {aberto && menu}
      </div>
    );
  }

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-none border border-line px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
      >
        <Iniciais nome={perfil?.full_name || apelido} tamanho={30} cor={cor} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-fg">{apelido}</span>
          <span className="block truncate text-[11.5px] text-sub">
            {empresa}
            {papel && ` · ${papel}`}
          </span>
        </span>
        <ChevronDown size={15} className={`flex-none text-sub transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && menu}
    </div>
  );
}

export default function Gestao({ sessao = null, atualizarSessao = null, migracaoPendente = null, telaInicial = null, aoTrocarTela = null }) {
  const recursos = sessao?.acesso?.recursos || null;
  const telasDoPlano = useMemo(() => TELAS.filter((item) => telaLiberada(item.id, recursos)), [recursos]);
  const [telaEscolhida, setTela] = useState(telaInicial || TELA_PADRAO);
  const tela = telaDeEntrada(telaEscolhida, recursos);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [editando, setEditando] = useState(undefined); // undefined = fechado
  const [ficha, setFicha] = useState(null);
  // O telefone cuja conversa a tela de Conversas deve abrir ao montar: é
  // assim que "Abrir conversa" na lista de Leads e na ficha leva ao chat.
  const [telefoneParaAbrir, setTelefoneParaAbrir] = useState(null);
  const [notaContato, setNotaContato] = useState(null);
  const [comando, setComando] = useState(null);
  const [chatbotEditando, setChatbotEditando] = useState(undefined); // undefined = lista fechada, null = novo

  const carregar = useCallback(async () => {
    try {
      // O cache local abre a tela imediatamente; quando houver rede, o pull
      // atualiza o cache antes da primeira listagem. Falha de rede não impede
      // o modo offline.
      await api.sync.executar().catch((e) => {
        console.warn("[EmyLeads] sincronização inicial indisponível:", e?.message || e);
      });
      const [contatos, negocios, tarefas, notas, estagios, tags, eventos, chatbots] = await Promise.all([
        api.contatos.listar(),
        api.negocios.listar(),
        api.tarefas.listar(),
        api.notas.listar(),
        api.estagios.listar(),
        api.tags.listar(),
        api.eventos.listar(),
        api.chatbots.listar(),
      ]);
      setDados({ contatos, negocios, tarefas, notas, estagios, tags, eventos, chatbots });
      setErro(null);
    } catch (e) {
      setErro(e?.message || String(e));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (telaInicial && telaInicial !== telaEscolhida) setTela(telaInicial);
  }, [telaInicial]);

  const trocarTela = useCallback((proxima) => {
    setTela(proxima);
    aoTrocarTela?.(proxima);
  }, [aoTrocarTela]);


  useEffect(() => {
    const sincronizar = () => {
      api.sync.executar().then(carregar).catch(() => {});
    };
    const aoFicarVisivel = () => {
      if (document.visibilityState === "visible") sincronizar();
    };
    window.addEventListener("online", sincronizar);
    document.addEventListener("visibilitychange", aoFicarVisivel);
    return () => {
      window.removeEventListener("online", sincronizar);
      document.removeEventListener("visibilitychange", aoFicarVisivel);
    };
  }, [carregar]);

  // ⌘K / Ctrl+K foca a busca — o atalho está desenhado no campo, então tem
  // que funcionar de verdade.
  //
  // "G" e depois a letra do destino (G C, G F...) troca de tela: é o atalho
  // que a dica do trilho mostra. Só vale fora de campo de texto, e a segunda
  // tecla tem 1,2s para chegar; depois disso o "G" é esquecido.
  useEffect(() => {
    let esperandoDestino = 0;
    const digitando = (alvo) =>
      alvo instanceof HTMLElement && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName));
    const aoTeclar = (e) => {
      const tecla = (e.key || "").toLowerCase();
      if (e.metaKey || e.ctrlKey) {
        if (tecla === "k") {
          e.preventDefault();
          buscarNaTela();
        }
        return;
      }
      if (e.altKey || digitando(e.target)) return;
      if (esperandoDestino && Date.now() - esperandoDestino < 1200) {
        esperandoDestino = 0;
        const destino = telasDoPlano.find((t) => t.atalho && t.atalho.toLowerCase() === tecla);
        if (destino) {
          e.preventDefault();
          trocarTela(destino.id);
        }
        return;
      }
      esperandoDestino = tecla === "g" ? Date.now() : 0;
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [telasDoPlano, trocarTela]);

  const buscarNaTela = () => document.querySelector('input[placeholder^="Buscar"]')?.focus();

  const trocarOrganizacao = async (proximo) => {
    setDados(null);
    // Descarrega a credencial local do workspace que está saindo antes de
    // qualquer consulta do novo. Uma credencial que sobrevive à troca é acesso
    // que o usuário acha que encerrou.
    const anterior = sessao?.organizacaoAtual?.id;
    if (anterior && anterior !== proximo) {
      await api.gateway.descarregar({ organizationId: anterior }).catch(() => {});
    }
    if (atualizarSessao) await atualizarSessao(proximo);
    await carregar();
  };

  // Contagens do trilho: só o que é DA PESSOA e está esperando. Tarefas abertas
  // que são suas e vencem hoje ou já venceram. Conversas e o estado do
  // WhatsApp não chegam até aqui (cada tela carrega os seus), e o trilho não
  // desenha número que não sabe.
  const contagens = (() => {
    const meuId = sessao?.usuario?.id;
    if (!dados || !meuId) return {};
    const fimDeHoje = new Date();
    fimDeHoje.setHours(23, 59, 59, 999);
    const vencendo = dados.tarefas.filter(
      (t) => !t.concluida && t.venceEm != null && t.venceEm <= fimDeHoje.getTime() && idsDosResponsaveis(t).includes(meuId),
    ).length;
    return vencendo ? { tarefas: { numero: vencendo, texto: vencendo === 1 ? "1 sua para hoje" : `${vencendo} suas para hoje` } } : {};
  })();

  const abrirFicha = (contato) => {
    if (contato) setFicha(contato);
  };

  const abrirConversaDoContato = (contato) => {
    if (!contato?.telefone) return;
    setFicha(null);
    setTelefoneParaAbrir(contato.telefone);
    trocarTela("conversas");
  };

  const fichaAtualizada = ficha && dados
    ? { ...ficha, ...dados.contatos.find((item) => item.id === ficha.id) }
    : ficha;

  const editarFicha = () => {
    if (!ficha) return;
    setEditando(ficha);
    setFicha(null);
  };

  const criarNegocio = () => {
    if (!ficha) return;
    trocarTela("funil");
    setFicha(null);
    setComando({ id: Date.now(), tipo: "novo-negocio", contatoId: ficha.id });
  };

  const criarTarefa = () => {
    if (!ficha) return;
    trocarTela("tarefas");
    setFicha(null);
    setComando({ id: Date.now(), tipo: "nova-tarefa", contatoId: ficha.id });
  };

  const abrirNegocio = (negocio) => {
    trocarTela("funil");
    setFicha(null);
    setComando({ id: Date.now(), tipo: "editar-negocio", item: negocio });
  };

  const abrirTarefa = (tarefa) => {
    trocarTela("tarefas");
    setFicha(null);
    setComando({ id: Date.now(), tipo: "editar-tarefa", item: tarefa });
  };

  const consumirComando = () => setComando(null);
  const editorDeChatbotAberto = tela === "chatbots" && chatbotEditando !== undefined;

  // Contato que o sistema cadastrou sozinho vira lead por decisão de alguém.
  const marcarComoLead = async (contato) => {
    await api.contatos.atualizar({ id: contato.id, patch: { lead: true } });
    await carregar();
  };

  const atualizarEtiquetasDoContato = async (contatoId, tags) => {
    await api.contatos.atualizar({ id: contatoId, patch: { tags } });
    await carregar();
  };

  const criarEtiqueta = async (nome) => {
    const id = paraSlug(nome);
    if (!id) throw new Error("Digite um nome para a etiqueta.");
    if (dados.tags.some((tag) => tag.id === id)) return dados.tags.find((tag) => tag.id === id);
    const tag = { id, nome: nome.trim(), cor: "#7c5ce7" };
    await api.tags.salvar({ tags: [tag] });
    await carregar();
    return tag;
  };

  // Liga ou desliga o atendimento pela IA para o número de uma conversa.
  //
  // A marca continua sendo a etiqueta "Não atender IA" (o gate do agente de
  // clientes recusa quem a carrega), mas desde 13/09/2026 ela é gravada DIRETO
  // no banco, numa transação que acha ou cria o contato e aplica a etiqueta.
  // Antes ela ia para a cópia local e dependia da fila de sincronia, que a
  // descartava em silêncio: a ficha dizia "desligado", o banco não tinha nada, e
  // a IA seguia respondendo.
  const consultarAtendimentoIA = ({ conversa }) =>
    api.conversas.atendimentoIA({ telefone: conversa?.telefone || "" });

  const definirAtendimentoIA = async ({ conversa, atender }) => {
    if (!conversa?.telefone) throw new Error("Esta conversa não tem telefone para salvar como contato.");
    const resultado = await api.conversas.definirAtendimentoIA({
      telefone: conversa.telefone,
      atender,
      nome: conversa.nome === conversa.telefone ? "" : conversa.nome,
    });
    // A cópia local (Contatos, etiquetas) se acerta na próxima sincronia; a ficha
    // não espera por ela, porque mostra o que o banco devolveu.
    await carregar();
    return resultado;
  };

  // Os fluxos que alguém da equipe inicia na conversa (follow-up). Só os do
  // formato com caminhos têm gatilho; o banco confere de novo ao disparar.
  // `dados` é nulo enquanto carrega — ler direto derrubava o portal inteiro.
  const fluxosManuais = (dados?.chatbots || []).filter(
    (chatbot) => chatbot.ativo && chatbot.canvas?.versao === 3 && gatilhoDo(chatbot).tipo === TIPOS_GATILHO.manual,
  );
  const iniciarFluxo = ({ contato, chatbotId }) =>
    api.conversas.iniciarFluxo({ contatoId: contato.remoteId || contato.id, chatbotId });

  return (
    <div className="portal-shell flex h-dvh bg-surface text-fg">
      {/*
        O trilho tem largura FIXA de 60px no computador e zero no celular.

        `w-0 md:w-[60px]` e não `w-auto`: no celular esta caixa precisa medir
        zero SEMPRE. Lá dentro só há a navegação escondida do computador e a
        barra fixa de baixo (`position: fixed`, fora do fluxo), e uma largura
        automática abriria uma coluna vazia na tela do celular.

        Sem `overflow-hidden`: a dica de cada ícone vive FORA da barra, à
        direita, e um recorte aqui a comeria.
      */}
      {!editorDeChatbotAberto && (
      <div className="w-0 flex-none md:w-[60px]">
      <Rail
        telas={telasDoPlano}
        ativa={tela}
        aoTrocar={trocarTela}
        contagens={contagens}
        aoBuscar={buscarNaTela}
        rodape={sessao ? <RodapeWorkspace sessao={sessao} aoAbrirConta={() => trocarTela("conta")} aoTrocar={trocarOrganizacao} /> : null}
        rodapeCompacto={
          sessao ? (
            <RodapeWorkspace
              compacto
              sessao={sessao}
              telasDaOrganizacao={telasDoPlano.filter((t) => t.grupo === GRUPO_DA_ORGANIZACAO)}
              ativa={tela}
              aoAbrirTela={trocarTela}
              aoAbrirConta={() => trocarTela("conta")}
              aoTrocar={trocarOrganizacao}
            />
          ) : null
        }
      />
      </div>
      )}

      {/*
        A calha de 16px que segurava o punho saiu daqui.

        Ela existia porque o punho não tinha onde morar: um botão flutuante
        sobre o conteúdo acertaria em cheio o cabeçalho que cada tela desenha
        no canto superior esquerdo. Mas com o menu recolhido virando barra de
        ícones, há um lugar melhor — dentro do próprio menu, embaixo da marca,
        onde o punho tem âncora e não disputa espaço com ninguém.
      */}
      <main className="portal-main flex min-h-0 min-w-0 flex-1 flex-col">
        <AvisoMigracao migracao={migracaoPendente} />
        <AvisoAssinatura acesso={sessao?.acesso} />
        {erro ? (
          <div className="m-8 rounded-ctl border border-danger/40 bg-danger/10 px-4 py-3 text-[13.5px] text-danger">
            {erro}
          </div>
        ) : !dados ? (
          <div className="flex flex-1 items-center justify-center text-[14px] text-sub">
            Carregando…
          </div>
        ) : !telaLiberada(tela, recursos) ? (
          <DisponivelNoPlano tela={tela} recursos={recursos} />
        ) : tela === "conversas" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando conversas…</div>}>
            <Conversas
              dados={dados}
              recarregar={carregar}
              aoAbrirContato={abrirFicha}
              // Salvar contato a partir de uma conversa reusa o MESMO modal de
              // "Adicionar contato" da tela de Contatos, com nome e telefone
              // preenchidos. Um formulário próprio dentro de Conversas seria um
              // segundo lugar onde contato nasce, e o dia em que um campo novo
              // aparecesse só num dos dois já estaria marcado.
              aoNovoContato={(preenchido) => setEditando(preenchido || null)}
              aoAtualizarEtiquetas={atualizarEtiquetasDoContato}
              aoMarcarLead={marcarComoLead}
              aoCriarEtiqueta={criarEtiqueta}
              aoConsultarAtendimentoIA={consultarAtendimentoIA}
              aoDefinirAtendimentoIA={definirAtendimentoIA}
              fluxosManuais={fluxosManuais}
              aoIniciarFluxo={iniciarFluxo}
              telefoneParaAbrir={telefoneParaAbrir}
              aoConsumirTelefone={() => setTelefoneParaAbrir(null)}
              sessao={sessao}
            />
          </Suspense>
        ) : tela === "conhecimento" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando conhecimento…</div>}>
            <Inteligencia sessao={sessao} />
          </Suspense>
        ) : tela === "chatbots" && chatbotEditando !== undefined ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando editor…</div>}>
            <ChatbotEditor
              chatbot={chatbotEditando}
              tags={dados.tags}
              estagios={dados.estagios}
              recarregar={carregar}
              aoFechar={() => setChatbotEditando(undefined)}
              // Só com `true` explícito: o fluxo com caminhos roda no executor
              // da VPS, e liberar por dúvida gravaria um fluxo que a conexão
              // da empresa não sabe executar.
              ramificado={recursos?.fluxos_ramificados === true}
            />
          </Suspense>
        ) : tela === "contatos" ? (
          <Contatos
            dados={dados}
            recarregar={carregar}
            aoAbrirContato={(c) => (c ? abrirFicha(c) : setEditando(null))}
            aoAbrirConversa={abrirConversaDoContato}
          />
        ) : tela === "campanhas" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando campanhas…</div>}>
            <Campanhas
              dados={dados}
              sessao={sessao}
              temInteligencia={telaLiberada("conhecimento", recursos)}
              aoAbrirContato={abrirFicha}
              aoAbrirConversa={abrirConversaDoContato}
              aoAbrirChatbots={telaLiberada("chatbots", recursos) ? () => trocarTela("chatbots") : undefined}
            />
          </Suspense>
        ) : tela === "funil" ? (
          <Funil
            dados={dados}
            recarregar={carregar}
            aoAbrirContato={abrirFicha}
            comando={comando}
            aoConsumirComando={consumirComando}
            aoVerRelatorios={PLATAFORMA_WEB ? () => trocarTela("relatorios") : undefined}
          />
        ) : tela === "relatorios" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando relatórios…</div>}>
            <Relatorios dados={dados} aoAbrirContato={abrirFicha} />
          </Suspense>
        ) : tela === "tarefas" ? (
          <Tarefas
            dados={dados}
            recarregar={carregar}
            aoAbrirContato={abrirFicha}
            comando={comando}
            aoConsumirComando={consumirComando}
            sessao={sessao}
          />
        ) : tela === "agenda" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando agenda…</div>}>
            <Agenda
              dados={dados}
              aoAbrirContato={abrirFicha}
              aoRecarregarDados={carregar}
              aoIrParaTarefas={() => trocarTela("tarefas")}
              sessao={sessao}
            />
          </Suspense>
        ) : tela === "chatbots" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando chatbots…</div>}>
            <Chatbots chatbots={dados.chatbots} recarregar={carregar} aoEditar={setChatbotEditando} sessao={sessao} />
          </Suspense>
        ) : tela === "conexoes" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando conexões…</div>}>
            <Conexoes organizacao={sessao?.organizacaoAtual} usuario={sessao?.usuario} limites={sessao?.acesso?.limites} />
          </Suspense>
        ) : tela === "equipe" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando equipe…</div>}>
            <Equipe sessao={sessao} />
          </Suspense>
        ) : tela === "config" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando configurações…</div>}>
            <Configuracoes dados={dados} recarregar={carregar} />
          </Suspense>
        ) : tela === "conta" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando sua conta…</div>}>
            <MinhaConta
              sessao={sessao}
              atualizarSessao={atualizarSessao}
              aoAbrirTela={trocarTela}
            />
          </Suspense>
        ) : null}
      </main>

      {editando !== undefined && (
        <ModalContato
          contato={editando}
          aoFechar={() => setEditando(undefined)}
          aoSalvar={carregar}
        />
      )}
      {fichaAtualizada && dados && (
        <FichaContato
          contato={fichaAtualizada}
          negocios={dados.negocios}
          tarefas={dados.tarefas}
          notas={dados.notas}
          eventos={dados.eventos}
          estagios={dados.estagios}
          aoFechar={() => setFicha(null)}
          aoEditar={editarFicha}
          aoMarcarLead={() => marcarComoLead(fichaAtualizada)}
          aoCriarNegocio={criarNegocio}
          aoCriarTarefa={criarTarefa}
          aoCriarNota={() => setNotaContato(fichaAtualizada)}
          aoAbrirNegocio={abrirNegocio}
          aoAbrirTarefa={abrirTarefa}
          aoAbrirConversa={abrirConversaDoContato}
        />
      )}
      {notaContato && (
        <ModalNota
          contato={notaContato}
          aoFechar={() => setNotaContato(null)}
          aoSalvar={carregar}
        />
      )}
    </div>
  );
}
