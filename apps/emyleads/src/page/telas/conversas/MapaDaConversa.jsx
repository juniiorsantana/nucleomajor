import { Fragment } from "react";
import { coberturaDaNota, etapasDaConversa, notaEmTexto, semNumerosInternos as limpo } from "../../../domain/analiseDaConversa";

// O traço de mão, como num quadro branco. Sem fonte baixada: a do sistema
// que mais parece escrita à mão, e cursiva no resto.
const MAO = { fontFamily: '"Segoe Print", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", cursive' };

// O mapa é uma folha: fica clara também no tema escuro, como papel.
const FUNDO = {
  success: "bg-[#d3f9d8] border-[#1e1e1e]",
  warning: "bg-[#fff3bf] border-[#1e1e1e]",
  danger: "bg-[#ffc9c9] border-[#1e1e1e]",
  forte: "bg-[#ffa8a8] border-[#c92a2a] border-[3px]",
  faint: "bg-[#f8f9fa] border-[#868e96] border-dashed text-[#495057]",
};

function Seta({ vertical = false, tracejada = false, cor = "#1e1e1e" }) {
  return vertical ? (
    <svg width="14" height="40" viewBox="0 0 14 40" aria-hidden="true" className="flex-none">
      <path d="M7 2 L7 32" stroke={cor} strokeWidth="2" strokeLinecap="round" strokeDasharray={tracejada ? "5 5" : undefined} fill="none" />
      <path d="M2 30 L7 38 L12 30 Z" fill={cor} />
    </svg>
  ) : (
    <svg width="44" height="14" viewBox="0 0 44 14" aria-hidden="true" className="flex-none">
      <path d="M2 7 L34 7" stroke={cor} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M32 2 L40 7 L32 12 Z" fill={cor} />
    </svg>
  );
}

/**
 * O mapa da conversa: as etapas em sequência, cada uma colorida pelo estado
 * do critério que a mede, com a marca onde está o gargalo, a nota e o que
 * fazer agora. É a versão para mostrar ao gestor (e, na próxima etapa, para
 * exportar em imagem ou PDF).
 */
export function MapaDaConversa({ nome = "", periodo = "", atendimento, gargalo, acao }) {
  const etapas = etapasDaConversa(atendimento?.criteria || [], gargalo);
  const principais = etapas.filter((etapa) => !etapa.depois);
  const depois = etapas.find((etapa) => etapa.depois);
  const cobertura = coberturaDaNota(atendimento);
  const fundo = (etapa) => FUNDO[etapa.forte ? "forte" : etapa.tom] || FUNDO.faint;

  return (
    <section aria-label="Mapa da conversa" className="rounded-[20px] bg-white p-5 text-[#1e1e1e] lg:p-10" style={MAO}>
      <h2 className="text-[24px] font-bold leading-tight lg:text-[34px]">Mapa da conversa{nome ? ` · ${nome}` : ""}</h2>
      {periodo && <p className="mt-1 text-[15px] text-[#495057] lg:text-[18px]">{periodo}</p>}

      <ol className="mt-8 flex flex-col items-center lg:flex-row lg:items-start">
        {principais.map((etapa, indice) => (
          <Fragment key={etapa.chave}>
            {indice > 0 && (
              <li aria-hidden="true" className="flex justify-center py-1 lg:mt-[100px] lg:py-0">
                <span className="lg:hidden"><Seta vertical /></span>
                <span className="hidden lg:block"><Seta /></span>
              </li>
            )}
            <li className="flex w-full max-w-[260px] flex-col items-center lg:w-auto lg:max-w-none lg:flex-1 lg:basis-0">
              <div className="flex flex-col items-center justify-end lg:h-[74px]">
                {etapa.marca && (
                  <>
                    <span className="text-[20px] font-bold text-[#c92a2a] lg:text-[24px]">{etapa.marca}</span>
                    <Seta vertical cor="#c92a2a" />
                  </>
                )}
              </div>
              <div className={`flex min-h-[96px] w-full flex-col items-center justify-center rounded-[10px] border-2 px-3 py-3 text-center lg:min-h-[112px] ${fundo(etapa)}`}>
                <span className="text-[19px] font-bold leading-tight">{etapa.nome}</span>
                <span className="text-[14px] leading-snug">{etapa.detalhe}</span>
              </div>
              {etapa.nota && <p className="mt-2 text-center text-[14px] leading-snug text-[#495057] lg:mt-3 lg:text-[16px]">{etapa.nota}</p>}
            </li>
          </Fragment>
        ))}
      </ol>

      {depois && (
        <div className="mt-2 flex flex-col items-center lg:mt-4 lg:items-end">
          <div className="flex w-full max-w-[260px] flex-col items-center lg:w-[calc((100%-176px)/5)] lg:max-w-none">
            <Seta vertical tracejada cor="#868e96" />
            <div className={`flex min-h-[80px] w-full flex-col items-center justify-center rounded-[10px] border-2 px-3 py-2 text-center ${fundo(depois)}`}>
              <span className="text-[18px] font-bold leading-tight">{depois.nome}</span>
              <span className="text-[14px] leading-snug">{depois.avaliado ? depois.detalhe : "não avaliado ainda"}</span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-4 lg:mt-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
        <div className="flex flex-col justify-center rounded-[12px] border-2 border-[#1e1e1e] bg-[#e7f5ff] px-5 py-4">
          <span className="text-[34px] font-bold leading-none lg:text-[40px]">{cobertura ? `${atendimento.score}/100` : notaEmTexto(atendimento)}</span>
          {cobertura && (
            <span className="mt-1 text-[16px]">
              {cobertura.porcento}% dos critérios avaliados{cobertura.conclusiva ? "" : " · ainda não conclusiva"}
            </span>
          )}
        </div>
        {acao && (
          <div className="flex flex-col justify-center rounded-[12px] border-2 border-[#1e1e1e] bg-white px-5 py-4">
            <span className="text-[22px] font-bold lg:text-[24px]">Fazer agora</span>
            <span className="text-[16px] leading-snug">{limpo(acao.title || acao.instruction)}</span>
          </div>
        )}
      </div>
    </section>
  );
}
