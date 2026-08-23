import { useEffect, useState } from "react";
import { PanelRightClose, UserRoundPlus } from "lucide-react";
import { api } from "../data/client";
import { formatPhone } from "../lib/phone";
import { Botao, Entrada, Esqueleto, Vazio } from "../ui/componentes";
import { fotoDaConversa, fotoPersistivelDaConversa } from "../wa/conversa";
import { achar, SELETORES } from "../wa/seletores";
import { CartaoAcoes, Formularios } from "./acoes";
import {
  CartaoFunil,
  CartaoNegocios,
  CartaoNotas,
  CartaoPerfil,
  CartaoTarefas,
} from "./cartoes";
import { FaixaAutomacao } from "./FaixaAutomacao";
import { FaixaSugestao } from "./FaixaSugestao";
import ImportarWhatsApp from "./ImportarWhatsApp";
import { useChatbotAutomatico } from "./useChatbotAutomatico";
import { useConversaAtiva } from "./useConversa";
import { useFicha } from "./useFicha";
import { useSugestoes } from "./useSugestoes";
import { useDiario } from "../ui/useDiario";

const LARGURA = 380;
const CHAVE_RECOLHIDO = "painel.recolhido";
const VIGIA_MS = 500;

/**
 * O painel de contexto — a peça central do EmyLeads.
 *
 * A ficha é uma PILHA DE CARTÕES numa rolagem só, e não abas: num CRM, clicar
 * para descobrir em que pé está o contato é justamente o trabalho que a ficha
 * deveria eliminar. Custa rolagem vertical; em troca, nada fica escondido.
 *
 * Ordem: quem é (contato) · em que pé está (funil) · como está classificado
 * (tags) · o que fazer (tarefas) · o que foi dito (notas) · atalhos.
 *
 * ESPAÇO RESERVADO: a faixa de controle do bot entra logo abaixo da barra do
 * topo, acima da pilha — ao abrir uma conversa, "o bot vai responder isso?" é
 * tão urgente quanto "quem é essa pessoa?".
 */

function useEncolherWhatsApp(largura) {
  useEffect(() => {
    const alvo = largura ? `calc(100% - ${largura}px)` : "";

    let app = null;
    let anterior = null;

    const restaurar = () => {
      if (app && anterior) Object.assign(app.style, anterior);
      app = null;
      anterior = null;
    };

    /**
     * Em intervalo, e não uma vez: na primeira carga o `#app` ainda não existe
     * quando o content script monta, e o WhatsApp recria a raiz em algumas
     * transições internas, levando junto o estilo. Reatribuir a mesma largura
     * é operação nula, então vigiar não custa nada.
     */
    const garantir = () => {
      const atual = achar(SELETORES.appWhatsApp);
      if (!atual) return;

      if (atual !== app) {
        app = atual;
        anterior = {
          width: app.style.width,
          transform: app.style.transform,
          transition: app.style.transition,
        };
        app.style.transition = "width .18s ease";
      }

      if (app.style.width !== alvo) app.style.width = alvo;
      if (!largura) return;

      // Descendente com position:fixed se ancora na viewport e ignora a
      // largura do pai. Ancestral com transform vira o bloco de contenção
      // deles. Só entra se a MEDIÇÃO disser que precisa.
      const coube =
        app.getBoundingClientRect().width <= window.innerWidth - largura + 2;
      if (!coube && app.style.transform !== "translateZ(0)") {
        app.style.transform = "translateZ(0)";
      }
    };

    garantir();
    const vigia = setInterval(garantir, VIGIA_MS);

    return () => {
      clearInterval(vigia);
      restaurar();
    };
  }, [largura]);
}

/* ------------------------------------------------------------------ */

/** Cadastro rápido de quem está na conversa mas não está na base. */
function Cadastrar({ conversa, aoCadastrar }) {
  const [nome, setNome] = useState(conversa.nome || "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const enviar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      // O waId entra junto: é a identidade que faz esta conversa reconhecer o
      // contato da próxima vez, mesmo sem telefone nenhum.
      await api.contatos.criar({
        nome: nome.trim(),
        telefone: conversa.telefone || "",
        waId: conversa.waId || null,
      });
      await aoCadastrar();
    } catch (err) {
      setErro(err?.message || String(err));
      setSalvando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-2 px-3 pb-3">
      <Entrada
        required
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Nome do contato"
      />
      {conversa.telefone ? (
        <p className="text-[11px] text-sub">
          Telefone: {formatPhone(conversa.telefone)}
        </p>
      ) : (
        conversa.waId && (
          <p className="text-[11px] text-faint">
            Sem telefone visível — será reconhecido pela identidade desta
            conversa.
          </p>
        )
      )}
      {erro && <p className="text-[11.5px] text-danger">{erro}</p>}
      <Botao type="submit" disabled={salvando}>
        {salvando ? "Cadastrando…" : "Cadastrar contato"}
      </Botao>
    </form>
  );
}

/* ------------------------------------------------------------------ */

export default function Painel() {
  const { conversa, contato, recarregar: recarregarContato } = useConversaAtiva();
  const { ficha, recarregar: recarregarFicha } = useFicha(contato?.id);
  // Uma avaliação só, compartilhada pelas duas faixas do topo — ver FaixaSugestao.
  const { sugestoes, recarregar: recarregarSugestoes } = useSugestoes(contato?.id);
  const { ultimaDoContato, recarregar: recarregarDiario } = useDiario({
    contactId: contato?.id,
  });

  const [recolhido, setRecolhido] = useState(null); // null = ainda lendo
  const [estagios, setEstagios] = useState([]);
  const [tags, setTags] = useState([]);
  const [foto, setFoto] = useState(null);
  const [formulario, setFormulario] = useState(null);
  const [tela, setTela] = useState("ficha"); // ficha | importar

  useEffect(() => {
    api.config
      .ler({ chave: CHAVE_RECOLHIDO })
      .then((v) => setRecolhido(!!v))
      .catch(() => setRecolhido(false));
    api.estagios.listar().then(setEstagios).catch(() => {});
    api.tags.listar().then(setTags).catch(() => {});
  }, []);

  // A foto vem do cabeçalho do WhatsApp, que pode demorar a pintar depois da
  // troca de conversa — daí a segunda leitura.
  useEffect(() => {
    setFoto(fotoDaConversa());
    const t = setTimeout(() => setFoto(fotoDaConversa()), 500);
    return () => clearTimeout(t);
  }, [conversa?.waId, conversa?.nome]);

  // O blob URL do WhatsApp sÃ³ existe nesta pÃ¡gina. Materializamos uma cÃ³pia
  // compacta para que a aba de GestÃ£o consiga exibir a mesma foto depois.
  useEffect(() => {
    let vivo = true;
    const fotoAtual = contato?.fotoUrl || "";
    const precisaPersistir = contato?.id && (!fotoAtual || fotoAtual.startsWith("blob:"));
    if (!precisaPersistir) return undefined;

    const timer = setTimeout(async () => {
      const persistida = await fotoPersistivelDaConversa();
      if (!vivo || !persistida || persistida === fotoAtual) return;
      try {
        await api.contatos.atualizar({ id: contato.id, patch: { fotoUrl: persistida } });
        await recarregar();
      } catch {
        // A foto Ã© um enriquecimento; nunca deve interromper a ficha.
      }
    }, 650);

    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [contato?.fotoUrl, contato?.id, conversa?.waId, conversa?.nome]);

  // Trocar de conversa com um formulário aberto salvaria no contato errado.
  useEffect(() => setFormulario(null), [contato?.id]);

  const alternar = (valor) => {
    setRecolhido(valor);
    api.config.gravar({ chave: CHAVE_RECOLHIDO, valor }).catch(() => {});
  };

  const recarregar = async () => {
    await recarregarContato();
    await recarregarFicha();
    // Executar um bot mexe nas etiquetas, e etiqueta é o que as condições
    // leem. Sem reavaliar aqui, a faixa continuaria anunciando um bot que
    // acabou de deixar de se aplicar.
    await recarregarSugestoes();
    await recarregarDiario();
  };

  // Executou alguma coisa: a ficha inteira mudou. Não executou: só o diário
  // ganhou uma linha, e recarregar contato e ficha a cada mensagem que passa
  // seria trabalho jogado fora.
  useChatbotAutomatico((resultado) =>
    resultado ? recarregar() : recarregarDiario()
  );

  useEncolherWhatsApp(recolhido === false ? LARGURA : 0);

  if (recolhido === null) return null;

  if (recolhido) {
    return (
      <button
        title="Abrir o EmyLeads"
        onClick={() => alternar(false)}
        className="fixed right-0 top-1/2 z-[999999] -translate-y-1/2 cursor-pointer rounded-l-el border border-r-0 border-line bg-bg px-1.5 py-4 text-[10px] font-bold tracking-widest text-accent-forte shadow-sm"
        style={{ writingMode: "vertical-rl" }}
      >
        EMYLEADS
      </button>
    );
  }

  const carregando =
    conversa === undefined ||
    contato === undefined ||
    (contato && ficha === undefined);

  const estagioAtual = (() => {
    const aberto = ficha?.negocios?.find((n) => n.status === "aberto") || ficha?.negocios?.[0];
    return aberto ? estagios.find((e) => e.id === aberto.stageId)?.nome : null;
  })();

  return (
    <aside
      className="fixed right-0 top-0 z-[999999] flex h-full flex-col border-l border-line bg-surface"
      style={{ width: LARGURA }}
    >
      <div className="flex flex-none items-center gap-1 border-b border-line bg-bg px-3 py-2">
        {/* Emy escuro e pesado, Leads roxo e leve — a ordem é da logo. */}
        <span className="mr-auto text-[12.5px] tracking-tight">
          <span className="font-bold text-fg">Emy</span>
          <span className="font-medium text-accent">Leads</span>
        </span>
        <button
          onClick={() => setTela(tela === "importar" ? "ficha" : "importar")}
          title="Importar contatos do WhatsApp"
          className={`cursor-pointer rounded-el p-1 transition-colors hover:bg-surface-hover ${
            tela === "importar" ? "text-accent" : "text-sub hover:text-fg"
          }`}
        >
          <UserRoundPlus size={15} strokeWidth={1.75} />
        </button>
        <button
          onClick={() => alternar(true)}
          title="Recolher painel"
          className="cursor-pointer rounded-el p-1 text-sub transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <PanelRightClose size={15} strokeWidth={1.75} />
        </button>
      </div>

      {conversa?.degradado && (
        <div
          title={conversa.motivo || "Aguardando o wa-js ficar pronto"}
          className="flex-none border-b border-line bg-warning/10 px-3 py-1 text-[10.5px] text-warning"
        >
          Identificação aproximada — {conversa.motivo || "carregando…"}
        </div>
      )}

      {tela !== "importar" && (
        <FaixaAutomacao
          sugestoes={sugestoes}
          ultimaDoContato={ultimaDoContato}
          recarregarSugestoes={recarregarSugestoes}
          contato={contato}
        />
      )}

      {tela !== "importar" && contato && (
        <FaixaSugestao
          contato={contato}
          contactId={contato.id}
          sugestoes={sugestoes}
          recarregarSugestoes={recarregarSugestoes}
          recarregar={recarregar}
        />
      )}

      {tela === "importar" ? (
        <ImportarWhatsApp
          aoVoltar={() => setTela("ficha")}
          recarregar={recarregar}
        />
      ) : carregando ? (
        <div className="flex-1">
          <Esqueleto />
        </div>
      ) : !conversa ? (
        <div className="flex-1">
          <Vazio
            titulo="Nenhuma conversa aberta"
            descricao="Abra uma conversa no WhatsApp e a ficha do contato aparece aqui."
          />
        </div>
      ) : conversa.grupo ? (
        <div className="flex-1">
          <Vazio
            titulo="Isto é um grupo"
            descricao="Fichas são de pessoas. Abra a conversa individual de alguém para ver o CRM."
          />
        </div>
      ) : !contato ? (
        <div className="flex-1">
          <Vazio
            titulo="Fora da base"
            descricao="Esta conversa ainda não tem ficha no EmyLeads."
          />
          <Cadastrar conversa={conversa} aoCadastrar={recarregar} />
        </div>
      ) : ficha ? (
        <>
          <div className="scrollbar-fina flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
            <CartaoPerfil
              contato={ficha.contato}
              estagioAtual={estagioAtual}
              foto={foto}
              tags={tags}
              recarregar={recarregar}
            />
            <CartaoFunil
              negocios={ficha.negocios}
              estagios={estagios}
              contactId={ficha.contato.id}
              recarregar={recarregar}
            />
            <CartaoTarefas
              tarefas={ficha.tarefas}
              recarregar={recarregar}
              aoNova={() => setFormulario("tarefa")}
            />
            <CartaoNotas
              notas={ficha.notas}
              recarregar={recarregar}
              aoNova={() => setFormulario("nota")}
            />
            <CartaoNegocios
              negocios={ficha.negocios}
              estagios={estagios}
              recarregar={recarregar}
            />
            <CartaoAcoes aoAbrir={setFormulario} />
          </div>

          <Formularios
            qual={formulario}
            contactId={ficha.contato.id}
            estagios={estagios}
            aoFechar={() => setFormulario(null)}
            recarregar={recarregar}
          />
        </>
      ) : (
        <div className="flex-1">
          <Esqueleto />
        </div>
      )}
    </aside>
  );
}
