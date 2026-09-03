"""Guarda contra o defeito que quebrou o modo piloto do assistente.

`private.portal_realtime_notify` recebe o tópico por `tg_argv[0]`, e a coluna
`portal_realtime_events.topic` tem um check com a lista fechada de tópicos.
Nada no banco liga uma coisa à outra: a fase H pendurou dois gatilhos com
tópicos novos sem ampliar o check, e como o gatilho roda dentro da transação de
quem escreveu, a violação passou a derrubar a escrita original — selecionar um
contato no piloto falhava com
`violates check constraint "portal_realtime_events_topic_check"`.

Este teste lê todas as migrations e exige que todo tópico passado a algum
gatilho esteja na lista do check mais recente.
"""

from pathlib import Path
import re
import unittest


MIGRATIONS = Path(__file__).parent / "migrations"

GATILHO = re.compile(
    r"execute\s+function\s+private\.portal_realtime_notify\s*\(\s*'([^']+)'\s*\)",
    re.IGNORECASE,
)
CHECK = re.compile(
    r"check\s*\(\s*topic\s+in\s*\(([^)]*)\)\s*\)",
    re.IGNORECASE,
)


def arquivos_em_ordem():
    return sorted(MIGRATIONS.glob("*.sql"))


class PortalRealtimeTopicsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.textos = [(caminho, caminho.read_text(encoding="utf-8"))
                      for caminho in arquivos_em_ordem()]

    def topicos_dos_gatilhos(self):
        encontrados = {}
        for caminho, texto in self.textos:
            for topico in GATILHO.findall(texto):
                encontrados.setdefault(topico, caminho.name)
        return encontrados

    def check_vigente(self):
        vigente = None
        origem = None
        for caminho, texto in self.textos:
            for lista in CHECK.findall(texto):
                vigente = {valor.strip().strip("'")
                           for valor in lista.split(",") if valor.strip()}
                origem = caminho.name
        return vigente, origem

    def test_ha_gatilhos_e_check(self):
        self.assertTrue(self.topicos_dos_gatilhos(), "nenhum gatilho encontrado")
        vigente, _ = self.check_vigente()
        self.assertIsNotNone(vigente, "nenhum check de topic encontrado")

    def test_todo_topico_emitido_e_aceito_pelo_check(self):
        vigente, origem = self.check_vigente()
        for topico, arquivo in sorted(self.topicos_dos_gatilhos().items()):
            self.assertIn(
                topico,
                vigente,
                f"o gatilho de {arquivo} emite '{topico}', que o check de "
                f"{origem} rejeita; amplie o check na mesma migration que "
                f"cria o gatilho",
            )

    def test_o_check_nao_aceita_topico_que_ninguem_emite(self):
        vigente, origem = self.check_vigente()
        emitidos = set(self.topicos_dos_gatilhos())
        self.assertEqual(
            vigente - emitidos,
            set(),
            f"o check de {origem} aceita tópicos que nenhum gatilho emite",
        )


if __name__ == "__main__":
    unittest.main()
