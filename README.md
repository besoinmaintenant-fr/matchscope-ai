# MatchScope AI — MVP v0.1

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
