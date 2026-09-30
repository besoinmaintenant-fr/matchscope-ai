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
// MATCHSCOPE — V0.8 SHADOW LAB
//
// OBJECTIF
//
// 1. Reconstruire V0.7 sur l'historique.
// 2. Ajouter des corrections issues de features-v1.
// 3. Apprendre uniquement sur les matchs anciens.
// 4. Tester uniquement sur les matchs récents.
// 5. Comparer systématiquement au Brier de V0.7.
//
// AUCUNE PRÉDICTION DE PRODUCTION N'EST MODIFIÉE.
// =====================================================


const FEATURE_VERSION =
  'features-v1';


const SHADOW_VERSION =
  'v0.8-shadow';


const PAGE_SIZE =
  1000;


const GLOBAL_SPLIT =
  0.78;


const INNER_SPLIT =
  0.80;


const MIN_SAMPLE =
  5;


// =====================================================
// EXPÉRIENCES
// =====================================================

const EXPERIMENTS = [

  // ---------------------------------------------------
  // PRELINEUP
  // ---------------------------------------------------

  {
    stage:
      'PRELINEUP',

    family:
      'RECALIBRATION_ONLY',

    variables:
      []
  },


  {
    stage:
      'PRELINEUP',

    family:
      'FORME_RECENTE',

    variables: [

      'form_ppg_adv',

      'form_attack_adv',

      'form_defence_adv'
    ]
  },


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
      'PRELINEUP',

    family:
      'CALENDRIER',

    variables: [

      'rest_adv',

      'congestion_adv'
    ]
  },


  {
    stage:
      'PRELINEUP',

    family:
      'PRE_COMPLET',

    variables: [

      'form_ppg_adv',

      'form_attack_adv',

      'form_defence_adv',

      'venue_ppg_adv',

      'venue_attack_adv',

      'venue_defence_adv',

      'rest_adv',

      'congestion_adv'
    ]
  },


  // ---------------------------------------------------
  // FINAL
  // ---------------------------------------------------

  {
    stage:
      'FINAL',

    family:
      'RECALIBRATION_ONLY',

    variables:
      []
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
      'STABILITE_LIGNES',

    variables: [

      'goalkeeper_adv',

      'defence_adv',

      'midfield_adv',

      'attack_adv'
    ]
  },


  {
    stage:
      'FINAL',

    family:
      'FORMATION',

    variables: [

      'home_formation_changed',

      'away_formation_changed'
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


// =====================================================
// RÉGULARISATION TESTÉE
// =====================================================

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
    value === null ||
    value === undefined ||
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
      ) + 'Z'
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

          homeScore === null

          ||

          awayScore === null
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
// TRANSFORMATION DES FEATURES
//
// Les variables sont exprimées en avantage domicile.
//
// Exemple :
//
// form_ppg_adv
// = PPG domicile - PPG extérieur.
//
// Un nombre positif signifie donc
// avantage statistique domicile.
// =====================================================

function derivedFeatures(
  row
) {

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
          homeRest,
          30
        );


  const cappedAwayRest =

    awayRest === null

      ? null

      : Math.min(
          awayRest,
          30
        );


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
      a === null ||
      b === null
    ) {

      return null;
    }


    return a - b;
  }


  return {

    // -------------------------------------------------
    // FORME
    // -------------------------------------------------

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


    /*
     * Ici :
     *
     * away GA - home GA
     *
     * Plus la valeur est élevée,
     * plus la défense domicile
     * semble avantageuse.
     */
    form_defence_adv:
      difference(

        row.away_goals_against_avg_5,

        row.home_goals_against_avg_5
      ),


    // -------------------------------------------------
    // DOMICILE / EXTÉRIEUR
    // -------------------------------------------------

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


    // -------------------------------------------------
    // CALENDRIER
    // -------------------------------------------------

    rest_adv:

      cappedHomeRest === null
      ||
      cappedAwayRest === null

        ? null

        : cappedHomeRest -
          cappedAwayRest,


    /*
     * Plus l'adversaire a joué de matchs
     * dans les 14 jours, plus cette valeur
     * devient positive pour le domicile.
     */
    congestion_adv:
      difference(

        row.away_matches_last_14,

        row.home_matches_last_14
      ),


    // -------------------------------------------------
    // COMPOSITION
    // -------------------------------------------------

    xi_continuity_adv:
      difference(

        row.home_xi_continuity_pct,

        row.away_xi_continuity_pct
      ),


    /*
     * Plus l'extérieur effectue de changements
     * par rapport au domicile,
     * plus la valeur est positive domicile.
     */
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


    // -------------------------------------------------
    // LIGNES
    // -------------------------------------------------

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


    // -------------------------------------------------
    // FORMATION
    // -------------------------------------------------

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
// CONSTRUIRE LE DATASET
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


    /*
     * Match futur ou sans résultat :
     * jamais utilisé dans le laboratoire.
     */
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


      const mean =

        values.reduce(
          (
            total,
            value
          ) =>
            total + value,
          0
        )

        /

        values.length;


      const variance =

        values.reduce(
          (
            total,
            value
          ) =>

            total

            +

            Math.pow(
              value - mean,
              2
            ),

          0
        )

        /

        Math.max(
          1,
          values.length
        );


      const deviation =
        Math.sqrt(
          variance
        );


      means[
        variable
      ] =
        mean;


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

  /*
   * Premier élément = intercept.
   */
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


      /*
       * Valeur manquante :
       * imputation par moyenne training.
       *
       * Après standardisation,
       * cela revient exactement à 0.
       */
      const value =

        raw === null

          ? scaler
              .means[
                variable
              ]

          : raw;


      vector.push(

        (
          value

          -

          scaler
            .means[
              variable
            ]
        )

        /

        scaler
          .deviations[
            variable
          ]
      );
    }
  );


  return vector;
}


// =====================================================
// SOFTMAX AVEC V0.7 COMME OFFSET
//
// On ne remplace PAS V0.7.
//
// On apprend uniquement une correction
// des log-odds de V0.7.
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
      home / draw
    )

    +

    homeCorrection;


  const awayLogit =

    Math.log(
      away / draw
    )

    +

    awayCorrection;


  /*
   * Le nul est la classe de référence.
   */
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
// APPRENTISSAGE DE LA COUCHE DE CORRECTION
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


  if (
    !rows.length
  ) {

    return {

      scaler,

      parameters
    };
  }


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

          errorHome *
          vector[
            index
          ];


        gradientAway[
          index
        ] +=

          errorAway *
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

      /*
       * L'intercept est faiblement régularisé.
       */
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

        penalty *
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

        penalty *
        parameters.away[
          index
        ];


      parameters.home[
        index
      ] -=

        learningRate *
        gradientHome[
          index
        ];


      parameters.away[
        index
      ] -=

        learningRate *
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

  if (
    !rows.length
  ) {

    return {

      tested:
        0,

      baselineBrier:
        null,

      challengerBrier:
        null,

      baselineAccuracy:
        null,

      challengerAccuracy:
        null,

      calibrationError:
        null,

      byLeague:
        {}
    };
  }


  let baselineBrier =
    0;


  let challengerBrier =
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

      .fill(null)

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


      const baselineRowBrier =
        brier3(

          row.baseline,

          row.actualResult
        );


      const challengerRowBrier =
        brier3(

          challenger,

          row.actualResult
        );


      baselineBrier +=
        baselineRowBrier;


      challengerBrier +=
        challengerRowBrier;


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


      // -----------------------------------------------
      // CALIBRATION SIMPLE
      // -----------------------------------------------

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


      const bucket =
        calibrationBuckets[
          bucketIndex
        ];


      bucket.count +=
        1;


      bucket.confidence +=
        confidence;


      bucket.correct +=

        challengerPick ===
        row.actualResult

          ? 1

          : 0;


      // -----------------------------------------------
      // CHAMPIONNAT
      // -----------------------------------------------

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

          baselineBrier:
            0,

          challengerBrier:
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


      league.baselineBrier +=
        baselineRowBrier;


      league.challengerBrier +=
        challengerRowBrier;


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
          league,
          bucket
        ]
      ) => {

        const baseline =
          bucket.baselineBrier /
          bucket.count;


        const challenger =
          bucket.challengerBrier /
          bucket.count;


        byLeague[
          league
        ] = {

          tested:
            bucket.count,

          baselineBrier:
            round(
              baseline
            ),

          challengerBrier:
            round(
              challenger
            ),

          gainPct:

            baseline > 0

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
              bucket.count,
              5
            ),

          challengerAccuracy:
            round(
              bucket.challengerCorrect /
              bucket.count,
              5
            )
        };
      }
    );


  // ===================================================
  // EXPECTED CALIBRATION ERROR
  // ===================================================

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

    baselineBrier:
      baselineBrier /
      rows.length,

    challengerBrier:
      challengerBrier /
      rows.length,

    baselineAccuracy:
      baselineCorrect /
      rows.length,

    challengerAccuracy:
      challengerCorrect /
      rows.length,

    calibrationError,

    byLeague
  };
}


// =====================================================
// CHOISIR LA RÉGULARISATION
//
// On ne touche jamais au vrai holdout.
//
// Le choix du lambda se fait
// sur une petite validation interne
// contenue dans la partie training.
// =====================================================

function chooseLambda(
  trainingRows,
  variables
) {

  if (
    !variables.length
  ) {

    return {

      lambda:
        0.01,

      validationBrier:
        null
    };
  }


  const splitIndex =
    Math.max(

      1,

      Math.floor(
        trainingRows.length *
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

      (
        result.challengerBrier !==
        null

        &&

        result.challengerBrier <
        winner.validationBrier
      )
    ) {

      winner = {

        lambda,

        validationBrier:
          result.challengerBrier
      };
    }
  }


  return winner

    ||

    {

      lambda:
        0.01,

      validationBrier:
        null
    };
}


// =====================================================
// SAUVEGARDE EXPÉRIENCE
// =====================================================

async function saveExperiment(
  experiment,
  trainingRows,
  holdoutRows,
  model,
  lambdaChoice,
  result,
  tuning,
  cutoff
) {

  const baseline =
    result.baselineBrier;


  const challenger =
    result.challengerBrier;


  const gain =

    baseline !== null

    &&

    challenger !== null

    &&

    baseline >
    0

      ? (
          baseline -
          challenger
        )
        /
        baseline
        *
        100

      : null;


  const row = {

    experiment_name:

      `${experiment.stage}_${experiment.family}`,


    model_version:
      SHADOW_VERSION,


    feature_version:
      FEATURE_VERSION,


    feature_stage:
      experiment.stage,


    feature_family:
      experiment.family,


    training_matches:
      trainingRows.length,


    holdout_matches:
      holdoutRows.length,


    brier_baseline:
      round(
        baseline
      ),


    brier_challenger:
      round(
        challenger
      ),


    brier_gain_pct:
      round(
        gain,
        4
      ),


    accuracy_baseline:
      round(
        result.baselineAccuracy,
        6
      ),


    accuracy_challenger:
      round(
        result.challengerAccuracy,
        6
      ),


    calibration_error:
      round(
        result.calibrationError,
        8
      ),


    /*
     * "improved" signifie seulement :
     *
     * Brier challenger < Brier baseline
     * sur ce holdout.
     *
     * Cela NE signifie PAS encore
     * promotion en production.
     */
    improved:

      challenger !== null

      &&

      baseline !== null

      &&

      challenger <
      baseline,


    coefficients: {

      lambda:
        lambdaChoice.lambda,

      intercept: {

        home:
          model.parameters.home[0],

        away:
          model.parameters.away[0]
      },

      home:
        experiment.variables.reduce(
          (
            output,
            variable,
            index
          ) => {

            output[
              variable
            ] =
              model.parameters.home[
                index + 1
              ];


            return output;
          },
          {}
        ),

      away:
        experiment.variables.reduce(
          (
            output,
            variable,
            index
          ) => {

            output[
              variable
            ] =
              model.parameters.away[
                index + 1
              ];


            return output;
          },
          {}
        ),

      standardization: {

        means:
          model.scaler.means,

        deviations:
          model.scaler.deviations
      }
    },


    variables:
      experiment.variables,


    league_results:
      result.byLeague,


    metadata: {

      method:
        'V0.7_LOG_ODDS_RESIDUAL_MULTINOMIAL_LOGISTIC',

      referenceClass:
        'DRAW',

      globalSplit:
        GLOBAL_SPLIT,

      innerSplit:
        INNER_SPLIT,

      minimumPreviousMatches:
        MIN_SAMPLE,

      holdoutCutoff:
        new Date(
          cutoff
        ).toISOString(),

      validationLambdaBrier:
        lambdaChoice.validationBrier,

      v07GlobalHoldout:
        tuning.holdout
        ||
        null,

      v07TrainingScore:
        tuning.score
        ||
        null,

      productionChanged:
        false,

      status:
        'SHADOW_ONLY',

      promotionRule:
        'No promotion until repeated chronological validation and stability checks.'
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
      experiment.stage,

    family:
      experiment.family,

    training:
      trainingRows.length,

    holdout:
      holdoutRows.length,

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

    improved:
      row.improved,

    lambda:
      lambdaChoice.lambda,

    byLeague:
      result.byLeague
  };
}


// =====================================================
// UNE EXPÉRIENCE
// =====================================================

async function runExperiment(
  experiment,
  rows,
  cutoff,
  tuning
) {

  const trainingRows =
    rows.filter(
      row =>
        row.kickoffTs <
        cutoff
    );


  const holdoutRows =
    rows.filter(
      row =>
        row.kickoffTs >=
        cutoff
    );


  if (
    trainingRows.length <
    40
  ) {

    return {

      experiment:
        `${experiment.stage}_${experiment.family}`,

      skipped:
        true,

      reason:
        'TRAINING_INSUFFICIENT',

      training:
        trainingRows.length,

      holdout:
        holdoutRows.length
    };
  }


  if (
    holdoutRows.length <
    15
  ) {

    return {

      experiment:
        `${experiment.stage}_${experiment.family}`,

      skipped:
        true,

      reason:
        'HOLDOUT_INSUFFICIENT',

      training:
        trainingRows.length,

      holdout:
        holdoutRows.length
    };
  }


  // ===================================================
  // 1. LAMBDA CHOISI SANS TOUCHER AU HOLDOUT
  // ===================================================

  const lambdaChoice =
    chooseLambda(

      trainingRows,

      experiment.variables
    );


  // ===================================================
  // 2. APPRENTISSAGE SUR TOUT LE TRAINING
  // ===================================================

  const model =
    trainCorrector(

      trainingRows,

      experiment.variables,

      lambdaChoice.lambda
    );


  // ===================================================
  // 3. UNIQUE ÉVALUATION SUR LE HOLDOUT
  // ===================================================

  const result =
    evaluate(

      holdoutRows,

      experiment.variables,

      model
    );


  // ===================================================
  // 4. MÉMORISATION
  // ===================================================

  return saveExperiment(

    experiment,

    trainingRows,

    holdoutRows,

    model,

    lambdaChoice,

    result,

    tuning,

    cutoff
  );
}


// =====================================================
// RÉPONSE
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

    // =================================================
    // POST UNIQUEMENT
    // =================================================

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


    // =================================================
    // BODY
    // =================================================

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


    // =================================================
    // SÉCURITÉ
    // =================================================

    const secret =
      process
        .env
        .MATCHSCOPE_SYNC_SECRET;


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
      // 2. V0.7
      //
      // Cette calibration reproduit le protocole
      // existant de V0.7 :
      // ancien historique = tuning
      // derniers 22 % = holdout.
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
          'Calibration V0.7 indisponible.'
        );
      }


      // =================================================
      // 3. CUTOFF CHRONOLOGIQUE GLOBAL
      // =================================================

      const splitIndex =
        Math.max(

          1,

          Math.floor(
            history.length *
            GLOBAL_SPLIT
          )
        );


      const holdoutFirstMatch =
        history[
          splitIndex
        ];


      if (
        !holdoutFirstMatch
      ) {

        throw new Error(
          'Impossible de déterminer le début du holdout.'
        );
      }


      const cutoff =
        holdoutFirstMatch
          .kickoffTs;


      // =================================================
      // 4. FEATURES
      // =================================================

      const features =
        await loadFeatures();


      // =================================================
      // 5. DATASETS
      // =================================================

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


      console.log(

        'MatchScope Challenger Lab datasets:',

        JSON.stringify({

          history:
            history.length,

          prelineup:
            preRows.length,

          final:
            finalRows.length,

          cutoff:
            new Date(
              cutoff
            ).toISOString()
        })
      );


      // =================================================
      // 6. EXPÉRIENCES
      // =================================================

      const results =
        [];


      for (
        const experiment
        of EXPERIMENTS
      ) {

        const rows =

          experiment.stage ===
          'FINAL'

            ? finalRows

            : preRows;


        try {

          const result =
            await runExperiment(

              experiment,

              rows,

              cutoff,

              tuning
            );


          results.push(
            result
          );


          console.log(

            'Challenger experiment:',

            JSON.stringify(
              result
            )
          );


        } catch (
          error
        ) {

          results.push({

            experiment:
              `${experiment.stage}_${experiment.family}`,

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
      // 7. FIN
      // =================================================

      return jsonResponse(
        200,
        {

          success:
            true,

          modelVersion:
            SHADOW_VERSION,

          featureVersion:
            FEATURE_VERSION,

          historyMatches:
            history.length,

          datasets: {

            prelineup:
              preRows.length,

            final:
              finalRows.length
          },

          split: {

            trainingUntil:
              new Date(
                cutoff
              ).toISOString(),

            globalRatio:
              GLOBAL_SPLIT
          },

          v07: {

            training:
              tuning.score
              ||
              null,

            holdout:
              tuning.holdout
              ||
              null
          },

          experiments:
            results.length,

          results,

          productionChanged:
            false
        }
      );


    } catch (
      error
    ) {

      console.error(
        'challenger-lab-background:',
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
