const {
  supabaseRequest
} = require('./lib/supabase');


const {
  lineupStatus
} = require('./lib/memory');


const API =
  'https://api.sportmonks.com/v3/football';


// =====================================================
// MATCHSCOPE — PREMATCH SNAPSHOTS
//
// Ce collecteur mémorise l'état RÉEL des données
// disponibles avant un match.
//
// D1   ≈ 24 h avant
// H6   ≈ 6 h avant
// H3   ≈ 3 h avant
// H90  ≈ 90 min avant
//
// FINAL sera enregistré au moment où les XI
// officiels seront détectés par collect-lineups.
//
// IMPORTANT :
// un snapshot déjà enregistré n'est jamais écrasé.
// =====================================================


const LEAGUE_IDS = [
  8,      // Premier League
  82,     // Bundesliga
  564     // La Liga
];


const LEAGUE_CODES = {
  8: 'PL',
  82: 'BL',
  564: 'LL'
};


// =====================================================
// FENÊTRES DE CAPTURE
//
// Elles sont volontairement assez larges
// pour supporter un cron toutes les 30 minutes.
//
// Un snapshot reste une photographie réelle.
// Si la fenêtre est ratée, on ne le recrée
// PAS artificiellement après coup.
// =====================================================

const WINDOWS = [

  {
    stage: 'D1',
    minMinutes: 1380,   // 23 h
    maxMinutes: 1500    // 25 h
  },

  {
    stage: 'H6',
    minMinutes: 330,    // 5 h 30
    maxMinutes: 390     // 6 h 30
  },

  {
    stage: 'H3',
    minMinutes: 150,    // 2 h 30
    maxMinutes: 210     // 3 h 30
  },

  {
    stage: 'H90',
    minMinutes: 75,
    maxMinutes: 105
  }

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


function minutesUntil(
  date
) {

  return (

    date.getTime()
    -
    Date.now()

  )

  /

  60000;
}


function getTeam(
  fixture,
  location
) {

  return array(
    fixture?.participants
  )

    .find(
      participant =>

        participant
          ?.meta
          ?.location ===
        location
    )

    ||

    null;
}


// =====================================================
// RELATIONS SPORTMONKS
//
// Certains noms peuvent varier légèrement
// selon la réponse de l'API.
// =====================================================

function firstDefined(
  object,
  names
) {

  for (
    const name
    of names
  ) {

    if (
      object?.[name] !==
      undefined
    ) {

      return object[
        name
      ];
    }
  }


  return null;
}


// =====================================================
// STAGE ACTUEL
// =====================================================

function dueStage(
  fixture
) {

  const kickoff =
    parseKickoff(
      fixture?.starting_at
    );


  if (
    !kickoff
  ) {

    return null;
  }


  const minutes =
    minutesUntil(
      kickoff
    );


  for (
    const window
    of WINDOWS
  ) {

    if (
      minutes >=
      window.minMinutes

      &&

      minutes <=
      window.maxMinutes
    ) {

      return {

        stage:
          window.stage,

        kickoff,

        minutes
      };
    }
  }


  return null;
}


// =====================================================
// LISTE LÉGÈRE DES MATCHS
//
// On regarde jusqu'à J+2 pour pouvoir attraper
// correctement la fenêtre D1 même en fin de journée.
// =====================================================

async function fetchFixtureList(
  token
) {

  const now =
    new Date();


  const end =
    new Date(

      now.getTime()

      +

      2 *
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
    hasMore

    &&

    page <=
    10
  ) {

    const url =
      new URL(

        `${API}/fixtures/between/${isoDate(
          now
        )}/${isoDate(
          end
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
     * Requête volontairement très légère.
     *
     * Tant qu'aucun snapshot n'est dû,
     * on ne télécharge pas toutes les données.
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


    let payload =
      {};


    try {

      payload =
        JSON.parse(
          raw
        );

    } catch {

      throw new Error(
        'Réponse Sportmonks fixtures illisible.'
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
// SNAPSHOTS DÉJÀ EXISTANTS
// =====================================================

async function loadExistingSnapshots(
  fixtureIds
) {

  const ids =
    array(
      fixtureIds
    )

      .map(
        numberOrNull
      )

      .filter(
        value =>
          value !== null
      );


  const existing =
    new Set();


  if (
    !ids.length
  ) {

    return existing;
  }


  const rows =
    await supabaseRequest(
      'prematch_snapshots',
      {

        method:
          'GET',

        query:

          '?select='

          +

          [
            'sportmonks_fixture_id',
            'snapshot_stage'
          ].join(',')

          +

          `&sportmonks_fixture_id=in.(${ids.join(',')})`
      }
    );


  array(
    rows
  )

    .forEach(
      row => {

        existing.add(

          `${row.sportmonks_fixture_id}:${row.snapshot_stage}`
        );
      }
    );


  return existing;
}


// =====================================================
// MATCH DÉTAILLÉ
//
// Ce bloc contient uniquement les données que
// nous savons actuellement récupérer correctement.
//
// Pas de xG / expectedLineups ici :
// ton abonnement ne les fournit pas.
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

      'metadata',

      'formations',

      'weatherReport',

      'coaches',

      'referees',

      'sidelined.player',

      'sidelined.type',

      'sidelined.sideline',

      'statistics.type',

      'lineups.player'

    ].join(';')
  );


  const response =
    await fetch(
      url
    );


  const raw =
    await response.text();


  let payload =
    {};


  try {

    payload =
      JSON.parse(
        raw
      );

  } catch {

    throw new Error(
      'Réponse Sportmonks détaillée illisible.'
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
// COTES — APPEL OPTIONNEL
//
// Si Sportmonks ne permet pas cette relation
// avec l'abonnement actuel, le snapshot principal
// est quand même enregistré.
// =====================================================

async function fetchOptionalOdds(
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
    'odds.bookmaker'
  );


  const response =
    await fetch(
      url
    );


  const raw =
    await response.text();


  let payload =
    null;


  try {

    payload =
      JSON.parse(
        raw
      );

  } catch {

    payload =
      null;
  }


  if (
    !response.ok
  ) {

    return {

      ok:
        false,

      status:
        response.status,

      error:

        payload?.message

        ||

        payload?.error

        ||

        `HTTP ${response.status}`,

      odds:
        null
    };
  }


  return {

    ok:
      true,

    status:
      response.status,

    error:
      null,

    odds:
      firstDefined(
        payload?.data,
        [
          'odds',
          'Odds'
        ]
      )
  };
}


// =====================================================
// COUVERTURE
//
// On mesure ici la disponibilité des familles
// de données, pas leur qualité prédictive.
// =====================================================

function coverage(
  values
) {

  const list =
    Object.values(
      values
    );


  if (
    !list.length
  ) {

    return 0;
  }


  const available =
    list.filter(
      value =>

        value !==
        null

        &&

        value !==
        undefined
    ).length;


  return Math.round(

    available

    /

    list.length

    *

    1000

  )

  /

  10;
}


// =====================================================
// CONSTRUCTION DU SNAPSHOT
// =====================================================

function buildSnapshotRow({

  fixture,

  stage,

  kickoff,

  minutes,

  oddsResult

}) {

  const fixtureId =
    Number(
      fixture?.id
    );


  const leagueId =
    numberOrNull(
      fixture?.league_id
    );


  const home =
    getTeam(
      fixture,
      'home'
    );


  const away =
    getTeam(
      fixture,
      'away'
    );


  const lineup =
    lineupStatus(
      fixture
    );


  const venue =
    firstDefined(
      fixture,
      [
        'venue'
      ]
    );


  const metadata =
    firstDefined(
      fixture,
      [
        'metadata'
      ]
    );


  const weather =
    firstDefined(
      fixture,
      [
        'weatherreport',
        'weatherReport',
        'weather_report'
      ]
    );


  const formations =
    firstDefined(
      fixture,
      [
        'formations'
      ]
    );


  const sidelined =
    firstDefined(
      fixture,
      [
        'sidelined'
      ]
    );


  const lineups =
    firstDefined(
      fixture,
      [
        'lineups'
      ]
    );


  const statistics =
    firstDefined(
      fixture,
      [
        'statistics'
      ]
    );


  const odds =
    oddsResult?.ok

      ? oddsResult.odds

      : null;


  const dataCoverage =
    coverage({

      venue,

      metadata,

      weather,

      formations,

      sidelined,

      lineups,

      statistics,

      odds
    });


  const capturedAt =
    new Date()
      .toISOString();


  /*
   * On ajoute les cotes optionnelles au raw_fixture
   * afin de conserver une photographie aussi complète
   * que possible de ce qui existait à cet instant.
   */
  const rawFixture = {

    ...fixture,

    snapshot_odds:
      odds
  };


  return {

    sportmonks_fixture_id:
      fixtureId,

    league_code:
      LEAGUE_CODES[
        leagueId
      ]
      ||
      null,

    snapshot_stage:
      stage,

    captured_at:
      capturedAt,

    kickoff_at:
      kickoff.toISOString(),

    minutes_to_kickoff:
      Math.round(
        minutes
      ),

    lineups_official:
      lineup.official,

    starters_found:
      lineup.starters.length,

    data_coverage:
      dataCoverage,

    home_team_id:
      numberOrNull(
        home?.id
      ),

    away_team_id:
      numberOrNull(
        away?.id
      ),

    venue,

    state:
      fixture?.state
      ??
      null,

    metadata,

    weather_report:
      weather,

    formations,

    sidelined,

    lineups,

    statistics,

    odds,

    optional_status: {

      odds: {

        attempted:
          true,

        ok:
          oddsResult?.ok
          ===
          true,

        http_status:
          oddsResult?.status
          ??
          null,

        error:
          oddsResult?.error
          ??
          null
      },

      captured_stage:
        stage,

      captured_at:
        capturedAt
    },

    raw_fixture:
      rawFixture,

    updated_at:
      capturedAt
  };
}


// =====================================================
// SAUVEGARDE IMMUTABLE
//
// resolution=ignore-duplicates permet de ne jamais
// écraser le premier snapshot authentique.
// =====================================================

async function saveSnapshot(
  row
) {

  return supabaseRequest(
    'prematch_snapshots',
    {

      method:
        'POST',

      query:

        '?on_conflict='

        +

        encodeURIComponent(
          'sportmonks_fixture_id,snapshot_stage'
        ),

      body:
        row,

      prefer:
        'resolution=ignore-duplicates,return=representation'
    }
  );
}


// =====================================================
// TRAITEMENT D'UN SNAPSHOT
// =====================================================

async function processSnapshot(
  candidate,
  token
) {

  const fixtureId =
    Number(
      candidate.fixture?.id
    );


  const fixture =
    await fetchFixtureDetails(
      fixtureId,
      token
    );


  /*
   * Cotes optionnelles.
   *
   * Leur indisponibilité ne bloque jamais
   * l'enregistrement du snapshot principal.
   */
  let oddsResult =
    {

      ok:
        false,

      status:
        null,

      error:
        'NOT_ATTEMPTED',

      odds:
        null
    };


  try {

    oddsResult =
      await fetchOptionalOdds(
        fixtureId,
        token
      );

  } catch (
    error
  ) {

    oddsResult = {

      ok:
        false,

      status:
        null,

      error:
        error?.message
        ||
        String(
          error
        ),

      odds:
        null
    };
  }


  const row =
    buildSnapshotRow({

      fixture,

      stage:
        candidate.stage,

      kickoff:
        candidate.kickoff,

      minutes:
        candidate.minutes,

      oddsResult
    });


  const saved =
    await saveSnapshot(
      row
    );


  return {

    fixtureId,

    stage:
      candidate.stage,

    status:

      Array.isArray(
        saved
      )

      &&

      saved.length

        ? 'SAVED'

        : 'ALREADY_EXISTS',

    minutesToKickoff:
      row.minutes_to_kickoff,

    lineupsOfficial:
      row.lineups_official,

    startersFound:
      row.starters_found,

    dataCoverage:
      row.data_coverage,

    oddsAvailable:
      oddsResult?.ok ===
      true
  };
}


// =====================================================
// HANDLER
// =====================================================

exports.handler =
  async () => {

    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (
      !token
    ) {

      return {

        statusCode:
          500,

        body:
          JSON.stringify({

            success:
              false,

            error:
              'SPORTMONKS_API_TOKEN absent.'
          })
      };
    }


    try {

      // =================================================
      // 1. LISTE LÉGÈRE
      // =================================================

      const fixtures =
        await fetchFixtureList(
          token
        );


      // =================================================
      // 2. IDENTIFIER LES SNAPSHOTS DUS
      // =================================================

      const candidates =
        [];


      for (
        const fixture
        of fixtures
      ) {

        const due =
          dueStage(
            fixture
          );


        if (
          !due
        ) {

          continue;
        }


        const fixtureId =
          Number(
            fixture?.id
          );


        if (
          !Number.isFinite(
            fixtureId
          )
        ) {

          continue;
        }


        candidates.push({

          fixture,

          fixtureId,

          stage:
            due.stage,

          kickoff:
            due.kickoff,

          minutes:
            due.minutes
        });
      }


      // =================================================
      // 3. RIEN À FAIRE
      //
      // Aucun appel détaillé Sportmonks.
      // =================================================

      if (
        !candidates.length
      ) {

        const summary = {

          success:
            true,

          function:
            'collect-prematch-snapshots',

          checkedAt:
            new Date()
              .toISOString(),

          fixturesReceived:
            fixtures.length,

          candidates:
            0,

          detailedCalls:
            0,

          saved:
            0,

          message:
            'Aucun snapshot dû actuellement.'
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
      // 4. SNAPSHOTS DÉJÀ PRÉSENTS
      // =================================================

      const existing =
        await loadExistingSnapshots(

          candidates.map(
            candidate =>
              candidate.fixtureId
          )
        );


      const unresolved =
        candidates.filter(
          candidate =>

            !existing.has(

              `${candidate.fixtureId}:${candidate.stage}`
            )
        );


      // =================================================
      // 5. SEULEMENT LES SNAPSHOTS MANQUANTS
      // =================================================

      const results =
        [];


      candidates.forEach(
        candidate => {

          const key =
            `${candidate.fixtureId}:${candidate.stage}`;


          if (
            existing.has(
              key
            )
          ) {

            results.push({

              fixtureId:
                candidate.fixtureId,

              stage:
                candidate.stage,

              status:
                'ALREADY_EXISTS_SKIPPED'
            });
          }
        }
      );


      for (
        const candidate
        of unresolved
      ) {

        try {

          const result =
            await processSnapshot(
              candidate,
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
              candidate.fixtureId,

            stage:
              candidate.stage,

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
          'collect-prematch-snapshots',

        checkedAt:
          new Date()
            .toISOString(),

        fixturesReceived:
          fixtures.length,

        candidates:
          candidates.length,

        alreadyExisting:
          candidates.length -
          unresolved.length,

        detailedCalls:
          unresolved.length,

        saved:
          results.filter(
            result =>
              result.status ===
              'SAVED'
          ).length,

        errors:
          results.filter(
            result =>
              result.status ===
              'ERROR'
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

        headers: {

          'content-type':
            'application/json; charset=utf-8',

          'cache-control':
            'no-store'
        },

        body:
          JSON.stringify(
            summary
          )
      };


    } catch (
      error
    ) {

      console.error(

        'collect-prematch-snapshots:',

        error
      );


      return {

        statusCode:
          500,

        headers: {

          'content-type':
            'application/json; charset=utf-8'
        },

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
