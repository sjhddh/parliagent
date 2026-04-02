import type { DebateMode, TaskType } from "../contracts/request.js";
import { SeatRegistry, defaultRegistry } from "../seats/registry.js";
import {
  MODE_CONFIGS,
  CHAMBER_PRESETS,
  shouldUpgradeSecurity,
} from "./config.js";

export interface RoutingDecision {
  selectedSeatIds: string[];
  routingReason: string;
  classifiedTaskType: TaskType;
  isFullParliagent: boolean;
}

/**
 * Rule-based task classifier for v1.
 */
export function classifyTask(prompt: string): TaskType {
  const lower = prompt.toLowerCase();

  const signals: Record<TaskType, string[]> = {
    coding: [
      "code", "function", "implement", "debug", "refactor", "algorithm",
      "api", "database", "typescript", "javascript", "python", "rust",
      "class", "interface", "bug", "error", "compile", "runtime",
      "test", "unit test", "integration", "deploy", "docker", "git",
      "sql", "query", "endpoint", "rest", "graphql", "cli",
    ],
    writing: [
      "write", "draft", "essay", "blog", "article", "email", "copy",
      "rewrite", "tone", "audience", "persuade", "narrative", "story",
      "documentation", "readme", "explain to", "communicate",
    ],
    planning: [
      "plan", "roadmap", "milestone", "timeline", "project", "phase",
      "schedule", "prioritize", "backlog", "sprint", "scope", "resource",
      "deadline", "gantt", "kickoff", "initiative",
    ],
    analysis: [
      "analyze", "compare", "evaluate", "assess", "review", "investigate",
      "research", "data", "metrics", "report", "findings", "trend",
      "benchmark", "measure", "study", "survey",
    ],
    strategy: [
      "strategy", "competitive", "competitor", "market", "business", "growth", "revenue",
      "pricing", "moat", "positioning", "position against", "stakeholder", "investment",
      "founder", "startup", "pivot", "scale", "fundraise",
    ],
    ethics: [
      "ethical", "ethics", "moral", "morality", "fair", "fairness", "bias",
      "harm", "rights", "privacy", "consent", "responsible", "governance",
      "regulation", "compliance", "accountability", "transparency",
      "justice", "dignity", "discriminat",
    ],
    general: [],
  };

  let bestType: TaskType = "general";
  let bestScore = 0;

  for (const [taskType, keywords] of Object.entries(signals)) {
    if (taskType === "general") continue;
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestType = taskType as TaskType;
    }
  }

  return bestType;
}

/**
 * Select chamber for full parliagent mode: all seats except Speaker as chair.
 */
export function selectFullParliagent(
  prompt: string,
  taskType?: TaskType,
  excludeSeats?: string[],
  registry: SeatRegistry = defaultRegistry,
): RoutingDecision {
  const classified = taskType ?? classifyTask(prompt);
  const allSeats = registry.listAll();

  const selected = allSeats
    .filter((s) => s.id !== "Speaker")
    .filter((s) => !excludeSeats?.includes(s.id))
    .map((s) => s.id);

  selected.unshift("Speaker");

  return {
    selectedSeatIds: selected,
    routingReason: `Full parliagent: all ${selected.length - 1} debate seats activated. Task classified as "${classified}".`,
    classifiedTaskType: classified,
    isFullParliagent: true,
  };
}

export function selectChamber(
  prompt: string,
  mode: DebateMode,
  taskType?: TaskType,
  seatHints?: string[],
  excludeSeats?: string[],
  registry: SeatRegistry = defaultRegistry,
): RoutingDecision {
  const classified = taskType ?? classifyTask(prompt);
  const modeConfig = MODE_CONFIGS[mode];
  const preset = CHAMBER_PRESETS[classified];

  const selected: string[] = [...preset.required];

  const modelSeat = preset.modelSeatPool.find(
    (id) => !excludeSeats?.includes(id) && registry.has(id),
  );
  if (modelSeat && !selected.includes(modelSeat)) {
    selected.push(modelSeat);
  }

  const availableDomain = preset.domainSeats.filter(
    (id) => !excludeSeats?.includes(id) && !selected.includes(id) && registry.has(id),
  );

  const slotsRemaining = modeConfig.seatCount.max - selected.length;
  const domainToAdd = availableDomain.slice(
    0,
    Math.max(0, Math.min(slotsRemaining, modeConfig.seatCount.min - selected.length + 1)),
  );
  selected.push(...domainToAdd);

  if (seatHints) {
    for (const hint of seatHints) {
      if (
        !selected.includes(hint) &&
        !excludeSeats?.includes(hint) &&
        registry.has(hint) &&
        selected.length < modeConfig.seatCount.max
      ) {
        selected.push(hint);
      }
    }
  }

  if (
    shouldUpgradeSecurity(prompt) &&
    !selected.includes("SecurityPrivacySeat") &&
    !excludeSeats?.includes("SecurityPrivacySeat") &&
    registry.has("SecurityPrivacySeat")
  ) {
    if (selected.length < modeConfig.seatCount.max) {
      selected.push("SecurityPrivacySeat");
    }
  }

  const nonSpeaker = selected.filter((id) => id !== "Speaker");
  const reasons: string[] = [
    `Task classified as "${classified}"`,
    `Mode "${mode}" targets ${modeConfig.seatCount.min}-${modeConfig.seatCount.max} seats`,
    `Selected model representative: ${modelSeat ?? "none"}`,
    `Domain seats: ${nonSpeaker.filter((id) => id !== modelSeat).join(", ") || "none"}`,
  ];
  if (shouldUpgradeSecurity(prompt)) {
    reasons.push("Security seat priority upgraded due to prompt content");
  }

  return {
    selectedSeatIds: selected,
    routingReason: reasons.join(". "),
    classifiedTaskType: classified,
    isFullParliagent: false,
  };
}
