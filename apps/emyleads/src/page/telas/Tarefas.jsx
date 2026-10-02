import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock3, Hourglass, Pencil, Plus, Trash2, Undo2, UserRound } from "lucide-react";
import { api } from "../../data/client";
import { corDaPessoa, nomeCurto } from "../../ui/perfil";
import { BotaoPrimario, CabecalhoTela, CampoBusca, DialogoConfirmar, Iniciais } from "../ui";
import { Aviso, CaixaConcluir, Chip, Segmentado } from "./agenda/componentes";
import FormularioTarefa, { DialogoRecusa } from "./tarefas/FormularioTarefa";
import {
  GRUPOS,
  grupoDaTarefa,
  idsDosResponsaveis,
  pendenciasDaTarefa,
  pessoasDaTarefa,
  prazoDoAtalho,
  respostaDoResponsavel,
  rotuloPrazo,
} from "./tarefas/tarefasUtils";

const TONS = { faint: "text-faint", sub: "text-sub", warning: "text-warning", danger: "text-danger" };

const PRAZOS = [
  { id: "", rotulo: "Todas" },
  { id: "atrasadas", rotulo: "Atrasadas", tom: "perigo" },
  { id: "hoje", rotulo: "Hoje" },
  { id: "semana", rotulo: "Próximos 7 dias" },
  { id: "sem-data", rotulo: "Sem prazo" },
];

/** "Próximos 7 dias" no filtro inclui amanhã, que na lista tem grupo próprio. */
function casaPrazo(grupo, filtro) {
  if (!filtro) return true;
  if (filtro === "semana") return grupo === "amanha" || grupo === "semana";
  return grupo === filtro;
}

function Responsaveis({ pessoas }) {
  if (!pessoas.length) return <span className="text-faint">Sem responsável</span>;
  const nomes = pessoas.map((pessoa) => pessoa.nome).join(", ");
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={nomes}>
      <span className="flex flex-none -space-x-1.5">
        {pessoas.slice(0, 3).map((pessoa) => (
          <span key={pessoa.id || pessoa.nome} className="rounded-full ring-2 ring-bg">
            <Iniciais nome={pessoa.nome} tamanho={20} cor={pessoa.perfil ? corDaPessoa(pessoa.perfil) : null} />
          </span>
        ))}
      </span>
      <span className="truncate">
        {pessoas.length > 2 ? `${pessoas.slice(0, 2).map((p) => p.nome).join(", ")} +${pessoas.length - 2}` : nomes}
      </span>
    </span>
  );
}

function LinhaTarefa({
  tarefa, contato, pessoas, pendencias, minhaResposta, concluida,
  aoAlternar, aoAbrir, aoRemover, aoAbrirContato, aoAssumir, aoRecusar,
}) {
  const prazo = rotuloPrazo(tarefa.venceEm);
  // Silêncio quando está tudo certo. O pedido de resposta só aparece quando
  // há algo a fazer — se aparecesse em toda tarefa, deixaria de ser sinal.
  const precisoResponder = minhaResposta?.estado === "aguardando" && !concluida;
  const recusou = pendencias.some((p) => p.estado === "recusou");
  return (
    <li className="group relative flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-line px-4 py-3 last:border-b-0 hover:bg-surface/50 md:py-2.5">
      <span className="pt-0.5">
        <CaixaConcluir marcada={concluida} aoMudar={() => aoAlternar(tarefa)} titulo={concluida ? "Reabrir tarefa" : "Concluir tarefa"} />
      </span>
      {/* A linha inteira abre a tarefa. Os lápis de antes eram alvos de 28px
          ao lado de um título que ninguém podia tocar. */}
      <button type="button" onClick={() => aoAbrir(tarefa)} className="min-w-0 flex-1 cursor-pointer text-left">
        <span className={`block text-[15px] leading-5 md:text-[13.5px] ${concluida ? "text-faint line-through" : "font-medium text-fg"}`}>
          {tarefa.titulo || "Sem título"}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-sub md:text-[11.5px]">
          <span className={`flex items-center gap-1 ${concluida ? "text-faint" : TONS[prazo.tom]}`}>
            <Clock3 size={13} className="flex-none" />{concluida ? "Concluída" : prazo.texto}
          </span>
          <Responsaveis pessoas={pessoas} />
        </span>
      </button>
      <span className="flex flex-none flex-col items-end gap-1.5 md:flex-row md:items-center">
        {contato && (
          <button
            type="button"
            onClick={() => aoAbrirContato?.(contato)}
            title={`Abrir a ficha de ${contato.nome || "contato"}`}
            className="hidden max-w-[180px] cursor-pointer items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[11.5px] text-sub hover:border-accent hover:text-accent-forte sm:flex"
          >
            <Iniciais nome={contato.nome} tamanho={16} />
            <span className="truncate">{contato.nome || "Contato sem nome"}</span>
          </button>
        )}
        <span className="hidden gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 md:flex">
          <button type="button" onClick={() => aoAbrir(tarefa)} aria-label="Editar tarefa" title="Editar" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-ctl text-sub hover:bg-surface-hover hover:text-fg"><Pencil size={14} /></button>
          <button type="button" onClick={() => aoRemover(tarefa)} aria-label="Excluir tarefa" title="Excluir" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-ctl text-sub hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
        </span>
      </span>
      {(precisoResponder || (pendencias.length > 0 && !concluida)) && (
        <div className="-mt-1 ml-11 flex basis-full flex-wrap items-center gap-2 md:ml-9">
          {pendencias.length > 0 && !concluida && !precisoResponder && (
            <span title={pendencias.map((p) => p.texto).join(" · ")} className={`flex min-w-0 items-center gap-1 text-[12px] md:text-[11px] ${recusou ? "text-danger" : "text-warning"}`}>
              {recusou ? <Undo2 size={12} className="flex-none" /> : <Hourglass size={12} className="flex-none" />}
              <span className="truncate">{pendencias[0].texto}</span>
              {pendencias.length > 1 && <span className="flex-none">+{pendencias.length - 1}</span>}
            </span>
          )}
          {precisoResponder && (
            <>
              <span className="text-[12px] font-medium text-accent-forte md:text-[11px]">Colocaram você nesta tarefa.</span>
              <button type="button" onClick={() => aoAssumir(tarefa)} className="flex min-h-10 cursor-pointer items-center gap-1 rounded-ctl bg-accent px-3.5 text-[14px] font-semibold text-white hover:brightness-110 md:min-h-8 md:text-[12px]">
                <Check size={14} strokeWidth={2.6} />Assumir
              </button>
              <button type="button" onClick={() => aoRecusar(tarefa)} className="min-h-10 cursor-pointer rounded-ctl border border-line px-3.5 text-[14px] font-medium text-sub hover:border-line-strong hover:text-fg md:min-h-8 md:text-[12px]">
                Recusar
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export default function Tarefas({ dados, recarregar, aoAbrirContato, comando, aoConsumirComando, sessao }) {
  const { contatos, tarefas } = dados;
  const [equipe, setEquipe] = useState([]);
  const [recusando, setRecusando] = useState(null);
  const usuarioId = sessao?.usuario?.id || null;
  const [busca, setBusca] = useState("");
  // "Minhas" é o padrão: a pergunta de quem abre esta tela é "o que eu tenho
  // de fazer?", e a lista da empresa inteira respondia outra coisa.
  const [aba, setAba] = useState(usuarioId ? "minhas" : "equipe");
  const [filtroPrazo, setFiltroPrazo] = useState("");
  const [filtroPessoa, setFiltroPessoa] = useState("");
  const [editando, setEditando] = useState(undefined);
  const [aviso, setAviso] = useState(null);
  const [confirmacao, setConfirmacao] = useState(null);
  const [rapida, setRapida] = useState("");
  const [criando, setCriando] = useState(false);
  // Marca da caixinha enquanto o servidor responde: recarregar tudo leva um
  // instante, e a caixa que não reage ao toque parece não ter pegado.
  const [otimista, setOtimista] = useState({});
  const agora = Date.now();

  // A equipe é da tela, e não do carregamento geral: uma falha aqui deixa o
  // seletor vazio e o resto das tarefas de pé.
  useEffect(() => {
    let vivo = true;
    api.organizacoes.membros()
      .then((lista) => { if (vivo) setEquipe(lista.filter((m) => m.status === "active")); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!comando) return;
    if (comando.tipo === "nova-tarefa") setEditando({ contactId: comando.contatoId });
    if (comando.tipo === "editar-tarefa") setEditando(comando.item);
    if (comando.tipo === "nova-tarefa" || comando.tipo === "editar-tarefa") aoConsumirComando?.();
  }, [aoConsumirComando, comando]);

  const mostrarAviso = useCallback((proximo) => setAviso({ ...proximo, chave: Date.now() }), []);
  const fecharAviso = useCallback(() => setAviso(null), []);

  const equipePorId = useMemo(
    () => new Map(equipe.filter((m) => m.user_id).map((m) => [m.user_id, m])),
    [equipe]
  );
  const contatosPorId = useMemo(() => Object.fromEntries(contatos.map((c) => [c.id, c])), [contatos]);
  const concluidaDe = useCallback((t) => (t.id in otimista ? otimista[t.id] : t.concluida), [otimista]);

  const daAba = useMemo(() => tarefas.filter((t) => {
    const feita = concluidaDe(t);
    if (aba === "concluidas") return feita;
    if (feita) return false;
    if (aba === "minhas") return usuarioId ? idsDosResponsaveis(t).includes(usuarioId) : true;
    return !filtroPessoa || idsDosResponsaveis(t).includes(filtroPessoa);
  }), [aba, concluidaDe, filtroPessoa, tarefas, usuarioId]);

  const contagem = useMemo(() => {
    const porGrupo = {};
    for (const t of daAba) {
      const grupo = grupoDaTarefa(t, agora);
      porGrupo[grupo] = (porGrupo[grupo] || 0) + 1;
    }
    return porGrupo;
  }, [agora, daAba]);

  const minhasAbertas = useMemo(
    () => (usuarioId ? tarefas.filter((t) => !concluidaDe(t) && idsDosResponsaveis(t).includes(usuarioId)).length : 0),
    [concluidaDe, tarefas, usuarioId]
  );
  const equipeAbertas = tarefas.filter((t) => !concluidaDe(t)).length;

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return daAba
      .filter((t) => {
        if (aba !== "concluidas" && !casaPrazo(grupoDaTarefa(t, agora), filtroPrazo)) return false;
        if (!termo) return true;
        const contato = contatosPorId[t.contactId];
        return `${t.titulo} ${contato?.nome || ""} ${contato?.empresa || ""}`.toLowerCase().includes(termo);
      })
      .sort((a, b) => {
        if (aba === "concluidas") return (b.concluidaEm ?? 0) - (a.concluidaEm ?? 0);
        return (a.venceEm ?? Infinity) - (b.venceEm ?? Infinity);
      });
  }, [aba, agora, busca, contatosPorId, daAba, filtroPrazo]);

  const alternar = async (tarefa) => {
    const proxima = !concluidaDe(tarefa);
    setOtimista((atual) => ({ ...atual, [tarefa.id]: proxima }));
    try {
      await api.tarefas.concluir({ id: tarefa.id, concluida: proxima });
      await recarregar();
      mostrarAviso({
        texto: proxima ? "Tarefa concluída." : "Tarefa reaberta.",
        acao: proxima ? { rotulo: "Desfazer", executar: () => alternar({ ...tarefa, concluida: true }) } : null,
      });
    } catch (e) {
      mostrarAviso({ tom: "erro", texto: e?.message || String(e) });
    } finally {
      setOtimista((atual) => {
        const proximo = { ...atual };
        delete proximo[tarefa.id];
        return proximo;
      });
    }
  };

  const responder = async (tarefa, aceitar, motivo = "") => {
    try {
      await api.tarefas.responder({ id: tarefa.id, aceitar, motivo });
      await recarregar();
      mostrarAviso({ texto: aceitar ? "Você assumiu a tarefa." : "Tarefa recusada. Quem atribuiu foi avisado." });
    } catch (e) {
      mostrarAviso({ tom: "erro", texto: e?.message || String(e) });
    } finally {
      setRecusando(null);
    }
  };

  const remover = (tarefa) => setConfirmacao({
    titulo: "Excluir esta tarefa?",
    descricao: `"${tarefa.titulo || "Sem título"}" sai da lista e da agenda de quem responde por ela.`,
    rotulo: "Excluir",
    confirmar: async () => {
      try {
        await api.tarefas.remover({ id: tarefa.id });
        await recarregar();
        mostrarAviso({ texto: "Tarefa excluída." });
      } catch (e) {
        mostrarAviso({ tom: "erro", texto: e?.message || String(e) });
      }
    },
  });

  // O prazo da criação rápida segue o filtro à vista: quem está olhando
  // "Hoje" e digita uma tarefa espera vê-la ali, e não sumir para "Sem prazo".
  const prazoRapido = filtroPrazo === "hoje" || filtroPrazo === "atrasadas"
    ? prazoDoAtalho("hoje")
    : filtroPrazo === "semana" ? prazoDoAtalho("amanha") : null;
  const criarRapida = async (e) => {
    e.preventDefault();
    const titulo = rapida.trim();
    if (!titulo || criando) return;
    setCriando(true);
    try {
      const responsaveis = aba === "equipe" && filtroPessoa ? [filtroPessoa] : (usuarioId ? [usuarioId] : []);
      const principal = equipePorId.get(responsaveis[0]);
      await api.tarefas.criar({
        titulo,
        venceEm: prazoRapido,
        responsaveis,
        responsavel: principal ? nomeCurto(principal.profile, "") : "",
        contactId: null,
      });
      setRapida("");
      await recarregar();
      mostrarAviso({ texto: `Tarefa criada${prazoRapido ? ` · ${rotuloPrazo(prazoRapido).texto}` : ""}.` });
    } catch (falha) {
      mostrarAviso({ tom: "erro", texto: falha?.message || String(falha) });
    } finally {
      setCriando(false);
    }
  };

  const pessoasDaEquipe = useMemo(
    () => equipe.filter((m) => m.user_id).sort((a, b) => nomeCurto(a.profile).localeCompare(nomeCurto(b.profile), "pt-BR")),
    [equipe]
  );

  const vazio = tarefas.length === 0;

  return (
    <>
      <CabecalhoTela
        titulo="Tarefas"
        busca={<CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar tarefa ou cliente…" />}
        acao={
          <BotaoPrimario onClick={() => setEditando(null)} className="!hidden md:!flex">
            <Plus size={18} strokeWidth={2.4} />
            Nova tarefa
          </BotaoPrimario>
        }
      />

      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 pb-24 pt-3 md:gap-4 md:px-8 md:py-6">
          <Segmentado
            rotulo="De quem"
            cheio
            className="md:max-w-md"
            valor={aba}
            aoMudar={(id) => { setAba(id); setFiltroPessoa(""); }}
            opcoes={[
              ...(usuarioId ? [{ id: "minhas", rotulo: "Minhas", contador: minhasAbertas }] : []),
              { id: "equipe", rotulo: "Equipe", contador: equipeAbertas },
              { id: "concluidas", rotulo: "Concluídas" },
            ]}
          />

          {aba !== "concluidas" && (
            <div className="-mx-3 flex gap-2 sem-barra overflow-x-auto px-3 pb-0.5 md:mx-0 md:flex-wrap md:px-0">
              {PRAZOS.map((prazo) => (
                <Chip
                  key={prazo.id || "todas"}
                  ativo={filtroPrazo === prazo.id}
                  aoClicar={() => setFiltroPrazo(prazo.id)}
                  tom={prazo.tom}
                  contador={prazo.id === "semana" ? (contagem.amanha || 0) + (contagem.semana || 0) : prazo.id ? contagem[prazo.id] : 0}
                >
                  {prazo.rotulo}
                </Chip>
              ))}
            </div>
          )}

          {aba === "equipe" && pessoasDaEquipe.length > 1 && (
            <div className="-mx-3 flex items-center gap-2 sem-barra overflow-x-auto px-3 pb-0.5 md:mx-0 md:flex-wrap md:px-0">
              <UserRound size={15} className="flex-none text-faint" aria-hidden="true" />
              <Chip ativo={!filtroPessoa} aoClicar={() => setFiltroPessoa("")}>Todos</Chip>
              {pessoasDaEquipe.map((membro) => (
                <Chip key={membro.user_id} ativo={filtroPessoa === membro.user_id} aoClicar={() => setFiltroPessoa(membro.user_id)} cor={corDaPessoa(membro.profile)}>
                  {nomeCurto(membro.profile)}
                </Chip>
              ))}
            </div>
          )}

          <div className="overflow-hidden rounded-none border border-line bg-bg">
            {aba !== "concluidas" && (
              <form onSubmit={criarRapida} className="flex items-center gap-2 border-b border-line px-3 py-2">
                <Plus size={18} className="ml-1 flex-none text-accent-forte" aria-hidden="true" />
                <input
                  value={rapida}
                  onChange={(e) => setRapida(e.target.value)}
                  maxLength={240}
                  aria-label="Adicionar tarefa rápida"
                  placeholder={prazoRapido ? `Adicionar tarefa para ${rotuloPrazo(prazoRapido).texto.toLowerCase()}…` : "Adicionar tarefa…"}
                  className="min-h-11 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-faint md:min-h-9 md:text-[13.5px]"
                />
                {rapida.trim() && (
                  <button type="submit" disabled={criando} className="min-h-10 flex-none cursor-pointer rounded-ctl bg-accent px-3.5 text-[14px] font-semibold text-white disabled:opacity-40 md:min-h-8 md:text-[12px]">
                    {criando ? "Criando…" : "Adicionar"}
                  </button>
                )}
              </form>
            )}

            {vazio ? (
              <div className="px-6 py-14 text-center">
                <p className="text-[15px] font-medium text-fg">Nenhuma tarefa por aqui</p>
                <p className="mx-auto mt-1 max-w-sm text-[13px] text-sub">Escreva acima o próximo passo com um cliente — ligar, mandar proposta, confirmar horário.</p>
              </div>
            ) : filtradas.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="text-[15px] font-medium text-fg">
                  {aba === "concluidas" ? "Nada concluído ainda" : aba === "minhas" && !filtroPrazo && !busca ? "Tudo em dia 🎉" : "Nenhuma tarefa neste filtro"}
                </p>
                <p className="mx-auto mt-1 max-w-sm text-[13px] text-sub">
                  {aba === "minhas" && !filtroPrazo && !busca ? "Você não tem tarefas abertas." : "Troque o filtro ou busque por outro termo."}
                </p>
                {aba === "minhas" && equipeAbertas > 0 && (
                  <button type="button" onClick={() => setAba("equipe")} className="mt-4 min-h-11 cursor-pointer rounded-ctl border border-line px-4 text-[14px] font-semibold text-fg hover:border-accent hover:text-accent-forte md:min-h-9 md:text-[13px]">
                    Ver as {equipeAbertas} da equipe
                  </button>
                )}
              </div>
            ) : (
              GRUPOS.map((grupo) => {
                const itens = filtradas.filter((t) => (aba === "concluidas" ? "concluidas" : grupoDaTarefa(t, agora)) === grupo.id);
                if (!itens.length) return null;
                return (
                  <section key={grupo.id} aria-label={grupo.rotulo}>
                    <h3 className={`sticky top-0 z-[1] border-b border-line bg-surface/95 px-4 py-2 text-[13px] font-semibold backdrop-blur md:text-[12px] ${grupo.id === "atrasadas" ? "text-danger" : "text-sub"}`}>
                      {grupo.rotulo} <span className="font-normal text-faint">· {itens.length}</span>
                    </h3>
                    <ul>
                      {itens.map((tarefa) => (
                        <LinhaTarefa
                          key={tarefa.id}
                          tarefa={tarefa}
                          concluida={concluidaDe(tarefa)}
                          contato={contatosPorId[tarefa.contactId]}
                          pessoas={pessoasDaTarefa(tarefa, equipePorId)}
                          pendencias={pendenciasDaTarefa(tarefa, equipePorId)}
                          minhaResposta={usuarioId ? respostaDoResponsavel(tarefa, usuarioId) : null}
                          aoAlternar={alternar}
                          aoAbrir={setEditando}
                          aoRemover={remover}
                          aoAbrirContato={aoAbrirContato}
                          aoAssumir={(item) => responder(item, true)}
                          aoRecusar={setRecusando}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setEditando(null)}
        aria-label="Nova tarefa"
        className="botao-novo-flutuante h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-accent text-white  active:scale-95"
      >
        <Plus size={26} strokeWidth={2.4} />
      </button>

      <Aviso aviso={aviso} aoFechar={fecharAviso} />
      <DialogoConfirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />

      {recusando && (
        <DialogoRecusa
          tarefa={recusando}
          aoFechar={() => setRecusando(null)}
          aoConfirmar={(motivo) => responder(recusando, false, motivo)}
        />
      )}

      {editando !== undefined && (
        <FormularioTarefa
          key={editando?.id || "novo"}
          tarefa={editando}
          contatoIdInicial={editando?.contactId}
          contatos={contatos}
          equipe={equipe}
          usuarioId={usuarioId}
          aoFechar={() => setEditando(undefined)}
          aoSalvo={(texto) => mostrarAviso({ texto })}
          recarregar={recarregar}
        />
      )}
    </>
  );
}
