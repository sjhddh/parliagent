import { describe, it, expect } from "vitest";
import {
  resolveOutputLanguage,
  buildSynthesisPrompt,
  getSynthesisMaxTokens,
} from "../src/core/synthesis.js";
import { ParliamentRequest } from "../src/contracts/request.js";

describe("Output Language", () => {
  describe("resolveOutputLanguage", () => {
    it("returns undefined for English", () => {
      expect(resolveOutputLanguage("en")).toBeUndefined();
      expect(resolveOutputLanguage("en-US")).toBeUndefined();
      expect(resolveOutputLanguage("EN")).toBeUndefined();
      expect(resolveOutputLanguage("en-GB")).toBeUndefined();
    });

    it("returns undefined for undefined/empty", () => {
      expect(resolveOutputLanguage(undefined)).toBeUndefined();
      expect(resolveOutputLanguage("")).toBeUndefined();
    });

    it("returns the language code for non-English", () => {
      expect(resolveOutputLanguage("zh")).toBe("zh");
      expect(resolveOutputLanguage("zh-CN")).toBe("zh-CN");
      expect(resolveOutputLanguage("ja")).toBe("ja");
      expect(resolveOutputLanguage("es")).toBe("es");
      expect(resolveOutputLanguage("fr")).toBe("fr");
      expect(resolveOutputLanguage("ko")).toBe("ko");
    });

    it("trims whitespace", () => {
      expect(resolveOutputLanguage("  zh  ")).toBe("zh");
    });
  });

  describe("buildSynthesisPrompt with outputLanguage", () => {
    it("includes no language instruction for English output", () => {
      const prompt = buildSynthesisPrompt({
        prompt: "test",
        answerMode: "answer",
        decisionType: "consensus",
        outputLength: "standard",
        rounds: [],
        outputLanguage: "en",
      });
      expect(prompt).not.toContain("Output language");
      expect(prompt).not.toContain("IMPORTANT");
    });

    it("includes no language instruction when language is omitted", () => {
      const prompt = buildSynthesisPrompt({
        prompt: "test",
        answerMode: "answer",
        decisionType: "consensus",
        outputLength: "standard",
        rounds: [],
      });
      expect(prompt).not.toContain("Output language");
    });

    it("includes language instruction for Chinese output", () => {
      const prompt = buildSynthesisPrompt({
        prompt: "test",
        answerMode: "answer",
        decisionType: "consensus",
        outputLength: "standard",
        rounds: [],
        outputLanguage: "zh",
      });
      expect(prompt).toContain("Output language");
      expect(prompt).toContain("zh");
      expect(prompt).toContain("internal deliberation is always in English");
    });

    it("includes language instruction for Japanese output", () => {
      const prompt = buildSynthesisPrompt({
        prompt: "test",
        answerMode: "memo",
        decisionType: "split",
        outputLength: "standard",
        rounds: [],
        outputLanguage: "ja",
      });
      expect(prompt).toContain("ja");
      expect(prompt).toContain("options memo");
    });

    it("works with all answer modes + non-English", () => {
      const modes = ["answer", "memo", "plan", "review", "transcript"] as const;
      for (const mode of modes) {
        const prompt = buildSynthesisPrompt({
          prompt: "test",
          answerMode: mode,
          decisionType: "majority",
          outputLength: "standard",
          rounds: [],
          outputLanguage: "es",
        });
        expect(prompt).toContain("es");
      }
    });
  });

  describe("getSynthesisMaxTokens with outputLanguage", () => {
    it("returns normal tokens for English", () => {
      const en = getSynthesisMaxTokens("answer", "standard", "en");
      const none = getSynthesisMaxTokens("answer", "standard");
      expect(en).toBe(none);
    });

    it("returns 1.3x tokens for non-English", () => {
      const en = getSynthesisMaxTokens("answer", "standard");
      const zh = getSynthesisMaxTokens("answer", "standard", "zh");
      expect(zh).toBe(Math.round(en * 1.3));
    });
  });

  describe("ParliamentRequest schema", () => {
    it("accepts outputLanguage", () => {
      const result = ParliamentRequest.safeParse({
        prompt: "test",
        outputLanguage: "zh-CN",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.outputLanguage).toBe("zh-CN");
      }
    });

    it("accepts request without outputLanguage", () => {
      const result = ParliamentRequest.safeParse({ prompt: "test" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.outputLanguage).toBeUndefined();
      }
    });
  });
});
