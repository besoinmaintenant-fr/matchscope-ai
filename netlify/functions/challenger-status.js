const {
  supabaseRequest
} = require('./lib/supabase');


// =====================================================
// MATCHSCOPE — CHALLENGER STATUS
// =====================================================

const MODEL_VERSION =
  'v0.8-shadow';


const FEATURE_VERSION =
  'features-v1';


const EXPECTED_EXPERIMENTS =
  10;


// =====================================================
// RÉPONSE JSON
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
// OUTILS
// =====================================================

function numberOrNull(
  value
) {

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
      // HEURE DE DÉPART OPTIONNELLE
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
      // GARDER LA VERSION LA PLUS RÉCENTE
      // DE CHAQUE EXPÉRIENCE
      // =================================================

      const latest =
        new Map();


      rows.forEach(
        row => {

          latest.set(
            row.experiment_name,
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
            ) =>

              String(
                first.feature_stage
              )

                .localeCompare(
                  String(
                    second.feature_stage
                  )
                )

              ||

              String(
                first.feature_family
              )

                .localeCompare(
                  String(
                    second.feature_family
                  )
                )
          );


      // =================================================
      // RÉSUMÉ
      // =================================================

      const valid =
        experiments.filter(
          experiment =>

            numberOrNull(
              experiment.brier_baseline
            ) !== null

            &&

            numberOrNull(
              experiment.brier_challenger
            ) !== null
        );


      const gains =

        valid

          .map(
            experiment =>
              numberOrNull(
                experiment.brier_gain_pct
              )
          )

          .filter(
            value =>
              value !== null
          );


      const positive =
        gains.filter(
          value =>
            value >
            0
        ).length;


      const negative =
        gains.filter(
          value =>
            value <
            0
        ).length;


      const neutral =
        gains.filter(
          value =>
            value ===
            0
        ).length;


      // =================================================
      // RÉPONSE
      // =================================================

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
            experiments.length,

          progress:

            Math.min(
              100,

              Math.round(

                experiments.length
                /
                EXPECTED_EXPERIMENTS
                *
                1000

              )

              /

              10
            ),

          done:

            experiments.length >=
            EXPECTED_EXPERIMENTS,

          summary: {

            valid:
              valid.length,

            improved:
              positive,

            degraded:
              negative,

            neutral
          },

          experiments:

            experiments.map(
              experiment => ({

                id:
                  experiment.id,

                name:
                  experiment.experiment_name,

                stage:
                  experiment.feature_stage,

                family:
                  experiment.feature_family,

                createdAt:
                  experiment.created_at,

                training:
                  experiment.training_matches,

                holdout:
                  experiment.holdout_matches,

                baselineBrier:
                  round(
                    experiment.brier_baseline,
                    6
                  ),

                challengerBrier:
                  round(
                    experiment.brier_challenger,
                    6
                  ),

                gainPct:
                  round(
                    experiment.brier_gain_pct,
                    3
                  ),

                baselineAccuracy:
                  round(
                    experiment.accuracy_baseline,
                    4
                  ),

                challengerAccuracy:
                  round(
                    experiment.accuracy_challenger,
                    4
                  ),

                calibrationError:
                  round(
                    experiment.calibration_error,
                    5
                  ),

                improved:
                  experiment.improved,

                leagues:
                  experiment.league_results,

                metadata:
                  experiment.metadata
              })
            )
        }
      );


    } catch (
      error
    ) {

      console.error(
        'challenger-status:',
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
