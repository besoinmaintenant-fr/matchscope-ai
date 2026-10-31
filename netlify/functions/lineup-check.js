'use strict';

// Analyse directe de la composition d'une rencontre Sportmonks.
// Ne renvoie ni le token, ni les données brutes de la réponse.
const API = 'https://api.sportmonks.com/v3/football';
const ALLOWED_LEAGUES = new Set([301, 564, 384, 8, 82]);
const { supabaseRequest } = require('./lib/supabase');

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
  // Préférer le nom complet si Sportmonks fournit le profil joueur.
  const name = entry?.player?.display_name || entry?.player?.name ||
    entry?.player?.common_name || entry?.player_name;

  // Le terrain s'appuie sur formation_field au format rang:colonne.
  // formation_position est seulement un ordre dans l'équipe.
  const field = String(entry?.formation_field || '');
  const formationField = /^[1-9]:[1-9][0-9]?$/.test(field)
    ? field : null;

  const rawPhoto = entry?.player?.image_path;
  let photo = null;
  try {
    if (typeof rawPhoto === 'string') {
      const url = new URL(rawPhoto);
      if (url.protocol === 'https:' &&
        (url.hostname === 'cdn.sportmonks.com' ||
          url.hostname === 'assets.sportmonks.com')) {
        photo = url.href;
      }
    }
  } catch { /* Source photo absente ou URL invalide. */ }

  return {
    id: Number(entry?.player_id) || null,
    name: name ? String(name) : 'Nom non communiqué',
    jersey: Number.isInteger(Number(entry?.jersey_number))
      && entry?.jersey_number !== null
      ? Number(entry.jersey_number) : null,
    position: Number.isInteger(Number(entry?.formation_position))
      && entry?.formation_position !== null
      ? Number(entry.formation_position) : null,
    formationField,
    photo
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


/*
 * Les XI certifiés et leurs positions sont enregistrés avant le coup
 * d'envoi. Ils restent consultables même si l'API Sportmonks n'envoie
 * plus les includes lineups sur le match en cours ou terminé.
 */
async function savedOfficialLineups(fixtureId) {
  const saved = await supabaseRequest('matches', {
    query: '?select=sportmonks_fixture_id,league_id,starting_at,updated_at,lineups_confirmed,home_team_id,home_team_name,away_team_id,away_team_name' +
      '&sportmonks_fixture_id=eq.' + fixtureId + '&limit=1'
  });
  const match = Array.isArray(saved) ? saved[0] : null;
  if (!match || match.lineups_confirmed !== true ||
      !ALLOWED_LEAGUES.has(Number(match.league_id))) return null;

  const savedPlayers = await supabaseRequest('lineups', {
    query: '?select=team_id,team_name,player_id,player_name,lineup_type,position,jersey_number,formation,raw_data' +
      '&sportmonks_fixture_id=eq.' + fixtureId + '&limit=100'
  });
  if (!Array.isArray(savedPlayers)) return null;

  const teams = [
    { side: 'home', id: Number(match.home_team_id),
      name: String(match.home_team_name || 'Domicile') },
    { side: 'away', id: Number(match.away_team_id),
      name: String(match.away_team_name || 'Extérieur') }
  ].map(team => {
    const rows = savedPlayers.filter(row => Number(row.team_id) === team.id);
    const toPlayer = row => playerFromEntry({
      ...(row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {}),
      player_id: row.player_id,
      player_name: row.player_name,
      jersey_number: row.jersey_number,
      formation_position: row.raw_data?.formation_position,
      formation_field: row.raw_data?.formation_field
    });
    return {
      ...team,
      formation: rows.find(row => row.formation)?.formation || null,
      starters: rows.filter(row => row.lineup_type === 'starter')
        .map(toPlayer).sort((a,b) => (a.position ?? 999) - (b.position ?? 999)),
      bench: rows.filter(row => row.lineup_type === 'substitute').map(toPlayer),
      unclassified: 0,
      total: rows.length
    };
  });
  // Refuser une composition partielle même si l'ancien statut dit 'confirmé'.
  if (!teams.every(team => team.starters.length === 11)) return null;
  return {
    fixtureId,
    matchName: teams.map(team => team.name).join(' - '),
    leagueId: Number(match.league_id),
    kickoff: match.starting_at,
    checkedAt: match.updated_at || null,
    providerStatus: null,
    lineupFieldPresent: true,
    playerCount: teams.reduce((sum, t) => sum + t.total, 0),
    photosAccessible: null,
    confirmation: true,
    status: 'official',
    source: 'saved',
    explanation: 'Compositions officielles récupérées dans les archives enregistrées avant le coup d’envoi.',
    teams
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

  // Priorité aux compositions déjà vérifiées et sauvegardées.
  try {
    const stored = await savedOfficialLineups(fixtureId);
    if (stored) return reply(200, stored);
  } catch (_error) {
    // Un échec Supabase ne bloque pas le repli sur Sportmonks.
    console.warn('MatchScope lineup-check: archive indisponible, repli sur Sportmonks');
  }

  const token = process.env.SPORTMONKS_API_TOKEN;
  if (!token) {
    return reply(503, { error: 'Clé Sportmonks non configurée sur Netlify' });
  }

  const url = new URL(API + '/fixtures/' + fixtureId);
  url.searchParams.set('api_token', token);
  // Ces quatre includes sont disponibles sur les fiches Sportmonks.
  // La photo vient du profil imbriqué, lorsque le forfait l'autorise.
  // Sinon repli sur la fiche sans relation player : on ne doit jamais
  // faire disparaître une composition à cause d'un include facultatif.
  url.searchParams.set('include', 'participants;lineups.player;metadata;formations');

  let upstream;
  let payload;
  let photosAccessible = true;
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!upstream.ok && [400, 403, 422].includes(upstream.status)) {
      photosAccessible = false;
      url.searchParams.set('include', 'participants;lineups;metadata;formations');
      upstream = await fetch(url, { signal: AbortSignal.timeout(10000) });
    }
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
    photosAccessible,
    confirmation: confirmed,
    status,
    explanation,
    teams: sheets
  });
};
