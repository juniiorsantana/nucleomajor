const form = document.querySelector("#lead-form");
const status = document.querySelector("#form-status");
const video = document.querySelector("[data-video-slot] video");
const poster = document.querySelector("[data-video-poster]");

// Adicione o arquivo em public/clinicas/vsl.mp4 quando a VSL estiver aprovada.
fetch("/clinicas/vsl.mp4", { method: "HEAD" }).then((response) => {
  if (!response.ok) return;
  video.src = "/clinicas/vsl.mp4";
  video.hidden = false;
  poster.hidden = true;
}).catch(() => {});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "";
  status.className = "form-status";
  if (!form.reportValidity()) return;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.firstChild.textContent = "Enviando... ";
  const data = Object.fromEntries(new FormData(form));
  data.consent = data.consent === "on";
  data.source = "lp-clinicas-meta";
  const query = new URLSearchParams(location.search);
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"]) {
    data[key] = (query.get(key) || "").slice(0, 200);
  }
  try {
    const response = await fetch("/api/campaign-leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível enviar seus dados.");
    status.textContent = "Recebemos seus dados. Nossa equipe entrará em contato.";
    status.classList.add("success");
    form.reset();
  } catch (error) {
    status.textContent = error.message || "Não foi possível enviar. Tente novamente.";
    status.classList.add("error");
  } finally {
    button.disabled = false;
    button.firstChild.textContent = "Quero conhecer o Núcleo Major ";
  }
});
