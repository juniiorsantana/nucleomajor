# Aplicação manual — faxina do gatilho de realtime

Migration: `supabase/migrations/20260911050000_a_faxina_do_gatilho_nao_pode_travar_a_escrita.sql`

Aplicação em produção é sempre manual, pelo SQL Editor. A prova comportamental
fica em [`README-prova-faxina-do-gatilho.md`](./README-prova-faxina-do-gatilho.md)
e **deve rodar antes** — esta migration nunca passou por um Postgres até lá.

## Antes de colar

Confira que o banco vivo é o que a migration espera. Uma consulta só:

```sql
select
  (select pg_get_functiondef(p.oid) like '%skip locked%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'portal_realtime_notify')
    as gatilho_ja_consertado,
  (select md5(replace(prosrc, chr(13), ''))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'portal_realtime_notify')
    as gatilho_corpo_antes,
  (select md5(replace(prosrc, chr(13), ''))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_runtime_commands_claim')
    as reserva_corpo_antes,
  (select count(*) from public.portal_realtime_events) as eventos,
  (select count(*) from public.portal_realtime_events
    where created_at < now() - interval '7 days') as eventos_vencidos;
```

`gatilho_ja_consertado` tem de vir **`false`**. Se vier `true`, a migration já
foi aplicada e ela própria vai abortar — não insista.

Guarde os dois `md5` e as duas contagens: são a referência do depois.

## Colar

O arquivo inteiro, de uma vez. É **uma transação só** (`begin` … `commit`): se
qualquer guarda ou asserção falhar, nada é aplicado e o banco não fica pela
metade.

Mensagens possíveis, e o que significam:

| Mensagem | Significado |
|---|---|
| `ABORTADA: ... ja foi consertada` | já aplicada antes; nada a fazer |
| `ABORTADA: o corpo vivo do gatilho nao tem a faxina...` | o gatilho vivo não é o que esta migration conhece — parar e conferir |
| `FALHOU: ...` | a migration se recusou a deixar o resultado errado no ar |

## Depois de colar

```sql
select
  (select pg_get_functiondef(p.oid) like '%for update skip locked%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'portal_realtime_notify')
    as gatilho_consertado,
  (select substring(pg_get_functiondef(p.oid) from 'with vencidos as.*?from vencidos')
            like '%for update skip locked%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'nucleo_runtime_commands_claim')
    as varredura_consertada,
  (select count(*) from public.portal_realtime_events) as eventos,
  (select count(*) from pg_trigger
    where not tgisinternal
      and tgfoid = 'private.portal_realtime_notify'::regproc) as gatilhos_ligados;
```

Esperado: as duas primeiras `true`, `gatilhos_ligados` = **9**, e `eventos` no
mesmo patamar de antes menos os vencidos (a faxina nova roda na primeira
escrita que acontecer).

O `md5` do corpo **vai divergir** do que a prova registrar no cluster
descartável: colar pelo SQL Editor a partir do Windows grava com CRLF. Já
aconteceu na 13B e na 13C. A conferência que vale é a do corpo normalizado,
`md5(replace(prosrc, chr(13), ''))`.

## Como saber se resolveu

Não é no banco que se vê — é no log do runtime. Antes da correção:

```
"Supabase recusou reserva de comandos do runtime (HTTP 500, código 40P01)"
```

Depois, esses dois eventos param de aparecer com `40P01`:

```bash
journalctl --user -u 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service' \
  --since '1 hour ago' --no-pager -o cat | grep -E 'sync_failed|commands_unavailable'
```

Referência do estrago antes: `conversation.sync_failed` 414 em 08/09, 1413 em
09/09 e 1001 em 10/09; `runtime.commands_unavailable` 87 em 24h.

## Rollback

Não há `down`. Voltar é reaplicar o corpo antigo das duas funções — o de
`private.portal_realtime_notify` está em
`supabase/migrations/20260823030000_fase_f_web.sql:124` e o de
`public.nucleo_runtime_commands_claim` em
`supabase/migrations/20260826010000_vps_operator_verification_commands.sql:167`,
os dois exatamente como estão lá.

Mas pense duas vezes: voltar é reintroduzir o deadlock. A correção não muda o
que as funções fazem, só o que elas aceitam esperar.
