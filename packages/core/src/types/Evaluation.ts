// packages/core/src/types/Evaluation.ts

export interface EvaluationResult {
  /** 0–1 overall quality score */
  overallQuality: number;
  /** 0–1 how much providers agreed */
  agreementScore: number;
  /** Potential hallucinations detected */
  hallucinations: HallucinationFlag[];
  /** Per-provider breakdown */
  perProviderScores: Record<string, ProviderScore>;
  /** Which provider's result to weight most heavily */
  recommendedProvider: string;
  /** Points of disagreement between providers */
  conflicts: ConflictEntry[];
  /** Synthesis recommendation */
  synthesisNotes: string;
}

export interface ProviderScore {
  provider: string;
  /** 0–1 */
  quality: number;
  relevance: number;
  completeness: number;
  factualConsistency: number;
  /** Raw reasoning for this score */
  reasoning?: string;
}

export interface HallucinationFlag {
  provider: string;
  /** The specific claim flagged */
  claim: string;
  /** 0–1 confidence this is a hallucination */
  confidence: number;
  reason: string;
}

export interface ConflictEntry {
  providers: string[];
  topic: string;
  description: string;
  /** How the conflict was resolved */
  resolution?: string;
}
