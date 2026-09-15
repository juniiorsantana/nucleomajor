// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarComDono, Bolha, Composer, Lightbox, LinhaConversa } from "./pecas";

let container;
let root;

function renderizar(elemento) {
  act(() => root.render(elemento));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("avatar da conversa", () => {
  it("mostra a foto assinada na linha da conversa", () => {
    renderizar(
      <LinhaConversa
        conversa={{
          nome: "Marina Alves",
          fotoUrl: "https://storage.test/avatar.jpg",
          dono: "ia",
          grupo: false,
          naoLidas: 0,
          hora: "10:30",
          previa: "Bom dia",
        }}
        ativa={false}
        aoAbrir={() => {}}
      />
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://storage.test/avatar.jpg"
    );
  });

  it("volta para as iniciais se a imagem não carregar", () => {
    renderizar(
      <AvatarComDono
        nome="Marina Alves"
        foto="https://storage.test/avatar-invalido.jpg"
        dono="humano"
      />
    );

    const imagem = container.querySelector("img");
    expect(imagem).not.toBeNull();

    act(() => imagem.dispatchEvent(new Event("error")));

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("MA");
  });
});

describe("o nome de quem escreveu na bolha", () => {
  const bolha = (mensagem) =>
    renderizar(<Bolha mensagem={mensagem} nomeProprio="Você" aoReenviar={null} />);

  it("mostra o nome que veio do banco", () => {
    bolha({ direcao: "sai", texto: "Oi!", hora: "10:30", tom: "ia", autor: "Bia" });
    expect(container.textContent).toContain("Bia");
  });

  it("sem autoria, a bolha sai sem nome — foi o celular", () => {
    bolha({ direcao: "sai", texto: "respondi daqui", hora: "10:31", tom: null, autor: null });
    expect(container.textContent).not.toContain("Você");
  });

  /**
   * O defeito que este teste existe para impedir.
   *
   * A bolha tinha um recurso para `tom === "humano"` sem nome: usar o nome de
   * quem está OLHANDO a tela. Enquanto a autoria não existia no dado, isso
   * nunca disparava. Com a Fase 2 ele passou a alcançar mensagens espelhadas —
   * e poria "Você" numa mensagem que outra pessoa da equipe mandou. O nome de
   * quem vê só vale para a bolha que ainda não voltou do WhatsApp, porque essa
   * foi escrita aqui, agora, por quem está olhando.
   */
  it("não empresta o nome de quem vê para mensagem de outra pessoa", () => {
    bolha({ direcao: "sai", texto: "já respondi", hora: "10:32", tom: "humano", autor: null });
    expect(container.textContent).not.toContain("Você");
  });

  it("mas a bolha ainda a caminho leva o nome de quem está escrevendo", () => {
    bolha({
      direcao: "sai", texto: "estou enviando", hora: "10:33",
      tom: "humano", autor: null, enviando: true,
    });
    expect(container.textContent).toContain("Você");
  });
});

describe("a mídia dentro da bolha", () => {
  const bolha = (mensagem, aoAbrirMidia = null) =>
    renderizar(
      <Bolha mensagem={mensagem} nomeProprio="Você" aoReenviar={null} aoAbrirMidia={aoAbrirMidia} />
    );

  it("áudio com arquivo vira um player que só baixa ao tocar", () => {
    bolha({
      direcao: "entra", texto: "", hora: "10:30",
      midia: { tipo: "audio", url: "https://storage.test/a.ogg", nome: "a.ogg", mime: "audio/ogg" },
    });
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio.getAttribute("src")).toBe("https://storage.test/a.ogg");
    expect(audio.getAttribute("preload")).toBe("none");
    expect(audio.hasAttribute("controls")).toBe(true);
    expect(container.textContent).not.toContain("🎤");
  });

  it("imagem com arquivo vira miniatura, e o clique pede a tela cheia", () => {
    const abertas = [];
    const midia = { tipo: "imagem", url: "https://storage.test/f.jpg", nome: "f.jpg", mime: "image/jpeg" };
    bolha({ direcao: "entra", texto: "olha isso", hora: "10:30", midia }, (m) => abertas.push(m));
    const imagem = container.querySelector("img");
    expect(imagem.getAttribute("src")).toBe("https://storage.test/f.jpg");
    expect(container.textContent).toContain("olha isso");
    act(() => imagem.closest("button").click());
    expect(abertas).toEqual([midia]);
  });

  it("sem URL a bolha volta ao rótulo, como antes de existir arquivo", () => {
    bolha({ direcao: "sai", texto: "", hora: "10:30", midia: { tipo: "audio", url: null } });
    expect(container.querySelector("audio")).toBeNull();
    expect(container.textContent).toContain("🎤 Áudio");
  });

  it("tipo que a bolha não sabe abrir vira link", () => {
    bolha({
      direcao: "entra", texto: "", hora: "10:30",
      midia: { tipo: "outro", url: "https://storage.test/x.bin", nome: "x.bin", mime: "" },
    });
    const link = container.querySelector("a");
    expect(link.getAttribute("href")).toBe("https://storage.test/x.bin");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("a tela cheia fecha com Esc", () => {
    const fechamentos = [];
    renderizar(
      <Lightbox
        midia={{ tipo: "imagem", url: "https://storage.test/f.jpg", nome: "f.jpg" }}
        aoFechar={() => fechamentos.push(1)}
      />
    );
    expect(container.querySelector("img").getAttribute("src")).toBe("https://storage.test/f.jpg");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(fechamentos).toHaveLength(1);
  });
});

describe("o anexo na caixa de escrita", () => {
  const caixa = (props = {}) =>
    renderizar(
      <Composer
        rascunho=""
        aoMudar={() => {}}
        aoEnviar={() => {}}
        aoEnviarArquivo={props.aoEnviarArquivo || (async () => {})}
        aba={null}
        aoAlternarAba={() => {}}
        aviso={null}
        {...props}
      />
    );

  const escolher = (arquivo) => {
    const entrada = container.querySelector('[data-testid="entrada-de-imagem"]');
    Object.defineProperty(entrada, "files", { value: [arquivo], configurable: true });
    act(() => entrada.dispatchEvent(new Event("change", { bubbles: true })));
  };

  it("sem quem receba o arquivo, o clipe e o microfone ficam desligados", () => {
    caixa({ aoEnviarArquivo: undefined });
    const botoes = [...container.querySelectorAll("button")];
    expect(botoes.find((b) => b.title.startsWith("Anexar")).disabled).toBe(true);
    expect(botoes.find((b) => b.title.startsWith("Gravar")).disabled).toBe(true);
  });

  it("uma imagem escolhida aparece acima da caixa e sai com a legenda pelo botão", async () => {
    const enviados = [];
    caixa({
      rascunho: "legenda aqui",
      aoEnviarArquivo: async (arquivo, legenda) => enviados.push([arquivo.name, legenda]),
    });
    const foto = new File(["x"], "foto.jpg", { type: "image/jpeg" });
    escolher(foto);
    expect(container.querySelector('[data-testid="anexo"]')).not.toBeNull();
    expect(container.querySelector("textarea").getAttribute("placeholder")).toContain("Legenda");

    const enviar = [...container.querySelectorAll("button")].find((b) => b.title === "Enviar");
    await act(async () => enviar.click());
    expect(enviados).toEqual([["foto.jpg", "legenda aqui"]]);
    expect(container.querySelector('[data-testid="anexo"]')).toBeNull();
  });

  it("recusa o que não é imagem e o que passa do teto, sem subir nada", () => {
    caixa();
    escolher(new File(["x"], "doc.pdf", { type: "application/pdf" }));
    expect(container.querySelector('[data-testid="anexo"]')).toBeNull();
    expect(container.textContent).toContain("Só JPG, PNG ou WebP");

    const grande = new File(["x"], "g.jpg", { type: "image/jpeg" });
    Object.defineProperty(grande, "size", { value: 11 * 1024 * 1024 });
    escolher(grande);
    expect(container.querySelector('[data-testid="anexo"]')).toBeNull();
    expect(container.textContent).toContain("passa de 10 MB");
  });

  it("o anexo pode ser removido antes de sair", () => {
    caixa();
    escolher(new File(["x"], "foto.png", { type: "image/png" }));
    const remover = [...container.querySelectorAll("button")].find((b) => b.title === "Remover anexo");
    act(() => remover.click());
    expect(container.querySelector('[data-testid="anexo"]')).toBeNull();
  });

  it("se o envio falha, o anexo fica para a nova tentativa", async () => {
    caixa({ aoEnviarArquivo: async () => { throw new Error("fila fora"); } });
    escolher(new File(["x"], "foto.jpg", { type: "image/jpeg" }));
    const enviar = [...container.querySelectorAll("button")].find((b) => b.title === "Enviar");
    await act(async () => enviar.click());
    expect(container.querySelector('[data-testid="anexo"]')).not.toBeNull();
  });

  it("grava, para e o áudio vira anexo para ouvir antes de enviar", async () => {
    let gravadorCriado;
    class GravadorFalso {
      static isTypeSupported(tipo) { return tipo === "audio/webm;codecs=opus"; }
      constructor(stream, opcoes) {
        this.stream = stream;
        this.mimeType = opcoes?.mimeType || "";
        this.state = "inactive";
        gravadorCriado = this;
      }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["opus"], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    const trilhas = [{ stop: vi.fn() }];
    vi.stubGlobal("MediaRecorder", GravadorFalso);
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => trilhas })) },
    });
    try {
      caixa();
      const gravar = [...container.querySelectorAll("button")].find((b) => b.title === "Gravar áudio");
      expect(gravar.disabled).toBe(false);
      await act(async () => gravar.click());
      expect(container.querySelector('[data-testid="gravando"]')).not.toBeNull();
      expect(gravadorCriado.mimeType).toBe("audio/webm;codecs=opus");

      const parar = [...container.querySelectorAll("button")].find((b) => b.title === "Parar gravação");
      await act(async () => parar.click());
      expect(trilhas[0].stop).toHaveBeenCalled();
      expect(container.querySelector('[data-testid="gravando"]')).toBeNull();
      const anexo = container.querySelector('[data-testid="anexo"]');
      expect(anexo).not.toBeNull();
      expect(anexo.querySelector("audio")).not.toBeNull();
      expect(anexo.textContent).toContain("Ouça antes de enviar");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("descartar a gravação solta o microfone e não deixa anexo", async () => {
    class GravadorFalso {
      static isTypeSupported() { return true; }
      constructor() { this.state = "inactive"; }
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.onstop?.(); }
    }
    const trilhas = [{ stop: vi.fn() }];
    vi.stubGlobal("MediaRecorder", GravadorFalso);
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => trilhas })) },
    });
    try {
      caixa();
      const gravar = [...container.querySelectorAll("button")].find((b) => b.title === "Gravar áudio");
      await act(async () => gravar.click());
      const descartar = [...container.querySelectorAll("button")].find((b) => b.title === "Descartar gravação");
      await act(async () => descartar.click());
      expect(trilhas[0].stop).toHaveBeenCalled();
      expect(container.querySelector('[data-testid="anexo"]')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("microfone negado vira aviso, e não erro solto", async () => {
    vi.stubGlobal("MediaRecorder", class { static isTypeSupported() { return true; } });
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn(async () => { throw new Error("NotAllowed"); }) },
    });
    try {
      caixa();
      const gravar = [...container.querySelectorAll("button")].find((b) => b.title === "Gravar áudio");
      await act(async () => gravar.click());
      expect(container.textContent).toContain("não liberou o microfone");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
