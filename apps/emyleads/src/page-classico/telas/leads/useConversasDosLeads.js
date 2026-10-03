import { useEffect, useMemo, useState } from "react";
import { api } from "../../../data/client";
import { indiceDeConversas } from "./conversaDoLead";

/**
 * A lista de conversas, carregada uma vez e dividida entre a tela de Leads e
 * a ficha. Abrir a ficha logo depois de ver a lista não pede tudo de novo.
 *
 * Trinta segundos de validade: o suficiente para não repetir o pedido a cada
 * clique, curto o bastante para a situação "Respondeu" não ficar velha.
 */
const VALIDADE_MS = 30_000;
let emCache = { em: 0, conversas: null, pedido: null };

async function carregar(forcar = false) {
  const fresco = emCache.conversas && Date.now() - emCache.em < VALIDADE_MS;
  if (fresco && !forcar) return emCache.conversas;
  if (emCache.pedido) return emCache.pedido;
  emCache.pedido = (async () => {
    try {
      const conversas = await api.conversas.listar();
      emCache = { em: Date.now(), conversas: Array.isArray(conversas) ? conversas : [], pedido: null };
    } catch {
      // Sem WhatsApp (ou na extensão, que não tem conversas): a tela de Leads
      // continua funcionando, só sem a coluna preenchida.
      emCache = { em: Date.now(), conversas: emCache.conversas || [], pedido: null };
    }
    return emCache.conversas;
  })();
  return emCache.pedido;
}

/** Só para os testes: esquece o que foi carregado. */
export function esquecerConversasDosLeads() {
  emCache = { em: 0, conversas: null, pedido: null };
}

export function useConversasDosLeads() {
  const [conversas, setConversas] = useState(emCache.conversas);

  useEffect(() => {
    let vivo = true;
    carregar().then((lista) => vivo && setConversas(lista));
    return () => {
      vivo = false;
    };
  }, []);

  const indice = useMemo(() => indiceDeConversas(conversas), [conversas]);
  return { conversas, indice, carregado: conversas !== null };
}
