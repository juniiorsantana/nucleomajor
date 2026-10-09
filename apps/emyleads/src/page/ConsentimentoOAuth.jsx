import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { obterSupabaseWeb } from "../web/supabaseClient";
import { BotaoPrimario, Marca } from "./ui";

/**
 * "Permitir acesso": a parada do login quando o Claude ou o ChatGPT
 * conectam o MCP do portal. O Supabase Auth é o servidor OAuth; ele manda
 * a pessoa para cá (`/app/oauth/consent?authorization_id=…`) depois do
 * login, e esta tela só mostra o pedido e devolve a resposta.
 *
 * Acontece quase sempre no navegador do celular, no meio de outro app:
 * por isso diz em uma frase o que o outro lado vai ver e o que não pode.
 *
 * Esta tela é a única porta de aprovação, e por isso guarda a trava dos
 * destinos. O registro de aplicativos no Supabase é aberto (o Claude e o
 * ChatGPT se cadastram sozinhos), então qualquer um pode criar um "Claude"
 * falso que devolve o código para outro site. E o token que sai daqui vale
 * a sessão inteira da pessoa, não só a leitura do MCP. Só se aprova o que
 * volta para o Claude ou para o ChatGPT; o resto é recusado aqui mesmo.
 */

function Moldura({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4 text-fg">
      <div className="w-full max-w-[390px]">
        <div className="mb-5 flex justify-center"><Marca tamanho={38} /></div>
        <section className="border border-line bg-bg p-6">{children}</section>
      </div>
    </div>
  );
}

function Aviso({ children }) {
  return <div role="alert" className="mt-4 rounded-ctl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{children}</div>;
}

function hostDe(endereco) {
  try {
    return new URL(endereco).host;
  } catch {
    return "";
  }
}

/** Para onde o código de acesso pode voltar: os donos do Claude e do ChatGPT. */
const DESTINOS_CONFIAVEIS = ["claude.ai", "claude.com", "chatgpt.com"];

export function destinoConfiavel(endereco) {
  try {
    const url = new URL(endereco);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return DESTINOS_CONFIAVEIS.some((dominio) => host === dominio || host.endsWith(`.${dominio}`));
  } catch {
    return false;
  }
}

const PODE = ["Conversas e mensagens do WhatsApp", "Leads e contatos", "Tarefas e agenda"];
const NAO_PODE = ["Enviar mensagens", "Criar, mudar ou apagar qualquer coisa"];

export default function ConsentimentoOAuth({
  oauth = obterSupabaseWeb().auth.oauth,
  busca = globalThis.location?.search || "",
  irPara = (url) => globalThis.location.assign(url),
}) {
  const id = new URLSearchParams(busca).get("authorization_id");
  const [pedido, setPedido] = useState(null);
  const [erro, setErro] = useState(id ? "" : "Este link de autorização está incompleto. Volte ao aplicativo e conecte de novo.");
  const [enviando, setEnviando] = useState("");
  const [bloqueado, setBloqueado] = useState("");
  const [recusado, setRecusado] = useState(false);

  useEffect(() => {
    if (!id) return undefined;
    let ativo = true;
    oauth.getAuthorizationDetails(id).then(({ data, error }) => {
      if (!ativo) return;
      if (error || !data) {
        setErro("Este pedido de acesso expirou ou já foi usado. Volte ao aplicativo e conecte de novo.");
        return;
      }
      // Já autorizado antes: o Supabase devolve direto o caminho de volta.
      // A trava vale aqui também, para nada sair desta tela rumo a um
      // destino estranho, nem o que foi aprovado antes dela existir.
      if (data.redirect_url && !data.authorization_id) {
        if (destinoConfiavel(data.redirect_url)) irPara(data.redirect_url);
        else setBloqueado(hostDe(data.redirect_url) || "um endereço desconhecido");
        return;
      }
      setPedido(data);
    }).catch(() => ativo && setErro("Não foi possível carregar o pedido de acesso. Tente de novo."));
    return () => { ativo = false; };
    // `irPara` fica fora de propósito: é uma função nova a cada render e
    // faria o pedido ser buscado de novo sem parar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, oauth]);

  const responder = async (decisao) => {
    setErro("");
    setEnviando(decisao);
    try {
      const chamada = decisao === "permitir" ? oauth.approveAuthorization : oauth.denyAuthorization;
      const { data, error } = await chamada.call(oauth, id, { skipBrowserRedirect: true });
      if (error || !data?.redirect_url) throw error || new Error("sem retorno");
      irPara(data.redirect_url);
    } catch {
      setEnviando("");
      setErro("Não foi possível registrar sua resposta. Tente de novo.");
    }
  };

  // Recusa sem voltar: o "voltar" levaria a pessoa ao site de quem pediu.
  const recusarAqui = async () => {
    setErro("");
    setEnviando("negar");
    try {
      const { error } = await oauth.denyAuthorization(id, { skipBrowserRedirect: true });
      if (error) throw error;
      setRecusado(true);
    } catch {
      setErro("Não foi possível recusar o pedido. Feche esta página: sem a sua aprovação, ele não vale.");
    } finally {
      setEnviando("");
    }
  };

  if (bloqueado) {
    return (
      <Moldura>
        <h1 className="text-[20px] font-semibold tracking-tight">Este aplicativo não é reconhecido</h1>
        <p className="mt-2 text-[13px] leading-5 text-sub">
          O pedido mandaria seus dados para <span className="font-medium text-fg">{bloqueado}</span>, que não é o Claude nem o ChatGPT. Por segurança, o Núcleo Major não libera. Pode fechar esta página.
        </p>
      </Moldura>
    );
  }

  if (!pedido) {
    return (
      <Moldura>
        <h1 className="text-[20px] font-semibold tracking-tight">Conectar ao Núcleo Major</h1>
        {erro ? <Aviso>{erro}</Aviso> : (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-sub">
            <LoaderCircle size={16} className="animate-spin" aria-hidden /> Carregando o pedido…
          </p>
        )}
      </Moldura>
    );
  }

  const nome = pedido.client?.name || "Um aplicativo";
  const destino = hostDe(pedido.redirect_uri);

  if (!destinoConfiavel(pedido.redirect_uri)) {
    return (
      <Moldura>
        <h1 className="text-[20px] font-semibold tracking-tight">Este aplicativo não é reconhecido</h1>
        <p className="mt-2 text-[13px] leading-5 text-sub">
          “{nome}” pediu para ler seus dados e mandaria a resposta para{" "}
          <span className="font-medium text-fg">{destino || "um endereço desconhecido"}</span>, que não é o Claude nem o
          ChatGPT. Por segurança, o Núcleo Major só libera o acesso para eles.
        </p>
        <p className="mt-2 text-[13px] leading-5 text-sub">Se não foi você que pediu, alguém pode estar tentando enganar você.</p>
        {erro && <Aviso>{erro}</Aviso>}
        {recusado ? (
          <p role="status" className="mt-5 text-[13px] font-medium text-fg">Pedido recusado. Pode fechar esta página.</p>
        ) : (
          <BotaoPrimario type="button" onClick={recusarAqui} disabled={Boolean(enviando)} className="mt-5 w-full">
            {enviando ? "Recusando…" : "Recusar pedido"}
          </BotaoPrimario>
        )}
      </Moldura>
    );
  }

  return (
    <Moldura>
      <h1 className="text-[20px] font-semibold tracking-tight">{nome} quer ler seus dados</h1>
      <p className="mt-1.5 text-[13px] leading-5 text-sub">
        Conta <span className="font-medium text-fg">{pedido.user?.email}</span>. Vale para as mesmas empresas que você vê no portal.
      </p>

      <div className="mt-5 grid gap-4 text-[13px] sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[11.5px] font-medium text-faint">Pode ver</p>
          <ul className="space-y-1">{PODE.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <div>
          <p className="mb-1.5 text-[11.5px] font-medium text-faint">Não pode</p>
          <ul className="space-y-1 text-sub">{NAO_PODE.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>

      {destino && (
        <p className="mt-5 text-[11.5px] leading-4 text-faint">
          Ao permitir, você volta para <span className="font-medium text-sub">{destino}</span>. Para cortar o acesso depois, use Desconectar em Conexões, no portal, ou desconecte nas configurações do {nome}.
        </p>
      )}

      {erro && <Aviso>{erro}</Aviso>}

      <BotaoPrimario type="button" onClick={() => responder("permitir")} disabled={Boolean(enviando)} className="mt-5 w-full">
        {enviando === "permitir" ? "Permitindo…" : "Permitir acesso"}
      </BotaoPrimario>
      <button type="button" onClick={() => responder("negar")} disabled={Boolean(enviando)}
        className="mt-2 min-h-11 w-full cursor-pointer rounded-ctl px-5 py-2.5 text-[13.5px] font-medium text-sub transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40">
        {enviando === "negar" ? "Recusando…" : "Não permitir"}
      </button>
    </Moldura>
  );
}
