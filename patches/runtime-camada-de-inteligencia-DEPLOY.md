# Deploy: o analista recebe fatos e notas, e a evidência aponta o message_id

> **Estado em 02/10/2026, ao fechar o roteiro:**
> - Base: a release ativa **`analisar-conversa`**. `analista.py` e
>   `test_analista.py` batem por sha256 com a cópia usada para gerar o patch.
> - Patch `runtime-camada-de-inteligencia.patch`: 2 arquivos, 167 linhas a
>   mais e 6 a menos, sha256 `85eec80a625f0f5f709837ce02532ad3d6b4231f4aaeae00e094f08ed2d6863c`.
> - Base + patch, nesta máquina: 16 testes do analista OK (4 novos) e 955 do
>   resto da suíte OK. `test_media_mirror` e `test_conversation_sync` falham
>   **com ou sem o patch**: usam datas fixas de 09/2026 que saíram da janela
>   de 30 dias em 02/10. Não é deste patch; está registrado como pendência.
> - Par da migration `20261003100000_camada_de_inteligencia.sql`. A ordem não
>   importa: runtime antigo ignora os campos novos da carga; runtime novo com
>   banco antigo simplesmente não mostra fatos e notas e devolve
>   `messageIds` vazio.

## O que muda

- O prompt do analista ganha duas seções, quando a carga traz: **Fatos
  medidos pelo sistema** e **Notas calculadas pelas regras da empresa**
  (com os critérios não atendidos). O Claude é instruído a usar, não recalcular
  e não dar outra nota.
- Cada mensagem vai numerada (`#1`, `#2`...). Em `porque[]`, o Claude cita os
  números; o analista troca pelo `message_id` real (`messageIds`, até 3) e
  descarta número que não existe.
- O resultado ganha `formatVersion: 2`. Os campos antigos continuam iguais,
  e o portal não precisa mudar.

Nenhuma variável nova. O Bridge não muda.

## 1. Conferir a base

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
UUID=8ee1e6d0-a9d0-4041-b6ea-878716a34a71
ATIVA=$(readlink -f ~/whatsapp-mcp-hardened)
echo "$ATIVA"                       # esperado: .../analisar-conversa
sha256sum "$ATIVA"/whatsapp-assistant/{analista,test_analista}.py
sha256sum /tmp/runtime-camada-de-inteligencia.patch
```

```
e72a08fe64a81f20c844e4d061ab28708cfee238f7da793890f6fa82e97170b9  analista.py
0d7043b8c2cb63051aae90ef30349f909c8b784633396b6c75bbb60726a0d4a9  test_analista.py
85eec80a625f0f5f709837ce02532ad3d6b4231f4aaeae00e094f08ed2d6863c  /tmp/runtime-camada-de-inteligencia.patch
```

## 2. Release nova, testes, virada

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/camada-de-inteligencia
cp -a "$ATIVA" "$NOVA"
cd "$NOVA"
git apply --check -p1 /tmp/runtime-camada-de-inteligencia.patch
git apply        -p1 /tmp/runtime-camada-de-inteligencia.patch
cd whatsapp-assistant
~/.venvs/whatsapp-assistant/bin/python -B -m unittest test_analista test_runtime_commands 2>&1 | tail -3
ln -sfn "$NOVA" ~/whatsapp-mcp-hardened
systemctl --user restart whatsapp-assistant@$UUID
systemctl --user show -p ActiveState,NRestarts whatsapp-assistant@$UUID
```

## 3. Conferir

Pedir uma análise pelo portal e olhar o resultado gravado:

```sql
select status, result -> 'formatVersion' as formato,
       jsonb_path_query_array(result, '$.porque[*].messageIds') as evidencias,
       facts_version, schema_version, lead_score, service_score
from public.conversation_analyses
where organization_id = '338e44ca-36ab-437c-b8ac-aa7c60fee64a'
order by requested_at desc limit 3;
```

## 4. Voltar atrás

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/analisar-conversa ~/whatsapp-mcp-hardened
systemctl --user restart whatsapp-assistant@$UUID
```

## 5. Registro do que já rodou

- 02/10/2026: base conferida na VPS pelos 2 hashes (release
  `analisar-conversa`). Nada aplicado ainda.
