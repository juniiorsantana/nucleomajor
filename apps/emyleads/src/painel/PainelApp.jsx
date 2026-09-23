import { useCallback, useEffect, useState } from "react";
import { Building2, Cable, History, KeyRound, LogOut, Receipt, ShieldAlert } from "lucide-react";
import { api } from "../data/client";
import { BotaoPrimario, Marca, Rail } from "../page/ui";
import { ENTRADA_PAINEL, LiberarAcesso, PedidosDeConexao, VendasDoAsaas } from "./administracao";
import Empresas from "./telas/Empresas";
import Empresa from "./telas/Empresa";
import Historico from "./telas/Historico";

/**
 * O painel da plataforma: painel.nucleomajor.com.
 *
 * Outro subdomínio é outro `localStorage`, então a sessão daqui não se mistura
 * com a do app — a mesma pessoa pode estar logada como cliente no app e como
 * administração aqui. Quem entra e não está em `platform_admins` vê "Acesso
 * restrito"; a trava de verdade é o banco, que recusa toda função `platform_*`
 * para quem não é da administração.
 */

export const TELAS_DO_PAINEL = [
  { id: "empresas", rotulo: "Empresas", icone: Building2, grupo: "Clientes" },
  { id: "liberar", rotulo: "Liberar acesso", icone: KeyRound, grupo: "Clientes" },
  { id: "vendas", rotulo: "Vendas do Asaas", icone: Receipt, grupo: "Operação" },
  { id: "whatsapp", rotulo: "Pedidos de WhatsApp", icone: Cable, grupo: "Operação" },
  { id: "historico", rotulo: "Histórico", icone: History, grupo: "Operação" },
];

/** `/empresas/<id>` → `{ tela: "empresa", id }`; o resto pelo primeiro trecho. */
export function rotaDoCaminho(caminho) {
  const partes = String(caminho || "/").split("/").filter(Boolean);
  if (partes[0] === "empresas" && partes[1]) return { tela: "empresa", id: partes[1] };
  const tela = TELAS_DO_PAINEL.find((item) => item.id === partes[0])?.id;
  return { tela: tela || "empresas", id: null };
}

export function caminhoDaRota({ tela, id }) {
  if (tela === "empresa" && id) return `/empresas/${id}`;
  return tela === "empresas" ? "/" : `/${tela}`;
}

function Entrar({ aoEntrar }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  const enviar = async (evento) => {
    evento.preventDefault();
    setEntrando(true);
    setErro("");
    try {
      await api.auth.entrar({ email, senha });
      await aoEntrar();
    } catch (e) {
      setErro(e?.message || "Não foi possível entrar.");
      setEntrando(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface p-4">
      <form onSubmit={enviar} className="w-full max-w-[380px] rounded-[16px] border border-line bg-bg p-6 shadow-sm">
        <Marca tamanho={32} />
        <h1 className="mt-5 text-[18px] font-semibold text-fg">Painel da plataforma</h1>
        <p className="mt-1 text-[12.5px] text-sub">Só para a administração do Núcleo Major.</p>
        <label className="mt-5 block">
          <span className="mb-1.5 block text-[12px] font-medium text-sub">E-mail</span>
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
            className={`${ENTRADA_PAINEL} w-full !py-2.5`} />
        </label>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-[12px] font-medium text-sub">Senha</span>
          <input type="password" required autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)}
            className={`${ENTRADA_PAINEL} w-full !py-2.5`} />
        </label>
        {erro && <p role="alert" className="mt-3 text-[12.5px] text-danger">{erro}</p>}
        <BotaoPrimario type="submit" disabled={entrando} className="mt-5 w-full">
          {entrando ? "Entrando…" : "Entrar"}
        </BotaoPrimario>
      </form>
    </main>
  );
}

function AcessoRestrito({ email, aoSair }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface p-4">
      <section className="w-full max-w-[420px] rounded-[16px] border border-line bg-bg p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
          <ShieldAlert size={22} aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-[18px] font-semibold text-fg">Acesso restrito</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-sub">
          Este painel é só da administração do Núcleo Major.
          {email ? <> Você entrou como <strong className="text-fg">{email}</strong>.</> : null}
        </p>
        <button type="button" onClick={aoSair}
          className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-[10px] border border-line px-4 py-2 text-[13px] font-semibold text-sub hover:text-fg">
          <LogOut size={15} /> Sair
        </button>
      </section>
    </main>
  );
}

function Cartao({ titulo, children }) {
  return (
    <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <h1 className="text-[20px] font-semibold tracking-tight text-fg md:text-[24px]">{titulo}</h1>
        {children}
      </div>
    </div>
  );
}

export default function PainelApp({ caminho = "/", aoNavegar = () => {} }) {
  const [fase, setFase] = useState("carregando"); // carregando | entrar | restrito | ok | erro
  const [usuario, setUsuario] = useState(null);
  const [erro, setErro] = useState("");
  const rota = rotaDoCaminho(caminho);

  const conferir = useCallback(async () => {
    try {
      const sessao = await api.auth.estado();
      if (!sessao?.usuario) {
        setUsuario(null);
        setFase("entrar");
        return;
      }
      setUsuario(sessao.usuario);
      const { administrador } = await api.plataforma.estado();
      setFase(administrador ? "ok" : "restrito");
    } catch (e) {
      setErro(e?.message || "Não foi possível conferir o acesso.");
      setFase("erro");
    }
  }, []);

  useEffect(() => { conferir(); }, [conferir]);

  const sair = async () => {
    try {
      await api.auth.sair();
    } finally {
      setUsuario(null);
      setFase("entrar");
    }
  };

  const ir = useCallback((proxima) => aoNavegar(caminhoDaRota(proxima)), [aoNavegar]);

  if (fase === "carregando") {
    return <main className="flex min-h-dvh items-center justify-center bg-surface text-[13px] text-sub">Carregando…</main>;
  }
  if (fase === "erro") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-surface p-4">
        <p role="alert" className="max-w-md text-center text-[13px] text-danger">{erro}</p>
      </main>
    );
  }
  if (fase === "entrar") return <Entrar aoEntrar={conferir} />;
  if (fase === "restrito") return <AcessoRestrito email={usuario?.email} aoSair={sair} />;

  const ativa = rota.tela === "empresa" ? "empresas" : rota.tela;

  return (
    <div className="portal-shell flex h-dvh bg-surface text-fg">
      <div className="w-0 flex-none md:w-60">
        <Rail
          telas={TELAS_DO_PAINEL}
          ativa={ativa}
          aoTrocar={(tela) => ir({ tela })}
          rodape={
            <div className="flex items-center gap-2 rounded-[12px] border border-line px-3 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[12px] text-sub" title={usuario?.email}>{usuario?.email}</span>
              <button type="button" onClick={sair} title="Sair" aria-label="Sair"
                className="flex-none cursor-pointer rounded-[7px] p-1 text-sub hover:bg-danger/10 hover:text-danger">
                <LogOut size={15} />
              </button>
            </div>
          }
        />
      </div>
      <main className="portal-main flex min-h-0 min-w-0 flex-1 flex-col">
        {rota.tela === "empresas" && <Empresas aoAbrir={(id) => ir({ tela: "empresa", id })} />}
        {rota.tela === "empresa" && <Empresa id={rota.id} aoVoltar={() => ir({ tela: "empresas" })} />}
        {rota.tela === "liberar" && (
          <Cartao titulo="Liberar acesso">
            <LiberarAcesso />
          </Cartao>
        )}
        {rota.tela === "vendas" && (
          <Cartao titulo="Vendas do Asaas">
            <section className="rounded-[14px] border border-line bg-bg [&>div]:border-t-0">
              <VendasDoAsaas />
            </section>
          </Cartao>
        )}
        {rota.tela === "whatsapp" && (
          <Cartao titulo="Pedidos de WhatsApp">
            <section className="rounded-[14px] border border-line bg-bg [&>div]:border-t-0">
              <PedidosDeConexao mostrarVazio />
            </section>
          </Cartao>
        )}
        {rota.tela === "historico" && (
          <Cartao titulo="Histórico">
            <Historico aoAbrirEmpresa={(id) => ir({ tela: "empresa", id })} />
          </Cartao>
        )}
      </main>
    </div>
  );
}
