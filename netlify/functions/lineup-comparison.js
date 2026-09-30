const {
  supabaseRequest
} = require('./lib/supabase');


const {
  lineupStatus,
  saveMatch,
  saveLineups
} = require('./lib/memory');


const API =
  'https://api.sportmonks.com/v3/football';


const HISTORY_MATCHES =
  10;


const LEAGUES = {

  8: 'PL',

  82: 'BL',

  564: 'LL'
};


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

function parseBody(
  event
) {

  try {

    return JSON.parse(
      event?.body ||
      '{}'
    );

  } catch {

    return {};
  }
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


function array(
  value
) {

  return Array.isArray(
    value
  )
    ? value
    : [];
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


function getTeam(
  participants,
  location
) {

  return (

    array(
      participants
    )

      .find(
        participant =>

          participant
            ?.meta
            ?.location ===
          location
      )

    ||

    null
  );
}


function percent(
  numerator,
  denominator
) {

  if (
    !denominator
  ) {

    return null;
  }


  return Math.round(

    numerator /
    denominator *
    1000

  ) / 10;
}


function overlapCount(
  first,
  second
) {

  const secondIds =
    new Set(

      array(
        second
      )

        .map(
          player =>
            Number(
              player.player_id
            )
        )
    );


  return array(
    first
  )

    .filter(
      player =>

        secondIds.has(
          Number(
            player.player_id
          )
        )
    )

    .length;
}


// =====================================================
// CLASSIFICATION DES POSTES
// =====================================================

function positionGroup(
  row
) {

  const text =
    [

      row?.position,

      row
        ?.raw_data
        ?.position
        ?.name,

      row
        ?.raw_data
        ?.detailedposition
        ?.name

    ]

      .filter(
        Boolean
      )

      .join(
        ' '
      )

      .toLowerCase();


  if (
    /goal|keeper|gardien/.test(
      text
    )
  ) {

    return 'goalkeeper';
  }


  if (
    /defend|defender|back|déf|defen/.test(
      text
    )
  ) {

    return 'defence';
  }


  if (
    /midfield|midfielder|milieu/.test(
      text
    )
  ) {

    return 'midfield';
  }


  if (
    /forward|attacker|striker|wing|attack|ailier/.test(
      text
    )
  ) {

    return 'attack';
  }


  return 'other';
}


// =====================================================
// SPORTMONKS
// XI ACTUEL
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
    !payload?.data
  ) {

    throw new Error(
      'Match Sportmonks introuvable.'
    );
  }


  return payload.data;
}


// =====================================================
// SUPABASE
// XI TITULAIRES D'UN MATCH
// =====================================================

async function loadStarters(
  fixtureId,
  teamId
) {

  const query =

    '?select=*'

    +

    `&sportmonks_fixture_id=eq.${encodeURIComponent(
      fixtureId
    )}`

    +

    `&team_id=eq.${encodeURIComponent(
      teamId
    )}`

    +

    '&lineup_type=eq.starter'

    +

    '&order=jersey_number.asc.nullslast';


  const rows =
    await supabaseRequest(
      'lineups',
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
// SUPABASE
// MATCHS HISTORIQUES DE L'ÉQUIPE
// =====================================================

async function loadHistoricalMatches(
  teamId,
  leagueCode,
  before
) {

  const query =

    '?select='

    +

    [

      'sportmonks_fixture_id',

      'starting_at',

      'home_team_id',

      'home_team_name',

      'away_team_id',

      'away_team_name'

    ].join(',')

    +

    `&league_code=eq.${encodeURIComponent(
      leagueCode
    )}`

    +

    '&lineups_confirmed=eq.true'

    +

    `&starting_at=lt.${encodeURIComponent(
      before.toISOString()
    )}`

    +

    `&or=(home_team_id.eq.${Number(
      teamId
    )},away_team_id.eq.${Number(
      teamId
    )})`

    +

    '&order=starting_at.desc'

    +

    `&limit=${HISTORY_MATCHES}`;


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
// HISTORIQUE COMPLET DES XI
// =====================================================

async function loadTeamHistory(
  teamId,
  leagueCode,
  kickoff
) {

  const matches =
    await loadHistoricalMatches(

      teamId,

      leagueCode,

      kickoff
    );


  const history =
    [];


  for (
    const match
    of matches
  ) {

    const starters =
      await loadStarters(

        match.sportmonks_fixture_id,

        teamId
      );


    /*
     * On ne travaille que sur
     * les XI complets.
     */

    if (
      starters.length <
      11
    ) {

      continue;
    }


    const home =
      Number(
        match.home_team_id
      ) ===
      Number(
        teamId
      );


    history.push({

      fixtureId:
        Number(
          match.sportmonks_fixture_id
        ),

      startingAt:
        match.starting_at,

      opponent:

        home

          ? match.away_team_name

          : match.home_team_name,

      venue:

        home

          ? 'home'

          : 'away',

      formation:

        starters.find(
          row =>
            row.formation
        )
          ?.formation

        ||

        null,

      starters
    });
  }


  return history;
}


// =====================================================
// PROFIL HISTORIQUE
// =====================================================

function buildHistoricalProfile(
  history
) {

  const appearances =
    new Map();


  for (
    const match
    of history
  ) {

    for (
      const player
      of match.starters
    ) {

      const id =
        Number(
          player.player_id
        );


      if (
        !Number.isFinite(
          id
        )
      ) {

        continue;
      }


      const previous =
        appearances.get(
          id
        )

        ||

        {

          playerId:
            id,

          playerName:
            player.player_name
            ||
            'Joueur',

          starts:
            0,

          position:
            player.position
            ||
            null
        };


      previous.starts +=
        1;


      if (
        !previous.position &&
        player.position
      ) {

        previous.position =
          player.position;
      }


      appearances.set(
        id,
        previous
      );
    }
  }


  const rankedPlayers =
    Array.from(
      appearances.values()
    )

      .sort(
        (
          first,
          second
        ) =>

          second.starts -
          first.starts
      );


  // ---------------------------------------------------
  // FORMATIONS UTILISÉES
  // ---------------------------------------------------

  const formations =
    {};


  history.forEach(
    match => {

      if (
        !match.formation
      ) {

        return;
      }


      formations[
        match.formation
      ] =
        (
          formations[
            match.formation
          ]
          ||
          0
        )
        +
        1;
    }
  );


  // ---------------------------------------------------
  // CONTINUITÉ HISTORIQUE MOYENNE
  // ---------------------------------------------------

  let historicalContinuity =
    null;


  if (
    history.length >=
    2
  ) {

    const overlaps =
      [];


    for (
      let index = 0;
      index < history.length - 1;
      index += 1
    ) {

      overlaps.push(

        overlapCount(

          history[index]
            .starters,

          history[index + 1]
            .starters
        )
      );
    }


    historicalContinuity =

      Math.round(

        (
          overlaps.reduce(
            (
              total,
              value
            ) =>
              total +
              value,

            0
          )

          /

          overlaps.length
        )

        *

        10

      )

      /

      10;
  }


  return {

    matches:
      history.length,

    regularPlayers:
      rankedPlayers.slice(
        0,
        11
      ),

    allPlayers:
      rankedPlayers,

    formations,

    historicalContinuity
  };
}


// =====================================================
// COMPARAISON XI ACTUEL
// =====================================================

function compareCurrentLineup(
  current,
  history
) {

  const profile =
    buildHistoricalProfile(
      history
    );


  const currentIds =
    new Set(

      current.map(
        player =>
          Number(
            player.player_id
          )
      )
    );


  // ===================================================
  // COMPARAISON AU MATCH PRÉCÉDENT
  // ===================================================

  const previous =
    history[0]
    ||
    null;


  let previousComparison =
    null;


  if (
    previous
  ) {

    const previousIds =
      new Set(

        previous
          .starters

          .map(
            player =>
              Number(
                player.player_id
              )
          )
      );


    const kept =
      current.filter(
        player =>

          previousIds.has(
            Number(
              player.player_id
            )
          )
      );


    const incoming =
      current.filter(
        player =>

          !previousIds.has(
            Number(
              player.player_id
            )
          )
      );


    const outgoing =
      previous
        .starters

        .filter(
          player =>

            !currentIds.has(
              Number(
                player.player_id
              )
            )
        );


    previousComparison = {

      fixtureId:
        previous.fixtureId,

      startingAt:
        previous.startingAt,

      opponent:
        previous.opponent,

      venue:
        previous.venue,

      previousFormation:
        previous.formation,

      currentFormation:

        current.find(
          row =>
            row.formation
        )
          ?.formation

        ||

        null,

      kept:
        kept.length,

      changes:
        incoming.length,

      continuityPct:
        percent(
          kept.length,
          11
        ),

      incoming:

        incoming.map(
          player => ({

            playerId:
              Number(
                player.player_id
              ),

            playerName:
              player.player_name
              ||
              'Joueur',

            position:
              player.position
              ||
              null
          })
        ),

      outgoing:

        outgoing.map(
          player => ({

            playerId:
              Number(
                player.player_id
              ),

            playerName:
              player.player_name
              ||
              'Joueur',

            position:
              player.position
              ||
              null
          })
        )
    };
  }


  // ===================================================
  // TITULAIRES ACTUELS ET FRÉQUENCE HISTORIQUE
  // ===================================================

  const currentPlayers =
    current.map(
      player => {

        const historical =
          profile
            .allPlayers

            .find(
              item =>

                Number(
                  item.playerId
                ) ===
                Number(
                  player.player_id
                )
            );


        return {

          playerId:
            Number(
              player.player_id
            ),

          playerName:
            player.player_name
            ||
            'Joueur',

          position:
            player.position
            ||
            null,

          positionGroup:
            positionGroup(
              player
            ),

          historicalStarts:
            historical
              ?.starts
            ||
            0,

          historicalStartPct:
            percent(

              historical
                ?.starts
              ||
              0,

              history.length
            )
        };
      }
    );


  // ===================================================
  // XI HABITUEL
  // ===================================================

  const regularIds =
    new Set(

      profile
        .regularPlayers

        .map(
          player =>
            Number(
              player.playerId
            )
        )
    );


  const regularsPresent =
    currentPlayers.filter(
      player =>

        regularIds.has(
          Number(
            player.playerId
          )
        )
    );


  const missingRegulars =
    profile
      .regularPlayers

      .filter(
        player =>

          !currentIds.has(
            Number(
              player.playerId
            )
          )
      );


  // ===================================================
  // PROXIMITÉ AVEC LES 10 DERNIERS XI
  // ===================================================

  const overlapHistory =
    history.map(
      match =>

        overlapCount(

          current,

          match.starters
        )
    );


  const averageOverlap =

    overlapHistory.length

      ? Math.round(

          (
            overlapHistory.reduce(
              (
                total,
                value
              ) =>
                total +
                value,

              0
            )

            /

            overlapHistory.length
          )

          *

          10

        )

        /

        10

      : null;


  // ===================================================
  // STABILITÉ PAR LIGNE
  // ===================================================

  const lines = {

    goalkeeper: {
      total: 0,
      regular: 0
    },

    defence: {
      total: 0,
      regular: 0
    },

    midfield: {
      total: 0,
      regular: 0
    },

    attack: {
      total: 0,
      regular: 0
    },

    other: {
      total: 0,
      regular: 0
    }
  };


  currentPlayers.forEach(
    player => {

      const group =
        player.positionGroup;


      lines[
        group
      ].total +=
        1;


      if (
        regularIds.has(
          player.playerId
        )
      ) {

        lines[
          group
        ].regular +=
          1;
      }
    }
  );


  return {

    historyMatches:
      history.length,

    historyCoveragePct:
      percent(
        history.length,
        HISTORY_MATCHES
      ),

    previous:
      previousComparison,

    currentPlayers,

    regularsPresent:
      regularsPresent.length,

    regularsPresentPct:
      percent(
        regularsPresent.length,
        11
      ),

    missingRegulars:

      missingRegulars.map(
        player => ({

          ...player,

          historicalStartPct:
            percent(
              player.starts,
              history.length
            )
        })
      ),

    averageOverlapWithHistory:
      averageOverlap,

    averageOverlapPct:

      averageOverlap ===
      null

        ? null

        : percent(
            averageOverlap,
            11
          ),

    historicalContinuity:
      profile
        .historicalContinuity,

    historicalContinuityPct:

      profile
        .historicalContinuity ===
      null

        ? null

        : percent(
            profile.historicalContinuity,
            11
          ),

    formations:
      profile.formations,

    lines
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


    const token =
      process
        .env
        .SPORTMONKS_API_TOKEN;


    if (
      !token
    ) {

      return jsonResponse(
        500,
        {

          success:
            false,

          error:
            'SPORTMONKS_API_TOKEN absent.'
        }
      );
    }


    const body =
      parseBody(
        event
      );


    const fixtureId =
      numberOrNull(
        body?.fixtureId
      );


    if (
      fixtureId === null
    ) {

      return jsonResponse(
        400,
        {

          success:
            false,

          error:
            'fixtureId invalide.'
        }
      );
    }


    try {

      // =================================================
      // 1. XI ACTUEL SPORTMONKS
      // =================================================

      const fixture =
        await fetchFixture(
          fixtureId,
          token
        );


      const leagueId =
        Number(
          fixture?.league_id
        );


      const leagueCode =
        LEAGUES[
          leagueId
        ];


      if (
        !leagueCode
      ) {

        return jsonResponse(
          400,
          {

            success:
              false,

            error:
              'Championnat non pris en charge.'
          }
        );
      }


      const kickoff =
        parseKickoff(
          fixture?.starting_at
        );


      if (
        !kickoff
      ) {

        throw new Error(
          'Date du match invalide.'
        );
      }


      const participants =
        array(
          fixture?.participants
        );


      const home =
        getTeam(
          participants,
          'home'
        );


      const away =
        getTeam(
          participants,
          'away'
        );


      if (
        !home ||
        !away
      ) {

        throw new Error(
          'Équipes du match introuvables.'
        );
      }


      const homeId =
        Number(
          home.id
        );


      const awayId =
        Number(
          away.id
        );


      // =================================================
      // 2. HISTORIQUE AVANT LE MATCH
      // =================================================

      const [
        homeHistory,
        awayHistory
      ] =
        await Promise.all([

          loadTeamHistory(
            homeId,
            leagueCode,
            kickoff
          ),

          loadTeamHistory(
            awayId,
            leagueCode,
            kickoff
          )
        ]);


      const status =
        lineupStatus(
          fixture
        );


      // =================================================
      // 3. PAS ENCORE DE XI OFFICIEL
      // =================================================

      if (
        !status.official
      ) {

        return jsonResponse(
          200,
          {

            success:
              true,

            fixtureId,

            officialLineups:
              false,

            leagueCode,

            home: {

              teamId:
                homeId,

              teamName:
                home.name,

              historyMatches:
                homeHistory.length
            },

            away: {

              teamId:
                awayId,

              teamName:
                away.name,

              historyMatches:
                awayHistory.length
            },

            source: {

              current:
                'Sportmonks',

              history:
                'Supabase'
            },

            message:
              'Comparaison disponible dès publication des XI officiels.'
          }
        );
      }


      // =================================================
      // 4. SAUVEGARDE DU XI ACTUEL
      // =================================================

      await saveMatch(
        fixture,
        true
      );


      await saveLineups(
        fixture
      );


      // =================================================
      // 5. RELECTURE DU XI DEPUIS SUPABASE
      // =================================================

      const [
        currentHome,
        currentAway
      ] =
        await Promise.all([

          loadStarters(
            fixtureId,
            homeId
          ),

          loadStarters(
            fixtureId,
            awayId
          )
        ]);


      if (
        currentHome.length <
        11

        ||

        currentAway.length <
        11
      ) {

        throw new Error(
          'XI officiel incomplet dans Supabase.'
        );
      }


      // =================================================
      // 6. COMPARAISON
      // =================================================

      return jsonResponse(
        200,
        {

          success:
            true,

          fixtureId,

          officialLineups:
            true,

          leagueCode,

          startingAt:
            kickoff.toISOString(),

          home: {

            teamId:
              homeId,

            teamName:
              home.name,

            currentFormation:

              currentHome.find(
                row =>
                  row.formation
              )
                ?.formation

              ||

              null,

            comparison:

              compareCurrentLineup(
                currentHome,
                homeHistory
              )
          },

          away: {

            teamId:
              awayId,

            teamName:
              away.name,

            currentFormation:

              currentAway.find(
                row =>
                  row.formation
              )
                ?.formation

              ||

              null,

            comparison:

              compareCurrentLineup(
                currentAway,
                awayHistory
              )
          },

          source: {

            current:
              'Sportmonks',

            history:
              'Supabase'
          },

          note:
            'Analyse descriptive des compositions. Aucun poids prédictif n’est appliqué à V0.7.'
        }
      );


    } catch (
      error
    ) {

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
