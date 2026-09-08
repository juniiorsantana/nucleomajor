import { useMemo, useState } from "react";
import { Loader2, MessageSquarePlus, Search } from "lucide-react";
import { ENTRADA_GESTAO, ModalGestao } from "../gestaoCompartilhados";
import { formatPhone, normalizePhone, variantesBR } from "../../../lib/phone";
import { Iniciais } from "../../ui";
import { conversaDoTelefone } from "./conversasUtils";

/**
 * Começar uma conversa — com quem já está salvo, ou com um número digitado.
 *
 * A caixa de entrada sabia responder e não sabia começar. O botão "+" existia
 * desabilitado desde que a tela subiu, com o título honesto "ainda sem envio
 * para número novo": o que barrava não era o Bridge, era a RPC, que só
 * enfileirava para conversa já espelhada.
 *
 * Duas entradas na mesma caixa, e não duas abas. Quem atende digita o que tem
 * na mão — às vezes o nome de quem já está no CRM, às vezes um número que
 * acabou de chegar por outro canal — e escolher a aba antes de digitar é uma
 * pergunta que a pessoa ainda não sabe responder. A caixa aceita os dois e
 * mostra o que couber.
 *
 * O número é VERIFICADO antes de a conversa nascer, e essa é a decisão que dá
 * forma a esta tela. Sem a verificação, um dígito a mais viraria uma conversa
 * que nunca recebe resposta, ocupando linha na lista para sempre — e a pessoa
 * só descobriria dias depois. A verificação leva alguns segundos, porque
 * atravessa a fila e o Bridge; esperar por ela é mais barato que limpar o
 * engano depois.
 *
 * Conversa que já existe não passa por nada disso: é só abrir a dela. O
 * casamento é por variantes do número, e não por igualdade, porque o nono
 * dígito é a maior fonte de falso negativo num CRM de WhatsApp brasileiro.
 */

/** Quantos contatos a lista mostra antes de pedir que se digite mais. */
const TETO_DA_LISTA = 8;

/**
 * O que aparece quando a verificação não foi um "sim".
 *
 * As três frases levam a ações diferentes, e é por isso que são três: conferir
 * o número com o cliente, pedir que a pessoa abra o WhatsApp dela, ou esperar
 * um minuto. Uma frase só mandaria a maioria fazer a coisa errada.
 */
const AVISOS_DA_VERIFICACAO = {
  not_registered: "Esse número não tem WhatsApp. Confira os dígitos com o cliente.",
  no_internal_lid:
    "O WhatsApp ainda não reconhece esse número. Peça para a pessoa abrir o" +
    " WhatsApp dela e mandar uma mensagem primeiro.",
  indefinido:
    "Não deu para verificar o número agora — o WhatsApp da empresa pode estar" +
    " fora do ar. Tente de novo em um minuto.",
};

function LinhaDeContato({ nome, detalhe, rotulo, aoEscolher }) {
  return (
    <button
      type="button"
      onClick={aoEscolher}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-surface-hover"
    >
      <Iniciais nome={nome} tamanho={32} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium text-fg">{nome}</span>
        {detalhe && <span className="truncate text-[11.5px] text-sub">{detalhe}</span>}
      </span>
      {rotulo && (
        <span className="flex-none rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-semibold text-sub">
          {rotulo}
        </span>
      )}
    </button>
  );
}

export function ModalNovaConversa({
  contatos,
  conversas,
  aoVerificar,
  aoIniciar,
  aoAbrirConversa,
  aoFechar,
}) {
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");

  const termo = busca.trim().toLowerCase();
  const digitados = busca.replace(/\D/g, "");
  // Só vira telefone o que tem cara de telefone. Sem este piso, digitar "99"
  // acenderia a opção de começar uma conversa com o número 99.
  const telefone = digitados.length >= 10 ? normalizePhone(busca) : null;

  /**
   * Os contatos que casam com o que foi digitado.
   *
   * Nome, empresa e telefone — os três porque são os três jeitos de lembrar de
   * alguém, e quem procura pelo número que o cliente mandou por e-mail não
   * deveria precisar saber como ele foi salvo no CRM.
   */
  const achados = useMemo(() => {
    if (!termo) return [];
    return (contatos || [])
      .filter((contato) => {
        const alvo = `${contato.nome || ""} ${contato.empresa || ""}`.toLowerCase();
        if (alvo.includes(termo)) return true;
        if (!digitados) return false;
        return String(contato.telefone || "").replace(/\D/g, "").includes(digitados);
      })
      .slice(0, TETO_DA_LISTA);
  }, [contatos, termo, digitados]);

  /**
   * Abre a conversa de um número.
   *
   * Verifica, cria e seleciona — nessa ordem, e a ordem é a decisão. Verificar
   * DEPOIS de criar deixaria a linha errada na lista mesmo quando a resposta
   * fosse "não", que é exatamente o que esta tela existe para evitar.
   *
   * Conversa que já existe pula a verificação inteira: ela já provou que o
   * número funciona, no dia em que alguém falou com ele.
   */
  const abrir = async (numero, nome = "") => {
    const canonico = normalizePhone(numero);
    if (!canonico) {
      setAviso("Esse número não parece um telefone. Confira o DDD e o DDI.");
      return;
    }

    const existente = conversaDoTelefone(conversas, variantesBR(canonico), variantesBR);
    if (existente) {
      aoAbrirConversa(existente.id);
      aoFechar();
      return;
    }

    setOcupado(true);
    setAviso("");
    try {
      const resposta = await aoVerificar(canonico);
      if (resposta.situacao !== "sim") {
        setAviso(
          AVISOS_DA_VERIFICACAO[resposta.motivo] ||
            AVISOS_DA_VERIFICACAO[resposta.situacao] ||
            AVISOS_DA_VERIFICACAO.indefinido
        );
        setOcupado(false);
        return;
      }
      await aoIniciar({ telefone: canonico, nome });
      aoFechar();
    } catch (falha) {
      setAviso(falha?.message || "Não deu para começar essa conversa.");
      setOcupado(false);
    }
  };

  const detalheDoContato = (contato) =>
    [
      contato.telefone ? formatPhone(normalizePhone(contato.telefone) || contato.telefone) : "",
      contato.empresa,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <ModalGestao titulo="Nova conversa" aoFechar={aoFechar}>
      <div className="px-5 py-4">
        <div className="relative">
          <Search
            size={16}
            strokeWidth={2}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            autoFocus
            value={busca}
            disabled={ocupado}
            onChange={(evento) => {
              setBusca(evento.target.value);
              setAviso("");
            }}
            placeholder="Buscar contato ou digitar um número"
            className={`${ENTRADA_GESTAO} pl-9`}
          />
        </div>

        <div className="mt-3 min-h-[132px]">
          {!termo ? (
            <p className="px-2 py-6 text-center text-[12.5px] text-sub">
              Digite o nome de quem já está no CRM, ou o número com DDD.
            </p>
          ) : (
            <>
              {achados.map((contato) => (
                <LinhaDeContato
                  key={contato.id}
                  nome={contato.nome || contato.telefone || "Sem nome"}
                  detalhe={detalheDoContato(contato)}
                  rotulo={
                    conversaDoTelefone(conversas, variantesBR(contato.telefone), variantesBR)
                      ? "Já tem conversa"
                      : ""
                  }
                  aoEscolher={() => abrir(contato.telefone, contato.nome)}
                />
              ))}

              {/* O número digitado vem depois dos contatos, sempre: quem já
                  está salvo é a resposta mais provável, e oferecer o número cru
                  primeiro faria a pessoa criar uma segunda conversa com alguém
                  que ela já tem na carteira. */}
              {telefone && (
                <>
                  {achados.length > 0 && <div className="my-2 border-t border-line" />}
                  <LinhaDeContato
                    nome={formatPhone(telefone)}
                    detalhe={
                      conversaDoTelefone(conversas, variantesBR(telefone), variantesBR)
                        ? "Já tem conversa — abrir"
                        : "Número novo — começar conversa"
                    }
                    aoEscolher={() => abrir(telefone)}
                  />
                </>
              )}

              {!achados.length && !telefone && (
                <p className="px-2 py-6 text-center text-[12.5px] text-sub">
                  Ninguém com esse nome. Para um número novo, digite com DDD.
                </p>
              )}
            </>
          )}
        </div>

        {ocupado && (
          <p className="mt-1 flex items-center gap-2 text-[12.5px] text-sub">
            <Loader2 size={14} strokeWidth={2.2} className="animate-spin" />
            {/* Dizer o que está acontecendo, e não só que algo está: a espera
                atravessa a fila e o Bridge, e "carregando" por seis segundos
                parece travamento. */}
            Perguntando ao WhatsApp se esse número existe…
          </p>
        )}

        {aviso && !ocupado && (
          <p className="mt-1 rounded-[9px] border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
            {aviso}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3 text-[11.5px] text-faint">
        <MessageSquarePlus size={14} strokeWidth={1.9} className="flex-none" />
        A conversa abre vazia — a primeira mensagem você escreve nela.
      </div>
    </ModalGestao>
  );
}
