import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { api } from "../../data/client";
import { BotaoPrimario } from "../../page/ui";
import { CampoFormulario, ModalGestao } from "../../page/telas/gestaoCompartilhados";
import { ENTRADA_PAINEL } from "../administracao";
import {
  descreverAcao,
  descreverValor,
  ehDoAsaas,
  ehRebaixamento,
  fimDoDia,
  fimMaisDias,
  formatarData,
  formatarDataHora,
  ORIGEM,
  situacao,
} from "../formatos";
import { BOTAO_PERIGO, BOTAO_SECUNDARIO, Secao, Selo } from "./componentes";

const AVISO_ASAAS = "Esta empresa paga pelo Asaas. O que se muda aqui muda o ACESSO, não a cobrança: altere ou cancele a assinatura no Asaas também. O próximo pagamento confirmado volta a escrever o período.";

const PRAZOS = [
  { valor: "", rotulo: "Sem prazo" },
  { valor: "7", rotulo: "7 dias" },
  { valor: "15", rotulo: "15 dias" },
  { valor: "30", rotulo: "30 dias" },
  { valor: "90", rotulo: "90 dias" },
  { valor: "data", rotulo: "Até uma data…" },
];

const PAPEL = { owner: "Dono", admin: "Administrador", member: "Membro" };

function AvisoAsaas() {
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-[12px] border border-warning/30 bg-warning/10 px-4 py-3 text-[12.5px] leading-relaxed text-fg">
      <AlertTriangle size={16} className="mt-0.5 flex-none text-warning" aria-hidden="true" />
      <span>{AVISO_ASAAS}</span>
    </div>
  );
}

function RodapeModal({ aoFechar, enviando, desabilitado, rotulo, perigo = false }) {
  return (
    <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
      <button type="button" onClick={aoFechar} className="cursor-pointer rounded-[8px] px-3 py-2 text-[13px] font-medium text-sub hover:text-fg">
        Cancelar
      </button>
      {perigo ? (
        <button type="submit" disabled={enviando || desabilitado}
          className="cursor-pointer rounded-[9px] bg-danger px-4 py-2 text-[13px] font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40">
          {enviando ? "Aplicando…" : rotulo}
        </button>
      ) : (
        <BotaoPrimario type="submit" disabled={enviando || desabilitado} className="!min-h-0 !py-2 !text-[13px]">
          {enviando ? "Aplicando…" : rotulo}
        </BotaoPrimario>
      )}
    </div>
  );
}

/**
 * Um formulário de modal: nota, erro e o envio num só lugar. `executar`
 * recebe a nota e devolve a resposta do banco; o modal fecha sozinho quando
 * dá certo.
 */
function useEnvio(executar, aoConcluir) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const enviar = async (evento) => {
    evento.preventDefault();
    setEnviando(true);
    setErro("");
    try {
      const resposta = await executar();
      await aoConcluir(resposta);
    } catch (e) {
      setErro(e?.message || "Não foi possível aplicar.");
      setEnviando(false);
    }
  };
  return { enviando, erro, enviar };
}

function Nota({ valor, aoMudar, obrigatoria = false }) {
  return (
    <CampoFormulario rotulo={obrigatoria ? "Motivo (obrigatório, vai para o histórico)" : "Nota (vai para o histórico)"}>
      <textarea rows={2} value={valor} onChange={(e) => aoMudar(e.target.value)} required={obrigatoria}
        className={`${ENTRADA_PAINEL} w-full resize-y`} />
    </CampoFormulario>
  );
}

function ModalPeriodo({ empresa, dias, asaas, aoFechar, aoConcluir }) {
  const [data, setData] = useState(() => (dias ? fimMaisDias(empresa.fimDoPeriodo, dias).slice(0, 10) : ""));
  const [renovar, setRenovar] = useState(false);
  const [nota, setNota] = useState(dias ? `+${dias} dias` : "");
  const ate = fimDoDia(data);
  const { enviando, erro, enviar } = useEnvio(
    () => api.plataforma.estenderPeriodo({ id: empresa.id, ate, renovar, nota }),
    aoConcluir,
  );
  return (
    <ModalGestao titulo={`Estender o acesso · ${empresa.nome}`} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-[12.5px] text-sub">
            Hoje: {situacao(empresa).rotulo}.
          </p>
          <CampoFormulario rotulo="Acesso até (23:59 de Brasília)">
            <input type="date" required value={data} onChange={(e) => setData(e.target.value)} className={`${ENTRADA_PAINEL} w-full !py-2`} />
          </CampoFormulario>
          <label className="flex items-start gap-2 text-[12.5px] text-fg">
            <input type="checkbox" checked={renovar} onChange={(e) => setRenovar(e.target.checked)} className="mt-0.5" />
            <span>
              Renovação automática — a empresa fica <strong>ativa</strong> e a data não bloqueia.
              <span className="block text-sub">Desmarcado: "pago até, sem renovação". O acesso bloqueia sozinho quando a data passar.</span>
            </span>
          </label>
          <Nota valor={nota} aoMudar={setNota} />
          {asaas && <AvisoAsaas />}
          {erro && <p role="alert" className="text-[12.5px] text-danger">{erro}</p>}
        </div>
        <RodapeModal aoFechar={aoFechar} enviando={enviando} desabilitado={!ate} rotulo="Estender" />
      </form>
    </ModalGestao>
  );
}

function ModalEncerrar({ empresa, asaas, aoFechar, aoConcluir }) {
  const [nota, setNota] = useState("");
  const { enviando, erro, enviar } = useEnvio(() => api.plataforma.encerrar({ id: empresa.id, nota }), aoConcluir);
  return (
    <ModalGestao titulo={`Encerrar o acesso · ${empresa.nome}`} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-[13px] leading-relaxed text-fg">
            Ninguém da <strong>{empresa.nome}</strong> entra mais a partir de agora, e o WhatsApp e a IA param de
            atender. Para reabrir, é só estender o período.
          </p>
          <Nota valor={nota} aoMudar={setNota} obrigatoria />
          {asaas && <AvisoAsaas />}
          {erro && <p role="alert" className="text-[12.5px] text-danger">{erro}</p>}
        </div>
        <RodapeModal aoFechar={aoFechar} enviando={enviando} desabilitado={nota.trim().length < 3} rotulo="Encerrar agora" perigo />
      </form>
    </ModalGestao>
  );
}

function ModalPlano({ empresa, planos, asaas, aoFechar, aoConcluir }) {
  const [plano, setPlano] = useState(empresa.plano);
  const [nota, setNota] = useState("");
  const rebaixa = ehRebaixamento(empresa.plano, plano);
  const { enviando, erro, enviar } = useEnvio(() => api.plataforma.trocarPlano({ id: empresa.id, plano, nota }), aoConcluir);
  return (
    <ModalGestao titulo={`Trocar o plano · ${empresa.nome}`} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        <div className="flex flex-col gap-3 px-5 py-4">
          <CampoFormulario rotulo={`Plano (hoje: ${empresa.nomePlano})`}>
            <select value={plano} onChange={(e) => setPlano(e.target.value)} className={`${ENTRADA_PAINEL} w-full !py-2`}>
              {planos.filter((item) => item.ativo || item.codigo === empresa.plano).map((item) => (
                <option key={item.codigo} value={item.codigo}>{item.nome}</option>
              ))}
            </select>
          </CampoFormulario>
          <p className="text-[12px] text-sub">Os ajustes desta empresa continuam valendo por cima do plano novo.</p>
          {rebaixa && (
            <p role="note" className="rounded-[10px] border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">
              Este plano é menor que o atual: a empresa perde as funções que só o plano de hoje dá.
            </p>
          )}
          <Nota valor={nota} aoMudar={setNota} />
          {asaas && <AvisoAsaas />}
          {erro && <p role="alert" className="text-[12.5px] text-danger">{erro}</p>}
        </div>
        <RodapeModal aoFechar={aoFechar} enviando={enviando} desabilitado={plano === empresa.plano}
          rotulo={rebaixa ? "Rebaixar o plano" : "Trocar o plano"} perigo={rebaixa} />
      </form>
    </ModalGestao>
  );
}

/**
 * Ligar, desligar, limitar ou devolver ao plano UMA função desta empresa.
 * Ligar IA pede a confirmação que o banco também exige: custa (a conta do
 * Claude é da Major) e só funciona com o WhatsApp próprio do cliente e a
 * conexão montada na VPS.
 */
export function ModalFuncao({ empresa, item, acao, aoFechar, aoConcluir }) {
  const [prazo, setPrazo] = useState("");
  const [data, setData] = useState("");
  const [nota, setNota] = useState("");
  const [confirmouIA, setConfirmouIA] = useState(false);
  const pedeIA = acao.tipo === "ligar" && item.isAi;
  const ate = acao.tipo === "limpar" ? null
    : prazo === "data" ? fimDoDia(data)
      : prazo ? fimMaisDias(null, Number(prazo)) : null;

  const { enviando, erro, enviar } = useEnvio(() => {
    if (acao.tipo === "limpar") return api.plataforma.voltarAoPlano({ id: empresa.id, chave: item.key, nota });
    return api.plataforma.ajustarFuncao({
      id: empresa.id,
      chave: item.key,
      ligada: item.kind === "feature" ? acao.tipo === "ligar" : null,
      limite: item.kind === "limit" ? acao.valor : null,
      ate,
      nota,
      confirmarIA: pedeIA && confirmouIA,
    });
  }, aoConcluir);

  const titulo = acao.tipo === "limpar" ? `Voltar ao plano · ${item.name}`
    : acao.tipo === "ligar" ? `Ligar · ${item.name}`
      : acao.tipo === "desligar" ? `Desligar · ${item.name}`
        : `${item.name}: ${descreverValor(item, acao.valor)}`;

  return (
    <ModalGestao titulo={titulo} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-[12.5px] text-sub">
            Só para <strong className="text-fg">{empresa.nome}</strong>. Pelo plano: {descreverValor(item, item.plan)}.
            {acao.tipo === "limpar" && " O ajuste sai e vale o que o plano diz."}
          </p>
          {acao.tipo !== "limpar" && (
            <div className="flex flex-wrap gap-2">
              <CampoFormulario rotulo="Prazo do ajuste" className="min-w-[160px] flex-1">
                <select value={prazo} onChange={(e) => setPrazo(e.target.value)} className={`${ENTRADA_PAINEL} w-full !py-2`}>
                  {PRAZOS.map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>)}
                </select>
              </CampoFormulario>
              {prazo === "data" && (
                <CampoFormulario rotulo="Até" className="min-w-[160px] flex-1">
                  <input type="date" required value={data} onChange={(e) => setData(e.target.value)} className={`${ENTRADA_PAINEL} w-full !py-2`} />
                </CampoFormulario>
              )}
            </div>
          )}
          {acao.tipo !== "limpar" && prazo && (
            <p className="text-[12px] text-sub">Quando o prazo passar, a empresa volta sozinha ao que o plano diz.</p>
          )}
          {pedeIA && (
            <label className="flex items-start gap-2 rounded-[10px] border border-warning/30 bg-warning/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-fg">
              <input type="checkbox" checked={confirmouIA} onChange={(e) => setConfirmouIA(e.target.checked)} className="mt-0.5" />
              <span>
                Confirmo que a empresa tem o <strong>WhatsApp próprio</strong> e que a conexão está <strong>montada na VPS</strong>.
                A IA usa a conta do Claude da Major: cada conversa custa.
              </span>
            </label>
          )}
          <Nota valor={nota} aoMudar={setNota} />
          {erro && <p role="alert" className="text-[12.5px] text-danger">{erro}</p>}
        </div>
        <RodapeModal aoFechar={aoFechar} enviando={enviando}
          desabilitado={(pedeIA && !confirmouIA) || (prazo === "data" && !ate)}
          rotulo={acao.tipo === "limpar" ? "Voltar ao plano" : "Aplicar"}
          perigo={acao.tipo === "desligar" || (item.kind === "limit" && acao.valor === 0)} />
      </form>
    </ModalGestao>
  );
}

function textoDoAjuste(item) {
  const ajuste = item.adjustment;
  if (!ajuste) return "—";
  const valor = descreverValor(item, item.kind === "limit" ? ajuste.limitValue : ajuste.enabled);
  if (!ajuste.active) return `${valor} (venceu em ${formatarData(ajuste.expiresAt)})`;
  return ajuste.expiresAt ? `${valor} até ${formatarData(ajuste.expiresAt)}` : valor;
}

export function LinhaDaFuncao({ item, aoAjustar }) {
  const ligada = item.result === true;
  return (
    <tr className="align-top">
      <td className="px-4 py-2.5">
        <div className="font-medium text-fg">
          {item.name}
          {item.isAi && <span className="ml-1.5"><Selo tom="destaque">IA</Selo></span>}
        </div>
        <div className="text-[11.5px] text-sub">{item.description}</div>
      </td>
      <td className="px-3 py-2.5 text-sub">{descreverValor(item, item.plan)}</td>
      <td className="px-3 py-2.5 text-sub">{textoDoAjuste(item)}</td>
      <td className="px-3 py-2.5">
        {item.kind === "limit"
          ? <Selo tom={item.result === 0 ? "perigo" : "ok"}>{descreverValor(item, item.result)}</Selo>
          : <Selo tom={ligada ? "ok" : "neutro"}>{ligada ? "Ligada" : "Desligada"}</Selo>}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap justify-end gap-1.5">
          {item.kind === "feature" && (
            <button type="button" className={BOTAO_SECUNDARIO} onClick={() => aoAjustar(item, { tipo: ligada ? "desligar" : "ligar" })}>
              {ligada ? "Desligar" : "Ligar"}
            </button>
          )}
          {item.kind === "limit" && item.key === "connections" && [0, 1].filter((valor) => valor !== item.result).map((valor) => (
            <button key={valor} type="button" className={BOTAO_SECUNDARIO} onClick={() => aoAjustar(item, { tipo: "limite", valor })}>
              {valor === 0 ? "Fechar o WhatsApp" : "Liberar 1 número"}
            </button>
          ))}
          {item.adjustment && (
            <button type="button" className={BOTAO_SECUNDARIO} onClick={() => aoAjustar(item, { tipo: "limpar" })}>
              Voltar ao plano
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function Empresa({ id, aoVoltar }) {
  const [dados, setDados] = useState(null);
  const [planos, setPlanos] = useState([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [modal, setModal] = useState(null);

  const carregar = useCallback(async () => {
    setErro("");
    try {
      setDados(await api.plataforma.empresa({ id }));
    } catch (e) {
      setErro(e?.message || "Não foi possível carregar a empresa.");
    }
  }, [id]);

  useEffect(() => { setDados(null); setAviso(""); carregar(); }, [carregar]);
  useEffect(() => {
    api.plataforma.planosDoPainel().then(setPlanos).catch(() => setPlanos([]));
  }, []);

  // Estável de propósito: o modal refaz o foco quando `aoFechar` muda.
  const fechar = useCallback(() => setModal(null), []);
  const concluido = useCallback(async (resposta) => {
    setModal(null);
    setAviso(resposta?.billingInAsaas
      ? "Feito. A cobrança continua no Asaas: altere ou cancele lá também."
      : "Feito. O histórico registrou a mudança.");
    await carregar();
  }, [carregar]);

  if (erro && !dados) {
    return (
      <div className="px-4 py-6 md:px-8">
        <button type="button" onClick={aoVoltar} className={BOTAO_SECUNDARIO}><ArrowLeft size={14} /> Empresas</button>
        <p role="alert" className="mt-4 text-[13px] text-danger">{erro}</p>
      </div>
    );
  }
  if (!dados) return <p className="px-8 py-6 text-[13px] text-sub">Carregando…</p>;

  const { empresa, funcoes, uso, pessoas, conexoes, vendas, historico } = dados;
  const s = situacao(empresa);
  const asaas = ehDoAsaas(empresa, vendas);
  const interruptores = funcoes.filter((item) => item.kind === "feature");
  const limites = funcoes.filter((item) => item.kind === "limit");
  const ajustar = (item, acao) => setModal({ tipo: "funcao", item, acao });

  return (
    <div className="scrollbar-fina min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <button type="button" onClick={aoVoltar} className={BOTAO_SECUNDARIO}><ArrowLeft size={14} /> Empresas</button>
          <button type="button" onClick={carregar} title="Atualizar" aria-label="Atualizar" className={`${BOTAO_SECUNDARIO} ml-auto !p-2`}>
            <RefreshCw size={14} />
          </button>
        </div>

        <header className="rounded-[14px] border border-line bg-bg px-5 py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[20px] font-semibold tracking-tight text-fg">{empresa.nome}</h1>
            <Selo tom={s.tom}>{s.rotulo}</Selo>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] md:grid-cols-4">
            <div><dt className="text-faint">Plano</dt><dd className="font-medium text-fg">{empresa.nomePlano || "—"}</dd></div>
            <div><dt className="text-faint">Fim do período</dt><dd className="font-medium text-fg">{formatarData(empresa.fimDoPeriodo)}</dd></div>
            <div><dt className="text-faint">Origem</dt><dd className="font-medium text-fg">{ORIGEM[empresa.origem] || empresa.origem || "—"}</dd></div>
            <div><dt className="text-faint">Dono</dt><dd className="truncate font-medium text-fg" title={empresa.dono}>{empresa.dono || "—"}</dd></div>
            <div><dt className="text-faint">Criada em</dt><dd className="text-fg">{formatarData(empresa.criadaEm)}</dd></div>
            <div><dt className="text-faint">Último acesso do dono</dt><dd className="text-fg">{formatarDataHora(empresa.ultimoAcessoDono)}</dd></div>
            <div><dt className="text-faint">Último sinal da VPS</dt><dd className="text-fg">{formatarDataHora(empresa.ultimoSinal)}</dd></div>
            <div><dt className="text-faint">Id</dt><dd className="truncate font-mono text-[11px] text-sub" title={empresa.id}>{empresa.id}</dd></div>
          </dl>
        </header>

        {asaas && <AvisoAsaas />}
        {aviso && <p role="status" className="rounded-[10px] border border-success/30 bg-success-soft/50 px-4 py-2.5 text-[12.5px] text-fg">{aviso}</p>}
        {erro && <p role="alert" className="text-[12.5px] text-danger">{erro}</p>}

        <Secao titulo="Acesso e plano" descricao="Estender não mexe no plano; trocar o plano não mexe na data.">
          <div className="flex flex-wrap gap-2 px-5 py-4">
            <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setModal({ tipo: "periodo", dias: 30 })}>+30 dias</button>
            <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setModal({ tipo: "periodo", dias: 90 })}>+90 dias</button>
            <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setModal({ tipo: "periodo", dias: null })}>Escolher a data…</button>
            <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setModal({ tipo: "plano" })}>Trocar o plano…</button>
            <button type="button" className={`${BOTAO_PERIGO} ml-auto`} disabled={empresa.estado === "blocked"} onClick={() => setModal({ tipo: "encerrar" })}>
              Encerrar agora
            </button>
          </div>
        </Secao>

        <Secao titulo="Funções desta empresa"
          descricao="O ajuste vence o plano. Função nova nasce desligada para todos; ligue aqui para quem deve ter.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] table-fixed text-left text-[12.5px]">
              <colgroup>
                <col />
                <col className="w-[120px]" />
                <col className="w-[170px]" />
                <col className="w-[120px]" />
                <col className="w-[230px]" />
              </colgroup>
              <thead className="border-b border-line text-[11px] font-semibold uppercase tracking-wide text-faint">
                <tr>
                  <th className="px-4 py-2">Função</th>
                  <th className="px-3 py-2">Plano</th>
                  <th className="px-3 py-2">Ajuste</th>
                  <th className="px-3 py-2">Resultado</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {interruptores.map((item) => <LinhaDaFuncao key={item.key} item={item} aoAjustar={ajustar} />)}
              </tbody>
            </table>
          </div>
        </Secao>

        <Secao titulo="Limites" descricao="Um WhatsApp por empresa, por enquanto: o limite só pode ser 0 ou 1.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] table-fixed text-left text-[12.5px]">
              <colgroup>
                <col />
                <col className="w-[120px]" />
                <col className="w-[170px]" />
                <col className="w-[120px]" />
                <col className="w-[230px]" />
              </colgroup>
              <tbody className="divide-y divide-line">
                {limites.map((item) => <LinhaDaFuncao key={item.key} item={item} aoAjustar={ajustar} />)}
              </tbody>
            </table>
          </div>
        </Secao>

        <Secao titulo="Uso">
          <div className="grid grid-cols-2 gap-3 px-5 py-4 md:grid-cols-4">
            {[
              ["Contatos", uso.contacts],
              ["Negócios", uso.deals],
              ["Conversas em 30 dias", uso.conversations30d],
              ["Mensagens em 30 dias", uso.messages30d],
            ].map(([rotulo, valor]) => (
              <div key={rotulo} className="rounded-[10px] border border-line px-3 py-2.5">
                <div className="text-[11.5px] text-faint">{rotulo}</div>
                <div className="text-[18px] font-semibold tabular-nums text-fg">{valor ?? 0}</div>
              </div>
            ))}
          </div>
        </Secao>

        <div className="grid gap-4 md:grid-cols-2">
          <Secao titulo={`Pessoas (${pessoas.length})`}>
            <ul className="divide-y divide-line text-[12.5px]">
              {pessoas.map((pessoa) => (
                <li key={pessoa.email} className="flex items-center gap-2 px-5 py-2">
                  <span className="min-w-0 flex-1 truncate text-fg">{pessoa.email}</span>
                  <span className="text-sub">{PAPEL[pessoa.role] || pessoa.role}{pessoa.status !== "active" ? " · suspensa" : ""}</span>
                </li>
              ))}
              {!pessoas.length && <li className="px-5 py-3 text-sub">Ninguém.</li>}
            </ul>
          </Secao>
          <Secao titulo="WhatsApp">
            <ul className="divide-y divide-line text-[12.5px]">
              {conexoes.map((conexao) => (
                <li key={conexao.id} className="px-5 py-2">
                  <div className="text-fg">{conexao.name} · final {conexao.last4 || "????"}</div>
                  <div className="text-sub">
                    {conexao.status} · {conexao.heartbeatAt ? `último sinal ${formatarDataHora(conexao.heartbeatAt)}` : "sem sinal da VPS"}
                  </div>
                </li>
              ))}
              {!conexoes.length && <li className="px-5 py-3 text-sub">Nenhum número pedido.</li>}
            </ul>
          </Secao>
        </div>

        {vendas.length > 0 && (
          <Secao titulo="Vendas do Asaas">
            <ul className="divide-y divide-line text-[12.5px]">
              {vendas.map((venda) => (
                <li key={venda.id} className="px-5 py-2">
                  <div className="text-fg">{venda.email || "(sem e-mail)"} · {venda.planCode} · {venda.status}</div>
                  <div className="text-sub">
                    Assinatura {venda.externalSubscriptionId} · pago até {formatarData(venda.currentPeriodEndsAt)}
                  </div>
                </li>
              ))}
            </ul>
          </Secao>
        )}

        <Secao titulo="Histórico" descricao="As últimas 50 mudanças feitas pela administração nesta empresa.">
          <ListaDoHistorico linhas={historico} nomes={Object.fromEntries(funcoes.map((item) => [item.key, item.name]))} />
        </Secao>
      </div>

      {modal?.tipo === "periodo" && (
        <ModalPeriodo empresa={empresa} dias={modal.dias} asaas={asaas} aoFechar={fechar} aoConcluir={concluido} />
      )}
      {modal?.tipo === "encerrar" && <ModalEncerrar empresa={empresa} asaas={asaas} aoFechar={fechar} aoConcluir={concluido} />}
      {modal?.tipo === "plano" && <ModalPlano empresa={empresa} planos={planos} asaas={asaas} aoFechar={fechar} aoConcluir={concluido} />}
      {modal?.tipo === "funcao" && (
        <ModalFuncao empresa={empresa} item={modal.item} acao={modal.acao} aoFechar={fechar} aoConcluir={concluido} />
      )}
    </div>
  );
}

export function ListaDoHistorico({ linhas, aoAbrirEmpresa = null, nomes = {} }) {
  if (!linhas.length) return <p className="px-5 py-3 text-[12.5px] text-sub">Nada registrado ainda.</p>;
  return (
    <ul className="divide-y divide-line text-[12.5px]">
      {linhas.map((linha) => (
        <li key={linha.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2">
          <span className="w-[108px] flex-none tabular-nums text-faint">{formatarDataHora(linha.em)}</span>
          {aoAbrirEmpresa && linha.empresaId && (
            <button type="button" onClick={() => aoAbrirEmpresa(linha.empresaId)} className="cursor-pointer font-medium text-accent-forte hover:underline">
              {linha.empresa || "empresa removida"}
            </button>
          )}
          <span className="min-w-0 flex-1 text-fg">{descreverAcao({ ...linha, alvo: nomes[linha.alvo] || linha.alvo })}</span>
          <span className="text-sub">{linha.autor}</span>
          {linha.nota && <span className="basis-full text-sub md:pl-[120px]">“{linha.nota}”</span>}
        </li>
      ))}
    </ul>
  );
}
