const {
  supabaseRequest
} = require('./lib/supabase');


const {
  handler: finalizeMatch
} = require('./finalize-match');


// =====================================================
// MATCHSCOPE
// AUTOMATISATION POST-MATCH
//
// RÔLE :
// - détecter les matchs récents
// - vérifier s'ils sont terminés
// - enregistrer le score final
// - enregistrer le résultat 1 / N / 2
// - évaluer les prédictions existantes
// - calculer leur Brier Score
//
// IMPORTANT :
// Cette fonction NE lance PAS l'enrichissement lourd.
// Celui-ci sera géré séparément.
// =====================================================


// =====================================================
// CONFIGURATION
// =====================================================


// On contrôle les matchs ayant commencé
// au cours des 8 dernières heures.
//
// C'est volontairement large pour couvrir :
// - retard de match
// - prolongations
// - retard de mise à jour Sportmonks
// - éventuel passage Netlify manqué
const LOOKBACK_HOURS =
  8;


// Maximum de matchs traités pendant
// une seule exécution.
const MAX_MATCHES_PER_RUN =
  20;


// V0.7 et la mémoire probabiliste
// concernent actuellement ces ligues.
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

      array(
        values
      )

        .map(
          value =>
            Number(
              value
            )
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

    array(
      rows
    )

      .map(
        row =>
          Number(
            row
              .sportmonks_fixture_id
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

    array(
      rows
    )

      .map(
        row =>
          Number(
            row
              .sportmonks_fixture_id
          )
      )

      .filter(
        Number.isFinite
      )
  );
}


// =====================================================
// FINALISATION D'UN MATCH
//
// On réutilise finalize-match.js.
//
// Donc toute la logique existante reste centralisée :
//
// Sportmonks
// → état du match
// → score final
// → résultat 1/N/2
// → Supabase results
// → Brier Score des prédictions
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

    body =
      {};
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
      // 1. CHARGEMENT DES MATCHS RÉCENTS
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


      // =================================================
      // 2. AUCUN MATCH À CONTRÔLER
      // =================================================

      if (
        !fixtureIds.length
      ) {

        const summary = {

          success:
            true,

          function:
            'postmatch-auto',

          checkedAt:
            new Date()
              .toISOString(),

          recentMatches:
            0,

          candidates:
            0,

          finalized:
            0,

          waiting:
            0,

          failed:
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
      // 3. ÉTAT SUPABASE
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


      // =================================================
      // 4. SÉLECTION DES MATCHS À CONTRÔLER
      // =================================================
      //
      // On rappelle Sportmonks seulement si :
      //
      // A. le résultat n'existe pas encore
      //
      // OU
      //
      // B. une prédiction existe mais son Brier
      //    n'a pas encore été calculé.
      //
      // Un match complètement terminé dans Supabase
      // est donc ignoré.
      // =================================================

      const candidates =
        recentMatches

          .filter(
            match => {

              const fixtureId =
                Number(
                  match
                    .sportmonks_fixture_id
                );


              if (
                !Number.isFinite(
                  fixtureId
                )
              ) {

                return false;
              }


              const resultMissing =
                !existingResults.has(
                  fixtureId
                );


              const evaluationMissing =
                unevaluatedPredictions.has(
                  fixtureId
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
      // 5. TRAITEMENT
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
                result
                  .body
                  .score
                ||
                null,

              result:
                result
                  .body
                  .result
                ||
                null,

              predictionsFound:
                Number(
                  result
                    .body
                    .predictionsFound
                )
                ||
                0,

              predictionsEvaluated:
                Number(
                  result
                    .body
                    .predictionsEvaluated
                )
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
          // AUTRE RÉPONSE SERVEUR
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
              String(
                error
              )
          });
        }
      }


      // =================================================
      // 6. RÉSUMÉ
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
              String(
                error
              )
          })
      };
    }
  };
