const API = 'https://api.sportmonks.com/v3/football';

const LEAGUE_CODE_BY_ID = {
  '301': 'L1',   // Ligue 1
  '8': 'PL',     // Premier League
  '564': 'LL',   // La Liga
  '82': 'BL',    // Bundesliga
  '384': 'SA'    // Serie A
};

const LEAGUE_CODE_BY_NAME = {
  'ligue 1': 'L1',
  'premier league': 'PL',
  'la liga': 'LL',
  'laliga': 'LL',
  'bundesliga': 'BL',
  'serie a': 'SA'
};

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function getTeam(participants = [], location) {
  return participants.find(
    p => p?.meta?.location === location
  ) || null;
}

function competitionCode(fixture) {
  const byId =
    LEAGUE_CODE_BY_ID[
      String(fixture?.league_id)
    ];

  if (byId) {
    return byId;
  }

  const name =
    String(
      fixture?.league?.name || ''
    )
      .trim()
      .toLowerCase();

  return (
    LEAGUE_CODE_BY_NAME[name] ||
    String(
      fixture?.league_id || 'OTHER'
    )
  );
}

function parseKickoff(startingAt) {
  if (!startingAt) {
    return null;
  }

  const raw =
    String(startingAt).trim();

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
      JSON.stringify(body)
  };
}

exports.handler =
  async () => {

    const token =
      process.env
        .SPORTMONKS_API_TOKEN;

    const leagueIds =
      String(
        process.env
          .SPORTMONKS_LEAGUE_IDS ||
        ''
      )
        .split(',')
        .map(
          value =>
            value.trim()
        )
        .filter(Boolean);

    if (!token) {
      return jsonResponse(
        500,
        {
          error:
            'SPORTMONKS_API_TOKEN absent dans Netlify.'
        }
      );
    }

    if (!leagueIds.length) {
      return jsonResponse(
        500,
        {
          error:
            'SPORTMONKS_LEAGUE_IDS absent dans Netlify.'
        }
      );
    }

    // Aujourd'hui
    const start =
      new Date();

    // Recherche sur les 28 prochains jours
    const end =
      new Date(
        Date.now() +
        28 *
        24 *
        60 *
        60 *
        1000
      );

    const endpoint =
      `${API}/fixtures/between/${iso(start)}/${iso(end)}`;

    try {

      const allFixtures = [];

      let page = 1;

      let hasMore = true;

      while (
        hasMore &&
        page <= 10
      ) {

        const url =
          new URL(endpoint);

        url.searchParams.set(
          'api_token',
          token
        );

        url.searchParams.set(
          'filters',
          `fixtureLeagues:${leagueIds.join(',')}`
        );

        // On commence avec les données
        // de base pour tester le LIVE.
        url.searchParams.set(
          'include',
          'league;participants;venue'
        );

        url.searchParams.set(
          'per_page',
          '50'
        );

        url.searchParams.set(
          'page',
          String(page)
        );

        const response =
          await fetch(url);

        const raw =
          await response.text();

        if (!response.ok) {

          return jsonResponse(
            response.status,
            {
              error:
                'Erreur Sportmonks',

              status:
                response.status,

              details:
                raw.slice(
                  0,
                  1600
                )
            }
          );
        }

        let payload;

        try {

          payload =
            JSON.parse(raw);

        } catch {

          return jsonResponse(
            502,
            {
              error:
                'Réponse Sportmonks illisible',

              details:
                raw.slice(
                  0,
                  1000
                )
            }
          );
        }

        if (
          Array.isArray(
            payload.data
          )
        ) {

          allFixtures.push(
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

      const allowed =
        new Set(
          leagueIds
        );

      const matches =
        allFixtures

          .filter(
            fixture =>
              allowed.has(
                String(
                  fixture
                    ?.league_id
                )
              )
          )

          .sort(
            (a, b) => {

              const dateA =
                parseKickoff(
                  a?.starting_at
                )
                  ?.getTime() ||
                0;

              const dateB =
                parseKickoff(
                  b?.starting_at
                )
                  ?.getTime() ||
                0;

              return (
                dateA -
                dateB
              );
            }
          )

          .map(
            fixture => {

              const participants =
                Array.isArray(
                  fixture
                    .participants
                )
                  ? fixture
                      .participants
                  : [];

              const home =
                getTeam(
                  participants,
                  'home'
                ) ||
                participants[0] ||
                {};

              const away =
                getTeam(
                  participants,
                  'away'
                ) ||
                participants[1] ||
                {};

              const kickoff =
                parseKickoff(
                  fixture
                    .starting_at
                );

              return {

                id:
                  String(
                    fixture.id
                  ),

                competition:
                  competitionCode(
                    fixture
                  ),

                competitionName:
                  fixture
                    ?.league
                    ?.name ||
                  'Compétition',

                date:
                  kickoff
                    ? kickoff
                        .toLocaleDateString(
                          'fr-FR',
                          {
                            day:
                              '2-digit',

                            month:
                              'short',

                            timeZone:
                              'Europe/Paris'
                          }
                        )
                    : '—',

                time:
                  kickoff
                    ? kickoff
                        .toLocaleTimeString(
                          'fr-FR',
                          {
                            hour:
                              '2-digit',

                            minute:
                              '2-digit',

                            timeZone:
                              'Europe/Paris'
                          }
                        )
                    : '—',

                home:
                  home?.name ||
                  'Équipe domicile',

                away:
                  away?.name ||
                  'Équipe extérieure',

                venue:
                  fixture
                    ?.venue
                    ?.name ||
                  'Stade à confirmer',

                surface:
                  fixture
                    ?.venue
                    ?.surface ||
                  'À confirmer',

                weather:
                  'À connecter',

                // Pour le moment,
                // pas de fausse composition.
                official:
                  false,

                quality:
                  50,

                confidence:
                  null,

                // Aucune probabilité inventée.
                probs: {
                  home:
                    null,

                  draw:
                    null,

                  away:
                    null
                },

                formationHome:
                  '—',

                formationAway:
                  '—',

                homeXI: [
                  'Composition en attente'
                ],

                awayXI: [
                  'Composition en attente'
                ],

                absences:
                  'Blessures, suspensions et compositions seront ajoutées après validation du flux live.',

                factors: [
                  [
                    'Calendrier live',

                    'Match récupéré directement depuis Sportmonks.',

                    'LIVE',

                    'pos'
                  ]
                ],

                markets: [],

                sources: [
                  [
                    'Sportmonks Football API',

                    'Calendrier, équipes et stade.',

                    'Live'
                  ]
                ]
              };
            }
          );

      return jsonResponse(
        200,
        {
          live:
            true,

          from:
            iso(start),

          to:
            iso(end),

          leagueIds,

          count:
            matches.length,

          matches
        }
      );

    } catch (error) {

      return jsonResponse(
        500,
        {
          error:
            'Erreur interne MatchScope',

          details:
            error?.message ||
            String(error)
        }
      );
    }
  };
