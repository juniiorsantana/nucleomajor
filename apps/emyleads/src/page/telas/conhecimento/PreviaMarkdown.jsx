import { Fragment } from "react";
import { analisarMarkdown, hrefSeguro } from "./markdown";

/**
 * "Como fica lido" — o lado direito do modo Markdown.
 *
 * Renderiza a árvore do analisador como nós React. Nada aqui monta HTML a
 * partir do texto: o conteúdo é escrito por uma pessoa da empresa e lido por
 * outra, e o React escapando tudo é o que garante que um `<script>` colado num
 * documento apareça como texto em vez de rodar.
 */

const TAMANHO_DO_TITULO = { 1: "text-[20px]", 2: "text-[16px]", 3: "text-[14px]", 4: "text-[13px]", 5: "text-[12.5px]", 6: "text-[12px]" };

function Inline({ partes }) {
  return partes.map((parte, indice) => {
    if (parte.tipo === "forte") return <strong key={indice} className="font-semibold text-fg">{parte.texto}</strong>;
    if (parte.tipo === "enfase") return <em key={indice}>{parte.texto}</em>;
    if (parte.tipo === "codigo") {
      return <code key={indice} className="rounded-[5px] bg-surface px-1 py-0.5 font-mono text-[.92em]">{parte.texto}</code>;
    }
    if (parte.tipo === "link") {
      const href = hrefSeguro(parte.href);
      // Destino recusado vira texto comum: some o link, fica a palavra.
      if (!href) return <Fragment key={indice}>{parte.texto}</Fragment>;
      return (
        <a key={indice} href={href} target="_blank" rel="noreferrer noopener" className="text-accent-forte underline underline-offset-2">
          {parte.texto}
        </a>
      );
    }
    return <Fragment key={indice}>{parte.texto}</Fragment>;
  });
}

export default function PreviaMarkdown({ markdown, className = "" }) {
  const blocos = analisarMarkdown(markdown);

  if (!blocos.length) {
    return <p className={`text-[12px] italic text-faint ${className}`}>Nada escrito ainda.</p>;
  }

  return (
    <div className={`text-[12.5px] leading-6 text-sub ${className}`}>
      {blocos.map((bloco, indice) => {
        if (bloco.tipo === "titulo") {
          const Marca = `h${Math.min(6, bloco.nivel + 1)}`;
          return (
            <Marca
              key={indice}
              className={`${TAMANHO_DO_TITULO[bloco.nivel] || "text-[12px]"} mb-1.5 mt-4 font-semibold tracking-tight text-fg first:mt-0`}
            >
              <Inline partes={bloco.partes} />
            </Marca>
          );
        }
        if (bloco.tipo === "lista") {
          const Marca = bloco.ordenada ? "ol" : "ul";
          return (
            <Marca key={indice} className={`mb-3 ml-5 grid gap-1 ${bloco.ordenada ? "list-decimal" : "list-disc"}`}>
              {bloco.itens.map((item, i) => <li key={i}><Inline partes={item} /></li>)}
            </Marca>
          );
        }
        if (bloco.tipo === "codigo") {
          return (
            <pre key={indice} className="scrollbar-fina mb-3 overflow-x-auto rounded-[8px] bg-surface p-3 font-mono text-[11.5px] leading-5">
              {bloco.texto}
            </pre>
          );
        }
        return <p key={indice} className="mb-3 last:mb-0"><Inline partes={bloco.partes} /></p>;
      })}
    </div>
  );
}
