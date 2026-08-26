import { describe, expect, it } from "vitest";
import { handoffGroup, maskPhone, rolloutMode } from "./customerAssistant";

describe("customer assistant rollout", () => {
  it("falha fechado quando o modo não existe", () => {
    expect(rolloutMode(null)).toBe("off");
    expect(rolloutMode({ process_config: { rollout: { mode: "unknown" } } })).toBe("off");
  });

  it("preserva os três modos válidos", () => {
    for (const mode of ["off", "pilot", "active"]) {
      expect(rolloutMode({ process_config: { rollout: { mode } } })).toBe(mode);
    }
  });

  it("agrupa a fila sem perder estados transitórios", () => {
    expect(handoffGroup("requested")).toBe("waiting");
    expect(handoffGroup("returning")).toBe("active");
    expect(handoffGroup("completed")).toBe("finished");
  });

  it("nunca exibe o telefone completo", () => {
    expect(maskPhone("+55 (66) 99964-0274")).toBe("•••• 0274");
  });
});
