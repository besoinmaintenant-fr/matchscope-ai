const {
  supabaseRequest
} = require('./lib/supabase');


const API =
  'https://api.sportmonks.com/v3/football';


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
// SÉCURITÉ
// =====================================================

function authorized(
  event
) {

  const secret =
    process
      .env
      .MATCHSCOPE_SYNC_SECRET;


  if (!secret) {

    return {
      ok: false,
      reason:
        'MATCHSCOPE_SYNC_SECRET absent.'
    };
  }


  const authorization =

    event
      ?.headers
      ?.authorization

    ||

    event
      ?.headers
      ?.Authorization

    ||

    '';


  return {

    ok:
      authorization ===
      `Bearer ${secret}`,

    reason:
      'Accès non autorisé.'
  };
}


// =====================================================
// SCORE
// =====================================================

function getFinalScore(
  scores = []
) {

  const result = {

    home:
      null,

    away:
      null
  };


  scores.forEach(
    item => {

      if (
        item?.description !==
        'CURRENT'
      ) {

        return;
      }


      const side =
        item
          ?.score
          ?.participant;


      const goals =
        Number(
          item
            ?.score
            ?.goals
        );


      if (
        side === 'home' &&
        Number.isFinite(goals)
      ) {

        result.home =
          goals;
      }


      if (
        side === 'away' &&
        Number.isFinite(goals)
      ) {

        result.away =
          goals;
      }
    }
  );


  return result;
}


function result1X2(
  home,
  away
) {

  if (
    home > away
  ) {

    return '1';
  }


  if (
    away > home
  ) {

    return '2';
  }


  return 'N';
}


// =====================================================
// BRIER MULTICLASSE
// =====================================================

function brierScore(
  prediction,
  actualResult
) {

  const probabilities = {

    home:
      Number(
        prediction.probability_home
      ),

    draw:
      Number(
        prediction.probability_draw
      ),

    away:
      Number(
        prediction.probability_away
      )
  };


  if (
    !Number.isFinite(
      probabilities.home
    ) ||
    !Number.isFinite(
      probabilities.draw
    ) ||
    !Number.isFinite(
      probabilities.away
    )
  ) {

    return null;
  }


  const actual = {

    home:
      actualResult === '1'
        ? 1
        : 0,

    draw:
      actualResult === 'N'
        ? 1
        : 0,

    away:
      actualResult === '2'
        ? 1
        : 0
  };


  return (

    Math.pow(
      probabilities.home -
      actual.home,
      2
    )

    +

    Math.pow(
      probabilities.draw -
      actual.draw,
      2
    )

    +

    Math.pow(
      probabilities.away -
      actual.away,
      2
    )
  );
}


// =====================================================
// SPORTMONKS
// =====================================================

async function fetchFixture(
  fixtureId,
  token
) {

  const url =
    new URL(

      `${API}/fixtures/${encodeURIComponent(
        fixtureId
      )}`
    );


  url.searchParams.set(
    'api_token',
    token
  );


  url.searchParams.set(
    'include',
    'scores;state'
  );


  const response =
    await fetch(
      url
    );


  const raw =
    await response.text();


  let payload;


  try {

    payload =
      JSON.parse(
        raw
      );

  } catch {

    throw new Error(
      'Réponse Sportmonks invalide.'
    );
  }


  if (
    !response.ok
  ) {

    throw new Error(

      payload?.message

      ||

      payload?.error

      ||

      `Sportmonks ${response.status}`
    );
  }


  if (
    !payload?.data
  ) {

    throw new Error(
      'Fixture Sportmonks introuvable.'
    );
  }


  return payload.data;
}


// =====================================================
// MATCH TERMINÉ ?
// =====================================================

function finalState(
  fixture
) {

  const state =

    String(

      fixture
        ?.state
        ?.developer_name

      ||

      fixture
        ?.state
        ?.short_name

      ||

      ''
    )
      .trim()
      .toUpperCase();


  return {

    state,

    finished:

      [
        'FT',
        'AET',
        'AP'
      ].includes(
        state
      )
  };
}


// =====================================================
// CHARGER LES PRÉDICTIONS
// =====================================================

async function loadPredictions(
  fixtureId
) {

  const query =

    `?sportmonks_fixture_id=eq.${encodeURIComponent(
      fixtureId
    )}`

    +

    '&select=*'

    +

    '&order=generated_at.asc';


  const rows =
    await supabaseRequest(
      'predictions',
      {

        method:
          'GET',

        query
      }
    );


  return Array.isArray(
    rows
  )
    ? rows
    : [];
}


// =====================================================
// ENREGISTRER LE RÉSULTAT
// =====================================================

async function saveResult(
  fixtureId,
  fixture,
  homeScore,
  awayScore,
  actualResult
) {

  const now =
    new Date()
      .toISOString();


  const row = {

    sportmonks_fixture_id:
      fixtureId,

    home_score:
      homeScore,

    away_score:
      awayScore,

    result_1x2:
      actualResult,

    finished_at:
      now,

    raw_data:
      fixture,

    updated_at:
      now
  };


  return supabaseRequest(
    'results',
    {

      method:
        'POST',

      query:
        '?on_conflict=sportmonks_fixture_id',

      body:
        row,

      prefer:
        'resolution=merge-duplicates,return=representation'
    }
  );
}


// =====================================================
// METTRE LE MATCH EN TERMINÉ
// =====================================================

async function updateMatch(
  fixtureId,
  state
) {

  return supabaseRequest(
    'matches',
    {

      method:
        'PATCH',

      query:

        `?sportmonks_fixture_id=eq.${encodeURIComponent(
          fixtureId
        )}`,

      body: {

        status:
          state,

        updated_at:
          new Date()
            .toISOString()
      },

      prefer:
        'return=minimal'
    }
  );
}


// =====================================================
// NOTER UNE PRÉDICTION
// =====================================================

async function evaluatePrediction(
  prediction,
  actualResult
) {

  const brier =
    brierScore(
      prediction,
      actualResult
    );


  if (
    brier === null
  ) {

    throw new Error(

      `Impossible de calculer le Brier de la prédiction ${prediction.id}.`
    );
  }


  const evaluatedAt =
    new Date()
      .toISOString();


  await supabaseRequest(
    'predictions',
    {

      method:
        'PATCH',

      query:

        `?id=eq.${encodeURIComponent(
          prediction.id
        )}`,

      body: {

        brier_score:
          Number(
            brier.toFixed(8)
          ),

        evaluated_at:
          evaluatedAt
      },

      prefer:
        'return=minimal'
    }
  );


  return {

    predictionId:
      prediction.id,

    modelVersion:
      prediction.model_version,

    stage:
      prediction.prediction_stage,

    home:
      Number(
        prediction.probability_home
      ),

    draw:
      Number(
        prediction.probability_draw
      ),

    away:
      Number(
        prediction.probability_away
      ),

    brier:
      Number(
        brier.toFixed(8)
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

          error:
            'Méthode non autorisée.'
        }
      );
    }


    const access =
      authorized(
        event
      );


    if (
      !access.ok
    ) {

      return jsonResponse(
        401,
        {

          error:
            access.reason
        }
      );
    }


    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (!token) {

      return jsonResponse(
        500,
        {

          error:
            'SPORTMONKS_API_TOKEN absent.'
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

      return jsonResponse(
        400,
        {

          error:
            'JSON invalide.'
        }
      );
    }


    const fixtureId =
      Number(
        body.fixtureId
      );


    if (
      !Number.isFinite(
        fixtureId
      )
    ) {

      return jsonResponse(
        400,
        {

          error:
            'fixtureId invalide.'
        }
      );
    }


    try {

      // ---------------------------------
      // 1. SPORTMONKS
      // ---------------------------------

      const fixture =
        await fetchFixture(
          fixtureId,
          token
        );


      const state =
        finalState(
          fixture
        );


      if (
        !state.finished
      ) {

        return jsonResponse(
          409,
          {

            finalized:
              false,

            fixtureId,

            state:
              state.state,

            message:
              'Le match n’est pas encore terminé.'
          }
        );
      }


      // ---------------------------------
      // 2. SCORE FINAL
      // ---------------------------------

      const score =
        getFinalScore(

          Array.isArray(
            fixture?.scores
          )

            ? fixture.scores

            : []
        );


      if (
        score.home === null ||
        score.away === null
      ) {

        throw new Error(
          'Score final Sportmonks introuvable.'
        );
      }


      const actualResult =
        result1X2(

          score.home,

          score.away
        );


      // ---------------------------------
      // 3. RÉSULTAT
      // ---------------------------------

      await saveResult(

        fixtureId,

        fixture,

        score.home,

        score.away,

        actualResult
      );


      // ---------------------------------
      // 4. MATCH
      // ---------------------------------

      await updateMatch(

        fixtureId,

        state.state
      );


      // ---------------------------------
      // 5. PRÉDICTIONS MATCHSCOPE
      // ---------------------------------

      const predictions =
        await loadPredictions(
          fixtureId
        );


      const evaluations =
        [];


      for (
        const prediction
        of predictions
      ) {

        const evaluation =
          await evaluatePrediction(

            prediction,

            actualResult
          );


        evaluations.push(
          evaluation
        );
      }


      // ---------------------------------
      // 6. RÉPONSE
      // ---------------------------------

      return jsonResponse(
        200,
        {

          finalized:
            true,

          fixtureId,

          state:
            state.state,

          score: {

            home:
              score.home,

            away:
              score.away
          },

          result:
            actualResult,

          predictionsFound:
            predictions.length,

          predictionsEvaluated:
            evaluations.length,

          evaluations
        }
      );


    } catch (
      error
    ) {

      console.error(
        'MatchScope finalize-match:',
        error
      );


      return jsonResponse(
        500,
        {

          finalized:
            false,

          error:
            'Erreur finalize-match.',

          details:
            error?.message
            ||
            String(error)
        }
      );
    }
  };
