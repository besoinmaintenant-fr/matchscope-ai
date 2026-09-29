const {
  supabaseRequest
} = require('./lib/supabase');


const {
  saveMatch,
  saveLineups,
  lineupStatus
} = require('./lib/memory');


const API =
  'https://api.sportmonks.com/v3/football';


const LEAGUE_IDS = [
  8,    // Premier League
  82,   // Bundesliga
  564   // La Liga
];


// On commence à surveiller 3 heures avant le match.
const LOOKAHEAD_MINUTES =
  180;


// On continue jusqu'à 30 minutes après le coup d'envoi
// uniquement si aucune composition n'a encore été trouvée.
const AFTER_KICKOFF_MINUTES =
  30;


// =====================================================
// OUTILS
// =====================================================

function isoDate(
  date
) {

  return date
    .toISOString()
    .slice(
      0,
      10
    );
}


function parseKickoff(
  value
) {

  if (!value) {

    return null;
  }


  const raw =
    String(
      value
    )
      .trim();


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


// =====================================================
// 1. LISTE LÉGÈRE DES MATCHS
//
// IMPORTANT :
// ici on NE demande PAS encore les compositions.
// =====================================================

async function fetchFixtureList(
  token
) {

  const now =
    new Date();


  const tomorrow =
    new Date(
      now.getTime()
      +
      24 *
      60 *
      60 *
      1000
    );


  const fixtures =
    [];


  let page =
    1;


  let hasMore =
    true;


  while (
    hasMore &&
    page <= 10
  ) {

    const url =
      new URL(

        `${API}/fixtures/between/${isoDate(
          now
        )}/${isoDate(
          tomorrow
        )}`
      );


    url.searchParams.set(
      'api_token',
      token
    );


    url.searchParams.set(
      'filters',
      `fixtureLeagues:${LEAGUE_IDS.join(',')}`
    );


    /*
     * Requête volontairement légère.
     *
     * Pas de lineups ici.
     */

    url.searchParams.set(
      'include',
      'league;participants;state'
    );


    url.searchParams.set(
      'per_page',
      '100'
    );


    url.searchParams.set(
      'page',
      String(
        page
      )
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
        'Réponse Sportmonks illisible.'
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
      Array.isArray(
        payload?.data
      )
    ) {

      fixtures.push(
        ...payload.data
      );
    }


    hasMore =
      Boolean(
        payload
          ?.pagination
          ?.has_more
      );


    page +=
      1;
  }


  return fixtures;
}


// =====================================================
// 2. MATCHS DANS LA FENÊTRE DE SURVEILLANCE
// =====================================================

function isCandidate(
  fixture
) {

  const kickoff =
    parseKickoff(
      fixture?.starting_at
    );


  if (!kickoff) {

    return false;
  }


  const now =
    Date.now();


  const differenceMinutes =

    (
      kickoff.getTime()
      -
      now
    )

    /

    60000;


  /*
   * Exemple :
   *
   * +180 = match dans 3 heures
   * +60  = match dans 1 heure
   * 0    = coup d'envoi
   * -15  = match commencé depuis 15 min
   */


  if (
    differenceMinutes >
    LOOKAHEAD_MINUTES
  ) {

    return false;
  }


  if (
    differenceMinutes <
    -AFTER_KICKOFF_MINUTES
  ) {

    return false;
  }


  return true;
}


// =====================================================
// 3. VÉRIFICATION SUPABASE
//
// On regarde quels matchs possèdent déjà
// lineups_confirmed = true.
//
// Ceux-là seront définitivement ignorés.
// =====================================================

async function getConfirmedFixtureIds(
  fixtureIds
) {

  if (
    !fixtureIds.length
  ) {

    return new Set();
  }


  const cleanIds =

    fixtureIds

      .map(
        numberOrNull
      )

      .filter(
        value =>
          value !== null
      );


  if (
    !cleanIds.length
  ) {

    return new Set();
  }


  const query =

    '?select='

    +

    [
      'sportmonks_fixture_id',
      'lineups_confirmed'
    ].join(',')

    +

    `&sportmonks_fixture_id=in.(${cleanIds.join(',')})`;


  const rows =
    await supabaseRequest(
      'matches',
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

    return new Set();
  }


  return new Set(

    rows

      .filter(
        row =>
          row.lineups_confirmed ===
          true
      )

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
// 4. MATCH DÉTAILLÉ
//
// Cette requête n'est exécutée QUE si
// la composition n'est pas encore enregistrée.
// =====================================================

async function fetchFixtureDetails(
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

    [
      'league',
      'participants',
      'venue',
      'state',
      'lineups.player',
      'formations'
    ].join(';')
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
      'Réponse détaillée Sportmonks invalide.'
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
      'Match Sportmonks introuvable.'
    );
  }


  return payload.data;
}


// =====================================================
// 5. TRAITEMENT D'UN MATCH
// =====================================================

async function processFixture(
  lightFixture,
  token
) {

  const fixtureId =
    Number(
      lightFixture?.id
    );


  if (
    !Number.isFinite(
      fixtureId
    )
  ) {

    return {

      fixtureId:
        null,

      status:
        'INVALID_FIXTURE'
    };
  }


  /*
   * Seulement maintenant on demande
   * la version détaillée à Sportmonks.
   */

  const fixture =
    await fetchFixtureDetails(
      fixtureId,
      token
    );


  const lineup =
    lineupStatus(
      fixture
    );


  // -----------------------------------------------
  // XI PAS ENCORE OFFICIELS
  // -----------------------------------------------

  if (
    !lineup.official
  ) {

    return {

      fixtureId,

      status:
        'WAITING',

      startersFound:
        lineup.starters.length
    };
  }


  // -----------------------------------------------
  // XI OFFICIELS TROUVÉS
  // -----------------------------------------------

  await saveMatch(
    fixture,
    true
  );


  const savedLineups =
    await saveLineups(
      fixture
    );


  return {

    fixtureId,

    status:
      'SAVED',

    startersFound:
      lineup.starters.length,

    lineupRows:
      Array.isArray(
        savedLineups
      )
        ? savedLineups.length
        : null
  };
}


// =====================================================
// 6. FONCTION PLANIFIÉE NETLIFY
// =====================================================

exports.handler =
  async () => {

    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (!token) {

      console.error(
        'collect-lineups : SPORTMONKS_API_TOKEN absent.'
      );


      return {

        statusCode:
          500,

        body:
          'SPORTMONKS_API_TOKEN absent.'
      };
    }


    try {

      // ---------------------------------------------
      // ÉTAPE A
      // Liste légère des matchs
      // ---------------------------------------------

      const fixtures =
        await fetchFixtureList(
          token
        );


      // ---------------------------------------------
      // ÉTAPE B
      // Seulement les matchs proches
      // ---------------------------------------------

      const candidates =
        fixtures.filter(
          isCandidate
        );


      const fixtureIds =
        candidates

          .map(
            fixture =>
              Number(
                fixture.id
              )
          )

          .filter(
            Number.isFinite
          );


      // ---------------------------------------------
      // ÉTAPE C
      // Vérification mémoire Supabase
      // ---------------------------------------------

      const confirmedIds =
        await getConfirmedFixtureIds(
          fixtureIds
        );


      // ---------------------------------------------
      // ÉTAPE D
      // On supprime les matchs déjà terminés
      // côté collecte des compositions.
      // ---------------------------------------------

      const unresolved =
        candidates.filter(
          fixture =>

            !confirmedIds.has(
              Number(
                fixture.id
              )
            )
        );


      const results =
        [];


      /*
       * Les matchs ayant déjà une composition
       * ne sont PAS rechargés en détail.
       */

      candidates.forEach(
        fixture => {

          const fixtureId =
            Number(
              fixture.id
            );


          if (
            confirmedIds.has(
              fixtureId
            )
          ) {

            results.push({

              fixtureId,

              status:
                'ALREADY_CONFIRMED_SKIPPED'
            });
          }
        }
      );


      // ---------------------------------------------
      // ÉTAPE E
      // Seulement les matchs restant à surveiller
      // ---------------------------------------------

      for (
        const fixture
        of unresolved
      ) {

        try {

          const result =
            await processFixture(
              fixture,
              token
            );


          results.push(
            result
          );


        } catch (
          error
        ) {

          results.push({

            fixtureId:
              fixture?.id
              ||
              null,

            status:
              'ERROR',

            error:
              error?.message
              ||
              String(error)
          });
        }
      }


      // ---------------------------------------------
      // LOG SERVEUR
      // ---------------------------------------------

      const summary = {

        function:
          'collect-lineups',

        checkedAt:
          new Date()
            .toISOString(),

        fixturesReceived:
          fixtures.length,

        candidates:
          candidates.length,

        alreadyConfirmed:
          confirmedIds.size,

        checkedForLineups:
          unresolved.length,

        saved:
          results.filter(
            item =>
              item.status ===
              'SAVED'
          ).length,

        waiting:
          results.filter(
            item =>
              item.status ===
              'WAITING'
          ).length,

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
        'collect-lineups :',
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
