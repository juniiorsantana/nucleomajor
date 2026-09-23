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
  preco: {
    html: "<p>Oi, Carla! O valor depende do atendimento. Para eu te passar certinho:</p><ol><li>É a sua primeira consulta com a gente?</li><li>Qual atendimento você procura?</li><li>Prefere vir de manhã ou à tarde?</li></ol>",
    sources: ["Conhecimento", "Qualificação"],
  },
  horario: {
    html: "<p>Consigo pedir um horário para você. Me conta só:</p><ol><li>Prefere manhã ou tarde?</li><li>Qual o melhor dia da semana?</li></ol><p>Passo o pedido para a equipe e você recebe a confirmação por aqui.</p>",
    sources: ["Pedido de agendamento", "Equipe"],
  },
  pessoa: {
    html: "<p>Claro! Já avisei a equipe, e alguém continua com você por aqui.</p><ol><li>O seu histórico segue junto.</li><li>A equipe recebe o resumo da conversa.</li><li>Você não precisa repetir nada.</li></ol>",
    sources: ["Transferência", "Resumo", "Equipe"],
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

// Captação de leads: o popup dos planos e o formulário do fim da página vão
// para `/api/lead`, e o agente da Major chama a pessoa no WhatsApp.
const PLAN_NAMES = {
  base: "Plano Base",
  atendimento: "Plano Atendimento com IA",
  completo: "Plano Completo",
  empresarial: "Plano Empresarial",
};

const leadDialog = document.querySelector("[data-lead-dialog]");

function formatWhatsapp(value) {
  const digits = value.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  const split = digits.length === 11 ? 7 : 6;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, split)}-${digits.slice(split)}`;
}

function showFieldErrors(form, fields = {}) {
  form.querySelectorAll("[data-error-for]").forEach((slot) => {
    const message = fields[slot.dataset.errorFor] || "";
    slot.textContent = message;
    const input = form.elements[slot.dataset.errorFor];
    if (input instanceof HTMLElement) input.toggleAttribute("aria-invalid", Boolean(message));
  });
  const first = Object.keys(fields).map((name) => form.elements[name]).find((input) => input instanceof HTMLElement);
  first?.focus();
}

function showStatus(form, message) {
  const status = form.querySelector("[data-form-status]");
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
}

function localErrors(form) {
  const fields = {};
  if (!form.elements.nome.value.trim()) fields.nome = "Informe seu nome.";
  const digits = form.elements.whatsapp.value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) fields.whatsapp = "Informe um WhatsApp com DDD.";
  const email = form.elements.email.value.trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = "Confira o e-mail.";
  if (!form.elements.consentimento.checked) fields.consentimento = "Autorize o contato pelo WhatsApp.";
  return fields;
}

function resetLeadForm(form) {
  form.reset();
  showFieldErrors(form);
  showStatus(form, "");
  form.querySelector("[data-lead-fields]")?.removeAttribute("hidden");
  form.querySelector("[data-lead-done]")?.setAttribute("hidden", "");
}

document.querySelectorAll("[data-lead-form]").forEach((form) => {
  const whatsapp = form.elements.whatsapp;
  whatsapp?.addEventListener("input", () => {
    whatsapp.value = formatWhatsapp(whatsapp.value);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    if (submit?.disabled) return;

    const errors = localErrors(form);
    showFieldErrors(form, errors);
    showStatus(form, "");
    if (Object.keys(errors).length) return;

    const payload = {
      nome: form.elements.nome.value,
      whatsapp: form.elements.whatsapp.value,
      email: form.elements.email.value,
      empresa: form.elements.empresa?.value || "",
      plano: form.elements.plano.value,
      consentimento: form.elements.consentimento.checked,
      site_da_empresa: form.elements.site_da_empresa?.value || "",
    };

    if (submit) submit.disabled = true;
    try {
      const response = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        const done = form.querySelector("[data-lead-done]");
        if (done) {
          form.querySelector("[data-lead-fields]")?.setAttribute("hidden", "");
          done.removeAttribute("hidden");
          done.querySelector("button")?.focus();
        } else {
          form.reset();
          showStatus(form, "Recebemos o seu contato. Em poucos minutos você recebe uma mensagem nossa no WhatsApp.");
        }
        return;
      }
      if (body.fields) showFieldErrors(form, body.fields);
      showStatus(form, body.error || "Não foi possível enviar agora. Tente de novo em instantes.");
    } catch {
      showStatus(form, "Sem conexão no momento. Confira a internet e tente de novo.");
    } finally {
      if (submit) submit.disabled = false;
    }
  });
});

document.querySelectorAll("[data-plan-open]").forEach((button) => {
  button.addEventListener("click", () => {
    const plan = button.dataset.planOpen;
    if (!leadDialog || typeof leadDialog.showModal !== "function") {
      const select = document.querySelector('#contato select[name="plano"]');
      if (select) select.value = plan;
      document.querySelector("#contato")?.scrollIntoView();
      return;
    }
    const form = leadDialog.querySelector("[data-lead-form]");
    resetLeadForm(form);
    form.querySelector("[data-lead-plan]").value = plan;
    leadDialog.querySelector("[data-lead-plan-name]").textContent = PLAN_NAMES[plan] || "Planos";
    leadDialog.showModal();
    form.elements.nome.focus();
  });
});

leadDialog?.querySelectorAll("[data-lead-close]").forEach((button) => {
  button.addEventListener("click", () => leadDialog.close());
});

// Clique fora do cartão fecha; o `dialog` ocupa a tela inteira com o fundo.
leadDialog?.addEventListener("click", (event) => {
  if (event.target === leadDialog) leadDialog.close();
});
