import { useEffect, useState } from "react";
import { Building2, LoaderCircle, Ticket } from "lucide-react";
import { api } from "../data/client";
import { ativacaoGuardada, esquecerAtivacao, lerAtivacaoDaUrl, linkDeCompra, linkDeRetorno } from "./ativacao";
import { BotaoPrimario, Marca } from "./ui";

function Campo({ rotulo, ...props }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-sub">{rotulo}</span>
      <input
        {...props}
        className="w-full rounded-[9px] border border-line bg-bg px-3.5 py-2.5 text-[14px] text-fg outline-none transition-colors placeholder:text-faint focus:border-accent"
      />
    </label>
  );
}

function Moldura({ titulo, descricao, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-5 text-fg">
      <div className="w-full max-w-[390px]">
        <div className="mb-5 flex justify-center"><Marca tamanho={38} /></div>
        <section className="rounded-[14px] border border-line bg-bg p-6 shadow-[0_18px_55px_rgba(18,23,48,0.08)]">
          <h1 className="text-[20px] font-semibold tracking-tight">{titulo}</h1>
          <p className="mt-1.5 text-[13px] leading-5 text-sub">{descricao}</p>
          {children}
        </section>
      </div>
    </div>
  );
}

function Acesso({ aoAutenticar, ativacao = null }) {
  // Quem chega pelo link de ativação ainda não tem conta: começa em "Criar
  // conta", com o e-mail da compra já preenchido.
  const [modo, setModo] = useState(ativacao ? "cadastrar" : "entrar");
  const [form, setForm] = useState({ nome: "", email: ativacao?.email || "", senha: "" });
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");

  const enviar = async (evento) => {
    evento.preventDefault();
    setErro("");
    setConfirmacao("");
    setEnviando(true);
    try {
      const resposta = modo === "entrar"
        ? await api.auth.entrar({ email: form.email, senha: form.senha })
        : await api.auth.cadastrar({ ...form, redirectTo: linkDeRetorno(ativacao) });
      if (resposta?.confirmacaoPendente) {
        setConfirmacao(
          ativacao
            ? `Enviamos a confirmação para ${resposta.email}. Abra o link do e-mail para continuar a ativação.`
            : `Enviamos a confirmação para ${resposta.email}.`,
        );
      } else {
        await aoAutenticar(resposta);
      }
    } catch (e) {
      setErro(e?.message || "Não foi possível continuar.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Moldura
      titulo={modo === "entrar" ? "Entre na sua gestão" : "Crie sua conta"}
      descricao="Sua base fica protegida e sincronizada entre seus dispositivos."
    >
      {ativacao && (
        <div className="mt-4 rounded-[9px] border border-success/25 bg-success-soft px-3.5 py-3 text-[12.5px] leading-5 text-success">
          Pagamento confirmado. {modo === "cadastrar" ? "Crie sua conta" : "Entre"} com
          {ativacao.email ? <> <strong>{ativacao.email}</strong></> : " o e-mail da compra"} para ativar sua empresa.
        </div>
      )}
      <form onSubmit={enviar} className="mt-5 space-y-3.5">
        {modo === "cadastrar" && (
          <Campo rotulo="Seu nome" autoComplete="name" required value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        )}
        <Campo rotulo="E-mail" type="email" autoComplete="email" required value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Campo rotulo="Senha" type="password" minLength={8}
          autoComplete={modo === "entrar" ? "current-password" : "new-password"}
          required value={form.senha}
          onChange={(e) => setForm({ ...form, senha: e.target.value })} />

        {erro && <div role="alert" className="rounded-[8px] bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{erro}</div>}
        {confirmacao && <div className="rounded-[8px] bg-success-soft px-3 py-2 text-[12.5px] text-success">{confirmacao}</div>}

        <BotaoPrimario type="submit" disabled={enviando} className="w-full justify-center !py-2.5">
          {enviando && <LoaderCircle size={16} className="animate-spin" />}
          {enviando ? "Aguarde…" : modo === "entrar" ? "Entrar" : "Criar conta"}
        </BotaoPrimario>
      </form>

      <button type="button" onClick={() => { setModo(modo === "entrar" ? "cadastrar" : "entrar"); setErro(""); }}
        className="mt-4 w-full cursor-pointer text-center text-[13px] font-medium text-accent-forte hover:underline">
        {modo === "entrar" ? "Ainda não tenho uma conta" : "Já tenho uma conta"}
      </button>
    </Moldura>
  );
}

/**
 * Sem organização, existem dois caminhos — e antes só existia um.
 *
 * Quem chega convidado não quer criar empresa nenhuma: quer entrar na de quem
 * convidou. Enquanto esta tela só oferecia "criar empresa", o convite gerado
 * na tela de Equipe era um código sem porta — a pessoa criava uma empresa
 * vazia e ficava presa nela, sem sinal de que tinha errado o caminho.
 */
function SemOrganizacao({ aoEntrar, ativacao = null }) {
  const [aba, setAba] = useState("ativar");

  return (
    <Moldura
      titulo={aba === "ativar" ? "Ative sua empresa" : "Entrar com um convite"}
      descricao={
        aba === "ativar"
          ? "Use a liberação recebida para ativar o plano da sua organização."
          : "Cole o código que a pessoa que administra a empresa enviou para você."
      }
    >
      <div className="mt-5 flex gap-1 rounded-[9px] bg-surface p-1">
        {[
          { id: "ativar", rotulo: "Ativar empresa", icone: Building2 },
          { id: "convite", rotulo: "Tenho um convite", icone: Ticket },
        ].map(({ id, rotulo, icone: Icone }) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-[7px] px-3 py-2 text-[12.5px] font-medium transition-colors ${
              aba === id ? "bg-bg text-fg shadow-[0_1px_3px_rgba(18,23,48,0.10)]" : "text-sub hover:text-fg"
            }`}
          >
            <Icone size={14} />
            {rotulo}
          </button>
        ))}
      </div>

      {aba === "ativar"
        ? <FormCriarEmpresa aoCriar={aoEntrar} codigoInicial={ativacao?.codigo || ""} />
        : <FormConvite aoAceitar={aoEntrar} />}
    </Moldura>
  );
}

function FormCriarEmpresa({ aoCriar, codigoInicial = "" }) {
  const [nome, setNome] = useState("");
  const [codigo, setCodigo] = useState(codigoInicial);
  const compra = linkDeCompra();
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async (evento) => {
    evento.preventDefault();
    setEnviando(true);
    setErro("");
    try {
      const criada = await api.organizacoes.criar({ nome, codigo });
      esquecerAtivacao();
      await aoCriar(criada);
    } catch (e) {
      const mensagem = e?.message || "";
      if (/invalid or expired/i.test(mensagem)) {
        setErro("Código de ativação inválido ou vencido. Solicite uma nova liberação.");
      } else if (/another email/i.test(mensagem)) {
        setErro("Esse código foi emitido para outro e-mail.");
      } else {
        setErro(mensagem || "Não foi possível ativar a empresa.");
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="mt-4 space-y-3.5">
      <Campo rotulo="Nome da empresa" autoFocus required minLength={2} value={nome}
        placeholder="Ex.: Núcleo Major" onChange={(e) => setNome(e.target.value)} />
      <Campo rotulo="Código de ativação" required minLength={8} value={codigo}
        placeholder="NM12-3456-7890-AB" spellCheck={false} autoCapitalize="characters"
        onChange={(e) => setCodigo(e.target.value.toUpperCase())} />
      <div className="rounded-[9px] border border-line bg-surface px-3.5 py-3">
        <div className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="font-semibold text-fg">Plano contratado</span>
          <span className="rounded-full bg-accent/10 px-2 py-0.5 font-medium text-accent-forte">Código do e-mail</span>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-4 text-sub">
          O código chega no e-mail da compra e vale para a conta com esse mesmo e-mail.
        </p>
      </div>
      {erro && <div role="alert" className="rounded-[8px] bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{erro}</div>}
      <BotaoPrimario type="submit" disabled={enviando || !codigo.trim()} className="w-full justify-center !py-2.5">
        {enviando ? "Ativando…" : "Ativar minha empresa"}
      </BotaoPrimario>
      <p className="text-center text-[11.5px] leading-4 text-faint">
        {compra ? (
          <>Ainda não assinou? <a href={compra} target="_blank" rel="noreferrer" className="font-medium text-accent-forte hover:underline">Assine o Núcleo Major</a>.</>
        ) : (
          "Ainda não tem uma liberação? Fale com a equipe do Núcleo Major."
        )}
      </p>
    </form>
  );
}

function FormConvite({ aoAceitar }) {
  const [token, setToken] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async (evento) => {
    evento.preventDefault();
    setEnviando(true);
    setErro("");
    try {
      await aoAceitar(await api.organizacoes.aceitarConvite({ token }));
    } catch (e) {
      // O banco recusa código inválido e código vencido com a mesma exceção, e
      // está certo: distinguir os dois contaria a quem tenta adivinhar se
      // aquele código já existiu.
      setErro(
        /invalid or expired/i.test(e?.message || "")
          ? "Código inválido ou vencido. Peça um novo para quem administra a empresa."
          : e?.message || "Não foi possível usar este convite."
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="mt-4 space-y-3.5">
      <Campo rotulo="Código do convite" autoFocus required minLength={8} value={token}
        placeholder="Cole aqui o código recebido" spellCheck={false}
        onChange={(e) => setToken(e.target.value)} />
      {erro && <div role="alert" className="rounded-[8px] bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{erro}</div>}
      <BotaoPrimario type="submit" disabled={enviando || !token.trim()} className="w-full justify-center !py-2.5">
        {enviando ? "Entrando…" : "Entrar na empresa"}
      </BotaoPrimario>
      <p className="text-[11.5px] leading-4 text-faint">
        O convite vale por 7 dias e só serve uma vez. Quem administra a empresa decide se você
        entra como atendente ou administrador.
      </p>
    </form>
  );
}

const MOTIVO_DO_BLOQUEIO = {
  past_due: "O pagamento está em atraso há mais de 7 dias.",
  suspended: "A assinatura foi suspensa depois de um estorno ou contestação do pagamento.",
  canceled: "A assinatura desta empresa foi cancelada e o período pago terminou.",
};

/**
 * Empresa sem assinatura válida. Os dados continuam guardados — o que fecha é
 * a porta. Trocar de empresa e sair continuam possíveis, para quem participa
 * de mais de uma não ficar preso na que venceu.
 */
function AssinaturaBloqueada({ estado, aoTrocar, aoSair }) {
  const [erro, setErro] = useState("");
  const organizacao = estado.organizacaoAtual;
  const dono = organizacao.papel === "owner";
  const compra = linkDeCompra();
  const outras = estado.organizacoes.filter((org) => org.id !== organizacao.id);

  const agir = async (acao) => {
    setErro("");
    try {
      await acao();
    } catch (e) {
      setErro(e?.message || "Não foi possível concluir.");
    }
  };

  return (
    <Moldura
      titulo={`${organizacao.name}: acesso suspenso`}
      descricao={MOTIVO_DO_BLOQUEIO[estado.acesso?.status] || "Esta empresa está sem uma assinatura ativa."}
    >
      <p className="mt-4 text-[13px] leading-5 text-sub">
        {dono
          ? "Seus dados continuam guardados. Regularize o pagamento pelo link de cobrança que o Asaas enviou para o seu e-mail — o acesso volta sozinho assim que ele for confirmado."
          : "Seus dados continuam guardados. Fale com quem administra a empresa para regularizar a assinatura."}
      </p>
      {dono && compra && (
        <a href={compra} target="_blank" rel="noreferrer"
          className="mt-5 inline-flex w-full items-center justify-center rounded-[10px] bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-white hover:opacity-95">
          Assinar novamente
        </a>
      )}
      {outras.length > 0 && (
        <div className="mt-5 space-y-1.5">
          <p className="text-[11.5px] font-medium text-faint">Entrar em outra empresa</p>
          {outras.map((org) => (
            <button key={org.id} type="button" onClick={() => agir(() => aoTrocar(org.id))}
              className="w-full cursor-pointer rounded-[9px] border border-line px-3.5 py-2.5 text-left text-[13px] font-medium text-fg hover:bg-surface-hover">
              {org.name}
            </button>
          ))}
        </div>
      )}
      {erro && <div role="alert" className="mt-3 rounded-[8px] bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{erro}</div>}
      <button type="button" onClick={() => agir(aoSair)}
        className="mt-4 w-full cursor-pointer rounded-[10px] px-5 py-2.5 text-[13px] font-medium text-sub transition-colors hover:bg-surface-hover hover:text-fg">
        Sair
      </button>
    </Moldura>
  );
}

function MigrarDados({ status, aoConcluir, aoAdiar }) {
  const [enviando, setEnviando] = useState(false);
  const [adiando, setAdiando] = useState(false);
  const [erro, setErro] = useState("");
  const pendentes = status.fotosPendentes || 0;
  const progresso = status.progresso;
  const percentual = progresso?.total ? Math.min(100, Math.round((progresso.processado / progresso.total) * 100)) : 0;
  const etapa = {
    snapshot: "preparando cópia segura",
    stages: "estágios",
    tags: "tags",
    contacts: "contatos",
    deals: "negócios",
    tasks: "tarefas",
    notes: "notas",
    events: "histórico",
    contactTags: "vínculos de tags",
    photos: "fotos",
    validate: "validação final",
    complete: "concluída",
  }[status.etapa] || status.etapa;

  const migrar = async () => {
    setEnviando(true);
    setErro("");
    try {
      await api.sync.migrarLegado({ confirmado: true });
      await aoConcluir();
    } catch (e) {
      setErro(e?.message || "Não foi possível concluir a migração.");
    } finally {
      setEnviando(false);
    }
  };

  const entrarNoPainel = async () => {
    setAdiando(true);
    setErro("");
    try {
      // A decisão fica salva por usuário e organização. O snapshot permanece
      // disponível para retomada, sem bloquear o restante do app.
      await aoAdiar();
    } catch (e) {
      setErro(e?.message || "Não foi possível adiar a migração.");
    } finally {
      setAdiando(false);
    }
  };

  const linhas = [
    ["Contatos", status.totais.contatos], ["Negócios", status.totais.negocios],
    ["Tarefas", status.totais.tarefas], ["Notas", status.totais.notas],
    ["Estágios", status.totais.estagios], ["Tags", status.totais.tags],
    ["Histórico", status.totais.eventos || 0],
  ];

  return (
    <Moldura
      titulo="Levar seus dados para a nuvem?"
      descricao="Encontramos dados locais neste navegador. Eles serão copiados para sua empresa e permanecerão disponíveis aqui."
    >
      <div className="mt-5 divide-y divide-line rounded-[9px] border border-line">
        {linhas.map(([nome, total]) => (
          <div key={nome} className="flex items-center justify-between px-3.5 py-2.5 text-[13px]">
            <span className="text-sub">{nome}</span><span className="font-semibold text-fg">{total}</span>
          </div>
        ))}
      </div>
      {progresso && progresso.status !== "concluido" && (
        <div className="mt-4 rounded-[9px] border border-line bg-surface px-3.5 py-3">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-sub">Progresso salvo · {etapa || "preparando"}</span>
            <span className="font-semibold text-fg">{percentual}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percentual}%` }} />
          </div>
          <p className="mt-2 text-[11px] leading-4 text-faint">Se a conexão cair, o próximo clique continua deste snapshot.</p>
        </div>
      )}
      {status.erro && <div role="alert" className="mt-3 rounded-[8px] bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{status.erro}</div>}
      {erro && <div role="alert" className="mt-3 rounded-[8px] bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{erro}</div>}
      <BotaoPrimario onClick={migrar} disabled={enviando} className="mt-5 w-full justify-center !py-2.5">
        {enviando ? "Migrando dados…" : "Migrar agora"}
      </BotaoPrimario>
      <button type="button" onClick={entrarNoPainel} disabled={enviando || adiando} className="mt-2 w-full cursor-pointer rounded-[10px] px-5 py-2.5 text-[13px] font-medium text-sub transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40">
        {adiando ? "Salvando escolha…" : "Entrar no painel e migrar depois"}
      </button>
      <p className="mt-3 text-center text-[11.5px] leading-4 text-faint">
        A base local original não será apagada{pendentes ? ` · ${pendentes} foto(s) serão validadas no processo` : ""}.
      </p>
    </Moldura>
  );
}

export default function AuthGate({ children }) {
  const [estado, setEstado] = useState(undefined);
  const [migracao, setMigracao] = useState(undefined);
  const [controleMigracao, setControleMigracao] = useState(null);
  const [adiarMigracao, setAdiarMigracao] = useState(false);
  const [erro, setErro] = useState("");
  // Lido uma vez, na abertura: o link do e-mail de ativação, ou o que ficou
  // guardado nesta aba de uma volta anterior (confirmação de e-mail).
  const [ativacao] = useState(() => lerAtivacaoDaUrl() || ativacaoGuardada());

  const carregar = async (novoEstado) => {
    try {
      let proximo = novoEstado === undefined ? await api.auth.estado() : novoEstado;
      if (proximo?.organizacaoAtual) {
        // Falha ao ler a assinatura não tranca ninguém: a trava de verdade
        // mora no banco, e um soluço de rede não pode virar tela de bloqueio.
        const acesso = await api.organizacoes
          .acesso({ id: proximo.organizacaoAtual.id })
          .catch(() => ({ estado: "ok", desconhecido: true, recursos: null }));
        proximo = { ...proximo, acesso };
      }
      setEstado(proximo);
      if (proximo?.organizacaoAtual) {
        const podeMigrar = proximo.organizacaoAtual.papel === "owner";
        const status = podeMigrar
          ? await api.sync.migracaoStatus()
          : { temDados: false, concluida: true, totais: {} };
        let controle = null;
        if (podeMigrar) {
          controle = await api.auth.migracaoControle({
            organizationId: proximo.organizacaoAtual.id,
            acao: "ler",
          });
          if (status.temDados && !status.concluida && !controle.origem) {
            controle = await api.auth.migracaoControle({
              organizationId: proximo.organizacaoAtual.id,
              acao: "registrar-origem",
            });
          }
        }
        setAdiarMigracao(false);
        setControleMigracao(controle);
        setMigracao(status);
      } else {
        setAdiarMigracao(false);
        setControleMigracao(null);
        setMigracao(null);
      }
      setErro("");
    } catch (e) {
      setErro(e?.message || "Não foi possível verificar sua sessão.");
    }
  };

  useEffect(() => { carregar(); }, []);

  if (erro) {
    return (
      <Moldura titulo="Não foi possível abrir a gestão" descricao={erro}>
        <BotaoPrimario className="mt-5 w-full justify-center !py-2.5" onClick={() => carregar()}>
          Tentar novamente
        </BotaoPrimario>
      </Moldura>
    );
  }
  if (estado === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-surface text-accent"><LoaderCircle className="animate-spin" /></div>;
  }
  if (!estado) return <Acesso aoAutenticar={carregar} ativacao={ativacao} />;
  if (!estado.organizacaoAtual) return <SemOrganizacao aoEntrar={carregar} ativacao={ativacao} />;
  if (estado.acesso?.estado === "blocked") {
    return <AssinaturaBloqueada
      estado={estado}
      aoTrocar={async (id) => carregar(await api.organizacoes.selecionar({ id }))}
      aoSair={async () => {
        await api.auth.sair();
        await carregar(null);
      }}
    />;
  }
  if (migracao === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-surface text-accent"><LoaderCircle className="animate-spin" /></div>;
  }

  const organizacao = estado.organizacaoAtual;
  const origemDesteUsuario = controleMigracao?.origem?.userId === estado.usuario?.id
    && controleMigracao?.origem?.organizationId === organizacao.id;
  const donoDaMigracao = organizacao.papel === "owner" && origemDesteUsuario;
  const migracaoAdiada = controleMigracao?.preferencia?.status === "adiada";
  const migracaoPendente = donoDaMigracao && migracao.temDados && !migracao.concluida
    ? { status: migracao, adiada: migracaoAdiada || adiarMigracao }
    : null;

  if (migracaoPendente && !migracaoPendente.adiada) {
    return <MigrarDados
      status={migracao}
      aoConcluir={() => carregar()}
      aoAdiar={async () => {
        const controle = await api.auth.migracaoControle({ organizationId: organizacao.id, acao: "adiar" });
        setControleMigracao(controle);
        setAdiarMigracao(true);
      }}
    />;
  }

  const contextoMigracao = migracaoPendente?.adiada
    ? {
      status: migracaoPendente.status,
      aoReabrir: async () => {
        const controle = await api.auth.migracaoControle({ organizationId: organizacao.id, acao: "reabrir" });
        setControleMigracao(controle);
        setAdiarMigracao(false);
      },
    }
    : null;

  return children(estado, carregar, contextoMigracao);
}
