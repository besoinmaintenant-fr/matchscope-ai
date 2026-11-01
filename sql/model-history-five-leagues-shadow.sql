-- Five-league shadow history. NOT a replacement for public.model_history,
-- which the currently deployed v0.7 runtime uses unchanged.
-- Apply only after reviewing data availability, privileges and deployment.
-- Recorded score consistency and historical kickoff are required.
CREATE OR REPLACE VIEW public.model_history_five_leagues
WITH (security_invoker = true)
AS
SELECT
  m.sportmonks_fixture_id,
  m.league_code,
  m.league_name,
  m.home_team_id,
  m.home_team_name,
  m.away_team_id,
  m.away_team_name,
  m.starting_at,
  r.home_score,
  r.away_score,
  r.result_1x2
FROM public.matches AS m
JOIN public.results AS r
  ON r.sportmonks_fixture_id = m.sportmonks_fixture_id
WHERE m.league_code IN ('PL','BL','LL','SA','L1')
  AND m.starting_at < now()
  AND r.home_score >= 0
  AND r.away_score >= 0
  AND r.result_1x2 IN ('1','N','2')
  AND r.result_1x2 = CASE
    WHEN r.home_score > r.away_score THEN '1'
    WHEN r.home_score < r.away_score THEN '2'
    ELSE 'N'
  END;

-- Not a public endpoint: only the existing server role may read it.
REVOKE ALL ON public.model_history_five_leagues FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.model_history_five_leagues TO service_role;

-- Validation query (read-only once migration applied):
-- SELECT league_code, count(*) FROM public.model_history_five_leagues
-- GROUP BY league_code ORDER BY league_code;
