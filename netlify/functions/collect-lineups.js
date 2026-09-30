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

const LEAGUE_CODES = {
  8: 'PL',
  82: 'BL',
  564: 'LL'
};

// Surveillance des XI à partir de H-60.
const LOOKAHEAD_MINUTES = 60;

// On continue 30 min après le coup d'envoi
// si les XI n'ont toujours pas été mémorisés.
const AFTER_KICKOFF_MINUTES = 30;


// =====================================================
// OUTILS
// =====================================================

function array(value) {
  return Array.isArray(value)
    ? value
    : [];
}


function isoDate(date) {
  return date
    .toISOString()
    .slice(0, 10);
}


function parseKickoff(value) {

  if (!value) {
    return null;
  }

  const raw =
    String(value).trim();

  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
      .test(raw)
  ) {
    return new Date(
      raw.replace(' ', 'T') + 'Z'
    );
  }

  const date =
    new Date(raw);

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}


function numberOrNull(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function getTeam(
  fixture,
  location
) {

  return array(
    fixture?.participants
  ).find(
    participant =>
      participant
        ?.meta
        ?.location === location
  ) || null;
}


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
      return object[name];
    }
  }

  return null;
}


function coverage(values) {

  const list =
    Object.values(values);

  if (!list.length) {
    return 0;
  }

  const available =
    list.filter(
      value =>
        value !== null &&
        value !== undefined
    ).length;

  return Math.round(
    (
      available /
      list.length
    ) * 1000
  ) / 10;
}


// =====================================================
// LISTE LÉGÈRE DES MATCHS
// =====================================================

async function fetchFixtureList(
  token
) {

  const now =
    new Date();

  const tomorrow =
    new Date(
      now.getTime() +
      24 * 60 * 60 * 1000
    );

  const fixtures = [];

  let page = 1;
  let hasMore = true;

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
     * Requête légère.
     * Pas encore de compositions.
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
      String(page)
    );

    const response =
      await fetch(url);

    const raw =
      await response.text();

    let payload;

    try {

      payload =
        JSON.parse(raw);

    } catch {

      throw new Error(
        'Réponse Sportmonks illisible.'
      );
    }

    if (!response.ok) {

      throw new Error(
        payload?.message ||
        payload?.error ||
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

    page += 1;
  }

  return fixtures;
}


// =====================================================
// MATCH PROCHE DU COUP D'ENVOI
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

  const differenceMinutes =
    (
      kickoff.getTime() -
      Date.now()
    )
    / 60000;

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
// MATCHS AYANT DÉJÀ LE XI
// =====================================================

async function getConfirmedFixtureIds(
  fixtureIds
) {

  if (!fixtureIds.length) {
    return new Set();
  }

  const cleanIds =
    fixtureIds
      .map(numberOrNull)
      .filter(
        value =>
          value !== null
      );

  if (!cleanIds.length) {
    return new Set();
  }

  const rows =
    await supabaseRequest(
      'matches',
      {
        method: 'GET',

        query:
          '?select=' +
          [
            'sportmonks_fixture_id',
            'lineups_confirmed'
          ].join(',')
          +
          `&sportmonks_fixture_id=in.(${cleanIds.join(',')})`
      }
    );

  if (!Array.isArray(rows)) {
    return new Set();
  }

  return new Set(
    rows
      .filter(
        row =>
          row.lineups_confirmed === true
      )
      .map(
        row =>
          Number(
            row.sportmonks_fixture_id
          )
      )
      .filter(Number.isFinite)
  );
}


// =====================================================
// FINAL SNAPSHOTS DÉJÀ ENREGISTRÉS
// =====================================================

async function getFinalSnapshotIds(
  fixtureIds
) {

  if (!fixtureIds.length) {
    return new Set();
  }

  const cleanIds =
    fixtureIds
      .map(numberOrNull)
      .filter(
        value =>
          value !== null
      );

  if (!cleanIds.length) {
    return new Set();
  }

  const rows =
    await supabaseRequest(
      'prematch_snapshots',
      {
        method: 'GET',

        query:
          '?select=sportmonks_fixture_id'
          +
          '&snapshot_stage=eq.FINAL'
          +
          `&sportmonks_fixture_id=in.(${cleanIds.join(',')})`
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
      .filter(Number.isFinite)
  );
}


// =====================================================
// MATCH DÉTAILLÉ
//
// Une seule requête Sportmonks.
//
// Cette même réponse sert :
// - à enregistrer les XI,
// - à enregistrer le match,
// - à créer le snapshot FINAL.
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
      'lineups.player',
      'formations',
      'weatherReport',
      'sidelined.sideline',
      'statistics.type',
      'odds.bookmaker'
    ].join(';')
  );

  const response =
    await fetch(url);

  const raw =
    await response.text();

  let payload;

  try {

    payload =
      JSON.parse(raw);

  } catch {

    throw new Error(
      'Réponse détaillée Sportmonks invalide.'
    );
  }

  if (!response.ok) {

    throw new Error(
      payload?.message ||
      payload?.error ||
      `Sportmonks ${response.status}`
    );
  }

  if (!payload?.data) {

    throw new Error(
      'Match Sportmonks introuvable.'
    );
  }

  return payload.data;
}


// =====================================================
// CONSTRUCTION SNAPSHOT FINAL
// =====================================================

function buildFinalSnapshot(
  fixture
) {

  const kickoff =
    parseKickoff(
      fixture?.starting_at
    );

  if (!kickoff) {

    throw new Error(
      'Kickoff invalide pour snapshot FINAL.'
    );
  }

  const lineup =
    lineupStatus(
      fixture
    );

  if (!lineup.official) {

    throw new Error(
      'Impossible de créer FINAL sans XI officiels.'
    );
  }

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

  const venue =
    firstDefined(
      fixture,
      ['venue']
    );

  const metadata =
    firstDefined(
      fixture,
      ['metadata']
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
      ['formations']
    );

  const sidelined =
    firstDefined(
      fixture,
      ['sidelined']
    );

  const lineups =
    firstDefined(
      fixture,
      ['lineups']
    );

  const statistics =
    firstDefined(
      fixture,
      ['statistics']
    );

  const odds =
    firstDefined(
      fixture,
      ['odds']
    );

  const capturedAt =
    new Date()
      .toISOString();

  const minutesToKickoff =
    Math.round(
      (
        kickoff.getTime() -
        Date.now()
      )
      /
      60000
    );

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

  return {

    sportmonks_fixture_id:
      Number(
        fixture.id
      ),

    league_code:
      LEAGUE_CODES[
        leagueId
      ] || null,

    snapshot_stage:
      'FINAL',

    captured_at:
      capturedAt,

    kickoff_at:
      kickoff.toISOString(),

    minutes_to_kickoff:
      minutesToKickoff,

    lineups_official:
      true,

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
      fixture?.state ?? null,

    metadata,

    weather_report:
      weather,

    formations,

    sidelined,

    lineups,

    statistics,

    odds,

    optional_status: {

      source:
        'collect-lineups',

      final_snapshot:
        true,

      sportmonks_single_request:
        true,

      captured_at:
        capturedAt
    },

    /*
     * Photographie brute de la réponse reçue
     * au moment réel où les XI ont été détectés.
     */
    raw_fixture:
      fixture,

    updated_at:
      capturedAt
  };
}


// =====================================================
// SAUVEGARDE FINAL IMMUTABLE
// =====================================================

async function saveFinalSnapshot(
  fixture
) {

  const row =
    buildFinalSnapshot(
      fixture
    );

  const saved =
    await supabaseRequest(
      'prematch_snapshots',
      {
        method: 'POST',

        query:
          '?on_conflict=sportmonks_fixture_id,snapshot_stage',

        body:
          row,

        /*
         * Le premier FINAL authentique gagne.
         * Les passages suivants ne l'écrasent jamais.
         */
        prefer:
          'resolution=ignore-duplicates,return=representation'
      }
    );

  return {

    saved:
      Array.isArray(saved)
      &&
      saved.length > 0,

    snapshot:
      Array.isArray(saved)
        ? saved[0] || null
        : saved
  };
}


// =====================================================
// TRAITEMENT D'UN MATCH
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
      fixtureId: null,
      status: 'INVALID_FIXTURE'
    };
  }

  /*
   * Une seule requête détaillée.
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


  // ---------------------------------------------------
  // XI PAS ENCORE OFFICIELS
  // ---------------------------------------------------

  if (!lineup.official) {

    return {

      fixtureId,

      status:
        'WAITING',

      startersFound:
        lineup.starters.length
    };
  }


  // ---------------------------------------------------
  // XI OFFICIELS
  // ---------------------------------------------------

  await saveMatch(
    fixture,
    true
  );


  const savedLineups =
    await saveLineups(
      fixture
    );


  const finalSnapshot =
    await saveFinalSnapshot(
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
        : null,

    finalSnapshotSaved:
      finalSnapshot.saved
  };
}


// =====================================================
// HANDLER NETLIFY
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

        statusCode: 500,

        body:
          JSON.stringify({
            success: false,
            error:
              'SPORTMONKS_API_TOKEN absent.'
          })
      };
    }

    try {

      // =================================================
      // A. LISTE LÉGÈRE
      // =================================================

      const fixtures =
        await fetchFixtureList(
          token
        );


      // =================================================
      // B. MATCHS À H-60 / +30
      // =================================================

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


      // =================================================
      // C. MÉMOIRE
      // =================================================

      const [
        confirmedIds,
        finalSnapshotIds
      ] =
        await Promise.all([

          getConfirmedFixtureIds(
            fixtureIds
          ),

          getFinalSnapshotIds(
            fixtureIds
          )
        ]);


      /*
       * Un match n'est réellement terminé pour ce
       * collecteur QUE si :
       *
       * 1. XI enregistrés
       * 2. snapshot FINAL enregistré
       *
       * Cela permet de réparer automatiquement
       * un ancien match qui aurait XI=true mais
       * pas encore de snapshot FINAL.
       */
      const completed =
        new Set(
          fixtureIds.filter(
            fixtureId =>
              confirmedIds.has(
                fixtureId
              )
              &&
              finalSnapshotIds.has(
                fixtureId
              )
          )
        );


      const unresolved =
        candidates.filter(
          fixture =>
            !completed.has(
              Number(
                fixture.id
              )
            )
        );


      const results = [];


      // =================================================
      // D. MATCHS DÉJÀ COMPLETS
      // =================================================

      candidates.forEach(
        fixture => {

          const fixtureId =
            Number(
              fixture.id
            );

          if (
            completed.has(
              fixtureId
            )
          ) {

            results.push({

              fixtureId,

              status:
                'ALREADY_COMPLETE_SKIPPED'
            });
          }
        }
      );


      // =================================================
      // E. MATCHS RESTANTS
      // =================================================

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

        } catch (error) {

          results.push({

            fixtureId:
              fixture?.id || null,

            status:
              'ERROR',

            error:
              error?.message ||
              String(error)
          });
        }
      }


      // =================================================
      // F. RÉSUMÉ
      // =================================================

      const summary = {

        success:
          true,

        function:
          'collect-lineups',

        checkedAt:
          new Date()
            .toISOString(),

        fixturesReceived:
          fixtures.length,

        candidates:
          candidates.length,

        alreadyComplete:
          completed.size,

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

        errors:
          results.filter(
            item =>
              item.status ===
              'ERROR'
          ).length,

        finalSnapshotsSaved:
          results.filter(
            item =>
              item.finalSnapshotSaved ===
              true
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

    } catch (error) {

      console.error(
        'collect-lineups :',
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
              error?.message ||
              String(error)
          })
      };
    }
  };
