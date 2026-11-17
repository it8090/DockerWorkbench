import { describe, it, expect } from "vitest";
import { en, zh, translator } from "./i18n";
describe("Chinese and English localization", () => {
  it("keeps both language catalogs complete and English free of untranslated Chinese", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(en)) {
      expect(value, `empty English key ${key}`).not.toBe("");
      expect(value, `Chinese leaked into English ${key}`).not.toMatch(
        /[\u3400-\u9fff]/,
      );
      expect(zh[key as keyof typeof en]).not.toBe("");
    }
  });
  it("substitutes values without losing language-specific word order", () => {
    expect(
      translator("en")("operationScope", { count: 3, host: "server" }),
    ).toBe("3 containers on server");
    expect(
      translator("zh-CN")("operationScope", { count: 3, host: "server" }),
    ).toBe("server 上的 3 个容器");
  });
});
