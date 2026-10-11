import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { BotaoPrimario } from "../../ui";
import { nomeSemNumero } from "./estadoDaConexao";

// Cabe no cartão sem cortar no celular. O banco aceita até 120.
export const TAMANHO_MAXIMO_DO_NOME = 60;

const BOTAO_SECUNDARIO =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-ctl border border-line px-3.5 text-[13px] font-medium text-sub transition-colors hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Mudar o nome da conexão: o rótulo da empresa ("Atendimento Major"), e não o
 * número. O número tem linha própria no cartão, vem do WhatsApp conectado e
 * muda sozinho numa troca.
 *
 * Em 10/10/2026, depois da troca da 8362 para o final 5324, o cartão continuou
 * dizendo "WhatsApp principal (8362)". O único campo de nome na tela era o de
 * "Adicionar WhatsApp", que cria outra conexão.
 *
 * O campo abre com o nome que o cartão mostra, já sem o número.
 */
export function MudarNome({ nome, aoSalvar, aoFechar }) {
  const [texto, setTexto] = useState(() => (nome ? nomeSemNumero(nome) : ""));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const idCampo = useId();
  const idDica = useId();
  const campo = useRef(null);

  useEffect(() => {
    campo.current?.focus();
    campo.current?.select();
  }, []);

  const fechar = () => {
    if (!salvando) aoFechar();
  };

  const salvar = async (evento) => {
    evento.preventDefault();
    const limpo = texto.trim();
    if (!limpo) {
      setErro("Escreva um nome para a conexão.");
      return;
    }
    // O mesmo nome que já está gravado: não há o que salvar.
    if (limpo === String(nome || "").trim()) {
      aoFechar();
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      await aoSalvar(limpo);
      aoFechar();
    } catch (e) {
      setErro(e?.message || "Não deu para mudar o nome. Tente de novo.");
      setSalvando(false);
    }
  };

  return (
    <form
      onSubmit={salvar}
      onKeyDown={(evento) => {
        if (evento.key === "Escape") fechar();
      }}
      className="mx-5 mb-4 flex flex-col gap-3 rounded-none border border-line-strong px-4 py-4"
    >
      <div>
        <label htmlFor={idCampo} className="mb-1.5 block text-[13.5px] font-semibold text-fg">
          Nome da conexão
        </label>
        <input
          ref={campo}
          id={idCampo}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setErro("");
          }}
          maxLength={TAMANHO_MAXIMO_DO_NOME}
          autoComplete="off"
          placeholder="Atendimento, Comercial, Suporte…"
          aria-describedby={idDica}
          aria-invalid={erro ? "true" : "false"}
          disabled={salvando}
          className="h-11 w-full rounded-ctl border border-line bg-bg px-3 text-[14px] text-fg outline-none transition-colors placeholder:text-faint focus:border-accent disabled:opacity-60"
        />
        <p id={idDica} className="mt-1.5 text-[11.5px] leading-relaxed text-sub">
          Não precisa pôr o número no nome: ele aparece embaixo e muda sozinho se você trocar de WhatsApp.
        </p>
        {erro && (
          <p role="alert" className="mt-1 text-[11.5px] text-danger">
            {erro}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <BotaoPrimario type="submit" disabled={salvando} className="min-h-11 !py-2.5">
          {salvando && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
          Salvar nome
        </BotaoPrimario>
        <button type="button" onClick={fechar} disabled={salvando} className={BOTAO_SECUNDARIO}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
