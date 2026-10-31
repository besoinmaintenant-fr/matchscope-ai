// MatchScope AI — composition tactique, photos et indicateurs buteurs.
// Exécuté après app.js, prediction-ui.js et scorers-ui.js.
(() => {
  if (typeof openAnalysis !== 'function') return;
  const previousOpenAnalysis = openAnalysis;
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  let activeFixtureId = null;
  let controller = null;
  let serial = 0;
  let currentData = null;
  let selectedSide = 'home';
  let selectedPlayerId = null;
  let view = 'pitch';
  let scorers = new Map();

  const statusLabel = {
    official: 'Composition officielle',
    predicted: 'Composition probable',
    partial_official: 'Composition officielle partielle',
    unconfirmed: 'Composition non confirmée',
    not_provided: 'Composition non fournie'
  };

  function badge(value, kind = 'warn') {
    const node = $('officialBadge');
    if (!node) return;
    node.textContent = value;
    node.className = 'pill ' + kind;
  }

  function diagnostics(message, state = 'neutral') {
    const node = $('lineupCheckStatus');
    if (!node) return;
    node.textContent = message;
    node.dataset.status = state;
  }

  function teamOf(side) {
    return Array.isArray(currentData?.teams)
      ? currentData.teams.find(t => t.side === side) : null;
  }

  function scorerFor(player) {
    return player?.id ? scorers.get(String(player.id)) : null;
  }

  function percent(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
  }

  function imageUrl(value) {
    if (!value || typeof value !== 'string') return null;
    try {
      const u = new URL(value);
      return u.protocol === 'https:' &&
        ['cdn.sportmonks.com', 'assets.sportmonks.com'].includes(u.hostname)
        ? u.href : null;
    } catch { return null; }
  }

  function initials(name) {
    return String(name || 'J')
      .trim().split(/\s+/).slice(0, 2)
      .map(part => part[0] || '').join('').toUpperCase();
  }

  function playerLabel(player) {
    const scorer = scorerFor(player);
    const p = percent(scorer?.probability);
    return p === null ? '—' : p + ' %';
  }

  // Les indices formation_field sont "rang:colonne" :
  // 1:1 = gardien, lignes suivantes vers les attaquants.
  // La colonne 1 est sur la droite dans les données Sportmonks.
  function placePlayers(team) {
    const starters = Array.isArray(team?.starters) ? team.starters : [];
    if (!starters.length) return { rows: [], approximate: false };

    const parsed = starters.map(p => {
      const match = /^([1-9][0-9]?):([1-9][0-9]?)$/
        .exec(String(p.formationField || ''));
      return match ? {
        player: p,
        row: Number(match[1]),
        col: Number(match[2])
      } : null;
    });

    const positions = new Set(parsed.filter(Boolean).map(p => p.row + ':' + p.col));
    if (parsed.every(Boolean) && positions.size === parsed.length) {
      const rows = [...new Set(parsed.map(p => p.row))]
        .sort((a, b) => a - b);
      if (rows.length >= 3 && rows.length <= 7) {
        const placed = [];
        rows.forEach((row, index) => {
          const group = parsed.filter(p => p.row === row)
            .sort((a, b) => a.col - b.col);
          const y = 85 - index / (rows.length - 1) * 68;
          group.forEach((item, i) => placed.push({
            player: item.player,
            x: (1 - (i + 1) / (group.length + 1)) * 100,
            y
          }));
        });
        return { rows: placed, approximate: false };
      }
    }

    // Repli : la formation donne le nombre de joueurs par ligne,
    // formation_position ordonne les joueurs de la droite vers la gauche.
    // Sans formation_field, il ne s'agit PAS d'un positionnement officiel.
    let formation = String(team?.formation || '')
      .split('-').map(x => Number(x));
    if (formation.some(x => !Number.isInteger(x) || x < 1 || x > 5) ||
        formation.reduce((a, b) => a + b, 0) !== 10) {
      formation = [4, 3, 3];
    }
    const groups = [1, ...formation];
    const sorted = [...starters].sort((a, b) => {
      const aPos = Number(a.position) || 999;
      const bPos = Number(b.position) || 999;
      return aPos - bPos;
    });
    let cursor = 0;
    const placed = [];
    groups.forEach((count, rowIndex) => {
      const group = sorted.slice(cursor, cursor + count);
      cursor += count;
      const y = 85 - rowIndex / (groups.length - 1) * 68;
      group.forEach((player, i) => placed.push({
        player,
        x: (1 - (i + 1) / (group.length + 1)) * 100,
        y
      }));
    });
    return { rows: placed, approximate: true };
  }

  function renderSelectedPlayer() {
    const target = $('lineupSelectedPlayer');
    if (!target) return;
    const team = teamOf(selectedSide);
    const player = team?.starters?.find(p => String(p.id) === selectedPlayerId);
    if (!selectedPlayerId || !player) {
      target.innerHTML = '';
      return;
    }
    const stat = scorerFor(player);
    const rate = p => {
      const n = percent(p);
      return n === null ? '—' : n + ' %';
    };
    const value = v => v === null || v === undefined ? '—' : escape(v);
    target.innerHTML =
      '<div class="lineup-detail-head"><strong>' + escape(player.name) +
        '</strong><span>' + escape(team.name || '') + '</span></div>' +
      '<p class="lineup-detail-role">' +
        escape(statusLabel[currentData?.status] || 'Participation à confirmer') + '</p>' +
      '<div class="lineup-detail-stats">' +
        '<div><b>' + rate(stat?.probability) + '</b><small>1+ but</small></div>' +
        '<div><b>' + rate(stat?.probability2) + '</b><small>2+ buts</small></div>' +
        '<div><b>' + rate(stat?.probability3) + '</b><small>3+ buts</small></div>' +
      '</div>' +
      '<div class="lineup-detail-facts">' +
        '<span>Buts <b>' + value(stat?.goals) + '</b></span>' +
        '<span>Matchs <b>' + value(stat?.appearances) + '</b></span>' +
        '<span>Minutes <b>' + value(stat?.minutes) + '</b></span>' +
        '<span>Tirs <b>' + value(stat?.shots) + '</b></span>' +
        '<span>xG <b>' + value(stat?.xg) + '</b></span>' +
      '</div>' +
      '<small class="lineup-detail-footnote">Probabilités indicatives si le joueur participe, non calibrées pour le pari.</small>';
  }

  function closePlayerDialog() {
    const dialog = $('lineupPlayerDialog');
    if (dialog?.open) dialog.close();
  }

  function openPlayerDialog() {
    const dialog = $('lineupPlayerDialog');
    if (!dialog) return;
    renderSelectedPlayer();
    if (!dialog.open) dialog.showModal();
  }

  function renderPitch() {
    const tabHome = $('lineupHomeTab');
    const tabAway = $('lineupAwayTab');
    const home = teamOf('home');
    const away = teamOf('away');
    if (tabHome) {
      tabHome.textContent = home?.name || 'Domicile';
      tabHome.classList.toggle('active', selectedSide === 'home');
      tabHome.setAttribute('aria-pressed', String(selectedSide === 'home'));
    }
    if (tabAway) {
      tabAway.textContent = away?.name || 'Extérieur';
      tabAway.classList.toggle('active', selectedSide === 'away');
      tabAway.setAttribute('aria-pressed', String(selectedSide === 'away'));
    }

    const team = teamOf(selectedSide);
    const info = $('lineupPitchInfo');
    const area = $('lineupPitchPlayers');
    const note = $('lineupPitchNote');
    if (!info || !area) return;

    if (!team?.starters?.length) {
      info.textContent = team
        ? (team.name + ' · Aucun titulaire reçu depuis Sportmonks')
        : 'Compositions en cours de chargement…';
      area.innerHTML = '';
      if (note) note.textContent = 'Compositions en attente.';
      renderSelectedPlayer();
      return;
    }

    const coordinates = placePlayers(team);
    const count = team.starters.length;
    info.textContent =
      (team.formation || 'Formation inconnue') + ' · ' +
      (statusLabel[currentData?.status] || 'À confirmer');
    if (note) note.textContent = coordinates.approximate
      ? 'Placement indicatif · Touchez un joueur pour ses stats.'
      : 'Touchez un joueur pour voir ses statistiques.';

    area.innerHTML = coordinates.rows.map(({player, x, y}) => {
      const photo = imageUrl(player.photo);
      const number = player.jersey === null || player.jersey === undefined
        ? '' : '#' + player.jersey + ' ';
      const playerId = player.id ? String(player.id) : '';
      const selected = playerId && playerId === selectedPlayerId;
      const avatar = photo
        ? '<img loading="lazy" referrerpolicy="no-referrer" src="' +
            escape(photo) + '" alt="" />'
        : '<span class="pitch-player-initials">' +
            escape(initials(player.name)) + '</span>';
      return '<button type="button" class="pitch-player' +
        (selected ? ' selected' : '') + '"' +
        ' style="--x:' + x.toFixed(2) + ';--y:' + y.toFixed(2) + '"' +
        ' data-player-id="' + escape(playerId) + '"' +
        ' aria-label="' + escape(number + player.name +
          ', voir ses statistiques buteur') + '"' +
        ' aria-pressed="' + String(Boolean(selected)) + '">' +
          '<span class="pitch-player-avatar">' + avatar + '</span>' +
          '<span class="pitch-player-name"><span class="pitch-player-number">' +
            escape(number) + '</span>' + escape(player.name) + '</span>' +
        '</button>';
    }).join('');
    renderSelectedPlayer();
  }

  function listPlayer(player) {
    const value = playerLabel(player);
    const number = player.jersey === null || player.jersey === undefined
      ? '' : '#' + player.jersey + ' ';
    return '<div class="player lineup-list-player">' +
      '<span>' + escape(number + player.name) + '</span>' +
      '<strong>' + escape(value) + '</strong></div>';
  }

  function renderList() {
    for (const side of ['home', 'away']) {
      const team = teamOf(side);
      const formation = $(side + 'Formation');
      if (formation) formation.textContent = team
        ? team.name + ' • ' + (team.formation || 'Formation inconnue') : '—';

      const target = $(side + 'Lineup');
      if (!target) continue;
      const starters = Array.isArray(team?.starters) ? team.starters : [];
      const bench = Array.isArray(team?.bench) ? team.bench : [];
      target.innerHTML =
        '<h5 class="lineup-category">Titulaires (' + starters.length + '/11)</h5>' +
        (starters.length ? starters.map(listPlayer).join('')
          : '<p class="lineup-empty">Aucune composition transmise.</p>') +
        (bench.length ? '<h5 class="lineup-category">Remplaçants (' +
          bench.length + ')</h5>' + bench.map(listPlayer).join('') : '');
    }
  }

  function setView(next) {
    view = next === 'list' ? 'list' : 'pitch';
    const pitch = $('lineupPitchArea');
    const list = document.querySelector('.lineup-columns');
    if (pitch) pitch.classList.toggle('lineup-list-hidden', view === 'list');
    if (list) list.classList.toggle('lineup-list-hidden', view !== 'list');
    for (const [id, mode] of [['lineupPitchView', 'pitch'], ['lineupListView', 'list']]) {
      const button = $(id);
      if (!button) continue;
      button.classList.toggle('active', view === mode);
      button.setAttribute('aria-pressed', String(view === mode));
    }
    if (view === 'pitch') renderPitch();
    else renderList();
  }

  function show(data) {
    currentData = data;
    renderList();
    renderPitch();

    const home = teamOf('home');
    const away = teamOf('away');
    diagnostics(statusLabel[data.status] || 'Compositions à vérifier',
      data.status === 'official' ? 'success' :
        data.status === 'not_provided' ? 'warn' : 'neutral');

    if (data.status === 'official') badge(
      data.source === 'saved' ? 'COMPOS OFFICIELLES ENREGISTRÉES' : 'COMPOS OFFICIELLES SPORTMONKS',
      'success'
    );
    else if (data.status === 'predicted') badge('COMPOS PROBABLES SPORTMONKS', 'neutral');
    else if (data.status === 'partial_official') badge('COMPOS OFFICIELLES PARTIELLES', 'warn');
    else if (data.status === 'unconfirmed') badge('COMPOS REÇUES NON CONFIRMÉES', 'warn');
    else badge('COMPOS NON FOURNIES', 'warn');
  }

  async function load(fixtureId) {
    const requestId = ++serial;
    if (controller) controller.abort();
    controller = new AbortController();
    const button = $('lineupRefreshButton');
    if (button) {
      button.disabled = true;
      button.textContent = 'Vérification…';
    }
    diagnostics('Vérification des compositions…');

    try {
      const response = await fetch(
        '/.netlify/functions/lineup-check?fixtureId=' +
        encodeURIComponent(String(fixtureId)),
        { cache: 'no-store', signal: controller.signal }
      );
      const data = await response.json();
      if (requestId !== serial) return;
      if (!response.ok) {
        throw new Error(String(data.error || 'Réponse indisponible') +
          (data.providerStatus ? ' (Sportmonks HTTP ' + data.providerStatus + ')' : ''));
      }
      show(data);
    } catch (error) {
      if (requestId !== serial || error.name === 'AbortError') return;
      badge('COMPOS NON VÉRIFIÉES', 'warn');
      diagnostics('Compositions non vérifiées', 'warn');
      if (!currentData) {
        const info = $('lineupPitchInfo');
        if (info) info.textContent = 'Vérification des compositions indisponible.';
      }
    } finally {
      if (requestId === serial && button) {
        button.disabled = false;
        button.textContent = 'Actualiser';
      }
    }
  }

  const refreshButton = $('lineupRefreshButton');
  if (refreshButton) refreshButton.addEventListener('click', () => {
    if (activeFixtureId !== null) load(activeFixtureId);
  });
  const pitchButton = $('lineupPitchView');
  if (pitchButton) pitchButton.addEventListener('click', () => setView('pitch'));
  const listButton = $('lineupListView');
  if (listButton) listButton.addEventListener('click', () => setView('list'));

  for (const side of ['home', 'away']) {
    const tab = $(side === 'home' ? 'lineupHomeTab' : 'lineupAwayTab');
    if (tab) tab.addEventListener('click', () => {
      closePlayerDialog();
      selectedSide = side;
      selectedPlayerId = null;
      renderPitch();
    });
  }
  const pitchPlayers = $('lineupPitchPlayers');
  if (pitchPlayers) pitchPlayers.addEventListener('click', event => {
    const button = event.target.closest('button[data-player-id]');
    if (!button || !pitchPlayers.contains(button)) return;
    selectedPlayerId = button.dataset.playerId || null;
    renderPitch();
    if (selectedPlayerId) openPlayerDialog();
  });

  const playerDialog = $('lineupPlayerDialog');
  const dialogClose = $('lineupDialogClose');
  if (dialogClose) dialogClose.addEventListener('click', closePlayerDialog);
  if (playerDialog) {
    playerDialog.addEventListener('click', event => {
      if (event.target === playerDialog) closePlayerDialog();
    });
    playerDialog.addEventListener('close', () => {
      selectedPlayerId = null;
      renderPitch();
    });
  }

  // La requête statistique est indépendante : mise à jour sans rafraîchir
  // la composition et sans confondre les données de matchs successifs.
  window.addEventListener('matchscope:scorers-ready', event => {
    const detail = event.detail || {};
    if (String(detail.fixtureId) !== activeFixtureId) return;
    scorers = new Map((Array.isArray(detail.players) ? detail.players : [])
      .filter(p => Number.isSafeInteger(Number(p.playerId)))
      .map(p => [String(p.playerId), p]));
    renderList();
    renderPitch();
  });

  openAnalysis = function (id) {
    closePlayerDialog();
    previousOpenAnalysis(id);
    if (typeof currentMode !== 'undefined' && currentMode !== 'live') {
      activeFixtureId = null;
      return;
    }
    if (!/^[1-9][0-9]{0,11}$/.test(String(id))) {
      activeFixtureId = null;
      return;
    }
    activeFixtureId = String(id);
    selectedSide = 'home';
    selectedPlayerId = null;
    currentData = null;
    scorers = new Map();
    const pitch = $('lineupPitchPlayers');
    if (pitch) pitch.innerHTML = '';
    const info = $('lineupPitchInfo');
    if (info) info.textContent = 'Chargement des joueurs Sportmonks…';
    const detail = $('lineupSelectedPlayer');
    if (detail) detail.innerHTML = '';
    setView('pitch');
    load(activeFixtureId);
  };
})();