import { formatarWhatsApp } from "../../../domain/formatoWhatsApp.js";

/**
 * O texto da mensagem com a formatação do WhatsApp: *negrito*, _itálico_,
 * ~riscado~, ```monoespaçado``` e link clicável. A árvore vem de
 * `domain/formatoWhatsApp.js` e vira elemento React aqui — o texto do cliente
 * nunca passa por `innerHTML`.
 */
export function TextoFormatado({ texto, className = "" }) {
  return <span className={`whitespace-pre-wrap break-words ${className}`}>{desenhar(formatarWhatsApp(texto))}</span>;
}

function desenhar(nos) {
  return nos.map((no, i) => {
    switch (no.tipo) {
      case "negrito":
        return <strong key={i} className="font-semibold">{desenhar(no.filhos)}</strong>;
      case "italico":
        return <em key={i}>{desenhar(no.filhos)}</em>;
      case "riscado":
        return <s key={i}>{desenhar(no.filhos)}</s>;
      case "mono":
        return <code key={i} className="rounded-[3px] bg-current/10 px-1 font-mono text-[0.92em]">{no.texto}</code>;
      case "link":
        return (
          <a key={i} href={no.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">
            {no.texto}
          </a>
        );
      default:
        return no.texto;
    }
  });
}
