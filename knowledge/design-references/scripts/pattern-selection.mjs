import { overlap, stripInternal, tokenize } from "./lib.mjs";

export function selectPatterns(patterns, records, request) {
  const selectedIds = new Set(records.map((record) => record.id));
  const queryTokens = tokenize(
    [request.surface, request.job, request.dimensions].join(" "),
  );
  const limit = { quick: 2, standard: 4, deep: 8 }[request.profile] || 4;
  return patterns
    .filter((pattern) => pattern.reviewStatus === "reviewed")
    .map((pattern) => {
      const linkedExamples = [...pattern.examples, ...pattern.counterexamples]
        .filter((id) => selectedIds.has(id)).length;
      const text = [
        pattern.name,
        pattern.problem,
        ...pattern.worksWhen,
        ...pattern.failsWhen,
        ...pattern.tags,
      ].join(" ");
      return {
        pattern,
        score: linkedExamples * 20 + overlap(queryTokens, tokenize(text)) * 5,
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.pattern.id.localeCompare(right.pattern.id),
    )
    .slice(0, limit)
    .map(({ pattern, score }) => ({
      ...stripInternal(pattern),
      selectionScore: score,
    }));
}
