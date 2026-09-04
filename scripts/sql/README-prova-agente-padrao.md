# Prova comportamental do agente padrão (FASE C)

Registro de como a FASE C (`is_default` explícito em `assistant_profiles`,
migration `20260904190000_agente_padrao_explicito.sql`) foi validada
**comportamentalmente**, não apenas lida. Ver
`docs/intelligence/MULTI-AGENT-MIGRATION.md` para o desenho completo do
multi-agent e o porquê da ordem das fases.

## Resultado registrado

Executado em 04/09/2026, PostgreSQL 17.6 userspace descartável na VPS
(reprodução detalhada abaixo):

- Migrations até a FASE B (inclusive): **49/49 aplicaram limpas**, do zero.
- Item **A–J** de `prova-agente-padrao.sql`: **PASS** em todos.
- Gatilho de slug (`assistant_profiles_fill_slug`, da FASE B): **PASS**.
- Controle negativo: sabotar o índice parcial reprova só o item C; sabotar a
  UNIQUE de slug reprova só o item E. A prova sabe reprovar, não só imprimir
  PASS.
- Produção: **não alterada** — reconferida somente leitura antes e depois.

## Arquivos

| Arquivo | Papel |
|---|---|
| `harness-supabase-minimo.sql` | Infraestrutura mínima de Supabase (roles, schemas, extensões, `auth`/`storage`) para as migrations reais do repositório compilarem num Postgres cru. **Não** reproduz nem mocka nenhuma regra da FASE B/C — ver o cabeçalho do próprio arquivo. |
| `prova-agente-padrao-seed.sql` | Fixtures em estado **pré-FASE-C**: usuário, perfil e organização fictícios, criados e commitados **antes** da migration da FASE C. Precisa ser um arquivo à parte, com `commit`, porque o item A da prova (backfill vira `is_default = true`) só faz sentido se a linha observada existia antes da migration e sobreviveu a ela — uma transação em `ROLLBACK` não atravessa a migration. |
| `prova-agente-padrao.sql` | A prova A–J, mais o gatilho de slug. O grosso roda dentro de uma transação que termina em `ROLLBACK`; o item A roda fora dela, contra o que o seed deixou. |

Todos os três trazem o aviso **NUNCA EXECUTAR CONTRA PRODUÇÃO** no topo. O
script de prova insere linhas e altera constraints mesmo terminando em
`ROLLBACK` — gatilhos de auditoria disparam, sequências avançam — então
"termina em rollback" não é motivo para rodar contra um banco que importa.

## Sequência de reprodução

Testado num PostgreSQL 17.6 de espaço de usuário (sem root, sem Docker), com
`initdb`/`pg_ctl start -o "-c listen_addresses=''"` e um socket Unix próprio
— nenhuma porta TCP aberta. A versão 17.6 foi escolhida por bater com a
versão de produção conferida na hora (`select version()`).

```
1. criar cluster descartável
   initdb -D <datadir> --auth=trust -E UTF8 --locale=C
   pg_ctl -D <datadir> -o "-k <sockdir> -c listen_addresses=''" start

2. aplicar harness-supabase-minimo.sql

3. aplicar as migrations do repositório, em ordem, até a FASE B inclusive
   (20260904160000_identidade_do_agente_em_assistant_profiles.sql) —
   NÃO aplicar a FASE C ainda

4. executar prova-agente-padrao-seed.sql
   (fixtures em estado pré-C; commita)

5. aplicar a migration da FASE C
   (20260904190000_agente_padrao_explicito.sql)

6. executar prova-agente-padrao.sql

7. destruir o cluster
   pg_ctl -D <datadir> -m immediate stop
   rm -rf <datadir> <sockdir>
```

Detalhe que custou uma iteração: os arquivos saem do Windows com CRLF;
normalizar com `tr -d '\r'` antes de aplicar via `psql -f`.

O seed pré-C (passo 4) é intencional e não pode ser substituído por um
`INSERT` dentro da própria prova: o item A exige que o backfill da FASE C
**encontre** uma linha nascida antes dela, não que a prova finja isso depois.

## Fidelidade do harness

`harness-supabase-minimo.sql` não pretende simular o Supabase inteiro. Ele
existe só para permitir que as migrations reais do repositório sejam
executadas em Postgres descartável. A semântica testada continua vindo das
migrations reais — em especial `20260904160000_identidade_do_agente_em_assistant_profiles.sql`,
`20260904190000_agente_padrao_explicito.sql` e a definição real de
`private.provision_intelligence`, redefinida pela migration da FASE C e
aplicada sem alteração. Detalhes de fidelidade (o que fica de fora e por que
isso não compromete a prova) estão no cabeçalho do próprio harness.

## Onde a prova ainda não chega

A prova cobre o Postgres. Não cobre:

- os resolvedores (`private.intelligence_payload`, `resolve_v2`, `resolve_v3`,
  `nucleo_customer_assistant_access`) — nenhum foi tocado pela FASE C, e
  nenhum lê `is_default` ainda; isso é a FASE D;
- RLS/JWT reais — a prova roda como superusuário;
- a aplicação da FASE C em produção, que continua **não aplicada de
  propósito** até essa etapa ser autorizada separadamente.
