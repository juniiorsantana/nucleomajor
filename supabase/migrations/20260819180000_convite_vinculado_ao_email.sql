-- Hotfix: o convite passa a valer só para quem foi convidado.
--
-- Antes, `accept_organization_invite` conferia apenas que existia sessão:
--
--     if auth.uid() is null then raise exception 'authentication required'; end if;
--     ...
--     insert into public.organization_members (organization_id, user_id, role)
--     values (convite.organization_id, auth.uid(), convite.role)
--
-- O convite é emitido para um e-mail, mas quem entrava era quem apresentasse o
-- código — sem nenhuma relação entre os dois. Na prática o código era um
-- portador puro: encaminhado por engano, colado no grupo errado ou lido de uma
-- caixa de entrada, ele admitia qualquer pessoa autenticada, com o papel que o
-- convite carregava.
--
-- Isto não tem nada a ver com o robô do Estágio 3. Foi encontrado auditando a
-- superfície para ele, mas afeta pessoas, hoje, e por isso vem antes.
--
-- Duas guardas, e a segunda é a que sustenta a primeira:
--
--   1. o e-mail de quem aceita tem de ser o e-mail do convite;
--   2. esse e-mail tem de estar confirmado.
--
-- Sem (2), (1) é quase cosmética: quem souber o e-mail convidado cria uma conta
-- com ele e aceita o convite alheio. É por isso que a checagem de confirmação
-- mora aqui, e não numa configuração de painel que alguém pode desligar sem
-- perceber o que estava sustentando.
--
-- ATENÇÃO OPERACIONAL: exige confirmação de e-mail ativa no projeto
-- (`enable_confirmations = true`). Com ela desligada, `email_confirmed_at` fica
-- nulo para todo mundo e NINGUÉM aceita convite — o fluxo falha fechado, de
-- propósito. Ver a nota no README.

begin;

create or replace function public.accept_organization_invite(target_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  convite public.organization_invites%rowtype;
  email_atual text;
  confirmado timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  -- Lido de `auth.users`, não do JWT: um token emitido antes de uma troca de
  -- e-mail carregaria o endereço antigo, e é o endereço de agora que importa.
  select lower(trim(u.email)), u.email_confirmed_at
    into email_atual, confirmado
  from auth.users u
  where u.id = auth.uid();

  select * into convite
  from public.organization_invites
  where token_hash = encode(extensions.digest(target_token, 'sha256'), 'hex')
    and accepted_at is null and expires_at > now()
  for update;
  if convite.id is null then raise exception 'invite invalid or expired'; end if;

  if email_atual is null or confirmado is null then
    raise exception 'a confirmed email is required to accept an invite';
  end if;

  -- Erro distinto do 'invalid or expired', e de propósito. Quem chega aqui já
  -- tem um código válido em mãos, então "este código é válido" não é novidade
  -- para um atacante; para a pessoa que se cadastrou com o e-mail errado, é a
  -- única forma de descobrir o que fazer. O e-mail de destino não é revelado.
  if email_atual <> lower(trim(convite.email)) then
    raise exception 'invite issued for a different email';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (convite.organization_id, auth.uid(), convite.role)
  on conflict (organization_id, user_id) do update set status = 'active', role = excluded.role;
  update public.organization_invites set accepted_at = now() where id = convite.id;
  return convite.organization_id;
end;
$$;

revoke all on function public.accept_organization_invite(text) from public;
grant execute on function public.accept_organization_invite(text) to authenticated;

commit;
