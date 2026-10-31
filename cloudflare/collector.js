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
import { collectorFailureCounts } from './collector-status.mjs';
const BASE = 'https://matchscope-ai-staging.pages.dev/__cron/';
// One trigger every five minutes keeps the free-plan cron footprint to
// a single slot, while maintaining the former independent UTC schedules.
export function tasksDueAt(utc) {
  const minute = utc.getUTCMinutes();
  const hour = utc.getUTCHours();
  const tasks = ['lineups'];
  if (minute % 30 === 0 && hour >= 8 && hour <= 22) tasks.push('snapshots');
  if (minute % 15 === 0 && hour >= 12 && hour <= 23) tasks.push('postmatch');
  if (minute === 20 && hour % 3 === 0) tasks.push('enrichment');
  return tasks;
}

const worker = {
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
    if (env.MATCHSCOPE_CRON_ENABLED !== 'true') {
      const response = await worker.fetch(new Request('https://internal/health'), env);
      console.log('MatchScope readiness', await response.json());
      return;
    }
    if (event.cron !== '*/5 * * * *') throw new Error('Unknown schedule');
    if (!env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) {
      throw new Error('Cloudflare Access service credentials not configured');
    }
    const tasks = tasksDueAt(new Date(event.scheduledTime));
    if (!tasks.length) return;

    const runTask = async task => {
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
        // Never log response bodies, which might contain provider details.
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
      const failureCounts = collectorFailureCounts(result);
      if (failureCounts.fixtureErrors || failureCounts.scorerErrors) {
        throw new Error('MatchScope cron ' + task + ' reported partial failures: ' +
          failureCounts.fixtureErrors + ' fixtures, ' +
          failureCounts.scorerErrors + ' scorers');
      }
      console.log('MatchScope scheduled job succeeded', task, JSON.stringify({checkedAt:result.checkedAt,candidates:result.candidates,saved:result.saved,errors:result.errors,predictionsSaved:result.predictionsSaved,scorerSnapshotsSaved:result.scorerSnapshotsSaved,status:result.status,requested:result.requested,results:result.results?.map(r=>({fixtureId:r.fixtureId,status:r.status,predictionStatus:r.predictionStatus?.startsWith('PREDICTION_')?r.predictionStatus:undefined}))}));
    };

    // Sequential calls limit Sportmonks bursts when several tasks are due
    // simultaneously; one failing job does not prevent the others.
    ctx.waitUntil((async () => {
      let failures = 0;
      for (const task of tasks) {
        try { await runTask(task); }
        catch (error) {
          failures++;
          console.error('MatchScope job failed', task, error?.message || 'unknown');
        }
      }
      if (failures) throw new Error(failures + ' scheduled MatchScope jobs failed');
    })());
  }
};

export default worker;
