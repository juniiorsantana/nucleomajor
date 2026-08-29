import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Bot, Cable, CalendarDays, ChevronDown, CircleUser, Filter, LibraryBig, LogOut, Settings, Sparkles, SquareCheckBig, Users, UsersRound } from "lucide-react";
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
const Inteligencia = lazy(() => import("./telas/Inteligencia"));
const Chatbots = lazy(() => import("./telas/Chatbots"));
const ChatbotEditor = lazy(() => import("./telas/ChatbotEditor"));
const Conexoes = lazy(() => import("./telas/Conexoes"));
const Equipe = lazy(() => import("./telas/Equipe"));
const Configuracoes = lazy(() => import("./telas/Configuracoes"));
const MinhaConta = lazy(() => import("./telas/MinhaConta"));

const PLATAFORMA_WEB = typeof __EMYLEADS_PLATFORM__ !== "undefined" && __EMYLEADS_PLATFORM__ === "web";

const TELAS = [
  ...(PLATAFORMA_WEB ? [{ id: "assistente", rotulo: "Assistente", icone: Sparkles }] : []),
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
  useEffect(() => {
    const aoTeclar = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.querySelector('input[placeholder^="Buscar"]')?.focus();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

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
      {!editorDeChatbotAberto && <Rail
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
      />}

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
