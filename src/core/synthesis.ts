import type { AnswerMode, OutputLength } from "../contracts/request.js";
import type { DecisionType } from "../contracts/response.js";
import type { RoundResult } from "../contracts/trace.js";

export interface SynthesisContext {
  prompt: string;
  answerMode: AnswerMode;
  decisionType: DecisionType;
  outputLength: OutputLength;
  rounds: RoundResult[];
  outputLanguage?: string;
}

const LENGTH_INSTRUCTIONS: Record<OutputLength, string> = {
  short: "Be extremely concise — 2-4 sentences maximum. No preamble.",
  standard: "Be thorough but focused — a few paragraphs. No filler.",
  long: "Be comprehensive and detailed. Cover all angles raised in debate.",
};

const MODE_PROMPTS: Record<AnswerMode, string> = {
  answer: `You are the Speaker synthesizing a parliamentary debate. Produce a clear, direct final answer.

Requirements:
- Lead with the answer, not the process
- Capture the strongest arguments that survived debate
- Note any unresolved disagreements honestly
- If consensus exists, state it clearly
- If split, present both sides fairly
- Include any safety warnings that were raised
- Distinguish between claims that are well-evidenced and those that are speculative or unverified
- For claims marked "missing_evidence", note that verification is needed`,

  memo: `You are the Speaker writing an options memo from a parliamentary debate. Structure the output as a decision memo.

Format:
- **Situation**: One sentence on what was debated
- **Options**: Enumerate the distinct positions that emerged (label each)
- **Analysis**: Key tradeoffs and arguments for each option. Mark speculative claims explicitly.
- **Recommendation**: The position with strongest support, with caveats
- **Risks**: Unresolved concerns and minority positions
- **Evidence gaps**: Claims that need verification before acting

Write for a busy decision-maker who needs to act, not study.`,

  plan: `You are the Speaker producing an implementation plan from a parliamentary debate.

Format:
- **Goal**: What this plan achieves (one sentence)
- **Approach**: The recommended path, incorporating debate consensus
- **Steps**: Numbered sequence of concrete actions
- **Dependencies**: What must be true or available
- **Risks & Mitigations**: Concerns raised during debate and how to address them
- **Open Questions**: Unresolved items requiring further input
- **Unverified assumptions**: Claims the plan relies on that lack evidence

Be specific and actionable. Each step should be something a person can start doing.`,

  review: `You are the Speaker producing a critical review from a parliamentary debate. The parliament's job was to find problems.

Format:
- **Verdict**: Overall assessment in one sentence
- **Strengths**: What the parliament agreed works well
- **Issues**: Problems identified, ordered by severity (critical → minor)
- **Risks**: Potential failure modes or concerns
- **Recommendations**: Specific suggestions for improvement
- **Minority Concerns**: Dissenting views that deserve attention
- **Evidence quality**: Note where conclusions are well-supported vs speculative

Be honest and specific. A review that finds no issues is probably not a good review.`,

  transcript: `You are the Speaker producing a formatted debate transcript. Present the full deliberation, not just conclusions.

Format:
- Show each seat's position with their name, stance, and key arguments
- Highlight where seats agreed and where they clashed
- Show how positions evolved across rounds (if multiple rounds occurred)
- Track dispute resolution: which disagreements were resolved, which remain open, which were accepted as legitimate splits
- Note convergence points and remaining disagreements
- End with the final outcome and any minority reports

Preserve the character of each seat's contribution. Do not flatten into a single voice.`,
};

/**
 * Resolve the effective output language from a raw BCP-47-style string.
 * Returns undefined for English (no language instruction needed).
 */
export function resolveOutputLanguage(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase().trim();
  if (lower === "en" || lower.startsWith("en-")) return undefined;
  return raw.trim();
}

function buildLanguageInstruction(outputLanguage: string): string {
  return `\n\nIMPORTANT — Output language: You MUST write the entire output in ${outputLanguage}. The debate trace you are reading is in English (this is by design — internal deliberation is always in English). Your job is to synthesize and present the result in ${outputLanguage}. Do not mix languages. Do not include the English source text.`;
}

export function buildSynthesisPrompt(context: SynthesisContext): string {
  const modePrompt = MODE_PROMPTS[context.answerMode];
  const lengthInstruction = LENGTH_INSTRUCTIONS[context.outputLength];

  const resolved = resolveOutputLanguage(context.outputLanguage);
  const languageInstruction = resolved
    ? buildLanguageInstruction(resolved)
    : "";

  return `${modePrompt}\n\nOutput length: ${lengthInstruction}${languageInstruction}`;
}

export function getSynthesisMaxTokens(
  answerMode: AnswerMode,
  outputLength: OutputLength,
  outputLanguage?: string,
): number {
  const base: Record<AnswerMode, number> = {
    answer: 512,
    memo: 768,
    plan: 1024,
    review: 768,
    transcript: 1536,
  };

  const multiplier: Record<OutputLength, number> = {
    short: 0.5,
    standard: 1.0,
    long: 2.0,
  };

  let tokens = Math.round(base[answerMode] * multiplier[outputLength]);

  const resolved = resolveOutputLanguage(outputLanguage);
  if (resolved) {
    tokens = Math.round(tokens * 1.3);
  }

  return tokens;
}

export function buildTraceText(rounds: RoundResult[]): string {
  return rounds
    .map(
      (r) => {
        const stageLabel = r.stage ? ` [${r.stage}]` : "";
        const header = `Round ${r.round}${stageLabel}:\n`;
        const statementsText = r.statements
          .map(
            (s) => {
              let claimLines = `    Claims: ${s.claims.join("; ")}`;
              if (s.claimProvenance && s.claimProvenance.length > 0) {
                const provenanceLabels = s.claims.map((c, i) => {
                  const prov = s.claimProvenance?.[i] ?? "inferred";
                  return `${c} [${prov}]`;
                });
                claimLines = `    Claims: ${provenanceLabels.join("; ")}`;
              }
              return (
                `  ${s.seatId} (${s.stance}, confidence ${s.confidence}/5): ${s.summary}\n` +
                claimLines + "\n" +
                (s.objections.length > 0
                  ? `    Objections: ${s.objections.join("; ")}\n`
                  : "") +
                (s.warnings?.length
                  ? `    Warnings: ${s.warnings.join("; ")}\n`
                  : "")
              );
            },
          )
          .join("");

        let metricsLine = `  Agreement ratio: ${r.agreementRatio}, Unresolved objections: ${r.objectionCount}`;
        if (r.resolvedCount !== undefined) {
          metricsLine += `\n  Disputes: ${r.resolvedCount} resolved, ${r.acceptedSplitCount ?? 0} accepted splits, ${r.unresolvedCount ?? 0} open`;
        }

        return header + statementsText + metricsLine;
      },
    )
    .join("\n\n");
}
