const {
  supabaseRequest
} = require('./lib/supabase');


const {
  tuneModel,
  buildModel,
  resetTuningCache,
  brier3,
  bestPick
} = require('./lib/model-v07');


// =====================================================
// MATCHSCOPE — V0.8 ROLLING LAB
//
// OBJECTIF
//
// Vérifier si les gains observés sont reproductibles
// sur PLUSIEURS périodes chronologiques.
//
// IMPORTANT
//
// - V0.7 reste inchangée.
// - Les derniers holdouts PRELINEUP / FINAL ne sont
//   PAS réutilisés pour sélectionner les modèles.
// - Le rolling utilise uniquement les données de
//   développement antérieures aux holdouts finaux.
// =====================================================


const FEATURE_VERSION =
  'features-v1';


const ROLLING_VERSION =
  'v0.8-rolling';


const PAGE_SIZE =
  1000;


const GLOBAL_SPLIT =
  0.78;


const INNER_SPLIT =
  0.80;


const MIN_SAMPLE =
  5;


const ROLLING_FOLDS =
  4;


/*
 * Environ la première moitié du dataset de développement
 * constitue le premier bloc d'apprentissage.
 *
 * La seconde moitié est découpée en 4 fenêtres de test.
 */
const INITIAL_TRAIN_RATIO =
  0.50;


const MIN_ROLLING_TRAIN =
  60;


const MIN_ROLLING_TEST =
  10;


// =====================================================
// CANDIDATS
//
// On ne reteste PAS toutes les variables.
//
// On conserve uniquement les pistes intéressantes
// découvertes lors du premier laboratoire.
// =====================================================

const CANDIDATES = [

  {
    stage:
      'PRELINEUP',

    family:
      'DOMICILE_EXTERIEUR',

    variables: [

      'venue_ppg_adv',

      'venue_attack_adv',

      'venue_defence_adv'
    ]
  },


  {
    stage:
      'FINAL',

    family:
      'COMPOSITION_XI',

    variables: [

      'xi_continuity_adv',

      'changes_adv',

      'regulars_adv',

      'overlap_adv',

      'historical_continuity_adv'
    ]
  },


  {
    stage:
      'FINAL',

    family:
      'FINAL_COMPLET',

    variables: [

      'form_ppg_adv',

      'form_attack_adv',

      'form_defence_adv',

      'venue_ppg_adv',

      'venue_attack_adv',

      'venue_defence_adv',

      'rest_adv',

      'congestion_adv',

      'xi_continuity_adv',

      'changes_adv',

      'regulars_adv',

      'overlap_adv',

      'historical_continuity_adv',

      'goalkeeper_adv',

      'defence_adv',

      'midfield_adv',

      'attack_adv',

      'home_formation_changed',

      'away_formation_changed'
    ]
  }

];


const L2_VALUES = [

  0.001,

  0.003,

  0.01,

  0.03,

  0.1
];


// =====================================================
// OUTILS
// =====================================================

function array(
  value
) {

  return Array.isArray(
    value
  )
    ? value
    : [];
}


function numberOrNull(
  value
) {

  if (
    value === null
    ||
    value === undefined
    ||
    value === ''
  ) {

    return null;
  }


  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}


function round(
  value,
  decimals = 8
) {

  const number =
    Number(
      value
    );


  if (
    !Number.isFinite(
      number
    )
  ) {

    return null;
  }


  const factor =
    Math.pow(
      10,
      decimals
    );


  return (
    Math.round(
      number *
      factor
    )
    /
    factor
  );
}


function parseKickoff(
  value
) {

  if (
    !value
  ) {

    return null;
  }


  const raw =
    String(
      value
    ).trim();


  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
      .test(
        raw
      )
  ) {

    return new Date(

      raw.replace(
        ' ',
        'T'
      )

      +

      'Z'
    );
  }


  const date =
    new Date(
      raw
    );


  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}


function safeProbability(
  value
) {

  return clamp(
    Number(value) || 0,
    1e-8,
    1 - 1e-8
  );
}


function mean(
  values
) {

  const clean =
    array(
      values
    )

      .map(
        Number
      )

      .filter(
        Number.isFinite
      );


  if (
    !clean.length
  ) {

    return null;
  }


  return (

    clean.reduce(
      (
        total,
        value
      ) =>
        total + value,
      0
    )

    /

    clean.length
  );
}


function standardDeviation(
  values
) {

  const clean =
    array(
      values
    )

      .map(
        Number
      )

      .filter(
        Number.isFinite
      );


  if (
    clean.length <
    2
  ) {

    return null;
  }


  const average =
    mean(
      clean
    );


  const variance =

    clean.reduce(
      (
        total,
        value
      ) =>

        total

        +

        Math.pow(
          value -
          average,
          2
        ),

      0
    )

    /

    clean.length;


  return Math.sqrt(
    variance
  );
}


// =====================================================
// HISTORIQUE V0.7
// =====================================================

async function loadHistory() {

  const rows =
    [];


  let offset =
    0;


  while (
    true
  ) {

    const query =

      '?select='

      +

      [
        'sportmonks_fixture_id',
        'league_code',
        'league_name',
        'home_team_id',
        'home_team_name',
        'away_team_id',
        'away_team_name',
        'starting_at',
        'home_score',
        'away_score',
        'result_1x2'
      ].join(',')

      +

      '&order=starting_at.asc'

      +

      `&limit=${PAGE_SIZE}`

      +

      `&offset=${offset}`;


    const page =
      await supabaseRequest(
        'model_history',
        {

          method:
            'GET',

          query
        }
      );


    if (
      !Array.isArray(
        page
      )
    ) {

      throw new Error(
        'Réponse model_history invalide.'
      );
    }


    rows.push(
      ...page
    );


    if (
      page.length <
      PAGE_SIZE
    ) {

      break;
    }


    offset +=
      PAGE_SIZE;


    if (
      offset >
      20000
    ) {

      throw new Error(
        'Pagination model_history anormalement longue.'
      );
    }
  }


  return rows

    .map(
      row => {

        const kickoff =
          parseKickoff(
            row.starting_at
          );


        const homeScore =
          numberOrNull(
            row.home_score
          );


        const awayScore =
          numberOrNull(
            row.away_score
          );


        if (
          !kickoff

          ||

          homeScore ===
          null

          ||

          awayScore ===
          null
        ) {

          return null;
        }


        if (
          ![
            'PL',
            'BL',
            'LL'
          ].includes(
            row.league_code
          )
        ) {

          return null;
        }


        if (
          ![
            '1',
            'N',
            '2'
          ].includes(
            row.result_1x2
          )
        ) {

          return null;
        }


        return {

          id:
            String(
              row.sportmonks_fixture_id
            ),

          competition:
            row.league_code,

          competitionName:
            row.league_name
            ||
            row.league_code,

          home:
            row.home_team_name,

          away:
            row.away_team_name,

          homeId:
            numberOrNull(
              row.home_team_id
            ),

          awayId:
            numberOrNull(
              row.away_team_id
            ),

          startingAt:
            kickoff.toISOString(),

          kickoffTs:
            kickoff.getTime(),

          score: {

            home:
              homeScore,

            away:
              awayScore
          },

          actualResult:
            row.result_1x2
        };
      }
    )

    .filter(
      Boolean
    )

    .sort(
      (
        first,
        second
      ) =>
        first.kickoffTs -
        second.kickoffTs
    );
}


// =====================================================
// FEATURES-V1
// =====================================================

async function loadFeatures() {

  const rows =
    [];


  let offset =
    0;


  while (
    true
  ) {

    const query =

      '?select='

      +

      [

        'sportmonks_fixture_id',
        'feature_stage',
        'feature_version',
        'league_code',
        'starting_at',

        'home_matches_sample',
        'away_matches_sample',

        'home_points_per_match_5',
        'away_points_per_match_5',

        'home_goals_for_avg_5',
        'away_goals_for_avg_5',

        'home_goals_against_avg_5',
        'away_goals_against_avg_5',

        'home_home_points_per_match_5',
        'away_away_points_per_match_5',

        'home_home_goals_for_avg_5',
        'away_away_goals_for_avg_5',

        'home_home_goals_against_avg_5',
        'away_away_goals_against_avg_5',

        'home_rest_days',
        'away_rest_days',

        'home_matches_last_14',
        'away_matches_last_14',

        'home_xi_continuity_pct',
        'away_xi_continuity_pct',

        'home_changes_from_previous',
        'away_changes_from_previous',

        'home_regulars_present_pct',
        'away_regulars_present_pct',

        'home_average_xi_overlap_pct',
        'away_average_xi_overlap_pct',

        'home_historical_continuity_pct',
        'away_historical_continuity_pct',

        'home_goalkeeper_regular_pct',
        'away_goalkeeper_regular_pct',

        'home_defence_regular_pct',
        'away_defence_regular_pct',

        'home_midfield_regular_pct',
        'away_midfield_regular_pct',

        'home_attack_regular_pct',
        'away_attack_regular_pct',

        'home_formation_changed',
        'away_formation_changed',

        'data_coverage'

      ].join(',')

      +

      `&feature_version=eq.${encodeURIComponent(
        FEATURE_VERSION
      )}`

      +

      '&order=starting_at.asc'

      +

      `&limit=${PAGE_SIZE}`

      +

      `&offset=${offset}`;


    const page =
      await supabaseRequest(
        'match_features',
        {

          method:
            'GET',

          query
        }
      );


    if (
      !Array.isArray(
        page
      )
    ) {

      throw new Error(
        'Réponse match_features invalide.'
      );
    }


    rows.push(
      ...page
    );


    if (
      page.length <
      PAGE_SIZE
    ) {

      break;
    }


    offset +=
      PAGE_SIZE;


    if (
      offset >
      50000
    ) {

      throw new Error(
        'Pagination match_features anormalement longue.'
      );
    }
  }


  return rows;
}


// =====================================================
// FEATURES DÉRIVÉES
// =====================================================

function derivedFeatures(
  row
) {

  function difference(
    first,
    second
  ) {

    const a =
      numberOrNull(
        first
      );


    const b =
      numberOrNull(
        second
      );


    if (
      a === null
      ||
      b === null
    ) {

      return null;
    }


    return a - b;
  }


  const homeRest =
    numberOrNull(
      row.home_rest_days
    );


  const awayRest =
    numberOrNull(
      row.away_rest_days
    );


  const cappedHomeRest =

    homeRest === null

      ? null

      : Math.min(
          30,
          Math.max(
            0,
            homeRest
          )
        );


  const cappedAwayRest =

    awayRest === null

      ? null

      : Math.min(
          30,
          Math.max(
            0,
            awayRest
          )
        );


  return {

    form_ppg_adv:
      difference(
        row.home_points_per_match_5,
        row.away_points_per_match_5
      ),


    form_attack_adv:
      difference(
        row.home_goals_for_avg_5,
        row.away_goals_for_avg_5
      ),


    form_defence_adv:
      difference(
        row.away_goals_against_avg_5,
        row.home_goals_against_avg_5
      ),


    venue_ppg_adv:
      difference(
        row.home_home_points_per_match_5,
        row.away_away_points_per_match_5
      ),


    venue_attack_adv:
      difference(
        row.home_home_goals_for_avg_5,
        row.away_away_goals_for_avg_5
      ),


    venue_defence_adv:
      difference(
        row.away_away_goals_against_avg_5,
        row.home_home_goals_against_avg_5
      ),


    rest_adv:

      cappedHomeRest === null
      ||
      cappedAwayRest === null

        ? null

        : cappedHomeRest -
          cappedAwayRest,


    congestion_adv:
      difference(
        row.away_matches_last_14,
        row.home_matches_last_14
      ),


    xi_continuity_adv:
      difference(
        row.home_xi_continuity_pct,
        row.away_xi_continuity_pct
      ),


    changes_adv:
      difference(
        row.away_changes_from_previous,
        row.home_changes_from_previous
      ),


    regulars_adv:
      difference(
        row.home_regulars_present_pct,
        row.away_regulars_present_pct
      ),


    overlap_adv:
      difference(
        row.home_average_xi_overlap_pct,
        row.away_average_xi_overlap_pct
      ),


    historical_continuity_adv:
      difference(
        row.home_historical_continuity_pct,
        row.away_historical_continuity_pct
      ),


    goalkeeper_adv:
      difference(
        row.home_goalkeeper_regular_pct,
        row.away_goalkeeper_regular_pct
      ),


    defence_adv:
      difference(
        row.home_defence_regular_pct,
        row.away_defence_regular_pct
      ),


    midfield_adv:
      difference(
        row.home_midfield_regular_pct,
        row.away_midfield_regular_pct
      ),


    attack_adv:
      difference(
        row.home_attack_regular_pct,
        row.away_attack_regular_pct
      ),


    home_formation_changed:

      row.home_formation_changed ===
      true

        ? 1

        : row.home_formation_changed ===
          false

          ? 0

          : null,


    away_formation_changed:

      row.away_formation_changed ===
      true

        ? 1

        : row.away_formation_changed ===
          false

          ? 0

          : null
  };
}


// =====================================================
// BASELINE V0.7
//
// V0.7 est volontairement gardée comme référence fixe.
// Le rolling teste la stabilité de la COUCHE résiduelle.
//
// buildModel conserve néanmoins son cutoff temporel
// pour les statistiques du match.
// =====================================================

function buildRows(
  history,
  features,
  stage,
  tuning
) {

  const historyById =
    new Map(

      history.map(
        match => [

          String(
            match.id
          ),

          match
        ]
      )
    );


  const rows =
    [];


  for (
    const feature
    of features
  ) {

    if (
      feature.feature_stage !==
      stage
    ) {

      continue;
    }


    if (
      Number(
        feature.home_matches_sample
      ) <
      MIN_SAMPLE

      ||

      Number(
        feature.away_matches_sample
      ) <
      MIN_SAMPLE
    ) {

      continue;
    }


    const match =
      historyById.get(

        String(
          feature.sportmonks_fixture_id
        )
      );


    if (
      !match
    ) {

      continue;
    }


    const model =
      buildModel(

        history,

        match,

        match.kickoffTs,

        tuning.config,

        tuning.eloState,

        tuning.calibration
      );


    if (
      !Number.isFinite(
        Number(
          model.home
        )
      )

      ||

      !Number.isFinite(
        Number(
          model.draw
        )
      )

      ||

      !Number.isFinite(
        Number(
          model.away
        )
      )
    ) {

      continue;
    }


    rows.push({

      fixtureId:
        String(
          match.id
        ),

      competition:
        match.competition,

      kickoffTs:
        match.kickoffTs,

      actualResult:
        match.actualResult,

      baseline: {

        home:
          Number(
            model.home
          ),

        draw:
          Number(
            model.draw
          ),

        away:
          Number(
            model.away
          )
      },

      feature:
        derivedFeatures(
          feature
        ),

      coverage:
        numberOrNull(
          feature.data_coverage
        )
    });
  }


  return rows.sort(
    (
      first,
      second
    ) =>
      first.kickoffTs -
      second.kickoffTs
  );
}


// =====================================================
// STANDARDISATION
// =====================================================

function fitStandardizer(
  rows,
  variables
) {

  const means =
    {};


  const deviations =
    {};


  variables.forEach(
    variable => {

      const values =
        rows

          .map(
            row =>
              numberOrNull(
                row.feature[
                  variable
                ]
              )
          )

          .filter(
            value =>
              value !== null
          );


      if (
        !values.length
      ) {

        means[
          variable
        ] =
          0;


        deviations[
          variable
        ] =
          1;


        return;
      }


      const average =
        mean(
          values
        );


      const variance =

        values.reduce(
          (
            total,
            value
          ) =>

            total

            +

            Math.pow(
              value -
              average,
              2
            ),

          0
        )

        /

        values.length;


      const deviation =
        Math.sqrt(
          variance
        );


      means[
        variable
      ] =
        average;


      deviations[
        variable
      ] =

        Number.isFinite(
          deviation
        )

        &&

        deviation >
        1e-8

          ? deviation

          : 1;
    }
  );


  return {

    means,

    deviations
  };
}


function standardizedVector(
  row,
  variables,
  scaler
) {

  const vector =
    [
      1
    ];


  variables.forEach(
    variable => {

      const raw =
        numberOrNull(

          row.feature[
            variable
          ]
        );


      const value =

        raw === null

          ? scaler.means[
              variable
            ]

          : raw;


      vector.push(

        (
          value

          -

          scaler.means[
            variable
          ]
        )

        /

        scaler.deviations[
          variable
        ]
      );
    }
  );


  return vector;
}


// =====================================================
// CORRECTION LOG-ODDS
// =====================================================

function correctedProbability(
  baseline,
  vector,
  parameters
) {

  const home =
    safeProbability(
      baseline.home
    );


  const draw =
    safeProbability(
      baseline.draw
    );


  const away =
    safeProbability(
      baseline.away
    );


  let homeCorrection =
    0;


  let awayCorrection =
    0;


  for (
    let index = 0;
    index < vector.length;
    index += 1
  ) {

    homeCorrection +=

      parameters.home[
        index
      ]

      *

      vector[
        index
      ];


    awayCorrection +=

      parameters.away[
        index
      ]

      *

      vector[
        index
      ];
  }


  const homeLogit =

    Math.log(
      home /
      draw
    )

    +

    homeCorrection;


  const awayLogit =

    Math.log(
      away /
      draw
    )

    +

    awayCorrection;


  const maximum =
    Math.max(
      homeLogit,
      0,
      awayLogit
    );


  const expHome =
    Math.exp(
      homeLogit -
      maximum
    );


  const expDraw =
    Math.exp(
      -maximum
    );


  const expAway =
    Math.exp(
      awayLogit -
      maximum
    );


  const total =
    expHome +
    expDraw +
    expAway;


  return {

    home:
      expHome /
      total,

    draw:
      expDraw /
      total,

    away:
      expAway /
      total
  };
}


// =====================================================
// APPRENTISSAGE CORRECTEUR
// =====================================================

function trainCorrector(
  rows,
  variables,
  lambda,
  epochs = 600,
  learningRate = 0.04
) {

  const scaler =
    fitStandardizer(
      rows,
      variables
    );


  const dimensions =
    variables.length +
    1;


  const parameters = {

    home:
      new Array(
        dimensions
      ).fill(0),

    away:
      new Array(
        dimensions
      ).fill(0)
  };


  for (
    let epoch = 0;
    epoch < epochs;
    epoch += 1
  ) {

    const gradientHome =
      new Array(
        dimensions
      ).fill(0);


    const gradientAway =
      new Array(
        dimensions
      ).fill(0);


    for (
      const row
      of rows
    ) {

      const vector =
        standardizedVector(

          row,

          variables,

          scaler
        );


      const probability =
        correctedProbability(

          row.baseline,

          vector,

          parameters
        );


      const actualHome =
        row.actualResult ===
        '1'

          ? 1

          : 0;


      const actualAway =
        row.actualResult ===
        '2'

          ? 1

          : 0;


      const errorHome =
        probability.home -
        actualHome;


      const errorAway =
        probability.away -
        actualAway;


      for (
        let index = 0;
        index < dimensions;
        index += 1
      ) {

        gradientHome[
          index
        ] +=

          errorHome

          *

          vector[
            index
          ];


        gradientAway[
          index
        ] +=

          errorAway

          *

          vector[
            index
          ];
      }
    }


    for (
      let index = 0;
      index < dimensions;
      index += 1
    ) {

      const penalty =

        index === 0

          ? lambda *
            0.1

          : lambda;


      gradientHome[
        index
      ] =

        gradientHome[
          index
        ]

        /

        rows.length

        +

        penalty

        *

        parameters.home[
          index
        ];


      gradientAway[
        index
      ] =

        gradientAway[
          index
        ]

        /

        rows.length

        +

        penalty

        *

        parameters.away[
          index
        ];


      parameters.home[
        index
      ] -=

        learningRate

        *

        gradientHome[
          index
        ];


      parameters.away[
        index
      ] -=

        learningRate

        *

        gradientAway[
          index
        ];
    }
  }


  return {

    scaler,

    parameters
  };
}


// =====================================================
// ÉVALUATION
// =====================================================

function evaluate(
  rows,
  variables,
  model
) {

  let baselineBrierSum =
    0;


  let challengerBrierSum =
    0;


  let baselineCorrect =
    0;


  let challengerCorrect =
    0;


  const leagueBuckets =
    {};


  const calibrationBuckets =
    new Array(
      10
    )

      .fill(
        null
      )

      .map(
        () => ({

          count:
            0,

          confidence:
            0,

          correct:
            0
        })
      );


  rows.forEach(
    row => {

      const vector =
        standardizedVector(

          row,

          variables,

          model.scaler
        );


      const challenger =
        correctedProbability(

          row.baseline,

          vector,

          model.parameters
        );


      const baselineScore =
        brier3(

          row.baseline,

          row.actualResult
        );


      const challengerScore =
        brier3(

          challenger,

          row.actualResult
        );


      baselineBrierSum +=
        baselineScore;


      challengerBrierSum +=
        challengerScore;


      const baselinePick =
        bestPick(
          row.baseline
        );


      const challengerPick =
        bestPick(
          challenger
        );


      if (
        baselinePick ===
        row.actualResult
      ) {

        baselineCorrect +=
          1;
      }


      if (
        challengerPick ===
        row.actualResult
      ) {

        challengerCorrect +=
          1;
      }


      const confidence =
        Math.max(

          challenger.home,

          challenger.draw,

          challenger.away
        );


      const bucketIndex =
        Math.min(
          9,
          Math.floor(
            confidence *
            10
          )
        );


      const calibrationBucket =
        calibrationBuckets[
          bucketIndex
        ];


      calibrationBucket.count +=
        1;


      calibrationBucket.confidence +=
        confidence;


      calibrationBucket.correct +=

        challengerPick ===
        row.actualResult

          ? 1

          : 0;


      if (
        !leagueBuckets[
          row.competition
        ]
      ) {

        leagueBuckets[
          row.competition
        ] = {

          count:
            0,

          baselineBrierSum:
            0,

          challengerBrierSum:
            0,

          baselineCorrect:
            0,

          challengerCorrect:
            0
        };
      }


      const league =
        leagueBuckets[
          row.competition
        ];


      league.count +=
        1;


      league.baselineBrierSum +=
        baselineScore;


      league.challengerBrierSum +=
        challengerScore;


      if (
        baselinePick ===
        row.actualResult
      ) {

        league.baselineCorrect +=
          1;
      }


      if (
        challengerPick ===
        row.actualResult
      ) {

        league.challengerCorrect +=
          1;
      }
    }
  );


  const byLeague =
    {};


  Object.entries(
    leagueBuckets
  )

    .forEach(
      (
        [
          leagueCode,
          bucket
        ]
      ) => {

        const baseline =
          bucket.baselineBrierSum /
          bucket.count;


        const challenger =
          bucket.challengerBrierSum /
          bucket.count;


        byLeague[
          leagueCode
        ] = {

          tested:
            bucket.count,

          baselineBrier:
            baseline,

          challengerBrier:
            challenger,

          baselineCorrect:
            bucket.baselineCorrect,

          challengerCorrect:
            bucket.challengerCorrect
        };
      }
    );


  let calibrationError =
    0;


  calibrationBuckets.forEach(
    bucket => {

      if (
        !bucket.count
      ) {

        return;
      }


      const averageConfidence =
        bucket.confidence /
        bucket.count;


      const averageAccuracy =
        bucket.correct /
        bucket.count;


      calibrationError +=

        bucket.count /
        rows.length

        *

        Math.abs(
          averageConfidence -
          averageAccuracy
        );
    }
  );


  return {

    tested:
      rows.length,

    baselineBrierSum,

    challengerBrierSum,

    baselineCorrect,

    challengerCorrect,

    baselineBrier:

      rows.length

        ? baselineBrierSum /
          rows.length

        : null,

    challengerBrier:

      rows.length

        ? challengerBrierSum /
          rows.length

        : null,

    baselineAccuracy:

      rows.length

        ? baselineCorrect /
          rows.length

        : null,

    challengerAccuracy:

      rows.length

        ? challengerCorrect /
          rows.length

        : null,

    calibrationError,

    byLeague
  };
}


// =====================================================
// CHOIX LAMBDA
// =====================================================

function chooseLambda(
  trainingRows,
  variables
) {

  const splitIndex =
    Math.max(

      1,

      Math.floor(

        trainingRows.length

        *

        INNER_SPLIT
      )
    );


  const innerTraining =
    trainingRows.slice(
      0,
      splitIndex
    );


  const validation =
    trainingRows.slice(
      splitIndex
    );


  if (
    innerTraining.length <
    30

    ||

    validation.length <
    10
  ) {

    return {

      lambda:
        0.01,

      validationBrier:
        null
    };
  }


  let winner =
    null;


  for (
    const lambda
    of L2_VALUES
  ) {

    const model =
      trainCorrector(

        innerTraining,

        variables,

        lambda
      );


    const result =
      evaluate(

        validation,

        variables,

        model
      );


    if (
      !winner

      ||

      result.challengerBrier <
      winner.validationBrier
    ) {

      winner = {

        lambda,

        validationBrier:
          result.challengerBrier
      };
    }
  }


  return winner;
}


// =====================================================
// BORNES CHRONOLOGIQUES
//
// Évite de couper deux matchs possédant
// exactement la même heure entre train et test.
// =====================================================

function safeBoundary(
  rows,
  rawIndex
) {

  let index =
    Math.max(
      1,
      Math.min(
        rows.length,
        rawIndex
      )
    );


  if (
    index >=
    rows.length
  ) {

    return rows.length;
  }


  const previousTime =
    rows[
      index - 1
    ]?.kickoffTs;


  while (
    index <
    rows.length

    &&

    rows[
      index
    ]?.kickoffTs ===
    previousTime
  ) {

    index +=
      1;
  }


  return index;
}


// =====================================================
// CONSTRUCTION DES 4 FOLDS
// =====================================================

function createRollingFolds(
  rows
) {

  if (
    rows.length <
    100
  ) {

    return [];
  }


  const firstBoundary =
    safeBoundary(

      rows,

      Math.floor(
        rows.length *
        INITIAL_TRAIN_RATIO
      )
    );


  const remaining =
    rows.length -
    firstBoundary;


  const boundaries =
    [
      firstBoundary
    ];


  for (
    let fold = 1;
    fold < ROLLING_FOLDS;
    fold += 1
  ) {

    const rawBoundary =

      firstBoundary

      +

      Math.floor(

        remaining

        *

        fold

        /

        ROLLING_FOLDS
      );


    boundaries.push(

      safeBoundary(
        rows,
        rawBoundary
      )
    );
  }


  boundaries.push(
    rows.length
  );


  const uniqueBoundaries =
    boundaries.filter(
      (
        value,
        index,
        source
      ) =>

        index === 0

        ||

        value >
        source[
          index - 1
        ]
    );


  const folds =
    [];


  for (
    let index = 0;
    index < uniqueBoundaries.length - 1;
    index += 1
  ) {

    const testStart =
      uniqueBoundaries[
        index
      ];


    const testEnd =
      uniqueBoundaries[
        index + 1
      ];


    const training =
      rows.slice(
        0,
        testStart
      );


    const test =
      rows.slice(
        testStart,
        testEnd
      );


    if (
      training.length <
      MIN_ROLLING_TRAIN

      ||

      test.length <
      MIN_ROLLING_TEST
    ) {

      continue;
    }


    folds.push({

      number:
        folds.length +
        1,

      training,

      test,

      testStart:
        test[0]
          ?.kickoffTs
        ||
        null,

      testEnd:
        test[
          test.length - 1
        ]?.kickoffTs
        ||
        null
    });
  }


  return folds;
}


// =====================================================
// AGRÉGATION PAR CHAMPIONNAT
// =====================================================

function aggregateLeagueResults(
  foldResults
) {

  const buckets =
    {};


  foldResults.forEach(
    fold => {

      Object.entries(
        fold.result.byLeague
        ||
        {}
      )

        .forEach(
          (
            [
              leagueCode,
              league
            ]
          ) => {

            if (
              !buckets[
                leagueCode
              ]
            ) {

              buckets[
                leagueCode
              ] = {

                tested:
                  0,

                baselineBrierSum:
                  0,

                challengerBrierSum:
                  0,

                baselineCorrect:
                  0,

                challengerCorrect:
                  0
              };
            }


            const bucket =
              buckets[
                leagueCode
              ];


            bucket.tested +=
              league.tested;


            bucket.baselineBrierSum +=

              league.baselineBrier

              *

              league.tested;


            bucket.challengerBrierSum +=

              league.challengerBrier

              *

              league.tested;


            bucket.baselineCorrect +=
              league.baselineCorrect;


            bucket.challengerCorrect +=
              league.challengerCorrect;
          }
        );
    }
  );


  const output =
    {};


  Object.entries(
    buckets
  )

    .forEach(
      (
        [
          leagueCode,
          bucket
        ]
      ) => {

        const baseline =
          bucket.baselineBrierSum /
          bucket.tested;


        const challenger =
          bucket.challengerBrierSum /
          bucket.tested;


        output[
          leagueCode
        ] = {

          tested:
            bucket.tested,

          baselineBrier:
            round(
              baseline,
              8
            ),

          challengerBrier:
            round(
              challenger,
              8
            ),

          gainPct:

            baseline >
            0

              ? round(

                  (
                    baseline -
                    challenger
                  )

                  /

                  baseline

                  *

                  100,

                  3
                )

              : null,

          baselineAccuracy:
            round(

              bucket.baselineCorrect /
              bucket.tested,

              5
            ),

          challengerAccuracy:
            round(

              bucket.challengerCorrect /
              bucket.tested,

              5
            )
        };
      }
    );


  return output;
}


// =====================================================
// UN CANDIDAT ROLLING
// =====================================================

async function runRollingCandidate(
  candidate,
  developmentRows
) {

  const folds =
    createRollingFolds(
      developmentRows
    );


  if (
    folds.length <
    3
  ) {

    throw new Error(

      `${candidate.stage}_${candidate.family} : pas assez de fenêtres rolling.`
    );
  }


  const foldResults =
    [];


  for (
    const fold
    of folds
  ) {

    // -------------------------------------------------
    // Lambda choisi uniquement dans le passé
    // -------------------------------------------------

    const lambdaChoice =
      chooseLambda(

        fold.training,

        candidate.variables
      );


    // -------------------------------------------------
    // Apprentissage uniquement sur les matchs passés
    // -------------------------------------------------

    const model =
      trainCorrector(

        fold.training,

        candidate.variables,

        lambdaChoice.lambda
      );


    // -------------------------------------------------
    // Test sur la fenêtre suivante
    // -------------------------------------------------

    const result =
      evaluate(

        fold.test,

        candidate.variables,

        model
      );


    const gainPct =

      result.baselineBrier >
      0

        ? (

            result.baselineBrier

            -

            result.challengerBrier

          )

          /

          result.baselineBrier

          *

          100

        : null;


    foldResults.push({

      number:
        fold.number,

      training:
        fold.training.length,

      tested:
        fold.test.length,

      testStart:
        fold.testStart,

      testEnd:
        fold.testEnd,

      lambda:
        lambdaChoice.lambda,

      validationBrier:
        lambdaChoice.validationBrier,

      gainPct,

      result
    });
  }


  // ===================================================
  // AGRÉGATION GLOBALE
  // ===================================================

  const totalTested =

    foldResults.reduce(
      (
        total,
        fold
      ) =>
        total +
        fold.result.tested,
      0
    );


  const baselineBrierSum =

    foldResults.reduce(
      (
        total,
        fold
      ) =>

        total

        +

        fold.result
          .baselineBrierSum,

      0
    );


  const challengerBrierSum =

    foldResults.reduce(
      (
        total,
        fold
      ) =>

        total

        +

        fold.result
          .challengerBrierSum,

      0
    );


  const baselineCorrect =

    foldResults.reduce(
      (
        total,
        fold
      ) =>

        total

        +

        fold.result
          .baselineCorrect,

      0
    );


  const challengerCorrect =

    foldResults.reduce(
      (
        total,
        fold
      ) =>

        total

        +

        fold.result
          .challengerCorrect,

      0
    );


  const weightedCalibration =

    foldResults.reduce(
      (
        total,
        fold
      ) =>

        total

        +

        fold.result.calibrationError

        *

        fold.result.tested,

      0
    )

    /

    totalTested;


  const baselineBrier =
    baselineBrierSum /
    totalTested;


  const challengerBrier =
    challengerBrierSum /
    totalTested;


  const gainPct =

    (
      baselineBrier -
      challengerBrier
    )

    /

    baselineBrier

    *

    100;


  const foldGains =

    foldResults.map(
      fold =>
        fold.gainPct
    );


  const winningFolds =

    foldGains.filter(
      value =>

        Number.isFinite(
          value
        )

        &&

        value >
        0
    ).length;


  return {

    candidate,

    developmentRows:
      developmentRows.length,

    folds:
      foldResults,

    foldsCompleted:
      foldResults.length,

    winningFolds,

    losingFolds:

      foldResults.length -
      winningFolds,

    totalTested,

    baselineBrier,

    challengerBrier,

    gainPct,

    baselineAccuracy:
      baselineCorrect /
      totalTested,

    challengerAccuracy:
      challengerCorrect /
      totalTested,

    calibrationError:
      weightedCalibration,

    averageFoldGain:
      mean(
        foldGains
      ),

    foldGainStdDev:
      standardDeviation(
        foldGains
      ),

    byLeague:
      aggregateLeagueResults(
        foldResults
      )
  };
}


// =====================================================
// SAUVEGARDE ROLLING
// =====================================================

async function saveRollingExperiment(
  rolling
) {

  const {
    candidate
  } =
    rolling;


  const row = {

    experiment_name:

      `ROLLING_${candidate.stage}_${candidate.family}`,


    model_version:
      ROLLING_VERSION,


    feature_version:
      FEATURE_VERSION,


    feature_stage:
      candidate.stage,


    feature_family:
      candidate.family,


    /*
     * Nombre total de matchs disponibles
     * dans la zone développement.
     */
    training_matches:
      rolling.developmentRows,


    /*
     * Les fenêtres de test rolling sont
     * disjointes.
     */
    holdout_matches:
      rolling.totalTested,


    brier_baseline:
      round(
        rolling.baselineBrier
      ),


    brier_challenger:
      round(
        rolling.challengerBrier
      ),


    brier_gain_pct:
      round(
        rolling.gainPct,
        4
      ),


    accuracy_baseline:
      round(
        rolling.baselineAccuracy,
        6
      ),


    accuracy_challenger:
      round(
        rolling.challengerAccuracy,
        6
      ),


    calibration_error:
      round(
        rolling.calibrationError,
        8
      ),


    improved:

      rolling.challengerBrier <
      rolling.baselineBrier,


    coefficients: {

      /*
       * Pas de coefficient unique :
       * chaque fold possède son propre modèle.
       */

      foldLambdas:

        rolling.folds.map(
          fold => ({

            fold:
              fold.number,

            lambda:
              fold.lambda
          })
        )
    },


    variables:
      candidate.variables,


    league_results:
      rolling.byLeague,


    metadata: {

      method:
        'EXPANDING_WINDOW_ROLLING_RESIDUAL_VALIDATION',

      baseline:
        'FIXED_V0.7_REFERENCE',

      rollingFoldsRequested:
        ROLLING_FOLDS,

      rollingFoldsCompleted:
        rolling.foldsCompleted,

      initialTrainingRatio:
        INITIAL_TRAIN_RATIO,

      developmentRows:
        rolling.developmentRows,

      winningFolds:
        rolling.winningFolds,

      losingFolds:
        rolling.losingFolds,

      averageFoldGain:
        round(
          rolling.averageFoldGain,
          4
        ),

      foldGainStdDev:
        round(
          rolling.foldGainStdDev,
          4
        ),

      finalHoldoutReused:
        false,

      productionChanged:
        false,

      status:
        'ROLLING_SHADOW_ONLY',


      folds:

        rolling.folds.map(
          fold => ({

            fold:
              fold.number,

            training:
              fold.training,

            tested:
              fold.tested,

            start:
              fold.testStart

                ? new Date(
                    fold.testStart
                  ).toISOString()

                : null,

            end:
              fold.testEnd

                ? new Date(
                    fold.testEnd
                  ).toISOString()

                : null,

            lambda:
              fold.lambda,

            baselineBrier:
              round(
                fold.result.baselineBrier,
                8
              ),

            challengerBrier:
              round(
                fold.result.challengerBrier,
                8
              ),

            gainPct:
              round(
                fold.gainPct,
                4
              ),

            baselineAccuracy:
              round(
                fold.result.baselineAccuracy,
                6
              ),

            challengerAccuracy:
              round(
                fold.result.challengerAccuracy,
                6
              ),

            calibrationError:
              round(
                fold.result.calibrationError,
                8
              ),

            leagues:
              fold.result.byLeague
          })
        )
    }
  };


  await supabaseRequest(
    'model_experiments',
    {

      method:
        'POST',

      body:
        row,

      prefer:
        'return=minimal'
    }
  );


  return {

    experiment:
      row.experiment_name,

    stage:
      candidate.stage,

    family:
      candidate.family,

    developmentRows:
      rolling.developmentRows,

    folds:
      rolling.foldsCompleted,

    winningFolds:
      rolling.winningFolds,

    losingFolds:
      rolling.losingFolds,

    tested:
      rolling.totalTested,

    baselineBrier:
      row.brier_baseline,

    challengerBrier:
      row.brier_challenger,

    gainPct:
      row.brier_gain_pct,

    baselineAccuracy:
      row.accuracy_baseline,

    challengerAccuracy:
      row.accuracy_challenger,

    calibrationError:
      row.calibration_error,

    averageFoldGain:
      row.metadata.averageFoldGain,

    foldGainStdDev:
      row.metadata.foldGainStdDev,

    byLeague:
      row.league_results,

    foldResults:
      row.metadata.folds
  };
}


// =====================================================
// JSON
// =====================================================

function jsonResponse(
  statusCode,
  body
) {

  return {

    statusCode,

    headers: {

      'content-type':
        'application/json; charset=utf-8',

      'cache-control':
        'no-store'
    },

    body:
      JSON.stringify(
        body
      )
  };
}


// =====================================================
// HANDLER
// =====================================================

exports.handler =
  async event => {

    if (
      event.httpMethod !==
      'POST'
    ) {

      return jsonResponse(
        405,
        {

          success:
            false,

          error:
            'POST requis.'
        }
      );
    }


    let body =
      {};


    try {

      body =
        JSON.parse(
          event.body ||
          '{}'
        );

    } catch {

      body =
        {};
    }


    const secret =
      process.env.MATCHSCOPE_SYNC_SECRET;


    if (
      !secret

      ||

      body?.secret !==
      secret
    ) {

      return jsonResponse(
        401,
        {

          success:
            false,

          error:
            'Accès non autorisé.'
        }
      );
    }


    try {

      // =================================================
      // 1. HISTORIQUE
      // =================================================

      const history =
        await loadHistory();


      if (
        history.length <
        850
      ) {

        throw new Error(

          `Historique insuffisant : ${history.length} matchs.`
        );
      }


      // =================================================
      // 2. RÉFÉRENCE V0.7
      // =================================================

      resetTuningCache();


      const tuning =
        tuneModel(
          history
        );


      if (
        !tuning?.config

        ||

        !tuning?.calibration

        ||

        !tuning?.eloState
      ) {

        throw new Error(
          'V0.7 indisponible.'
        );
      }


      // =================================================
      // 3. FEATURES
      // =================================================

      const features =
        await loadFeatures();


      const preRows =
        buildRows(

          history,

          features,

          'PRELINEUP',

          tuning
        );


      const finalRows =
        buildRows(

          history,

          features,

          'FINAL',

          tuning
        );


      // =================================================
      // 4. HOLDOUT FINAL PRELINEUP
      //
      // Les matchs postérieurs restent totalement exclus
      // du rolling.
      // =================================================

      const historySplitIndex =
        Math.max(

          1,

          Math.floor(

            history.length

            *

            GLOBAL_SPLIT
          )
        );


      const preHoldoutFirstMatch =
        history[
          historySplitIndex
        ];


      if (
        !preHoldoutFirstMatch
      ) {

        throw new Error(
          'Cutoff PRELINEUP impossible.'
        );
      }


      const preCutoff =
        preHoldoutFirstMatch.kickoffTs;


      const preDevelopmentRows =
        preRows.filter(
          row =>
            row.kickoffTs <
            preCutoff
        );


      const preReservedHoldout =
        preRows.filter(
          row =>
            row.kickoffTs >=
            preCutoff
        );


      // =================================================
      // 5. HOLDOUT FINAL FINAL
      //
      // Même logique que notre test corrigé :
      // environ 78 % développement / 22 % réserve.
      // =================================================

      if (
        finalRows.length <
        100
      ) {

        throw new Error(
          'Dataset FINAL insuffisant.'
        );
      }


      const finalSplitIndex =
        Math.max(

          1,

          Math.floor(

            finalRows.length

            *

            GLOBAL_SPLIT
          )
        );


      const finalHoldoutFirstMatch =
        finalRows[
          finalSplitIndex
        ];


      if (
        !finalHoldoutFirstMatch
      ) {

        throw new Error(
          'Cutoff FINAL impossible.'
        );
      }


      const finalCutoff =
        finalHoldoutFirstMatch.kickoffTs;


      const finalDevelopmentRows =
        finalRows.filter(
          row =>
            row.kickoffTs <
            finalCutoff
        );


      const finalReservedHoldout =
        finalRows.filter(
          row =>
            row.kickoffTs >=
            finalCutoff
        );


      console.log(

        'MatchScope Rolling datasets:',

        JSON.stringify({

          prelineup: {

            total:
              preRows.length,

            development:
              preDevelopmentRows.length,

            reservedHoldout:
              preReservedHoldout.length
          },

          final: {

            total:
              finalRows.length,

            development:
              finalDevelopmentRows.length,

            reservedHoldout:
              finalReservedHoldout.length
          }
        })
      );


      // =================================================
      // 6. ROLLING
      // =================================================

      const outputs =
        [];


      for (
        const candidate
        of CANDIDATES
      ) {

        const developmentRows =

          candidate.stage ===
          'FINAL'

            ? finalDevelopmentRows

            : preDevelopmentRows;


        try {

          const rolling =
            await runRollingCandidate(

              candidate,

              developmentRows
            );


          const saved =
            await saveRollingExperiment(
              rolling
            );


          outputs.push(
            saved
          );


          console.log(

            'Rolling candidate:',

            JSON.stringify(
              saved
            )
          );


        } catch (
          error
        ) {

          outputs.push({

            stage:
              candidate.stage,

            family:
              candidate.family,

            error:
              error?.message
              ||
              String(
                error
              )
          });
        }
      }


      // =================================================
      // 7. RÉPONSE
      // =================================================

      return jsonResponse(
        200,
        {

          success:
            true,

          modelVersion:
            ROLLING_VERSION,

          featureVersion:
            FEATURE_VERSION,


          datasets: {

            prelineup: {

              total:
                preRows.length,

              development:
                preDevelopmentRows.length,

              reservedHoldout:
                preReservedHoldout.length
            },


            final: {

              total:
                finalRows.length,

              development:
                finalDevelopmentRows.length,

              reservedHoldout:
                finalReservedHoldout.length
            }
          },


          candidates:
            outputs.length,


          results:
            outputs,


          reservedHoldoutsUsed:
            false,


          productionChanged:
            false
        }
      );


    } catch (
      error
    ) {

      console.error(

        'rolling-lab-background:',

        error
      );


      return jsonResponse(
        500,
        {

          success:
            false,

          error:
            error?.message
            ||
            String(
              error
            ),

          productionChanged:
            false
        }
      );
    }
  };
