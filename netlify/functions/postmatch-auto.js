const {
  supabaseRequest
} = require('./lib/supabase');


const {
  handler: finalizeMatch
} = require('./finalize-match');


const {
  handler: enrichHistory
} = require('./enrich-history-background');


// =====================================================
// CONFIGURATION
// =====================================================

// On regarde les matchs ayant commencé
// au cours des 8 dernières heures.
//
// Cela couvre largement :
// match + prolongations + retard API.
const LOOKBACK_HOURS =
  8;


// Maximum de matchs finalisés
// lors d'un passage.
const MAX_MATCHES_PER_RUN =
  20;


const MODEL_LEAGUES = [
  'PL',
  'BL',
  'LL'
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


function uniqueNumbers(
  values
) {

  return Array.from(

    new Set(

      array(values)

        .map(
          value =>
            Number(value)
        )

        .filter(
          Number.isFinite
        )
    )
  );
}


// =====================================================
// MATCHS RÉCENTS CONNUS PAR MATCHSCOPE
// =====================================================

async function loadRecentMatches() {

  const now =
    new Date();


  const start =
    new Date(

      now.getTime()

      -

      LOOKBACK_HOURS *
      60 *
      60 *
      1000
    );


  const query =

    '?select='

    +

    [
      'sportmonks_fixture_id',
      'league_code',
      'starting_at',
      'status',
      'lineups_confirmed'
    ].join(',')

    +

    `&league_code=in.(${MODEL_LEAGUES.join(',')})`

    +

    `&starting_at=gte.${encodeURIComponent(
      start.toISOString()
    )}`

    +

    `&starting_at=lte.${encodeURIComponent(
      now.toISOString()
    )}`

    +

    '&order=starting_at.asc';


  const rows =
    await supabaseRequest(
      'matches',
      {
        method:
          'GET',

        query
      }
    );


  return array(
    rows
  );
}


// =====================================================
// RÉSULTATS DÉJÀ ENREGISTRÉS
// =====================================================

async function loadExistingResults(
  fixtureIds
) {

  if (
    !fixtureIds.length
  ) {

    return new Set();
  }


  const query =

    '?select=sportmonks_fixture_id'

    +

    `&sportmonks_fixture_id=in.(${fixtureIds.join(',')})`;


  const rows =
    await supabaseRequest(
      'results',
      {
        method:
          'GET',

        query
      }
    );


  return new Set(

    array(rows)

      .map(
        row =>
          Number(
            row.sportmonks_fixture_id
          )
      )

      .filter(
        Number.isFinite
      )
  );
}


// =====================================================
// PRÉDICTIONS PAS ENCORE ÉVALUÉES
// =====================================================

async function loadUnevaluatedPredictions(
  fixtureIds
) {

  if (
    !fixtureIds.length
  ) {

    return new Set();
  }


  const query =

    '?select=sportmonks_fixture_id,evaluated_at'

    +

    `&sportmonks_fixture_id=in.(${fixtureIds.join(',')})`

    +

    '&evaluated_at=is.null';


  const rows =
    await supabaseRequest(
      'predictions',
      {
        method:
          'GET',

        query
      }
    );


  return new Set(

    array(rows)

      .map(
        row =>
          Number(
            row.sportmonks_fixture_id
          )
      )

      .filter(
        Number.isFinite
      )
  );
}


// =====================================================
// FINALISER UN MATCH
//
// On réutilise directement finalize-match.js.
// Donc :
// - score final
// - résultat 1/N/2
// - Brier
// - mise à jour Supabase
//
// restent gérés par le moteur existant.
// =====================================================

async function finalizeOne(
  fixtureId,
  secret
) {

  const response =
    await finalizeMatch({

      httpMethod:
        'POST',

      headers: {

        authorization:
          `Bearer ${secret}`
      },

      body:
        JSON.stringify({

          fixtureId
        })
    });


  let body =
    {};


  try {

    body =
      JSON.parse(
        response?.body ||
        '{}'
      );

  } catch {

    body = {};
  }


  return {

    statusCode:
      Number(
        response?.statusCode
      )
      ||
      500,

    body
  };
}


// =====================================================
// ENRICHISSEMENT
//
// On réutilise le moteur déjà construit.
//
// Il ajoutera aux matchs encore non enrichis :
// - stats équipes
// - stats joueurs
// - événements
// - absences
// - formations
// - contexte disponible
//
// sans retraiter ceux déjà présents.
// =====================================================

async function runEnrichment(
  secret
) {

  await enrichHistory({

    httpMethod:
      'POST',

    body:
      JSON.stringify({

        secret
      })
  });
}


// =====================================================
// FONCTION AUTOMATIQUE
// =====================================================

exports.handler =
  async () => {

    const secret =
      process
        .env
        .MATCHSCOPE_SYNC_SECRET;


    if (
      !secret
    ) {

      console.error(
        'postmatch-auto : MATCHSCOPE_SYNC_SECRET absent.'
      );


      return {

        statusCode:
          500,

        body:
          JSON.stringify({

            success:
              false,

            error:
              'MATCHSCOPE_SYNC_SECRET absent.'
          })
      };
    }


    try {

      // =================================================
      // 1. MATCHS RÉCENTS
      // =================================================

      const recentMatches =
        await loadRecentMatches();


      const fixtureIds =
        uniqueNumbers(

          recentMatches.map(
            match =>
              match
                .sportmonks_fixture_id
          )
        );


      if (
        !fixtureIds.length
      ) {

        const summary = {

          success:
            true,

          checkedAt:
            new Date()
              .toISOString(),

          recentMatches:
            0,

          processed:
            0,

          finalized:
            0,

          waiting:
            0,

          message:
            'Aucun match récent à contrôler.'
        };


        console.log(
          JSON.stringify(
            summary,
            null,
            2
          )
        );


        return {

          statusCode:
            200,

          body:
            JSON.stringify(
              summary
            )
        };
      }


      // =================================================
      // 2. CE QUI EST DÉJÀ TERMINÉ
      // =================================================

      const [
        existingResults,
        unevaluatedPredictions
      ] =
        await Promise.all([

          loadExistingResults(
            fixtureIds
          ),

          loadUnevaluatedPredictions(
            fixtureIds
          )
        ]);


      /*
       * On rappelle Sportmonks seulement si :
       *
       * - le résultat n'existe pas encore
       *
       * OU
       *
       * - une prédiction du match attend encore
       *   son Brier Score.
       */


      const candidates =
        recentMatches

          .filter(
            match => {

              const id =
                Number(
                  match
                    .sportmonks_fixture_id
                );


              if (
                !Number.isFinite(
                  id
                )
              ) {

                return false;
              }


              const resultMissing =
                !existingResults.has(
                  id
                );


              const evaluationMissing =
                unevaluatedPredictions.has(
                  id
                );


              return (

                resultMissing

                ||

                evaluationMissing
              );
            }
          )

          .slice(
            0,
            MAX_MATCHES_PER_RUN
          );


      // =================================================
      // 3. FINALISATION
      // =================================================

      const results =
        [];


      let finalized =
        0;


      let waiting =
        0;


      let failed =
        0;


      for (
        const match
        of candidates
      ) {

        const fixtureId =
          Number(
            match
              .sportmonks_fixture_id
          );


        try {

          const result =
            await finalizeOne(
              fixtureId,
              secret
            );


          // ---------------------------------------------
          // MATCH TERMINÉ
          // ---------------------------------------------

          if (
            result.statusCode ===
            200

            &&

            result
              ?.body
              ?.finalized ===
            true
          ) {

            finalized +=
              1;


            results.push({

              fixtureId,

              status:
                'FINALIZED',

              score:
                result.body.score,

              result:
                result.body.result,

              predictionsEvaluated:
                result
                  .body
                  .predictionsEvaluated
                ||
                0
            });


            continue;
          }


          // ---------------------------------------------
          // MATCH PAS ENCORE TERMINÉ
          // ---------------------------------------------

          if (
            result.statusCode ===
            409
          ) {

            waiting +=
              1;


            results.push({

              fixtureId,

              status:
                'WAITING',

              state:
                result
                  ?.body
                  ?.state
                ||
                null
            });


            continue;
          }


          // ---------------------------------------------
          // AUTRE ERREUR
          // ---------------------------------------------

          failed +=
            1;


          results.push({

            fixtureId,

            status:
              'ERROR',

            statusCode:
              result.statusCode,

            error:

              result
                ?.body
                ?.details

              ||

              result
                ?.body
                ?.error

              ||

              'Erreur inconnue.'
          });


        } catch (
          error
        ) {

          failed +=
            1;


          results.push({

            fixtureId,

            status:
              'ERROR',

            error:
              error?.message
              ||
              String(error)
          });
        }
      }


      // =================================================
      // 4. ENRICHISSEMENT DES NOUVEAUX MATCHS
      // =================================================

      let enrichmentStarted =
        false;


      /*
       * Une fois qu'au moins un match vient
       * d'être finalisé, on demande au moteur
       * d'enrichissement de récupérer les
       * nouveaux matchs non encore enrichis.
       */


      if (
        finalized >
        0
      ) {

        try {

          await runEnrichment(
            secret
          );


          enrichmentStarted =
            true;


        } catch (
          error
        ) {

          /*
           * Une erreur d'enrichissement
           * ne doit jamais annuler
           * la finalisation du match.
           */

          console.error(

            'postmatch-auto enrichment :',

            error?.message
            ||
            error
          );
        }
      }


      // =================================================
      // 5. RÉSUMÉ
      // =================================================

      const summary = {

        success:
          true,

        function:
          'postmatch-auto',

        checkedAt:
          new Date()
            .toISOString(),

        recentMatches:
          recentMatches.length,

        candidates:
          candidates.length,

        alreadyWithResult:
          existingResults.size,

        predictionsWaitingEvaluation:
          unevaluatedPredictions.size,

        finalized,

        waiting,

        failed,

        enrichmentStarted,

        results
      };


      console.log(

        JSON.stringify(
          summary,
          null,
          2
        )
      );


      return {

        statusCode:
          200,

        body:
          JSON.stringify(
            summary
          )
      };


    } catch (
      error
    ) {

      console.error(

        'postmatch-auto :',

        error
      );


      return {

        statusCode:
          500,

        body:
          JSON.stringify({

            success:
              false,

            error:
              error?.message
              ||
              String(error)
          })
      };
    }
  };
