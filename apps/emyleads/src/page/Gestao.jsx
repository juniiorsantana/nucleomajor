import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Bot, Cable, CalendarDays, ChevronDown, ChevronsLeft, ChevronsRight, CircleUser, Filter, LibraryBig, LogOut, MessageSquare, Settings, Sparkles, SquareCheckBig, Users, UsersRound } from "lucide-react";
import { api } from "../data/client";
import { PAPEIS } from "../ui/papeis";
import { corDaPessoa, nomeCurto } from "../ui/perfil";
import Contatos from "./telas/Contatos";
import FichaContato from "./telas/FichaContato";
import Funil from "./telas/Funil";
import Tarefas from "./telas/Tarefas";
import { CampoFormulario, ENTRADA_GESTAO, ModalGestao } from "./telas/gestaoCompartilhados";
import { BotaoPrimario, CabecalhoTela, Iniciais, Marca, Rail } from "./ui";

const Agenda = lazy(() => import("./telas/Agenda"));
const Assistente = lazy(() => import("./telas/Assistente"));
const Conversas = lazy(() => import("./telas/Conversas"));
const Inteligencia = lazy(() => import("./telas/Inteligencia"));
const Chatbots = lazy(() => import("./telas/Chatbots"));
const ChatbotEditor = lazy(() => import("./telas/ChatbotEditor"));
const Conexoes = lazy(() => import("./telas/Conexoes"));
const Equipe = lazy(() => import("./telas/Equipe"));
const Configuracoes = lazy(() => import("./telas/Configuracoes"));
const MinhaConta = lazy(() => import("./telas/MinhaConta"));

const PLATAFORMA_WEB = typeof __EMYLEADS_PLATFORM__ !== "undefined" && __EMYLEADS_PLATFORM__ === "web";

/**
 * Recolher o menu é preferência, e preferência atravessa recarga.
 *
 * Quem esconde o menu quer espaço para a tela larga — a conversa, o funil, o
 * editor — e quer isso amanhã de novo. Reabrir sozinho a cada F5 transformaria
 * a escolha num clique diário.
 *
 * Fica no `localStorage` e não no Supabase de propósito: é preferência DESTE
 * computador. A mesma pessoa num monitor pequeno e num grande quer coisas
 * diferentes, e sincronizar isso seria sincronizar o incômodo.
 */
const CHAVE_DO_MENU = "emyleads.menu.recolhido";

function menuRecolhidoNoInicio() {
  try {
    return window.localStorage.getItem(CHAVE_DO_MENU) === "1";
  } catch {
    // Janela anônima, cookies bloqueados, extensão sem permissão: o menu
    // simplesmente abre, que é o padrão. Preferência perdida não é falha.
    return false;
  }
}

const TELAS = [
  ...(PLATAFORMA_WEB
    ? [
        { id: "assistente", rotulo: "Assistente", icone: Sparkles },
        // Logo abaixo do Assistente, e não dentro de Contatos: é por onde o dia
        // começa, não uma sub-tela de quem já está cadastrado.
        //
        // Só no portal. Dentro da extensão a conversa já está na tela — é o
        // WhatsApp com o painel do EmyLeads do lado. Uma caixa de entrada
        // dentro dela seria a mesma conversa duas vezes.
        { id: "conversas", rotulo: "Conversas", icone: MessageSquare },
      ]
    : []),
  { id: "contatos", rotulo: "Contatos", icone: Users },
  { id: "funil", rotulo: "Funil", icone: Filter },
  { id: "tarefas", rotulo: "Tarefas", icone: SquareCheckBig },
  { id: "agenda", rotulo: "Agenda", icone: CalendarDays },
  ...(PLATAFORMA_WEB ? [{ id: "conhecimento", rotulo: "Inteligência", icone: LibraryBig }] : []),
  { id: "chatbots", rotulo: "Chatbots", icone: Bot },
  { id: "conexoes", rotulo: "Conexões", icone: Cable },
  { id: "equipe", rotulo: "Equipe", icone: UsersRound },
  { id: "config", rotulo: "Configurações", icone: Settings },
];

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
    if (!confirm("Excluir este contato? Negócios, tarefas e notas vão junto.")) return;
    await api.contatos.remover({ id: contato.id });
    await aoSalvar();
    aoFechar();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-md overflow-hidden rounded-[14px] border border-line bg-bg shadow-2xl">
        <form onSubmit={enviar}>
          <div className="border-b border-line px-5 py-4 text-[16px] font-semibold text-fg">
            {contato?.id ? "Editar contato" : "Adicionar contato"}
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
                  className="w-full rounded-[8px] border border-line bg-bg px-3 py-2 text-[13.5px] text-fg outline-none transition-colors focus:border-accent"
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
                className="cursor-pointer rounded-[8px] px-3 py-2 text-[13.5px] font-medium text-sub transition-colors hover:text-fg"
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
    <ModalGestao titulo={`Nova nota · ${contato.nome || "Contato"}`} aoFechar={aoFechar}>
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
          <button type="button" onClick={aoFechar} className="rounded-[8px] px-3 py-2 text-[13px] font-medium text-sub hover:text-fg">
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
    <div className="mx-6 mt-4 flex flex-wrap items-center gap-3 rounded-[10px] border border-accent/25 bg-accent-soft px-4 py-3 text-[12.5px] text-sub">
      <span className="min-w-0 flex-1">
        Há dados antigos neste navegador aguardando migração para esta organização.
      </span>
      <button
        type="button"
        onClick={migracao.aoReabrir}
        className="cursor-pointer rounded-[8px] px-3 py-1.5 font-semibold text-accent-forte hover:bg-bg"
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
function RodapeWorkspace({ sessao, aoTrocar, aoAbrirConta }) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState("");

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

  return (
    <div className="relative">
      <button onClick={() => setAberto(!aberto)} className="flex w-full cursor-pointer items-center gap-2.5 rounded-[12px] border border-line px-3 py-2.5 text-left hover:bg-surface-hover">
        <Iniciais nome={perfil?.full_name || apelido} tamanho={30} cor={cor} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-fg">{apelido}</span>
          <span className="block truncate text-[11.5px] text-sub">
            {sessao.organizacaoAtual.name}
            {papel && ` · ${papel}`}
          </span>
        </span>
        <ChevronDown size={15} className={`flex-none text-sub transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-20 overflow-hidden rounded-[10px] border border-line bg-bg p-1 shadow-xl">
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Iniciais nome={perfil?.full_name || apelido} tamanho={32} cor={cor} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-fg">{apelido}</span>
              <span className="block truncate text-[11.5px] text-sub">{sessao.usuario?.email || "Conta conectada"}</span>
            </span>
          </div>
          <button
            onClick={() => {
              setAberto(false);
              aoAbrirConta?.();
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12.5px] font-medium text-sub hover:bg-surface-hover hover:text-fg"
          >
            <CircleUser size={15} /> Minha conta
          </button>

          <div className="my-1 border-t border-line" />
          <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
            Trocar de empresa
          </p>
          {sessao.organizacoes.map((org) => (
            <button key={org.id} onClick={() => trocar(org.id)} className="flex w-full cursor-pointer items-center rounded-[7px] px-2.5 py-2 text-left text-[12.5px] text-sub hover:bg-surface-hover hover:text-fg">
              <span className="min-w-0 flex-1 truncate">{org.name}</span>
              {org.id === sessao.organizacaoAtual.id && <span className="text-[11px] text-accent-forte">Atual</span>}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button onClick={sair} className="flex w-full cursor-pointer items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[12.5px] text-danger hover:bg-danger/10">
            <LogOut size={14} /> Sair
          </button>
          {erro && <p className="px-2.5 pb-1 text-[11px] text-danger">{erro}</p>}
        </div>
      )}
    </div>
  );
}

export default function Gestao({ sessao = null, atualizarSessao = null, migracaoPendente = null, telaInicial = null, aoTrocarTela = null }) {
  const [tela, setTela] = useState(telaInicial || (PLATAFORMA_WEB ? "assistente" : "contatos"));
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [editando, setEditando] = useState(undefined); // undefined = fechado
  const [ficha, setFicha] = useState(null);
  const [notaContato, setNotaContato] = useState(null);
  const [comando, setComando] = useState(null);
  const [chatbotEditando, setChatbotEditando] = useState(undefined); // undefined = lista fechada, null = novo
  const [menuRecolhido, setMenuRecolhido] = useState(menuRecolhidoNoInicio);

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
    if (telaInicial && telaInicial !== tela) setTela(telaInicial);
  }, [telaInicial]);

  const trocarTela = useCallback((proxima) => {
    setTela(proxima);
    aoTrocarTela?.(proxima);
  }, [aoTrocarTela]);

  const alternarMenu = useCallback(() => {
    setMenuRecolhido((antes) => {
      const proximo = !antes;
      try {
        window.localStorage.setItem(CHAVE_DO_MENU, proximo ? "1" : "0");
      } catch {
        // Sem onde guardar, a escolha vale só nesta sessão — e continua valendo.
      }
      return proximo;
    });
  }, []);

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
  // que funcionar de verdade. ⌘B / Ctrl+B recolhe o menu, que é o atalho que
  // todo editor usa para a mesma coisa.
  useEffect(() => {
    const aoTeclar = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tecla = e.key.toLowerCase();
      if (tecla === "k") {
        e.preventDefault();
        document.querySelector('input[placeholder^="Buscar"]')?.focus();
      }
      if (tecla === "b") {
        e.preventDefault();
        alternarMenu();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [alternarMenu]);

  const abrirFicha = (contato) => {
    if (contato) setFicha(contato);
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

  return (
    <div className="flex h-screen bg-surface text-fg">
      {/*
        O menu recolhe pela LARGURA de quem o envolve, e não deixando de ser
        desenhado. A diferença importa: `Rail` desenha duas navegações, a de
        computador e a barra de baixo do celular, e a do celular é
        `position: fixed` — está fora do fluxo, e por isso continua inteira
        quando esta caixa fecha para zero. Deixar de desenhar `Rail` levaria a
        navegação do celular junto, e no celular não há menu lateral para
        recolher: só a barra de baixo, que é a única forma de navegar.

        `w-0 md:w-64` e não `w-auto`: no celular esta caixa precisa medir zero
        SEMPRE — lá dentro só há a navegação escondida do computador e a barra
        fixa de baixo, e uma largura automática que um dia medisse diferente
        abriria uma coluna vazia de 256px na tela do celular. A largura fixa é
        também o que torna a animação possível: o CSS não interpola de `auto`
        para zero.
      */}
      {!editorDeChatbotAberto && (
      <div
        className={`flex-none overflow-hidden transition-[width] duration-200 ${
          menuRecolhido ? "w-0" : "w-0 md:w-64"
        }`}
      >
      <Rail
        telas={TELAS}
        ativa={tela}
        aoTrocar={trocarTela}
        rodape={
          sessao ? (
            <RodapeWorkspace
              sessao={sessao}
              aoAbrirConta={() => trocarTela("conta")}
              aoTrocar={async (proximo) => {
                setDados(null);
                // Descarrega a credencial local do workspace que está saindo
                // antes de qualquer consulta do novo. Uma credencial que
                // sobrevive à troca é acesso que o usuário acha que encerrou.
                const anterior = sessao?.organizacaoAtual?.id;
                if (anterior && anterior !== proximo) {
                  await api.gateway.descarregar({ organizationId: anterior }).catch(() => {});
                }
                if (atualizarSessao) await atualizarSessao(proximo);
                await carregar();
              }}
            />
          ) : (
            <div className="flex items-center gap-2.5 rounded-[12px] border border-line px-3 py-2.5">
              <Marca tamanho={30} texto={false} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-fg">EmyLeads</div>
                <div className="truncate text-[11.5px] text-sub">{dados ? `${dados.contatos.length} contatos` : "Carregando…"}</div>
              </div>
            </div>
          )
        }
      />
      </div>
      )}

      {/*
        O punho que recolhe e traz de volta.

        Coluna estreita e própria, e não um botão flutuante sobre o conteúdo:
        cada tela desenha o próprio cabeçalho no canto superior esquerdo — o
        título de Contatos, a lista de Conversas — e um botão por cima
        acertaria um deles em cheio. Dezesseis pixels custam menos que isso.

        Só em computador: no celular a navegação é a barra de baixo, e não há
        menu lateral para recolher.
      */}
      {!editorDeChatbotAberto && (
        <div className="hidden flex-none justify-center pt-4 md:flex md:w-4">
          <button
            onClick={alternarMenu}
            title={`${menuRecolhido ? "Mostrar" : "Esconder"} o menu (Ctrl+B)`}
            aria-label={menuRecolhido ? "Mostrar o menu" : "Esconder o menu"}
            aria-expanded={!menuRecolhido}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[8px] text-faint transition-colors hover:bg-surface-hover hover:text-fg"
          >
            {menuRecolhido ? (
              <ChevronsRight size={15} strokeWidth={2.2} />
            ) : (
              <ChevronsLeft size={15} strokeWidth={2.2} />
            )}
          </button>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        <AvisoMigracao migracao={migracaoPendente} />
        {erro ? (
          <div className="m-8 rounded-[10px] border border-danger/40 bg-danger/10 px-4 py-3 text-[13.5px] text-danger">
            {erro}
          </div>
        ) : !dados ? (
          <div className="flex flex-1 items-center justify-center text-[14px] text-sub">
            Carregando…
          </div>
        ) : tela === "assistente" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando assistente…</div>}>
            <Assistente />
          </Suspense>
        ) : tela === "conversas" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando conversas…</div>}>
            <Conversas
              dados={dados}
              recarregar={carregar}
              aoAbrirContato={abrirFicha}
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
            />
          </Suspense>
        ) : tela === "contatos" ? (
          <Contatos
            dados={dados}
            recarregar={carregar}
            aoAbrirContato={(c) => (c ? abrirFicha(c) : setEditando(null))}
          />
        ) : tela === "funil" ? (
          <Funil
            dados={dados}
            recarregar={carregar}
            aoAbrirContato={abrirFicha}
            comando={comando}
            aoConsumirComando={consumirComando}
          />
        ) : tela === "tarefas" ? (
          <Tarefas
            dados={dados}
            recarregar={carregar}
            aoAbrirContato={abrirFicha}
            comando={comando}
            aoConsumirComando={consumirComando}
          />
        ) : tela === "agenda" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando agenda…</div>}>
            <Agenda
              dados={dados}
              aoAbrirContato={abrirFicha}
              aoAbrirTarefa={abrirTarefa}
              aoRecarregarDados={carregar}
            />
          </Suspense>
        ) : tela === "chatbots" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando chatbots…</div>}>
            <Chatbots chatbots={dados.chatbots} recarregar={carregar} aoEditar={setChatbotEditando} sessao={sessao} />
          </Suspense>
        ) : tela === "conexoes" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-[13px] text-sub">Carregando conexões…</div>}>
            <Conexoes organizacao={sessao?.organizacaoAtual} usuario={sessao?.usuario} />
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
          aoCriarNegocio={criarNegocio}
          aoCriarTarefa={criarTarefa}
          aoCriarNota={() => setNotaContato(fichaAtualizada)}
          aoAbrirNegocio={abrirNegocio}
          aoAbrirTarefa={abrirTarefa}
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
