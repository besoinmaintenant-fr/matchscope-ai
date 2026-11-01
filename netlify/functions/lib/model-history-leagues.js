'use strict';

// Explicit, opt-in expansion of historical result collection.
// Keep the original three-league sync unchanged unless a seed request
// explicitly names one or both previously excluded championships.
const LEAGUE_ID_BY_CODE = Object.freeze({
  PL: '8',
  BL: '82',
  LL: '564',
  L1: '301',
  SA: '384'
});
const DEFAULT_CODES = Object.freeze(['PL', 'BL', 'LL']);
const EXTENSION_CODES = Object.freeze(['L1', 'SA']);

function selectedHistoryLeagues(body) {
  if (body?.leagueCodes === undefined) return [...DEFAULT_CODES];

  if (body?.mode !== 'seed' ||
      !Array.isArray(body.leagueCodes) ||
      body.leagueCodes.length < 1 ||
      body.leagueCodes.length > EXTENSION_CODES.length ||
      new Set(body.leagueCodes).size !== body.leagueCodes.length ||
      !body.leagueCodes.every(code => EXTENSION_CODES.includes(code))) {
    throw new Error('Only explicit seed requests for L1 and/or SA are permitted.');
  }
  return [...body.leagueCodes];
}

function leagueIdsForCodes(codes) {
  return codes.map(code => LEAGUE_ID_BY_CODE[code]);
}

module.exports = {
  LEAGUE_ID_BY_CODE,
  DEFAULT_CODES,
  EXTENSION_CODES,
  selectedHistoryLeagues,
  leagueIdsForCodes
};
