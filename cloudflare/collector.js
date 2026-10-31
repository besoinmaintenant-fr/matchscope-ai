/**
 * MatchScope AI Cloudflare Cron entrypoint.
 *
 * Collectors run in Cloudflare Pages, where existing server-only Sportmonks
 * and Supabase bindings are already configured. This Worker only authenticates
 * to their private Cloudflare Access Service Auth endpoints.
 *
 * IMPORTANT: never schedule while Netlify cron remains enabled.
 * MATCHSCOPE_CRON_ENABLED must be set to "true" only after explicit cutover.
 */
const BASE = 'https://matchscope-ai-staging.pages.dev/__cron/';
const TASKS = Object.freeze({
  '*/10 * * * *': 'lineups',
  '*/30 8-22 * * *': 'snapshots',
  '*/15 12-23 * * *': 'postmatch',
  '20 */3 * * *': 'enrichment'
});

export default {
  async fetch(request, env) {
    // Read-only connectivity check. Never runs a collector, returns no secrets.
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/health') {
      return new Response('Not found', {status:404});
    }
    if (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) {
      return new Response(JSON.stringify({ready:false}), {
        status:503, headers:{'content-type':'application/json'}
      });
    }
    try {
      // A GET is intentionally rejected with 405 by the private Pages
      // job handler, proving routing and service-token authentication only.
      const response = await fetch(BASE + 'lineups', {
        method:'GET',
        redirect:'manual',
        headers:{
          'CF-Access-Client-Id':env.CF_ACCESS_CLIENT_ID,
          'CF-Access-Client-Secret':env.CF_ACCESS_CLIENT_SECRET
        },
        signal:AbortSignal.timeout(12000)
      });
      const ready = response.status === 405;
      return new Response(JSON.stringify({
        service:'matchscope-collector',
        ready,
        pagesRouteStatus:response.status,
        cronEnabled:env.MATCHSCOPE_CRON_ENABLED === 'true'
      }), {status:ready?200:503,headers:{
        'content-type':'application/json','cache-control':'no-store'
      }});
    } catch {
      return new Response(JSON.stringify({ready:false}), {
        status:503,headers:{'content-type':'application/json','cache-control':'no-store'}
      });
    }
  },

  async scheduled(event, env, ctx) {
    if (env.MATCHSCOPE_CRON_ENABLED !== 'true') return;
    const task = TASKS[event.cron];
    if (!task) throw new Error('Unknown schedule');
    if (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) {
      throw new Error('Cloudflare Access service credentials not configured');
    }
    const call = async () => {
      const response = await fetch(BASE + task, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
          'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
          'content-type': 'application/json'
        },
        signal: AbortSignal.timeout(120000)
      });
      if (!response.ok) {
        // Never log response bodies, which could contain provider details.
        throw new Error('MatchScope cron ' + task + ' returned HTTP ' +
          response.status);
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('MatchScope cron ' + task + ' returned non-JSON response');
      }
      const result = await response.json();
      if (result?.success === false) {
        throw new Error('MatchScope cron ' + task + ' returned unsuccessful result');
      }
      console.log('MatchScope scheduled job succeeded', task);
    };
    ctx.waitUntil(call());
  }
};
