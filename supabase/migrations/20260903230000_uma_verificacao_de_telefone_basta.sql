-- Verificar o telefone uma vez basta.
--
-- Havia duas verificações com o mesmo nome, e a equipe passou pela primeira
-- achando que tinha passado pelas duas:
--
--   `whatsapp_connection_operators.verified_at` — autoriza a pessoa a COMANDAR
--   o assistente pelo WhatsApp. Os três fizeram, entre 23 e 26/08/2026.
--
--   `calendar_member_preferences.phone_verified_at` — autoriza o produto a
--   MANDAR lembrete para a pessoa. Ninguém fez, e é esta que o worker consulta.
--
-- Pedir o mesmo número duas vezes não protege nada: as duas provam o mesmo
-- fato, que aquele telefone é daquela pessoa. Provado uma vez, vale para as
-- duas.
--
-- A ponte é de MÃO ÚNICA, e de propósito. Operador vira notificação; o
-- contrário, não. Ser operador é um privilégio — quem o tem manda o assistente
-- agir —, e concedê-lo como efeito colateral de alguém pedir lembrete no
-- celular seria abrir a porta pelo lado errado.
--
-- O formato dos dois difere por um caractere e é por isso que a ponte não é
-- uma cópia: o operador guarda `5565...` (sem `+`), e a agenda exige E.164 com
-- `+` (`calendar_member_preferences_check1`). Só a normalização.

begin;

create or replace function private.espelhar_telefone_verificado(
  target_organization uuid,
  target_user uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  numero text;
begin
  -- O mais recente, se houver mais de uma conexão. Uma pessoa pode ter se
  -- verificado em conexões diferentes, e o último ato é o que vale.
  select case when left(operador.phone_e164, 1) = '+'
              then operador.phone_e164
              else '+' || operador.phone_e164 end
  into numero
  from public.whatsapp_connection_operators operador
  where operador.organization_id = target_organization
    and operador.user_id = target_user
    and operador.verified_at is not null
    and operador.status = 'active'
  order by operador.verified_at desc
  limit 1;

  if numero is null or numero !~ '^\+[1-9][0-9]{9,14}$' then
    return;
  end if;

  -- A linha de preferências nasce preguiçosa, no primeiro `calendar_context`.
  -- Quem nunca abriu a Agenda ainda não tem uma, e é justamente quem mais
  -- precisa da ponte.
  insert into public.calendar_member_preferences (organization_id, user_id)
  values (target_organization, target_user)
  on conflict (organization_id, user_id) do nothing;

  -- NÃO sobrescreve verificação existente. Quem já cadastrou um número na
  -- Agenda escolheu aquele de propósito — pode ser outro aparelho, e trocá-lo
  -- por baixo mandaria o lembrete para o telefone errado sem avisar.
  update public.calendar_member_preferences preferencia
  set phone_e164 = numero,
      phone_last4 = right(numero, 4),
      phone_verified_at = now()
  where preferencia.organization_id = target_organization
    and preferencia.user_id = target_user
    and preferencia.phone_verified_at is null;
end;
$$;

-- `whatsapp_enabled` fica FORA da ponte, e continua em `false`.
--
-- Verificar responde "este número é seu?". Ligar responde "você quer receber
-- lembrete aqui?". São perguntas diferentes, e só a primeira já foi feita.
-- Ligar sozinho começaria a mandar mensagem para o telefone PESSOAL de alguém
-- que nunca pediu — e o caminho mais curto para uma equipe silenciar um canal
-- é ele começar a falar sem ser chamado. Na tela vira um clique, com o
-- "Número terminado em XXXX verificado" já verde.

create or replace function private.operador_verificado_espelha_telefone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verified_at is not null and new.status = 'active' then
    perform private.espelhar_telefone_verificado(new.organization_id, new.user_id);
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_operators_espelha_telefone
  on public.whatsapp_connection_operators;
create trigger whatsapp_operators_espelha_telefone
after insert or update of verified_at, status
on public.whatsapp_connection_operators
for each row execute function private.operador_verificado_espelha_telefone();

-- Quem já se verificou antes desta migration não vai se verificar de novo.
select private.espelhar_telefone_verificado(operador.organization_id, operador.user_id)
from (
  select distinct organization_id, user_id
  from public.whatsapp_connection_operators
  where verified_at is not null and status = 'active'
) operador;

commit;
