// Ported from BerriAI/litellm@7351177434c7b9d19e0a53cd3e9bc63706af2ab2 litellm/router_strategy/complexity_router/{config.py,complexity_router.py} (MIT).
// Changes: the heuristic scorer only (no LLM classifier, custom dimensions or plan-mode
// sentinels), and its REASONING tier folds into "complex".

export type ComplexityTier = "simple" | "medium" | "complex";

const CODE_KEYWORDS = [
  "function",
  "class",
  "def",
  "const",
  "let",
  "var",
  "import",
  "export",
  "return",
  "async",
  "await",
  "try",
  "catch",
  "exception",
  "error",
  "debug",
  "api",
  "endpoint",
  "request",
  "response",
  "database",
  "sql",
  "query",
  "schema",
  "algorithm",
  "implement",
  "refactor",
  "optimize",
  "python",
  "javascript",
  "typescript",
  "java",
  "rust",
  "golang",
  "react",
  "vue",
  "angular",
  "node",
  "docker",
  "kubernetes",
  "git",
  "commit",
  "merge",
  "branch",
  "pull request",
];

const REASONING_KEYWORDS = [
  "step by step",
  "think through",
  "let's think",
  "reason through",
  "analyze this",
  "break down",
  "explain your reasoning",
  "show your work",
  "chain of thought",
  "think carefully",
  "consider all",
  "evaluate",
  "pros and cons",
  "compare and contrast",
  "weigh the options",
  "logical",
  "deduce",
  "infer",
  "conclude",
];

const TECHNICAL_KEYWORDS = [
  "architecture",
  "distributed",
  "scalable",
  "microservice",
  "machine learning",
  "neural network",
  "deep learning",
  "encryption",
  "authentication",
  "authorization",
  "performance",
  "latency",
  "throughput",
  "benchmark",
  "concurrency",
  "parallel",
  "threading",
  "memory",
  "cpu",
  "gpu",
  "optimization",
  "protocol",
  "tcp",
  "http",
  "grpc",
  "websocket",
  "container",
  "orchestration",
];

const SIMPLE_KEYWORDS = [
  "what is",
  "what's",
  "define",
  "definition of",
  "who is",
  "who was",
  "when did",
  "when was",
  "where is",
  "where was",
  "how many",
  "how much",
  "yes or no",
  "true or false",
  "simple",
  "brief",
  "short",
  "quick",
  "hello",
  "hi",
  "hey",
  "thanks",
  "thank you",
  "goodbye",
  "bye",
  "okay",
];

const WEIGHTS = {
  tokenCount: 0.1,
  codePresence: 0.3,
  reasoningMarkers: 0.25,
  technicalTerms: 0.25,
  simpleIndicators: 0.05,
  multiStepPatterns: 0.03,
  questionComplexity: 0.02,
} as const;

const SIMPLE_MEDIUM = 0.15;
const MEDIUM_COMPLEX = 0.35;
const SIMPLE_TOKENS = 15;
const COMPLEX_TOKENS = 400;
const MULTI_STEP_PATTERNS = [/first.*?then/iu, /step\s*\d/iu, /\d+\.\s/u, /[a-z]\)\s/iu];

const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Phrases match as substrings; single words only on word boundaries, so "api" misses "capital". */
const matches = (text: string, keyword: string) =>
  keyword.includes(" ")
    ? text.includes(keyword)
    : new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "u").test(text);

const keywordScore = (
  text: string,
  keywords: ReadonlyArray<string>,
  [low, high]: readonly [number, number],
  [none, someScore, many]: readonly [number, number, number],
) => {
  const count = keywords.filter((keyword) => matches(text, keyword)).length;
  return { score: count < low ? none : count >= high ? many : someScore, count };
};

/** How hard a prompt looks, from its own words alone: deterministic and well under a millisecond. */
export const classifyComplexity = (
  prompt: string,
): { readonly tier: ComplexityTier; readonly score: number } => {
  const text = prompt.toLowerCase();
  const tokens = Math.floor(prompt.length / 4);
  const code = keywordScore(text, CODE_KEYWORDS, [1, 2], [0, 0.5, 1]);
  const reasoning = keywordScore(text, REASONING_KEYWORDS, [1, 2], [0, 0.7, 1]);
  const technical = keywordScore(text, TECHNICAL_KEYWORDS, [2, 4], [0, 0.5, 1]);
  const simple = keywordScore(text, SIMPLE_KEYWORDS, [1, 2], [0, -1, -1]);
  const score =
    (tokens < SIMPLE_TOKENS ? -1 : tokens > COMPLEX_TOKENS ? 1 : 0) * WEIGHTS.tokenCount +
    code.score * WEIGHTS.codePresence +
    reasoning.score * WEIGHTS.reasoningMarkers +
    technical.score * WEIGHTS.technicalTerms +
    simple.score * WEIGHTS.simpleIndicators +
    (MULTI_STEP_PATTERNS.some((pattern) => pattern.test(text)) ? 0.5 : 0) *
      WEIGHTS.multiStepPatterns +
    ((prompt.match(/\?/gu)?.length ?? 0) > 3 ? 0.5 : 0) * WEIGHTS.questionComplexity;
  // Two reasoning markers promote a prompt the scorer did not already call simple.
  if (reasoning.count >= 2 && score >= SIMPLE_MEDIUM) return { tier: "complex", score };
  const tier = score < SIMPLE_MEDIUM ? "simple" : score < MEDIUM_COMPLEX ? "medium" : "complex";
  return { tier, score };
};
