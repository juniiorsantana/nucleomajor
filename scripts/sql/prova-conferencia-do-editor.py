"""Prova de que o editor e o banco concordam sobre um fluxo v3.

Dois passos, porque o banco mora na VPS e o Node mora aqui:

    node scripts/sql/casos-conferencia-do-editor.mjs > casos.jsonl
    python scripts/sql/prova-conferencia-do-editor.py montar casos.jsonl prova.sql
    # na VPS, num banco descartável (receita em README-prova-fluxos.md):
    #   createdb flow_editor && psql -X -q -d flow_editor -f prova.sql > vereditos.tsv
    python scripts/sql/prova-conferencia-do-editor.py comparar casos.jsonl vereditos.tsv

`montar` copia da migration aplicada as quatro funções puras de que
`private.flow_validate` depende — nada de tabela, nada de produção. `comparar`
falha (código 1) se algum caso tiver veredito diferente entre editor, banco e o
esperado pelo nome do caso.

Resultado em 23/09/2026: 37 casos, 0 divergências; com dia e horário
(20260925110000 por cima), 52 casos, 0 divergências.
"""

import json
import sys
from pathlib import Path

MIGRATION = Path(__file__).resolve().parents[2] / "supabase/migrations/20260907010000_fluxos_execucao_persistida.sql"
POSTERIORES = [
    Path(__file__).resolve().parents[2] / "supabase/migrations/20260925110000_fluxos_com_dia_e_horario.sql",
]


def montar(casos_path: str, saida_path: str) -> None:
    mig = MIGRATION.read_text(encoding="utf-8").replace("\r", "")
    funcoes = mig[mig.index("create function private.flow_step("):mig.index("create function private.flow_envelope(")]
    assert funcoes.count("create function private.") == 4
    # As migrations posteriores que trocam alguma dessas funções entram por
    # cima, na ordem — como em produção.
    for posterior in POSTERIORES:
        texto = posterior.read_text(encoding="utf-8").replace("\r", "")
        funcoes += "\n" + texto[texto.index("create or replace function"):texto.rindex("commit;")]
    linhas = [
        "\\set ON_ERROR_STOP on",
        "create schema private;",
        funcoes,
        "create function private.veredito(d jsonb) returns text language plpgsql as $v$ begin"
        " perform private.flow_validate(d); return 'aceita';"
        " exception when others then return 'recusa: ' || sqlerrm; end $v$;",
        "\\pset format unaligned",
        "\\pset tuples_only on",
        "\\pset fieldsep '\\t'",
    ]
    for n, linha in enumerate(Path(casos_path).read_text(encoding="utf-8").splitlines()):
        corpo = json.dumps(json.loads(linha)["definicao"], ensure_ascii=False)
        assert "$j$" not in corpo
        linhas.append(f"select {n}, private.veredito($j${corpo}$j$::jsonb);")
    Path(saida_path).write_text("\n".join(linhas) + "\n", encoding="utf-8")


def comparar(casos_path: str, vereditos_path: str) -> int:
    casos = [json.loads(l) for l in Path(casos_path).read_text(encoding="utf-8").splitlines()]
    banco = dict(
        l.split("\t", 1) for l in Path(vereditos_path).read_text(encoding="utf-8").splitlines() if "\t" in l
    )
    divergencias = 0
    for n, caso in enumerate(casos):
        veredito = banco.get(str(n), "ausente")
        esperado = caso["caso"].startswith("valido")
        ok = (veredito == "aceita") == caso["editorAceita"] == esperado
        divergencias += not ok
        print(("OK       " if ok else "DIVERGE  ") + f"{caso['caso']}  | editor: {caso['problema'] or 'aceita'} | banco: {veredito}")
    print(f"\n{len(casos)} casos, {divergencias} divergências")
    return 1 if divergencias else 0


if __name__ == "__main__":
    acao, *args = sys.argv[1:]
    if acao == "montar":
        montar(*args)
    else:
        sys.exit(comparar(*args))
