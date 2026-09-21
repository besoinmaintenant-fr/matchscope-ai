const API = 'https://api.sportmonks.com/v3/football';

const leagueMap = {
  '301': 'L1',
  '8': 'PL',
  '564': 'LL',
  '82': 'BL',
  '384': 'SA'
};

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function findTeam(participants = [], location) {
  return participants.find(
    p => p?.meta?.location === location
  );
}

exports.handler = async () => {
  const token = process.env.SPORTMONKS_API_TOKEN;

  const leagueIds = (
    process.env.SPORTMONKS_LEAGUE_IDS || ''
  )
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);

  if (!token) {
    return {
      statusCode: 500,
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        error: 'SPORTMONKS_API_TOKEN absent'
      })
    };
  }

  if (!leagueIds.length) {
    return {
      statusCode: 500,
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        error: 'SPORTMONKS_LEAGUE_IDS absent'
      })
    };
  }

  const start = new Date();

  // On prend les 21 prochains jours.
  const end = new Date(
    Date.now() + 21 * 24 * 60 * 60 * 1000
  );

  const baseUrl =
    `${API}/fixtures/between/${iso(start)}/${iso(end)}`;

  try {
    let page = 1;
    let hasMore = true;
    let fixtures = [];

    while (hasMore && page <= 10) {
      const url = new URL(baseUrl);

      url.searchParams.set(
        'api_token',
        token
      );

      url.searchParams.set(
        'filters',
        `fixtureLeagues:${leagueIds.join(',')}`
      );

      // On commence volontairement avec les données
      // de base pour vérifier la connexion.
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

      const response = await fetch(url);

      const raw =
        await response.text();

      if (!response.ok) {
        return {
          statusCode: response.status,

          headers: {
            'content-type':
              'application/json'
          },

          body: JSON.stringify({
            error:
              'Erreur Sportmonks',

            status:
              response.status,

            details:
              raw.slice(0, 1500)
          })
        };
      }

      const json =
        JSON.parse(raw);

      fixtures.push(
        ...(json.data || [])
      );

      hasMore =
        Boolean(
          json.pagination?.has_more
        );

      page += 1;
    }

    const matches =
      fixtures.map(f => {
        const home =
          findTeam(
            f.participants,
            'home'
          ) ||
          f.participants?.[0] ||
          {};

        const away =
          findTeam(
            f.participants,
            'away'
          ) ||
          f.participants?.[1] ||
          {};

        const kickoff =
          new Date(
            String(
              f.starting_at || ''
            )
              .replace(
                ' ',
                'T'
              ) + 'Z'
          );

        return {
          id:
            String(f.id),

          competition:
            leagueMap[
              String(f.league_id)
            ] ||
            String(f.league_id),

          competitionName:
            f.league?.name ||
            'Compétition',

          date:
            kickoff.toLocaleDateString(
              'fr-FR',
              {
                day: '2-digit',
                month: 'short',
                timeZone:
                  'Europe/Paris'
              }
            ),

          time:
            kickoff.toLocaleTimeString(
              'fr-FR',
              {
                hour: '2-digit',
                minute: '2-digit',
                timeZone:
                  'Europe/Paris'
              }
            ),

          home:
            home.name ||
            'Équipe domicile',

          away:
            away.name ||
            'Équipe extérieure',

          venue:
            f.venue?.name ||
            'Stade à confirmer',

          surface:
            f.venue?.surface ||
            'À confirmer',

          weather:
            'À connecter',

          // On ne prétend plus avoir
          // les compositions si nous
          // ne les avons pas.
          official:
            false,

          quality:
            50,

          // Aucun faux pronostic.
          probs: {
            home: null,
            draw: null,
            away: null
          },

          confidence:
            null,

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
            'Blessures, suspensions et compositions à connecter.',

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
      });

    return {
      statusCode: 200,

      headers: {
        'content-type':
          'application/json',

        'cache-control':
          'no-store'
      },

      body:
        JSON.stringify({
          live: true,
          count: matches.length,
          matches
        })
    };

  } catch (error) {
    return {
      statusCode: 500,

      headers: {
        'content-type':
          'application/json'
      },

      body:
        JSON.stringify({
          error:
            'Erreur interne MatchScope',

          details:
            error.message
        })
    };
  }
};
