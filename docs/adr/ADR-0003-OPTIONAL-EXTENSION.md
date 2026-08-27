# ADR-0003 — Extensão Chrome opcional

Estado: aceito em agosto de 2026.

## Contexto

O painel começou como extensão. Isso impedia acesso por celular, outros
navegadores e integrações oficiais sem WhatsApp Web.

## Decisão

O portal web é a interface principal. A extensão permanece como experiência
embutida no WhatsApp Web e conector opcional, compartilhando componentes e
contratos quando possível.

## Consequências

- usuário do portal não instala extensão;
- bundle web não contém `chrome.*` ou IndexedDB legado;
- extensão continua com build, release e testes próprios;
- falha da extensão não significa falha da VPS;
- API Oficial poderá operar sem extensão.
