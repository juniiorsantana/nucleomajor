# ADR-0001 — Supabase como fonte de verdade

Estado: aceito em 2026.

## Contexto

O produto nasceu com dados locais, vault Markdown e IndexedDB. Isso não atende
multiempresa, equipe simultânea, RLS ou operação independente do computador.

## Decisão

Supabase Auth e Postgres são a fonte de verdade para identidade, CRM, agenda,
conhecimento, inteligência, handoff e configuração. Estado local serve apenas
como cache, fila ou sessão de integração.

## Consequências

- toda operação precisa de organização e política de acesso;
- migrations são parte do contrato do produto;
- runtime falha fechado se não validar contexto;
- extensão e portal convergem para os mesmos dados;
- Markdown local não substitui agenda ou tarefa.

## Alternativas rejeitadas

- banco por navegador: sem colaboração e segurança central;
- vault como fonte operacional: sem integridade relacional e RLS;
- banco isolado por cliente nesta etapa: custo operacional prematuro.
