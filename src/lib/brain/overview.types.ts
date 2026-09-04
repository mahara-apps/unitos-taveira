// Tipos client-safe do painel de inteligência do Brain.
// Somente leitura: nenhuma tabela/pipeline do Brain é alterada por este módulo.

export type BrainScopeFilter = "global" | "brand" | "client";
export type LearningScope = "global" | "brand" | "client";

export type BrainEvidence = {
  total: number;
  approved: number;
  rework: number;
  rejected: number;
};

export type BrainLearning = {
  id: string;
  title: string;
  conclusion: string;
  confidence: number;
  previousConfidence: number | null;
  scope: LearningScope;
  category: string | null;
  clientName: string | null;
  sample: number;
  reinforcement: number;
  contradictions: number;
  version: number;
  origin: string | null;
  windowDays: number | null;
  channel: string | null;
  format: string | null;
  lastObservedAt: string | null;
  updatedAt: string;
  evidence: BrainEvidence | null;
};

export type BrainTimelineItem = {
  kind: "memory_created" | "confidence_updated" | "insight";
  text: string;
  at: string;
};

export type BrainTimelineDay = {
  day: string;
  items: BrainTimelineItem[];
};

export type BrainInsightItem = {
  id: string;
  type: string;
  description: string;
  confidence: number;
  basedOnEvents: number;
  scope: LearningScope;
  createdAt: string;
  expiresAt: string | null;
};

export type BrainRecommendationItem = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  confidence: number;
  priority: number | null;
  scope: LearningScope;
  createdAt: string;
};

export type BrainHealth = {
  status: "healthy" | "warning" | "critical";
  reasons: string[];
  eventsProcessed24h: number;
  lastWorkerRunAt: string | null;
  lastWorkerStatus: string | null;
  minutesSinceWorkerRun: number | null;
  failures24h: number;
  lastMiningAt: string | null;
  activeMemories: number;
  activeInsights: number;
  queuePending: number;
  queueFailed: number;
};

export type BrainOverview = {
  generatedAt: string;
  scope: BrainScopeFilter;
  days: number;
  avgConfidence: number | null;
  learnings: BrainLearning[];
  timeline: BrainTimelineDay[];
  learningTrend: Array<{ day: string; created: number; updated: number }>;
  confidenceTrend: Array<{ day: string; confidence: number }>;
  evidenceOutcomes: BrainEvidence | null;
  insights: BrainInsightItem[];
  recommendations: BrainRecommendationItem[];
  health: BrainHealth;
  clientsAvailable: Array<{ id: string; name: string }>;
};

export type BrainLearningDetail = {
  learning: BrainLearning;
  confidenceHistory: Array<{
    version: number;
    confidence: number;
    previousConfidence: number | null;
    changeReason: string | null;
    at: string;
  }>;
  sourceEvents: Array<{
    id: string;
    eventType: string;
    sourceModule: string;
    action: string | null;
    at: string;
  }>;
  /** Consumidores reais (perfis de contexto por agente que usam esta categoria). */
  usedBy: string[];
};
