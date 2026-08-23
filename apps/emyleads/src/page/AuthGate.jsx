import { useEffect, useState } from "react";
import { Building2, LoaderCircle, Ticket } from "lucide-react";
import { api } from "../data/client";
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

function Acesso({ aoAutenticar }) {
  const [modo, setModo] = useState("entrar");
  const [form, setForm] = useState({ nome: "", email: "", senha: "" });
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
        : await api.auth.cadastrar(form);
      if (resposta?.confirmacaoPendente) {
        setConfirmacao(`Enviamos a confirmação para ${resposta.email}.`);
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
function SemOrganizacao({ aoEntrar }) {
  const [aba, setAba] = useState("criar");

  return (
    <Moldura
      titulo={aba === "criar" ? "Crie seu espaço de trabalho" : "Entrar com um convite"}
      descricao={
        aba === "criar"
          ? "Contatos, funil e tarefas ficarão separados por empresa."
          : "Cole o código que a pessoa que administra a empresa enviou para você."
      }
    >
      <div className="mt-5 flex gap-1 rounded-[9px] bg-surface p-1">
        {[
          { id: "criar", rotulo: "Criar empresa", icone: Building2 },
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

      {aba === "criar" ? <FormCriarEmpresa aoCriar={aoEntrar} /> : <FormConvite aoAceitar={aoEntrar} />}
    </Moldura>
  );
}

function FormCriarEmpresa({ aoCriar }) {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async (evento) => {
    evento.preventDefault();
    setEnviando(true);
    setErro("");
    try {
      await aoCriar(await api.organizacoes.criar({ nome }));
    } catch (e) {
      setErro(e?.message || "Não foi possível criar a empresa.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="mt-4 space-y-3.5">
      <Campo rotulo="Nome da empresa" autoFocus required minLength={2} value={nome}
        placeholder="Ex.: Núcleo Major" onChange={(e) => setNome(e.target.value)} />
      {erro && <div role="alert" className="rounded-[8px] bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{erro}</div>}
      <BotaoPrimario type="submit" disabled={enviando} className="w-full justify-center !py-2.5">
        {enviando ? "Criando…" : "Criar empresa"}
      </BotaoPrimario>
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

  const carregar = async (novoEstado) => {
    try {
      const proximo = novoEstado === undefined ? await api.auth.estado() : novoEstado;
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
  if (!estado) return <Acesso aoAutenticar={carregar} />;
  if (!estado.organizacaoAtual) return <SemOrganizacao aoEntrar={carregar} />;
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
