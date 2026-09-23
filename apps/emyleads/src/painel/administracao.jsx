import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { api } from "../data/client";
import { BotaoPrimario } from "../page/ui";

/**
 * O que era o cartão "Administração do Núcleo Major" dentro de Configurações
 * do app, e desde 24/09/2026 mora no painel da plataforma: a liberação
 * manual, as vendas do Asaas e os pedidos de WhatsApp. O comportamento é o
 * mesmo; mudou o endereço, e com ele saiu a verificação de admin de dentro de
 * cada cartão — quem decide se a pessoa entra é o portão do painel (e, de
 * verdade, o banco).
 */

export const ENTRADA_PAINEL =
  "rounded-[8px] border border-line bg-bg px-3 py-1.5 text-[13.5px] text-fg outline-none transition-colors focus:border-accent";
const entrada = ENTRADA_PAINEL;

const CICLO = { MONTHLY: "mensal", QUARTERLY: "trimestral", SEMIANNUALLY: "semestral", YEARLY: "anual" };

const SITUACAO_DA_VENDA = {
  active: "Paga",
  past_due: "Em atraso",
  suspended: "Suspensa",
  canceled: "Cancelada",
};

function situacaoDaAtivacao(venda) {
  if (venda.empresa) return `Ativada: ${venda.empresa}`;
  if (venda.codigoStatus === "pending" && venda.ativacaoFalhou) return "E-mail de ativação falhou";
  if (venda.codigoStatus === "pending") return venda.ativacaoEnviada ? "Aguardando o cliente ativar" : "Código emitido";
  if (venda.codigoStatus === "expired") return "Código vencido";
  if (venda.codigoStatus === "revoked") return "Código revogado";
  return venda.email ? "Sem código" : "Venda sem e-mail";
}

/**
 * As vendas que chegaram pelo webhook do Asaas. Reenviar emite OUTRO código
 * (o anterior não existe em texto em lugar nenhum) e manda o e-mail de novo;
 * quando a venda chegou sem e-mail, é aqui que ele entra.
 */
export function VendasDoAsaas() {
  const [vendas, setVendas] = useState(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [aviso, setAviso] = useState("");
  const [emailDe, setEmailDe] = useState({});

  const carregar = async () => {
    try {
      setVendas(await api.plataforma.vendas());
      setErro("");
    } catch (e) {
      // Antes da migration de cobrança a RPC não existe: o bloco some.
      setVendas([]);
      setErro(/billing_subscriptions_admin_list/i.test(e?.message || "") ? "" : e?.message || "Não foi possível carregar as vendas.");
    }
  };

  useEffect(() => { carregar(); }, []);

  const reenviar = async (venda) => {
    const email = venda.email ? "" : String(emailDe[venda.id] || "").trim();
    if (!venda.email && !email) {
      setErro("Informe o e-mail do cliente para enviar a ativação.");
      return;
    }
    setOcupado(venda.id);
    setAviso("");
    setErro("");
    try {
      const resposta = await api.plataforma.reenviarAtivacao({ id: venda.id, email });
      setAviso(`Novo código enviado para ${resposta.email}.`);
      await carregar();
    } catch (e) {
      setErro(e?.message || "Não foi possível reenviar.");
    } finally {
      setOcupado("");
    }
  };

  const revogar = async (venda) => {
    setOcupado(venda.id);
    setAviso("");
    setErro("");
    try {
      await api.plataforma.revogarAtivacao({ codigoId: venda.codigoId });
      setAviso("Código revogado.");
      await carregar();
    } catch (e) {
      setErro(e?.message || "Não foi possível revogar.");
    } finally {
      setOcupado("");
    }
  };

  if (vendas === null) return null;

  return (
    <div className="border-t border-line px-5 py-4">
      <h3 className="text-[13px] font-semibold text-fg">Vendas pelo Asaas</h3>
      {vendas.length === 0 && !erro && (
        <p className="mt-1 text-[12.5px] text-sub">Nenhuma venda recebida ainda.</p>
      )}
      {aviso && <p role="status" className="mt-2 text-[12.5px] text-success">{aviso}</p>}
      {erro && <p role="alert" className="mt-2 text-[12.5px] text-danger">{erro}</p>}
      {vendas.length > 0 && (
        <ul className="mt-2 divide-y divide-line rounded-[10px] border border-line">
          {vendas.map((venda) => {
            const podeReenviar = !venda.empresa && ["active", "past_due"].includes(venda.status);
            const podeRevogar = !venda.empresa && venda.codigoStatus === "pending" && venda.codigoId;
            return (
              <li key={venda.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-[12.5px]">
                <div className="min-w-[220px] flex-1">
                  <div className="font-medium text-fg">{venda.email || "(sem e-mail)"}</div>
                  <div className="text-sub">
                    {venda.nomePlano} {CICLO[venda.ciclo] || ""} · {SITUACAO_DA_VENDA[venda.status] || venda.status} · {situacaoDaAtivacao(venda)}
                  </div>
                </div>
                {podeReenviar && !venda.email && (
                  <input type="email" placeholder="e-mail do cliente" aria-label="E-mail do cliente"
                    value={emailDe[venda.id] || ""}
                    onChange={(e) => setEmailDe({ ...emailDe, [venda.id]: e.target.value })}
                    className={`${entrada} w-52`} />
                )}
                {podeReenviar && (
                  <button type="button" disabled={ocupado === venda.id} onClick={() => reenviar(venda)}
                    className="cursor-pointer rounded-[8px] border border-line bg-bg px-3 py-1.5 font-medium text-sub hover:text-fg disabled:opacity-40">
                    {ocupado === venda.id ? "Enviando…" : "Reenviar ativação"}
                  </button>
                )}
                {podeRevogar && (
                  <button type="button" disabled={ocupado === venda.id} onClick={() => revogar(venda)}
                    className="cursor-pointer rounded-[8px] px-3 py-1.5 font-medium text-danger hover:bg-danger/10 disabled:opacity-40">
                    Revogar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// O script da VPS conhece base, atendimento e completo. A Major (full) tem as
// duas IAs, então equivale ao completo.
export function comandoDaVps(pedido) {
  const plano = pedido.plano === "full" ? "completo" : pedido.plano;
  const conhecido = ["base", "atendimento", "completo"].includes(plano) ? plano : "base";
  return `bash scripts/vps/provision-connection.sh ${pedido.empresaId} ${pedido.conexaoId} --plano ${conhecido}`;
}

/**
 * Os WhatsApps pedidos pelos clientes. Os que ainda não deram sinal vêm
 * primeiro, com o comando que monta a conexão na VPS pronto para copiar.
 */
export function PedidosDeConexao({ mostrarVazio = false }) {
  const [pedidos, setPedidos] = useState(null);
  const [copiado, setCopiado] = useState("");

  useEffect(() => {
    let ativo = true;
    api.plataforma.pedidosDeConexao()
      .then((lista) => ativo && setPedidos(lista || []))
      // Antes da migration do pedido a RPC não existe: o bloco some.
      .catch(() => ativo && setPedidos([]));
    return () => { ativo = false; };
  }, []);

  const pendentes = (pedidos || []).filter((pedido) => !pedido.sinalEm);
  if (!pendentes.length) {
    if (!mostrarVazio || pedidos === null) return null;
    return (
      <div className="px-5 py-4">
        <p className="text-[12.5px] text-sub">Nenhum WhatsApp aguardando a VPS.</p>
      </div>
    );
  }

  const copiar = async (pedido) => {
    try {
      await navigator.clipboard.writeText(comandoDaVps(pedido));
      setCopiado(pedido.conexaoId);
    } catch {
      setCopiado("");
    }
  };

  return (
    <div className="border-t border-line px-5 py-4">
      <h3 className="text-[13px] font-semibold text-fg">WhatsApps aguardando a VPS</h3>
      <ul className="mt-2 space-y-2">
        {pendentes.map((pedido) => (
          <li key={pedido.conexaoId} className="rounded-[10px] border border-line px-3.5 py-2.5 text-[12.5px]">
            <div className="font-medium text-fg">{pedido.empresa} · final {pedido.final || "????"}</div>
            <div className="text-sub">
              {pedido.dono || "sem dono"} · plano {pedido.plano || "?"} · pedido em{" "}
              {pedido.pedidoEm ? new Date(pedido.pedidoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "?"}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[8px] bg-surface px-2.5 py-1.5 text-[11.5px] text-fg">{comandoDaVps(pedido)}</code>
              <button type="button" onClick={() => copiar(pedido)}
                className="inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-[8px] border border-line bg-bg px-2.5 py-1.5 text-[12px] font-medium text-sub hover:text-fg">
                {copiado === pedido.conexaoId ? <Check size={14} /> : <Copy size={14} />}
                {copiado === pedido.conexaoId ? "Copiado" : "Copiar"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LiberarAcesso() {
  const [email, setEmail] = useState("");
  const [planos, setPlanos] = useState([]);
  const [plano, setPlano] = useState("base");
  const [emitindo, setEmitindo] = useState(false);
  const [liberacao, setLiberacao] = useState(null);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let ativo = true;
    // Antes da migration dos planos, a lista vem só com o Full.
    api.plataforma.planos()
      .then((lista) => ativo && setPlanos(lista || []))
      .catch(() => ativo && setPlanos([]));
    return () => { ativo = false; };
  }, []);

  const emitir = async (evento) => {
    evento.preventDefault();
    setEmitindo(true);
    setErro("");
    setLiberacao(null);
    setCopiado(false);
    try {
      setLiberacao(await api.plataforma.emitirAcesso({ email, plano, dias: 7 }));
    } catch (e) {
      setErro(/pending access/i.test(e?.message || "")
        ? "Esse e-mail já possui uma liberação pendente. Revogue-a antes de emitir outra."
        : e?.message || "Não foi possível emitir a liberação.");
    } finally {
      setEmitindo(false);
    }
  };

  const copiar = async () => {
    if (!liberacao?.access_code) return;
    await navigator.clipboard.writeText(liberacao.access_code);
    setCopiado(true);
  };

  return (
    <section className="rounded-[14px] border border-line bg-bg">
      <p className="border-b border-line px-5 py-4 text-[12.5px] leading-relaxed text-sub">
        Emita uma liberação comercial vinculada ao e-mail do novo cliente. O código aparece uma única vez e ativa uma
        organização no plano escolhido. Quem paga pelo link do Asaas recebe o código sozinho.
      </p>
      <form onSubmit={emitir} className="flex flex-wrap items-end gap-3 px-5 py-4">
        <label className="min-w-[260px] flex-1">
          <span className="mb-1.5 block text-[12px] font-medium text-sub">E-mail autorizado</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="cliente@empresa.com.br" className={`${entrada} w-full !py-2.5`} />
        </label>
        <label>
          <span className="mb-1.5 block text-[12px] font-medium text-sub">Plano</span>
          <select value={plano} onChange={(e) => setPlano(e.target.value)} aria-label="Plano da liberação"
            className={`${entrada} w-52 !py-2.5`}>
            {(planos.length ? planos : [{ codigo: "full", nome: "Full" }]).map((item) => (
              <option key={item.codigo} value={item.codigo}>{item.nome}</option>
            ))}
          </select>
        </label>
        <BotaoPrimario type="submit" disabled={emitindo} className="!py-2.5">
          {emitindo ? "Emitindo…" : "Gerar liberação"}
        </BotaoPrimario>
      </form>
      {erro && <p role="alert" className="border-t border-line bg-danger/5 px-5 py-3 text-[12.5px] text-danger">{erro}</p>}
      {liberacao && (
        <div className="border-t border-line bg-success-soft/40 px-5 py-4">
          <p className="text-[12.5px] text-sub">Envie este código somente para <strong className="text-fg">{liberacao.email}</strong>:</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded-[8px] border border-success/20 bg-bg px-3 py-2 text-[15px] font-semibold tracking-wide text-fg">{liberacao.access_code}</code>
            <button type="button" onClick={copiar} className="inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-line bg-bg px-3 py-2 text-[12.5px] font-medium text-sub hover:text-fg">
              {copiado ? <Check size={15} /> : <Copy size={15} />}{copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-sub">
            Uso único · vinculado ao e-mail · validade de 7 dias · plano {liberacao.plan_code}.
            A cobrança dessa liberação é por fora: ela não passa pelo Asaas.
          </p>
        </div>
      )}
    </section>
  );
}
