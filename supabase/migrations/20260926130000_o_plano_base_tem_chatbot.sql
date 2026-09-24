-- O plano Base passa a ter o construtor de fluxos.
--
-- Decisão do dono em 23/09/2026: o construtor de fluxos e as respostas
-- automáticas entram no plano Base (R$ 97); a IA no atendimento continua a
-- partir do Atendimento com IA. Com 20260926100000 o porteiro já sabe rodar
-- fluxo sem IA (`chatbotOnly`); falta o catálogo dizer que o Base tem chatbot.
--
-- Muda uma chave de um plano. Quem já estava no Base passa a ver a tela de
-- Chatbots; o fluxo só roda depois que a conexão dela na VPS for montada com o
-- executor (scripts/vps/provision-connection.sh, que lê esta mesma chave).
-- Nenhuma empresa ganha IA com isto.
--
-- Aplicar pelo SQL Editor.

begin;

do $$
begin
  if not exists (select 1 from public.saas_plans where code = 'base') then
    raise exception 'abortado: o plano base nao existe';
  end if;
  if (select features ->> 'ai_customer' from public.saas_plans where code = 'base') = 'true' then
    raise exception 'abortado: o plano base tem IA para clientes; conferir antes';
  end if;
end;
$$;

update public.saas_plans
set features = features || '{"chatbots": true}'::jsonb
where code = 'base';

do $$
begin
  if (select features ->> 'chatbots' from public.saas_plans where code = 'base') is distinct from 'true'
     or (select features ->> 'ai_customer' from public.saas_plans where code = 'base') = 'true'
     or (select features ->> 'ai_team' from public.saas_plans where code = 'base') = 'true' then
    raise exception 'conferencia: o plano base tem de ter chatbots e continuar sem IA';
  end if;
end;
$$;

commit;
