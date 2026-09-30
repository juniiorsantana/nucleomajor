import { describe, expect, it } from "vitest";
import {
  dataHoraParaTimestamp,
  grupoDaTarefa,
  horaInput,
  prazoDoAtalho,
  rotuloPrazo,
} from "./tarefasUtils";

// Quarta-feira, 30/09/2026, 10:30 no horário local.
const AGORA = new Date(2026, 8, 30, 10, 30).getTime();
const em = (dias, h = 9, m = 0) => new Date(2026, 8, 30 + dias, h, m).getTime();

describe("prazo da tarefa", () => {
  it("mantém a hora que já existe ao editar", () => {
    const arrastada = em(1, 15, 30);
    const ts = dataHoraParaTimestamp("2026-10-01", horaInput(arrastada));
    expect(ts).toBe(arrastada);
  });

  it("usa 09:00 só quando a hora está vazia", () => {
    expect(new Date(dataHoraParaTimestamp("2026-10-01", "")).getHours()).toBe(9);
    expect(dataHoraParaTimestamp("", "10:00")).toBeNull();
  });

  it("agrupa por horizonte de semana", () => {
    expect(grupoDaTarefa({ venceEm: em(-1) }, AGORA)).toBe("atrasadas");
    expect(grupoDaTarefa({ venceEm: em(0, 9) }, AGORA)).toBe("hoje");
    expect(grupoDaTarefa({ venceEm: em(1) }, AGORA)).toBe("amanha");
    expect(grupoDaTarefa({ venceEm: em(4) }, AGORA)).toBe("semana");
    expect(grupoDaTarefa({ venceEm: em(20) }, AGORA)).toBe("depois");
    expect(grupoDaTarefa({ venceEm: null }, AGORA)).toBe("sem-data");
    expect(grupoDaTarefa({ venceEm: em(-3), concluida: true }, AGORA)).toBe("concluidas");
  });

  it("diz a hora e só acusa atraso depois dela", () => {
    expect(rotuloPrazo(em(0, 15), AGORA)).toEqual({ texto: "Hoje, 15:00", tom: "warning" });
    expect(rotuloPrazo(em(0, 9), AGORA)).toEqual({ texto: "Hoje, 09:00 · atrasada", tom: "danger" });
    expect(rotuloPrazo(em(1, 14), AGORA).texto).toBe("Amanhã, 14:00");
    expect(rotuloPrazo(em(-1, 14), AGORA)).toEqual({ texto: "Ontem, 14:00", tom: "danger" });
    expect(rotuloPrazo(null, AGORA).texto).toBe("Sem prazo");
  });

  it("oferece atalhos que não nascem atrasados", () => {
    expect(prazoDoAtalho("hoje", AGORA)).toBe(em(0, 18));
    expect(prazoDoAtalho("amanha", AGORA)).toBe(em(1, 9));
    const segunda = new Date(prazoDoAtalho("semana", AGORA));
    expect(segunda.getDay()).toBe(1);
    expect(prazoDoAtalho("hoje", em(0, 19, 10))).toBeGreaterThan(em(0, 19, 10));
    expect(prazoDoAtalho("nenhum", AGORA)).toBeNull();
  });
});
