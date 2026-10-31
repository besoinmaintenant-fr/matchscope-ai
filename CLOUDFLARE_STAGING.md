# MatchScope AI — Cloudflare staging

## Sécurité et bascule

- **La production reste sur Netlify** : aucune bascule, aucun changement DNS.
- La branche GitHub de test est `cloudflare-staging`, et le projet Pages est
  `matchscope-ai-staging`.
- Cloudflare Access protège **le domaine principal et les previews** par un
  e-mail autorisé (One-time PIN). La protection doit rester active avant
  d'autoriser un déploiement.
- Le build Cloudflare regroupe six fonctions de lecture/écriture HTTP existantes
  sans les exposer dans les ressources statiques du site.
- Ne JAMAIS placer les clés Sportmonks ou Supabase dans GitHub, la page
  HTML, les assets statiques ou une variable JavaScript du navigateur.

## Paramètres de build

- Branche de production Cloudflare (staging) : `cloudflare-staging`
- Build command : `npm run build:cloudflare`
- Build output : `dist`
- Pages Functions : `functions/.netlify/functions/*.js` générées au build
- Compatibility date : `2026-10-31`
- Compatibility flag : `nodejs_compat`

Les anciennes routes `/.netlify/functions/*` restent identiques côté
navigateur et sont adaptées à l'interface Cloudflare Pages `onRequest`.

## Secrets à fournir exclusivement via Cloudflare Dashboard

Pour les environnements **Production** de ce site de test :

- `SPORTMONKS_API_TOKEN` : même forfait Starter Sportmonks que MatchScope.
- `SUPABASE_URL` : URL du projet Supabase MatchScope.
- `SUPABASE_SECRET_KEY` : clé serveur Supabase, **jamais publique**.

Ne pas remplir ces valeurs dans les paramètres de build publics ni dans GitHub.
Ne pas publier avant d'avoir confirmé Cloudflare Access.

## Migration non terminée

- Les tâches programmées `collect-lineups`, `collect-prematch-snapshots`,
  `postmatch-auto` et `trigger-enrichment` **restent sur Netlify**.
- Cloudflare Pages ne remplace pas automatiquement les Netlify Scheduled
  Functions. Prévoir un Worker `scheduled()` distinct avec Cron Triggers,
  une politique d'idempotence et des secrets serveur avant la bascule.
- Ne pas lancer les deux planificateurs en parallèle sur la même base.
- Valider par comparaison des matches, des XI, des pronostics et de
  l'historique avant de décider d'une bascule de production.
