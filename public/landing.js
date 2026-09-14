document.documentElement.classList.add("js");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const progress = document.querySelector("[data-progress]");
const header = document.querySelector("[data-header]");
const productScene = document.querySelector("[data-product-scene]");
let frameRequested = false;

function updatePageMotion() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const ratio = scrollable > 0 ? Math.min(window.scrollY / scrollable, 1) : 0;

  if (progress) progress.style.transform = `scaleX(${ratio})`;
  if (header) header.classList.toggle("scrolled", window.scrollY > 18);

  if (productScene && !reducedMotion.matches) {
    const heroHeight = productScene.closest(".hero")?.offsetHeight || window.innerHeight;
    const shift = Math.max(-24, Math.min(0, window.scrollY * -0.035));
    if (window.scrollY < heroHeight) productScene.style.setProperty("--scene-shift", `${shift}px`);
  }

  frameRequested = false;
}

function requestPageMotion() {
  if (frameRequested) return;
  frameRequested = true;
  window.requestAnimationFrame(updatePageMotion);
}

window.addEventListener("scroll", requestPageMotion, { passive: true });
window.addEventListener("resize", requestPageMotion, { passive: true });
updatePageMotion();

const revealItems = [...document.querySelectorAll("[data-reveal]")];

if (reducedMotion.matches || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("revealed"));
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("revealed");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.14, rootMargin: "0px 0px -8%" },
  );
  revealItems.forEach((item) => revealObserver.observe(item));
}

if (productScene && !reducedMotion.matches && window.matchMedia("(pointer: fine)").matches) {
  const shell = productScene.querySelector(".product-shell");

  productScene.addEventListener("pointermove", (event) => {
    const bounds = productScene.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    shell?.style.setProperty("--tilt-x", `${x * 2.4}deg`);
    shell?.style.setProperty("--tilt-y", `${y * -2}deg`);
  });

  productScene.addEventListener("pointerleave", () => {
    shell?.style.setProperty("--tilt-x", "0deg");
    shell?.style.setProperty("--tilt-y", "0deg");
  });
}

const story = document.querySelector("[data-story]");

if (story) {
  const steps = [...story.querySelectorAll("[data-story-step]")];
  const states = [...story.querySelectorAll("[data-story-state]")];
  const storyProgress = story.querySelector("[data-story-progress]");
  let manualSelectionUntil = 0;

  const activateStoryStep = (index) => {
    steps.forEach((step, stepIndex) => step.classList.toggle("active", stepIndex === index));
    states.forEach((state, stateIndex) => state.classList.toggle("active", stateIndex === index));
    if (storyProgress) storyProgress.style.width = `${((index + 1) / steps.length) * 100}%`;
  };

  steps.forEach((step, index) => {
    const activateManually = () => {
      manualSelectionUntil = performance.now() + 900;
      activateStoryStep(index);
    };

    step.addEventListener("click", activateManually);
    step.tabIndex = 0;
    step.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activateManually();
      }
    });
  });

  if ("IntersectionObserver" in window && !reducedMotion.matches) {
    const stepObserver = new IntersectionObserver(
      (entries) => {
        if (performance.now() < manualSelectionUntil) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) activateStoryStep(Number(visible.target.dataset.storyStep));
      },
      { threshold: [0.35, 0.55, 0.75], rootMargin: "-20% 0px -25%" },
    );
    steps.forEach((step) => stepObserver.observe(step));
  }
}

const answerCopy = {
  today: {
    html: "<p>Há três pontos para acompanhar hoje:</p><ol><li>Confirmar a reunião da Mariana às 14h.</li><li>Revisar a proposta da Astera.</li><li>Retornar para dois contatos que aguardam diagnóstico.</li></ol>",
    sources: ["Agenda", "Tarefas", "Clientes"],
  },
  calendar: {
    html: "<p>Às 15h, Ana e Lucas aparecem disponíveis na agenda da equipe.</p><ol><li>Ana cuida do diagnóstico comercial.</li><li>Lucas acompanha propostas em andamento.</li><li>O compromisso pode incluir os dois participantes.</li></ol>",
    sources: ["Agenda", "Equipe", "Responsabilidades"],
  },
  summary: {
    html: "<p>Mariana está na etapa de proposta e falou com Lucas hoje pela manhã.</p><ol><li>A proposta foi enviada há quatro dias.</li><li>A reunião de amanhã precisa de um novo horário.</li><li>O próximo passo registrado é confirmar a agenda.</li></ol>",
    sources: ["Cliente", "Conversas", "Funil"],
  },
};

const questionButtons = [...document.querySelectorAll("[data-question]")];
const answer = document.querySelector("[data-answer]");
const answerSources = document.querySelector("[data-answer-sources]");

questionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const content = answerCopy[button.dataset.question];
    if (!content || !answer || !answerSources) return;

    questionButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
    });

    answer.classList.remove("updating");
    answer.innerHTML = content.html;
    answerSources.replaceChildren(...content.sources.map((source) => {
      const tag = document.createElement("span");
      tag.textContent = source;
      return tag;
    }));
    window.requestAnimationFrame(() => answer.classList.add("updating"));
  });
});

document.querySelectorAll(".faq-list details").forEach((item) => {
  item.addEventListener("toggle", () => {
    if (!item.open) return;
    document.querySelectorAll(".faq-list details[open]").forEach((openItem) => {
      if (openItem !== item) openItem.removeAttribute("open");
    });
  });
});

const contactForm = document.querySelector("[data-contact-form]");

contactForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const status = contactForm.querySelector("[data-form-status]");
  const note = contactForm.querySelector(".form-note");
  if (status) status.hidden = false;
  if (note) note.hidden = true;
});
