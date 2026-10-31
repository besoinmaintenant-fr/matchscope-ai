'use strict';

// Analyse directe de la composition d'une rencontre Sportmonks.
// Ne renvoie ni le token, ni les données brutes de la réponse.
const API = 'https://api.sportmonks.com/v3/football';
const ALLOWED_LEAGUES = new Set([301, 564, 384, 8, 82]);

function reply(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function parseTeams(fixture) {
  const participants = Array.isArray(fixture.participants)
    ? fixture.participants : [];
  const home = participants.find(x => x?.meta?.location === 'home')
    || participants[0];
  const away = participants.find(x => x?.meta?.location === 'away')
    || participants[1];
  return [
    { side: 'home', id: Number(home?.id), name: String(home?.name || 'Domicile') },
    { side: 'away', id: Number(away?.id), name: String(away?.name || 'Extérieur') }
  ];
}

function confirmedFlag(metadata) {
  if (!Array.isArray(metadata)) return null;
  const record = metadata.find(item =>
    Number(item?.type_id) === 572 ||
    String(item?.type?.code || '').toLowerCase().replace(/_/g, '-') === 'lineup-confirmed'
  );
  const value = record?.values?.confirmed;
  if (value === true || value === 'true' || value === 1) return true;
  if (value === false || value === 'false' || value === 0) return false;
  return null;
}

function formationFor(fixture, team) {
  const rows = Array.isArray(fixture.formations) ? fixture.formations : [];
  const record = rows.find(row => Number(row?.participant_id) === team.id ||
    row?.location === team.side);
  if (record?.formation) return String(record.formation);
  const details = Array.isArray(fixture.metadata) ? fixture.metadata : [];
  const formation = details.find(item => Number(item?.type_id) === 159);
  const value = formation?.values?.[team.side];
  return typeof value === 'string' ? value : null;
}

function playerFromEntry(entry) {
  const name = entry?.player_name || entry?.player?.display_name ||
    entry?.player?.name || entry?.player?.common_name;
  return {
    id: Number(entry?.player_id) || null,
    name: name ? String(name) : 'Nom non communiqué',
    jersey: Number.isInteger(Number(entry?.jersey_number))
      && entry?.jersey_number !== null
      ? Number(entry.jersey_number) : null,
    position: Number.isInteger(Number(entry?.formation_position))
      && entry?.formation_position !== null
      ? Number(entry.formation_position) : null
  };
}

function getTeamSheet(fixture, entries, team) {
  const filtered = entries.filter(e => Number(e?.team_id) === team.id);
  const byPosition = (a, b) =>
    (a.position ?? 999) - (b.position ?? 999);
  return {
    ...team,
    formation: formationFor(fixture, team),
    starters: filtered.filter(e => Number(e?.type_id) === 11)
      .map(playerFromEntry).sort(byPosition),
    bench: filtered.filter(e => Number(e?.type_id) === 12)
      .map(playerFromEntry),
    unclassified: filtered.filter(e => ![11, 12].includes(Number(e?.type_id))).length,
    total: filtered.length
  };
}

exports.handler = async event => {
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return reply(405, { error: 'Méthode non autorisée' });
  }

  const fixtureId = String(event.queryStringParameters?.fixtureId || '');
  if (!/^[1-9][0-9]{0,11}$/.test(fixtureId)) {
    return reply(400, { error: 'Identifiant de match invalide' });
  }

  const token = process.env.SPORTMONKS_API_TOKEN;
  if (!token) {
    return reply(503, { error: 'Clé Sportmonks non configurée sur Netlify' });
  }

  const url = new URL(API + '/fixtures/' + fixtureId);
  url.searchParams.set('api_token', token);
  // Ces quatre includes sont disponibles sur les fiches Sportmonks.
  url.searchParams.set('include', 'participants;lineups;metadata;formations');

  let upstream;
  let payload;
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) {
      return reply(502, {
        error: 'Sportmonks a refusé ou n’a pas pu fournir les compositions',
        providerStatus: upstream.status,
        fixtureId
      });
    }
    payload = await upstream.json();
  } catch (error) {
    return reply(502, {
      error: error?.name === 'TimeoutError'
        ? 'Sportmonks n’a pas répondu dans les délais'
        : 'Impossible de lire la réponse Sportmonks',
      fixtureId
    });
  }

  const fixture = payload?.data;
  if (!fixture || !ALLOWED_LEAGUES.has(Number(fixture.league_id))) {
    return reply(404, { error: 'Match hors des cinq championnats MatchScope' });
  }

  const entries = Array.isArray(fixture.lineups) ? fixture.lineups : [];
  const teams = parseTeams(fixture);
  const sheets = teams.map(team => getTeamSheet(fixture, entries, team));
  const confirmed = confirmedFlag(fixture.metadata);
  const fullStartingXI = sheets.every(s => s.starters.length === 11);

  let status;
  let explanation;
  if (!entries.length) {
    status = 'not_provided';
    explanation = 'Sportmonks a répondu HTTP 200, mais la fiche ne contient aucun joueur dans lineups pour ce match.';
  } else if (confirmed === true && fullStartingXI) {
    status = 'official';
    explanation = 'Sportmonks a renvoyé 11 titulaires par équipe et confirme officiellement les compositions (metadata 572).';
  } else if (confirmed === true) {
    status = 'partial_official';
    explanation = 'Sportmonks indique des compositions confirmées, mais les titulaires reçus sont incomplets.';
  } else if (confirmed === false) {
    status = 'predicted';
    explanation = 'Sportmonks fournit des joueurs, mais indique que les compositions ne sont pas encore officielles.';
  } else {
    status = 'unconfirmed';
    explanation = 'Sportmonks fournit des joueurs, mais ne précise pas si les compositions sont officielles.';
  }

  return reply(200, {
    fixtureId,
    matchName: String(fixture.name || teams.map(t => t.name).join(' - ')),
    leagueId: Number(fixture.league_id),
    kickoff: fixture.starting_at || null,
    checkedAt: new Date().toISOString(),
    providerStatus: upstream.status,
    lineupFieldPresent: Object.prototype.hasOwnProperty.call(fixture, 'lineups'),
    playerCount: entries.length,
    confirmation: confirmed,
    status,
    explanation,
    teams: sheets
  });
};
