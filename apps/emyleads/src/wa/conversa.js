/**
 * Quem é a conversa aberta.
 *
 * Duas fontes, e a ordem entre elas importa mais do que parece:
 *
 * 1. **Cabeçalho do DOM** — instantâneo, mas só devolve o nome. É por onde
 *    sempre começamos, porque o painel não pode ficar vazio esperando.
 * 2. **wa-js** (via chat-inject no mundo principal) — devolve o `waId`, a
 *    identidade real do WhatsApp. Leva segundos para ficar pronto, e assume o
 *    lugar do cabeçalho assim que chega.
 *
 * Começamos degradado e MELHORAMOS. A versão anterior escolhia a fonte uma vez
 * só, logo na montagem — e como o wa-js ainda não estava pronto naquele
 * instante, a extensão ficava presa no cabeçalho para sempre. "Escolher uma
 * vez" é previsível e estava errado: o certo é servir o que dá agora e trocar
 * quando o bom aparecer.
 *
 * @typedef {Object} ConversaAtiva
 * @property {string|null} waId
 * @property {string|null} telefone
 * @property {string} nome
 * @property {boolean} grupo
 * @property {boolean} degradado
 * @property {string|null} motivo  por que está degradado, quando se sabe
 */

import { normalizePhone } from "../lib/phone";
import { perguntar } from "./ponte";
import { achar, SELETORES } from "./seletores";

const INTERVALO_DEGRADADO = 800;

/* ------------------------------------------------------------------ */
/* Modo degradado: só o cabeçalho                                      */
/* ------------------------------------------------------------------ */

const pareceTelefone = (s) => /^\+?[\d\s()\-.]{8,}$/.test(String(s).trim());

/**
 * Lê nome (e telefone, quando o contato não está salvo e o WhatsApp mostra o
 * número) do cabeçalho da conversa aberta.
 */
export function lerCabecalho() {
  const cabecalho = achar(SELETORES.cabecalhoConversa);
  if (!cabecalho) return null;

  const el =
    cabecalho.querySelector('span[dir="auto"][title]') ||
    cabecalho.querySelector('span[dir="auto"]');
  const nome = el?.getAttribute("title") || el?.textContent?.trim();
  if (!nome) return null;

  return {
    waId: null,
    telefone: pareceTelefone(nome) ? normalizePhone(nome) : null,
    nome,
    grupo: false, // o cabeçalho não diz; assumir individual é o palpite seguro
  };
}

/**
 * Foto do contato, pegando a que o próprio WhatsApp já carregou no cabeçalho.
 *
 * Vem do DOM mesmo quando o resto vem do wa-js: baixar a foto por conta
 * própria custaria requisição e cache para exibir a mesma imagem que já está
 * na tela. Se o seletor mudar, a ficha cai para as iniciais e nada quebra.
 */
export function fotoDaConversa() {
  const cabecalho = achar(SELETORES.cabecalhoConversa);
  return cabecalho?.querySelector("img")?.src || null;
}

/**
 * Materializa a foto que o WhatsApp expõe como `blob:`.
 *
 * Um blob URL pertence ao documento do WhatsApp e não pode ser reutilizado na
 * página de Gestão, que vive em outra origem. Por isso a imagem é lida aqui,
 * no mesmo contexto que criou o blob, reduzida e devolvida como data URL.
 */
export async function fotoPersistivelDaConversa() {
  const origem = fotoDaConversa();
  if (!origem) return null;
  if (origem.startsWith("data:")) return origem;

  try {
    const resposta = await fetch(origem);
    const blob = await resposta.blob();
    if (!blob.type.startsWith("image/")) return null;

    let final = blob;
    try {
      const bitmap = await createImageBitmap(blob);
      const lado = 256;
      const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * escala));
      canvas.height = Math.max(1, Math.round(bitmap.height * escala));
      const contexto = canvas.getContext("2d");
      contexto.fillStyle = "#ffffff";
      contexto.fillRect(0, 0, canvas.width, canvas.height);
      contexto.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      final = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.82),
      );
    } catch {
      // Se a redução não estiver disponível, ainda tentamos guardar a imagem.
    }

    if (!final) return null;
    return await new Promise((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(leitor.result);
      leitor.onerror = reject;
      leitor.readAsDataURL(final);
    });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/** Motivo da indisponibilidade do wa-js, quando ele avisa. */
let motivo = null;

const bom = (dados) => (dados ? { ...dados, degradado: false, motivo: null } : null);
const fraco = (dados) => (dados ? { ...dados, degradado: true, motivo } : null);

/** Estado atual, uma vez. Cai para o cabeçalho se o wa-js não responder. */
export async function conversaAtiva() {
  try {
    return bom(await perguntar("conversaAtiva"));
  } catch {
    return fraco(lerCabecalho());
  }
}

/**
 * Observa a conversa aberta e chama `aoMudar` a cada troca.
 *
 * Emite na hora, pelo cabeçalho, e troca para o wa-js quando ele avisar que
 * está pronto. Se o wa-js nunca ficar pronto, a sondagem do cabeçalho continua
 * indefinidamente — degradado é um estado de operação, não uma falha.
 *
 * @returns {() => void} função para parar de observar
 */
export function observarConversa(aoMudar) {
  let vivo = true;
  let pararSondagem = null;

  const emitir = (dados) => vivo && aoMudar(dados);

  function sondarCabecalho() {
    let anterior;
    const ler = () => {
      const atual = lerCabecalho();
      const chave = atual ? `${atual.nome}|${atual.telefone}` : "";
      if (chave === anterior) return;
      anterior = chave;
      emitir(fraco(atual));
    };
    ler(); // não espera o primeiro intervalo: o painel precisa mostrar algo já
    const timer = setInterval(ler, INTERVALO_DEGRADADO);
    pararSondagem = () => {
      clearInterval(timer);
      pararSondagem = null;
    };
  }

  function daPagina(e) {
    const d = e.data;
    if (!d || d.source !== "emyleads-page") return;

    if (d.evento === "pronto") {
      // A partir daqui o wa-js manda. O evento "conversa" vem logo atrás.
      pararSondagem?.();
      motivo = null;
      return;
    }

    if (d.evento === "indisponivel") {
      motivo = d.dados?.motivo || null;
      console.warn(
        "[EmyLeads] wa-js indisponível; seguindo pelo cabeçalho do WhatsApp:",
        motivo
      );
      // Reemite para que a interface mostre o motivo, sem esperar o usuário
      // trocar de conversa.
      emitir(fraco(lerCabecalho()));
      return;
    }

    if (d.evento === "conversa") emitir(bom(d.dados));
  }

  window.addEventListener("message", daPagina);
  sondarCabecalho();

  return () => {
    vivo = false;
    pararSondagem?.();
    window.removeEventListener("message", daPagina);
  };
}
