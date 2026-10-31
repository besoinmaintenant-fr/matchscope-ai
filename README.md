# MatchScope AI — MVP v0.1

> **Migration des tâches automatisées — 31 octobre 2026 :** les quatre
> déclarations de tâches planifiées ont été retirées du `netlify.toml` de
> `main`. La désactivation réelle ne prend effet qu'après publication du
> déploiement Netlify correspondant et vérification du déploiement publié.
> La collecte Cloudflare doit rester désactivée jusque-là, afin d'éviter deux
> collecteurs actifs sur la même base Supabase.

Application web mobile-first d'analyse probabiliste de matchs de football.

## Compétitions prévues
- Ligue 1
- Premier League
- La Liga
- Bundesliga
- Serie A
- UEFA Champions League
- UEFA Europa League

## Ce que l'application analyse
- forme récente pondérée
- xG / xGA et xGOT lorsqu'ils sont disponibles
- domicile / extérieur
- XI probables puis XI officiels
- blessures / suspensions
- formation et matchup tactique
- repos, enchaînement des matchs et fatigue
- stade / surface / météo
- historique récent avec faible poids
- consensus de marché / cotes lorsque disponible
- qualité et complétude des données

## Principe de fiabilité
L'application n'affiche pas de fausse certitude. Elle sépare :
1. **probabilité du résultat** (1/N/2, BTTS, over/under),
2. **confiance du modèle** (qualité + concordance des données),
3. **qualité des données** (xG présents, lineups, absences, météo, etc.).

La prochaine étape de production est un module de back-testing avec Brier score et calibration par championnat.

## Lancer sans clé API
Ouvrir `index.html` via un serveur statique ou déployer le dossier sur Netlify. L'application fonctionne immédiatement en **MODE DÉMO**.

## Passer en données réelles
1. Créer un token Sportmonks.
2. Dans Netlify > Site configuration > Environment variables, ajouter `SPORTMONKS_API_TOKEN`.
3. Ajouter `SPORTMONKS_LEAGUE_IDS` avec les IDs des 7 compétitions de votre abonnement, séparés par des virgules.
4. Redéployer.

Les clés restent côté fonctions Netlify : elles ne sont pas exposées dans le navigateur.

## Structure
- `index.html` : interface
- `styles.css` : design responsive
- `app.js` : logique UI + mode démo + récupération live
- `netlify/functions/fixtures.js` : fixtures live
- `netlify/functions/analyze.js` : récupération détaillée d'un match
- `netlify/functions/lib/engine.js` : qualité, confiance et probabilités de marchés secondaires

## V0.2 recommandée
- historique 10 matchs de chaque équipe avec décroissance exponentielle
- modèle Poisson/Dixon-Coles maison à partir des xG
- ajustement impact joueur (titulaire absent / gardien / buteur / créateur)
- récupération automatique des cotes et calcul de l'edge vs probabilité implicite
- back-testing par championnat et par marché
- recalcul automatique à publication des XI officiels
- alertes mobiles : « analyse prête »
- journal des prédictions vs résultat réel

## Important
Aucune méthode ne peut garantir 100 % de réussite sur des matchs de football. Une application sérieuse cherche à être bien calibrée et à mesurer ses erreurs, pas à promettre un résultat certain.

## Déploiement après changement de clé Sportmonks

Quand `SPORTMONKS_API_TOKEN` est modifié dans Netlify (contexte **Production**, portée **Functions**), publier un nouveau déploiement : la fonction déjà publiée conserve les variables d’environnement de son déploiement. Vérifier ensuite la réponse de `/.netlify/functions/fixtures` sans jamais exposer la clé dans le navigateur ni dans les journaux.

## Ordre de calcul : compositions avant pronostics (31 octobre 2026)

Le collecteur Netlify `collect-lineups` surveille automatiquement les matchs à venir
des **cinq championnats** toutes les **10 minutes**. Dans les 90 minutes avant
le coup d'envoi, il vérifie le statut Sportmonks : `metadata.type_id=572`,
`values.confirmed=true`, et exactement **11 titulaires dans chaque équipe**.

1. Si les XI ne sont pas officiels, **aucune nouvelle prédiction 1/N/2** n'est générée.
2. Si les XI sont officiels avant le coup d'envoi, ils sont enregistrés
   dans Supabase avec le snapshot FINAL ; le collecteur appelle ensuite
   le moteur et fige une prédiction FINAL, **si le modèle est calibré**.
3. Après le coup d'envoi, seuls les pronostics enregistrés à temps
   peuvent être consultés. **Aucun pronostic rétroactif** n'est créé.
4. Le modèle actuel V0.7 utilise l'historique collectif et **ne modélise
   pas encore l'effet individuel des onze joueurs**. Ne pas confondre
   « XI confirmés avant le calcul » et « modèle ajusté aux XI ».
5. **Premier League, La Liga et Bundesliga** : modèle V0.7 calibré.
   **Ligue 1 et Serie A** : collecte des XI et snapshots activée ;
   prédictions 1/N/2 indisponibles jusqu'à complétude et validation
   de l'historique de ces ligues.
6. Les estimations expérimentales de buteurs ne s'affichent qu'aux
   titulaires confirmés, avant le coup d'envoi, et uniquement si
   leurs statistiques individuelles sont exploitables.

Le code exécute l'appel de prédiction en interne dans la fonction Netlify
programmée, sans passer par une URL publique et sans exposer la clé.
