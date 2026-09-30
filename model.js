(() => {
  // ===================================================
  // MATCHSCOPE AI — V0.7
  // Dixon-Coles + Elo + 365 jours
  // calibration par ligue + holdout chronologique
  // Utilisable dans le navigateur ET côté serveur.
  // ===================================================

  const IS_SERVER =
    typeof module !== 'undefined' &&
    module.exports;

  const HAS_BROWSER_ANALYSIS =
    typeof openAnalysis === 'function';

  if (!IS_SERVER && !HAS_BROWSER_ANALYSIS) {
    console.error('MatchScope V0.7 : openAnalysis introuvable.');
    return;
  }

  const previousOpenAnalysis =
    HAS_BROWSER_ANALYSIS ? openAnalysis : null;

  const MODEL_VERSION = 'v0.7';
  const TARGET_BRIER = 0.620;
  const MODEL_HISTORY_VERSION = 'modelhistory-v2';
  const MODEL_LEAGUES = new Set(['BL', 'LL', 'PL']);

  let tuningCache = null;

  function resetTuningCache() {
    tuningCache = null;
  }

  // ===================================================
  // OUTILS
  // ===================================================

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeTeam(value = '') {
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function sameTeam(first, second) {
    return normalizeTeam(first) === normalizeTeam(second);
  }

  function teamKey(competition, team) {
    return `${competition}::${normalizeTeam(team)}`;
  }

  function pct(probability) {
    if (!Number.isFinite(Number(probability))) {
      return '—';
    }

    return `${Math.round(clamp(Number(probability), 0, 1) * 100)}%`;
  }

  function matchTime(match) {
    if (match?.startingAt) {
      const parsed = Date.parse(match.startingAt);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    const timestamp = Number(match?.kickoffTs);

    return Number.isFinite(timestamp)
      ? timestamp
      : null;
  }

  function actualVector(result) {
    return {
      home: result === '1' ? 1 : 0,
      draw: result === 'N' ? 1 : 0,
      away: result === '2' ? 1 : 0
    };
  }

  function brier3(probability, result) {
    const actual = actualVector(result);

    return (
      Math.pow(
        probability.home - actual.home,
        2
      )
      +
      Math.pow(
        probability.draw - actual.draw,
        2
      )
      +
      Math.pow(
        probability.away - actual.away,
        2
      )
    );
  }

  function bestPick(probability) {
    return [
      ['1', probability.home],
      ['N', probability.draw],
      ['2', probability.away]
    ]
      .sort(
        (first, second) =>
          second[1] - first[1]
      )[0][0];
  }

  // ===================================================
  // HISTORIQUE
  // ===================================================

  function leagueMatchesBefore(
    history,
    competition,
    beforeTime = Infinity
  ) {
    return history.filter(match => {
      if (match.competition !== competition) {
        return false;
      }

      const timestamp = matchTime(match);

      if (!Number.isFinite(timestamp)) {
        return false;
      }

      if (
        Number.isFinite(beforeTime) &&
        timestamp >= beforeTime
      ) {
        return false;
      }

      return (
        num(match?.score?.home) !== null &&
        num(match?.score?.away) !== null
      );
    });
  }

  function teamMatchesBefore(
    history,
    team,
    competition,
    beforeTime = Infinity,
    venue = 'all',
    limit = 10,
    excludeId = null
  ) {
    return history
      .filter(match => {
        if (match.competition !== competition) {
          return false;
        }

        if (
          excludeId !== null &&
          String(match.id) === String(excludeId)
        ) {
          return false;
        }

        const timestamp = matchTime(match);

        if (!Number.isFinite(timestamp)) {
          return false;
        }

        if (
          Number.isFinite(beforeTime) &&
          timestamp >= beforeTime
        ) {
          return false;
        }

        const isHome = sameTeam(
          match.home,
          team
        );

        const isAway = sameTeam(
          match.away,
          team
        );

        if (venue === 'home') {
          return isHome;
        }

        if (venue === 'away') {
          return isAway;
        }

        return isHome || isAway;
      })
      .sort(
        (first, second) =>
          (matchTime(second) || 0)
          -
          (matchTime(first) || 0)
      )
      .slice(
        0,
        limit
      );
  }

  // ===================================================
  // PONDÉRATION TEMPORELLE
  // ===================================================

  function timeWeight(
    matchTimestamp,
    referenceTimestamp,
    halfLife
  ) {
    if (
      !Number.isFinite(matchTimestamp) ||
      !Number.isFinite(referenceTimestamp)
    ) {
      return 1;
    }

    const ageDays = Math.max(
      0,
      (
        referenceTimestamp -
        matchTimestamp
      ) / 86400000
    );

    return Math.exp(
      -Math.log(2)
      *
      ageDays
      /
      halfLife
    );
  }

  // ===================================================
  // RÉSUMÉ ÉQUIPE
  // ===================================================

  function weightedSummary(
    list,
    team,
    referenceTimestamp,
    halfLife
  ) {
    const result = {
      played: 0,
      weight: 0,
      points: 0,
      gf: 0,
      ga: 0
    };

    list.forEach(match => {
      const isHome = sameTeam(
        match.home,
        team
      );

      const goalsFor = num(
        isHome
          ? match?.score?.home
          : match?.score?.away
      );

      const goalsAgainst = num(
        isHome
          ? match?.score?.away
          : match?.score?.home
      );

      if (
        goalsFor === null ||
        goalsAgainst === null
      ) {
        return;
      }

      const weight = timeWeight(
        matchTime(match),
        referenceTimestamp,
        halfLife
      );

      const points =
        goalsFor > goalsAgainst
          ? 3
          : goalsFor === goalsAgainst
            ? 1
            : 0;

      result.played += 1;
      result.weight += weight;
      result.points += points * weight;
      result.gf += goalsFor * weight;
      result.ga += goalsAgainst * weight;
    });

    return result;
  }

  // ===================================================
  // MOYENNES CHAMPIONNAT
  // ===================================================

  function leagueBaseline(
    history,
    competition,
    beforeTime,
    halfLife
  ) {
    const list = leagueMatchesBefore(
      history,
      competition,
      beforeTime
    );

    const referenceTimestamp =
      Number.isFinite(beforeTime)
        ? beforeTime
        : Date.now();

    let totalWeight = 0;
    let homeGoals = 0;
    let awayGoals = 0;
    let homeWins = 0;
    let draws = 0;
    let awayWins = 0;

    list.forEach(match => {
      const home = num(
        match?.score?.home
      );

      const away = num(
        match?.score?.away
      );

      if (
        home === null ||
        away === null
      ) {
        return;
      }

      const weight = timeWeight(
        matchTime(match),
        referenceTimestamp,
        Math.max(
          90,
          halfLife * 2
        )
      );

      totalWeight += weight;

      homeGoals +=
        home * weight;

      awayGoals +=
        away * weight;

      if (home > away) {
        homeWins += weight;
      } else if (home === away) {
        draws += weight;
      } else {
        awayWins += weight;
      }
    });

    const goalPriorWeight = 16;
    const resultPriorWeight = 26;

    return {
      n: list.length,

      homeGoalAvg:
        (
          homeGoals +
          goalPriorWeight * 1.45
        )
        /
        (
          totalWeight +
          goalPriorWeight
        ),

      awayGoalAvg:
        (
          awayGoals +
          goalPriorWeight * 1.15
        )
        /
        (
          totalWeight +
          goalPriorWeight
        ),

      resultPrior: {
        home:
          (
            homeWins +
            resultPriorWeight * 0.44
          )
          /
          (
            totalWeight +
            resultPriorWeight
          ),

        draw:
          (
            draws +
            resultPriorWeight * 0.28
          )
          /
          (
            totalWeight +
            resultPriorWeight
          ),

        away:
          (
            awayWins +
            resultPriorWeight * 0.28
          )
          /
          (
            totalWeight +
            resultPriorWeight
          )
      }
    };
  }

  function shrinkRate(
    weightedSum,
    weight,
    prior,
    shrinkWeight
  ) {
    return (
      weightedSum +
      shrinkWeight * prior
    )
    /
    (
      weight +
      shrinkWeight
    );
  }

  // ===================================================
  // POISSON
  // ===================================================

  function poisson(
    lambda,
    goals
  ) {
    let factorial = 1;

    for (
      let index = 2;
      index <= goals;
      index += 1
    ) {
      factorial *= index;
    }

    return (
      Math.exp(-lambda)
      *
      Math.pow(
        lambda,
        goals
      )
      /
      factorial
    );
  }

  // ===================================================
  // DIXON-COLES
  // ===================================================

  function dcTau(
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
      return Math.max(
        0.01,
        1 -
        lambdaHome *
        lambdaAway *
        rho
      );
    }

    if (
      homeGoals === 1 &&
      awayGoals === 0
    ) {
      return Math.max(
        0.01,
        1 +
        lambdaAway *
        rho
      );
    }

    if (
      homeGoals === 0 &&
      awayGoals === 1
    ) {
      return Math.max(
        0.01,
        1 +
        lambdaHome *
        rho
      );
    }

    if (
      homeGoals === 1 &&
      awayGoals === 1
    ) {
      return Math.max(
        0.01,
        1 - rho
      );
    }

    return 1;
  }

  function dixonColesMarkets(
  lambdaHome,
  lambdaAway,
  rho,
  includeScores = false
) {
  let home = 0;
  let draw = 0;
  let away = 0;

  let over15 = 0;
  let over25 = 0;
  let btts = 0;

  let probabilityMass = 0;

  const rawScores =
    [];

  for (
    let homeGoals = 0;
    homeGoals <= 8;
    homeGoals += 1
  ) {

    for (
      let awayGoals = 0;
      awayGoals <= 8;
      awayGoals += 1
    ) {

      const probability =
        poisson(
          lambdaHome,
          homeGoals
        )
        *
        poisson(
          lambdaAway,
          awayGoals
        )
        *
        dcTau(
          homeGoals,
          awayGoals,
          lambdaHome,
          lambdaAway,
          rho
        );


      probabilityMass +=
        probability;


      if (
        includeScores
      ) {

        rawScores.push({

          homeGoals,

          awayGoals,

          probability
        });
      }


      if (
        homeGoals >
        awayGoals
      ) {

        home +=
          probability;

      } else if (
        homeGoals ===
        awayGoals
      ) {

        draw +=
          probability;

      } else {

        away +=
          probability;
      }


      if (
        homeGoals +
        awayGoals >= 2
      ) {

        over15 +=
          probability;
      }


      if (
        homeGoals +
        awayGoals >= 3
      ) {

        over25 +=
          probability;
      }


      if (
        homeGoals > 0 &&
        awayGoals > 0
      ) {

        btts +=
          probability;
      }
    }
  }


  const scoreDistribution =

    includeScores

      ? rawScores.map(
          score => ({

            homeGoals:
              score.homeGoals,

            awayGoals:
              score.awayGoals,

            probability:

              score.probability

              /

              probabilityMass
          })
        )

      : [];


  return {

    home:
      home /
      probabilityMass,

    draw:
      draw /
      probabilityMass,

    away:
      away /
      probabilityMass,

    over15:
      over15 /
      probabilityMass,

    over25:
      over25 /
      probabilityMass,

    btts:
      btts /
      probabilityMass,

    scoreDistribution
  };
}


// ===================================================
// SCORES EXACTS
//
// Dixon-Coles construit la forme des scores.
//
// Ensuite nous réalignons chaque famille de scores
// sur les probabilités 1N2 finales de V0.7.
//
// Ainsi :
//
// somme des scores domicile = P(1)
// somme des scores nuls     = P(N)
// somme des scores extérieur= P(2)
//
// Cela ne modifie PAS V0.7.
// ===================================================

function scoreOutcome(
  score
) {

  if (
    score.homeGoals >
    score.awayGoals
  ) {

    return 'home';
  }


  if (
    score.homeGoals ===
    score.awayGoals
  ) {

    return 'draw';
  }


  return 'away';
}


function alignScoreDistribution(
  scores,
  dcProbability,
  finalProbability
) {

  if (
    !Array.isArray(
      scores
    )
    ||
    !scores.length
  ) {

    return [];
  }


  const ratios = {

    home:

      finalProbability.home

      /

      Math.max(
        1e-12,
        dcProbability.home
      ),


    draw:

      finalProbability.draw

      /

      Math.max(
        1e-12,
        dcProbability.draw
      ),


    away:

      finalProbability.away

      /

      Math.max(
        1e-12,
        dcProbability.away
      )
  };


  const adjusted =
    scores.map(
      score => {

        const outcome =
          scoreOutcome(
            score
          );


        return {

          homeGoals:
            score.homeGoals,

          awayGoals:
            score.awayGoals,

          probability:

            score.probability

            *

            ratios[
              outcome
            ]
        };
      }
    );


  const total =
    adjusted.reduce(
      (
        sum,
        score
      ) =>

        sum +
        score.probability,

      0
    );


  if (
    !Number.isFinite(
      total
    )
    ||
    total <= 0
  ) {

    return [];
  }


  return adjusted.map(
    score => ({

      homeGoals:
        score.homeGoals,

      awayGoals:
        score.awayGoals,

      probability:

        score.probability

        /

        total
    })
  );
}


function topExactScores(
  distribution,
  limit = 5
) {

  return [

    ...distribution

  ]

    .sort(
      (
        first,
        second
      ) =>

        second.probability

        -

        first.probability
    )

    .slice(
      0,
      limit
    )

    .map(
      score => ({

        score:
          `${score.homeGoals}-${score.awayGoals}`,

        homeGoals:
          score.homeGoals,

        awayGoals:
          score.awayGoals,

        probability:
          score.probability
      })
    );
}

  // ===================================================
  // ELO
  // ===================================================

  function buildEloTimeline(
    history,
    config
  ) {
    const ratings =
      new Map();

    const preMatch =
      new Map();

    const chronological =
      [...history]
        .filter(
          match =>
            MODEL_LEAGUES.has(
              match.competition
            )
        )
        .filter(
          match =>
            Number.isFinite(
              matchTime(match)
            )
        )
        .sort(
          (first, second) =>
            matchTime(first)
            -
            matchTime(second)
        );

    const getRating =
      key =>
        ratings.has(key)
          ? ratings.get(key)
          : 1500;

    chronological.forEach(match => {
      const homeKey = teamKey(
        match.competition,
        match.home
      );

      const awayKey = teamKey(
        match.competition,
        match.away
      );

      const homeRating =
        getRating(homeKey);

      const awayRating =
        getRating(awayKey);

      preMatch.set(
        String(match.id),
        {
          homeRating,
          awayRating
        }
      );

      const expectedHome =
        1
        /
        (
          1
          +
          Math.pow(
            10,
            -(
              homeRating
              +
              config.eloHomeAdv
              -
              awayRating
            )
            /
            400
          )
        );

      const homeGoals =
        num(
          match?.score?.home
        );

      const awayGoals =
        num(
          match?.score?.away
        );

      if (
        homeGoals === null ||
        awayGoals === null
      ) {
        return;
      }

      const actualHome =
        homeGoals > awayGoals
          ? 1
          : homeGoals === awayGoals
            ? 0.5
            : 0;

      const goalDifference =
        Math.abs(
          homeGoals -
          awayGoals
        );

      const marginMultiplier =
        goalDifference <= 1
          ? 1
          : Math.sqrt(
              goalDifference
            );

      const delta =
        config.eloK
        *
        marginMultiplier
        *
        (
          actualHome -
          expectedHome
        );

      ratings.set(
        homeKey,
        homeRating +
        delta
      );

      ratings.set(
        awayKey,
        awayRating -
        delta
      );
    });

    return {
      ratings,
      preMatch
    };
  }

  function eloProbability(
    target,
    baseline,
    eloState,
    config
  ) {
    const snapshot =
      eloState.preMatch.get(
        String(target.id)
      );

    let homeRating;
    let awayRating;

    if (snapshot) {
      homeRating =
        snapshot.homeRating;

      awayRating =
        snapshot.awayRating;
    } else {
      homeRating =
        eloState.ratings.get(
          teamKey(
            target.competition,
            target.home
          )
        )
        ??
        1500;

      awayRating =
        eloState.ratings.get(
          teamKey(
            target.competition,
            target.away
          )
        )
        ??
        1500;
    }

    const expectedHome =
      1
      /
      (
        1
        +
        Math.pow(
          10,
          -(
            homeRating
            +
            config.eloHomeAdv
            -
            awayRating
          )
          /
          400
        )
      );

    const closeness =
      1
      -
      Math.min(
        1,
        Math.abs(
          expectedHome -
          0.5
        )
        *
        2
      );

    const draw =
      clamp(
        baseline
          .resultPrior
          .draw
        *
        (
          0.88
          +
          0.24 *
          closeness
        ),
        0.16,
        0.34
      );

    const remainder =
      1 - draw;

    return {
      home:
        remainder *
        expectedHome,

      draw,

      away:
        remainder *
        (
          1 -
          expectedHome
        ),

      homeRating,
      awayRating
    };
  }

  // ===================================================
  // TEMPÉRATURE / CALIBRATION
  // ===================================================

  function temperatureScale(
    probability,
    temperature
  ) {
    const temp =
      Math.max(
        0.6,
        temperature
      );

    const home =
      Math.pow(
        Math.max(
          1e-9,
          probability.home
        ),
        1 / temp
      );

    const draw =
      Math.pow(
        Math.max(
          1e-9,
          probability.draw
        ),
        1 / temp
      );

    const away =
      Math.pow(
        Math.max(
          1e-9,
          probability.away
        ),
        1 / temp
      );

    const total =
      home +
      draw +
      away;

    return {
      home:
        home /
        total,

      draw:
        draw /
        total,

      away:
        away /
        total
    };
  }

  function applyClassCalibration(
    probability,
    factors
  ) {
    const home =
      probability.home *
      factors.home;

    const draw =
      probability.draw *
      factors.draw;

    const away =
      probability.away *
      factors.away;

    const total =
      home +
      draw +
      away;

    return {
      home:
        home /
        total,

      draw:
        draw /
        total,

      away:
        away /
        total
    };
  }

  function calibrationForLeague(
    calibration,
    competition
  ) {
    return (
      calibration?.[
        competition
      ]
      ||
      calibration?.GLOBAL
      ||
      {
        home: 1,
        draw: 1,
        away: 1
      }
    );
  }

  // ===================================================
  // MODÈLE V0.7
  // ===================================================

  function buildModel(
  history,
  target,
  beforeTime,
  config,
  eloState,
  calibration = null,
  includeScores = false
) {
  ) {
    const referenceTimestamp =
      Number.isFinite(beforeTime)
        ? beforeTime
        : Date.now();

    const baseline =
      leagueBaseline(
        history,
        target.competition,
        beforeTime,
        config.halfLife
      );

    const homeAll =
      weightedSummary(
        teamMatchesBefore(
          history,
          target.home,
          target.competition,
          beforeTime,
          'all',
          10,
          target.id
        ),
        target.home,
        referenceTimestamp,
        config.halfLife
      );

    const awayAll =
      weightedSummary(
        teamMatchesBefore(
          history,
          target.away,
          target.competition,
          beforeTime,
          'all',
          10,
          target.id
        ),
        target.away,
        referenceTimestamp,
        config.halfLife
      );

    const homeVenue =
      weightedSummary(
        teamMatchesBefore(
          history,
          target.home,
          target.competition,
          beforeTime,
          'home',
          8,
          target.id
        ),
        target.home,
        referenceTimestamp,
        config.halfLife
      );

    const awayVenue =
      weightedSummary(
        teamMatchesBefore(
          history,
          target.away,
          target.competition,
          beforeTime,
          'away',
          8,
          target.id
        ),
        target.away,
        referenceTimestamp,
        config.halfLife
      );

    const leagueTeamAverage =
      (
        baseline.homeGoalAvg
        +
        baseline.awayGoalAvg
      )
      /
      2;

    const homeAttackVenue =
      shrinkRate(
        homeVenue.gf,
        homeVenue.weight,
        baseline.homeGoalAvg,
        config.shrink
      );

    const awayDefenseVenue =
      shrinkRate(
        awayVenue.ga,
        awayVenue.weight,
        baseline.homeGoalAvg,
        config.shrink
      );

    const awayAttackVenue =
      shrinkRate(
        awayVenue.gf,
        awayVenue.weight,
        baseline.awayGoalAvg,
        config.shrink
      );

    const homeDefenseVenue =
      shrinkRate(
        homeVenue.ga,
        homeVenue.weight,
        baseline.awayGoalAvg,
        config.shrink
      );

    const homeAttackAll =
      shrinkRate(
        homeAll.gf,
        homeAll.weight,
        leagueTeamAverage,
        config.shrink
      );

    const awayDefenseAll =
      shrinkRate(
        awayAll.ga,
        awayAll.weight,
        leagueTeamAverage,
        config.shrink
      );

    const awayAttackAll =
      shrinkRate(
        awayAll.gf,
        awayAll.weight,
        leagueTeamAverage,
        config.shrink
      );

    const homeDefenseAll =
      shrinkRate(
        homeAll.ga,
        homeAll.weight,
        leagueTeamAverage,
        config.shrink
      );

    const venueHome =
      Math.sqrt(
        Math.max(
          0.05,
          homeAttackVenue *
          awayDefenseVenue
        )
      );

    const venueAway =
      Math.sqrt(
        Math.max(
          0.05,
          awayAttackVenue *
          homeDefenseVenue
        )
      );

    const generalHome =
      Math.sqrt(
        Math.max(
          0.05,
          homeAttackAll *
          awayDefenseAll
        )
      );

    const generalAway =
      Math.sqrt(
        Math.max(
          0.05,
          awayAttackAll *
          homeDefenseAll
        )
      );

    let lambdaHome =
      config.venueShare *
      venueHome
      +
      (
        1 -
        config.venueShare
      )
      *
      generalHome;

    let lambdaAway =
      config.venueShare *
      venueAway
      +
      (
        1 -
        config.venueShare
      )
      *
      generalAway;

    const homePPG =
      shrinkRate(
        homeAll.points,
        homeAll.weight,
        1.35,
        config.shrink
      );

    const awayPPG =
      shrinkRate(
        awayAll.points,
        awayAll.weight,
        1.35,
        config.shrink
      );

    const formDifference =
      clamp(
        (
          homePPG -
          awayPPG
        )
        /
        3,
        -1,
        1
      );

    lambdaHome *=
      1
      +
      config.formImpact *
      formDifference;

    lambdaAway *=
      1
      -
      config.formImpact *
      formDifference;

    lambdaHome =
      clamp(
        lambdaHome,
        0.30,
        3.30
      );

    lambdaAway =
      clamp(
        lambdaAway,
        0.25,
        3.10
      );

    const dc =
       dixonColesMarkets(
    lambdaHome,
    lambdaAway,
    config.rho,
    includeScores
  );
      );

    const elo =
      eloProbability(
        target,
        baseline,
        eloState,
        config
      );

    let probability = {
      home:
        (
          1 -
          config.eloBlend
        )
        *
        dc.home
        +
        config.eloBlend *
        elo.home,

      draw:
        (
          1 -
          config.eloBlend
        )
        *
        dc.draw
        +
        config.eloBlend *
        elo.draw,

      away:
        (
          1 -
          config.eloBlend
        )
        *
        dc.away
        +
        config.eloBlend *
        elo.away
    };

    const generalCoverage =
      clamp(
        Math.min(
          homeAll.played,
          awayAll.played
        )
        /
        8,
        0,
        1
      );

    const venueCoverage =
      clamp(
        Math.min(
          homeVenue.played,
          awayVenue.played
        )
        /
        5,
        0,
        1
      );

    const leagueCoverage =
      clamp(
        baseline.n /
        100,
        0,
        1
      );

    const quality =
      Math.round(
        25
        +
        35 *
        generalCoverage
        +
        25 *
        venueCoverage
        +
        15 *
        leagueCoverage
      );

    const priorBlend =
      clamp(
        config.priorBlend
        +
        (
          1 -
          quality / 100
        )
        *
        0.16,
        0.06,
        0.38
      );

    probability = {
      home:
        (
          1 -
          priorBlend
        )
        *
        probability.home
        +
        priorBlend *
        baseline
          .resultPrior
          .home,

      draw:
        (
          1 -
          priorBlend
        )
        *
        probability.draw
        +
        priorBlend *
        baseline
          .resultPrior
          .draw,

      away:
        (
          1 -
          priorBlend
        )
        *
        probability.away
        +
        priorBlend *
        baseline
          .resultPrior
          .away
    };

    const total =
      probability.home
      +
      probability.draw
      +
      probability.away;

    probability = {
      home:
        probability.home /
        total,

      draw:
        probability.draw /
        total,

      away:
        probability.away /
        total
    };

    probability =
      temperatureScale(
        probability,
        config.temperature
      );

    if (calibration) {
      probability =
        applyClassCalibration(
          probability,
          calibrationForLeague(
            calibration,
            target.competition
          )
        );
    }
    const scoreDistribution =

  includeScores

    ? alignScoreDistribution(
        dc.scoreDistribution,
        {
          home:
            dc.home,

          draw:
            dc.draw,

          away:
            dc.away
        },
        probability
      )

    : [];


const topScores =

  includeScores

    ? topExactScores(
        scoreDistribution,
        5
      )

    : [];


const mostLikelyScore =

  topScores.length

    ? topScores[0]

    : null;
    return {
      ...probability,

      over15:
        dc.over15,

      over25:
        dc.over25,

      btts:
        dc.btts,

      lambdaHome,
      lambdaAway,

      quality,

      eloHome:
        elo.homeRating,

      eloAway:
        elo.awayRating,

      sample: {
        homeAll:
          homeAll.played,

        awayAll:
          awayAll.played,

        homeVenue:
          homeVenue.played,

        awayVenue:
          awayVenue.played,

        league:
          baseline.n
      },

      baseline:
        baseline.resultPrior
    };
  }

  // ===================================================
  // PARAMÈTRES CANDIDATS — IDENTIQUES À V0.7
  // ===================================================

  function candidateConfigs() {
    return [
      {
        halfLife: 55,
        rho: -0.10,
        temperature: 1.04,
        venueShare: 0.52,
        shrink: 4,
        formImpact: 0.04,
        priorBlend: 0.14,
        eloBlend: 0.15,
        eloHomeAdv: 60,
        eloK: 20
      },

      {
        halfLife: 55,
        rho: -0.06,
        temperature: 1.06,
        venueShare: 0.58,
        shrink: 4,
        formImpact: 0.05,
        priorBlend: 0.14,
        eloBlend: 0.20,
        eloHomeAdv: 60,
        eloK: 20
      },

      {
        halfLife: 75,
        rho: -0.10,
        temperature: 1.04,
        venueShare: 0.52,
        shrink: 4,
        formImpact: 0.04,
        priorBlend: 0.16,
        eloBlend: 0.20,
        eloHomeAdv: 60,
        eloK: 20
      },

      {
        halfLife: 75,
        rho: -0.06,
        temperature: 1.06,
        venueShare: 0.58,
        shrink: 4,
        formImpact: 0.05,
        priorBlend: 0.16,
        eloBlend: 0.25,
        eloHomeAdv: 65,
        eloK: 20
      },

      {
        halfLife: 90,
        rho: -0.08,
        temperature: 1.04,
        venueShare: 0.50,
        shrink: 5,
        formImpact: 0.04,
        priorBlend: 0.16,
        eloBlend: 0.20,
        eloHomeAdv: 65,
        eloK: 18
      },

      {
        halfLife: 90,
        rho: -0.04,
        temperature: 1.08,
        venueShare: 0.58,
        shrink: 5,
        formImpact: 0.05,
        priorBlend: 0.18,
        eloBlend: 0.25,
        eloHomeAdv: 65,
        eloK: 18
      },

      {
        halfLife: 120,
        rho: -0.08,
        temperature: 1.05,
        venueShare: 0.50,
        shrink: 5,
        formImpact: 0.04,
        priorBlend: 0.18,
        eloBlend: 0.25,
        eloHomeAdv: 70,
        eloK: 18
      },

      {
        halfLife: 120,
        rho: -0.04,
        temperature: 1.08,
        venueShare: 0.56,
        shrink: 5,
        formImpact: 0.05,
        priorBlend: 0.18,
        eloBlend: 0.30,
        eloHomeAdv: 70,
        eloK: 18
      }
    ];
  }

  // ===================================================
  // BACKTEST / CALIBRATION
  // ===================================================

  function predictionRows(
    history,
    matchesToPredict,
    config,
    eloState,
    calibration = null
  ) {
    const rows = [];

    matchesToPredict.forEach(match => {
      const model =
        buildModel(
          history,
          match,
          matchTime(match),
          config,
          eloState,
          calibration
        );

      if (
        model.sample.homeAll < 4 ||
        model.sample.awayAll < 4 ||
        model.sample.league < 25
      ) {
        return;
      }

      if (
        ![
          '1',
          'N',
          '2'
        ].includes(
          match.actualResult
        )
      ) {
        return;
      }

      rows.push({
        match,
        model
      });
    });

    return rows;
  }

  function fitOneCalibration(
    rows
  ) {
    if (!rows.length) {
      return {
        home: 1,
        draw: 1,
        away: 1
      };
    }

    let predictedHome = 0;
    let predictedDraw = 0;
    let predictedAway = 0;

    let actualHome = 0;
    let actualDraw = 0;
    let actualAway = 0;

    rows.forEach(
      ({
        match,
        model
      }) => {
        predictedHome +=
          model.home;

        predictedDraw +=
          model.draw;

        predictedAway +=
          model.away;

        if (
          match.actualResult === '1'
        ) {
          actualHome += 1;
        }

        if (
          match.actualResult === 'N'
        ) {
          actualDraw += 1;
        }

        if (
          match.actualResult === '2'
        ) {
          actualAway += 1;
        }
      }
    );

    const n =
      rows.length;

    const factor =
      (
        actualRate,
        predictedRate
      ) =>
        clamp(
          actualRate
          /
          Math.max(
            0.05,
            predictedRate
          ),
          0.88,
          1.12
        );

    return {
      home:
        factor(
          actualHome / n,
          predictedHome / n
        ),

      draw:
        factor(
          actualDraw / n,
          predictedDraw / n
        ),

      away:
        factor(
          actualAway / n,
          predictedAway / n
        )
    };
  }

  function fitLeagueCalibrations(
    rows
  ) {
    const result = {
      GLOBAL:
        fitOneCalibration(
          rows
        )
    };

    MODEL_LEAGUES.forEach(
      league => {
        const leagueRows =
          rows.filter(
            row =>
              row
                .match
                .competition ===
              league
          );

        result[
          league
        ] =
          leagueRows.length >= 20
            ? fitOneCalibration(
                leagueRows
              )
            : result.GLOBAL;
      }
    );

    return result;
  }

  function evaluateRows(
    rows
  ) {
    if (!rows.length) {
      return {
        tested: 0,
        accuracy: null,
        brier: null,
        referenceBrier: null,
        byLeague: {}
      };
    }

    let correct = 0;
    let totalBrier = 0;
    let totalReference = 0;

    const buckets = {};

    rows.forEach(
      ({
        match,
        model
      }) => {
        const rowBrier =
          brier3(
            model,
            match.actualResult
          );

        const referenceBrier =
          brier3(
            model.baseline,
            match.actualResult
          );

        if (
          bestPick(model)
          ===
          match.actualResult
        ) {
          correct += 1;
        }

        totalBrier +=
          rowBrier;

        totalReference +=
          referenceBrier;

        const league =
          match.competition;

        if (
          !buckets[
            league
          ]
        ) {
          buckets[
            league
          ] = {
            tested: 0,
            correct: 0,
            brier: 0,
            reference: 0
          };
        }

        buckets[
          league
        ].tested += 1;

        buckets[
          league
        ].brier +=
          rowBrier;

        buckets[
          league
        ].reference +=
          referenceBrier;

        if (
          bestPick(model)
          ===
          match.actualResult
        ) {
          buckets[
            league
          ].correct += 1;
        }
      }
    );

    const byLeague = {};

    Object.entries(
      buckets
    )
      .forEach(
        (
          [
            league,
            item
          ]
        ) => {
          byLeague[
            league
          ] = {
            tested:
              item.tested,

            accuracy:
              item.correct
              /
              item.tested,

            brier:
              item.brier
              /
              item.tested,

            referenceBrier:
              item.reference
              /
              item.tested
          };
        }
      );

    return {
      tested:
        rows.length,

      accuracy:
        correct
        /
        rows.length,

      brier:
        totalBrier
        /
        rows.length,

      referenceBrier:
        totalReference
        /
        rows.length,

      byLeague
    };
  }

  function tuneModel(
    history
  ) {
    if (tuningCache) {
      return tuningCache;
    }

    const chronological =
      [...history]
        .filter(
          match =>
            MODEL_LEAGUES.has(
              match.competition
            )
        )
        .filter(
          match =>
            Number.isFinite(
              matchTime(match)
            )
        )
        .filter(
          match =>
            num(
              match?.score?.home
            ) !== null
            &&
            num(
              match?.score?.away
            ) !== null
        )
        .sort(
          (first, second) =>
            matchTime(first)
            -
            matchTime(second)
        );

    const splitIndex =
      Math.max(
        1,
        Math.floor(
          chronological.length
          *
          0.78
        )
      );

    const tuningMatches =
      chronological.slice(
        0,
        splitIndex
      );

    const holdoutMatches =
      chronological.slice(
        splitIndex
      );

    let winner = null;

    candidateConfigs()
      .forEach(
        config => {
          const eloState =
            buildEloTimeline(
              history,
              config
            );

          const rawRows =
            predictionRows(
              history,
              tuningMatches,
              config,
              eloState,
              null
            );

          if (
            rawRows.length < 40
          ) {
            return;
          }

          const calibration =
            fitLeagueCalibrations(
              rawRows
            );

          const calibratedRows =
            predictionRows(
              history,
              tuningMatches,
              config,
              eloState,
              calibration
            );

          const score =
            evaluateRows(
              calibratedRows
            );

          if (
            !winner
            ||
            score.brier
            <
            winner
              .score
              .brier
          ) {
            winner = {
              config,
              eloState,
              calibration,
              score
            };
          }
        }
      );

    if (!winner) {
      const config =
        candidateConfigs()[0];

      winner = {
        config,

        eloState:
          buildEloTimeline(
            history,
            config
          ),

        calibration: {
          GLOBAL: {
            home: 1,
            draw: 1,
            away: 1
          }
        },

        score: {
          tested: 0,
          brier: null
        }
      };
    }

    const holdoutRows =
      predictionRows(
        history,
        holdoutMatches,
        winner.config,
        winner.eloState,
        winner.calibration
      );

    const holdout =
      evaluateRows(
        holdoutRows
      );

    tuningCache = {
      ...winner,

      holdout,

      totalHistoricalMatches:
        chronological.length,

      targetReached:
        holdout.brier !== null
        &&
        holdout.brier
        <
        TARGET_BRIER
    };

    return tuningCache;
  }

  // ===================================================
  // PRÉDICTION SERVEUR
  // ===================================================

  function predictV07(
    history,
    match
  ) {
    resetTuningCache();

    const tuning =
      tuneModel(
        history
      );

    const model =
      buildModel(
        history,
        match,
        Infinity,
        tuning.config,
        tuning.eloState,
        tuning.calibration
      );

    return {
      model,

      validation: {
        totalHistoricalMatches:
          tuning.totalHistoricalMatches,

        holdout:
          tuning.holdout,

        targetReached:
          tuning.targetReached
      }
    };
  }

  // ===================================================
  // EXPORT SERVEUR
  // ===================================================

  if (IS_SERVER) {
    module.exports = {
      MODEL_VERSION,
      TARGET_BRIER,
      MODEL_LEAGUES,
      matchTime,
      buildModel,
      tuneModel,
      predictV07,
      resetTuningCache,
      brier3,
      bestPick
    };

    return;
  }

  // ===================================================
  // PARTIE NAVIGATEUR
  // ===================================================

  let historyPromise = null;

  async function loadHistory() {
    if (!historyPromise) {
      historyPromise =
        fetch(
          '/.netlify/functions/modelhistory?v=073',
          {
            cache: 'no-store'
          }
        )
          .then(
            async response => {
              let data = {};

              try {
                data =
                  await response.json();
              } catch (error) {
                throw new Error(
                  'Réponse modelhistory illisible.'
                );
              }

              if (!response.ok) {
                throw new Error(
                  data.details
                  ||
                  data.error
                  ||
                  `Erreur modelhistory ${response.status}`
                );
              }

              if (
                data.engineVersion !==
                MODEL_HISTORY_VERSION
              ) {
                throw new Error(
                  `Ancienne version modelhistory reçue (${data.engineVersion || 'inconnue'}). Recharge le site après le déploiement Netlify.`
                );
              }

              if (
                Number(data.days) !==
                365
              ) {
                throw new Error(
                  `Historique modèle incomplet : ${data.days ?? '—'} jours reçus au lieu de 365.`
                );
              }

              if (
                !Array.isArray(
                  data.matches
                )
              ) {
                throw new Error(
                  'modelhistory ne renvoie pas de liste de matchs.'
                );
              }

              return {
                matches:
                  data.matches,

                meta: {
                  count:
                    Number(
                      data.count
                    )
                    ||
                    data.matches.length,

                  chunks:
                    Number(
                      data.chunks
                    )
                    ||
                    0,

                  chunkDays:
                    Number(
                      data.chunkDays
                    )
                    ||
                    0,

                  leagues:
                    data.leagues
                    ||
                    {},

                  source:
                    data.source
                    ||
                    'inconnue'
                }
              };
            }
          );
    }

    return historyPromise;
  }

  // ===================================================
  // INTERFACE
  // ===================================================

  function updateMainUI(
    match,
    model
  ) {
    const set =
      (
        selector,
        value
      ) => {
        const element =
          document.querySelector(
            selector
          );

        if (element) {
          element.textContent =
            value;
        }
      };

    set(
      '#pHome',
      pct(
        model.home
      )
    );

    set(
      '#pDraw',
      pct(
        model.draw
      )
    );

    set(
      '#pAway',
      pct(
        model.away
      )
    );

    set(
      '#confidence',
      `${model.quality}%`
    );

    set(
      '#modelVersion',
      `Moteur ${MODEL_VERSION} • Dixon-Coles + Elo`
    );

    const probabilitySection =
      document
        .querySelector(
          '#pHome'
        )
        ?.closest(
          '.sports-section'
        );

    const probabilityLabel =
      probabilitySection
        ?.querySelector(
          '.section-label'
        );

    if (
      probabilityLabel
    ) {
      probabilityLabel.textContent =
        'PROBABILITÉS DU MODÈLE V0.7';
    }

    match.probs = {
      home:
        model.home * 100,

      draw:
        model.draw * 100,

      away:
        model.away * 100
    };

    const badge =
      document.querySelector(
        '#qualityBadge'
      );

    if (badge) {
      badge.textContent =
        `QUALITÉ DONNÉES ${model.quality}%`;

      badge.className =
        `pill ${
          model.quality >= 70
            ? 'success'
            : 'warn'
        }`;
    }

    const markets =
      document.querySelector(
        '#marketList'
      );

    if (markets) {
      markets.innerHTML = `
        <div class="market">
          <div>
            <strong>
              +1,5 buts
            </strong>
            <p>
              Probabilité ${MODEL_VERSION}
            </p>
          </div>
          <div class="market-prob">
            <b>
              ${pct(model.over15)}
            </b>
          </div>
        </div>

        <div class="market">
          <div>
            <strong>
              +2,5 buts
            </strong>
            <p>
              Probabilité ${MODEL_VERSION}
            </p>
          </div>
          <div class="market-prob">
            <b>
              ${pct(model.over25)}
            </b>
          </div>
        </div>

        <div class="market">
          <div>
            <strong>
              Les deux marquent
            </strong>
            <p>
              BTTS
            </p>
          </div>
          <div class="market-prob">
            <b>
              ${pct(model.btts)}
            </b>
          </div>
        </div>

        <div class="market">
          <div>
            <strong>
              Buts attendus modèle
            </strong>
            <p>
              ${match.home}
              /
              ${match.away}
            </p>
          </div>
          <div class="market-prob">
            <b>
              ${model.lambdaHome.toFixed(2)}
              -
              ${model.lambdaAway.toFixed(2)}
            </b>
          </div>
        </div>

        <div class="market">
          <div>
            <strong>
              Rating Elo
            </strong>
            <p>
              Force historique
            </p>
          </div>
          <div class="market-prob">
            <b>
              ${Math.round(model.eloHome)}
              -
              ${Math.round(model.eloAway)}
            </b>
          </div>
        </div>
      `;
    }
  }

  async function waitForPreanalysis() {
    for (
      let index = 0;
      index < 50;
      index += 1
    ) {
      const panel =
        document.querySelector(
          '#preMatchInsights .preanalysis-panel'
        );

      if (panel) {
        return panel;
      }

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            100
          )
      );
    }

    return document.querySelector(
      '#preMatchInsights .panel-card'
    );
  }

  function leagueName(
    code
  ) {
    if (code === 'PL') {
      return 'Premier League';
    }

    if (code === 'BL') {
      return 'Bundesliga';
    }

    if (code === 'LL') {
      return 'La Liga';
    }

    return code;
  }

  async function renderValidation(
    model,
    tuning,
    meta
  ) {
    const panel =
      await waitForPreanalysis();

    if (!panel) {
      return;
    }

    panel
      .querySelector(
        '.model-validation-card'
      )
      ?.remove();

    const footnote =
      panel.querySelector(
        '.pre-footnote'
      );

    if (footnote) {
      footnote.textContent =
        'Ces statistiques alimentent le modèle probabiliste V0.7. La qualité mesure la quantité de données disponibles, pas la certitude du résultat.';
    }

    const holdout =
      tuning.holdout;

    const targetText =
      tuning.targetReached
        ? 'OBJECTIF < 0,620 ATTEINT'
        : 'OBJECTIF < 0,620 PAS ENCORE ATTEINT';

    const targetColor =
      tuning.targetReached
        ? 'var(--green)'
        : 'var(--yellow)';

    let gain = null;

    if (
      holdout.brier !== null
      &&
      holdout.referenceBrier !== null
      &&
      holdout.referenceBrier > 0
    ) {
      gain =
        (
          (
            holdout.referenceBrier
            -
            holdout.brier
          )
          /
          holdout.referenceBrier
        )
        *
        100;
    }

    const leagueRows =
      Object.entries(
        holdout.byLeague
        ||
        {}
      )
        .map(
          (
            [
              league,
              item
            ]
          ) => `
            <div class="pre-stat">
              <span>
                ${leagueName(league)}
                •
                ${item.tested}
                matchs
              </span>

              <strong>
                ${item.brier.toFixed(3)}
              </strong>

              <small>
                1N2 :
                ${pct(item.accuracy)}
              </small>
            </div>
          `
        )
        .join('');

    const card =
      document.createElement(
        'div'
      );

    card.className =
      'model-validation-card';

    card.innerHTML = `
      <div
        style="
          margin-top:12px;
          padding:11px;
          border:1px solid rgba(0,232,107,.30);
          border-radius:8px;
          background:#071009;
        "
      >
        <div
          style="
            display:flex;
            justify-content:space-between;
            gap:8px;
            align-items:center;
          "
        >
          <strong
            style="
              font-size:10px;
              color:var(--green);
            "
          >
            PROBABILITÉS V0.7
          </strong>

          <span
            style="
              font-size:8px;
              color:var(--muted);
            "
          >
            QUALITÉ ${model.quality}%
          </span>
        </div>

        <div
          class="pre-stat-grid"
          style="margin-top:8px"
        >
          <div class="pre-stat">
            <span>
              1
            </span>

            <strong>
              ${pct(model.home)}
            </strong>
          </div>

          <div class="pre-stat">
            <span>
              N
            </span>

            <strong>
              ${pct(model.draw)}
            </strong>
          </div>

          <div class="pre-stat">
            <span>
              2
            </span>

            <strong>
              ${pct(model.away)}
            </strong>
          </div>

          <div class="pre-stat">
            <span>
              Buts attendus
            </span>

            <strong>
              ${model.lambdaHome.toFixed(2)}
              -
              ${model.lambdaAway.toFixed(2)}
            </strong>
          </div>

          <div class="pre-stat">
            <span>
              Elo domicile
            </span>

            <strong>
              ${Math.round(model.eloHome)}
            </strong>
          </div>

          <div class="pre-stat">
            <span>
              Elo extérieur
            </span>

            <strong>
              ${Math.round(model.eloAway)}
            </strong>
          </div>
        </div>
      </div>

      <div
        style="
          margin-top:9px;
          padding:11px;
          border:1px solid var(--line);
          border-radius:8px;
          background:#071009;
        "
      >
        <div
          style="
            display:flex;
            justify-content:space-between;
            gap:8px;
            align-items:flex-start;
          "
        >
          <strong
            style="
              font-size:10px;
              color:var(--cyan);
            "
          >
            VALIDATION INDÉPENDANTE V0.7
          </strong>

          <span
            style="
              font-size:8px;
              color:${targetColor};
              text-align:right;
            "
          >
            ${targetText}
          </span>
        </div>

        ${
          holdout.tested

            ? `
              <div
                class="pre-stat-grid"
                style="margin-top:8px"
              >
                <div class="pre-stat">
                  <span>
                    Matchs holdout
                  </span>

                  <strong>
                    ${holdout.tested}
                  </strong>
                </div>

                <div class="pre-stat">
                  <span>
                    1N2 correct
                  </span>

                  <strong>
                    ${pct(
                      holdout.accuracy
                    )}
                  </strong>
                </div>

                <div class="pre-stat">
                  <span>
                    Brier V0.7
                  </span>

                  <strong>
                    ${holdout.brier.toFixed(3)}
                  </strong>
                </div>

                <div class="pre-stat">
                  <span>
                    Brier référence
                  </span>

                  <strong>
                    ${holdout.referenceBrier.toFixed(3)}
                  </strong>
                </div>

                <div class="pre-stat">
                  <span>
                    Historique modèle
                  </span>

                  <strong>
                    ${meta.count}
                  </strong>

                  <small>
                    ${
                      meta.source ===
                      'supabase'

                        ? 'Base MatchScope / Supabase'

                        : `${meta.chunks} blocs de ${meta.chunkDays} jours max`
                    }
                  </small>
                </div>

                <div class="pre-stat">
                  <span>
                    Gain Brier
                  </span>

                  <strong>
                    ${
                      gain === null

                        ? '—'

                        : `${
                            gain >= 0
                              ? '+'
                              : ''
                          }${gain.toFixed(1)}%`
                    }
                  </strong>
                </div>
              </div>

              <div
                style="
                  margin-top:12px;
                  padding-top:10px;
                  border-top:1px solid var(--line);
                "
              >
                <strong
                  style="
                    font-size:9px;
                    color:white;
                  "
                >
                  PERFORMANCE PAR CHAMPIONNAT
                </strong>

                <div
                  class="pre-stat-grid"
                  style="margin-top:8px"
                >
                  ${
                    leagueRows

                    ||

                    `
                      <div class="pre-stat">
                        <span>
                          Données
                        </span>

                        <strong>
                          —
                        </strong>
                      </div>
                    `
                  }
                </div>
              </div>

              <p
                style="
                  font-size:8px;
                  color:var(--muted);
                  line-height:1.5;
                  margin:10px 0 0;
                "
              >
                Les paramètres sont choisis sur la partie ancienne de l'historique.
                Les matchs holdout les plus récents ne servent pas au réglage.
                C'est leur Brier qui permet de contrôler objectivement V0.7.
              </p>
            `

            : `
              <p
                style="
                  font-size:8px;
                  color:var(--muted);
                  line-height:1.5;
                  margin:10px 0 0;
                "
              >
                Pas encore assez de matchs pour constituer le holdout.
              </p>
            `
        }
      </div>
    `;

    panel.appendChild(
      card
    );
  }

  async function showModelError(
    error
  ) {
    const panel =
      await waitForPreanalysis();

    if (!panel) {
      return;
    }

    panel
      .querySelector(
        '.model-validation-card'
      )
      ?.remove();

    const warning =
      document.createElement(
        'div'
      );

    warning.className =
      'pre-warning model-validation-card';

    warning.textContent =
      `Erreur moteur V0.7 : ${error?.message || error}`;

    panel.appendChild(
      warning
    );
  }

  // ===================================================
  // EXÉCUTION NAVIGATEUR
  // ===================================================

  async function runForMatch(
    match
  ) {
    if (
      !MODEL_LEAGUES.has(
        match.competition
      )
    ) {
      return;
    }

    try {
      const historyData =
        await loadHistory();

      const history =
        historyData.matches;

      if (!history.length) {
        throw new Error(
          'Historique modèle vide.'
        );
      }

      const tuning =
        tuneModel(
          history
        );

      const model =
        buildModel(
          history,
          match,
          Infinity,
          tuning.config,
          tuning.eloState,
          tuning.calibration
        );

      updateMainUI(
        match,
        model
      );

      await renderValidation(
        model,
        tuning,
        historyData.meta
      );

    } catch (error) {
      console.error(
        'MatchScope V0.7 :',
        error
      );

      await showModelError(
        error
      );
    }
  }

  // ===================================================
  // BOUTON ANALYSER
  // ===================================================

  openAnalysis =
    function (
      id
    ) {
      previousOpenAnalysis(
        id
      );

      if (
        typeof currentMode !==
        'undefined'
        &&
        currentMode !==
        'live'
      ) {
        return;
      }

      if (
        typeof matches ===
        'undefined'
      ) {
        return;
      }

      const match =
        matches.find(
          item =>
            String(
              item.id
            )
            ===
            String(
              id
            )
        );

      if (!match) {
        return;
      }

      runForMatch(
        match
      );
    };

})();
