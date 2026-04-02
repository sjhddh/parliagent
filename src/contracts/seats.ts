import { z } from "zod";

export const ModelClass = z.enum(["chair", "frontier", "support"]);
export type ModelClass = z.infer<typeof ModelClass>;

export const ProviderId = z.enum(["openai", "anthropic", "google", "flock"]);
export type ProviderId = z.infer<typeof ProviderId>;

export const FallbackStep = z.enum(["preferred", "primary", "any-available"]);
export type FallbackStep = z.infer<typeof FallbackStep>;

export const SubstratePolicy = z.object({
  preferredProvider: z.union([ProviderId, z.literal("primary")]),
  fallbackChain: z.array(FallbackStep),
  modelClass: ModelClass,
});
export type SubstratePolicy = z.infer<typeof SubstratePolicy>;

export const SeatCategory = z.enum([
  "procedural",
  "model-representative",
  "computing-foundations",
  "modern-computing",
  "philosophy",
  "mathematics",
  "physics",
  "economics-strategy",
  "psychology-cognition",
  "product-operations",
  "civic-ethics",
]);
export type SeatCategory = z.infer<typeof SeatCategory>;

export const SeatProfile = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  domain: z.string(),
  category: SeatCategory,
  strengths: z.array(z.string()),
  blindSpots: z.array(z.string()),
  speakingStyle: z.string(),
  defaultModelClass: ModelClass,
  systemPrompt: z.string(),
  isStarter: z.boolean().default(false),
  providerAffinity: z.string().optional(),
  substrate: SubstratePolicy.optional(),
});
export type SeatProfile = z.infer<typeof SeatProfile>;
