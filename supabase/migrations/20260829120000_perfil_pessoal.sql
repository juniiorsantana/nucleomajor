-- Nome curto e cor da pessoa, no perfil e não na participação.
--
-- A régua que decidiu onde cada campo mora: se muda quando a pessoa troca de
-- empresa, é de `organization_members`; se a acompanha, é de `profiles`. Papel
-- e responsabilidade mudam por empresa e já estão lá. Como alguém se chama e
-- de que cor é o seu avatar não mudam — a mesma pessoa não é "Júnior" aqui e
-- "J. Teibel" ali.
--
-- `display_name` existe porque `full_name` não cabe onde a identidade é mais
-- consumida: cartão do funil, bolha do chat, bloco de 40px na agenda. Guardar
-- os dois evita que a tela tenha de escolher entre truncar e mentir.
--
-- `color` fica anulável de propósito. Nulo quer dizer "não escolheu", e a
-- interface deriva uma cor estável do id — a pessoa nasce com avatar distinto
-- sem ninguém configurar nada, e escolher passa a ser ajuste, não cadastro.
--
-- Não há policy nova aqui: `profiles_update_self` (fase C) já permite a cada
-- um escrever no próprio perfil, e `profiles_select` já deixa quem divide
-- organização ler o perfil dos colegas. Duas colunas bastam.

begin;

alter table public.profiles
  add column if not exists display_name text not null default '',
  add column if not exists color text;

alter table public.profiles
  drop constraint if exists profiles_display_name_length;
alter table public.profiles
  add constraint profiles_display_name_length
  check (length(display_name) <= 40);

-- Case-insensitive porque seletor de cor devolve tanto `#4F3CFC` quanto
-- `#4f3cfc`, e recusar a gravação por causa da caixa da letra seria um erro
-- que ninguém consegue interpretar na tela.
alter table public.profiles
  drop constraint if exists profiles_color_format;
alter table public.profiles
  add constraint profiles_color_format
  check (color is null or color ~* '^#[0-9a-f]{6}$');

commit;
