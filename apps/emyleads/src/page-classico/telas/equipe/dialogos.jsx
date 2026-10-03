import { useEffect, useState } from "react";
import { LoaderCircle, Smartphone, UserPlus, X } from "lucide-react";
import {
  PAISES_TELEFONE,
  formatarTelefoneOperador,
  paisDoTelefone,
  telefoneOperadorE164,
} from "../../../lib/telefoneOperador";
import { BotaoPrimario, Seletor } from "../../ui";
import { OPCOES_DE_PAPEL } from "../../../ui/papeis";

/**
 * A moldura dos dois diálogos da Equipe.
 *
 * Convidar e vincular um número eram formulários fixos no meio da tela — o
 * primeiro acima da lista, o segundo dentro de cada linha da tabela de
 * operadores. Ambos ficavam abertos o tempo todo para um uso ocasional, e o
 * segundo era o principal responsável pelos 149px de altura por pessoa.
 */
function Moldura({ titulo, descricao, aoFechar, children }) {
  useEffect(() => {
    const teclado = (e) => { if (e.key === "Escape") aoFechar(); };
    window.addEventListener("keydown", teclado);
    return () => window.removeEventListener("keydown", teclado);
  }, [aoFechar]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0f1424]/55 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="w-full max-w-md rounded-[15px] border border-line bg-bg p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-fg">{titulo}</h2>
            {descricao && <p className="mt-1 text-[12px] leading-relaxed text-sub">{descricao}</p>}
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={aoFechar}
            className="flex-none cursor-pointer rounded-[8px] p-1 text-faint transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function DialogoConvite({ ocupado, aoConvidar, aoFechar }) {
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState("member");

  const enviar = async (evento) => {
    evento.preventDefault();
    if (!email.trim()) return;
    if (await aoConvidar({ email, papel })) aoFechar();
  };

  return (
    <Moldura
      titulo="Convidar alguém para a equipe"
      descricao="O link chega por e-mail e vale por 7 dias. A pessoa pode criar uma conta nova ou entrar com a que já usa."
      aoFechar={aoFechar}
    >
      <form onSubmit={enviar} className="mt-4">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-sub">E-mail de quem entra</span>
          <input
            autoFocus
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="pessoa@empresa.com.br"
            className="w-full rounded-[9px] border border-line bg-bg px-3 py-2.5 text-[13.5px] text-fg outline-none transition-colors focus:border-accent"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-[12px] font-medium text-sub">Entra como</span>
          <Seletor valor={papel} aoMudar={setPapel} opcoes={OPCOES_DE_PAPEL} />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={aoFechar}
            className="cursor-pointer rounded-[9px] border border-line px-3.5 py-2 text-[12px] font-semibold text-sub transition-colors hover:border-line-strong hover:text-fg"
          >
            Cancelar
          </button>
          <BotaoPrimario type="submit" disabled={ocupado || !email.trim()}>
            {ocupado ? <LoaderCircle size={15} className="animate-spin" /> : <UserPlus size={15} />}
            Convidar
          </BotaoPrimario>
        </div>
      </form>
    </Moldura>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Vincular o número pessoal de alguém como identidade de operador.
 *
 * O número principal continua sendo o único que responde: o que se vincula
 * aqui é só por onde o assistente reconhece que é aquela pessoa falando. O
 * diálogo diz isso porque, do lado de fora, "vincular WhatsApp" parece
 * conectar uma segunda linha de atendimento.
 */
export function DialogoWhatsApp({ membro, ocupado, podeEnviar, aoVincular, aoFechar }) {
  const nome = membro.profile?.full_name?.trim() || "esta pessoa";
  const [pais, setPais] = useState("BR");
  const [telefone, setTelefone] = useState("");
  const e164 = telefoneOperadorE164(telefone, pais);

  const enviar = async (evento) => {
    evento.preventDefault();
    if (!e164) return;
    if (await aoVincular({ usuarioId: membro.user_id, nome, telefone: e164 })) aoFechar();
  };

  return (
    <Moldura
      titulo={`Vincular o WhatsApp de ${nome}`}
      descricao="O número principal continua sendo o único que responde. Este número entra só como identidade autorizada — é assim que o assistente sabe que é essa pessoa falando."
      aoFechar={aoFechar}
    >
      <form onSubmit={enviar} className="mt-4">
        <div className="flex items-end gap-2">
          <label className="w-[160px] flex-none">
            <span className="mb-1 block text-[12px] font-medium text-sub">País</span>
            <select
              value={pais}
              onChange={(e) => {
                setPais(e.target.value);
                setTelefone((atual) => formatarTelefoneOperador(atual, e.target.value));
              }}
              aria-label={`País do telefone de ${nome}`}
              className="w-full rounded-[9px] border border-line bg-bg px-2.5 py-2.5 text-[12.5px] text-fg outline-none focus:border-accent"
            >
              {PAISES_TELEFONE.map((item) => (
                <option key={item.codigo} value={item.codigo}>
                  {item.bandeira} +{item.ddi} {item.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[12px] font-medium text-sub">Número pessoal</span>
            <input
              autoFocus
              value={telefone}
              inputMode="tel"
              autoComplete="tel"
              onChange={(e) => setTelefone(formatarTelefoneOperador(e.target.value, pais))}
              placeholder={paisDoTelefone(pais).placeholder}
              aria-label={`Telefone pessoal de ${nome}`}
              className="w-full rounded-[9px] border border-line bg-bg px-3 py-2.5 text-[13.5px] text-fg outline-none transition-colors focus:border-accent"
            />
          </label>
        </div>

        <p className="mt-2.5 text-[11.5px] leading-relaxed text-faint">
          Enviamos um código pelo número principal. {nome} confirma respondendo do próprio
          WhatsApp — a linha atualiza sozinha quando isso acontecer.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={aoFechar}
            className="cursor-pointer rounded-[9px] border border-line px-3.5 py-2 text-[12px] font-semibold text-sub transition-colors hover:border-line-strong hover:text-fg"
          >
            Cancelar
          </button>
          <BotaoPrimario type="submit" disabled={!podeEnviar || !e164 || !!ocupado}>
            {ocupado ? <LoaderCircle size={15} className="animate-spin" /> : <Smartphone size={15} />}
            Enviar código
          </BotaoPrimario>
        </div>

        {!podeEnviar && (
          <p className="mt-2 text-[11.5px] font-medium text-danger">
            A VPS não está disponível para enviar códigos agora.
          </p>
        )}
      </form>
    </Moldura>
  );
}
