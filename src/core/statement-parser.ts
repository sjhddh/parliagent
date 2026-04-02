import type { SeatStatement } from "../contracts/trace.js";

export const RETRY_FEEDBACK = `Your previous response could not be parsed as valid JSON. Please respond with ONLY a valid JSON object — no markdown fences, no preamble text, no trailing commentary. Just the raw JSON object starting with { and ending with }.`;

export const STATEMENT_JSON_SCHEMA = {
  name: "seat_statement",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["stance", "summary", "claims", "claimProvenance", "objections", "confidence"],
    properties: {
      stance: { type: "string", enum: ["support", "mixed", "oppose", "uncertain"] },
      summary: { type: "string" },
      claims: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: { type: "string" },
      },
      claimProvenance: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: { type: "string", enum: ["supported", "inferred", "speculative", "missing_evidence"] },
      },
      objections: {
        type: "array",
        maxItems: 2,
        items: { type: "string" },
      },
      confidence: {
        type: "integer",
        minimum: 1,
        maximum: 5,
      },
      warnings: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
} as const;

/**
 * Extract and parse JSON from LLM output using multiple strategies:
 * 1. Direct parse (if output is clean JSON)
 * 2. Strip markdown fences and parse
 * 3. Brace-depth extraction (handles preamble/trailing text)
 * 4. Truncation recovery (close unclosed braces/brackets)
 * 5. Regex fallback for individual fields
 */
function extractJSON(raw: string): unknown {
  const text = raw.trim();

  const strategies: Array<() => unknown> = [
    () => JSON.parse(text),
    () => {
      const stripped = text
        .replace(/^[^{]*/, "")
        .replace(/```\s*$/g, "")
        .trim();
      return JSON.parse(stripped);
    },
    () => extractByBraceDepth(text),
    () => recoverTruncatedJSON(text),
    () => extractFieldsViaRegex(text),
  ];

  for (const strategy of strategies) {
    try {
      const result = strategy();
      if (result && typeof result === "object") return result;
    } catch {
      continue;
    }
  }

  throw new Error("No valid JSON found after all extraction strategies");
}

function extractByBraceDepth(raw: string): unknown {
  const text = raw.replace(/```(?:json|JSON|js|javascript|typescript)?\s*\n?/g, "").trim();

  const braceStart = text.indexOf("{");
  if (braceStart === -1) throw new Error("No JSON object found");

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(braceStart, i + 1));
      }
    }
  }

  throw new Error("Unbalanced JSON braces");
}

function recoverTruncatedJSON(raw: string): unknown {
  const text = raw.replace(/```(?:json|JSON|js|javascript|typescript)?\s*\n?/g, "").trim();
  const braceStart = text.indexOf("{");
  if (braceStart === -1) throw new Error("No JSON");

  let fragment = text.slice(braceStart);

  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of fragment) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") openBraces++;
    if (ch === "}") openBraces--;
    if (ch === "[") openBrackets++;
    if (ch === "]") openBrackets--;
  }

  if (inString) fragment += '"';

  const lastSignificant = fragment.search(/["\d\]}\w]\s*$/);
  if (lastSignificant >= 0) {
    const afterLast = fragment.slice(lastSignificant + 1).trim();
    if (afterLast === "" || afterLast === ",") {
      fragment = fragment.slice(0, lastSignificant + 1);
    }
  }

  while (openBrackets > 0) {
    fragment += "]";
    openBrackets--;
  }
  while (openBraces > 0) {
    fragment += "}";
    openBraces--;
  }

  return JSON.parse(fragment);
}

function extractFieldsViaRegex(raw: string): Record<string, unknown> {
  const stanceMatch = raw.match(/"stance"\s*:\s*"(support|mixed|oppose|uncertain)"/);
  const summaryMatch = raw.match(/"summary"\s*:\s*"([^"]+)"/);
  const confidenceMatch = raw.match(/"confidence"\s*:\s*(\d)/);

  if (!stanceMatch && !summaryMatch) throw new Error("No recognizable fields");

  const claimsMatch = raw.match(/"claims"\s*:\s*\[([^\]]*)\]/);
  let claims: string[] = [];
  if (claimsMatch) {
    claims = claimsMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter((s) => s.length > 0);
  }

  return {
    stance: stanceMatch?.[1] ?? "uncertain",
    summary: summaryMatch?.[1] ?? raw.slice(0, 150),
    claims: claims.length > 0 ? claims : ["Recovered from partial output"],
    objections: [],
    confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 2,
  };
}

export function parseStatement(raw: string, seatId: string, round: number): SeatStatement {
  try {
    const parsed = extractJSON(raw) as Record<string, unknown>;

    const claims = Array.isArray(parsed.claims)
      ? parsed.claims.slice(0, 3).map(String)
      : ["Position stated without specific claims"];

    const validProvenance = ["supported", "inferred", "speculative", "missing_evidence"] as const;
    type Provenance = typeof validProvenance[number];

    let claimProvenance: Provenance[] | undefined;
    if (Array.isArray(parsed.claimProvenance)) {
      const rawProv = parsed.claimProvenance.slice(0, claims.length) as unknown[];
      claimProvenance = rawProv.map((p): Provenance =>
        validProvenance.includes(String(p) as Provenance) ? (String(p) as Provenance) : "inferred"
      );
      while (claimProvenance.length < claims.length) {
        claimProvenance.push("missing_evidence");
      }
    }

    return {
      seatId,
      round,
      stance: validateStance(parsed.stance),
      summary: String(parsed.summary ?? "No summary provided"),
      claims,
      ...(claimProvenance !== undefined ? { claimProvenance } : {}),
      objections: Array.isArray(parsed.objections)
        ? parsed.objections.slice(0, 2).map(String)
        : [],
      confidence: validateConfidence(parsed.confidence),
      ...(Array.isArray(parsed.warnings) && parsed.warnings.length > 0
        ? { warnings: parsed.warnings.map(String) }
        : {}),
    };
  } catch {
    return {
      seatId,
      round,
      stance: "uncertain",
      summary: raw.slice(0, 200),
      claims: ["Unable to parse structured response"],
      objections: [],
      confidence: 2,
    };
  }
}

function validateStance(s: unknown): SeatStatement["stance"] {
  const valid = ["support", "mixed", "oppose", "uncertain"];
  return valid.includes(String(s)) ? (String(s) as SeatStatement["stance"]) : "uncertain";
}

function validateConfidence(c: unknown): 1 | 2 | 3 | 4 | 5 {
  const n = Number(c);
  if (n >= 1 && n <= 5) return Math.round(n) as 1 | 2 | 3 | 4 | 5;
  return 3;
}

export function isDegradedParse(stmt: SeatStatement): boolean {
  return (
    stmt.claims.some((c) =>
      c === "Recovered from partial output" ||
      c === "Unable to parse structured response" ||
      c === "Seat could not produce a response" ||
      c === "Position stated without specific claims"
    ) ||
    (stmt.stance === "uncertain" && stmt.confidence <= 2 && stmt.summary.startsWith("{"))
  );
}

export function isSeatFailure(stmt: SeatStatement): boolean {
  return stmt.claims.length === 1 && stmt.claims[0] === "Seat could not produce a response";
}

export function fallbackStatement(
  seatId: string,
  round: number,
  error: unknown,
): SeatStatement {
  return {
    seatId,
    round,
    stance: "uncertain",
    summary: `Seat unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    claims: ["Seat could not produce a response"],
    objections: [],
    confidence: 1,
    warnings: [`Seat ${seatId} failed to respond`],
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
