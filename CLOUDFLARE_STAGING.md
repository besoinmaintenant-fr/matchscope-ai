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


## Module buteurs et gel avant-match (31 octobre 2026)

- Les fiches buteurs Cloudflare utilisent `scorers` et conservent la première
  estimation **effectivement calculée avant le coup d'envoi** dans
  `public.scorer_predictions` (22 titulaires vérifiés, données suffisantes).
- La table est protégée par RLS ; seul le rôle serveur possède la lecture et
  l'insertion. Aucun pronostic pré-match n'est calculé rétroactivement.
- Un ancien match sans estimation buteur conservée peut montrer un **repère de
  saison**, explicitement distinct d'un pronostic pré-match ou pari en direct.
- Chaque fiche montre la taille de l'échantillon individuel (limité, moyen ou
  étendu) et les buts/tirs par 90 min lorsqu'ils sont connus. Ces indicateurs
  ne représentent pas une validation de la performance des probabilités.
- Le collecteur `collect-lineups` de cette branche a été préparé pour
  sauvegarder automatiquement les pronostics buteurs des cinq ligues, au plus
  **3 matchs par passage**, lorsque les XI sont déjà officiels et que le match
  commence dans **2 à 75 min**. Une archive existante est ignorée.

**Attention — déploiement progressif** : Cloudflare Pages ne dispose pas
d'événement Cron. Le collecteur amélioré présent dans la branche
`cloudflare-staging` n'est **pas activé comme tâche planifiée Cloudflare**.
Les tâches Netlify en production utilisent encore leur déploiement
indépendant (branche principale). Aujourd'hui, côté Cloudflare, un match
consulté avant son coup d'envoi peut sauvegarder son estimation ; cela
ne remplace pas une collecte automatique 24 h/24.

Pour rendre la capture buteurs réellement autonome sur Cloudflare :
1. Créer un Worker planifié à part, avec secrets serveur Cloudflare, isolation
   et verrou d'idempotence.
2. Vérifier son quota Sportmonks, la couverture des cinq ligues et ses logs
   sans jamais exposer les clés API.
3. Ne basculer les collecteurs existants qu'après neutralisation explicite des
   Cron Netlify correspondants. Ne jamais faire fonctionner deux collecteurs
   d'un même type en parallèle.

Le moteur 1/N/2 V0.7 est calibré seulement sur PL, BL et LL ; les fiches
buteurs expérimentales et compositions visent les cinq championnats.
