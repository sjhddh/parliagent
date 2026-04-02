import { describe, it, expect } from "vitest";
import {
  parseStatement,
  isDegradedParse,
  isSeatFailure,
  fallbackStatement,
  estimateTokens,
  STATEMENT_JSON_SCHEMA,
} from "../src/core/statement-parser.js";

const VALID_JSON = JSON.stringify({
  stance: "support",
  summary: "The approach is well-structured.",
  claims: ["Clean architecture", "Good separation"],
  claimProvenance: ["supported", "inferred"],
  objections: ["Could improve docs"],
  confidence: 4,
});

describe("parseStatement — Strategy 1: clean JSON", () => {
  it("parses well-formed JSON directly", () => {
    const stmt = parseStatement(VALID_JSON, "TestSeat", 1);
    expect(stmt.seatId).toBe("TestSeat");
    expect(stmt.round).toBe(1);
    expect(stmt.stance).toBe("support");
    expect(stmt.claims).toEqual(["Clean architecture", "Good separation"]);
    expect(stmt.claimProvenance).toEqual(["supported", "inferred"]);
    expect(stmt.objections).toEqual(["Could improve docs"]);
    expect(stmt.confidence).toBe(4);
  });

  it("parses JSON with whitespace padding", () => {
    const stmt = parseStatement(`  \n${VALID_JSON}\n  `, "A", 1);
    expect(stmt.stance).toBe("support");
    expect(stmt.claims.length).toBe(2);
  });

  it("handles warnings field", () => {
    const json = JSON.stringify({
      stance: "oppose",
      summary: "Security concern",
      claims: ["Keys exposed"],
      claimProvenance: ["supported"],
      objections: [],
      confidence: 5,
      warnings: ["Critical vulnerability"],
    });
    const stmt = parseStatement(json, "SecuritySeat", 1);
    expect(stmt.warnings).toEqual(["Critical vulnerability"]);
  });
});

describe("parseStatement — Strategy 2: strip preamble / markdown fences", () => {
  it("strips ```json fences", () => {
    const raw = "```json\n" + VALID_JSON + "\n```";
    const stmt = parseStatement(raw, "A", 1);
    expect(stmt.stance).toBe("support");
    expect(stmt.claims.length).toBe(2);
  });

  it("strips preamble text before JSON", () => {
    const raw = "Here is my response:\n\n" + VALID_JSON;
    const stmt = parseStatement(raw, "A", 1);
    expect(stmt.stance).toBe("support");
  });

  it("strips trailing text after fences", () => {
    const raw = "```json\n" + VALID_JSON + "\n```\n\nI hope this helps!";
    const stmt = parseStatement(raw, "A", 1);
    expect(stmt.stance).toBe("support");
  });
});

describe("parseStatement — Strategy 3: brace-depth extraction", () => {
  it("extracts JSON embedded in narrative text", () => {
    const raw = `As requested, here is my analysis: ${VALID_JSON} That concludes my position.`;
    const stmt = parseStatement(raw, "A", 1);
    expect(stmt.stance).toBe("support");
    expect(stmt.claims.length).toBe(2);
  });

  it("handles nested braces inside string values", () => {
    const json = JSON.stringify({
      stance: "mixed",
      summary: 'The function signature is fn(a: {x: number})',
      claims: ["Type safety"],
      claimProvenance: ["inferred"],
      objections: [],
      confidence: 3,
    });
    const raw = `Here: ${json} done.`;
    const stmt = parseStatement(raw, "A", 1);
    expect(stmt.stance).toBe("mixed");
  });

  it("handles escaped quotes in strings", () => {
    const json = JSON.stringify({
      stance: "support",
      summary: 'The "best" approach uses structured data',
      claims: ["Works well"],
      claimProvenance: ["inferred"],
      objections: [],
      confidence: 4,
    });
    const raw = `Response: ${json}`;
    const stmt = parseStatement(raw, "A", 1);
    expect(stmt.summary).toContain("best");
  });
});

describe("parseStatement — Strategy 4: truncation recovery", () => {
  it("recovers from missing closing brace", () => {
    const truncated = '{"stance": "support", "summary": "Good approach", "claims": ["Point A"], "claimProvenance": ["inferred"], "objections": [], "confidence": 4';
    const stmt = parseStatement(truncated, "A", 1);
    expect(stmt.stance).toBe("support");
    expect(stmt.claims).toEqual(["Point A"]);
  });

  it("recovers from missing closing bracket and brace", () => {
    const truncated = '{"stance": "oppose", "summary": "Bad idea", "claims": ["Risk A", "Risk B"], "claimProvenance": ["supported", "speculative"], "objections": ["No mitigation"';
    const stmt = parseStatement(truncated, "A", 1);
    expect(stmt.stance).toBe("oppose");
  });

  it("recovers from truncated string value", () => {
    const truncated = '{"stance": "mixed", "summary": "The approach has tradeoffs that need to be wei';
    const stmt = parseStatement(truncated, "A", 1);
    expect(stmt.stance).toBe("mixed");
  });

  it("recovers from fenced truncated JSON", () => {
    const raw = "```json\n" + '{"stance": "support", "summary": "Good", "claims": ["A"], "objections": [], "confidence": 3';
    const stmt = parseStatement(raw, "A", 1);
    expect(stmt.stance).toBe("support");
  });
});

describe("parseStatement — Strategy 5: regex field extraction", () => {
  it("extracts from severely malformed output with recognizable fields", () => {
    const raw = `I think the "stance": "oppose" is clear. My "summary": "This is risky" because of "claims": ["Security gap"] and my "confidence": 5`;
    const stmt = parseStatement(raw, "A", 1);
    expect(stmt.stance).toBe("oppose");
    expect(stmt.summary).toBe("This is risky");
    expect(stmt.confidence).toBe(5);
  });

  it("falls back to recovered claims when no claims array found", () => {
    const raw = `{"stance": "support", "summary": "Looks good"`;
    const stmt = parseStatement(raw, "A", 1);
    expect(stmt.stance).toBe("support");
  });
});

describe("parseStatement — total failure fallback", () => {
  it("returns degraded statement for completely unparseable input", () => {
    const raw = "I don't know what to say about this topic.";
    const stmt = parseStatement(raw, "FailSeat", 2);
    expect(stmt.seatId).toBe("FailSeat");
    expect(stmt.round).toBe(2);
    expect(stmt.stance).toBe("uncertain");
    expect(stmt.confidence).toBe(2);
    expect(stmt.claims).toEqual(["Unable to parse structured response"]);
    expect(stmt.summary).toBe(raw);
  });

  it("truncates long unparseable input in summary", () => {
    const raw = "X".repeat(500);
    const stmt = parseStatement(raw, "A", 1);
    expect(stmt.summary.length).toBe(200);
  });

  it("handles empty string input", () => {
    const stmt = parseStatement("", "A", 1);
    expect(stmt.stance).toBe("uncertain");
    expect(stmt.claims).toEqual(["Unable to parse structured response"]);
  });
});

describe("parseStatement — field validation and normalization", () => {
  it("caps claims at 3 items", () => {
    const json = JSON.stringify({
      stance: "support",
      summary: "S",
      claims: ["A", "B", "C", "D"],
      claimProvenance: ["inferred", "inferred", "inferred", "inferred"],
      objections: [],
      confidence: 3,
    });
    const stmt = parseStatement(json, "A", 1);
    expect(stmt.claims.length).toBe(3);
  });

  it("caps objections at 2 items", () => {
    const json = JSON.stringify({
      stance: "oppose",
      summary: "S",
      claims: ["A"],
      objections: ["O1", "O2", "O3"],
      confidence: 3,
    });
    const stmt = parseStatement(json, "A", 1);
    expect(stmt.objections.length).toBe(2);
  });

  it("clamps confidence to valid range", () => {
    const makeJson = (conf: number) => JSON.stringify({
      stance: "support", summary: "S", claims: ["A"], objections: [], confidence: conf,
    });
    expect(parseStatement(makeJson(0), "A", 1).confidence).toBe(3);
    expect(parseStatement(makeJson(6), "A", 1).confidence).toBe(3);
    expect(parseStatement(makeJson(1), "A", 1).confidence).toBe(1);
    expect(parseStatement(makeJson(5), "A", 1).confidence).toBe(5);
  });

  it("defaults invalid stance to uncertain", () => {
    const json = JSON.stringify({
      stance: "enthusiastic",
      summary: "S",
      claims: ["A"],
      objections: [],
      confidence: 3,
    });
    const stmt = parseStatement(json, "A", 1);
    expect(stmt.stance).toBe("uncertain");
  });

  it("coerces invalid provenance to inferred", () => {
    const json = JSON.stringify({
      stance: "support",
      summary: "S",
      claims: ["A", "B"],
      claimProvenance: ["supported", "proven"],
      objections: [],
      confidence: 3,
    });
    const stmt = parseStatement(json, "A", 1);
    expect(stmt.claimProvenance).toEqual(["supported", "inferred"]);
  });

  it("pads short provenance with missing_evidence", () => {
    const json = JSON.stringify({
      stance: "support",
      summary: "S",
      claims: ["A", "B", "C"],
      claimProvenance: ["supported"],
      objections: [],
      confidence: 3,
    });
    const stmt = parseStatement(json, "A", 1);
    expect(stmt.claimProvenance).toEqual(["supported", "missing_evidence", "missing_evidence"]);
  });

  it("omits claimProvenance when not present in input", () => {
    const json = JSON.stringify({
      stance: "support",
      summary: "S",
      claims: ["A"],
      objections: [],
      confidence: 3,
    });
    const stmt = parseStatement(json, "A", 1);
    expect(stmt.claimProvenance).toBeUndefined();
  });

  it("produces fallback claims when claims field is not an array", () => {
    const json = JSON.stringify({
      stance: "support",
      summary: "S",
      claims: "just a string",
      objections: [],
      confidence: 3,
    });
    const stmt = parseStatement(json, "A", 1);
    expect(stmt.claims).toEqual(["Position stated without specific claims"]);
  });

  it("omits warnings when empty array", () => {
    const json = JSON.stringify({
      stance: "support",
      summary: "S",
      claims: ["A"],
      objections: [],
      confidence: 3,
      warnings: [],
    });
    const stmt = parseStatement(json, "A", 1);
    expect(stmt.warnings).toBeUndefined();
  });
});

describe("isDegradedParse", () => {
  it("detects 'Recovered from partial output'", () => {
    const stmt = parseStatement("", "A", 1);
    // total failure produces "Unable to parse structured response"
    expect(isDegradedParse(stmt)).toBe(true);
  });

  it("detects 'Position stated without specific claims'", () => {
    const json = JSON.stringify({
      stance: "support",
      summary: "S",
      claims: "not-an-array",
      objections: [],
      confidence: 3,
    });
    const stmt = parseStatement(json, "A", 1);
    expect(isDegradedParse(stmt)).toBe(true);
  });

  it("detects raw JSON in summary heuristic", () => {
    const stmt = {
      seatId: "A",
      round: 1,
      stance: "uncertain" as const,
      summary: '{"some": "raw json that was not parsed"}',
      claims: ["Actual claim"],
      objections: [],
      confidence: 2 as const,
    };
    expect(isDegradedParse(stmt)).toBe(true);
  });

  it("returns false for healthy statement", () => {
    const stmt = parseStatement(VALID_JSON, "A", 1);
    expect(isDegradedParse(stmt)).toBe(false);
  });
});

describe("isSeatFailure", () => {
  it("detects failure signature", () => {
    const stmt = fallbackStatement("FailSeat", 1, new Error("timeout"));
    expect(isSeatFailure(stmt)).toBe(true);
  });

  it("returns false for normal statement", () => {
    const stmt = parseStatement(VALID_JSON, "A", 1);
    expect(isSeatFailure(stmt)).toBe(false);
  });

  it("returns false for degraded but not failed statement", () => {
    const stmt = parseStatement("", "A", 1);
    expect(isSeatFailure(stmt)).toBe(false);
  });
});

describe("fallbackStatement", () => {
  it("creates structured failure with error message", () => {
    const stmt = fallbackStatement("TestSeat", 2, new Error("API timeout"));
    expect(stmt.seatId).toBe("TestSeat");
    expect(stmt.round).toBe(2);
    expect(stmt.stance).toBe("uncertain");
    expect(stmt.confidence).toBe(1);
    expect(stmt.summary).toContain("API timeout");
    expect(stmt.claims).toEqual(["Seat could not produce a response"]);
    expect(stmt.warnings).toEqual(["Seat TestSeat failed to respond"]);
  });

  it("handles non-Error objects", () => {
    const stmt = fallbackStatement("A", 1, "string error");
    expect(stmt.summary).toContain("unknown error");
  });
});

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("STATEMENT_JSON_SCHEMA", () => {
  it("has required fields matching the expected seat statement shape", () => {
    const required = STATEMENT_JSON_SCHEMA.schema.required;
    expect(required).toContain("stance");
    expect(required).toContain("summary");
    expect(required).toContain("claims");
    expect(required).toContain("claimProvenance");
    expect(required).toContain("objections");
    expect(required).toContain("confidence");
  });

  it("does not require warnings (optional field)", () => {
    expect(STATEMENT_JSON_SCHEMA.schema.required).not.toContain("warnings");
  });
});
