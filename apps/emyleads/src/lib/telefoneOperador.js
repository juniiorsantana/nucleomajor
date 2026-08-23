import { normalizePhone } from "./phone";

export const PAISES_TELEFONE = [
  { codigo: "BR", ddi: "55", bandeira: "🇧🇷", nome: "Brasil", placeholder: "(66) 99964-0274" },
  { codigo: "PT", ddi: "351", bandeira: "🇵🇹", nome: "Portugal", placeholder: "912 345 678" },
  { codigo: "US", ddi: "1", bandeira: "🇺🇸", nome: "Estados Unidos", placeholder: "(202) 555-0123" },
];

export function paisDoTelefone(codigo) {
  return PAISES_TELEFONE.find((pais) => pais.codigo === codigo) || PAISES_TELEFONE[0];
}

export function formatarEntradaBrasil(valor) {
  let digitos = String(valor || "").replace(/\D/g, "");
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    digitos = digitos.slice(2);
  }
  digitos = digitos.slice(0, 11);
  if (digitos.length <= 2) return digitos ? `(${digitos}` : "";
  const ddd = digitos.slice(0, 2);
  const local = digitos.slice(2);
  if (!local) return `(${ddd}) `;
  if (local.length <= 4) return `(${ddd}) ${local}`;
  const separador = local.length >= 9 ? 5 : 4;
  return `(${ddd}) ${local.slice(0, separador)}-${local.slice(separador)}`;
}

export function formatarEntradaInternacional(valor, pais) {
  let digitos = String(valor || "").replace(/\D/g, "");
  if (digitos.startsWith(pais.ddi) && digitos.length > pais.ddi.length) {
    digitos = digitos.slice(pais.ddi.length);
  }
  return digitos.slice(0, pais.codigo === "US" ? 10 : 9);
}

export function formatarTelefoneOperador(valor, codigoPais) {
  const pais = paisDoTelefone(codigoPais);
  if (pais.codigo === "BR") return formatarEntradaBrasil(valor);
  return formatarEntradaInternacional(valor, pais);
}

export function telefoneOperadorE164(valor, codigoPais) {
  const pais = paisDoTelefone(codigoPais);
  if (pais.codigo === "BR") return normalizePhone(valor);
  const local = formatarEntradaInternacional(valor, pais).replace(/\D/g, "");
  const tamanhoEsperado = pais.codigo === "US" ? 10 : 9;
  return local.length === tamanhoEsperado ? `${pais.ddi}${local}` : null;
}
