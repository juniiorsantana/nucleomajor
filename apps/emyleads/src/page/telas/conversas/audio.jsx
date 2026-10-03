import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

/**
 * O áudio da conversa: o player da bolha e a onda da gravação.
 *
 * Inspirado no Audio Player, no Scrub Bar e no Live Waveform do ElevenLabs UI
 * (MIT), reescrito aqui sem as dependências deles e nas cores da conversa
 * (direção A, 03/10/2026): botão redondo, barra de tempo arrastável, tempo e
 * velocidade.
 *
 * O arquivo continua sendo baixado só quando alguém aperta play
 * (`preload="none"`): uma conversa com trinta áudios não baixa trinta
 * arquivos ao abrir. Por isso a duração só aparece depois do primeiro play;
 * a forma de onda da bolha virá da VPS, junto da transcrição.
 */

const VELOCIDADES = [1, 1.5, 2];

/** As cores do player por bolha: a do cliente (branca), a da equipe (azul profundo), a da IA e a do fluxo. */
const CORES = {
  entra: { botao: "bg-equipe text-on-equipe", cheio: "bg-equipe", trilho: "bg-equipe-trilho", tempo: "text-conversa-sub", chip: "bg-conversa-fundo text-equipe" },
  equipe: { botao: "bg-on-equipe text-equipe", cheio: "bg-on-equipe", trilho: "bg-on-equipe/30", tempo: "text-on-equipe/75", chip: "bg-on-equipe/15 text-on-equipe" },
  ia: { botao: "bg-ia text-white", cheio: "bg-ia", trilho: "bg-ia/25", tempo: "text-conversa-sub", chip: "bg-bg/70 text-ia" },
  bot: { botao: "bg-flow text-white", cheio: "bg-flow", trilho: "bg-flow/25", tempo: "text-conversa-sub", chip: "bg-bg/70 text-flow" },
};

// Um áudio por vez na tela inteira: apertar play num pausa o que tocava.
let tocandoAgora = null;

export const relogioDoAudio = (segundos) => {
  if (!Number.isFinite(segundos) || segundos < 0) return "—:—";
  const s = Math.floor(segundos);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const rotuloDaVelocidade = (v) => `${String(v).replace(".", ",")}×`;

export function PlayerDeAudio({ url, nome = "", tom = "entra", preload = "none", largura = "w-[300px]" }) {
  const audio = useRef(null);
  const [tocando, setTocando] = useState(false);
  const [atual, setAtual] = useState(0);
  const [duracao, setDuracao] = useState(NaN);
  const [velocidade, setVelocidade] = useState(1);
  const [falhou, setFalhou] = useState(false);
  const cores = CORES[tom] || CORES.entra;

  useEffect(() => {
    const el = audio.current;
    if (!el) return undefined;
    const aoTocar = () => {
      if (tocandoAgora && tocandoAgora !== el) tocandoAgora.pause();
      tocandoAgora = el;
      setTocando(true);
    };
    const aoParar = () => setTocando(false);
    const aoTempo = () => setAtual(el.currentTime);
    // O áudio gravado no navegador (webm) chega sem duração: `Infinity` até
    // ser percorrido. Pular para o fim e voltar faz o navegador calcular.
    const aoMetadado = () => {
      if (Number.isFinite(el.duration)) {
        setDuracao(el.duration);
        return;
      }
      const corrigir = () => {
        el.removeEventListener("timeupdate", corrigir);
        setDuracao(el.duration);
        el.currentTime = 0;
      };
      el.addEventListener("timeupdate", corrigir);
      el.currentTime = 1e101;
    };
    const aoMudarDuracao = () => Number.isFinite(el.duration) && setDuracao(el.duration);
    const aoFim = () => {
      setTocando(false);
      setAtual(0);
    };
    const aoErro = () => setFalhou(true);
    el.addEventListener("play", aoTocar);
    el.addEventListener("pause", aoParar);
    el.addEventListener("timeupdate", aoTempo);
    el.addEventListener("loadedmetadata", aoMetadado);
    el.addEventListener("durationchange", aoMudarDuracao);
    el.addEventListener("ended", aoFim);
    el.addEventListener("error", aoErro);
    return () => {
      el.removeEventListener("play", aoTocar);
      el.removeEventListener("pause", aoParar);
      el.removeEventListener("timeupdate", aoTempo);
      el.removeEventListener("loadedmetadata", aoMetadado);
      el.removeEventListener("durationchange", aoMudarDuracao);
      el.removeEventListener("ended", aoFim);
      el.removeEventListener("error", aoErro);
      if (tocandoAgora === el) tocandoAgora = null;
    };
  }, [url]);

  const alternar = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      el.playbackRate = velocidade;
      const promessa = el.play();
      if (promessa?.catch) promessa.catch(() => setFalhou(true));
    } else {
      el.pause();
    }
  };

  const trocarVelocidade = () => {
    const proxima = VELOCIDADES[(VELOCIDADES.indexOf(velocidade) + 1) % VELOCIDADES.length];
    setVelocidade(proxima);
    if (audio.current) audio.current.playbackRate = proxima;
  };

  const pular = (e) => {
    const el = audio.current;
    const alvo = Number(e.target.value);
    if (!el || !Number.isFinite(alvo)) return;
    el.currentTime = alvo;
    setAtual(alvo);
  };

  const temDuracao = Number.isFinite(duracao) && duracao > 0;
  const fracao = temDuracao ? Math.min(1, atual / duracao) : 0;
  const Icone = tocando ? Pause : Play;

  return (
    <span data-testid="player-de-audio" className={`my-0.5 flex max-w-full flex-col gap-1.5 ${largura}`}>
      <audio ref={audio} src={url} preload={preload} aria-label={nome || "Áudio"} className="hidden" />
      <span className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={alternar}
          aria-label={tocando ? "Pausar áudio" : "Tocar áudio"}
          className={`flex h-[38px] w-[38px] flex-none cursor-pointer items-center justify-center rounded-full transition-transform active:scale-95 ${cores.botao}`}
        >
          <Icone size={15} strokeWidth={2.4} fill="currentColor" className={tocando ? "" : "translate-x-[1px]"} />
        </button>
        <span className="relative flex h-6 min-w-0 flex-1 items-center focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-signal">
          <span className={`absolute inset-x-0 h-1 rounded-full ${cores.trilho}`} />
          <span className={`absolute left-0 h-1 rounded-full ${cores.cheio}`} style={{ width: `${fracao * 100}%` }} />
          <span
            className={`absolute h-3 w-3 -translate-x-1/2 rounded-full ${cores.cheio} ${temDuracao ? "" : "opacity-0"}`}
            style={{ left: `${fracao * 100}%` }}
          />
          <input
            type="range"
            min={0}
            max={temDuracao ? duracao : 1}
            step={0.1}
            value={temDuracao ? atual : 0}
            onChange={pular}
            disabled={!temDuracao}
            aria-label="Posição do áudio"
            aria-valuetext={`${relogioDoAudio(atual)} de ${relogioDoAudio(duracao)}`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
          />
        </span>
      </span>
      <span className="flex items-center gap-2 pl-[48px] text-[11px]">
        <span className={`font-mono tabular-nums ${cores.tempo}`}>
          {falhou ? "Não deu para tocar" : tocando || atual > 0 ? `${relogioDoAudio(atual)} / ${relogioDoAudio(duracao)}` : relogioDoAudio(duracao)}
        </span>
        <button
          type="button"
          onClick={trocarVelocidade}
          aria-label={`Velocidade ${rotuloDaVelocidade(velocidade)}`}
          className={`h-[22px] cursor-pointer rounded-full px-2 font-mono text-[11px] font-semibold tabular-nums ${cores.chip}`}
        >
          {rotuloDaVelocidade(velocidade)}
        </button>
      </span>
    </span>
  );
}

/**
 * A onda da gravação, ao vivo, do próprio microfone.
 *
 * Cada barra é o volume de um instante; as mais novas entram pela direita.
 * É o que diz a quem grava que o microfone está pegando — antes era só
 * "Gravando…", e um microfone mudo gravava um minuto de silêncio.
 */
export function OndaAoVivo({ stream, barras = 64 }) {
  const tela = useRef(null);
  useEffect(() => {
    const canvas = tela.current;
    const Contexto = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
    if (!canvas || !stream || !Contexto) return undefined;
    let contexto;
    try {
      contexto = new Contexto();
    } catch {
      return undefined;
    }
    const fonte = contexto.createMediaStreamSource(stream);
    const analisador = contexto.createAnalyser();
    analisador.fftSize = 512;
    fonte.connect(analisador);
    const amostras = new Uint8Array(analisador.fftSize);
    const historico = Array(barras).fill(0);
    const pincel = canvas.getContext("2d");
    let quadro;
    let ultimo = 0;
    const desenhar = (agora) => {
      quadro = requestAnimationFrame(desenhar);
      if (agora - ultimo < 60) return;
      ultimo = agora;
      analisador.getByteTimeDomainData(amostras);
      let soma = 0;
      for (const a of amostras) soma += ((a - 128) / 128) ** 2;
      historico.push(Math.min(1, Math.sqrt(soma / amostras.length) * 4));
      historico.shift();
      const { width, height } = canvas;
      pincel.clearRect(0, 0, width, height);
      pincel.fillStyle = getComputedStyle(canvas).color;
      const passo = width / barras;
      historico.forEach((v, i) => {
        const h = Math.max(3, v * height);
        pincel.fillRect(i * passo, (height - h) / 2, Math.max(2, passo - 2), h);
      });
    };
    quadro = requestAnimationFrame(desenhar);
    return () => {
      cancelAnimationFrame(quadro);
      try {
        fonte.disconnect();
        contexto.close();
      } catch {
        // Já fechado.
      }
    };
  }, [stream, barras]);
  return <canvas ref={tela} width={320} height={28} aria-hidden="true" className="h-7 min-w-0 flex-1 text-danger" />;
}
