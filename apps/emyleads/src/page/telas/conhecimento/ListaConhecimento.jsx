import { AlertTriangle, BookOpen, ChevronRight, FileText } from "lucide-react";
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
 * As cores dos dois eixos.
 *
 * Público e situação nunca compartilham cor: se "Clientes" e "Publicado"
 * fossem ambos verdes, a linha viraria duas manchas iguais e a pessoa
 * pararia de ler qual é qual. Público usa a escala fria da marca; situação
 * usa verde para no ar e âmbar para fora do ar.
 */
const COR_DO_PUBLICO = {
  clientes: "var(--el-accent)",
  equipe: "var(--el-sub)",
  pessoal: "var(--el-faint)",
};

const COR_DA_SITUACAO = {
  publicado: "var(--el-success)",
  rascunho: "var(--el-warning)",
};

const tingir = (cor, forca = 14) => ({
  backgroundColor: `color-mix(in srgb, ${cor} ${forca}%, var(--el-bg))`,
  color: cor,
});

function Etiqueta({ texto, cor, titulo }) {
  return (
    <span
      title={titulo}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
      style={tingir(cor)}
    >
      {texto}
    </span>
  );
}

function Skills({ nomes }) {
  if (!nomes.length) {
    return <span className="text-[10.5px] italic text-faint">nenhuma skill ainda</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {nomes.slice(0, 2).map((nome) => (
        <span key={nome} className="rounded-[6px] bg-surface px-1.5 py-0.5 text-[10.5px] text-sub">{nome}</span>
      ))}
      {nomes.length > 2 && <span className="text-[10.5px] text-faint">+{nomes.length - 2}</span>}
    </span>
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
        <div className="hidden grid-cols-[minmax(0,1fr)_120px_110px_150px_150px_36px] items-center gap-3 border-b border-line px-4 py-2.5 lg:grid">
          {["Documento", "Quem pode usar", "Situação", "Usado por", "Atualizado", ""].map((coluna, indice) => (
            <span key={coluna || indice} className="text-[10px] font-bold uppercase tracking-[.09em] text-faint">{coluna}</span>
          ))}
        </div>

        {documentos.length === 0 ? (
          <div className="p-10 text-center">
            <BookOpen size={26} className="mx-auto text-faint" />
            <p className="mt-3 text-[13px] font-medium text-fg">Nada aqui com esse filtro</p>
            <p className="mt-1 text-[11.5px] text-sub">Tente outro filtro ou limpe a busca.</p>
          </div>
        ) : documentos.map((documento) => {
          const publico = publicoDoDocumento(documento);
          const situacao = situacaoDoDocumento(documento);
          const revisar = precisaRevisao(documento, agora);
          const skills = skillsDoDocumento(documento);
          const autor = nomeDoAutor(documento.atualizadoPor);
          const apoio = revisar
            ? `sem alteração há ${diasSemAlteracao(documento, agora)} dias — vale revisar antes de continuar em uso`
            : resumoDoConteudo(documento.conteudo);

          return (
            <button
              key={documento.id}
              type="button"
              onClick={() => onAbrir(documento)}
              className="grid w-full grid-cols-1 items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-surface-hover lg:grid-cols-[minmax(0,1fr)_120px_110px_150px_150px_36px]"
            >
              <span className="flex min-w-0 items-start gap-2.5">
                {revisar
                  ? <AlertTriangle size={15} className="mt-0.5 flex-none text-danger" />
                  : <FileText size={15} className="mt-0.5 flex-none text-accent-forte" />}
                <span className="min-w-0">
                  <strong className="block truncate text-[13px] font-semibold text-fg">{documento.titulo}</strong>
                  {apoio && (
                    <small className={`mt-0.5 block truncate text-[11px] ${revisar ? "text-danger" : "text-sub"}`}>
                      {apoio}
                    </small>
                  )}
                </span>
              </span>

              <span className="flex flex-wrap items-center gap-1.5">
                <Etiqueta
                  texto={PUBLICO_POR_ID.get(publico)?.rotulo}
                  cor={COR_DO_PUBLICO[publico]}
                  titulo={PUBLICO_POR_ID.get(publico)?.consequencia}
                />
                <span className="lg:hidden">
                  <Etiqueta texto={situacao === "publicado" ? "Publicado" : "Rascunho"} cor={COR_DA_SITUACAO[situacao]} />
                </span>
              </span>

              <span className="hidden lg:block">
                <Etiqueta texto={situacao === "publicado" ? "Publicado" : "Rascunho"} cor={COR_DA_SITUACAO[situacao]} />
              </span>

              <span className="hidden lg:block"><Skills nomes={skills} /></span>

              <span className="truncate text-[11px] text-sub">
                {tempoRelativo(documento.atualizadoEm, agora)}{autor ? ` · ${autor}` : ""}
              </span>

              <ChevronRight size={16} className="hidden text-faint lg:block" />
            </button>
          );
        })}
      </div>
    </>
  );
}
