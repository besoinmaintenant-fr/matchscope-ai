# MatchScope AI — migration Cloudflare : état vérifié

> Relevé du **31 octobre 2026** à partir des API GitHub, Cloudflare, Netlify et Supabase. Ce document remplace les annonces historiques non prouvées. Toutes les heures indiquées sont en UTC. Ne jamais publier la valeur d'un secret.

## Décision immédiate

**Migration NON terminée : garder `MATCHSCOPE_CRON_ENABLED=false`.** Un déclencheur Cloudflare installé ne prouve ni collecte effective ni écriture Supabase. Aucune activation Cloudflare tant que Netlify n'est pas réellement neutralisé et que l'accès privé n'est pas testé de bout en bout.

## Ressources et commits vérifiés

| Élément | État constaté |
| --- | --- |
| Dépôt | `besoinmaintenant-fr/matchscope-ai` |
| Branche Cloudflare | `cloudflare-staging`, commit `7394a765aaa564d7fa4dbcd4a4eee4550d89e9dd` avant la branche de travail |
| Projet Pages | `matchscope-ai-staging`, URL `https://matchscope-ai-staging.pages.dev` |
| Pages déploiement | `fbfc4c24-bcc7-4eaf-aa75-5cb1c332f359`, réussi le 31/10 à 17:48 |
| Worker | `matchscope-ai-collector`, cron `*/5 * * * *` présent |
| Netlify | site `matchscope-ai-2`, déploiement publié `6ae5eb27804528edd9809154` du commit `70287961b2cf999daf95a22359ef93fe7dcdf694` |
| GitHub main | le commit `c124311480f1a81a0ac330ee963725c90e63e1ec` retire les quatre schedules ; PR #1 fusionnée par `ecb580ef650f7c45b6b52bc8fbc9a2766c7bad9c` pour tenter une synchronisation |
| Base | Supabase `mlqrfowveayyxcuasfkh` (reste en place) |

**Netlify :** l'API Get Project indique encore le déploiement `6ae5eb...` après la fusion de la PR #1. La publication de `main` et l'arrêt effectif des tâches ne sont **pas démontrés**. La disponibilité des fonctions dans le déploiement ne prouve pas leur dernier déclenchement, mais son `netlify.toml` au commit publié contient bien les quatre planifications : `collect-lineups`, `collect-prematch-snapshots`, `postmatch-auto`, `trigger-enrichment`.

## Cloudflare : configuration vérifiée, limites

- Pages utilise la branche `cloudflare-staging`, `nodejs_compat` et la compatibility date `2026-10-31` ; le nom de ces quatre variables serveur a été vérifié : `SPORTMONKS_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `MATCHSCOPE_SYNC_SECRET`. Ne jamais imprimer leurs valeurs.
- Worker : secrets nommés `CF_ACCESS_CLIENT_ID` et `CF_ACCESS_CLIENT_SECRET` ; `MATCHSCOPE_CRON_ENABLED=false` ; sous-domaine `workers.dev` désactivé.
- Cloudflare Access : application de service dédiée à `matchscope-ai-staging.pages.dev/__cron/*` ; application séparée avec accès e-mail au domaine principal. Ne modifier ni domaines, ni politiques.
- **Previews Pages** : la configuration source `preview_deployment_setting` vaut `none` (prévisualisations automatiques désactivées), même si `preview_branch_includes` liste `*`. Ce dernier champ seul ne prouve donc pas que les previews sont actives. Ne jamais réactiver ces previews sans vérifier leur protection Access.
- Logs Workers Observability : 60 événements de contrôle de 17:50:50 à 22:45:49 UTC, avec `ready:true`, `pagesRouteStatus:405`, `cronEnabled:false`. Cela étaye l'authentification de service pour le GET de contrôle, **pas** un POST de collecte ni une écriture Supabase.
- Le refus d'un appel sans token, l'accès authentifié aux trois autres routes et le traitement complet d'un POST de collecte ne sont pas encore prouvés indépendamment.
- Le script `scripts/build-cloudflare.mjs` génère les routes privées `functions/__cron/{lineups,snapshots,postmatch,enrichment}`. Les anciennes fonctions sous `netlify/functions` sont regroupées pour Pages ; vérifier la compatibilité effective de chacune avant bascule.

## Supabase : lecture SQL constatée

| Table | Lignes | Dernier horodatage vérifié |
| --- | ---: | --- |
| `lineups` | 13 944 | `created_at` : 31/10 à 16:30:22 |
| `prematch_snapshots` | 61 | `captured_at` : 31/10 à 16:30:41 |
| `predictions` | 28 | `generated_at` : 31/10 à 16:30:25 |
| `scorer_predictions` | **0** | aucun |
| `matches` | 1 080 | `created_at` : 31/10 à 16:30:21 |

- Les 61 snapshots comprennent D1 12, H6 4, H3 14, H90 15, FINAL 16 ; tous sont datés avant coup d'envoi et aucun couple (fixture, étape) n'est dupliqué dans les lignes présentes. L'idempotence concurrente n'est pas prouvée.
- Les 28 prédictions V0.7 enregistrées sont antérieures au coup d'envoi d'après les horodatages stockés : 16 PRELINEUP et 12 FINAL. La calibration n'est pas pour autant statistiquement démontrée.
- 16 matchs du 30 au 31 octobre ont `lineups_confirmed=true` et aucune archive buteur (PL 7, BL 5, LL 2, SA 2). Cela ne garantit pas qu'ils étaient tous éligibles pendant la fenêtre du collecteur.
- `starters_found=22` peut coexister avec `lineups_official=false`. Ne jamais confondre compositions probables et titulaires officiels.

## Risques techniques et correctifs préparés

- `collect-lineups.js` limite les estimations buteurs à **3 matchs par tick**, seulement de H−75 à H−2, avec une recherche jusqu'à H−90 : couverture des matchs simultanés et composition tardive non garantie.
- Un HTTP 200 et `success:true` peuvent contenir des échecs individuels (`errors > 0`, `status: ERROR`, ou `scorerResults: SOURCE_UNAVAILABLE`).
- Une branche de travail `ops/cloudflare-collector-guards-20261031` prépare un contrôle des erreurs partielles dans le Worker avec tests unitaires. **Cette correction n'est pas déployée** tant qu'elle n'est pas fusionnée et que le Worker n'a pas été redéployé. Six tests Node ont passé localement ; test d'intégration réel non effectué.
- Les verrous atomiques, reprises après 429, reports et corrections de composition exigent un audit supplémentaire. Aucune réécriture de pronostics déjà enregistrés.

## Procédure de bascule : ordre impératif

1. **Neutraliser Netlify** en publiant réellement une version sans les quatre schedules (ou désactivation sur le tableau de bord) ; relire l'identifiant du déploiement **publié**, son commit et la liste des planifications. L'accès Netlify actuel via le connecteur est en lecture seule pour les déploiements ; il manque une action de publication/désactivation.
2. Contrôler les autres déclencheurs (GitHub Actions, autres Workers, services externes). Les deux branches inspectées ne contiennent pas `.github/workflows` ; cela n'exclut pas des tâches externes.
3. Vérifier le refus sans token et l'autorisation avec service token sur les quatre routes. Un GET `405` authentifié n'autorise pas à conclure sur les POST.
4. Tester **un seul POST contrôlé** après l'arrêt Netlify, observer un JSON structuré avec les erreurs individuelles, puis vérifier une écriture Supabase avant coup d'envoi et l'absence de doublon.
5. Seulement si 1–4 sont établis, activer `MATCHSCOPE_CRON_ENABLED=true` puis observer une exécution **planifiée** et ses données en base. Dans les logs, séparer `échec`, `source indisponible`, `compositions non confirmées`, `traité`.
6. En cas de problème, repasser d'abord `MATCHSCOPE_CRON_ENABLED=false`, confirmer l'arrêt, puis seulement envisager de réactiver Netlify. Jamais deux collecteurs.

## Fonctionnalités métier et mathématiques

- Collecte des XI des cinq championnats : L1 `301`, Liga `564`, SA `384`, PL `8`, BL `82`. Le 1/N/2 V0.7 ne couvre dans son code que PL, BL et LL ; sa calibration réelle reste à démontrer chronologiquement.
- Le Top 2 buteurs n'est affichable que depuis des estimations réelles enregistrées avant coup d'envoi. À défaut : `en attente`/`indisponible` ; aucune reconstruction a posteriori.
- Conserver le modèle en production. Hors production : évaluer minutes probables, petits échantillons et régularisation, calibration et comparaison Poisson/Dixon–Coles sur validation chronologique. Mesurer Brier/log-loss, calibration, effectifs et incertitude avant toute promotion.

## Architecture cible

Cloudflare Worker (cron unique) → Cloudflare Access (token de service) → Pages Functions privées → Sportmonks et Supabase ; le frontend Pages lit les archives. Netlify ne joue plus aucun rôle d'exécution **seulement après** la désactivation confirmée.

## Historique remplacé

- La phrase « cron Cloudflare non installé / quota saturé » est obsolète : le cron existe.
- Le déploiement Netlify ancien peut comporter quatre planifications même si `main/netlify.toml` n'en comporte plus.
- Le GET 405 de contrôle, un build réussi ou l'existence d'archives Supabase **ne démontrent pas** le traitement réel Worker → Pages → Supabase.

**Sources :** API GitHub (branches, commits, fichiers), Cloudflare Pages/Workers/Access/Observability, Netlify Get Project/Get Deploy, requêtes SQL SELECT sur Supabase. Aucun secret ni jeton n'a été reproduit.
