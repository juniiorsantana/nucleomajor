import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, Phone, UserPlus } from "lucide-react";
import { api } from "../../data/client";
import { fmtRelativo } from "../../lib/formato";
import {
  podeGerenciarEquipe,
  podeMudarPapel,
  podeRemover,
  textoDoPapel,
} from "../../ui/papeis";
import {
  BotaoPrimario,
  CabecalhoTela,
  CampoBusca,
  DialogoConfirmar,
} from "../ui";
import { EstadoVazio } from "./gestaoCompartilhados";
import { DialogoConvite, DialogoWhatsApp } from "./equipe/dialogos";
import {
  LinhaConvite,
  LinhaMembro,
  colunasDaEquipe,
} from "./equipe/pecas";
import { useOperadores } from "./equipe/useOperadores";

/**
 * Equipe — uma lista só.
 *
 * A tela tinha três tabelas: convites, operadores do WhatsApp e as pessoas. A
 * mesma pessoa aparecia em duas delas, cada bloco com o seu próprio cabeçalho
 * e o seu próprio formulário aberto, e cada linha da equipe ocupava 149px
 * porque a responsabilidade para a IA era um formulário inteiro empilhado
 * abaixo dos dados.
 *
 * Agora cada pessoa é uma linha e cada coluna é uma propriedade dela; o
 * convite é a linha de quem ainda não entrou. Os formulários viraram diálogos,
 * a responsabilidade virou texto que se edita no lugar onde é lido, e a
 * descrição do papel — três frases fixas que a coluna "Pode" cortava — virou
 * o tooltip da pílula.
 *
 * A tela segue sendo sobre as OUTRAS pessoas. O que é seu mora em Minha conta.
 */

/** Só convite que ainda pode virar gente ocupa linha. */
function pendente(convite) {
  return !convite.accepted_at && !convite.revoked_at;
}

function prazoDoConvite(expiraEm) {
  const restante = new Date(expiraEm).getTime() - Date.now();
  if (!Number.isFinite(restante) || restante <= 0) return null;
  const dias = Math.ceil(restante / (24 * 60 * 60 * 1000));
  return dias <= 1 ? "expira hoje" : `expira em ${dias} dias`;
}

function situacaoDoConvite(convite) {
  if (new Date(convite.expires_at).getTime() <= Date.now()) {
    return { rotulo: "convite expirado", classe: "text-danger" };
  }
  if (convite.delivery_status === "failed") {
    return { rotulo: "o e-mail não saiu", classe: "text-danger" };
  }
  if (convite.delivery_status === "pending") {
    return { rotulo: "preparando o envio", classe: "text-sub" };
  }
  return {
    rotulo: `convite enviado ${fmtRelativo(convite.sent_at || convite.created_at)}`,
    classe: "",
    prazo: prazoDoConvite(convite.expires_at),
  };
}

/* ------------------------------------------------------------------ */

function ConviteCriado({ convite, aoFechar }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-[10px] border border-accent/40 bg-accent/5 px-4 py-3">
      <Mail size={15} className="mt-0.5 flex-none text-accent-forte" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-fg">
          Convite enviado para {convite.email || convite.invited_email}
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-sub">
          O link e o código reserva saíram pelo e-mail do Assistente Major. Vale por 7 dias, como{" "}
          {textoDoPapel(convite.role || convite.invited_role)}.
        </p>
      </div>
      <button
        type="button"
        onClick={aoFechar}
        className="flex-none cursor-pointer text-[12px] font-medium text-sub transition-colors hover:text-fg"
      >
        Fechar
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function Equipe({ sessao }) {
  const [membros, setMembros] = useState(null);
  const [convites, setConvites] = useState(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [convite, setConvite] = useState(null);
  const [confirmacao, setConfirmacao] = useState(null);
  const [dialogo, setDialogo] = useState(null);
  const [busca, setBusca] = useState("");

  const organizacao = sessao?.organizacaoAtual;
  const meuPapel = organizacao?.papel;
  const meuId = sessao?.usuario?.id;
  const gerencia = podeGerenciarEquipe(meuPapel);

  const operadores = useOperadores({ organizacaoId: organizacao?.id, ativo: gerencia });

  const carregar = useCallback(async () => {
    try {
      setMembros(await api.organizacoes.membros());
      let falhaConvite = false;
      if (gerencia) {
        try {
          setConvites(await api.organizacoes.convites());
        } catch (conviteError) {
          setErro(conviteError.message);
          falhaConvite = true;
        }
      } else {
        setConvites(null);
      }
      if (!falhaConvite) setErro("");
    } catch (e) {
      setErro(e.message);
      setMembros([]);
      setConvites([]);
    }
  }, [gerencia]);

  useEffect(() => {
    carregar();
  }, [carregar, organizacao?.id]);

  const convidar = async ({ email, papel }) => {
    setOcupado(true);
    setErro("");
    try {
      setConvite(await api.organizacoes.convidar({ email, papel }));
      await carregar();
      return true;
    } catch (e) {
      setErro(e.message);
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const reenviarConvite = async (alvo) => {
    setOcupado(true);
    setErro("");
    try {
      setConvite(await api.organizacoes.reenviarConvite({ conviteId: alvo.invite_id }));
      await carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const cancelarConvite = (alvo) => {
    setConfirmacao({
      titulo: "Cancelar este convite?",
      descricao: `O link enviado para ${alvo.invited_email} para de funcionar. Para chamar a pessoa de novo, é preciso convidar outra vez.`,
      rotulo: "Cancelar o convite",
      confirmar: async () => {
        setOcupado(true);
        setErro("");
        try {
          await api.organizacoes.cancelarConvite({ conviteId: alvo.invite_id });
          await carregar();
        } catch (e) {
          setErro(e.message);
        } finally {
          setOcupado(false);
        }
      },
    });
  };

  const mudarPapel = async (usuarioId, papel) => {
    setOcupado(true);
    setErro("");
    try {
      setMembros(await api.organizacoes.alterarPapel({ usuarioId, papel }));
    } catch (e) {
      setErro(e.message);
      // A lista local ficou com o valor que o banco recusou; recarregar é o
      // único jeito de a tela voltar a dizer a verdade.
      await carregar();
    } finally {
      setOcupado(false);
    }
  };

  const remover = (membro) => {
    const nome = membro.profile?.full_name?.trim() || "esta pessoa";
    setConfirmacao({
      titulo: `Remover ${nome} da equipe?`,
      descricao:
        "Ela perde o acesso ao CRM desta empresa. As conversas, tarefas e eventos que estão no nome dela continuam onde estão.",
      rotulo: "Remover",
      confirmar: async () => {
        setOcupado(true);
        setErro("");
        try {
          setMembros(await api.organizacoes.removerMembro({ usuarioId: membro.user_id }));
        } catch (e) {
          setErro(e.message);
          await carregar();
        } finally {
          setOcupado(false);
        }
      },
    });
  };

  const salvarResponsabilidade = async (usuarioId, responsabilidade) => {
    setOcupado(true);
    setErro("");
    try {
      setMembros(await api.organizacoes.atualizarResponsabilidade({ usuarioId, responsabilidade }));
    } catch (e) {
      setErro(e.message);
      await carregar();
    } finally {
      setOcupado(false);
    }
  };

  const revogarWhatsApp = (operador, nome) => {
    setConfirmacao({
      titulo: "Revogar este operador?",
      descricao: `${nome} deixa de ser reconhecido pelo assistente ao falar com o número principal. Para voltar, é preciso verificar o número de novo.`,
      rotulo: "Revogar",
      confirmar: () => operadores.revogar(operador),
    });
  };

  /* ---------------------------------------------------------------- */

  const convitesPendentes = useMemo(
    () => (convites || []).filter(pendente),
    [convites]
  );

  const termo = busca.trim().toLowerCase();
  const membrosVisiveis = (membros || []).filter((membro) => (
    !termo || String(membro.profile?.full_name || "").toLowerCase().includes(termo)
  ));
  const convitesVisiveis = convitesPendentes.filter((item) => (
    !termo || String(item.invited_email || "").toLowerCase().includes(termo)
  ));

  const colunas = colunasDaEquipe(gerencia);
  const total = membros?.length || 0;
  const contagem = [
    `${total} ${total === 1 ? "pessoa" : "pessoas"}`,
    convitesPendentes.length
      ? `${convitesPendentes.length} ${convitesPendentes.length === 1 ? "convite pendente" : "convites pendentes"}`
      : null,
  ].filter(Boolean).join(" · ");

  const vazio = !membrosVisiveis.length && !convitesVisiveis.length;

  return (
    <>
      <CabecalhoTela
        titulo={
          <span className="flex items-baseline gap-3">
            Equipe
            {membros && (
              <span className="text-[12.5px] font-normal text-sub">{contagem}</span>
            )}
          </span>
        }
        busca={
          organizacao ? (
            <CampoBusca valor={busca} aoMudar={setBusca} placeholder="Buscar pessoa…" />
          ) : (
            <span />
          )
        }
        acao={
          gerencia ? (
            <BotaoPrimario type="button" onClick={() => setDialogo({ tipo: "convite" })}>
              <UserPlus size={15} /> Convidar
            </BotaoPrimario>
          ) : null
        }
      />

      <div className="scrollbar-fina min-h-0 flex-1 overflow-auto px-4 pb-10 pt-5 md:px-8">
        {!organizacao ? (
          <EstadoVazio
            titulo="Nenhuma empresa selecionada"
            descricao="Escolha uma empresa no rodapé da barra lateral para ver a equipe dela."
          />
        ) : (
          <>
            <p className="mb-3.5 text-[12.5px] text-sub">
              Acesso ao CRM da{" "}
              <strong className="font-semibold text-fg">{organizacao.name}</strong>. É por empresa —
              a mesma pessoa pode ser administradora aqui e atendente em outra.
            </p>

            {convite && <ConviteCriado convite={convite} aoFechar={() => setConvite(null)} />}

            {erro && (
              <div className="mb-4 rounded-[10px] border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger">
                {erro}
              </div>
            )}

            <div className="overflow-hidden rounded-[12px] border border-line bg-bg">
              <div
                className={`${colunas} bg-surface py-2.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-sub`}
              >
                <span>Pessoa</span>
                <span>Papel</span>
                <span>Responsabilidade para a IA</span>
                {gerencia && <span>WhatsApp</span>}
                {gerencia && <span />}
              </div>

              {membros === null ? (
                <div className="px-5 py-8 text-center text-[13px] text-sub">Carregando…</div>
              ) : vazio ? (
                <EstadoVazio
                  titulo={termo ? "Ninguém bate com a busca" : "Ninguém na equipe ainda"}
                  descricao={
                    termo
                      ? "Tente outro nome, ou limpe a busca."
                      : gerencia
                        ? "Use o botão Convidar para chamar a primeira pessoa."
                        : "Só o dono e os administradores convidam pessoas."
                  }
                />
              ) : (
                <>
                  {membrosVisiveis.map((membro) => (
                    <LinhaMembro
                      key={membro.user_id}
                      membro={membro}
                      colunas={colunas}
                      gerencia={gerencia}
                      souEu={membro.user_id === meuId}
                      // Dono não ganha seletor nem para outro dono: promover
                      // alguém a dono é transferência de organização, um fluxo
                      // que ainda não existe.
                      papelEditavel={podeMudarPapel(meuPapel) && membro.role !== "owner"}
                      removivel={podeRemover(meuPapel, membro, meuId)}
                      acoesWhatsApp={gerencia && operadores.conexaoAtiva && membro.status === "active"}
                      operador={operadores.operadorDe(membro.user_id)}
                      aguardando={!!operadores.aguardando[membro.user_id]}
                      ocupado={ocupado}
                      aoMudarPapel={mudarPapel}
                      aoSalvarResponsabilidade={salvarResponsabilidade}
                      aoVincularWhatsApp={(alvo) => setDialogo({ tipo: "whatsapp", membro: alvo })}
                      aoRevogarWhatsApp={revogarWhatsApp}
                      aoRemover={remover}
                    />
                  ))}

                  {convitesVisiveis.map((item) => (
                    <LinhaConvite
                      key={item.invite_id}
                      convite={item}
                      colunas={colunas}
                      situacao={situacaoDoConvite(item)}
                      ocupado={ocupado}
                      aoReenviar={reenviarConvite}
                      aoCancelar={cancelarConvite}
                    />
                  ))}
                </>
              )}
            </div>

            {gerencia ? (
              <div className="mt-3.5 flex flex-wrap items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 py-2.5">
                <Phone size={15} className="flex-none text-sub" />
                <p className="min-w-[280px] flex-1 text-[12px] leading-relaxed text-sub">
                  <strong className="font-semibold text-fg">
                    O número principal continua sendo o único que responde.
                  </strong>{" "}
                  Cada pessoa vincula o próprio número só como identidade autorizada — por isso a
                  coluna WhatsApp fica na linha dela, e não numa tabela separada.
                </p>
                {operadores.conexoes.length > 1 && (
                  <label className="flex flex-none items-center gap-2">
                    <span className="text-[11.5px] font-medium text-sub">Conexão</span>
                    <select
                      value={operadores.conexaoId}
                      onChange={(e) => operadores.setConexaoId(e.target.value)}
                      className="rounded-[8px] border border-line bg-bg px-2.5 py-1.5 text-[12px] text-fg outline-none focus:border-accent"
                    >
                      {operadores.conexoes.map((item) => (
                        <option key={item.connectionId} value={item.connectionId}>
                          {item.name || item.connection?.phoneMasked || "WhatsApp principal"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            ) : (
              <p className="mt-3.5 text-[12px] text-faint">
                Só o dono e os administradores convidam, removem e definem responsabilidades.
              </p>
            )}

            {gerencia && !operadores.carregando && !operadores.conexoes.length && (
              <p className="mt-2 text-[12px] text-faint">
                Nenhuma conexão de WhatsApp ativa — vincular operador fica disponível quando houver
                uma.
              </p>
            )}
            {operadores.aviso && (
              <p className="mt-2 rounded-[8px] bg-success-soft px-3 py-2 text-[12px] text-success">
                {operadores.aviso}
              </p>
            )}
            {operadores.erro && (
              <p className="mt-2 rounded-[8px] bg-danger/10 px-3 py-2 text-[12px] text-danger">
                {operadores.erro}
              </p>
            )}
          </>
        )}
      </div>

      {dialogo?.tipo === "convite" && (
        <DialogoConvite
          ocupado={ocupado}
          aoConvidar={convidar}
          aoFechar={() => setDialogo(null)}
        />
      )}

      {dialogo?.tipo === "whatsapp" && (
        <DialogoWhatsApp
          membro={dialogo.membro}
          ocupado={operadores.ocupado === dialogo.membro.user_id}
          podeEnviar={operadores.podeEnviar}
          aoVincular={operadores.vincular}
          aoFechar={() => setDialogo(null)}
        />
      )}

      <DialogoConfirmar pedido={confirmacao} aoFechar={() => setConfirmacao(null)} />
    </>
  );
}
