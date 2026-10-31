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
  async fetch() {
    // No public route to trigger jobs; only Cloudflare scheduled() events.
    return new Response('Not found', {status:404});
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
