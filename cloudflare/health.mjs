// Protected by Cloudflare Access. Never expose token values or raw API responses.
// Triggered on demand, not periodically, to preserve Sportmonks API quota.
const neededLeagues = new Set([301, 564, 384, 8, 82]);

const finiteTimeout = (ms = 8000) => AbortSignal.timeout(ms);

function safeResult(status, extra = {}) {
  return { httpStatus: status, ...extra };
}

async function checkSupabase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    return safeResult(null, { ready: false, message: 'Configuration manquante' });
  }
  try {
    const url = new URL('/rest/v1/matches', env.SUPABASE_URL);
    url.searchParams.set('select', 'id');
    url.searchParams.set('limit', '1');

    const headers = {
      apikey: env.SUPABASE_SECRET_KEY,
      Accept: 'application/json'
    };
    if (!env.SUPABASE_SECRET_KEY.startsWith('sb_secret_')) {
      headers.Authorization = 'Bearer ' + env.SUPABASE_SECRET_KEY;
    }
    const res = await fetch(url, { headers, signal: finiteTimeout() });
    return safeResult(res.status, { ready: res.ok });
  } catch (error) {
    return safeResult(null, { ready: false, message: error?.name || 'Connection failed' });
  }
}

async function checkSportmonks(env) {
  if (!env.SPORTMONKS_API_TOKEN) {
    return safeResult(null, { ready: false, message: 'Configuration manquante' });
  }
  try {
    const url = new URL('https://api.sportmonks.com/v3/football/leagues');
    url.searchParams.set('api_token', env.SPORTMONKS_API_TOKEN);
    url.searchParams.set('per_page', '100');

    const res = await fetch(url, { signal: finiteTimeout() });
    if (!res.ok) return safeResult(res.status, { ready: false });
    const payload = await res.json();
    const ids = new Set((Array.isArray(payload?.data) ? payload.data : [])
      .map(x => Number(x.id)));
    return safeResult(res.status, {
      ready: true,
      fiveSubscribedLeagues: [...neededLeagues].every(x => ids.has(x)),
      availableLeagueIds: [...neededLeagues].filter(x => ids.has(x)),
      leagueCount: ids.size
    });
  } catch (error) {
    return safeResult(null, { ready: false, message: error?.name || 'Connection failed' });
  }
}

async function checkFixtures(env) {
  if (!env.SPORTMONKS_API_TOKEN) return safeResult(null, { ready: false });
  try {
    const from = new Date();
    const to = new Date(Date.now() + 14 * 86400000);
    const fmt = date => date.toISOString().slice(0, 10);
    const url = new URL(
      'https://api.sportmonks.com/v3/football/fixtures/between/' +
      fmt(from) + '/' + fmt(to)
    );
    url.searchParams.set('api_token', env.SPORTMONKS_API_TOKEN);
    url.searchParams.set('filters', 'fixtureLeagues:301,564,384,8,82');
    url.searchParams.set('per_page', '1');
    const res = await fetch(url, { signal: finiteTimeout() });
    if (!res.ok) return safeResult(res.status, { ready: false });
    const payload = await res.json();
    return safeResult(res.status, {
      ready: true,
      foundFixture: Array.isArray(payload?.data) && payload.data.length > 0,
      firstFixtureLeagueId: Number(payload?.data?.[0]?.league_id) || null
    });
  } catch (error) {
    return safeResult(null, { ready: false, message: error?.name || 'Connection failed' });
  }
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') {
    return new Response('Méthode non autorisée', { status: 405 });
  }

  const configured = {
    sportmonks: Boolean(env.SPORTMONKS_API_TOKEN),
    supabaseUrl: Boolean(env.SUPABASE_URL),
    supabaseSecret: Boolean(env.SUPABASE_SECRET_KEY)
  };
  const [supabase, sportmonks, fixtures] = await Promise.all([
    checkSupabase(env),
    checkSportmonks(env),
    checkFixtures(env)
  ]);

  const ready = Object.values(configured).every(Boolean) &&
    supabase.ready && sportmonks.ready && fixtures.ready &&
    sportmonks.fiveSubscribedLeagues === true && fixtures.foundFixture === true;
  const result = {
    service: 'MatchScope AI — Cloudflare staging privé',
    checkedAt: new Date().toISOString(),
    ready,
    configured,
    checks: { supabase, sportmonks, fixtures },
    message: ready
      ? 'Les identifiants et les données principales sont accessibles.'
      : 'Une vérification est incomplète. Le site principal Netlify reste actif.'
  };
  return new Response(JSON.stringify(result, null, 2), {
    status: ready ? 200 : 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}
