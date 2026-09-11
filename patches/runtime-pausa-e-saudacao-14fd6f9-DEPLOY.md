# Deploy manual — pausa falsa por humano e saudação em três mensagens

> **Estado em 10/09/2026:** a release nova já está construída, com o patch
> aplicado e a suíte passando **na própria VPS** (`Ran 476 tests`, `OK`, com
> `~/.venvs/whatsapp-assistant/bin/python`). Os passos "Aplicar" e "Testar"
> abaixo **já foram executados** — ficam registrados para auditoria e para
> repetir o procedimento numa próxima vez.
>
> Falta só a seção "Trocar e reiniciar". A release ativa continua sendo
> `14fd6f9`; nada em produção foi alterado ainda.


Corrige dois defeitos independentes, os dois em conversa de cliente.

**1. O agente confundia a própria resposta com um atendente humano.** `send.py`
anotava a saída pelo destino do envio (o telefone, `556...`) e
`presenca_humana` procurava pelo `chat_jid` que o bridge arquiva
(`556...@s.whatsapp.net`, ou `...@lid`). Nunca casavam. O efeito era
`ignored_human_active` e 30 minutos de silêncio depois de CADA resposta, em
toda conversa individual — não só nas endereçadas por LID. Os testes não
pegaram porque usavam a mesma chave dos dois lados.

**2. Uma saudação virava três mensagens.** Para um "Opa" o runtime enviava até
duas aberturas geradas pela triagem e só então a resposta real. O corte para
operador já existia desde antes; este patch estende ao cliente e, de quebra,
deixa de gastar uma ida ao Haiku para responder "oi".

## Base esperada

As releases não são repositórios git — a base se confere por conteúdo.
A release ativa em 10/09/2026 é `14fd6f9`.

```bash
cd /home/nucleo/whatsapp-mcp-hardened/whatsapp-assistant
sha256sum presenca_humana.py server.py worker.py \
          test_presenca_humana.py test_worker.py test_gateway_server.py
```

Esperado, nesta ordem:

```
557046e52e6b1cec12eb3839c08fa91e92bfb6cecda5503c30b71c4878b78cfd  presenca_humana.py
8be94506d2ddd12b17a9263eff8d674afb448e01b9f85a46c9839068b32cd6de  server.py
a429329b59463110d13d2852564454dedaac85f1aa7d37b5a1944056637f712b  worker.py
e3b2d86e56671aade7da00d668004e1f314ab655dd0317ae8c4ff56e8d5232bc  test_presenca_humana.py
fbbf6fd5b293da60ac5066feea64ecebfd5b297e012a883669e3986525bf6a3d  test_worker.py
80da62fd7fdb3f110867d55dc9e4f64b3116f09babf248af764568b015016e8b  test_gateway_server.py
```

Se algum hash divergir, pare: a release não é a que este patch espera.

## Aplicar

Em uma release NOVA, nunca no diretório para onde o symlink aponta agora.

```bash
NOVA=/home/nucleo/releases/whatsapp-mcp-hardened/pausa-saudacao
cp -a /home/nucleo/releases/whatsapp-mcp-hardened/14fd6f9 "$NOVA"
cd "$NOVA"
git apply --check -p1 /caminho/runtime-pausa-e-saudacao-14fd6f9.patch
git apply        -p1 /caminho/runtime-pausa-e-saudacao-14fd6f9.patch
```

## Testar antes de trocar o symlink

```bash
cd "$NOVA/whatsapp-assistant"
python -B -m unittest discover -s . -p 'test_*.py'
```

Resultado de referência (medido localmente sobre cópia idêntica da release):
`Ran 476 tests`, `OK`. São 9 testes novos; um deles,
`test_anotado_pelo_telefone_e_arquivado_pelo_jid_ainda_e_nosso`, reprova contra
o código antigo — é o bug 1 reproduzido.

## Trocar e reiniciar

```bash
ln -sfn "$NOVA" /home/nucleo/whatsapp-mcp-hardened
systemctl --user restart 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service'
systemctl --user is-active 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service'
journalctl --user -u 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service' -n 100 --no-pager
```

## Validar em produção

Mande um "Opa" de um número de cliente e confira:

- chega **uma** mensagem, não três;
- no log aparece `triage.skipped` com `reason: "saudacao"`, e NÃO aparece
  `triage.completed` para esse turno;
- a mensagem seguinte do mesmo contato é respondida normalmente — sem
  `ignored_human_active`.

Depois responda você mesmo pelo celular, na conversa de um cliente: a pausa
precisa continuar acontecendo. Esse é o comportamento que o patch não pode ter
quebrado.

## Duas coisas que não são regressão

**Sessões já pausadas continuam pausadas até vencer.** O patch impede pausas
novas; ele não apaga `humano_ate` que já estava gravado. O que estiver em curso
vence sozinho em até 30 minutos.

**As anotações gravadas antes do deploy não casam.** Elas têm a chave antiga e
expiram em 6 horas (`RETENCAO_HORAS`). Enquanto isso elas simplesmente não são
encontradas — que é exatamente o que já acontecia antes do patch, então não há
piora. As anotações novas já saem normalizadas.

## Rollback

```bash
ln -sfn /home/nucleo/releases/whatsapp-mcp-hardened/14fd6f9 /home/nucleo/whatsapp-mcp-hardened
systemctl --user restart 'whatsapp-assistant@8ee1e6d0-a9d0-4041-b6ea-878716a34a71.service'
```
