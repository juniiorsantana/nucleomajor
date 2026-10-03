# Deploy: a Avaliação do vendedor v2 no runtime

> **Estado em 03/10/2026:** publicado na VPS, e a v2 já é o padrão (ver o
> registro no fim).
> - Base: a release ativa **`analise-binario-proprio`**, remontada nesta
>   máquina a partir da base anterior mais os três patches de 02–03/10 e
>   conferida pelos hashes registrados no deploy anterior.
> - Patch `runtime-avaliacao-do-vendedor-v2.patch`: 5 arquivos (1 novo), 582
>   linhas a mais e 35 a menos, sha256
>   `c4c087f48515403b2e1931846940845018dd5ced25e78c861be75c558929ea96`.
> - Sem variável nova no `.env`. Precisa da migration `20261008100000`
>   aplicada ANTES (é ela que manda a régua no playbook).

## Por quê

Plano aprovado pelo dono em 03/10/2026: a análise passa a criticar o trabalho
do vendedor (9 pontos de livros de vendas, veredito cru, o que fez bem, o que
custou a venda e o que um vendedor top teria feito). O banco calcula a nota;
o runtime precisa:

- **fazer ao Jev as perguntas da v2** (`vnd_*`) no lugar das do Atendimento
  Score v1 (`att_*`) quando a régua em vigor for a v2. A régua chega como
  `regua` no playbook, tanto no pedido de análise quanto na fila da leitura
  automática. Sem `regua` ou com a v1, nada muda;
- **pedir ao Claude o `analysis_report.v2`**, com o tom combinado (cru, sem
  ofensa, sempre com a mensagem que prova, elogia quando foi bem) e conferir a
  resposta contra os estados da nota.

`jev_framework.FRAMEWORK_VERSION` sobe para `major-v3`.

## Ordem (as quatro partes)

1. Migration `20261008100000` pelo SQL Editor (não muda a régua de ninguém).
2. Merge do PR do portal (lê v1 e v2).
3. **Este deploy** (a VPS passa a saber fazer a v2, mas segue na v1, porque a
   régua ainda é a v1 para todos).
4. A troca do padrão, pelo SQL Editor:
   `select private.trocar_regua_padrao('atendimento.v2');`

## 1. Conferir a base

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)
echo "$ATIVA"                       # esperado: .../analise-binario-proprio
cd "$ATIVA"
sha256sum whatsapp-assistant/{analista,jev_framework,test_atendimento_v1,test_coordenador}.py /tmp/runtime-avaliacao-do-vendedor-v2.patch
```

```
250b44bedae9b1ae6ecf310b71c726e515d4a4aa80747e2957417d881b216da4  whatsapp-assistant/analista.py
2638f23b943af99bb027508b987115f07392f8e40be9e4a2756f02227b01d903  whatsapp-assistant/jev_framework.py
c0452b71f097e65d3c007b27e405dcaf1c8bfc085ca003c31b6f7159f6b98043  whatsapp-assistant/test_atendimento_v1.py
b1ef7cde82ec9ee9f2f49f31a016b0b26f15686602ef172201eead2534c8b42f  whatsapp-assistant/test_coordenador.py
c4c087f48515403b2e1931846940845018dd5ced25e78c861be75c558929ea96  /tmp/runtime-avaliacao-do-vendedor-v2.patch
```

Hash diferente: parar. A base da VPS não é a que o patch espera.

## 2. Release nova, testes, virada

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/avaliacao-do-vendedor-v2
cp -a "$ATIVA" "$NOVA"
cd "$NOVA"
git apply --check -p1 /tmp/runtime-avaliacao-do-vendedor-v2.patch
git apply        -p1 /tmp/runtime-avaliacao-do-vendedor-v2.patch
cd whatsapp-assistant
~/.venvs/whatsapp-assistant/bin/python -B -m unittest test_vendedor_v2 test_atendimento_v1 test_analista test_coordenador 2>&1 | tail -3

ln -sfn "$NOVA" ~/whatsapp-mcp-hardened
for U in 8ee1e6d0-a9d0-4041-b6ea-878716a34a71 a502a475-f677-4a39-8f4e-da85fd92325d; do
  systemctl --user restart whatsapp-assistant@$U
  sleep 8
  systemctl --user show -p ActiveState,NRestarts whatsapp-assistant@$U
done
```

## 3. Conferir

Antes da troca do padrão (passo 4 da ordem), a análise continua na v1:
`analysis.done` com `report=analysis_report.v1`. Depois da troca, pedir uma
análise e olhar:

```bash
journalctl --user -u whatsapp-assistant@a502a475-f677-4a39-8f4e-da85fd92325d --since "10 min ago" -o cat \
  | grep -E '"event": "analysis\.'
```

Esperado: `analysis.classified` com `schema_version` 2 e `analysis.done` com
`report=analysis_report.v2`. Anotar `latency_ms` e `reply_chars`: a v2 pede
mais texto ao Claude, e esse é o número que diz se ficou lenta demais.

## 4. Voltar atrás

Primeiro a régua, depois a release (nesta ordem, para nenhuma análise sair na
v2 sem o runtime que sabe fazê-la):

```sql
select private.trocar_regua_padrao('atendimento.v1');
```

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/analise-binario-proprio ~/whatsapp-mcp-hardened
for U in 8ee1e6d0-a9d0-4041-b6ea-878716a34a71 a502a475-f677-4a39-8f4e-da85fd92325d; do
  systemctl --user restart whatsapp-assistant@$U
done
```

## 5. Registro do que já rodou

- 03/10/2026: base remontada nesta máquina (base de 02/10 + os patches de
  transcrição, nova tentativa e binário próprio), conferida pelos hashes do
  deploy anterior; patch aplicado de novo numa cópia limpa e igual ao que foi
  testado; testes da v2, do Atendimento Score v1, do Analista e do
  coordenador OK.
- 03/10/2026, noite: base conferida na VPS pelos 4 hashes e o do patch;
  release `avaliacao-do-vendedor-v2` criada, `git apply` limpo, 185 testes
  (vendedor_v2, atendimento_v1, analista, coordenador, runner, transcritor,
  config) OK lá; symlink virado; Major e Adriani reiniciadas: `active`,
  `NRestarts=0`, rodando da release nova, início limpo. Rollback:
  `analise-binario-proprio`.
- 03/10/2026, 23:42 UTC: `private.trocar_regua_padrao('atendimento.v2')`
  rodado pelo SQL Editor; conferido: v2 publicada como padrão, v1 aposentada,
  Major e Adriani na v2. Teste de ponta a ponta na conversa do dono (8164):
  `analysis.classified` com `schema_version` 2 e 33 respostas,
  `analysis.done` com `report=analysis_report.v2`, Claude em 56 s
  (`reply_chars` 4657; na v1 eram cerca de 14 s). Achados do teste,
  corrigidos em seguida: a velocidade parava de contar em 241 minutos
  (migration `20261009100000`) e as legendas da linha do tempo se
  atropelavam.
