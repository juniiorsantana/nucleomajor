const app = document.querySelector("#app");
const params = new URLSearchParams(window.location.search);
const inviteToken = (params.get("token") || "").trim();
const invitedEmail = (params.get("email") || "").trim().toLowerCase();
const STORAGE_KEY = "nucleo-major.portal.session";
let config = null;
let currentSession = null;

function esc(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[character]));
}

function errorMessage(error) {
  const message = String(error?.message || error || "Não foi possível concluir a operação.");
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos.";
  if (/user already registered/i.test(message)) return "Já existe uma conta com este e-mail. Entre na aba “Já tenho acesso”.";
  if (/email not confirmed/i.test(message)) return "Confirme seu e-mail pelo link recebido antes de continuar.";
  if (/password should be at least/i.test(message)) return "Use uma senha com pelo menos 6 caracteres.";
  if (/already a member/i.test(message)) return "Esta conta já participa desta organização. O cargo não pode ser alterado por convite.";
  if (/different email/i.test(message)) return "Entre com a conta do e-mail que recebeu o convite.";
  if (/confirmed email/i.test(message)) return "Confirme seu e-mail antes de aceitar o convite.";
  if (/invalid|not available|cancelled|expired/i.test(message)) return "Este convite está inválido, expirado ou já foi utilizado.";
  return message;
}

async function requestSupabase(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: config.supabasePublishableKey,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.msg || payload?.message || payload?.error_description || "Operação recusada pelo Supabase.");
  return payload;
}

function saveSession(session) {
  currentSession = session;
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

function readStoredSession() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
}

function sessionFromHash() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  const session = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: Number(hash.get("expires_in") || 3600),
    token_type: hash.get("token_type") || "bearer",
  };
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
  return session;
}

async function acceptInvite(token) {
  if (!currentSession?.access_token) throw new Error("Entre ou crie sua conta antes de aceitar o convite.");
  const acceptedOrganizationId = await requestSupabase("/rest/v1/rpc/accept_organization_invite", {
    method: "POST",
    token: currentSession.access_token,
    body: { target_token: token },
  });
  return Array.isArray(acceptedOrganizationId) ? acceptedOrganizationId[0] : acceptedOrganizationId;
}

function inviteCode() {
  return document.querySelector("#invite-code")?.value.trim() || inviteToken;
}

function inviteSummary(email) {
  if (!email) return "";
  return `<div class="invite-summary"><div class="summary-icon" aria-hidden="true">@</div><div><p class="summary-label">Convite enviado para</p><p class="summary-value" title="${esc(email)}">${esc(email)}</p></div></div>`;
}

function setFormBusy(form, busy) {
  form.querySelectorAll("button, input").forEach((element) => { element.disabled = busy || element.dataset.locked === "true"; });
  const button = form.querySelector("button[type=submit]");
  if (button) button.textContent = busy ? "Aguarde…" : form.dataset.submitLabel;
}

function renderIntro() {
  app.innerHTML = `
    <p class="card-kicker">Portal do profissional</p>
    <h2>Entre no Núcleo Major</h2>
    <p class="intro-copy">Abra o link recebido por e-mail para continuar. Se você recebeu apenas o código reserva, use-o abaixo.</p>
    <details class="code-block" open>
      <summary>Tenho um código de convite</summary>
      <form id="code-form">
        <label class="field"><span class="field-label">Código reserva</span><input id="invite-code" autocomplete="one-time-code" placeholder="Cole o código do e-mail" required /></label>
        <label class="field"><span class="field-label">E-mail convidado</span><input id="code-email" type="email" autocomplete="email" placeholder="voce@empresa.com.br" required /></label>
        <button class="primary-button" type="submit">Continuar</button>
      </form>
    </details>
  `;
  app.querySelector("#code-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const code = app.querySelector("#invite-code").value.trim();
    const email = app.querySelector("#code-email").value.trim().toLowerCase();
    if (!code || !email) return;
    window.location.assign(`/convite?token=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`);
  });
}

function renderAuth() {
  const email = invitedEmail;
  app.innerHTML = `
    <p class="card-kicker">Convite confirmado</p>
    <h2>Escolha como entrar</h2>
    <p class="intro-copy">Use o e-mail convidado para manter o acesso correto à organização. Se você já usa o EmyLeads, entre sem criar outra conta.</p>
    ${inviteSummary(email)}
    <div class="mode-switch" role="tablist" aria-label="Forma de acesso">
      <button type="button" role="tab" aria-selected="true" data-mode="signup">Criar minha conta</button>
      <button type="button" role="tab" aria-selected="false" data-mode="login">Já tenho acesso</button>
    </div>
    <form id="auth-form" data-submit-label="Criar conta">
      <div id="name-field"><label class="field"><span class="field-label">Seu nome</span><input id="full-name" autocomplete="name" placeholder="Como a equipe deve chamar você?" required /></label></div>
      <label class="field"><span class="field-label">E-mail</span><input id="auth-email" type="email" value="${esc(email)}" autocomplete="email" ${email ? "readonly data-locked=true" : "required"} placeholder="voce@empresa.com.br" /></label>
      <label class="field"><span class="field-label">Senha</span><input id="password" type="password" minlength="6" autocomplete="new-password" placeholder="No mínimo 6 caracteres" required /></label>
      <div id="auth-error" class="form-error" hidden></div>
      <button class="primary-button" type="submit">Criar conta</button>
    </form>
    <p class="field-hint">Ao continuar, você aceita usar o Núcleo Major para colaborar com sua organização.</p>
  `;

  const form = app.querySelector("#auth-form");
  const nameField = app.querySelector("#name-field");
  const password = app.querySelector("#password");
  const error = app.querySelector("#auth-error");
  let mode = "signup";

  app.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    mode = button.dataset.mode;
    app.querySelectorAll("[data-mode]").forEach((item) => item.setAttribute("aria-selected", String(item.dataset.mode === mode)));
    nameField.hidden = mode === "login";
    app.querySelector("#full-name").required = mode === "signup";
    password.autocomplete = mode === "login" ? "current-password" : "new-password";
    form.dataset.submitLabel = mode === "login" ? "Entrar e aceitar convite" : "Criar conta";
    form.querySelector("button[type=submit]").textContent = form.dataset.submitLabel;
    error.hidden = true;
  }));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    setFormBusy(form, true);
    const formEmail = app.querySelector("#auth-email").value.trim().toLowerCase();
    try {
      if (mode === "signup") {
        const redirect = `${window.location.origin}/convite?token=${encodeURIComponent(inviteCode())}&email=${encodeURIComponent(formEmail)}`;
        const query = `?redirect_to=${encodeURIComponent(redirect)}`;
        const result = await requestSupabase(`/auth/v1/signup${query}`, { method: "POST", body: { email: formEmail, password: password.value, data: { full_name: app.querySelector("#full-name").value.trim() } } });
        if (!result?.session) {
          renderMessage("Confira seu e-mail", `Enviamos um link de confirmação para <strong>${esc(formEmail)}</strong>. Abra-o para concluir sua entrada na organização.`, "confirmation");
          return;
        }
        saveSession(result.session);
      } else {
        const result = await requestSupabase("/auth/v1/token?grant_type=password", { method: "POST", body: { email: formEmail, password: password.value } });
        saveSession(result);
      }
      await finishInvite();
    } catch (requestError) {
      error.textContent = errorMessage(requestError);
      error.hidden = false;
      setFormBusy(form, false);
    }
  });
}

function renderMessage(title, copy, kind = "success") {
  app.innerHTML = `<div class="${kind === "confirmation" ? "success-panel" : "success-panel"}"><div class="success-mark" aria-hidden="true">${kind === "confirmation" ? "✉" : "✓"}</div><p class="card-kicker">Núcleo Major</p><h2>${title}</h2><p class="intro-copy">${copy}</p>${kind === "confirmation" ? "<p class=\"field-hint\">Depois da confirmação, você voltará para esta página automaticamente.</p>" : ""}</div>`;
}

async function finishInvite() {
  const token = inviteCode();
  if (!token) throw new Error("O código do convite não foi encontrado.");
  const organizationId = await acceptInvite(token);
  renderMessage("Você está dentro.", `Sua conta foi adicionada à organização. Acesse o EmyLeads para começar a trabalhar com a equipe. <span class="field-hint">Organização: ${esc(organizationId || "confirmada")}</span>`);
}

async function initialize() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível carregar a configuração do portal.");
    config = await response.json();
    const hashSession = sessionFromHash();
    if (hashSession) saveSession(hashSession);
    else currentSession = readStoredSession();

    if (!inviteToken && !currentSession) {
      renderIntro();
      return;
    }
    if (inviteToken && currentSession) {
      try { await finishInvite(); return; } catch (error) {
        renderAuth();
        const authError = app.querySelector("#auth-error");
        if (authError) { authError.textContent = errorMessage(error); authError.hidden = false; }
        return;
      }
    }
    if (inviteToken) renderAuth();
    else renderIntro();
  } catch (error) {
    app.innerHTML = `<p class="card-kicker">Núcleo Major</p><h2>Não foi possível abrir</h2><p class="intro-copy">${esc(errorMessage(error))}</p><button class="secondary-button" onclick="location.reload()">Tentar novamente</button>`;
  }
}

initialize();
