/* ============================================================
   MATCHSCOPE AI — model.js
   Version : V0.7
   Modèle  : Dixon-Coles + Elo + calibration
   ============================================================

   Exports :
   - buildModel()
   - predictV07()
   - tuneModel()
   - brier3()
   - bestPick()

   Compatible :
   - Navigateur ES Modules
   - Netlify Functions / Node ES Modules

   ============================================================ */


const DEFAULT_CONFIG = {
  historyDays: 365,

  // Pondération temporelle
  decayHalfLifeDays: 120,

  // Elo
  initialElo: 1500,
  eloK: 24,
  eloHomeAdvantage: 65,
  eloScale: 400,

  // Importance Elo dans les xG finaux
  eloWeight: 0.16,

  // Dixon-Coles
  rho: -0.08,

  // Limites xG
  minLambda: 0.20,
  maxLambda: 4.50,

  // Nombre de buts calculés dans la matrice
  maxGoals: 10,

  // Minimum matchs équipe
  minTeamMatches: 3,

  // Sécurité
  epsilon: 1e-9,

  // Calibration
  calibrationStrength: 0.55,
};


/* ============================================================
   UTILITAIRES
   ============================================================ */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}


function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}


function daysBetween(a, b) {
  const d1 = new Date(a);
  const d2 = new Date(b);

  if (
    Number.isNaN(d1.getTime()) ||
    Number.isNaN(d2.getTime())
  ) {
    return 0;
  }

  return Math.abs(d2 - d1) / 86400000;
}


function poisson(k, lambda) {
  if (lambda <= 0) {
    return k === 0 ? 1 : 0;
  }

  let factorial = 1;

  for (let i = 2; i <= k; i++) {
    factorial *= i;
  }

  return (
    Math.exp(-lambda) *
    Math.pow(lambda, k) /
    factorial
  );
}


function normalizeProbabilities(obj) {
  const home = Math.max(0, safeNumber(obj.home));
  const draw = Math.max(0, safeNumber(obj.draw));
  const away = Math.max(0, safeNumber(obj.away));

  const total = home + draw + away;

  if (total <= 0) {
    return {
      home: 1 / 3,
      draw: 1 / 3,
      away: 1 / 3,
    };
  }

  return {
    home: home / total,
    draw: draw / total,
    away: away / total,
  };
}


/* ============================================================
   NORMALISATION MATCHS
   ============================================================ */

function extractTeamId(match, side) {
  const candidates =
    side === "home"
      ? [
          match.homeTeamId,
          match.home_team_id,
          match.homeId,
          match.home_id,
          match.localteam_id,
          match.localTeamId,
          match.homeTeam?.id,
          match.home_team?.id,
          match.participants?.find(
            (p) =>
              p.meta?.location === "home" ||
              p.location === "home"
          )?.id,
        ]
      : [
          match.awayTeamId,
          match.away_team_id,
          match.awayId,
          match.away_id,
          match.visitorteam_id,
          match.visitorTeamId,
          match.awayTeam?.id,
          match.away_team?.id,
          match.participants?.find(
            (p) =>
              p.meta?.location === "away" ||
              p.location === "away"
          )?.id,
        ];

  for (const value of candidates) {
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }

  return null;
}


function extractScore(match, side) {
  const direct =
    side === "home"
      ? [
          match.homeScore,
          match.home_score,
          match.homeGoals,
          match.home_goals,
          match.goalsHome,
          match.goals_home,
        ]
      : [
          match.awayScore,
          match.away_score,
          match.awayGoals,
          match.away_goals,
          match.goalsAway,
          match.goals_away,
        ];

  for (const value of direct) {
    const n = Number(value);

    if (Number.isFinite(n)) {
      return n;
    }
  }

  if (Array.isArray(match.scores)) {
    const participantId = extractTeamId(match, side);

    const scoreItem = match.scores.find((s) => {
      const isCurrent =
        s.description === "CURRENT" ||
        s.description === "Current" ||
        s.type === "CURRENT";

      return (
        String(s.participant_id) ===
          String(participantId) &&
        isCurrent
      );
    });

    if (scoreItem) {
      const n =
        scoreItem.score?.goals ??
        scoreItem.score ??
        scoreItem.goals;

      if (Number.isFinite(Number(n))) {
        return Number(n);
      }
    }
  }

  return null;
}


function extractDate(match) {
  return (
    match.date ||
    match.starting_at ||
    match.startingAt ||
    match.kickoff ||
    match.kickoff_at ||
    match.fixtureDate ||
    match.fixture_date ||
    null
  );
}


function extractLeagueId(match) {
  return (
    match.leagueId ??
    match.league_id ??
    match.league?.id ??
    match.competitionId ??
    match.competition_id ??
    null
  );
}


function normalizeMatch(match) {
  if (!match) return null;

  const homeTeamId = extractTeamId(match, "home");
  const awayTeamId = extractTeamId(match, "away");

  const homeGoals = extractScore(match, "home");
  const awayGoals = extractScore(match, "away");

  const date = extractDate(match);

  if (
    !homeTeamId ||
    !awayTeamId ||
    homeGoals === null ||
    awayGoals === null
  ) {
    return null;
  }

  return {
    homeTeamId,
    awayTeamId,

    homeGoals,
    awayGoals,

    date,

    leagueId: extractLeagueId(match),

    raw: match,
  };
}


/* ============================================================
   FILTRAGE HISTORIQUE
   ============================================================ */

function prepareHistory(
  matches = [],
  {
    leagueId = null,
    referenceDate = new Date(),
    historyDays = 365,
  } = {}
) {
  const normalized = matches
    .map(normalizeMatch)
    .filter(Boolean);

  return normalized
    .filter((match) => {
      if (
        leagueId !== null &&
        match.leagueId !== null &&
        String(match.leagueId) !== String(leagueId)
      ) {
        return false;
      }

      if (!match.date) {
        return true;
      }

      const age = daysBetween(
        match.date,
        referenceDate
      );

      return age <= historyDays;
    })
    .sort((a, b) => {
      if (!a.date || !b.date) return 0;

      return (
        new Date(a.date).getTime() -
        new Date(b.date).getTime()
      );
    });
}


/* ============================================================
   PONDÉRATION TEMPORELLE
   ============================================================ */

function timeWeight(
  matchDate,
  referenceDate,
  halfLifeDays
) {
  if (!matchDate || !referenceDate) {
    return 1;
  }

  const age = daysBetween(
    matchDate,
    referenceDate
  );

  if (halfLifeDays <= 0) {
    return 1;
  }

  return Math.pow(
    0.5,
    age / halfLifeDays
  );
}


/* ============================================================
   STATISTIQUES LIGUE / ÉQUIPES
   ============================================================ */

function createTeamStats() {
  return {
    homeMatches: 0,
    awayMatches: 0,

    weightedHomeMatches: 0,
    weightedAwayMatches: 0,

    homeGF: 0,
    homeGA: 0,

    awayGF: 0,
    awayGA: 0,
  };
}


function computeStats(
  matches,
  referenceDate,
  config
) {
  const teams = new Map();

  let totalWeight = 0;

  let totalHomeGoals = 0;
  let totalAwayGoals = 0;

  for (const match of matches) {
    const weight = timeWeight(
      match.date,
      referenceDate,
      config.decayHalfLifeDays
    );

    if (!teams.has(match.homeTeamId)) {
      teams.set(
        match.homeTeamId,
        createTeamStats()
      );
    }

    if (!teams.has(match.awayTeamId)) {
      teams.set(
        match.awayTeamId,
        createTeamStats()
      );
    }

    const home = teams.get(match.homeTeamId);
    const away = teams.get(match.awayTeamId);

    home.homeMatches += 1;
    home.weightedHomeMatches += weight;

    home.homeGF +=
      match.homeGoals * weight;

    home.homeGA +=
      match.awayGoals * weight;


    away.awayMatches += 1;
    away.weightedAwayMatches += weight;

    away.awayGF +=
      match.awayGoals * weight;

    away.awayGA +=
      match.homeGoals * weight;


    totalWeight += weight;

    totalHomeGoals +=
      match.homeGoals * weight;

    totalAwayGoals +=
      match.awayGoals * weight;
  }

  const leagueHomeAvg =
    totalWeight > 0
      ? totalHomeGoals / totalWeight
      : 1.45;

  const leagueAwayAvg =
    totalWeight > 0
      ? totalAwayGoals / totalWeight
      : 1.15;

  return {
    teams,

    leagueHomeAvg:
      clamp(leagueHomeAvg, 0.5, 3),

    leagueAwayAvg:
      clamp(leagueAwayAvg, 0.4, 2.5),

    matchCount: matches.length,
  };
}


/* ============================================================
   FORCES ATTAQUE / DÉFENSE
   ============================================================ */

function teamStrengths(
  teamId,
  stats,
  config
) {
  const team = stats.teams.get(
    String(teamId)
  );

  if (!team) {
    return {
      homeAttack: 1,
      homeDefense: 1,
      awayAttack: 1,
      awayDefense: 1,
      dataQuality: 0,
    };
  }

  const minMatches =
    config.minTeamMatches;

  const homeWeight =
    clamp(
      team.weightedHomeMatches /
        minMatches,
      0,
      1
    );

  const awayWeight =
    clamp(
      team.weightedAwayMatches /
        minMatches,
      0,
      1
    );


  const rawHomeAttack =
    team.weightedHomeMatches > 0
      ? team.homeGF /
        team.weightedHomeMatches /
        stats.leagueHomeAvg
      : 1;

  const rawHomeDefense =
    team.weightedHomeMatches > 0
      ? team.homeGA /
        team.weightedHomeMatches /
        stats.leagueAwayAvg
      : 1;


  const rawAwayAttack =
    team.weightedAwayMatches > 0
      ? team.awayGF /
        team.weightedAwayMatches /
        stats.leagueAwayAvg
      : 1;

  const rawAwayDefense =
    team.weightedAwayMatches > 0
      ? team.awayGA /
        team.weightedAwayMatches /
        stats.leagueHomeAvg
      : 1;


  const shrink = (value, weight) =>
    1 + (value - 1) * weight;


  return {
    homeAttack: clamp(
      shrink(
        rawHomeAttack,
        homeWeight
      ),
      0.35,
      2.8
    ),

    homeDefense: clamp(
      shrink(
        rawHomeDefense,
        homeWeight
      ),
      0.35,
      2.8
    ),

    awayAttack: clamp(
      shrink(
        rawAwayAttack,
        awayWeight
      ),
      0.35,
      2.8
    ),

    awayDefense: clamp(
      shrink(
        rawAwayDefense,
        awayWeight
      ),
      0.35,
      2.8
    ),

    dataQuality:
      (homeWeight + awayWeight) / 2,
  };
}


/* ============================================================
   ELO
   ============================================================ */

function eloExpected(
  homeElo,
  awayElo,
  config
) {
  const adjustedHome =
    homeElo +
    config.eloHomeAdvantage;

  return (
    1 /
    (
      1 +
      Math.pow(
        10,
        (awayElo - adjustedHome) /
          config.eloScale
      )
    )
  );
}


function matchResult(
  homeGoals,
  awayGoals
) {
  if (homeGoals > awayGoals) return 1;
  if (homeGoals < awayGoals) return 0;

  return 0.5;
}


function computeElo(
  matches,
  config
) {
  const ratings = new Map();

  const getRating = (teamId) => {
    if (!ratings.has(teamId)) {
      ratings.set(
        teamId,
        config.initialElo
      );
    }

    return ratings.get(teamId);
  };


  for (const match of matches) {
    const homeElo =
      getRating(match.homeTeamId);

    const awayElo =
      getRating(match.awayTeamId);

    const expectedHome =
      eloExpected(
        homeElo,
        awayElo,
        config
      );

    const actualHome =
      matchResult(
        match.homeGoals,
        match.awayGoals
      );


    // Petite prise en compte de l'écart de buts
    const goalDiff =
      Math.abs(
        match.homeGoals -
        match.awayGoals
      );

    const multiplier =
      goalDiff <= 1
        ? 1
        : Math.log(goalDiff + 1);


    const delta =
      config.eloK *
      multiplier *
      (actualHome - expectedHome);


    ratings.set(
      match.homeTeamId,
      homeElo + delta
    );

    ratings.set(
      match.awayTeamId,
      awayElo - delta
    );
  }

  return ratings;
}


/* ============================================================
   DIXON-COLES
   ============================================================ */

function dixonColesTau(
  homeGoals,
  awayGoals,
  lambdaHome,
  lambdaAway,
  rho
) {
  if (
    homeGoals === 0 &&
    awayGoals === 0
  ) {
    return (
      1 -
      lambdaHome *
        lambdaAway *
        rho
    );
  }

  if (
    homeGoals === 0 &&
    awayGoals === 1
  ) {
    return (
      1 +
      lambdaHome * rho
    );
  }

  if (
    homeGoals === 1 &&
    awayGoals === 0
  ) {
    return (
      1 +
      lambdaAway * rho
    );
  }

  if (
    homeGoals === 1 &&
    awayGoals === 1
  ) {
    return 1 - rho;
  }

  return 1;
}


/* ============================================================
   MATRICE DES SCORES
   ============================================================ */

function createScoreMatrix(
  lambdaHome,
  lambdaAway,
  config
) {
  const matrix = [];

  let total = 0;

  for (
    let homeGoals = 0;
    homeGoals <= config.maxGoals;
    homeGoals++
  ) {
    const row = [];

    for (
      let awayGoals = 0;
      awayGoals <= config.maxGoals;
      awayGoals++
    ) {
      let probability =
        poisson(
          homeGoals,
          lambdaHome
        ) *
        poisson(
          awayGoals,
          lambdaAway
        );


      probability *=
        dixonColesTau(
          homeGoals,
          awayGoals,
          lambdaHome,
          lambdaAway,
          config.rho
        );


      probability =
        Math.max(
          config.epsilon,
          probability
        );


      row.push(probability);

      total += probability;
    }

    matrix.push(row);
  }


  if (total > 0) {
    for (let h = 0; h < matrix.length; h++) {
      for (
        let a = 0;
        a < matrix[h].length;
        a++
      ) {
        matrix[h][a] /= total;
      }
    }
  }

  return matrix;
}


/* ============================================================
   EXTRACTION PROBABILITÉS
   ============================================================ */

function matrixToProbabilities(matrix) {
  let home = 0;
  let draw = 0;
  let away = 0;

  let over25 = 0;
  let under25 = 0;

  let bttsYes = 0;

  let expectedHomeGoals = 0;
  let expectedAwayGoals = 0;

  const scores = [];


  for (let h = 0; h < matrix.length; h++) {
    for (
      let a = 0;
      a < matrix[h].length;
      a++
    ) {
      const p = matrix[h][a];

      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;


      if (h + a >= 3) {
        over25 += p;
      } else {
        under25 += p;
      }


      if (h > 0 && a > 0) {
        bttsYes += p;
      }


      expectedHomeGoals +=
        h * p;

      expectedAwayGoals +=
        a * p;


      scores.push({
        home: h,
        away: a,
        probability: p,
      });
    }
  }


  scores.sort(
    (x, y) =>
      y.probability -
      x.probability
  );


  return {
    probabilities:
      normalizeProbabilities({
        home,
        draw,
        away,
      }),

    over25,
    under25,

    bttsYes,
    bttsNo:
      1 - bttsYes,

    expectedGoals: {
      home: expectedHomeGoals,
      away: expectedAwayGoals,
      total:
        expectedHomeGoals +
        expectedAwayGoals,
    },

    likelyScores:
      scores.slice(0, 5),
  };
}


/* ============================================================
   CALIBRATION
   ============================================================ */

function calibrateProbabilities(
  probabilities,
  calibration = null,
  strength = 0.55
) {
  if (!calibration) {
    return probabilities;
  }

  const p = {
    ...probabilities,
  };


  for (const key of [
    "home",
    "draw",
    "away",
  ]) {
    const cal =
      calibration[key];

    if (
      cal === undefined ||
      cal === null
    ) {
      continue;
    }

    /*
      calibration[key] représente
      une correction multiplicative.

      Exemple :
      {
        home: 1.02,
        draw: 0.96,
        away: 1.01
      }
    */

    const factor =
      1 +
      (safeNumber(cal, 1) - 1) *
        strength;

    p[key] *= factor;
  }


  return normalizeProbabilities(p);
}


/* ============================================================
   CONSTRUCTION MODÈLE
   ============================================================ */

export function buildModel({
  matches = [],
  leagueId = null,
  referenceDate = new Date(),
  config = {},
} = {}) {
  const cfg = {
    ...DEFAULT_CONFIG,
    ...config,
  };


  const history =
    prepareHistory(
      matches,
      {
        leagueId,
        referenceDate,
        historyDays:
          cfg.historyDays,
      }
    );


  const stats =
    computeStats(
      history,
      referenceDate,
      cfg
    );


  const elo =
    computeElo(
      history,
      cfg
    );


  return {
    version: "0.7",

    leagueId,

    referenceDate,

    history,

    stats,

    elo,

    config: cfg,
  };
}


/* ============================================================
   PREDICTION V0.7
   ============================================================ */

export function predictV07({
  homeTeamId,
  awayTeamId,

  matches = null,
  model = null,

  leagueId = null,

  date = new Date(),

  calibration = null,

  config = {},
} = {}) {
  if (
    homeTeamId === undefined ||
    awayTeamId === undefined
  ) {
    throw new Error(
      "predictV07 : homeTeamId et awayTeamId sont obligatoires."
    );
  }


  const cfg = {
    ...DEFAULT_CONFIG,
    ...config,
  };


  const activeModel =
    model ||
    buildModel({
      matches: matches || [],
      leagueId,
      referenceDate: date,
      config: cfg,
    });


  const stats =
    activeModel.stats;

  const elo =
    activeModel.elo;


  const homeStrength =
    teamStrengths(
      String(homeTeamId),
      stats,
      cfg
    );

  const awayStrength =
    teamStrengths(
      String(awayTeamId),
      stats,
      cfg
    );


  /*
    Dixon-Coles / Poisson
    ---------------------

    xG domicile =
      moyenne buts domicile ligue
      × attaque domicile équipe A
      × défense extérieure équipe B

    xG extérieur =
      moyenne buts extérieur ligue
      × attaque extérieure équipe B
      × défense domicile équipe A
  */

  let lambdaHome =
    stats.leagueHomeAvg *
    homeStrength.homeAttack *
    awayStrength.awayDefense;


  let lambdaAway =
    stats.leagueAwayAvg *
    awayStrength.awayAttack *
    homeStrength.homeDefense;


  /* ========================================================
     CORRECTION ELO
     ======================================================== */

  const homeElo =
    elo.get(String(homeTeamId)) ??
    cfg.initialElo;

  const awayElo =
    elo.get(String(awayTeamId)) ??
    cfg.initialElo;


  const eloHomeProbability =
    eloExpected(
      homeElo,
      awayElo,
      cfg
    );


  /*
    0.50 = forces égales.

    On transforme ensuite l'avantage
    Elo en multiplicateur modéré sur
    les xG.
  */

  const eloSignal =
    (eloHomeProbability - 0.5) * 2;


  const homeEloFactor =
    Math.exp(
      eloSignal *
      cfg.eloWeight
    );


  const awayEloFactor =
    Math.exp(
      -eloSignal *
      cfg.eloWeight
    );


  lambdaHome *= homeEloFactor;
  lambdaAway *= awayEloFactor;


  lambdaHome =
    clamp(
      lambdaHome,
      cfg.minLambda,
      cfg.maxLambda
    );

  lambdaAway =
    clamp(
      lambdaAway,
      cfg.minLambda,
      cfg.maxLambda
    );


  /* ========================================================
     MATRICE DIXON-COLES
     ======================================================== */

  const matrix =
    createScoreMatrix(
      lambdaHome,
      lambdaAway,
      cfg
    );


  const derived =
    matrixToProbabilities(
      matrix
    );


  /* ========================================================
     CALIBRATION FINALE
     ======================================================== */

  const rawProbabilities =
    derived.probabilities;


  const calibrated =
    calibrateProbabilities(
      rawProbabilities,
      calibration,
      cfg.calibrationStrength
    );


  const confidence =
    calculateConfidence({
      model: activeModel,

      homeStrength,
      awayStrength,

      probabilities: calibrated,

      homeTeamId,
      awayTeamId,
    });


  return {
    version: "0.7",

    leagueId,

    homeTeamId:
      String(homeTeamId),

    awayTeamId:
      String(awayTeamId),

    predictionDate: date,

    probabilities: calibrated,

    rawProbabilities,

    percentages: {
      home:
        calibrated.home * 100,

      draw:
        calibrated.draw * 100,

      away:
        calibrated.away * 100,
    },

    expectedGoals: {
      home:
        lambdaHome,

      away:
        lambdaAway,

      total:
        lambdaHome +
        lambdaAway,
    },

    markets: {
      over25:
        derived.over25,

      under25:
        derived.under25,

      bttsYes:
        derived.bttsYes,

      bttsNo:
        derived.bttsNo,
    },

    percentagesMarkets: {
      over25:
        derived.over25 * 100,

      under25:
        derived.under25 * 100,

      bttsYes:
        derived.bttsYes * 100,

      bttsNo:
        derived.bttsNo * 100,
    },

    likelyScores:
      derived.likelyScores.map(
        (score) => ({
          ...score,

          percentage:
            score.probability *
            100,
        })
      ),

    elo: {
      home: homeElo,

      away: awayElo,

      difference:
        homeElo -
        awayElo,

      homeExpected:
        eloHomeProbability,
    },

    strengths: {
      home: homeStrength,
      away: awayStrength,
    },

    league: {
      averageHomeGoals:
        stats.leagueHomeAvg,

      averageAwayGoals:
        stats.leagueAwayAvg,

      historyMatches:
        stats.matchCount,
    },

    confidence,

    bestPick:
      bestPick(
        calibrated
      ),

    scoreMatrix:
      matrix,
  };
}


/* ============================================================
   CONFIANCE
   ============================================================ */

function calculateConfidence({
  model,
  homeStrength,
  awayStrength,
  probabilities,
}) {
  const historyQuality =
    clamp(
      model.stats.matchCount /
        120,
      0,
      1
    );


  const teamQuality =
    (
      homeStrength.dataQuality +
      awayStrength.dataQuality
    ) /
    2;


  const sorted =
    Object.values(
      probabilities
    ).sort(
      (a, b) => b - a
    );


  const separation =
    sorted.length >= 2
      ? sorted[0] - sorted[1]
      : 0;


  const separationQuality =
    clamp(
      separation / 0.25,
      0,
      1
    );


  const confidence =
    (
      historyQuality *
        0.35 +

      teamQuality *
        0.40 +

      separationQuality *
        0.25
    );


  return {
    score:
      Math.round(
        confidence * 100
      ),

    historyQuality:
      Math.round(
        historyQuality * 100
      ),

    teamDataQuality:
      Math.round(
        teamQuality * 100
      ),

    separation:
      Math.round(
        separationQuality * 100
      ),

    level:
      confidence >= 0.75
        ? "HIGH"
        : confidence >= 0.50
        ? "MEDIUM"
        : "LOW",
  };
}


/* ============================================================
   BEST PICK
   ============================================================ */

export function bestPick(
  probabilities
) {
  if (!probabilities) {
    return null;
  }

  const entries = [
    {
      outcome: "HOME",
      label: "1",
      probability:
        safeNumber(
          probabilities.home
        ),
    },

    {
      outcome: "DRAW",
      label: "X",
      probability:
        safeNumber(
          probabilities.draw
        ),
    },

    {
      outcome: "AWAY",
      label: "2",
      probability:
        safeNumber(
          probabilities.away
        ),
    },
  ];


  entries.sort(
    (a, b) =>
      b.probability -
      a.probability
  );


  const best = entries[0];

  return {
    ...best,

    percentage:
      best.probability *
      100,

    second:
      entries[1],
  };
}


/* ============================================================
   BRIER SCORE 1X2
   ============================================================ */

export function brier3(
  prediction,
  actual
) {
  let result;

  if (
    actual === "H" ||
    actual === "HOME" ||
    actual === 1
  ) {
    result = {
      home: 1,
      draw: 0,
      away: 0,
    };
  }

  else if (
    actual === "D" ||
    actual === "DRAW" ||
    actual === "X"
  ) {
    result = {
      home: 0,
      draw: 1,
      away: 0,
    };
  }

  else if (
    actual === "A" ||
    actual === "AWAY" ||
    actual === 2
  ) {
    result = {
      home: 0,
      draw: 0,
      away: 1,
    };
  }

  else if (
    typeof actual === "object"
  ) {
    result = actual;
  }

  else {
    throw new Error(
      "brier3 : résultat réel non reconnu."
    );
  }


  const p =
    normalizeProbabilities(
      prediction
    );


  return (
    Math.pow(
      p.home -
        result.home,
      2
    ) +

    Math.pow(
      p.draw -
        result.draw,
      2
    ) +

    Math.pow(
      p.away -
        result.away,
      2
    )
  ) / 3;
}


/* ============================================================
   BACKTEST
   ============================================================ */

function backtestConfig(
  matches,
  config
) {
  if (
    !Array.isArray(matches) ||
    matches.length < 20
  ) {
    return {
      brier: Infinity,
      predictions: 0,
    };
  }


  const history =
    matches
      .map(normalizeMatch)
      .filter(Boolean)
      .sort(
        (a, b) =>
          new Date(a.date) -
          new Date(b.date)
      );


  let totalBrier = 0;
  let count = 0;


  /*
    On démarre après suffisamment
    de matchs afin de ne pas tester
    sur un modèle totalement vide.
  */

  const startIndex =
    Math.min(
      30,
      Math.floor(
        history.length * 0.25
      )
    );


  for (
    let i = startIndex;
    i < history.length;
    i++
  ) {
    const target =
      history[i];


    const previous =
      history.slice(
        0,
        i
      );


    const model =
      buildModel({
        matches: previous,

        leagueId:
          target.leagueId,

        referenceDate:
          target.date,

        config,
      });


    const prediction =
      predictV07({
        homeTeamId:
          target.homeTeamId,

        awayTeamId:
          target.awayTeamId,

        model,

        leagueId:
          target.leagueId,

        date:
          target.date,

        config,
      });


    const actual =
      target.homeGoals >
      target.awayGoals
        ? "HOME"

        : target.homeGoals <
          target.awayGoals
        ? "AWAY"

        : "DRAW";


    const score =
      brier3(
        prediction.probabilities,
        actual
      );


    if (
      Number.isFinite(score)
    ) {
      totalBrier += score;
      count += 1;
    }
  }


  return {
    brier:
      count > 0
        ? totalBrier / count
        : Infinity,

    predictions: count,
  };
}


/* ============================================================
   OPTIMISATION AUTOMATIQUE
   ============================================================ */

export function tuneModel({
  matches = [],
  baseConfig = {},
} = {}) {
  const normalized =
    matches
      .map(normalizeMatch)
      .filter(Boolean);


  if (normalized.length < 30) {
    return {
      config: {
        ...DEFAULT_CONFIG,
        ...baseConfig,
      },

      brier: null,

      tested: 0,

      message:
        "Pas assez de matchs pour calibrer correctement le modèle.",
    };
  }


  /*
    Grille volontairement modérée :
    suffisamment large pour améliorer
    le modèle sans exploser le temps
    de calcul côté Netlify.
  */

  const halfLives = [
    90,
    120,
    150,
  ];

  const eloKs = [
    18,
    24,
    30,
  ];

  const eloWeights = [
    0.10,
    0.16,
    0.22,
  ];

  const rhos = [
    -0.12,
    -0.08,
    -0.04,
  ];


  let best = null;

  let tested = 0;


  for (
    const decayHalfLifeDays
    of halfLives
  ) {
    for (
      const eloK
      of eloKs
    ) {
      for (
        const eloWeight
        of eloWeights
      ) {
        for (
          const rho
          of rhos
        ) {
          const config = {
            ...DEFAULT_CONFIG,
            ...baseConfig,

            decayHalfLifeDays,

            eloK,

            eloWeight,

            rho,
          };


          const evaluation =
            backtestConfig(
              normalized,
              config
            );


          tested += 1;


          if (
            !best ||
            evaluation.brier <
              best.brier
          ) {
            best = {
              config,
              brier:
                evaluation.brier,

              predictions:
                evaluation.predictions,
            };
          }
        }
      }
    }
  }


  return {
    ...best,

    tested,

    version: "0.7",
  };
}


/* ============================================================
   CALIBRATION PAR LIGUE
   ============================================================ */

export function calculateLeagueCalibration({
  matches = [],
  config = {},
} = {}) {
  const history =
    matches
      .map(normalizeMatch)
      .filter(Boolean)
      .sort(
        (a, b) =>
          new Date(a.date) -
          new Date(b.date)
      );


  if (history.length < 40) {
    return {
      home: 1,
      draw: 1,
      away: 1,

      sampleSize: 0,
    };
  }


  let predictedHome = 0;
  let predictedDraw = 0;
  let predictedAway = 0;

  let actualHome = 0;
  let actualDraw = 0;
  let actualAway = 0;

  let count = 0;


  const start =
    Math.min(
      30,
      Math.floor(
        history.length * 0.25
      )
    );


  for (
    let i = start;
    i < history.length;
    i++
  ) {
    const target =
      history[i];


    const training =
      history.slice(
        0,
        i
      );


    const model =
      buildModel({
        matches: training,

        leagueId:
          target.leagueId,

        referenceDate:
          target.date,

        config,
      });


    const prediction =
      predictV07({
        homeTeamId:
          target.homeTeamId,

        awayTeamId:
          target.awayTeamId,

        model,

        date:
          target.date,

        config,

        calibration: null,
      });


    predictedHome +=
      prediction.probabilities.home;

    predictedDraw +=
      prediction.probabilities.draw;

    predictedAway +=
      prediction.probabilities.away;


    if (
      target.homeGoals >
      target.awayGoals
    ) {
      actualHome += 1;
    }

    else if (
      target.homeGoals <
      target.awayGoals
    ) {
      actualAway += 1;
    }

    else {
      actualDraw += 1;
    }


    count += 1;
  }


  if (!count) {
    return {
      home: 1,
      draw: 1,
      away: 1,

      sampleSize: 0,
    };
  }


  const observedHome =
    actualHome / count;

  const observedDraw =
    actualDraw / count;

  const observedAway =
    actualAway / count;


  const modelHome =
    predictedHome / count;

  const modelDraw =
    predictedDraw / count;

  const modelAway =
    predictedAway / count;


  return {
    home:
      clamp(
        observedHome /
          Math.max(
            modelHome,
            0.01
          ),
        0.80,
        1.20
      ),

    draw:
      clamp(
        observedDraw /
          Math.max(
            modelDraw,
            0.01
          ),
        0.80,
        1.20
      ),

    away:
      clamp(
        observedAway /
          Math.max(
            modelAway,
            0.01
          ),
        0.80,
        1.20
      ),

    sampleSize: count,

    observed: {
      home: observedHome,
      draw: observedDraw,
      away: observedAway,
    },

    predicted: {
      home: modelHome,
      draw: modelDraw,
      away: modelAway,
    },
  };
}


/* ============================================================
   EXPORT DEFAULT
   ============================================================ */

export default {
  version: "0.7",

  buildModel,

  predictV07,

  tuneModel,

  brier3,

  bestPick,

  calculateLeagueCalibration,
};
