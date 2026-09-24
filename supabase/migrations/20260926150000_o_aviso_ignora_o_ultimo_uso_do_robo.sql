-- O aviso de realtime também ignora o "último uso" da credencial do robô.
--
-- Depois de 20260926140000 (24/09/2026), os avisos de `conversas` sem mudança
-- sumiram, e sobrou um ritmo alto no tópico `connections`: ~38 avisos por
-- minuto POR conexão, ~110 mil por dia com duas. A causa:
-- `public.nucleo_runtime_commands_claim`, chamada pela VPS a cada 2 s, termina
-- com `update public.connection_robot_credentials set last_used_at = now()`,
-- e `connection_robot_credentials` tem o gatilho de realtime. Cada busca de
-- comandos virava um aviso — uma mensagem de Realtime para cada portal aberto
-- (limite de 2 milhões por mês no plano gratuito) e uma recarga da conexão.
--
-- O portal só usa `last_used_at` para escrever "usado há X" na tela Conexões
-- (`Conexoes.jsx`), que se acerta sempre que a tela carrega. Não precisa de
-- aviso a cada 2 s. Continua avisando tudo o que muda de verdade na conexão:
-- status, heartbeat (a cada 20 s), comandos, conversas.
--
-- A única troca no corpo de 20260926140000: a comparação que ignora
-- `updated_at` passa a ignorar também `last_used_at`. Entre as nove tabelas
-- com o gatilho, só `connection_robot_credentials` tem essa coluna.

-- Aborta se a função em produção não for a de 20260926140000.
do $$
declare corpo text;
begin
  select pg_catalog.replace(p.prosrc, chr(13), '') into corpo
  from pg_catalog.pg_proc p
  where p.oid = 'private.portal_realtime_notify()'::regprocedure;
  if corpo is null
    or corpo not like '%(pg_catalog.to_jsonb(new) - ''updated_at'') = (pg_catalog.to_jsonb(old) - ''updated_at'')%'
    or corpo not like '%interval ''1 day''%'
    or corpo not like '%for update skip locked%' then
    raise exception 'abortado: private.portal_realtime_notify nao e a de 20260926140000; conferir antes de reescrever';
  end if;
end;
$$;

create or replace function private.portal_realtime_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Update que não muda nada além de `updated_at` não é notícia: a sincronia
  -- das conversas regrava o lote inteiro a cada 15 s. Nem o `last_used_at` da
  -- credencial do robô, que a busca de comandos grava a cada 2 s.
  if tg_op = 'UPDATE'
    and (pg_catalog.to_jsonb(new) - 'updated_at' - 'last_used_at')
      = (pg_catalog.to_jsonb(old) - 'updated_at' - 'last_used_at') then
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.portal_realtime_events (organization_id, topic, entity_id)
    values (
      old.organization_id,
      tg_argv[0],
      coalesce(
        nullif(to_jsonb(old)->>'id', '')::uuid,
        nullif(to_jsonb(old)->>'connection_id', '')::uuid
      )
    );
  else
    insert into public.portal_realtime_events (organization_id, topic, entity_id)
    values (
      new.organization_id,
      tg_argv[0],
      coalesce(
        nullif(to_jsonb(new)->>'id', '')::uuid,
        nullif(to_jsonb(new)->>'connection_id', '')::uuid
      )
    );
  end if;

  -- A tabela e um sinal efemero, nao historico de auditoria: o portal so
  -- escuta INSERT ao vivo. Um dia basta.
  --
  -- E a limpeza dela nao pode derrubar quem escreveu: `skip locked` faz esta
  -- transacao nunca esperar por linha velha que outra ja tenha em maos, e o
  -- teto impede que uma faxina atrasada segure a escrita de quem a disparou.
  -- O que sobrar sai no proximo evento -- e ha um evento a cada escrita.
  delete from public.portal_realtime_events evento
  using (
    select velho.id
    from public.portal_realtime_events velho
    where velho.created_at < now() - interval '1 day'
    order by velho.created_at, velho.id
    for update skip locked
    limit 200
  ) alvo
  where evento.id = alvo.id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function private.portal_realtime_notify() is
  'Grava o aviso de realtime do portal. Ignora update que so muda updated_at ou last_used_at; faxina de 1 dia com skip locked. Ver 20260911050000, 20260926140000 e 20260926150000.';
