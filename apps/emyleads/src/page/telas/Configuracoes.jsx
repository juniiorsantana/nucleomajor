import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Download,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "../../data/client";
import { corDoEstagio } from "../../domain/types";
import { paraSlug } from "../../lib/texto";
import { BotaoPrimario, CabecalhoTela, PilulaEstagio } from "../ui";

const PLATAFORMA_WEB = typeof __EMYLEADS_PLATFORM__ !== "undefined" && __EMYLEADS_PLATFORM__ === "web";

/**
 * Configurações — o funil e as tags do SEU processo, não do meu.
 *
 * Os seis estágios que vieram por padrão são um chute razoável, e chute
 * razoável é a pior coisa para deixar fixa: todo negócio criado antes de
 * ajustar isso nasce no molde errado. Por isso esta tela veio antes do Funil.
 */

const CORES_SUGERIDAS = [
  "#4f3cfc",
  "#16a34a",
  "#dc2626",
  "#b45309",
  "#0369a1",
  "#7c3aed",
  "#0f766e",
  "#667085",
];

function Bloco({ titulo, descricao, children, acao }) {
  return (
    <section className="rounded-[14px] border border-line bg-bg">
      <div className="flex items-start gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-fg">{titulo}</h2>
          {descricao && (
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-sub">
              {descricao}
            </p>
          )}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

const entrada =
  "rounded-[8px] border border-line bg-bg px-3 py-1.5 text-[13.5px] text-fg outline-none transition-colors focus:border-accent";

/* ------------------------------------------------------------------ */

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
export function PedidosDeConexao() {
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
  if (!pendentes.length) return null;

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

export function AdministracaoPlataforma() {
  const [administrador, setAdministrador] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [email, setEmail] = useState("");
  const [planos, setPlanos] = useState([]);
  const [plano, setPlano] = useState("base");
  const [emitindo, setEmitindo] = useState(false);
  const [liberacao, setLiberacao] = useState(null);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let ativo = true;
    api.plataforma.estado()
      .then((estado) => ativo && setAdministrador(Boolean(estado?.administrador)))
      .catch(() => ativo && setAdministrador(false))
      .finally(() => ativo && setCarregando(false));
    // Antes da migration dos planos, a lista vem só com o Full.
    api.plataforma.planos()
      .then((lista) => ativo && setPlanos(lista || []))
      .catch(() => ativo && setPlanos([]));
    return () => { ativo = false; };
  }, []);

  if (carregando || !administrador) return null;

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
    <Bloco
      titulo="Administração do Núcleo Major"
      descricao="Emita uma liberação comercial vinculada ao e-mail do novo cliente. O código aparece uma única vez e ativa uma organização no plano escolhido. Quem paga pelo link do Asaas recebe o código sozinho."
      acao={<span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[11.5px] font-semibold text-accent-forte"><ShieldCheck size={14} /> Plataforma</span>}
    >
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
      <VendasDoAsaas />
      <PedidosDeConexao />
    </Bloco>
  );
}

/* ------------------------------------------------------------------ */

function Estagios({ estagios, recarregar }) {
  const [novo, setNovo] = useState("");
  const [removendo, setRemovendo] = useState(null); // {estagio, quantidade}
  const [destino, setDestino] = useState("");
  const [erro, setErro] = useState(null);

  const ordenados = [...estagios].sort((a, b) => a.ordem - b.ordem);

  /** Renumera todos: `ordem` é posição, e posição com buraco não é posição. */
  const salvarOrdem = async (lista) => {
    await api.estagios.salvar({
      estagios: lista.map((e, i) => ({ ...e, ordem: i })),
    });
    await recarregar();
  };

  const mover = (indice, passo) => {
    const alvo = indice + passo;
    if (alvo < 0 || alvo >= ordenados.length) return;
    const lista = [...ordenados];
    [lista[indice], lista[alvo]] = [lista[alvo], lista[indice]];
    salvarOrdem(lista);
  };

  const renomear = async (estagio, nome) => {
    if (!nome.trim() || nome === estagio.nome) return;
    // O id NÃO muda: ele é a referência que os negócios guardam. Regenerar o
    // slug no rename mandaria todo mundo para um estágio inexistente.
    await api.estagios.salvar({ estagios: [{ ...estagio, nome: nome.trim() }] });
    await recarregar();
  };

  const adicionar = async (e) => {
    e.preventDefault();
    const nome = novo.trim();
    if (!nome) return;
    const id = paraSlug(nome);
    if (!id || estagios.some((x) => x.id === id)) {
      setErro("Já existe um estágio com esse nome.");
      return;
    }
    setErro(null);
    await api.estagios.salvar({
      estagios: [{ id, nome, ordem: ordenados.length }],
    });
    setNovo("");
    await recarregar();
  };

  const pedirRemocao = async (estagio) => {
    if (estagios.length <= 2) {
      setErro("O funil precisa de pelo menos dois estágios.");
      return;
    }
    setErro(null);
    try {
      await api.estagios.remover({ id: estagio.id });
      await recarregar();
    } catch (err) {
      if (err.codigo === "estagio-com-negocios") {
        setRemovendo({ estagio, quantidade: err.quantidade });
        setDestino(ordenados.find((e) => e.id !== estagio.id)?.id || "");
      } else {
        setErro(err.message);
      }
    }
  };

  const confirmarRemocao = async () => {
    await api.estagios.remover({ id: removendo.estagio.id, moverPara: destino });
    setRemovendo(null);
    await recarregar();
  };

  return (
    <Bloco
      titulo="Estágios do funil"
      descricao="A ordem aqui é a ordem do funil, e a cor da pílula vem da posição. Renomear é seguro: os negócios seguem o estágio."
    >
      <div className="divide-y divide-line">
        {ordenados.map((e, i) => (
          <div key={e.id} className="flex items-center gap-3 px-5 py-2.5">
            <span className="w-6 text-[12.5px] tabular-nums text-faint">
              {i + 1}
            </span>
            <PilulaEstagio nome={e.nome} cor={corDoEstagio(i)} />
            <input
              defaultValue={e.nome}
              onBlur={(ev) => renomear(e, ev.target.value)}
              onKeyDown={(ev) => ev.key === "Enter" && ev.target.blur()}
              className={`${entrada} ml-auto w-56`}
            />
            <button
              onClick={() => mover(i, -1)}
              disabled={i === 0}
              title="Subir"
              className="cursor-pointer rounded-[8px] p-1.5 text-sub transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-25"
            >
              <ArrowUp size={16} />
            </button>
            <button
              onClick={() => mover(i, 1)}
              disabled={i === ordenados.length - 1}
              title="Descer"
              className="cursor-pointer rounded-[8px] p-1.5 text-sub transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-25"
            >
              <ArrowDown size={16} />
            </button>
            <button
              onClick={() => pedirRemocao(e)}
              title="Remover estágio"
              className="cursor-pointer rounded-[8px] p-1.5 text-sub transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {removendo && (
        <div className="border-t border-line bg-warning/5 px-5 py-4">
          <p className="text-[13.5px] text-fg">
            <b>{removendo.estagio.nome}</b> tem {removendo.quantidade} negócio(s).
            Para onde eles vão?
          </p>
          <div className="mt-3 flex items-center gap-2">
            <select
              value={destino}
              onChange={(ev) => setDestino(ev.target.value)}
              className={`${entrada} cursor-pointer`}
            >
              {ordenados
                .filter((e) => e.id !== removendo.estagio.id)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
            </select>
            <BotaoPrimario onClick={confirmarRemocao} className="!py-2">
              Mover e remover
            </BotaoPrimario>
            <button
              onClick={() => setRemovendo(null)}
              className="cursor-pointer px-2 text-[13.5px] text-sub hover:text-fg"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <form
        onSubmit={adicionar}
        className="flex items-center gap-2 border-t border-line px-5 py-3"
      >
        <input
          value={novo}
          onChange={(ev) => setNovo(ev.target.value)}
          placeholder="Nome do novo estágio"
          className={`${entrada} w-56`}
        />
        <button
          type="submit"
          className="flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-line px-3 py-1.5 text-[13.5px] font-medium text-sub transition-colors hover:border-accent hover:text-accent-forte"
        >
          <Plus size={15} /> Adicionar
        </button>
        {erro && <span className="text-[12.5px] text-danger">{erro}</span>}
      </form>
    </Bloco>
  );
}

/* ------------------------------------------------------------------ */

function Tags({ tags, recarregar }) {
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState(null);

  const salvar = async (tag, patch) => {
    await api.tags.salvar({ tags: [{ ...tag, ...patch }] });
    await recarregar();
  };

  const remover = async (tag) => {
    const r = await api.tags.remover({ id: tag.id });
    if (r.contatosAfetados)
      setErro(`"${tag.nome}" foi tirada de ${r.contatosAfetados} contato(s).`);
    await recarregar();
  };

  const adicionar = async (e) => {
    e.preventDefault();
    const nome = novo.trim();
    if (!nome) return;
    const id = paraSlug(nome);
    if (!id || tags.some((t) => t.id === id)) {
      setErro("Já existe uma tag com esse nome.");
      return;
    }
    setErro(null);
    await api.tags.salvar({
      tags: [{ id, nome, cor: CORES_SUGERIDAS[tags.length % CORES_SUGERIDAS.length] }],
    });
    setNovo("");
    await recarregar();
  };

  return (
    <Bloco
      titulo="Tags"
      descricao="Classificam o contato, não o negócio. Etiquetas importadas do WhatsApp Business aparecem aqui."
    >
      <div className="divide-y divide-line">
        {tags.length === 0 && (
          <p className="px-5 py-6 text-center text-[13.5px] text-sub">
            Nenhuma tag ainda.
          </p>
        )}
        {tags.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
            <input
              type="color"
              value={t.cor || "#667085"}
              onChange={(ev) => salvar(t, { cor: ev.target.value })}
              title="Cor da tag"
              className="h-7 w-7 cursor-pointer rounded-full border border-line bg-transparent p-0"
            />
            <span
              className="inline-flex items-center rounded-[8px] px-2.5 py-1 text-[12.5px] font-medium"
              style={{ color: t.cor, background: `${t.cor}1f` }}
            >
              {t.nome}
            </span>
            <input
              defaultValue={t.nome}
              onBlur={(ev) =>
                ev.target.value.trim() &&
                ev.target.value !== t.nome &&
                salvar(t, { nome: ev.target.value.trim() })
              }
              onKeyDown={(ev) => ev.key === "Enter" && ev.target.blur()}
              className={`${entrada} ml-auto w-56`}
            />
            <button
              onClick={() => remover(t)}
              title="Remover tag"
              className="cursor-pointer rounded-[8px] p-1.5 text-sub transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <form
        onSubmit={adicionar}
        className="flex items-center gap-2 border-t border-line px-5 py-3"
      >
        <input
          value={novo}
          onChange={(ev) => setNovo(ev.target.value)}
          placeholder="Nome da nova tag"
          className={`${entrada} w-56`}
        />
        <button
          type="submit"
          className="flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-line px-3 py-1.5 text-[13.5px] font-medium text-sub transition-colors hover:border-accent hover:text-accent-forte"
        >
          <Plus size={15} /> Adicionar
        </button>
        {erro && <span className="text-[12.5px] text-sub">{erro}</span>}
      </form>
    </Bloco>
  );
}

/* ------------------------------------------------------------------ */

function Dados({ recarregar }) {
  const arquivo = useRef(null);
  const [aviso, setAviso] = useState(null);

  const exportar = async () => {
    const pacote = await api.dados.exportar();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(pacote, null, 2)], { type: "application/json" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `emyleads-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setAviso("Backup baixado.");
  };

  const restaurar = async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    ev.target.value = "";
    if (
      !confirm(
        "Restaurar sobrescreve registros com o mesmo id e mantém o resto. Continuar?"
      )
    )
      return;
    try {
      const pacote = JSON.parse(await f.text());
      const c = await api.dados.importar({ pacote });
      setAviso(
        `Restaurado: ${c.contatos} contatos, ${c.negocios} negócios, ${c.tarefas} tarefas, ${c.notas} notas.`
      );
      await recarregar();
    } catch (err) {
      setAviso(`Falhou: ${err.message}`);
    }
  };

  const apagar = async () => {
    if (!confirm("Apagar TODOS os contatos, negócios, tarefas e notas?")) return;
    if (!confirm("Não dá para desfazer. Tem certeza?")) return;
    await api.dados.apagar();
    setAviso("Base apagada.");
    await recarregar();
  };

  return (
    <Bloco
      titulo="Dados"
      descricao={PLATAFORMA_WEB
        ? "A fonte de verdade é o Supabase da organização. Você pode baixar uma cópia; restauração e exclusão total exigem validação administrativa."
        : "Tudo fica neste navegador. Sem backup, formatar a máquina apaga a base — exporte de vez em quando."}
    >
      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
        <button
          onClick={exportar}
          className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-line px-3 py-2 text-[13.5px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg"
        >
          <Download size={16} /> Exportar backup
        </button>
        {!PLATAFORMA_WEB && <button
          onClick={() => arquivo.current?.click()}
          className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-line px-3 py-2 text-[13.5px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg"
        >
          <Upload size={16} /> Restaurar
        </button>}
        <input
          ref={arquivo}
          type="file"
          accept="application/json,.json"
          onChange={restaurar}
          className="hidden"
        />
        {!PLATAFORMA_WEB && <button
          onClick={apagar}
          className="ml-auto cursor-pointer rounded-[8px] border border-line px-3 py-2 text-[13.5px] font-medium text-danger transition-colors hover:border-danger/50"
        >
          Apagar tudo
        </button>}
      </div>
      {aviso && (
        <p className="border-t border-line px-5 py-2.5 text-[12.5px] text-sub">
          {aviso}
        </p>
      )}
    </Bloco>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Qual build está rodando.
 *
 * Parece supérfluo até a primeira vez que alguém diz "atualizei e não mudou
 * nada". Sem isto, essa frase não é verificável: a versão do manifest é fixa e
 * recarregar a extensão não recarrega o content script das abas já abertas.
 * Com o carimbo, basta comparar com o que o último build imprimiu.
 */
function Build() {
  const carimbo = typeof __BUILD_STAMP__ === "string" ? __BUILD_STAMP__ : "desconhecido";
  return (
    <Bloco
      titulo="Build carregado"
      descricao="Compare com o horário do último build. Se não bater, o Chrome ainda está com o código antigo — recarregue a extensão e, depois, a aba do WhatsApp Web."
    >
      <div className="px-5 py-4">
        <code className="rounded-[6px] bg-surface-hover px-2.5 py-1.5 text-[12.5px] text-fg">
          {carimbo}
        </code>
      </div>
    </Bloco>
  );
}

export default function Configuracoes({ dados, recarregar }) {
  return (
    <>
      <CabecalhoTela titulo="Configurações" busca={<span />} acao={<span />} />
      <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="flex max-w-4xl flex-col gap-6">
          {PLATAFORMA_WEB && <AdministracaoPlataforma />}
          <Estagios estagios={dados.estagios} recarregar={recarregar} />
          <Tags tags={dados.tags} recarregar={recarregar} />
          <Dados recarregar={recarregar} />
          <Build />
        </div>
      </div>
    </>
  );
}
