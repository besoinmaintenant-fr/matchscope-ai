const {
  supabaseRequest
} = require('./lib/supabase');


// =====================================================
// MATCHSCOPE — ROLLING STATUS
// =====================================================

const MODEL_VERSION =
  'v0.8-rolling';


const FEATURE_VERSION =
  'features-v1';


const EXPECTED_EXPERIMENTS =
  3;


// =====================================================
// OUTILS
// =====================================================

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


function round(
  value,
  decimals = 5
) {

  const number =
    numberOrNull(
      value
    );


  if (
    number === null
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

    if (
      event.httpMethod !==
      'GET'
    ) {

      return jsonResponse(
        405,
        {

          success:
            false,

          error:
            'GET requis.'
        }
      );
    }


    try {

      // =================================================
      // FILTRE "SINCE"
      //
      // Utilisé par admin-rolling pour ne voir
      // que les résultats du lancement actuel.
      // =================================================

      const sinceRaw =
        event
          ?.queryStringParameters
          ?.since;


      let since =
        null;


      if (
        sinceRaw
      ) {

        const parsed =
          new Date(
            sinceRaw
          );


        if (
          !Number.isNaN(
            parsed.getTime()
          )
        ) {

          since =
            parsed.toISOString();
        }
      }


      // =================================================
      // REQUÊTE
      // =================================================

      let query =

        '?select='

        +

        [
          'id',
          'experiment_name',
          'model_version',
          'feature_version',
          'feature_stage',
          'feature_family',
          'created_at',
          'training_matches',
          'holdout_matches',
          'brier_baseline',
          'brier_challenger',
          'brier_gain_pct',
          'accuracy_baseline',
          'accuracy_challenger',
          'calibration_error',
          'improved',
          'variables',
          'league_results',
          'metadata'
        ].join(',')

        +

        `&model_version=eq.${encodeURIComponent(
          MODEL_VERSION
        )}`

        +

        `&feature_version=eq.${encodeURIComponent(
          FEATURE_VERSION
        )}`;


      if (
        since
      ) {

        query +=

          `&created_at=gte.${encodeURIComponent(
            since
          )}`;
      }


      query +=

        '&order=created_at.asc'

        +

        '&limit=100';


      const rows =
        await supabaseRequest(
          'model_experiments',
          {

            method:
              'GET',

            query
          }
        );


      if (
        !Array.isArray(
          rows
        )
      ) {

        throw new Error(
          'Réponse model_experiments invalide.'
        );
      }


      // =================================================
      // DERNIÈRE VERSION DE CHAQUE CANDIDAT
      // =================================================

      const latest =
        new Map();


      rows.forEach(
        row => {

          latest.set(

            `${row.feature_stage}:${row.feature_family}`,

            row
          );
        }
      );


      const experiments =
        Array
          .from(
            latest.values()
          )

          .sort(
            (
              first,
              second
            ) => {

              if (
                first.feature_stage !==
                second.feature_stage
              ) {

                return String(
                  first.feature_stage
                )
                  .localeCompare(
                    String(
                      second.feature_stage
                    )
                  );
              }


              return String(
                first.feature_family
              )
                .localeCompare(
                  String(
                    second.feature_family
                  )
                );
            }
          );


      // =================================================
      // FORMATAGE
      // =================================================

      const formatted =
        experiments.map(
          row => {

            const metadata =
              row.metadata
              ||
              {};


            const folds =
              Array.isArray(
                metadata.folds
              )
                ? metadata.folds
                : [];


            return {

              id:
                row.id,

              name:
                row.experiment_name,

              stage:
                row.feature_stage,

              family:
                row.feature_family,

              createdAt:
                row.created_at,

              developmentRows:
                row.training_matches,

              tested:
                row.holdout_matches,

              baselineBrier:
                round(
                  row.brier_baseline,
                  6
                ),

              challengerBrier:
                round(
                  row.brier_challenger,
                  6
                ),

              gainPct:
                round(
                  row.brier_gain_pct,
                  3
                ),

              baselineAccuracy:
                round(
                  row.accuracy_baseline,
                  5
                ),

              challengerAccuracy:
                round(
                  row.accuracy_challenger,
                  5
                ),

              calibrationError:
                round(
                  row.calibration_error,
                  5
                ),

              improved:
                row.improved ===
                true,

              variables:
                row.variables
                ||
                [],

              winningFolds:
                numberOrNull(
                  metadata.winningFolds
                )
                ??
                0,

              losingFolds:
                numberOrNull(
                  metadata.losingFolds
                )
                ??
                0,

              foldsCompleted:
                numberOrNull(
                  metadata.rollingFoldsCompleted
                )
                ??
                folds.length,

              averageFoldGain:
                round(
                  metadata.averageFoldGain,
                  3
                ),

              foldGainStdDev:
                round(
                  metadata.foldGainStdDev,
                  3
                ),

              finalHoldoutReused:
                metadata.finalHoldoutReused ===
                true,

              leagues:
                row.league_results
                ||
                {},

              folds:

                folds.map(
                  fold => ({

                    fold:
                      fold.fold,

                    training:
                      fold.training,

                    tested:
                      fold.tested,

                    start:
                      fold.start,

                    end:
                      fold.end,

                    lambda:
                      fold.lambda,

                    baselineBrier:
                      round(
                        fold.baselineBrier,
                        6
                      ),

                    challengerBrier:
                      round(
                        fold.challengerBrier,
                        6
                      ),

                    gainPct:
                      round(
                        fold.gainPct,
                        3
                      ),

                    baselineAccuracy:
                      round(
                        fold.baselineAccuracy,
                        5
                      ),

                    challengerAccuracy:
                      round(
                        fold.challengerAccuracy,
                        5
                      ),

                    calibrationError:
                      round(
                        fold.calibrationError,
                        5
                      ),

                    leagues:
                      fold.leagues
                      ||
                      {}
                  })
                )
            };
          }
        );


      // =================================================
      // SYNTHÈSE
      // =================================================

      const improved =
        formatted.filter(
          row =>
            row.gainPct !==
            null

            &&

            row.gainPct >
            0
        ).length;


      const degraded =
        formatted.filter(
          row =>
            row.gainPct !==
            null

            &&

            row.gainPct <
            0
        ).length;


      const allFolds =
        formatted.reduce(
          (
            total,
            row
          ) =>
            total +
            Number(
              row.foldsCompleted
              ||
              0
            ),
          0
        );


      const winningFolds =
        formatted.reduce(
          (
            total,
            row
          ) =>
            total +
            Number(
              row.winningFolds
              ||
              0
            ),
          0
        );


      const progress =

        Math.min(
          100,

          Math.round(

            formatted.length

            /

            EXPECTED_EXPERIMENTS

            *

            1000
          )

          /

          10
        );


      return jsonResponse(
        200,
        {

          success:
            true,

          modelVersion:
            MODEL_VERSION,

          featureVersion:
            FEATURE_VERSION,

          since,

          expectedExperiments:
            EXPECTED_EXPERIMENTS,

          completedExperiments:
            formatted.length,

          progress,

          done:

            formatted.length >=
            EXPECTED_EXPERIMENTS,

          summary: {

            improved,

            degraded,

            totalFolds:
              allFolds,

            winningFolds
          },

          experiments:
            formatted
        }
      );


    } catch (
      error
    ) {

      console.error(
        'rolling-status:',
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
            )
        }
      );
    }
  };
