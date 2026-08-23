/** Campos e formato do registro técnico de contato.
 *
 * Mantém Gestão e painel olhando para o mesmo contrato. Campos adicionados
 * no futuro aparecem automaticamente, sem a interface precisar conhecer cada
 * integração do WhatsApp.
 */
export function camposTecnicosDoContato(contato = {}) {
  return Object.entries(contato);
}

export function valorTecnico(valor) {
  if (valor === null) return "null";
  if (valor === undefined) return "undefined";
  if (typeof valor === "object") {
    try {
      return JSON.stringify(valor);
    } catch {
      return "[objeto não serializável]";
    }
  }
  return String(valor);
}

export function resumoValorTecnico(valor) {
  const texto = valorTecnico(valor);
  if (texto.startsWith("data:image/")) {
    return `${texto.slice(0, 22)}… (${Math.round(texto.length / 1024)} KB)`;
  }
  return texto;
}

export function fotoPersistidaDoContato(contato = {}) {
  return contato.fotoUrl || contato.foto || contato.avatarUrl || null;
}
