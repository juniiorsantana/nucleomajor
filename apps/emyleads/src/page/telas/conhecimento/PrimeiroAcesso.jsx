import { ArrowRight, Sparkles } from "lucide-react";
import { MODELO_POR_ID, PRIMEIROS_PASSOS } from "./modelosConhecimento";

/**
 * O primeiro acesso não mostra tela vazia.
 *
 * "Nenhum documento ainda" informa e não ajuda: quem chega aqui não sabe o
 * que um assistente precisa saber. Os três modelos abaixo cobrem a maior
 * parte do que chega pelo WhatsApp, e o texto diz quanto tempo leva — porque
 * a dúvida real de quem hesita é essa.
 */
export default function PrimeiroAcesso({ onCriar, podeEscrever }) {
  return (
    <div className="mx-auto max-w-3xl py-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] bg-accent-soft text-accent-forte">
          <Sparkles size={19} />
        </span>
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-fg">
            Comece ensinando o básico sobre sua empresa.
          </h2>
          <p className="mt-1 text-[12.5px] leading-5 text-sub">
            Com esses três documentos o assistente já responde a maior parte do que chega no WhatsApp.
            Leva uns 10 minutos.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-2.5">
        {PRIMEIROS_PASSOS.map((id, indice) => {
          const modelo = MODELO_POR_ID.get(id);
          return (
            <button
              key={id}
              type="button"
              disabled={!podeEscrever}
              onClick={() => onCriar(id)}
              className="flex items-center gap-4 rounded-[12px] border border-line bg-bg p-4 text-left hover:border-accent hover:bg-surface-hover disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-bg"
            >
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-surface text-[12px] font-bold text-sub">
                {indice + 1}
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-[13.5px] font-semibold text-fg">{modelo.rotulo}</strong>
                <small className="mt-0.5 block text-[11.5px] leading-4 text-sub">{modelo.descricao}</small>
              </span>
              <ArrowRight size={16} className="flex-none text-faint" />
            </button>
          );
        })}
      </div>

      {!podeEscrever && (
        <p className="mt-4 text-center text-[11.5px] text-sub">
          Somente administradores podem criar conhecimento da empresa.
        </p>
      )}
    </div>
  );
}
