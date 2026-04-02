import type { DebateMode, TaskType } from "../contracts/request.js";

export interface ModeConfig {
  maxRounds: number;
  targetAgreementRatio: number;
  seatCount: { min: number; max: number };
  defaultMaxTokens: number;
  defaultMaxLatencyMs: number;
}

export const MODE_CONFIGS: Record<DebateMode, ModeConfig> = {
  micro: {
    maxRounds: 1,
    targetAgreementRatio: 0.8,
    seatCount: { min: 2, max: 3 },
    defaultMaxTokens: 6000,
    defaultMaxLatencyMs: 8000,
  },
  fast: {
    maxRounds: 2,
    targetAgreementRatio: 0.75,
    seatCount: { min: 3, max: 5 },
    defaultMaxTokens: 15000,
    defaultMaxLatencyMs: 15000,
  },
  balanced: {
    maxRounds: 2,
    targetAgreementRatio: 0.7,
    seatCount: { min: 5, max: 9 },
    defaultMaxTokens: 28000,
    defaultMaxLatencyMs: 30000,
  },
  deep: {
    maxRounds: 3,
    targetAgreementRatio: 0.65,
    seatCount: { min: 7, max: 13 },
    defaultMaxTokens: 60000,
    defaultMaxLatencyMs: 60000,
  },
};

/**
 * Full parliagent: 32 debate seats, 1 round.
 *
 * Budget semantics: the token cap is checked between rounds, not mid-round.
 * With 32 seats executing in parallel, a single round consumes ~230-260k tokens.
 * maxRounds is set to 1 because a single round with 32 voices already produces
 * comprehensive deliberation (100+ disagreements on average). The token cap is
 * set to 300k to accommodate the round with headroom for synthesis.
 */
export const FULL_PARLIAGENT_CONFIG: ModeConfig = {
  maxRounds: 1,
  targetAgreementRatio: 0.5,
  seatCount: { min: 32, max: 32 },
  defaultMaxTokens: 300000,
  defaultMaxLatencyMs: 120000,
};

export interface ChamberPreset {
  required: string[];
  modelSeatPool: string[];
  domainSeats: string[];
}

export const CHAMBER_PRESETS: Record<TaskType, ChamberPreset> = {
  general: {
    required: ["Speaker"],
    modelSeatPool: ["OpenAISeat", "ClaudeSeat", "GeminiSeat"],
    domainSeats: [
      "AristotleSeat", "FeynmanSeat", "KahnemanSeat",
      "VonNeumannSeat", "ProductStrategySeat", "CitizenPragmatistSeat",
      "HumanComputerInteractionSeat", "JungSeat",
    ],
  },
  coding: {
    required: ["Speaker"],
    modelSeatPool: ["OpenAISeat", "ClaudeSeat", "GeminiSeat"],
    domainSeats: [
      "DijkstraSeat", "SecurityPrivacySeat", "ShannonSeat", "OperatorSeat",
      "TuringSeat", "KnuthSeat", "DistributedSystemsSeat", "MLSystemsSeat",
    ],
  },
  writing: {
    required: ["Speaker"],
    modelSeatPool: ["OpenAISeat", "ClaudeSeat", "GeminiSeat"],
    domainSeats: [
      "FeynmanSeat", "ShannonSeat", "AristotleSeat", "DesignCommunicationSeat",
      "ProductStrategySeat", "CognitiveScienceSeat", "HumanComputerInteractionSeat",
    ],
  },
  planning: {
    required: ["Speaker"],
    modelSeatPool: ["OpenAISeat", "ClaudeSeat", "GeminiSeat"],
    domainSeats: [
      "ProductStrategySeat", "OperatorSeat", "KahnemanSeat", "DijkstraSeat",
      "StrategySeat", "SmithSeat", "VonNeumannSeat",
    ],
  },
  analysis: {
    required: ["Speaker"],
    modelSeatPool: ["OpenAISeat", "ClaudeSeat", "GeminiSeat"],
    domainSeats: [
      "KahnemanSeat", "AristotleSeat", "ShannonSeat", "FeynmanSeat",
      "EuclidSeat", "GaussSeat", "NewtonSeat", "EinsteinSeat",
    ],
  },
  strategy: {
    required: ["Speaker"],
    modelSeatPool: ["OpenAISeat", "ClaudeSeat", "GeminiSeat"],
    domainSeats: [
      "ProductStrategySeat", "OperatorSeat", "KahnemanSeat", "AristotleSeat",
      "SecurityPrivacySeat", "SmithSeat", "KeynesSeat", "StrategySeat",
      "VonNeumannSeat",
    ],
  },
  ethics: {
    required: ["Speaker"],
    modelSeatPool: ["OpenAISeat", "ClaudeSeat", "GeminiSeat"],
    domainSeats: [
      "AristotleSeat", "KahnemanSeat", "SecurityPrivacySeat", "FeynmanSeat",
      "KantSeat", "NietzscheSeat", "EthicsHumanImpactSeat", "LawGovernanceSeat",
      "CitizenPragmatistSeat", "JungSeat",
    ],
  },
};

const SECURITY_KEYWORDS = [
  "security", "auth", "password", "credential", "privacy", "encrypt",
  "token", "api key", "secret", "vulnerability", "attack", "exploit",
  "injection", "xss", "csrf", "permission", "access control",
  "deployment", "infrastructure", "data handling",
];

export function shouldUpgradeSecurity(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return SECURITY_KEYWORDS.some((kw) => lower.includes(kw));
}
