async function carregarConfiguracaoPublica() {
  if (globalThis.__NUCLEO_CONFIG__?.supabaseUrl) return;
  const response = await fetch("/api/config", {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Não foi possível carregar a configuração pública do portal.");
  globalThis.__NUCLEO_CONFIG__ = await response.json();
}

async function iniciar() {
  try {
    await carregarConfiguracaoPublica();
    await import("./main.jsx");
  } catch (error) {
    const raiz = document.getElementById("raiz");
    if (raiz) {
      raiz.innerHTML = `
        <main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#f5f5f6;color:#18181b;font:16px -apple-system,"Segoe UI Variable",system-ui,sans-serif">
          <section style="width:min(100%,520px);padding:32px;border:1px solid #e4e4e6;border-radius:0;background:#fff">
            <p style="margin:0 0 8px;color:#2b2c30;font-weight:700;letter-spacing:.08em">Núcleo Major</p>
            <h1 style="margin:0 0 12px;font-size:28px">Não foi possível iniciar o portal</h1>
            <p style="margin:0;color:#5c5c63;line-height:1.6">Confira a conexão e tente recarregar a página.</p>
          </section>
        </main>`;
    }
    console.error("[Núcleo Major] bootstrap falhou", error);
  }
}

void iniciar();
