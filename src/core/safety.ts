import type { SeatStatement } from "../contracts/trace.js";

/**
 * Detect suspiciously uniform outputs that suggest fake debate.
 * Returns warning strings if anti-collapse signals are found.
 */
export function detectAntiCollapse(statements: SeatStatement[]): string[] {
  const warnings: string[] = [];

  if (statements.length < 2) return warnings;

  const phraseOverlap = computePhraseOverlap(statements);
  if (phraseOverlap > 0.6) {
    warnings.push(
      `Anti-collapse warning: ${Math.round(phraseOverlap * 100)}% phrase overlap detected between seats — debate diversity may be low`,
    );
  }

  const allSameStance =
    statements.length > 2 &&
    new Set(statements.map((s) => s.stance)).size === 1;
  if (allSameStance) {
    const allHighConfidence = statements.every((s) => s.confidence >= 4);
    const noObjections = statements.every((s) => s.objections.length === 0);
    if (allHighConfidence && noObjections) {
      warnings.push(
        "Anti-collapse warning: All seats agree with high confidence and no objections — possible lazy consensus",
      );
    }
  }

  const summaries = statements.map((s) => s.summary.toLowerCase());
  for (let i = 0; i < summaries.length; i++) {
    for (let j = i + 1; j < summaries.length; j++) {
      if (summaries[i] === summaries[j] && summaries[i].length > 20) {
        warnings.push(
          `Anti-collapse warning: ${statements[i].seatId} and ${statements[j].seatId} produced identical summaries`,
        );
      }
    }
  }

  return warnings;
}

function computePhraseOverlap(statements: SeatStatement[]): number {
  if (statements.length < 2) return 0;

  const tokenSets = statements.map((s) => {
    const text = `${s.summary} ${s.claims.join(" ")}`;
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  });

  let totalOverlap = 0;
  let pairCount = 0;

  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      const a = tokenSets[i];
      const b = tokenSets[j];
      const intersection = new Set([...a].filter((x) => b.has(x)));
      const union = new Set([...a, ...b]);
      if (union.size > 0) {
        totalOverlap += intersection.size / union.size;
        pairCount++;
      }
    }
  }

  return pairCount > 0 ? totalOverlap / pairCount : 0;
}

const SENSITIVE_CATEGORIES = [
  {
    name: "medical",
    keywords: [
      "diagnos", "symptom", "treatment", "medication", "dosage", "prescription",
      "surgery", "disease", "cancer", "mental health", "suicide", "self-harm",
    ],
    warning:
      "This question touches on medical topics. Sun Parliament provides general discussion only, not medical advice. Consult a qualified healthcare professional.",
  },
  {
    name: "legal",
    keywords: [
      "lawsuit", "legal advice", "attorney", "liability", "contract dispute",
      "court", "sue", "criminal", "arrest", "warrant",
    ],
    warning:
      "This question touches on legal topics. Sun Parliament provides general discussion only, not legal advice. Consult a qualified attorney.",
  },
  {
    name: "financial",
    keywords: [
      "invest", "stock", "portfolio", "tax advice", "retirement fund",
      "financial plan", "trading", "crypto investment",
    ],
    warning:
      "This question touches on financial topics. Sun Parliament provides general discussion only, not financial advice. Consult a qualified financial advisor.",
  },
  {
    name: "safety-critical",
    keywords: [
      "weapon", "explosive", "poison", "how to hack", "bypass security",
      "illegal", "drug synthesis", "counterfeit",
    ],
    warning:
      "This question may involve safety-critical or potentially harmful content. Sun Parliament will not provide assistance with harmful activities.",
  },
];

type SafetyMode = "default" | "strict";

/**
 * Check prompt for sensitive content categories.
 * In strict mode, any keyword match in any category triggers a warning.
 * In default mode, only safety-critical categories need 1+ match.
 */
export function checkSafetyBoundaries(
  prompt: string,
  _safetyMode: SafetyMode = "default",
): string[] {
  const lower = prompt.toLowerCase();
  const warnings: string[] = [];

  for (const category of SENSITIVE_CATEGORIES) {
    const matches = category.keywords.filter((kw) => lower.includes(kw));
    if (matches.length >= 1) {
      warnings.push(category.warning);
    }
  }

  return warnings;
}

/**
 * Returns true if the prompt is in a hard-blocked safety category.
 * In strict mode, a single safety-critical keyword match triggers a block.
 * In default mode, 2+ keyword matches are required.
 */
export function isHardBlocked(
  prompt: string,
  safetyMode: SafetyMode = "default",
): boolean {
  const lower = prompt.toLowerCase();
  const threshold = safetyMode === "strict" ? 1 : 2;
  return SENSITIVE_CATEGORIES
    .filter((c) => c.name === "safety-critical")
    .some((c) => c.keywords.filter((kw) => lower.includes(kw)).length >= threshold);
}
