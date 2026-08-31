-- Libera os tópicos `intelligence` e `handoffs` no canal de invalidação do
-- portal.
--
-- 20260823030000 criou `portal_realtime_events` com o check
--
--   check (topic in ('connections', 'operators'))
--
-- porque na época existiam só esses dois avisos. 20260826150000 (fase H,
-- piloto externo) pendurou mais dois gatilhos na MESMA função
-- `private.portal_realtime_notify`, passando tópicos novos por `tg_argv[0]`:
--
--   customer_assistant_pilot_realtime   -> 'intelligence'
--   customer_handoff_requests_realtime  -> 'handoffs'
--
-- e não ampliou a lista. Como os dois gatilhos são `after insert or update or
-- delete` e a função é `security definer`, o insert do evento acontece dentro
-- da transação de quem escreveu na tabela de origem — então a violação do
-- check DERRUBA a escrita original, não só o aviso.
--
-- É por isso que selecionar um contato no modo piloto falha com
-- `new row for relation "portal_realtime_events" violates check constraint
-- "portal_realtime_events_topic_check"`: a linha citada no erro não é a que o
-- portal tentou gravar, é a notificação que o gatilho tentou emitir por causa
-- dela. Pelo mesmo motivo, abrir ou fechar um atendimento humano
-- (`customer_handoff_requests`) está falhando hoje, ainda que ninguém tenha
-- chegado nesse fluxo para ver.
--
-- A correção é ampliar a lista para os quatro tópicos realmente emitidos pelos
-- gatilhos existentes. O check permanece: `topic` é o campo pelo qual o
-- navegador decide o que recarregar, e um valor solto ali vira aviso que nunca
-- é escutado.

begin;

-- O check original é anônimo; `portal_realtime_events_topic_check` é o nome que
-- o Postgres deu por contagem. Derrubar pelo nome presumido deixaria a
-- migration passar em silêncio se a numeração real divergir, e ainda criaria
-- uma segunda constraint ao lado da que continua barrando. A varredura é pela
-- forma: toda constraint de check desta tabela que fale de `topic`. É
-- exatamente uma.
do $$
declare
  antiga record;
  removidas integer := 0;
begin
  for antiga in
    select constraint_row.conname,
           pg_get_constraintdef(constraint_row.oid) as definicao
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.portal_realtime_events'::regclass
      and constraint_row.contype = 'c'
      and strpos(pg_get_constraintdef(constraint_row.oid), 'topic') > 0
  loop
    raise notice 'removendo check de tópico: % => %', antiga.conname, antiga.definicao;
    execute format(
      'alter table public.portal_realtime_events drop constraint %I',
      antiga.conname
    );
    removidas := removidas + 1;
  end loop;
  raise notice 'checks de tópico removidos: %', removidas;
end;
$$;

-- Daqui em diante o check tem nome próprio, para que a próxima mensagem de erro
-- diga qual regra foi violada em vez de um número de ordem.
alter table public.portal_realtime_events
  drop constraint if exists portal_realtime_events_topico;
alter table public.portal_realtime_events
  add constraint portal_realtime_events_topico
  check (topic in ('connections', 'operators', 'intelligence', 'handoffs'));

-- Prova, na mesma transação, de que a lista cobre todos os tópicos que os
-- gatilhos instalados nesta base realmente passam para a função. Se alguma
-- fase futura pendurar mais um gatilho sem ampliar o check, esta verificação
-- falha aqui em vez de falhar na cara do usuário.
do $$
declare
  faltando text;
begin
  select string_agg(distinct emitido.topico, ', ')
  into faltando
  from (
    select split_part(
             encode(trigger_row.tgargs, 'escape'),
             '\000',
             1
           ) as topico
    from pg_trigger trigger_row
    join pg_proc funcao on funcao.oid = trigger_row.tgfoid
    join pg_namespace esquema on esquema.oid = funcao.pronamespace
    where not trigger_row.tgisinternal
      and esquema.nspname = 'private'
      and funcao.proname = 'portal_realtime_notify'
  ) emitido
  where emitido.topico is not null
    and emitido.topico <> ''
    and emitido.topico not in ('connections', 'operators', 'intelligence', 'handoffs');

  if faltando is not null then
    raise exception 'gatilho emite tópico fora do check: %', faltando;
  end if;
end;
$$;

-- E a prova pelo outro lado: uma escrita real no fluxo que quebrou, desfeita
-- ao fim. Sem isto a migration voltaria a ser um texto que ninguém executa.
do $$
declare
  organizacao uuid;
begin
  select id into organizacao from public.organizations limit 1;
  if organizacao is null then
    raise notice 'sem organização para testar; check aplicado sem ensaio';
    return;
  end if;

  with ensaio as (
    insert into public.portal_realtime_events (organization_id, topic)
    values (organizacao, 'intelligence'), (organizacao, 'handoffs')
    returning id
  )
  delete from public.portal_realtime_events
  where id in (select id from ensaio);
end;
$$;

commit;
