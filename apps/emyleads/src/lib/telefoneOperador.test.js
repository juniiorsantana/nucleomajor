import { describe, expect, it } from "vitest";
import {
  formatarTelefoneOperador,
  paisDoTelefone,
  telefoneOperadorE164,
} from "./telefoneOperador";

describe("telefone do operador", () => {
  it("mostra a bandeira e formata o celular brasileiro", () => {
    expect(paisDoTelefone("BR")).toMatchObject({ bandeira: "🇧🇷", ddi: "55" });
    expect(formatarTelefoneOperador("66999640274", "BR")).toBe("(66) 99964-0274");
    expect(telefoneOperadorE164("(66) 99964-0274", "BR")).toBe("5566999640274");
  });

  it("aceita colar o telefone brasileiro já com DDI", () => {
    expect(formatarTelefoneOperador("+55 66 99964-0274", "BR")).toBe("(66) 99964-0274");
  });

  it("mantém a seleção internacional sem aplicar o DDI brasileiro", () => {
    expect(telefoneOperadorE164("912 345 678", "PT")).toBe("351912345678");
  });
});
