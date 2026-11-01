# MatchScope AI — étendre le modèle à la Serie A et à la Ligue 1

## État vérifié le 1er novembre 2026 (base Supabase existante)

- Vue de production `public.model_history` : **PL 373**, **LL 382**, **BL 302**, **SA 0**, **L1 0**. Son SQL filtre exclusivement PL/BL/LL.
- Tables `matches` et `results` : **0 match terminé avec résultat** pour SA et L1, malgré quelques fiches de matches / snapshots.
- Table distincte `team_result_history_v2` : **3 matchs de Serie A** et aucun de Ligue 1 ; données trop maigres pour remplacer l'historique requis.
- Runtime historique `model_runtime` : `v0.7` entraîné le 30 septembre 2026 sur BL/LL/PL ; `targetReached=false`.
- Code du modèle `model.js` et ses fonctions `prediction`, `modelhistory`, `train-model-background` : seulement BL/LL/PL ; **ne pas étendre directement V0.7 sans recalibration et validation**.

## Préparation isolée dans cette branche (non activée)

1. `sync-history` accepte désormais les codes `SA` (league ID 384) et `L1` (301) **uniquement** avec `mode:seed` ou `mode:incremental` et `leagueCodes:['SA','L1']` (un ou deux codes). Les appels `incremental` et `seed` historiques sans champ explicite conservent **PL/BL/LL uniquement**. Authentification `MATCHSCOPE_SYNC_SECRET` inchangée.
2. La route `/__cron/model-history-seed` reste derrière l'application Access **service token only** couvrant `/__cron/*`, et exige une authentification serveur `MATCHSCOPE_SYNC_SECRET`, ainsi qu'un mode d'import et un choix de ligue explicites. Aucun nouveau secret ni changement de configuration Pages. Le Worker planifié ne connaît pas cette route et **ne la déclenche jamais**.
3. Le fichier `sql/model-history-five-leagues-shadow.sql` prépare une **nouvelle vue serveur uniquement** `model_history_five_leagues`. Elle ne remplace pas la vue `model_history` lue par V0.7 ; elle exclut les résultats invalides et les rencontres futures. Ne pas appliquer la migration avant revue des privilèges.
4. `scripts/test-model-history-leagues.cjs` vérifie le choix des ligues et le refus de déclenchements non ciblés.

## Preuve Sportmonks vérifiée le 1er novembre 2026 — appel réel et lecture seule

- À **12:20:50 UTC**, Cloudflare Worker a appelé **une seule fois** la route Pages privée `/__cron/history-probe`, avec les identifiants Access préexistants ; cette route a effectué une requête GET Sportmonks `fixtures/between/2026-10-08/2026-10-12` filtrée sur les IDs de ligues **301 (L1)** et **384 (SA)**.
- Réponse **Sportmonks HTTP 200**, `success:true`, **19 rencontres**, `pagination.has_more=false`.
- Serie A : **10 rencontres**, **10 terminées avec score**. Exemple renvoyé : Genoa 2–1 Fiorentina, 10/10/2026, fixture ID 19713564.
- Ligue 1 : **9 rencontres**, **9 terminées avec score**. Exemple renvoyé : Lens 2–1 Olympique Lyonnais, 09/10/2026, fixture ID 19715591.
- **Aucune écriture Supabase** : les résultats historiques SA/L1 ne sont toujours pas présents dans la jointure `matches` + `results` après cet appel de diagnostic.
- Worker normal renforcé restauré (version `7edd8f93-2c64-4c3c-ad17-7e2c379667c3`), `MATCHSCOPE_CRON_ENABLED=false`. Route de diagnostic supprimée de GitHub par PR #8, remise en production après test. Secrets non révélés.
- La preuve concerne **l'accès à ces cinq journées**, pas encore une année complète d'historique ni les éventuelles limites Sportmonks sur de grands volumes.

## Étapes de validation restant nécessaires

- Vérifier d'abord l'autorisation du forfait Sportmonks, les coûts/quota et l'intégrité des résultats. Aucun import n'est déclenché par cette PR et aucune recherche de calendrier externe n'a été effectuée.
- Si autorisé, déclencher manuellement les **7 parties** (55 jours par partie sur 365 jours), séparément pour SA et L1, avec contrôles des réponses, état des matches, nombre de résultats et doublons avant chaque partie. Ne pas synchroniser les historiques des 3 autres ligues inutilement.
- Confirmer par SQL au moins 180 matchs **terminés, datés et avec score vérifié** par nouvelle ligue (seuil historique V0.7), puis vérifier la représentativité chronologique et l'échantillon de validation hors entraînement.
- Calibrer une **nouvelle version du modèle en shadow mode** sans écraser `model_runtime(v0.7)` ; mesurer Brier score, calibration par ligue et performance contre la référence sur des matchs postérieurs à la période d'entraînement. N'autoriser l'affichage 1/N/2 que pour un championnat réellement validé.
- Aucune prédiction rétroactive et aucun changement de `MATCHSCOPE_CRON_ENABLED=false`, Cloudflare Access, secrets ou calendrier cron pendant cette préparation.

**Bilan : tant que SA et L1 n'ont pas assez de résultats et de calibration, les probabilités restent indisponibles pour ces deux championnats.**
