/** Classify partial failures independently of a handler's overall HTTP status. */
export function collectorFailureCounts(result) {
  const declared = Number(result?.errors);
  const declaredErrors = Number.isFinite(declared) && declared > 0
    ? Math.floor(declared) : 0;
  const fixtureErrors = Array.isArray(result?.results)
    ? result.results.filter(item => ['ERROR', 'FAILED', 'SOURCE_UNAVAILABLE']
      .includes(item?.status)).length : 0;
  const scorerErrors = Array.isArray(result?.scorerResults)
    ? result.scorerResults.filter(item => item?.status === 'SOURCE_UNAVAILABLE').length : 0;
  return {
    fixtureErrors: Math.max(declaredErrors, fixtureErrors),
    scorerErrors
  };
}
