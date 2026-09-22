# Leva 4: empresa nova nasce com as habilidades certas

Aplicar depois das Levas 1, 2 e 3
([1](ROTEIRO-LEVA-1-CHECKOUT-ASAAS.md) · [2](ROTEIRO-LEVA-2-PLANO-SEM-IA.md) ·
[3](ROTEIRO-LEVA-3-WHATSAPP-DO-CLIENTE.md)).

## O problema

Uma empresa nova nascia com o agente de clientes sem **Recepção** e sem
**Solicitação de agenda**, e ainda com a **Agenda** (que é habilidade interna);
o agente interno nascia sem **Tarefas**. As empresas antigas receberam esses
vínculos por correções pontuais, que nenhum gatilho repete.

O efeito aparece justamente quando a IA é vendida: sem a Recepção, o roteador
recusa todo turno de cliente e a pessoa do outro lado recebe "atendimento
temporariamente indisponível". Até aqui, o dono só chegava ao conjunto certo se
passasse pelo modo Piloto.

## O que muda

A migration `20260921110000_empresa_nova_nasce_com_as_habilidades.sql` cria um
gatilho novo, que roda depois do que já existe, e dá a toda empresa **nova**:

- **agente interno:** Agenda (10) e Tarefas (20);
- **agente de clientes:** Recepção (10), Pré-qualificação (20), Vendas (30),
  Suporte (40) e Solicitação de agenda (50), sem a Agenda.

São as mesmas prioridades do Piloto. Habilidade que não estiver publicada é
pulada. A função de provisionamento atual não é tocada, e **não há backfill**:
a Major e as empresas que já existem ficam como estão.

## Provas

`scripts/sql/prova-habilidades-de-empresa-nova.mjs`: **10 verificações, PASS**.
Reaplica o harness e todas as migrations reais em PGlite 0.5.8, mostra o estado
antigo (sem recepção, sem tarefas), aplica a migration e confere que a empresa
nova nasce completa e a antiga fica intacta.

## Aplicar

1. **SQL Editor.** Abra o arquivo da migration, copie tudo e rode.
2. Confira; as três linhas precisam voltar `true`:

   ```sql
   select 'gatilho novo existe' as conferencia,
          exists (select 1 from pg_trigger
                  where tgname = 'organizations_provision_intelligence_vinculos'
                    and tgrelid = 'public.organizations'::regclass) as ok
   union all
   select 'a função de provisionamento antiga não mudou',
          (select prosrc like '%conhecimento-clientes%'
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname = 'provision_intelligence')
   union all
   select 'as cinco habilidades de cliente estão publicadas',
          (select count(*) = 5 from public.skill_definitions
           where owner_type = 'platform' and status = 'published'
             and slug in ('recepcao', 'pre-qualificacao', 'vendas', 'suporte', 'solicitacao-agenda'));
   ```

   Se a última linha voltar `false`, publique as habilidades oficiais antes de
   vender um plano com IA (`npm run intelligence:publish -- --apply`).

3. Depois da próxima empresa criada, confira o que ela recebeu:

   ```sql
   select o.name, p.audience, s.slug, b.priority, b.enabled
   from public.assistant_profiles p
   join public.organizations o on o.id = p.organization_id
   join public.assistant_profile_skills b on b.profile_id = p.id
   join public.skill_definitions s on s.id = b.skill_id
   where p.is_default
   order by o.created_at desc, p.audience, b.priority;
   ```

## Desfazer

```sql
begin;
drop trigger if exists organizations_provision_intelligence_vinculos on public.organizations;
drop function if exists private.provision_intelligence_vinculos_after_organization();
drop function if exists private.provision_intelligence_vinculos(uuid, uuid);
commit;
```

As empresas criadas enquanto o gatilho existiu ficam com os vínculos; desfazer
só interrompe as próximas.
