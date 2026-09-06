# Prova comportamental do Soul do agente (FASE 13C)

Registro de como a migration
`20260906010000_fase_13c_soul_do_agente_no_prompt.sql` foi validada
**comportamentalmente**. A migration leva o `soul_markdown` do agente que o
Router da 13B escolheu até o payload, como `soul` e `soulHash`, dentro do
objeto `assistente` — e nada além disso.

Sucede [`README-prova-agent-router.md`](./README-prova-agent-router.md): a
receita de cluster descartável é a mesma das FASES C/D/E/13B, inclusive os três
detalhes de `libpq5`, `listen_addresses` e `initdb`. O que muda é uma migration
a mais na cadeia e o arquivo de prova.

## Resultado registrado

Executado em **06/09/2026**, PostgreSQL **17.9** userspace descartável na VPS
(`/tmp/fase-13c`, socket unix, `listen_addresses = ''` — sem porta TCP):

- **57 migrations** do repositório aplicaram limpas, do zero, na ordem abaixo —
  inclusive a própria 13C, o que significa que suas guardas de pré-voo e suas
  asserções finais passaram contra Postgres real, e não só contra leitura;
- itens **A–J** de `prova-soul-do-agente.sql`: **PASS em todos**;
- **zero fixtures** deixadas pela transação, conferido pelo item J depois do
  `ROLLBACK`, e a constraint `assistant_profiles_soul_markdown_tamanho` de
  volta no lugar;
- **produção não foi tocada**: nenhum comando contra o Supabase, e os dois
  serviços do runtime na VPS seguiram `active` com `NRestarts=0` e os mesmos
  `ActiveEnterTimestamp` de antes;
- o cluster foi **destruído** ao fim, com `/tmp` limpo e nenhum processo
  `postgres` do usuário sobrevivente.

Evidências em `artifacts/fase-13c-20260906-r2/` (`prova.log`,
`hashes-sem_soul.log`, `hashes-com_soul.log`).

### Comparação com banco de controle

No mesmo cluster foi montado um segundo banco (`sem_soul`) com **a mesma cadeia
menos a 13C**, para comparar antes/depois por introspecção:

| Função | Sem 13C | Com 13C |
|---|---|---|
| `private.intelligence_payload` | `75e64817…` | **`fa473433…`** (a única que mudou) |
| `private.provision_intelligence` | `2ce57ef0…` | `2ce57ef0…` |
| `public.nucleo_intelligence_context_resolve` (v1) | `486f653b…` | `486f653b…` |
| `public.nucleo_intelligence_context_resolve_v2` | `a1110719…` | `a1110719…` |
| `public.nucleo_intelligence_context_resolve_v3` | `e4aa5c0a…` | `e4aa5c0a…` |
| `public.nucleo_customer_assistant_access` | `7ac0a815…` | `7ac0a815…` |
| `public.intelligence_context_preview` | `ea6b4c1c…` | `ea6b4c1c…` |

O `sem_soul` deu **`75e64817…`** em `intelligence_payload` — exatamente o hash
que a prova da 13B registrou para o corpo que hoje está **vivo em produção**. É
isso que autoriza usar esta comparação como referência: o cluster descartável
reproduziu o corpo real, então a diferença observada é a 13C e nada mais.

**Valores completos, para a conferência depois de aplicar:**

| | |
|---|---|
| `md5(pg_get_functiondef(...))` com 13C | `fa473433b5a5f6e3b440383fcffce4e0` |
| `md5(replace(prosrc, chr(13), ''))` — corpo normalizado | `4ed9516507bcf8322f14e313fa08a94e` |

Em produção o primeiro **vai divergir**: colar pelo SQL Editor a partir do
Windows grava o corpo com CRLF. Já aconteceu com a 13B, com
`nucleo_intelligence_context_resolve` e com `intelligence_context_preview`. A
conferência que vale é a **segunda linha** — o corpo normalizado.

## Arquivos

| Arquivo | Papel |
|---|---|
| `harness-supabase-minimo.sql` | Mesmo das FASES C/D/E/13B. |
| `prova-agente-padrao-seed.sql` | Mesmo das FASES C/D/E/13B — fixtures pré-C, commitadas. |
| `prova-soul-do-agente.sql` | A prova A–J. Roda dentro de uma transação que termina em `ROLLBACK`, mais um bloco pós-rollback (item J) que confere que nada vazou. |

`test/agent-soul-migration.test.mjs` cobre o lado estático (o corpo é o da 13B
mais exatamente três acréscimos conhecidos, o Soul sai do agente selecionado, o
contrato de saída não mudou). `whatsapp-assistant/test_intelligence.py` cobre o
lado do prompt. Os três se complementam e nenhum substitui o outro.

## Sequência de reprodução

```
1. harness-supabase-minimo.sql
2. migrations do repositório, em ordem, até a FASE B (20260904160000)
   inclusive — NÃO aplicar a FASE C ainda
3. prova-agente-padrao-seed.sql        <-- fixtures pré-C, COMMIT
4. 20260904190000  (FASE C)
5. 20260904230000  (FASE D)
6. 20260905000000  (FASE E)
7. 20260905120000 e 20260905160000  (FASE F, nesta ordem)
8. 20260905200000  (hardening da RPC da FASE F)
9. 20260905220000  (FASE 13B — Agent Router)
10. 20260906010000 (FASE 13C — o que está sendo provado)
11. prova-soul-do-agente.sql
```

Como nas fases anteriores: os arquivos saem do Windows com CRLF, normalizar com
`tr -d '\r'` antes de aplicar via `psql -f`.

## Itens

| Item | O que prova |
|---|---|
| `A` | O agente com persona devolve a persona **dele**, e o `soulHash` é o sha256 do texto. |
| `B` | Agente **sem** persona devolve `null` — e não a persona do padrão. É a fase inteira em um item: herdar persona por ausência é o mesmo erro que a FASE D proibiu para disponibilidade. |
| `C` | A persona segue a **afinidade**: conversa pinada no não-padrão recebe a persona do não-padrão. |
| `D` | A persona segue a **campanha**, pelo mesmo caminho. |
| `E` | Persona só de espaço em branco vale como ausente. |
| `F` | Persona acima de 8000 é **descartada** pelo payload, e o turno continua de pé — persona não autoriza nada, então derrubar o atendimento por causa dela trocaria um problema cosmético por um cliente sem resposta. |
| `G` | A constraint do banco **recusa gravar** persona acima de 8000. O teto existe nos dois lugares: um impede a gravação, o outro impede que uma linha antiga entre num prompt. |
| `H` | O hash é de **conteúdo, não de agente**: trocar a persona muda o hash, e personas idênticas em agentes diferentes dão o mesmo hash. É o que torna o log capaz de dizer "a persona mudou" sem nunca registrar o texto. |
| `I` | O resto do payload não mudou: `schemaVersion` = `fase-h-1`, as chaves de `assistente` são as de antes mais `soul` e `soulHash`, as de primeiro nível são idênticas, e as políticas seguem iguais. |
| `J` | Pós-rollback: agente, campanha, contextos e personas da prova sumiram, e a constraint voltou. |

## Desvio registrado — a primeira rodada parou no H

Na rodada de 06/09/2026 a prova passou A–G e **abortou no H** com
`invalid conversation context key`. Não era o código: os itens H e I usavam
`repeat('h', 64)` e `repeat('i', 64)` como `conversation_key_hash`, e `h`/`i`
não são hexadecimais — `private.intelligence_payload` valida `^[0-9a-f]{64}$` e
recusa **antes** de chegar à seleção de agente. Os itens A–G tinham passado
justamente por usarem `a`, `b` e `d`.

Corrigido para `repeat('c', 64)` e `repeat('e', 64)` (hex, e ainda não usados
noutro item), e o J passou a conferir os cinco hashes. Nenhuma asserção foi
afrouxada. **Regra para as próximas provas: hash de conversa em fixture só com
dígitos e `a`–`f`.**

## Onde a prova não chega

- **RLS com JWT de usuário final.** Roda como superusuário, como as provas
  anteriores. A fatia não muda policy nenhuma — é `CREATE OR REPLACE` de uma
  função `security definer`.
- **Concorrência.** Dois turnos simultâneos da mesma conversa não são
  exercitados, como na 13B.
- **Tráfego real.** Produção segue sem tráfego observável no caminho de
  resolução, e `soul_markdown` está NULL em 100% dos perfis — então, mesmo
  depois de aplicar, o caminho novo só aparece quando alguém escrever uma
  persona pelo portal.
- **O runtime.** Aqui a 13C difere da 13B: `whatsapp-mcp-hardened` **muda**
  nesta fatia. O lado do prompt é coberto por
  `whatsapp-assistant/test_intelligence.py` (364 testes verdes, incluindo o do
  não-vazamento entre agentes), não por este arquivo.
