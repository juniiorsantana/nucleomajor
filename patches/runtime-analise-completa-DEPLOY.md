# Deploy: a Análise Completa no runtime

> **Estado em 04/10/2026:** pronto, NÃO publicado.
> - Base: a release ativa **`avaliacao-do-vendedor-v2`** (a cópia desta
>   máquina é a mesma que foi conferida pelos hashes e publicada em 03/10).
> - Patch `runtime-analise-completa.patch`: 6 arquivos (1 novo), 463 linhas a
>   mais e 17 a menos, sha256
>   `83eccc33a29e1dda50fe5d80ead1c251a9e69dbcd65ce2a1a3fef332961d6463`.
> - Sem variável nova no `.env`. Precisa da migration `20261010100000`
>   aplicada ANTES.

## Por quê

A Análise Completa (desenho aprovado em 03/10; construção pedida pelo dono):
três tipos de análise, Atendimento (o vendedor, 1 crédito), Lead (a
qualidade do lead, 1 crédito) e Completa (os dois e o veredito do
cruzamento, 2 créditos). O banco calcula as duas notas e o veredito; o
runtime precisa:

- **fazer ao Jev as duas perguntas do lead** (`lead_objection`, `lead_fit`)
  quando a régua for a v3. As outras cinco da nota do lead já são perguntas
  de base (intenção, necessidade, prazo, quem decide, temperatura). Com a v2,
  nada muda;
- **pedir ao Claude o formato de cada tipo:** atendimento como hoje; lead com
  `lead_verdict` e `lead_why`; completa com os dois mais `matrix_explanation`
  e o lado (`side`) de cada ação. O veredito do cruzamento vai pronto no
  pedido, com a mesma regra do banco.

`jev_framework.FRAMEWORK_VERSION` sobe para `major-v4`.

## Ordem

1. Migration `20261010100000` pelo SQL Editor (não muda a régua de ninguém).
2. **Este deploy.**
3. A troca do padrão: `select private.trocar_regua_padrao('atendimento.v3');`
4. O merge do PR do portal (o menu com os três tipos). O portal vem por
   último para ninguém pedir uma Completa antes de a régua ter a nota do lead.

## 1. Conferir a base

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)
echo "$ATIVA"                       # esperado: .../avaliacao-do-vendedor-v2
cd "$ATIVA"
sha256sum whatsapp-assistant/{analista,jev_framework,test_vendedor_v2,test_atendimento_v1,test_coordenador}.py /tmp/runtime-analise-completa.patch
```

```
14335c175294d8440449104e8ba8b444c3373990dd5d6203394a450f45c04513  whatsapp-assistant/analista.py
fe96f7015b535ab7f58def08bb5005ca39da538e0387ff1df5e482f427d8a9fc  whatsapp-assistant/jev_framework.py
5e00e69413a68770ae35680d9192a319446a84e3eae6ce4ed0fe1946f42b3d70  whatsapp-assistant/test_vendedor_v2.py
9d142506805f5cb4e3a927f8d2c46dde2ce40496e63b41b624aa5df71c1a8416  whatsapp-assistant/test_atendimento_v1.py
21611a263c6117752b503940f2ba2dcf863cd95232a21173febba609bd415fb8  whatsapp-assistant/test_coordenador.py
83eccc33a29e1dda50fe5d80ead1c251a9e69dbcd65ce2a1a3fef332961d6463  /tmp/runtime-analise-completa.patch
```

Hash diferente: parar.

## 2. Release nova, testes, virada

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/analise-completa
cp -a "$ATIVA" "$NOVA"
cd "$NOVA"
git apply --check -p1 /tmp/runtime-analise-completa.patch
git apply        -p1 /tmp/runtime-analise-completa.patch
cd whatsapp-assistant
~/.venvs/whatsapp-assistant/bin/python -B -m unittest test_analise_completa test_vendedor_v2 test_atendimento_v1 test_analista test_coordenador test_runner 2>&1 | tail -3

ln -sfn "$NOVA" ~/whatsapp-mcp-hardened
for U in 8ee1e6d0-a9d0-4041-b6ea-878716a34a71 a502a475-f677-4a39-8f4e-da85fd92325d; do
  systemctl --user restart whatsapp-assistant@$U
  sleep 10
  systemctl --user show -p ActiveState,NRestarts whatsapp-assistant@$U
done
```

## 3. Conferir

Depois da troca do padrão para a v3, pedir uma Completa e olhar:

```bash
journalctl --user -u whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71 --since "10 min ago" -o cat \
  | grep -E '"event": "analysis\.'
```

Esperado: `analysis.classified` com `schema_version` 3 e `analysis.done` com
`kind=completa`, `lead_score` e `service_score`.

## 4. Voltar atrás

Primeiro a régua, depois a release:

```sql
select private.trocar_regua_padrao('atendimento.v2');
```

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/avaliacao-do-vendedor-v2 ~/whatsapp-mcp-hardened
for U in 8ee1e6d0-a9d0-4041-b6ea-878716a34a71 a502a475-f677-4a39-8f4e-da85fd92325d; do
  systemctl --user restart whatsapp-assistant@$U
done
```

## 5. Registro do que já rodou

- 04/10/2026: patch feito sobre a cópia da release ativa; aplicado de novo
  numa cópia limpa e igual ao que foi testado; suíte inteira do runtime OK
  (1086 testes, com a janela da data ampliada).
