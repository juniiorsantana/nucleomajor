import { useCallback, useEffect, useState } from "react";
import { Ban, CheckCircle2, LoaderCircle, Mail, RefreshCw, ShieldCheck, Smartphone, Trash2, UserPlus, X } from "lucide-react";
import { api } from "../../data/client";
import { fmtData, fmtRelativo } from "../../lib/formato";
import {
  PAISES_TELEFONE,
  formatarTelefoneOperador,
  paisDoTelefone,
  telefoneOperadorE164,
} from "../../lib/telefoneOperador";
import {
  DESCRICAO_DO_PAPEL,
  OPCOES_DE_PAPEL,
  podeGerenciarEquipe,
  podeMudarPapel,
  podeRemover,
  textoDoPapel,
} from "../../ui/papeis";
import { BotaoPrimario, CabecalhoTela, Iniciais, Seletor } from "../ui";
import { EstadoVazio } from "./gestaoCompartilhados";

const COLUNAS =
  "grid grid-cols-[minmax(220px,1.6fr)_minmax(150px,1fr)_minmax(150px,1fr)_60px] items-center gap-4";


function ConviteCriado({ convite, aoFechar }) {
  return (
    <div className="mb-4 rounded-[10px] border border-accent/40 bg-accent/5 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Mail size={16} className="mt-0.5 flex-none text-accent-forte" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-fg">
            Convite enviado para {convite.email || convite.invited_email}
          </p>
          <p className="mt-1 text-[12.5px] text-sub">
            O link e o código reserva foram enviados pelo e-mail do Assistente Major. A pessoa
            poderá criar uma conta nova ou entrar com a conta que já usa no EmyLeads.
          </p>
          <p className="mt-2 text-[11.5px] text-faint">
            Vale por 7 dias, como {textoDoPapel(convite.role || convite.invited_role)}.
          </p>
        </div>
        <button
          type="button"
          onClick={aoFechar}
          className="flex-none text-[12.5px] font-medium text-sub transition-colors hover:text-fg"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}

function statusDoConvite(convite) {
  if (convite.accepted_at) return { label: "Aceito", classe: "text-success" };
  if (convite.revoked_at) return { label: "Cancelado", classe: "text-faint" };
  if (new Date(convite.expires_at).getTime() <= Date.now()) return { label: "Expirado", classe: "text-danger" };
  if (convite.delivery_status === "failed") return { label: "Falha no e-mail", classe: "text-danger" };
  if (convite.delivery_status === "pending") return { label: "Preparando", classe: "text-sub" };
  return { label: "Enviado", classe: "text-accent-forte" };
}

function ListaConvites({ convites, ocupado, aoReenviar, aoCancelar }) {
  if (!convites?.length) return null;
  return (
    <div className="mb-5 overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <p className="text-[13px] font-semibold text-fg">Convites enviados</p>
          <p className="mt-0.5 text-[11.5px] text-faint">O token nunca fica exposto nesta tela.</p>
        </div>
        <Mail size={16} className="text-faint" />
      </div>
      <div className="divide-y divide-line">
        {convites.map((convite) => {
          const status = statusDoConvite(convite);
          const podeReenviar = !convite.accepted_at && !convite.revoked_at;
          return (
            <div key={convite.invite_id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-[210px] flex-1">
                <p className="truncate text-[13px] font-medium text-fg">{convite.invited_email}</p>
                <p className="mt-0.5 text-[11.5px] text-sub">
                  {textoDoPapel(convite.invited_role)} · expira em {fmtData(convite.expires_at)}
                </p>
              </div>
              <span className={`text-[12px] font-semibold ${status.classe}`}>{status.label}</span>
              {podeReenviar && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => aoReenviar(convite)}
                    title="Reenviar convite"
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-2.5 py-1.5 text-[11.5px] font-semibold text-sub hover:border-accent hover:text-accent-forte disabled:opacity-50"
                  >
                    <RefreshCw size={13} /> Reenviar
                  </button>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => aoCancelar(convite)}
                    title="Cancelar convite"
                    className="rounded-[8px] p-1.5 text-sub hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OperadoresWhatsApp({ organizacaoId, membros }) {
  const [conexoes, setConexoes] = useState([]);
  const [conexaoId, setConexaoId] = useState("");
  const [operadores, setOperadores] = useState([]);
  const [telefones, setTelefones] = useState({});
  const [paises, setPaises] = useState({});
  const [aguardandoVerificacao, setAguardandoVerificacao] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [modoEnvio, setModoEnvio] = useState("");

  const carregarConexoes = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const resultado = await api.gateway.conexoes({ organizationId: organizacaoId });
      const lista = (resultado?.conexoes || []).filter((item) => item?.connectionId);
      setConexoes(lista);
      setConexaoId((atual) => (lista.some((item) => item.connectionId === atual) ? atual : lista[0]?.connectionId || ""));
      setModoEnvio(resultado?.gateway || "");
      if (!["online", "cloud"].includes(resultado?.gateway)) {
        setErro("A VPS não está disponível para enviar códigos agora. Aguarde o sinal do runtime e tente novamente.");
      }
    } catch (e) {
      setConexoes([]);
      setConexaoId("");
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [organizacaoId]);

  const carregarOperadores = useCallback(async () => {
    if (!conexaoId) {
      setOperadores([]);
      return;
    }
    try {
      const lista = await api.organizacoes.operadores({ connectionId: conexaoId });
      setOperadores(lista);
      const ativos = new Set(
        lista.filter((item) => item?.status === "active").map((item) => item.user_id),
      );
      setAguardandoVerificacao((atual) => Object.fromEntries(
        Object.entries(atual).filter(([usuarioId, expiraEm]) => (
          !ativos.has(usuarioId) && Number(expiraEm) > Date.now()
        )),
      ));
    } catch (e) {
      setErro(e.message);
      setOperadores([]);
    }
  }, [conexaoId]);

  useEffect(() => { carregarConexoes(); }, [carregarConexoes]);
  useEffect(() => { carregarOperadores(); }, [carregarOperadores]);
  useEffect(() => {
    if (!conexaoId) return undefined;
    const timer = window.setInterval(carregarOperadores, 5000);
    return () => window.clearInterval(timer);
  }, [carregarOperadores, conexaoId]);
  useEffect(() => {
    const plataformaWeb = typeof __EMYLEADS_PLATFORM__ !== "undefined" && __EMYLEADS_PLATFORM__ === "web";
    if (!plataformaWeb || !organizacaoId) return undefined;
    const aoMudar = (evento) => {
      if (evento.detail?.organizationId === organizacaoId && evento.detail?.topic === "operators") {
        carregarOperadores();
      }
    };
    window.addEventListener("emyleads:connections-changed", aoMudar);
    api.gateway.ativarRealtime({ organizationId: organizacaoId }).catch(() => {
      // A consulta periódica de cinco segundos permanece como fallback.
    });
    return () => window.removeEventListener("emyleads:connections-changed", aoMudar);
  }, [organizacaoId, carregarOperadores]);

  const aguardarEnvio = async (comandoId) => {
    for (let tentativa = 0; tentativa < 10; tentativa += 1) {
      if (tentativa > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
      const status = await api.organizacoes.statusVerificacaoOperador({ comandoId });
      if (["completed", "failed", "expired"].includes(status?.status)) return status;
    }
    return { status: "pending" };
  };

  const iniciar = async (membro) => {
    const codigoPais = paises[membro.user_id] || "BR";
    const telefone = telefoneOperadorE164(telefones[membro.user_id], codigoPais);
    if (!conexaoId || !telefone) return;
    setOcupado(membro.user_id);
    setErro("");
    setAviso("");
    try {
      const desafio = await api.organizacoes.iniciarVerificacaoOperador({
        connectionId: conexaoId,
        usuarioId: membro.user_id,
        telefone,
      });
      if (!desafio?.command_id) {
        throw new Error("O Supabase não criou a solicitação de verificação.");
      }
      const resultado = await aguardarEnvio(desafio.command_id);
      if (resultado?.status === "failed") {
        throw new Error("A VPS não conseguiu enviar o código pelo WhatsApp principal. Verifique a conexão e tente novamente.");
      }
      if (resultado?.status === "expired") {
        throw new Error("A solicitação expirou antes do envio. Tente gerar um novo código.");
      }
      setTelefones((atual) => ({ ...atual, [membro.user_id]: "" }));
      setAguardandoVerificacao((atual) => ({
        ...atual,
        [membro.user_id]: Date.now() + 10 * 60 * 1000,
      }));
      setAviso(resultado?.status === "completed"
        ? `Código enviado para ${membro.profile?.full_name || "o profissional"}. Ele deve responder pelo próprio WhatsApp ao número principal.`
        : `Solicitação entregue à VPS para ${membro.profile?.full_name || "o profissional"}. O painel atualizará quando o código for enviado.`);
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado("");
    }
  };

  const revogar = async (operador) => {
    const nome = operador.operator_name || "este operador";
    if (!confirm(`Revogar o acesso de ${nome} ao assistente do WhatsApp?`)) return;
    setOcupado(operador.id);
    setErro("");
    try {
      await api.organizacoes.revogarOperador({ operadorId: operador.id });
      await carregarOperadores();
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado("");
    }
  };

  const operadorDoMembro = (id) => operadores.find((item) => item.user_id === id && item.status === "active");
  const conexao = conexoes.find((item) => item.connectionId === conexaoId);

  return (
    <section className="mb-5 rounded-[12px] border border-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Smartphone size={16} className="text-accent-forte" />
            <h2 className="text-[13.5px] font-semibold text-fg">Operadores do WhatsApp principal</h2>
          </div>
          <p className="mt-1 max-w-[700px] text-[12px] text-sub">
            O número principal continua sendo o único que responde. Cada pessoa usa o próprio número apenas como identidade autorizada.
          </p>
          {modoEnvio === "cloud" && (
            <p className="mt-1 text-[11.5px] font-medium text-success">Envio protegido pela VPS Núcleo Major</p>
          )}
        </div>
        {conexoes.length > 0 && (
          <label className="min-w-[210px]">
            <span className="mb-1 block text-[11.5px] font-medium text-sub">Conexão</span>
            <select
              value={conexaoId}
              onChange={(e) => setConexaoId(e.target.value)}
              className="w-full rounded-[8px] border border-line bg-bg px-2.5 py-2 text-[12px] text-fg outline-none focus:border-accent"
            >
              {conexoes.map((item) => (
                <option key={item.connectionId} value={item.connectionId}>
                  {item.name || item.connection?.phoneMasked || "WhatsApp principal"}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {aviso && <p className="mt-3 rounded-[8px] bg-success/10 px-3 py-2 text-[12px] text-success">{aviso}</p>}
      {erro && <p className="mt-3 rounded-[8px] bg-danger/10 px-3 py-2 text-[12px] text-danger">{erro}</p>}
      {!carregando && !conexoes.length && !erro && (
        <p className="mt-3 text-[12px] text-faint">Nenhuma conexão ativa encontrada.</p>
      )}

      {conexao && (
        <div className="mt-4 divide-y divide-line rounded-[9px] border border-line">
          {membros.filter((membro) => membro.status === "active").map((membro) => {
            const operador = operadorDoMembro(membro.user_id);
            const nome = membro.profile?.full_name || "Profissional sem nome";
            return (
              <div key={membro.user_id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                <div className="min-w-[180px] flex-1">
                  <p className="text-[12.5px] font-medium text-fg">{nome}</p>
                  {operador ? (
                    <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-success">
                      <CheckCircle2 size={13} /> Verificado · •••• {operador.phone_e164.slice(-4)}
                    </p>
                  ) : (
                    <p className={`mt-0.5 text-[11.5px] ${aguardandoVerificacao[membro.user_id] ? "text-accent-forte" : "text-faint"}`}>
                      {aguardandoVerificacao[membro.user_id]
                        ? "Código enviado · aguardando confirmação"
                        : "Ainda não vinculado"}
                    </p>
                  )}
                </div>
                {operador ? (
                  <button
                    type="button"
                    disabled={!!ocupado}
                    onClick={() => revogar(operador)}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-line px-2.5 py-2 text-[11.5px] font-semibold text-danger hover:border-danger disabled:opacity-50"
                  >
                    <Ban size={13} /> Revogar
                  </button>
                ) : (
                  <div className="flex min-w-[360px] flex-1 items-end gap-2">
                    <label className="w-[150px] flex-none">
                      <span className="mb-1 block text-[11px] font-medium text-sub">País</span>
                      <select
                        value={paises[membro.user_id] || "BR"}
                        onChange={(e) => {
                          const codigo = e.target.value;
                          setPaises((atual) => ({ ...atual, [membro.user_id]: codigo }));
                          setTelefones((atual) => ({
                            ...atual,
                            [membro.user_id]: formatarTelefoneOperador(atual[membro.user_id], codigo),
                          }));
                        }}
                        className="w-full rounded-[8px] border border-line bg-bg px-2 py-2 text-[12px] text-fg outline-none focus:border-accent"
                        aria-label={`País do telefone de ${nome}`}
                      >
                        {PAISES_TELEFONE.map((pais) => (
                          <option key={pais.codigo} value={pais.codigo}>
                            {pais.bandeira} +{pais.ddi} {pais.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    <input
                      value={telefones[membro.user_id] || ""}
                      onChange={(e) => {
                        const codigo = paises[membro.user_id] || "BR";
                        setTelefones((atual) => ({
                          ...atual,
                          [membro.user_id]: formatarTelefoneOperador(e.target.value, codigo),
                        }));
                      }}
                      placeholder={paisDoTelefone(paises[membro.user_id] || "BR").placeholder}
                      inputMode="tel"
                      autoComplete="tel"
                      aria-label={`Telefone pessoal de ${nome}`}
                      className="min-w-0 flex-1 rounded-[8px] border border-line bg-bg px-2.5 py-2 text-[12px] text-fg outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      disabled={
                        !["online", "cloud"].includes(modoEnvio)
                        || ocupado === membro.user_id
                        || !telefoneOperadorE164(telefones[membro.user_id], paises[membro.user_id] || "BR")
                      }
                      onClick={() => iniciar(membro)}
                      className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent px-2.5 py-2 text-[11.5px] font-semibold text-white hover:bg-accent-forte disabled:opacity-50"
                    >
                      {ocupado === membro.user_id ? <LoaderCircle size={13} className="animate-spin" /> : <Smartphone size={13} />}
                      Enviar código
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function FormularioConvite({ aoConvidar, ocupado }) {
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState("member");

  const enviar = async (evento) => {
    evento.preventDefault();
    if (!email.trim()) return;
    if (await aoConvidar({ email, papel })) setEmail("");
  };

  return (
    <form onSubmit={enviar} className="mb-5 flex flex-wrap items-end gap-2.5">
      <label className="min-w-[240px] flex-1">
        <span className="mb-1 block text-[12px] font-medium text-sub">E-mail de quem entra</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="pessoa@empresa.com.br"
          className="w-full rounded-[9px] border border-line bg-bg px-3 py-2.5 text-[13.5px] text-fg outline-none transition-colors focus:border-accent"
        />
      </label>
      <label>
        <span className="mb-1 block text-[12px] font-medium text-sub">Entra como</span>
        <Seletor
          valor={papel}
          aoMudar={setPapel}
          opcoes={OPCOES_DE_PAPEL}
          rotuloVazio="Atendente"
        />
      </label>
      <BotaoPrimario type="submit" disabled={ocupado || !email.trim()}>
        {ocupado ? <LoaderCircle size={15} className="animate-spin" /> : <UserPlus size={15} />}
        Convidar
      </BotaoPrimario>
    </form>
  );
}

function ResponsabilidadeMembro({ membro, editavel, ocupado, aoSalvar }) {
  const [valor, setValor] = useState(membro.responsibility || "");
  const alterada = valor.trim() !== String(membro.responsibility || "").trim();

  useEffect(() => setValor(membro.responsibility || ""), [membro.responsibility]);

  if (!editavel) {
    return (
      <div className="border-t border-line px-5 py-3 text-[12.5px] text-sub">
        <span className="font-medium text-fg">Responsabilidade para a IA:</span>{" "}
        {membro.responsibility || "Ainda não definida."}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (alterada) aoSalvar(membro.user_id, valor); }}
      className="flex flex-wrap items-end gap-2 border-t border-line px-5 py-3"
    >
      <label className="min-w-[260px] flex-1">
        <span className="mb-1 block text-[11.5px] font-medium text-sub">Responsabilidade para a IA</span>
        <input
          value={valor}
          maxLength={1000}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Ex.: cuida das vendas, propostas e retorno dos leads"
          className="w-full rounded-[8px] border border-line bg-bg px-3 py-2 text-[12.5px] text-fg outline-none focus:border-accent"
        />
      </label>
      <button
        type="submit"
        disabled={!alterada || ocupado}
        className="cursor-pointer rounded-[8px] border border-line px-3 py-2 text-[12px] font-semibold text-sub hover:border-accent hover:text-accent-forte disabled:cursor-default disabled:opacity-40"
      >
        Salvar responsabilidade
      </button>
    </form>
  );
}

function LinhaMembro({ membro, meuPapel, meuId, aoMudarPapel, aoSalvarResponsabilidade, aoRemover, ocupado }) {
  const nome = membro.profile?.full_name?.trim();
  const souEu = membro.user_id === meuId;
  const removivel = podeRemover(meuPapel, membro, meuId);
  // Dono não ganha seletor nem para outro dono: promover alguém a dono é
  // transferência de organização, um fluxo que ainda não existe.
  const editavel = podeMudarPapel(meuPapel) && membro.role !== "owner";

  return (
    <div className="border-b border-line last:border-b-0">
      <div className={`${COLUNAS} px-5 py-3.5`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <Iniciais nome={nome || "?"} tamanho={30} />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-fg">
            {nome || "Sem nome no perfil"}
            {souEu && <span className="ml-1.5 text-[11.5px] font-normal text-faint">(você)</span>}
          </p>
          <p className="truncate text-[12px] text-sub">
            {membro.status === "active" ? "Ativo" : "Suspenso"} · entrou{" "}
            {fmtRelativo(membro.joined_at)}
          </p>
        </div>
      </div>

      <div className="min-w-0">
        {editavel ? (
          <Seletor
            valor={membro.role}
            aoMudar={(papel) => aoMudarPapel(membro.user_id, papel)}
            opcoes={OPCOES_DE_PAPEL}
            rotuloVazio="Atendente"
            compacto
          />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-fg">
            {membro.role === "owner" && <ShieldCheck size={14} className="text-accent-forte" />}
            {textoDoPapel(membro.role)}
          </span>
        )}
      </div>

      <span className="truncate text-[12.5px] text-sub">{DESCRICAO_DO_PAPEL[membro.role]}</span>

      <div className="flex justify-end">
        {removivel && (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => aoRemover(membro)}
            title="Remover da equipe"
            className="rounded-[8px] p-1.5 text-sub transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      </div>
      <ResponsabilidadeMembro
        membro={membro}
        editavel={podeGerenciarEquipe(meuPapel)}
        ocupado={ocupado}
        aoSalvar={aoSalvarResponsabilidade}
      />
    </div>
  );
}

export default function Equipe({ sessao }) {
  const [membros, setMembros] = useState(null);
  const [convites, setConvites] = useState(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [convite, setConvite] = useState(null);

  const organizacao = sessao?.organizacaoAtual;
  const meuPapel = organizacao?.papel;
  const meuId = sessao?.usuario?.id;
  const gerencia = podeGerenciarEquipe(meuPapel);

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

  const reenviarConvite = async (convite) => {
    setOcupado(true);
    setErro("");
    try {
      setConvite(await api.organizacoes.reenviarConvite({ conviteId: convite.invite_id }));
      await carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const cancelarConvite = async (convite) => {
    if (!confirm(`Cancelar o convite enviado para ${convite.invited_email}?`)) return;
    setOcupado(true);
    setErro("");
    try {
      await api.organizacoes.cancelarConvite({ conviteId: convite.invite_id });
      await carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
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

  const remover = async (membro) => {
    const nome = membro.profile?.full_name?.trim() || "esta pessoa";
    if (!confirm(`Remover ${nome} da equipe? Ela perde o acesso ao CRM desta empresa.`)) return;
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

  return (
    <>
      <CabecalhoTela titulo="Equipe" />
      <div className="min-h-0 flex-1 overflow-auto px-8 pb-10">
        {!organizacao ? (
          <EstadoVazio
            titulo="Nenhuma empresa selecionada"
            descricao="Escolha uma empresa no rodapé da barra lateral para ver a equipe dela."
          />
        ) : (
          <>
            <p className="mb-5 text-[13px] text-sub">
              Quem tem acesso ao CRM de{" "}
              <strong className="font-semibold text-fg">{organizacao.name}</strong>. O acesso é por
              empresa: a mesma pessoa pode ser administradora aqui e atendente em outra.
            </p>

            {convite && <ConviteCriado convite={convite} aoFechar={() => setConvite(null)} />}

            {erro && (
              <div className="mb-4 rounded-[10px] border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger">
                {erro}
              </div>
            )}

            {gerencia && <FormularioConvite aoConvidar={convidar} ocupado={ocupado} />}

            {gerencia && (
              <ListaConvites
                convites={convites}
                ocupado={ocupado}
                aoReenviar={reenviarConvite}
                aoCancelar={cancelarConvite}
              />
            )}

            {gerencia && <OperadoresWhatsApp organizacaoId={organizacao.id} membros={membros || []} />}

            <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
              <div
                className={`${COLUNAS} border-b border-line px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-faint`}
              >
                <span>Pessoa</span>
                <span>Papel</span>
                <span>Pode</span>
                <span />
              </div>

              {membros === null ? (
                <div className="px-5 py-8 text-center text-[13px] text-sub">Carregando…</div>
              ) : membros.length === 0 ? (
                <EstadoVazio
                  titulo="Ninguém na equipe ainda"
                  descricao="Convide alguém pelo e-mail acima."
                />
              ) : (
                membros.map((membro) => (
                  <LinhaMembro
                    key={membro.user_id}
                    membro={membro}
                    meuPapel={meuPapel}
                    meuId={meuId}
                    aoMudarPapel={mudarPapel}
                    aoSalvarResponsabilidade={salvarResponsabilidade}
                    aoRemover={remover}
                    ocupado={ocupado}
                  />
                ))
              )}
            </div>

            {!gerencia && (
              <p className="mt-3 text-[12.5px] text-faint">
                Só o dono e os administradores convidam ou removem pessoas.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
