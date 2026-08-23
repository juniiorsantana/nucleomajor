export const WORKSPACE_KEY = "emyleads.workspace.atual";

export const webArea = {
  async get(chaves) {
    const lista = Array.isArray(chaves) ? chaves : [chaves];
    return Object.fromEntries(lista.map((chave) => {
      try {
        const valor = localStorage.getItem(chave);
        return [chave, valor == null ? undefined : JSON.parse(valor)];
      } catch {
        return [chave, undefined];
      }
    }));
  },
  async set(valores) {
    for (const [chave, valor] of Object.entries(valores || {})) {
      localStorage.setItem(chave, JSON.stringify(valor));
    }
  },
  async remove(chaves) {
    for (const chave of Array.isArray(chaves) ? chaves : [chaves]) localStorage.removeItem(chave);
  },
};
