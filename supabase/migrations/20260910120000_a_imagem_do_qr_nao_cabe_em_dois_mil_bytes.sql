begin;

/*
 * A imagem do QR não cabia em dois mil bytes, e ninguém ficava sabendo.
 *
 * `nucleo_runtime_command_complete` recusa qualquer resultado maior que 2048
 * bytes — um teto escrito em 20260826010000, quando todo resultado da fila era
 * um punhado de campos curtos ("enviado", "não tem WhatsApp", um id de
 * handoff). O QR é a primeira coisa que a VPS precisa DEVOLVER e que não é
 * texto curto: o bridge desenha o código em PNG e o entrega como
 * `data:image/png;base64,…`.
 *
 * Medido no próprio `rsc.io/qr` que o bridge usa, com a escala 8 que ele
 * aplica: um código de pareamento do whatsmeow (~170 a 200 caracteres) vira
 * uma imagem de 5,3 KB a 6,1 KB. Sempre mais que o dobro do teto.
 *
 * O efeito era invisível e enganoso, e é por isso que custou dias:
 *
 *   - leitura SEM imagem (`starting_pairing`, `qr_expired`) → payload curto →
 *     concluía normalmente. A fila parecia funcionar.
 *   - leitura COM imagem (`awaiting_qr`) → payload de 5 KB → o banco recusava,
 *     o runtime traduzia a recusa para `unexpected`, e a tela dizia "O QR não
 *     veio". Ou seja: o correio entregava tudo, MENOS a única carga que
 *     importava.
 *
 * Em 10/09/2026 o registro da VPS mostrava a coisa inteira: nove pareamentos
 * abertos, o bridge girando código a cada 20s por dois minutos, dezenas de
 * `connection_pair_qr` concluídos — e nenhum deles com `awaiting_qr`. Todos os
 * que carregavam imagem viraram `runtime.command_failed`.
 *
 * O teto continua existindo, e continua sendo 2048 para todo o resto: ele
 * protege a fila de virar depósito. O que muda é que a leitura do QR — e só
 * ela — tem um teto do tamanho do que ela precisa carregar.
 *
 * 12 KB, e não 8: a 8 KB o teto passaria a depender do comprimento do código
 * que o WhatsApp resolver mandar, e um teto que só falha para alguns códigos é
 * pior que um teto baixo — ele volta a produzir a mesma falha intermitente que
 * este arquivo está consertando. A imagem, de todo modo, não fica na linha:
 * `nucleo_connection_pair_status` a apaga dois minutos depois.
 *
 * A verificação de tamanho passa a acontecer DEPOIS de achar o comando, e não
 * antes: sem o comando não há tipo, e sem tipo não há teto. A troca de ordem
 * não afrouxa nada — um resultado grande num comando que não é do runtime já
 * era recusado pela guarda de reivindicação, que continua na frente.
 */
create or replace function public.nucleo_runtime_command_complete(
  target_command uuid,
  completion_status text,
  completion_error_code text default null,
  completion_result jsonb default '{}'::jsonb,
  runtime_instance uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  robot_org uuid := private.robot_organization();
  robot_connection uuid := private.robot_connection();
  safe_status text := lower(trim(coalesce(completion_status, '')));
  safe_error text := lower(trim(coalesce(completion_error_code, '')));
  command_row public.connection_runtime_commands%rowtype;
  handoff_id uuid;
  previous_status text;
  context_id uuid;
  teto integer;
begin
  if robot_org is null or robot_connection is null then
    raise exception 'robot connection is inactive or revoked';
  end if;
  if safe_status not in ('completed', 'failed') then
    raise exception 'runtime command completion status is invalid';
  end if;
  if safe_error <> '' and safe_error !~ '^[a-z0-9_-]{1,80}$' then
    raise exception 'runtime command error code is invalid';
  end if;
  if jsonb_typeof(coalesce(completion_result, '{}'::jsonb)) <> 'object' then
    raise exception 'runtime command result is invalid';
  end if;

  select command.* into command_row
  from public.connection_runtime_commands command
  where command.id = target_command
    and command.organization_id = robot_org
    and command.connection_id = robot_connection
    and command.status = 'claimed'
    and command.claimed_by = auth.uid()
    and (runtime_instance is null or command.claimed_instance = runtime_instance)
  for update;
  if not found then raise exception 'runtime command is not claimed by this runtime'; end if;

  -- O único resultado que carrega imagem é a leitura do QR. Todo o resto
  -- continua no teto curto de sempre.
  teto := case when command_row.command_type = 'connection_pair_qr'
    then 12288 else 2048 end;
  if octet_length(coalesce(completion_result, '{}'::jsonb)::text) > teto then
    raise exception 'runtime command result is invalid';
  end if;

  if command_row.command_type in ('handoff_close', 'handoff_return_to_ai') then
    handoff_id := nullif(command_row.private_payload ->> 'requestId', '')::uuid;
    previous_status := coalesce(nullif(command_row.private_payload ->> 'previousStatus', ''), 'accepted');
  end if;

  update public.connection_runtime_commands command
  set status = safe_status,
      private_payload = '{}'::jsonb,
      error_code = nullif(safe_error, ''),
      public_result = coalesce(completion_result, '{}'::jsonb),
      completed_at = now(), updated_at = now()
  where command.id = command_row.id;

  if handoff_id is not null then
    select request.context_id into context_id
    from public.customer_handoff_requests request
    where request.id = handoff_id and request.organization_id = robot_org;
    if safe_status = 'completed' then
      update public.customer_handoff_requests
      set status = case when command_row.command_type = 'handoff_close'
            then 'completed' else 'returned' end,
          completed_at = now(), last_error_code = null, updated_at = now()
      where id = handoff_id and organization_id = robot_org;
      update public.conversation_intelligence_contexts
      set state = case when command_row.command_type = 'handoff_close'
            then 'closed' else 'active' end,
          updated_at = now()
      where id = context_id and organization_id = robot_org;
    else
      update public.customer_handoff_requests
      set status = case when previous_status in ('requested', 'accepted')
            then previous_status else 'accepted' end,
          last_error_code = coalesce(nullif(safe_error, ''), 'runtime_failed'),
          updated_at = now()
      where id = handoff_id and organization_id = robot_org;
    end if;
  end if;

  update public.connection_robot_credentials
  set last_used_at = now()
  where auth_user_id = auth.uid() and organization_id = robot_org
    and connection_id = robot_connection and status = 'active';
  return jsonb_build_object(
    'commandId', command_row.id, 'status', safe_status, 'completedAt', now()
  );
end;
$$;

revoke all on function public.nucleo_runtime_command_complete(uuid, text, text, jsonb, uuid) from public;
revoke all on function public.nucleo_runtime_command_complete(uuid, text, text, jsonb, uuid) from anon;
grant execute on function public.nucleo_runtime_command_complete(uuid, text, text, jsonb, uuid) to authenticated;

/*
 * A prova, na mesma transação.
 *
 * A reescrita de uma função inteira para mudar um número é exatamente o tipo
 * de mudança que perde uma linha sem avisar: o handoff que volta para a IA e a
 * credencial que registra uso não têm teste de ponta a ponta, e sumiriam em
 * silêncio.
 */
do $$
declare
  corpo text;
begin
  select p.prosrc into corpo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'nucleo_runtime_command_complete';

  if corpo is null then
    raise exception 'a RPC de conclusao do runtime sumiu';
  end if;

  -- O teto novo existe, o antigo continua sendo o padrão, e o tipo que ganhou
  -- folga é só a leitura do QR.
  if corpo not like '%12288%' then
    raise exception 'o teto da imagem do QR nao esta na funcao';
  end if;
  if corpo not like '%2048%' then
    raise exception 'o teto curto do resto da fila se perdeu';
  end if;
  if corpo not like '%connection_pair_qr%' then
    raise exception 'a folga nao esta amarrada ao comando de leitura do QR';
  end if;
  if corpo like '%connection_pair_start%' then
    raise exception 'abrir pareamento nao devolve imagem e nao pode ter folga';
  end if;

  -- As guardas que estavam aqui antes e que uma reescrita apaga sem erro.
  if corpo not like '%robot connection is inactive or revoked%' then
    raise exception 'a guarda da credencial do robo se perdeu';
  end if;
  if corpo not like '%runtime command is not claimed by this runtime%' then
    raise exception 'a guarda de reivindicacao se perdeu';
  end if;
  if corpo not like '%claimed_by = auth.uid()%' then
    raise exception 'a conclusao deixou de exigir quem reivindicou';
  end if;
  if corpo not like '%customer_handoff_requests%'
    or corpo not like '%conversation_intelligence_contexts%' then
    raise exception 'a reescrita perdeu o desfecho do handoff';
  end if;
  if corpo not like '%connection_robot_credentials%' then
    raise exception 'a reescrita perdeu o registro de uso da credencial';
  end if;
  if corpo not like '%private_payload = ''{}''::jsonb%' then
    raise exception 'a conclusao deixou de apagar o payload privado';
  end if;
end;
$$;

commit;
