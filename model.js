// =============================================================
// MATCHSCOPE AI — V0.7
// Dixon-Coles + Elo + calibration chronologique
// CommonJS / Netlify Functions
// + distribution des scores exacts (0-0 à 8-8)
// =============================================================

const MODEL_VERSION = 'v0.7';
const TARGET_BRIER = 0.620;
const MODEL_LEAGUES = new Set(['BL', 'LL', 'PL']);

let tuningCache = null;

function resetTuningCache() {
  tuningCache = null;
}

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

function matchTime(match) {
  if (match?.startingAt) {
    const parsed = Date.parse(match.startingAt);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const timestamp =
    Number(match?.kickoffTs);

  return Number.isFinite(timestamp)
    ? timestamp
    : null;
}

function actualVector(result) {
  return {
    home:
      result === '1'
        ? 1
        : 0,

    draw:
      result === 'N'
        ? 1
        : 0,

    away:
      result === '2'
        ? 1
        : 0
  };
}

function brier3(
  probability,
  result
) {
  const actual =
    actualVector(result);

  return (
    Math.pow(
      probability.home -
      actual.home,
      2
    )
    +
    Math.pow(
      probability.draw -
      actual.draw,
      2
    )
    +
    Math.pow(
      probability.away -
      actual.away,
      2
    )
  );
}

function bestPick(
  probability
) {
  return [
    [
      '1',
      probability.home
    ],
    [
      'N',
      probability.draw
    ],
    [
      '2',
      probability.away
    ]
  ]
    .sort(
      (
        first,
        second
      ) =>
        second[1] -
        first[1]
    )[0][0];
}


// =============================================================
// HISTORIQUE
// =============================================================

function leagueMatchesBefore(
  history,
  competition,
  beforeTime = Infinity
) {
  return history.filter(
    match => {

      if (
        match.competition !==
        competition
      ) {
        return false;
      }

      const timestamp =
        matchTime(match);

      if (
        !Number.isFinite(
          timestamp
        )
      ) {
        return false;
      }

      if (
        Number.isFinite(
          beforeTime
        )
        &&
        timestamp >=
        beforeTime
      ) {
        return false;
      }

      return (
        num(
          match?.score?.home
        ) !== null
        &&
        num(
          match?.score?.away
        ) !== null
      );
    }
  );
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

    .filter(
      match => {

        if (
          match.competition !==
          competition
        ) {
          return false;
        }

        if (
          excludeId !== null
          &&
          String(match.id) ===
          String(excludeId)
        ) {
          return false;
        }

        const timestamp =
          matchTime(match);

        if (
          !Number.isFinite(
            timestamp
          )
        ) {
          return false;
        }

        if (
          Number.isFinite(
            beforeTime
          )
          &&
          timestamp >=
          beforeTime
        ) {
          return false;
        }

        const isHome =
          sameTeam(
            match.home,
            team
          );

        const isAway =
          sameTeam(
            match.away,
            team
          );

        if (
          venue ===
          'home'
        ) {
          return isHome;
        }

        if (
          venue ===
          'away'
        ) {
          return isAway;
        }

        return (
          isHome ||
          isAway
        );
      }
    )

    .sort(
      (
        first,
        second
      ) =>
        (
          matchTime(second)
          ||
          0
        )
        -
        (
          matchTime(first)
          ||
          0
        )
    )

    .slice(
      0,
      limit
    );
}


// =============================================================
// PONDÉRATION TEMPORELLE
// =============================================================

function timeWeight(
  matchTimestamp,
  referenceTimestamp,
  halfLife
) {
  if (
    !Number.isFinite(
      matchTimestamp
    )
    ||
    !Number.isFinite(
      referenceTimestamp
    )
  ) {
    return 1;
  }

  const ageDays =
    Math.max(
      0,
      (
        referenceTimestamp -
        matchTimestamp
      )
      /
      86400000
    );

  return Math.exp(
    -Math.log(2)
    *
    ageDays
    /
    halfLife
  );
}


// =============================================================
// RÉSUMÉ ÉQUIPE
// =============================================================

function weightedSummary(
  list,
  team,
  referenceTimestamp,
  halfLife
) {
  const result = {

    played:
      0,

    weight:
      0,

    points:
      0,

    gf:
      0,

    ga:
      0
  };


  list.forEach(
    match => {

      const isHome =
        sameTeam(
          match.home,
          team
        );


      const goalsFor =
        num(
          isHome

            ? match
                ?.score
                ?.home

            : match
                ?.score
                ?.away
        );


      const goalsAgainst =
        num(
          isHome

            ? match
                ?.score
                ?.away

            : match
                ?.score
                ?.home
        );


      if (
        goalsFor === null
        ||
        goalsAgainst ===
        null
      ) {
        return;
      }


      const weight =
        timeWeight(
          matchTime(
            match
          ),
          referenceTimestamp,
          halfLife
        );


      const points =

        goalsFor >
        goalsAgainst

          ? 3

          : goalsFor ===
            goalsAgainst

            ? 1

            : 0;


      result.played +=
        1;

      result.weight +=
        weight;

      result.points +=
        points *
        weight;

      result.gf +=
        goalsFor *
        weight;

      result.ga +=
        goalsAgainst *
        weight;
    }
  );


  return result;
}


// =============================================================
// MOYENNES CHAMPIONNAT
// =============================================================

function leagueBaseline(
  history,
  competition,
  beforeTime,
  halfLife
) {
  const list =
    leagueMatchesBefore(
      history,
      competition,
      beforeTime
    );


  const referenceTimestamp =

    Number.isFinite(
      beforeTime
    )

      ? beforeTime

      : Date.now();


  let totalWeight =
    0;

  let homeGoals =
    0;

  let awayGoals =
    0;

  let homeWins =
    0;

  let draws =
    0;

  let awayWins =
    0;


  list.forEach(
    match => {

      const home =
        num(
          match
            ?.score
            ?.home
        );


      const away =
        num(
          match
            ?.score
            ?.away
        );


      if (
        home === null
        ||
        away === null
      ) {
        return;
      }


      const weight =
        timeWeight(
          matchTime(
            match
          ),
          referenceTimestamp,
          Math.max(
            90,
            halfLife *
            2
          )
        );


      totalWeight +=
        weight;


      homeGoals +=
        home *
        weight;


      awayGoals +=
        away *
        weight;


      if (
        home >
        away
      ) {

        homeWins +=
          weight;

      } else if (
        home ===
        away
      ) {

        draws +=
          weight;

      } else {

        awayWins +=
          weight;
      }
    }
  );


  const goalPriorWeight =
    16;


  const resultPriorWeight =
    26;


  return {

    n:
      list.length,


    homeGoalAvg:

      (
        homeGoals
        +
        goalPriorWeight *
        1.45
      )

      /

      (
        totalWeight
        +
        goalPriorWeight
      ),


    awayGoalAvg:

      (
        awayGoals
        +
        goalPriorWeight *
        1.15
      )

      /

      (
        totalWeight
        +
        goalPriorWeight
      ),


    resultPrior: {

      home:

        (
          homeWins
          +
          resultPriorWeight *
          0.44
        )

        /

        (
          totalWeight
          +
          resultPriorWeight
        ),


      draw:

        (
          draws
          +
          resultPriorWeight *
          0.28
        )

        /

        (
          totalWeight
          +
          resultPriorWeight
        ),


      away:

        (
          awayWins
          +
          resultPriorWeight *
          0.28
        )

        /

        (
          totalWeight
          +
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

    weightedSum
    +
    shrinkWeight *
    prior

  )

  /

  (

    weight
    +
    shrinkWeight

  );
}


// =============================================================
// POISSON / DIXON-COLES
// =============================================================

function poisson(
  lambda,
  goals
) {
  let factorial =
    1;


  for (
    let index = 2;
    index <= goals;
    index += 1
  ) {

    factorial *=
      index;
  }


  return (

    Math.exp(
      -lambda
    )

    *

    Math.pow(
      lambda,
      goals
    )

    /

    factorial
  );
}


function dcTau(
  homeGoals,
  awayGoals,
  lambdaHome,
  lambdaAway,
  rho
) {

  if (
    homeGoals === 0
    &&
    awayGoals === 0
  ) {

    return Math.max(
      0.01,
      1
      -
      lambdaHome *
      lambdaAway *
      rho
    );
  }


  if (
    homeGoals === 1
    &&
    awayGoals === 0
  ) {

    return Math.max(
      0.01,
      1
      +
      lambdaAway *
      rho
    );
  }


  if (
    homeGoals === 0
    &&
    awayGoals === 1
  ) {

    return Math.max(
      0.01,
      1
      +
      lambdaHome *
      rho
    );
  }


  if (
    homeGoals === 1
    &&
    awayGoals === 1
  ) {

    return Math.max(
      0.01,
      1 -
      rho
    );
  }


  return 1;
}


// =============================================================
// MATRICE DE SCORES EXACTS
// =============================================================

function dixonColesMarkets(
  lambdaHome,
  lambdaAway,
  rho,
  includeScores = false
) {

  let home =
    0;

  let draw =
    0;

  let away =
    0;

  let over15 =
    0;

  let over25 =
    0;

  let btts =
    0;

  let probabilityMass =
    0;


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
        awayGoals >=
        2
      ) {

        over15 +=
          probability;
      }


      if (
        homeGoals +
        awayGoals >=
        3
      ) {

        over25 +=
          probability;
      }


      if (
        homeGoals > 0
        &&
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


/*
  La matrice Dixon-Coles donne naturellement
  une distribution de scores.

  V0.7 mélange ensuite Dixon-Coles avec Elo,
  le prior championnat, la température
  et la calibration.

  Nous réalignons donc les scores pour que :

  somme(scores victoire domicile) = P(1)
  somme(scores nul)               = P(N)
  somme(scores victoire extérieur)= P(2)

  Ainsi le score exact reste cohérent
  avec les probabilités finales V0.7.
*/

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
      score => ({

        homeGoals:
          score.homeGoals,

        awayGoals:
          score.awayGoals,

        probability:

          score.probability

          *

          ratios[
            scoreOutcome(
              score
            )
          ]
      })
    );


  const total =

    adjusted.reduce(
      (
        sum,
        score
      ) =>

        sum
        +
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


// =============================================================
// ELO
// =============================================================

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
            matchTime(
              match
            )
          )
      )

      .sort(
        (
          first,
          second
        ) =>

          matchTime(
            first
          )

          -

          matchTime(
            second
          )
      );


  const getRating =

    key =>

      ratings.has(
        key
      )

        ? ratings.get(
            key
          )

        : 1500;


  chronological.forEach(
    match => {

      const homeKey =
        teamKey(
          match.competition,
          match.home
        );


      const awayKey =
        teamKey(
          match.competition,
          match.away
        );


      const homeRating =
        getRating(
          homeKey
        );


      const awayRating =
        getRating(
          awayKey
        );


      preMatch.set(
        String(
          match.id
        ),
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
          match
            ?.score
            ?.home
        );


      const awayGoals =
        num(
          match
            ?.score
            ?.away
        );


      if (
        homeGoals === null
        ||
        awayGoals === null
      ) {

        return;
      }


      const actualHome =

        homeGoals >
        awayGoals

          ? 1

          : homeGoals ===
            awayGoals

            ? 0.5

            : 0;


      const goalDifference =
        Math.abs(
          homeGoals -
          awayGoals
        );


      const marginMultiplier =

        goalDifference <=
        1

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
    }
  );


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

    eloState
      .preMatch
      .get(
        String(
          target.id
        )
      );


  let homeRating;

  let awayRating;


  if (
    snapshot
  ) {

    homeRating =
      snapshot.homeRating;

    awayRating =
      snapshot.awayRating;

  } else {

    homeRating =

      eloState
        .ratings
        .get(
          teamKey(
            target.competition,
            target.home
          )
        )

      ??

      1500;


    awayRating =

      eloState
        .ratings
        .get(
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
    1 -
    draw;


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


// =============================================================
// TEMPÉRATURE / CALIBRATION
// =============================================================

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
      1 /
      temp
    );


  const draw =

    Math.pow(
      Math.max(
        1e-9,
        probability.draw
      ),
      1 /
      temp
    );


  const away =

    Math.pow(
      Math.max(
        1e-9,
        probability.away
      ),
      1 /
      temp
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
      home:
        1,

      draw:
        1,

      away:
        1
    }
  );
}


// =============================================================
// MODÈLE V0.7
// =============================================================

function buildModel(
  history,
  target,
  beforeTime,
  config,
  eloState,
  calibration = null,

  /*
   * TRUE par défaut :
   * prediction.js recevra les scores exacts.
   *
   * Le backtest passe explicitement FALSE,
   * afin de ne pas alourdir les milliers
   * de calculs de calibration.
   */
  includeScores = true
) {

  const referenceTimestamp =

    Number.isFinite(
      beforeTime
    )

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

      baseline.n

      /

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
        quality /
        100
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

      probability.home

      /

      total,


    draw:

      probability.draw

      /

      total,


    away:

      probability.away

      /

      total
  };


  probability =

    temperatureScale(
      probability,
      config.temperature
    );


  if (
    calibration
  ) {

    probability =

      applyClassCalibration(
        probability,
        calibrationForLeague(
          calibration,
          target.competition
        )
      );
  }


  /*
   * Ici on reconstruit les probabilités
   * des scores exacts en restant cohérent
   * avec le 1N2 final calibré.
   */

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


    mostLikelyScore,


    topScores,


    scoreDistribution,


    scoreModel: {

      method:
        'DIXON_COLES_ALIGNED_TO_V07_1N2',

      maxGoalsPerTeam:
        8
    },


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


// =============================================================
// CONFIGURATIONS V0.7
// =============================================================

function candidateConfigs() {

  return [

    {
      halfLife:
        55,

      rho:
        -0.10,

      temperature:
        1.04,

      venueShare:
        0.52,

      shrink:
        4,

      formImpact:
        0.04,

      priorBlend:
        0.14,

      eloBlend:
        0.15,

      eloHomeAdv:
        60,

      eloK:
        20
    },


    {
      halfLife:
        55,

      rho:
        -0.06,

      temperature:
        1.06,

      venueShare:
        0.58,

      shrink:
        4,

      formImpact:
        0.05,

      priorBlend:
        0.14,

      eloBlend:
        0.20,

      eloHomeAdv:
        60,

      eloK:
        20
    },


    {
      halfLife:
        75,

      rho:
        -0.10,

      temperature:
        1.04,

      venueShare:
        0.52,

      shrink:
        4,

      formImpact:
        0.04,

      priorBlend:
        0.16,

      eloBlend:
        0.20,

      eloHomeAdv:
        60,

      eloK:
        20
    },


    {
      halfLife:
        75,

      rho:
        -0.06,

      temperature:
        1.06,

      venueShare:
        0.58,

      shrink:
        4,

      formImpact:
        0.05,

      priorBlend:
        0.16,

      eloBlend:
        0.25,

      eloHomeAdv:
        65,

      eloK:
        20
    },


    {
      halfLife:
        90,

      rho:
        -0.08,

      temperature:
        1.04,

      venueShare:
        0.50,

      shrink:
        5,

      formImpact:
        0.04,

      priorBlend:
        0.16,

      eloBlend:
        0.20,

      eloHomeAdv:
        65,

      eloK:
        18
    },


    {
      halfLife:
        90,

      rho:
        -0.04,

      temperature:
        1.08,

      venueShare:
        0.58,

      shrink:
        5,

      formImpact:
        0.05,

      priorBlend:
        0.18,

      eloBlend:
        0.25,

      eloHomeAdv:
        65,

      eloK:
        18
    },


    {
      halfLife:
        120,

      rho:
        -0.08,

      temperature:
        1.05,

      venueShare:
        0.50,

      shrink:
        5,

      formImpact:
        0.04,

      priorBlend:
        0.18,

      eloBlend:
        0.25,

      eloHomeAdv:
        70,

      eloK:
        18
    },


    {
      halfLife:
        120,

      rho:
        -0.04,

      temperature:
        1.08,

      venueShare:
        0.56,

      shrink:
        5,

      formImpact:
        0.05,

      priorBlend:
        0.18,

      eloBlend:
        0.30,

      eloHomeAdv:
        70,

      eloK:
        18
    }
  ];
}


// =============================================================
// BACKTEST
// =============================================================

function predictionRows(
  history,
  matchesToPredict,
  config,
  eloState,
  calibration = null
) {

  const rows =
    [];


  matchesToPredict.forEach(
    match => {

      /*
       * IMPORTANT :
       * false = on ne calcule pas les 81 scores
       * pendant les milliers d'itérations de tuning.
       */

      const model =

        buildModel(
          history,
          match,
          matchTime(
            match
          ),
          config,
          eloState,
          calibration,
          false
        );


      if (
        model
          .sample
          .homeAll <
        4

        ||

        model
          .sample
          .awayAll <
        4

        ||

        model
          .sample
          .league <
        25
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
    }
  );


  return rows;
}


// =============================================================
// CALIBRATION
// =============================================================

function fitOneCalibration(
  rows
) {

  if (
    !rows.length
  ) {

    return {

      home:
        1,

      draw:
        1,

      away:
        1
    };
  }


  let predictedHome =
    0;

  let predictedDraw =
    0;

  let predictedAway =
    0;


  let actualHome =
    0;

  let actualDraw =
    0;

  let actualAway =
    0;


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
        match.actualResult ===
        '1'
      ) {

        actualHome +=
          1;
      }


      if (
        match.actualResult ===
        'N'
      ) {

        actualDraw +=
          1;
      }


      if (
        match.actualResult ===
        '2'
      ) {

        actualAway +=
          1;
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
        actualHome /
        n,
        predictedHome /
        n
      ),


    draw:

      factor(
        actualDraw /
        n,
        predictedDraw /
        n
      ),


    away:

      factor(
        actualAway /
        n,
        predictedAway /
        n
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

        leagueRows.length >=
        20

          ? fitOneCalibration(
              leagueRows
            )

          : result.GLOBAL;
    }
  );


  return result;
}


// =============================================================
// ÉVALUATION
// =============================================================

function evaluateRows(
  rows
) {

  if (
    !rows.length
  ) {

    return {

      tested:
        0,

      accuracy:
        null,

      brier:
        null,

      referenceBrier:
        null,

      byLeague:
        {}
    };
  }


  let correct =
    0;

  let totalBrier =
    0;

  let totalReference =
    0;


  const buckets =
    {};


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
        bestPick(
          model
        )
        ===
        match.actualResult
      ) {

        correct +=
          1;
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

          tested:
            0,

          correct:
            0,

          brier:
            0,

          reference:
            0
        };
      }


      buckets[
        league
      ].tested +=
        1;


      buckets[
        league
      ].brier +=
        rowBrier;


      buckets[
        league
      ].reference +=
        referenceBrier;


      if (
        bestPick(
          model
        )
        ===
        match.actualResult
      ) {

        buckets[
          league
        ].correct +=
          1;
      }
    }
  );


  const byLeague =
    {};


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

            item.correct /
            item.tested,

          brier:

            item.brier /
            item.tested,

          referenceBrier:

            item.reference /
            item.tested
        };
      }
    );


  return {

    tested:
      rows.length,


    accuracy:

      correct /
      rows.length,


    brier:

      totalBrier /
      rows.length,


    referenceBrier:

      totalReference /
      rows.length,


    byLeague
  };
}


// =============================================================
// TUNING V0.7
// =============================================================

function tuneModel(
  history
) {

  if (
    tuningCache
  ) {

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
            matchTime(
              match
            )
          )
      )

      .filter(
        match =>
          num(
            match
              ?.score
              ?.home
          ) !== null

          &&

          num(
            match
              ?.score
              ?.away
          ) !== null
      )

      .sort(
        (
          first,
          second
        ) =>

          matchTime(
            first
          )

          -

          matchTime(
            second
          )
      );


  const splitIndex =

    Math.max(

      1,

      Math.floor(
        chronological.length *
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


  let winner =
    null;


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
          rawRows.length <
          40
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

          score.brier <
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


  if (
    !winner
  ) {

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

          home:
            1,

          draw:
            1,

          away:
            1
        }
      },


      score: {

        tested:
          0,

        brier:
          null
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

      holdout.brier !==
      null

      &&

      holdout.brier <
      TARGET_BRIER
  };


  return tuningCache;
}


// =============================================================
// PRÉDICTION COMPLÈTE
// =============================================================

function predictV07(
  history,
  match,
  includeScores = true
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
      tuning.calibration,
      includeScores
    );


  return {

    model,


    validation: {

      totalHistoricalMatches:
        tuning
          .totalHistoricalMatches,


      holdout:
        tuning.holdout,


      targetReached:
        tuning.targetReached
    }
  };
}


// =============================================================
// EXPORTS COMMONJS
// =============================================================

module.exports = {

  MODEL_VERSION,

  TARGET_BRIER,

  MODEL_LEAGUES,

  matchTime,

  buildModel,

  buildEloTimeline,

  tuneModel,

  predictV07,

  resetTuningCache,

  brier3,

  bestPick
};
