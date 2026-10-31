// Future Cloudflare Cron Worker. NOT deployed during staging.
// All scheduled tasks remain on Netlify until an explicit cutover.
// Requires Cloudflare server secrets and MATCHSCOPE_CRON_ENABLED=true.
import { handler as collectLineups } from '../netlify/functions/collect-lineups.js';
import { handler as collectSnapshots } from '../netlify/functions/collect-prematch-snapshots.js';
import { handler as postmatch } from '../netlify/functions/postmatch-auto.js';
import { handler as enrich } from '../netlify/functions/trigger-enrichment.js';

const tasks = {
  '*/10 * * * *': collectLineups,
  '*/30 8-22 * * *': collectSnapshots,
  '*/15 12-23 * * *': postmatch,
  '20 */3 * * *': enrich
};

export default {
  async scheduled(event, env, ctx) {
    // Prevent double collectors writing to Supabase during migration.
    if (env.MATCHSCOPE_CRON_ENABLED !== 'true') return;
    const task = tasks[event.cron];
    if (!task) throw new Error('Unrecognized schedule');
    ctx.waitUntil((async () => {
      const result = await task({});
      const status = Number(result?.statusCode);
      if (!Number.isFinite(status) || status < 200 || status >= 300) {
        throw new Error('MatchScope scheduled task failed with HTTP ' + status);
      }
      console.log('MatchScope scheduled task completed', event.cron);
    })());
  }
};
