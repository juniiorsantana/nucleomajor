import { AlertTriangle, BookOpen, FileText } from "lucide-react";
import {
  FILTROS,
  PUBLICO_POR_ID,
  diasSemAlteracao,
  precisaRevisao,
  publicoDoDocumento,
  resumoDoConteudo,
  situacaoDoDocumento,
  tempoRelativo,
} from "./conhecimentoDados";

/**
 * Uma linha de meta só, não quatro colunas.
 *
 * Público, situação, skills e "atualizado" competiam por atenção em cinco
 * pedaços separados — cada um pedindo para ser lido primeiro. Juntos numa
 * frase só, na ordem em que alguém realmente pergunta ("pra quem isso vale,
 * tá no ar, quem usa, desde quando"), o olho lê uma vez só.
 */
function Meta({ documento, skills, autor, agora }) {
  const publico = PUBLICO_POR_ID.get(publicoDoDocumento(documento))?.rotulo;
  const situacao = situacaoDoDocumento(documento) === "publicado" ? "Publicado" : "Rascunho";
  const usados = skills.length ? `usado por ${skills.slice(0, 2).join(", ")}${skills.length > 2 ? ` +${skills.length - 2}` : ""}` : "nenhum agente ainda";
  const quando = `atualizado ${tempoRelativo(documento.atualizadoEm, agora)}${autor ? ` por ${autor}` : ""}`;
  return (
    <p className="mt-1 truncate text-[11.5px] text-faint">
      {publico} · {situacao} · {usados} · {quando}
    </p>
  );
}

export default function ListaConhecimento({
  documentos, total, filtro, onFiltrar, onAbrir, skillsDoDocumento, nomeDoAutor, agora,
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filtrar conhecimento">
        {FILTROS.map(({ id, rotulo }) => {
          const ativo = filtro === id;
          // "Precisam de revisão" some quando não há nenhum: um filtro que só
          // pode devolver lista vazia é ruído permanente na barra.
          if (id === "revisao" && !total.revisao) return null;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={ativo}
              onClick={() => onFiltrar(id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                ativo
                  ? "border-accent bg-accent text-white"
                  : "border-line bg-bg text-sub hover:bg-surface-hover hover:text-fg"
              }`}
            >
              {rotulo}
              <span className={`tabular-nums text-[10.5px] ${ativo ? "text-white/75" : "text-faint"}`}>
                {total[id] || 0}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 overflow-hidden rounded-[12px] border border-line bg-bg">
        {documentos.length === 0 ? (
          <div className="p-10 text-center">
            <BookOpen size={26} className="mx-auto text-faint" />
            <p className="mt-3 text-[13px] font-medium text-fg">Nada aqui com esse filtro</p>
            <p className="mt-1 text-[11.5px] text-sub">Tente outro filtro ou limpe a busca.</p>
          </div>
        ) : documentos.map((documento) => {
          const revisar = precisaRevisao(documento, agora);
          const skills = skillsDoDocumento(documento);
          const autor = nomeDoAutor(documento.atualizadoPor);
          const resumo = resumoDoConteudo(documento.conteudo);

          return (
            <button
              key={documento.id}
              type="button"
              onClick={() => onAbrir(documento)}
              className="flex w-full items-start gap-2.5 border-b border-line px-4 py-3.5 text-left last:border-b-0 hover:bg-surface-hover"
            >
              {revisar
                ? <AlertTriangle size={15} className="mt-0.5 flex-none text-danger" />
                : <FileText size={15} className="mt-0.5 flex-none text-accent-forte" />}
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[13px] font-semibold text-fg">{documento.titulo}</strong>
                {revisar ? (
                  <small className="mt-0.5 block truncate text-[11px] text-danger">
                    sem alteração há {diasSemAlteracao(documento, agora)} dias — vale revisar antes de continuar em uso
                  </small>
                ) : resumo && (
                  <small className="mt-0.5 block truncate text-[11px] text-sub">{resumo}</small>
                )}
                <Meta documento={documento} skills={skills} autor={autor} agora={agora} />
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
