// Interações do link na bio. A página funciona sem este arquivo: tudo aqui é
// camada extra (a luz no vidro, o pedido de orçamento, o efeito "PROJETOS" e o
// bento dos projetos).
(() => {
  const menosMovimento = matchMedia("(prefers-reduced-motion: reduce)");
  const comMouse = matchMedia("(hover: hover) and (pointer: fine)");
  const chegada = "cubic-bezier(0.16, 1, 0.3, 1)";
  const deslize = "cubic-bezier(0.65, 0, 0.35, 1)";

  // ---------- Luz no vidro ----------

  // A faixa de luz cruza o vidro de novo quando o mouse entra ou o dedo toca.
  const varrer = (alvo) => {
    if (menosMovimento.matches) return;
    alvo.querySelectorAll(".reflexo").forEach((reflexo) => {
      reflexo.animate(
        [{ transform: "translateX(-130%)" }, { transform: "translateX(130%)" }],
        { duration: 900, easing: chegada },
      );
    });
  };

  document.querySelectorAll("[data-luz]").forEach((alvo) => {
    alvo.addEventListener("pointerenter", (evento) => {
      if (evento.pointerType === "mouse") varrer(alvo);
    });
    alvo.addEventListener("pointerdown", (evento) => {
      if (evento.pointerType !== "mouse") varrer(alvo);
    });
  });

  // No botão, com mouse, a luz acompanha o cursor por dentro do vidro.
  const botao = document.querySelector(".botao");
  if (botao) {
    let quadro = 0;
    botao.addEventListener("pointermove", (evento) => {
      if (evento.pointerType !== "mouse" || !comMouse.matches) return;
      const caixa = botao.getBoundingClientRect();
      // O botão cresce no hover: converte o ponto para a medida sem zoom.
      const escala = botao.offsetWidth / caixa.width;
      const x = (evento.clientX - caixa.left) * escala;
      const y = (evento.clientY - caixa.top) * escala;
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        botao.style.setProperty("--luz-x", `${x}px`);
        botao.style.setProperty("--luz-y", `${y}px`);
      });
    });
  }

  // ---------- Pedido de orçamento ----------

  // "Solicitar orçamento" abre o modal. O envio vai para /api/orcamento, a rota
  // do Núcleo Major que grava o contato no CRM e manda a primeira mensagem no
  // WhatsApp. Sem <dialog> (iOS 15.3 e anteriores) o botão fica como está.
  const modal = document.querySelector("#orcamento");
  const abrirModal = document.querySelector("[data-abrir-orcamento]");
  if (modal && abrirModal && typeof modal.showModal === "function") {
    const form = modal.querySelector(".orcamento-form");
    const enviar = form.querySelector(".orcamento-enviar");
    const textoEnviar = enviar.querySelector(".orcamento-enviar-texto");
    const aviso = form.querySelector(".orcamento-aviso");
    const passoPedido = modal.querySelector('[data-passo="pedido"]');
    const passoPronto = modal.querySelector('[data-passo="pronto"]');
    const campos = {
      nome: form.elements.nome,
      email: form.elements.email,
      whatsapp: form.elements.whatsapp,
      consentimento: form.elements.consentimento,
    };
    let enviando = false;
    let tentou = false;

    // Os dígitos do WhatsApp sem o 55 do Brasil, e a mesma régua do servidor:
    // DDD de 11 a 99; celular com 11 dígitos começando com 9, fixo com 10.
    const digitos = (valor) => {
      const numeros = valor.replace(/\D/g, "");
      return (numeros.length === 12 || numeros.length === 13) && numeros.startsWith("55") ? numeros.slice(2) : numeros;
    };
    const whatsappValido = (valor) => {
      const numeros = digitos(valor);
      if (numeros.length !== 10 && numeros.length !== 11) return false;
      if (numeros.slice(0, 2) < "11") return false;
      return numeros.length === 10 || numeros[2] === "9";
    };
    // (65) 99876-5432. Com dígitos demais o texto fica como veio, para o erro aparecer.
    const formatar = (valor) => {
      const numeros = digitos(valor);
      if (numeros.length > 11) return valor;
      if (numeros.length <= 2) return numeros ? `(${numeros}` : "";
      const resto = numeros.slice(2);
      if (resto.length <= 4) return `(${numeros.slice(0, 2)}) ${resto}`;
      const corte = resto.length > 8 ? 5 : 4;
      return `(${numeros.slice(0, 2)}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
    };

    // A máscara só age digitando no fim do campo. Apagando ela espera, senão o
    // hífen e o parêntese voltariam a cada toque; ao sair do campo, arruma tudo.
    campos.whatsapp.addEventListener("input", (evento) => {
      const campo = campos.whatsapp;
      if (String(evento.inputType || "").startsWith("delete")) return;
      if (campo.selectionStart !== campo.value.length) return;
      campo.value = formatar(campo.value);
    });
    campos.whatsapp.addEventListener("blur", () => {
      if (digitos(campos.whatsapp.value)) campos.whatsapp.value = formatar(campos.whatsapp.value);
    });

    const conferir = () => {
      const erros = {};
      if (campos.nome.value.trim().length < 2) erros.nome = "Informe seu nome.";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(campos.email.value.trim())) erros.email = "Informe um e-mail válido.";
      if (!whatsappValido(campos.whatsapp.value)) erros.whatsapp = "Informe um WhatsApp com DDD.";
      if (!campos.consentimento.checked) erros.consentimento = "Marque a autorização para a Major poder te chamar no WhatsApp.";
      return erros;
    };

    const mostrarErros = (erros) => {
      Object.entries(campos).forEach(([nome, campo]) => {
        const texto = erros[nome] || "";
        if (texto) campo.setAttribute("aria-invalid", "true");
        else campo.removeAttribute("aria-invalid");
        document.getElementById(`orcamento-${nome}-erro`).textContent = texto;
      });
    };

    const focarPrimeiroErro = (erros) => {
      const primeiro = Object.keys(campos).find((nome) => erros[nome]);
      if (primeiro) campos[primeiro].focus();
    };

    // Depois da primeira tentativa, cada erro some assim que o campo é corrigido
    const reconferir = () => {
      if (tentou) mostrarErros(conferir());
    };
    form.addEventListener("input", reconferir);
    form.addEventListener("change", reconferir);

    const ocupado = (sim) => {
      enviando = sim;
      enviar.disabled = sim;
      enviar.setAttribute("aria-busy", String(sim));
      textoEnviar.textContent = sim ? "Enviando…" : "Enviar pedido";
    };

    const mostrarPronto = () => {
      modal.querySelector(".orcamento-numero").textContent = formatar(campos.whatsapp.value);
      passoPedido.hidden = true;
      passoPronto.hidden = false;
      passoPronto.querySelector(".orcamento-titulo").focus();
    };

    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      if (enviando) return;
      tentou = true;
      aviso.textContent = "";
      const erros = conferir();
      mostrarErros(erros);
      if (Object.keys(erros).length) {
        focarPrimeiroErro(erros);
        return;
      }

      ocupado(true);
      const espera = new AbortController();
      const limite = setTimeout(() => espera.abort(), 20000);
      try {
        const resposta = await fetch("/api/orcamento", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome: campos.nome.value,
            email: campos.email.value,
            whatsapp: campos.whatsapp.value,
            consentimento: campos.consentimento.checked,
            site_da_empresa: form.elements.site_da_empresa.value,
          }),
          signal: espera.signal,
        });
        const corpo = await resposta.json().catch(() => ({}));
        if (resposta.ok) {
          mostrarPronto();
          return;
        }
        if (corpo.fields) {
          mostrarErros(corpo.fields);
          focarPrimeiroErro(corpo.fields);
        }
        aviso.textContent = corpo.error || "Não foi possível enviar agora. Tente de novo em instantes.";
      } catch {
        aviso.textContent = "Não deu para falar com o servidor. Confira a internet e tente de novo.";
      } finally {
        clearTimeout(limite);
        ocupado(false);
      }
    });

    const abrir = () => {
      if (modal.open) return;
      // Depois de um pedido enviado, o modal volta limpo
      if (!passoPronto.hidden) {
        form.reset();
        tentou = false;
        mostrarErros({});
        aviso.textContent = "";
        passoPronto.hidden = true;
        passoPedido.hidden = false;
      }
      modal.showModal();
      // Com mouse, o cursor já vai para o nome. No toque, o foco fica no título,
      // para o teclado não cobrir o formulário antes de a pessoa escolher o campo.
      if (comMouse.matches) campos.nome.focus();
      else passoPedido.querySelector(".orcamento-titulo").focus();
    };

    // Fecha com a animação de saída (o CSS a define em [data-saindo]); com
    // menos movimento, de uma vez. O relógio é a reserva caso o fim da
    // animação não chegue.
    let reserva = 0;
    const concluir = () => {
      if (modal.open) modal.close();
    };
    const fechar = () => {
      if (!modal.open || modal.hasAttribute("data-saindo")) return;
      if (menosMovimento.matches) {
        modal.close();
        return;
      }
      modal.setAttribute("data-saindo", "");
      reserva = setTimeout(concluir, 400);
    };
    modal.addEventListener("animationend", (evento) => {
      if (evento.target === modal && /^orcamento-(sai|desce)$/.test(evento.animationName)) concluir();
    });

    abrirModal.addEventListener("click", (evento) => {
      evento.preventDefault();
      abrir();
    });
    modal.querySelectorAll("[data-fechar]").forEach((botao) => botao.addEventListener("click", fechar));

    // Esc fecha com a mesma animação
    modal.addEventListener("cancel", (evento) => {
      evento.preventDefault();
      fechar();
    });

    // Toque no fundo escurecido fecha. O toque precisa começar fora também:
    // arrastar para selecionar um texto e soltar fora não fecha.
    let tocouFora = false;
    modal.addEventListener("pointerdown", (evento) => {
      tocouFora = evento.target === modal;
    });
    modal.addEventListener("click", (evento) => {
      if (tocouFora && evento.target === modal) fechar();
    });

    // Fechado por qualquer caminho (inclusive o segundo Esc, que o navegador
    // não deixa adiar), o modal sai limpo, e o foco volta ao botão que o abriu
    modal.addEventListener("close", () => {
      clearTimeout(reserva);
      modal.removeAttribute("data-saindo");
      abrirModal.focus({ preventScroll: true });
    });
  }

  // ---------- Projetos: o efeito "PROJETOS" ----------

  // O contorno se desenha quando a seção aparece e um feixe de luz passa uma
  // vez pelas letras. Com menos movimento, o contorno já fica inteiro, parado.
  const efeito = document.querySelector(".efeito-projetos");
  if (efeito && !menosMovimento.matches) {
    efeito.dataset.efeito = "aguardando";
    const luz = efeito.querySelector("animateTransform");
    new IntersectionObserver(
      (entradas, observador) => {
        if (!entradas.some((entrada) => entrada.isIntersecting)) return;
        observador.disconnect();
        efeito.dataset.efeito = "ativo";
        if (luz && typeof luz.beginElement === "function") setTimeout(() => luz.beginElement(), 1400);
      },
      { threshold: 0.4 },
    ).observe(efeito);
  }

  // ---------- Projetos: bento que se monta conforme as imagens ----------

  const bento = document.querySelector("[data-bento]");
  if (!bento) return;
  const controle = bento.querySelector(".bento-controle");

  // As imagens vêm das <figure class="peca"> do HTML, cada uma com sua forma:
  // "retrato" (posts 4:5) ou "alta" (telas de site em pé, 9:16).
  const formaDe = new Map();
  const retratos = [];
  const altas = [];
  bento.querySelectorAll(".peca").forEach((peca) => {
    const img = peca.querySelector("img");
    const forma = peca.dataset.forma === "alta" ? "alta" : "retrato";
    formaDe.set(img, forma);
    (forma === "alta" ? altas : retratos).push(img);
    peca.remove();
  });

  // Imagens fora da grade esperam aqui a vez de entrar.
  const reserva = document.createElement("div");
  reserva.className = "bento-reserva";
  bento.prepend(reserva);

  let vagas = []; // { el, forma, img }
  let proxima = 0;
  let passo = 0;

  const numero = (nome) => parseInt(getComputedStyle(bento).getPropertyValue(nome), 10) || 0;

  // A grade tem colunas x linhas células (o CSS define quantas em cada tela).
  // A peça alta ocupa uma coluna inteira e a grande, 2 x 2. Com poucas fotos,
  // entram mais peças grandes para encher a grade; com muitas, só uma, e as
  // fotos que sobram esperam na reserva para entrar deslizando.
  const planejar = (colunas, linhas) => {
    const celulas = colunas * linhas;
    const nAltas = altas.length ? Math.min(altas.length, Math.max(1, Math.floor(colunas / 3))) : 0;
    const livres = celulas - nAltas * linhas;
    let grandes = 0;
    if (colunas >= 4 && linhas === 2 && livres >= 4) {
      const faltam = Math.max(0, livres - retratos.length);
      grandes = Math.min(Math.floor(livres / 4), Math.max(1, Math.ceil(faltam / 3)));
    }
    return { grandes, colunasPequenas: Math.floor((livres - grandes * 4) / linhas), nAltas };
  };

  const montar = () => {
    const colunas = numero("--colunas") || 2;
    const linhas = numero("--linhas") || 2;
    const { grandes, colunasPequenas, nAltas } = planejar(colunas, linhas);

    // Desmonta a grade anterior e devolve as imagens para a reserva
    vagas.forEach((vaga) => vaga.el.remove());
    [...retratos, ...altas].forEach((img) => {
      img.getAnimations().forEach((animacao) => animacao.cancel());
      reserva.append(img);
    });
    vagas = [];

    // Ordem das colunas: grande, coluna de pequenas, alta, grande, ...
    const padrao = ["G", "P", "A", "G", "P", "P", "A", "P"];
    const restam = { G: grandes, P: colunasPequenas, A: nAltas };
    const criar = (tamanho, forma) => {
      const el = document.createElement("div");
      el.className = "vaga";
      el.dataset.tamanho = tamanho;
      bento.insertBefore(el, controle);
      vagas.push({ el, forma, img: null });
    };
    for (let i = 0; restam.G + restam.P + restam.A > 0; i += 1) {
      const tipo = padrao[i % padrao.length];
      if (!restam[tipo]) continue;
      restam[tipo] -= 1;
      if (tipo === "G") criar("grande", "retrato");
      if (tipo === "A") criar("alta", "alta");
      if (tipo === "P") for (let k = 0; k < linhas; k += 1) criar("pequena", "retrato");
    }

    // Preenche as vagas na ordem do HTML
    const filas = { retrato: [...retratos], alta: [...altas] };
    vagas.forEach((vaga) => {
      const img = filas[vaga.forma].shift();
      if (!img) return;
      vaga.el.append(img);
      vaga.img = img;
    });
    proxima = 0;
  };

  const naReserva = (forma) => [...reserva.children].filter((img) => formaDe.get(img) === forma);

  // A imagem nova entra pela direita e a antiga (uma cópia) sai pela esquerda.
  // Com menos movimento, as duas só se cruzam em esmaecimento.
  const deslizar = (vaga, nova) => {
    const antiga = vaga.img;
    const fantasma = antiga ? antiga.cloneNode(false) : null;
    if (fantasma) {
      // A cópia é da imagem que já estava na tela: desenha na hora, sem piscar
      fantasma.alt = "";
      fantasma.loading = "eager";
      fantasma.decoding = "sync";
      vaga.el.append(fantasma);
    }
    vaga.el.append(nova);
    vaga.img = nova;
    const suave = menosMovimento.matches;
    const opcoes = { duration: suave ? 600 : 900, easing: suave ? "ease-in-out" : deslize };
    const entrada = nova.animate(
      suave ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: "translateX(100%)" }, { transform: "translateX(0)" }],
      opcoes,
    );
    const saida = fantasma
      ? fantasma.animate(
          suave ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }],
          opcoes,
        )
      : null;
    return Promise.all([entrada.finished, saida && saida.finished]).finally(() => {
      if (fantasma) fantasma.remove();
    });
  };

  // Uma foto da reserva entra no lugar de uma visível, que volta para a reserva.
  const substituir = async (vaga, nova) => {
    nova.loading = "eager";
    await nova.decode().catch(() => null);
    const antiga = vaga.img;
    const feito = deslizar(vaga, nova);
    if (antiga) reserva.append(antiga);
    return feito;
  };

  // Sem reserva, duas vagas trocam as fotos entre si, as duas deslizando.
  const trocar = (a, b) => {
    const daA = a.img;
    const daB = b.img;
    return Promise.all([deslizar(a, daB), deslizar(b, daA)]);
  };

  const executar = async () => {
    passo += 1;
    const comImagem = vagas.filter((vaga) => vaga.img);
    const deAlta = comImagem.filter((vaga) => vaga.forma === "alta");
    const deRetrato = comImagem.filter((vaga) => vaga.forma === "retrato");

    // De 4 em 4 passos, se houver telas altas esperando, uma delas entra
    const altasEsperando = naReserva("alta");
    if (altasEsperando.length && deAlta.length && passo % 4 === 0) {
      await substituir(deAlta[passo % deAlta.length], altasEsperando[0]);
      return;
    }

    if (!deRetrato.length) return;
    const vaga = deRetrato[proxima % deRetrato.length];
    proxima += 1;
    const esperando = naReserva("retrato");
    if (esperando.length) {
      await substituir(vaga, esperando[0]);
      // Já começa a carregar a próxima da fila
      const seguinte = naReserva("retrato")[0];
      if (seguinte) seguinte.loading = "eager";
    } else if (deRetrato.length > 1) {
      // Pula uma vaga, para a troca não ser sempre com a vizinha
      const outra = deRetrato[(proxima + 1) % deRetrato.length];
      await trocar(vaga, outra === vaga ? deRetrato[proxima % deRetrato.length] : outra);
    }
  };

  let relogio = 0;
  let trocando = false;
  let visivel = false;
  let pairando = false;
  let pausado = false;

  const agendar = () => {
    clearTimeout(relogio);
    if (!visivel || pairando || pausado || document.hidden) return;
    relogio = setTimeout(async () => {
      if (!trocando) {
        trocando = true;
        try {
          await executar();
        } catch {
          // Animação interrompida (a grade foi remontada): segue na próxima
        } finally {
          trocando = false;
        }
      }
      agendar();
    }, menosMovimento.matches ? 7000 : 3200);
  };

  // Para fora da tela, com a aba escondida e enquanto o mouse está em cima.
  new IntersectionObserver(
    ([entrada]) => {
      visivel = entrada.isIntersecting;
      agendar();
    },
    { threshold: 0.25 },
  ).observe(bento);

  document.addEventListener("visibilitychange", agendar);

  bento.addEventListener("pointerenter", (evento) => {
    if (evento.pointerType !== "mouse") return;
    pairando = true;
    agendar();
  });
  bento.addEventListener("pointerleave", (evento) => {
    if (evento.pointerType !== "mouse") return;
    pairando = false;
    agendar();
  });

  // Botão de pausa (aparece só com o script, porque sem ele não há troca).
  controle.hidden = false;
  controle.addEventListener("click", () => {
    pausado = !pausado;
    controle.setAttribute("aria-pressed", String(pausado));
    agendar();
  });

  // A grade muda de colunas em 1000 e 1280 px: remonta quando a tela cruza.
  ["(min-width: 1000px)", "(min-width: 1280px)"].forEach((consulta) => {
    matchMedia(consulta).addEventListener("change", montar);
  });

  montar();
})();
