import type { ParliagentResponse } from "../contracts/response.js";
import type { ModelAdapter } from "../runtime/adapter.js";

/**
 * Outcome-based evaluation rubric for measuring decision quality,
 * not just debate activity metrics.
 */

export interface EvaluationDimension {
  name: string;
  score: number;
  maxScore: number;
  notes: string;
}

export interface EvaluationResult {
  promptId: string;
  mode: string;
  dimensions: EvaluationDimension[];
  totalScore: number;
  maxPossible: number;
  percentScore: number;
  parliamentBeatBaseline: boolean | null;
  summary: string;
}

export interface EvaluationFixture {
  id: string;
  prompt: string;
  category: "factual" | "tradeoff" | "risk" | "calibration" | "actionability";
  expectedTraits: {
    shouldSurfaceDisagreement: boolean;
    minimumWarnings?: number;
    expectedRiskTopics?: string[];
    shouldBeActionable?: boolean;
    shouldDistinguishEvidenced?: boolean;
  };
  baselineAnswer?: string;
}

/**
 * Evaluate a ParliagentResponse against an outcome rubric.
 * Produces per-dimension scores across 5 quality axes.
 */
export function evaluateResponse(
  fixture: EvaluationFixture,
  response: ParliagentResponse,
  baselineResponse?: string,
): EvaluationResult {
  const dimensions: EvaluationDimension[] = [];

  dimensions.push(evaluateCompleteness(response));
  dimensions.push(evaluateTradeoffQuality(fixture, response));
  dimensions.push(evaluateRiskRecall(fixture, response));
  dimensions.push(evaluateCalibration(fixture, response));
  dimensions.push(evaluateActionability(fixture, response));

  const totalScore = dimensions.reduce((sum, d) => sum + d.score, 0);
  const maxPossible = dimensions.reduce((sum, d) => sum + d.maxScore, 0);
  const percentScore = maxPossible > 0 ? Math.round((totalScore / maxPossible) * 100) : 0;

  let parliamentBeatBaseline: boolean | null = null;
  if (baselineResponse) {
    const baselineAsResponse: ParliagentResponse = {
      finalAnswer: baselineResponse,
      decisionType: "uncertain",
      activatedSeats: [],
      whyTheseSeats: "",
    };
    const baselineDims: EvaluationDimension[] = [];
    baselineDims.push(evaluateCompleteness(baselineAsResponse));
    baselineDims.push(evaluateTradeoffQuality(fixture, baselineAsResponse));
    baselineDims.push(evaluateRiskRecall(fixture, baselineAsResponse));
    baselineDims.push(evaluateCalibration(fixture, baselineAsResponse));
    baselineDims.push(evaluateActionability(fixture, baselineAsResponse));
    const baselineTotal = baselineDims.reduce((sum, d) => sum + d.score, 0);
    parliamentBeatBaseline = totalScore > baselineTotal;
  }

  return {
    promptId: fixture.id,
    mode: "evaluated",
    dimensions,
    totalScore,
    maxPossible,
    percentScore,
    parliamentBeatBaseline,
    summary: buildEvaluationSummary(dimensions, percentScore),
  };
}

function evaluateCompleteness(response: ParliagentResponse): EvaluationDimension {
  let score = 0;
  const notes: string[] = [];

  if (response.finalAnswer && response.finalAnswer.length > 50) {
    score += 2;
    notes.push("Substantive answer");
  } else {
    notes.push("Answer too brief or missing");
  }

  if (response.decisionType !== "uncertain") {
    score += 1;
    notes.push(`Clear decision: ${response.decisionType}`);
  }

  if (response.activatedSeats.length >= 2) {
    score += 1;
    notes.push(`${response.activatedSeats.length} seats participated`);
  }

  if (response.whyTheseSeats && response.whyTheseSeats.length > 10) {
    score += 1;
    notes.push("Routing rationale present");
  }

  return { name: "completeness", score, maxScore: 5, notes: notes.join("; ") };
}

function evaluateTradeoffQuality(
  fixture: EvaluationFixture,
  response: ParliagentResponse,
): EvaluationDimension {
  let score = 0;
  const notes: string[] = [];

  if (fixture.expectedTraits.shouldSurfaceDisagreement) {
    if (response.minorityReport) {
      score += 2;
      notes.push("Minority report surfaced");
    } else if (response.decisionType === "split" || response.decisionType === "uncertain") {
      score += 1;
      notes.push("Split detected but no minority report");
    } else {
      notes.push("Expected disagreement not surfaced");
    }

    if (response.openQuestions && response.openQuestions.length > 0) {
      score += 1;
      notes.push(`${response.openQuestions.length} open questions`);
    }
  } else {
    if (response.decisionType === "consensus" || response.decisionType === "majority") {
      score += 3;
      notes.push("Appropriate convergence for low-tradeoff question");
    } else {
      score += 1;
      notes.push("Unnecessary divergence on straightforward question");
    }
  }

  if (response.debateSummary && response.debateSummary.length > 50) {
    score += 1;
    notes.push("Debate summary provides context");
  }

  return { name: "tradeoff_quality", score, maxScore: 4, notes: notes.join("; ") };
}

function evaluateRiskRecall(
  fixture: EvaluationFixture,
  response: ParliagentResponse,
): EvaluationDimension {
  let score = 0;
  const notes: string[] = [];
  const expectedWarnings = fixture.expectedTraits.minimumWarnings ?? 0;

  const actualWarnings = response.warnings?.length ?? 0;
  if (actualWarnings >= expectedWarnings) {
    score += 2;
    notes.push(`${actualWarnings} warnings (expected ≥${expectedWarnings})`);
  } else if (actualWarnings > 0) {
    score += 1;
    notes.push(`${actualWarnings} warnings (expected ≥${expectedWarnings})`);
  } else if (expectedWarnings > 0) {
    notes.push(`No warnings (expected ≥${expectedWarnings})`);
  } else {
    score += 2;
    notes.push("No warnings expected, none raised");
  }

  const riskTopics = fixture.expectedTraits.expectedRiskTopics ?? [];
  if (riskTopics.length > 0) {
    const allText = [
      response.finalAnswer,
      response.minorityReport ?? "",
      ...(response.warnings ?? []),
      ...(response.openQuestions ?? []),
    ].join(" ").toLowerCase();

    const found = riskTopics.filter((topic) => {
      const pattern = new RegExp(`\\b${topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
      return pattern.test(allText);
    });
    if (found.length === riskTopics.length) {
      score += 2;
      notes.push(`All risk topics surfaced: ${found.join(", ")}`);
    } else if (found.length > 0) {
      score += 1;
      notes.push(`${found.length}/${riskTopics.length} risk topics: ${found.join(", ")}`);
    } else {
      notes.push(`0/${riskTopics.length} expected risk topics found`);
    }
  } else {
    score += 2;
  }

  return { name: "risk_recall", score, maxScore: 4, notes: notes.join("; ") };
}

function evaluateCalibration(
  fixture: EvaluationFixture,
  response: ParliagentResponse,
): EvaluationDimension {
  let score = 0;
  const notes: string[] = [];

  const trace = response.traceArtifact;
  if (trace) {
    const lastRound = trace.rounds[trace.rounds.length - 1];
    if (lastRound) {
      const resolved = lastRound.resolvedCount ?? 0;
      const splits = lastRound.acceptedSplitCount ?? 0;
      const unresolved = lastRound.unresolvedCount ?? 0;

      if (resolved + splits > 0) {
        score += 1;
        notes.push(`Dispute lifecycle active: ${resolved} resolved, ${splits} splits`);
      }

      if (unresolved > 0 && response.openQuestions && response.openQuestions.length > 0) {
        score += 1;
        notes.push("Open questions match unresolved disputes");
      } else if (unresolved === 0) {
        score += 1;
        notes.push("No unresolved disputes");
      }
    }
  }

  if (fixture.expectedTraits.shouldDistinguishEvidenced) {
    const hasEvidenceLanguage = /\b(verified|evidenced|unverified|speculative|needs verification)\b/i
      .test(response.finalAnswer);
    if (hasEvidenceLanguage) {
      score += 1;
      notes.push("Answer distinguishes evidence quality");
    } else {
      notes.push("No evidence-quality distinction in answer");
    }
  }

  const maxCalibration = fixture.expectedTraits.shouldDistinguishEvidenced ? 3 : 2;
  return { name: "calibration", score, maxScore: maxCalibration, notes: notes.join("; ") };
}

function evaluateActionability(
  fixture: EvaluationFixture,
  response: ParliagentResponse,
): EvaluationDimension {
  let score = 0;
  const notes: string[] = [];

  if (!fixture.expectedTraits.shouldBeActionable) {
    return { name: "actionability", score: 3, maxScore: 3, notes: "N/A for this fixture" };
  }

  const hasStructure = /\b(\d+[\.\)]\s|step\s|first|second|next|then)\b/i.test(response.finalAnswer);
  if (hasStructure) {
    score += 1;
    notes.push("Structured/actionable format");
  }

  const hasConcreteActions = response.finalAnswer.length > 100;
  if (hasConcreteActions) {
    score += 1;
    notes.push("Substantive action content");
  }

  if (response.warnings && response.warnings.length > 0) {
    score += 1;
    notes.push("Risks flagged alongside actions");
  } else {
    notes.push("No risk flagging alongside actions");
  }

  return { name: "actionability", score, maxScore: 3, notes: notes.join("; ") };
}

function buildEvaluationSummary(
  dimensions: EvaluationDimension[],
  percentScore: number,
): string {
  const strengths = dimensions
    .filter((d) => d.score >= d.maxScore * 0.7)
    .map((d) => d.name);
  const weaknesses = dimensions
    .filter((d) => d.score < d.maxScore * 0.5)
    .map((d) => d.name);

  const parts: string[] = [`Score: ${percentScore}%`];
  if (strengths.length) parts.push(`Strengths: ${strengths.join(", ")}`);
  if (weaknesses.length) parts.push(`Weaknesses: ${weaknesses.join(", ")}`);

  return parts.join(". ");
}

export const EVALUATION_FIXTURES: EvaluationFixture[] = [
  {
    id: "arch-tradeoff",
    prompt: "Should we use microservices or a monolith for a new fintech product with 3 engineers?",
    category: "tradeoff",
    expectedTraits: {
      shouldSurfaceDisagreement: true,
      expectedRiskTopics: ["complexity", "team size", "scale"],
      shouldBeActionable: true,
    },
  },
  {
    id: "security-review",
    prompt: "Review the security of an API that stores user credentials in a PostgreSQL database with bcrypt hashing.",
    category: "risk",
    expectedTraits: {
      shouldSurfaceDisagreement: true,
      minimumWarnings: 1,
      expectedRiskTopics: ["credential", "encryption"],
      shouldBeActionable: true,
    },
  },
  {
    id: "factual-simple",
    prompt: "What is the time complexity of binary search?",
    category: "factual",
    expectedTraits: {
      shouldSurfaceDisagreement: false,
      shouldDistinguishEvidenced: false,
    },
  },
  {
    id: "strategic-pivot",
    prompt: "Our SaaS product has flat growth. A competitor just raised $50M. Should we pivot to enterprise or double down on SMB?",
    category: "tradeoff",
    expectedTraits: {
      shouldSurfaceDisagreement: true,
      expectedRiskTopics: ["market", "competition", "resource"],
      shouldBeActionable: true,
    },
  },
  {
    id: "calibration-uncertain",
    prompt: "Will quantum computing make current encryption obsolete within 5 years?",
    category: "calibration",
    expectedTraits: {
      shouldSurfaceDisagreement: true,
      shouldDistinguishEvidenced: true,
    },
  },
  {
    id: "ethics-ai-hiring",
    prompt: "Should we use an AI model to screen job applications? The model was trained on historical hiring data.",
    category: "risk",
    expectedTraits: {
      shouldSurfaceDisagreement: true,
      minimumWarnings: 1,
      expectedRiskTopics: ["bias", "fairness"],
      shouldBeActionable: true,
    },
  },
  {
    id: "plan-migration",
    prompt: "Create a plan to migrate our monolithic Node.js app to microservices over 6 months.",
    category: "actionability",
    expectedTraits: {
      shouldSurfaceDisagreement: true,
      expectedRiskTopics: ["risk", "complexity"],
      shouldBeActionable: true,
    },
  },
  {
    id: "low-stakes-writing",
    prompt: "Write a short README for a calculator library.",
    category: "factual",
    expectedTraits: {
      shouldSurfaceDisagreement: false,
    },
  },
];

export interface ComparisonResult {
  fixture: EvaluationFixture;
  parliament: EvaluationResult;
  baseline: EvaluationResult;
  parliamentWins: boolean;
  marginPercent: number;
  summary: string;
}

/**
 * Generate a baseline response from a single model call.
 * This creates a minimal ParliagentResponse shape from a flat model answer,
 * suitable for same-rubric comparison.
 */
export async function generateBaseline(
  prompt: string,
  adapter: ModelAdapter,
): Promise<ParliagentResponse> {
  const result = await adapter.complete(
    [
      { role: "system", content: "You are a helpful assistant. Answer the question directly and thoroughly." },
      { role: "user", content: prompt },
    ],
    { temperature: 0.7, maxTokens: 1024 },
  );

  return {
    finalAnswer: result.content,
    decisionType: "uncertain",
    activatedSeats: [],
    whyTheseSeats: "",
  };
}

/**
 * Compare parliament response vs single-model baseline on the same rubric.
 * Both are evaluated through the identical 5-dimension scoring function.
 */
export function compareWithBaseline(
  fixture: EvaluationFixture,
  parliamentResponse: ParliagentResponse,
  baselineResponse: ParliagentResponse,
): ComparisonResult {
  const parliament = evaluateResponse(fixture, parliamentResponse);
  const baseline = evaluateResponse(fixture, baselineResponse);

  const parliamentWins = parliament.totalScore > baseline.totalScore;
  const margin = parliament.percentScore - baseline.percentScore;

  const dimComparison = parliament.dimensions.map((pd) => {
    const bd = baseline.dimensions.find((d) => d.name === pd.name)!;
    const diff = pd.score - bd.score;
    if (diff > 0) return `${pd.name}: +${diff}`;
    if (diff < 0) return `${pd.name}: ${diff}`;
    return `${pd.name}: tied`;
  }).join(", ");

  return {
    fixture,
    parliament,
    baseline,
    parliamentWins,
    marginPercent: margin,
    summary: `Parliament ${margin}% vs baseline. ${dimComparison}`,
  };
}
