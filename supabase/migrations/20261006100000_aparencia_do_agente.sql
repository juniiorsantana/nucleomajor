-- A aparência do agente (Sistema Grafite, 02/10/2026).
--
-- Cada agente ganha uma identidade visual: um símbolo quadrado, gerado a partir
-- de uma semente, numa das oito cores da paleta de agentes. Sem esta coluna o
-- portal já mostra o símbolo, derivado do id do agente; com ela, quem cria ou
-- edita o agente escolhe a cor e sorteia outro símbolo, e a escolha fica.
--
-- Forma guardada: {"cor": 1..8, "semente": "texto curto"}. As duas chaves são
-- opcionais: o que faltar continua derivado do id.
--
-- Permissões: desde 20260905160000 a tabela usa privilégio POR COLUNA para
-- `authenticated`. Coluna nova sem grant próprio ficaria só para leitura, e o
-- portal falharia ao salvar a aparência. Por isso os dois grants abaixo.
--
-- Rollback:
--   alter table public.assistant_profiles drop constraint if exists assistant_profiles_appearance_forma;
--   alter table public.assistant_profiles drop column if exists appearance;

alter table public.assistant_profiles
  add column if not exists appearance jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'assistant_profiles_appearance_forma'
      and conrelid = 'public.assistant_profiles'::regclass
  ) then
    alter table public.assistant_profiles
      add constraint assistant_profiles_appearance_forma check (
        jsonb_typeof(appearance) = 'object'
        and (
          not (appearance ? 'cor')
          or (
            jsonb_typeof(appearance -> 'cor') = 'number'
            and (appearance ->> 'cor')::numeric in (1, 2, 3, 4, 5, 6, 7, 8)
          )
        )
        and (
          not (appearance ? 'semente')
          or (
            jsonb_typeof(appearance -> 'semente') = 'string'
            and length(appearance ->> 'semente') <= 32
          )
        )
      );
  end if;
end $$;

grant insert (appearance) on public.assistant_profiles to authenticated;
grant update (appearance) on public.assistant_profiles to authenticated;

comment on column public.assistant_profiles.appearance is
  'Aparência do agente no portal: {"cor": 1..8, "semente": texto até 32}. Vazio = derivado do id.';
