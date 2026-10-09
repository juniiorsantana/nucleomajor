import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, Smartphone, Unplug } from "lucide-react";
import { api } from "../../../data/client";
import { fmtData } from "../../../lib/formato";
import { SeloEstado } from "./SeloEstado";

/**
 * Claude e ChatGPT em Conexões: o endereço do MCP do portal, o passo a
 * passo para conectar e os aplicativos que a pessoa já autorizou.
 *
 * O acesso é da PESSOA, não da empresa: um login no Claude vale para todas
 * as empresas dela, com o que ela vê no portal. Por isso a lista diz "seus".
 *
 * Quem lembra os aplicativos autorizados é o Supabase Auth (servidor OAuth
 * do MCP); `auth.aplicativosConectados` só lê. Detalhe em docs/mcp/README.md.
 */

const APLICATIVOS = {
  claude: {
    nome: "Claude",
    site: "https://claude.ai",
    passos: [
      "No computador, entre no claude.ai e abra Configurações → Conectores.",
      "Escolha “Adicionar conector personalizado”, dê o nome Núcleo Major e cole o endereço.",
      "Clique em Conectar, entre com o seu e-mail do Núcleo Major e escolha Permitir.",
    ],
    nota: "Funciona em qualquer plano do Claude. No gratuito, cabe um conector personalizado.",
  },
  chatgpt: {
    nome: "ChatGPT",
    site: "https://chatgpt.com",
    passos: [
      "No computador, entre no chatgpt.com, abra Configurações → Apps e Conectores → Avançado e ligue o Modo desenvolvedor.",
      "Crie um conector com o nome Núcleo Major, cole o endereço e escolha autenticação OAuth.",
      "Entre com o seu e-mail do Núcleo Major e escolha Permitir.",
    ],
    nota: "Depende do plano do ChatGPT. Plus e Pro aceitam conectores que só leem, como este.",
  },
};

const EXEMPLOS = ["Como está hoje?", "Quem está esperando resposta?", "O que a Maria pediu?", "Como foram os leads da semana?", "Como está a agenda da semana?"];

/** O endereço público do MCP: o do servidor que serviu o portal. */
export function enderecoDoMcp(config = globalThis.__NUCLEO_CONFIG__, local = globalThis.location) {
  const origem = String(config?.publicOrigin || local?.origin || "").replace(/\/$/, "");
  return `${origem}/mcp`;
}

export function ClaudeEChatGPT({ endereco = enderecoDoMcp() }) {
  const [estado, setEstado] = useState(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState("claude");
  const [copiado, setCopiado] = useState(false);
  const [desconectando, setDesconectando] = useState("");
  const campoRef = useRef(null);

  const carregar = useCallback(async () => {
    setErro("");
    try {
      setEstado(await api.auth.aplicativosConectados());
    } catch (e) {
      // Sem a lista, o passo a passo continua valendo: mostra-se o erro e
      // segue-se como se nada estivesse conectado.
      setEstado({ liberado: true, aplicativos: [], falhou: true });
      setErro(e?.message || "Não foi possível ver os aplicativos conectados agora.");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(endereco);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1600);
    } catch {
      // Sem permissão de área de transferência: o endereço fica selecionado
      // para copiar na mão.
      campoRef.current?.select();
    }
  };

  const desconectar = async (aplicativo) => {
    setDesconectando(aplicativo.id);
    setErro("");
    try {
      await api.auth.desconectarAplicativo({ clientId: aplicativo.id });
      await carregar();
    } catch (e) {
      setErro(e?.message || "Não foi possível desconectar o aplicativo. Tente de novo.");
    } finally {
      setDesconectando("");
    }
  };

  const aplicativos = estado?.aplicativos || [];
  const conectado = aplicativos.length > 0;
  const atual = APLICATIVOS[aba];

  const selo = !estado ? null
    : !estado.liberado ? <SeloEstado tom="atencao">Ainda não liberado</SeloEstado>
    : conectado ? <SeloEstado tom="sucesso">Conectado</SeloEstado>
    : <SeloEstado tom="neutro">Não conectado</SeloEstado>;

  return (
    <section className="rounded-none border border-line bg-bg" aria-labelledby="claude-chatgpt-titulo">
      <div className="flex flex-wrap items-start gap-3 px-5 py-4">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent-soft text-accent-forte">
          <Smartphone size={19} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="min-w-[220px] flex-1">
          <h2 id="claude-chatgpt-titulo" className="text-[15px] font-semibold text-fg">Claude e ChatGPT</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-sub">
            Pergunte pelo Claude ou pelo ChatGPT, também no celular, sobre as conversas, os leads, as tarefas e a
            agenda. Eles só leem: não enviam mensagem nem mudam nada.
          </p>
        </div>
        {selo}
      </div>

      {!estado ? (
        <div className="flex items-center gap-2 border-t border-line px-5 py-4 text-[13px] text-sub">
          <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> Consultando…
        </div>
      ) : !estado.liberado ? (
        <p className="border-t border-line px-5 py-4 text-[13px] leading-relaxed text-sub">
          Este acesso ainda não foi liberado no Núcleo Major. Quando for, o endereço e o passo a passo aparecem aqui.
        </p>
      ) : (
        <>
          <div className="border-t border-line px-5 py-4">
            <label htmlFor="endereco-mcp" className="mb-1.5 block text-[12.5px] font-medium text-sub">
              Endereço do conector
            </label>
            {/* Empilhado no celular: lado a lado, o botão comia o fim do
                endereço, e endereço cortado é endereço colado errado. */}
            <div className="flex max-w-[520px] flex-col gap-2 sm:flex-row">
              <input
                id="endereco-mcp"
                ref={campoRef}
                readOnly
                value={endereco}
                onFocus={(e) => e.target.select()}
                className="h-11 w-full min-w-0 rounded-ctl border border-line bg-surface px-3 font-mono text-[13.5px] text-fg outline-none focus:border-accent sm:flex-1"
              />
              <button
                type="button"
                onClick={copiar}
                className="flex min-h-11 flex-none cursor-pointer items-center justify-center gap-2 rounded-ctl border border-line px-4 text-[13.5px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg"
              >
                {copiado ? <Check size={16} className="text-success" aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copiado ? "Copiado" : "Copiar"}
              </button>
            </div>
          </div>

          <div className="border-t border-line px-5 py-4">
            <div className="flex gap-1.5" role="group" aria-label="Escolha o aplicativo">
              {Object.entries(APLICATIVOS).map(([chave, aplicativo]) => (
                <button
                  key={chave}
                  type="button"
                  aria-pressed={aba === chave}
                  onClick={() => setAba(chave)}
                  className={`min-h-11 cursor-pointer rounded-ctl px-4 text-[13.5px] font-medium transition-colors ${
                    aba === chave ? "bg-surface-hover text-fg" : "text-sub hover:text-fg"
                  }`}
                >
                  {aplicativo.nome}
                </button>
              ))}
            </div>
            <ol className="mt-3 max-w-[560px] space-y-2 text-[13px] leading-relaxed text-fg">
              {atual.passos.map((passo, i) => (
                <li key={passo} className="flex gap-3">
                  <span className="w-4 flex-none font-mono text-sub">{i + 1}.</span>
                  <span>{passo}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[12px] leading-relaxed text-sub">
              Faça uma vez no computador. Depois o Núcleo Major aparece também no app do {atual.nome} no celular. {atual.nota}
            </p>
            <a
              href={atual.site}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-ctl border border-line px-3.5 text-[13px] font-medium text-sub transition-colors hover:border-accent hover:text-accent-forte"
            >
              <ExternalLink size={15} aria-hidden="true" /> Abrir o {atual.nome}
            </a>
          </div>

          <div className="border-t border-line px-5 py-4">
            <p className="text-[12.5px] font-medium text-sub">Depois, pergunte por exemplo</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {EXEMPLOS.map((exemplo) => (
                <li key={exemplo} className="rounded-full bg-surface-hover px-3 py-1 text-[12.5px] text-fg">{exemplo}</li>
              ))}
            </ul>
          </div>

          <div className="border-t border-line">
            <p className="px-5 pt-4 text-[12.5px] font-medium text-sub">Seus aplicativos conectados</p>
            {conectado ? (
              <ul className="mt-1">
                {aplicativos.map((aplicativo) => (
                  <li key={aplicativo.id} className="flex min-h-14 items-center gap-3 border-b border-line px-5 last:border-0">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-fg">{aplicativo.nome}</span>
                      {aplicativo.desde && <span className="block text-[12px] text-sub">Conectado em {fmtData(aplicativo.desde)}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => desconectar(aplicativo)}
                      disabled={Boolean(desconectando)}
                      className="flex min-h-11 flex-none cursor-pointer items-center gap-2 rounded-ctl px-3 text-[13px] font-medium text-sub transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                    >
                      {desconectando === aplicativo.id
                        ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
                        : <Unplug size={15} aria-hidden="true" />}
                      Desconectar
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 pb-4 pt-1 text-[13px] text-sub">
                {estado.falhou ? "Não foi possível conferir agora." : "Nenhum ainda."}
              </p>
            )}
          </div>
        </>
      )}

      {erro && (
        <div role="alert" className="flex items-center gap-3 border-t border-line bg-danger/10 px-5 py-3 text-[12.5px] text-danger">
          <span className="flex-1">{erro}</span>
          {estado?.falhou && (
            <button type="button" onClick={carregar} className="min-h-11 cursor-pointer font-medium underline-offset-2 hover:underline">
              Tentar de novo
            </button>
          )}
        </div>
      )}
    </section>
  );
}
