// O mesmo começo do app (`web/bootstrap.js`): a configuração pública vem do
// servidor, e só depois o painel carrega — o cliente do Supabase precisa dela.
async function iniciar() {
  try {
    if (!globalThis.__NUCLEO_CONFIG__?.supabaseUrl) {
      const response = await fetch("/api/config", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      if (!response.ok) throw new Error("Não foi possível carregar a configuração pública do painel.");
      globalThis.__NUCLEO_CONFIG__ = await response.json();
    }
    await import("./main.jsx");
  } catch (error) {
    const raiz = document.getElementById("raiz");
    if (raiz) {
      raiz.innerHTML = `
        <main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#f5f6fa;color:#111936;font:16px Inter,system-ui,sans-serif">
          <section style="width:min(100%,520px);padding:32px;border:1px solid #dfe3ec;border-radius:24px;background:#fff">
            <p style="margin:0 0 8px;color:#5946ff;font-weight:700">Núcleo Major</p>
            <h1 style="margin:0 0 12px;font-size:28px">Não foi possível abrir o painel</h1>
            <p style="margin:0;color:#64708a;line-height:1.6">Confira a conexão e tente recarregar a página.</p>
          </section>
        </main>`;
    }
    console.error("[Núcleo Major] painel: bootstrap falhou", error);
  }
}

void iniciar();
