const competitions = [
  {
    id: 'all',
    name: 'Tous'
  },
  {
    id: 'BL',
    name: '🇩🇪 Bundesliga'
  },
  {
    id: 'LL',
    name: '🇪🇸 La Liga'
  },
  {
    id: 'SC',
    name: '🇪🇸 Super Cup'
  },
  {
    id: 'PL',
    name: '🏴 Premier League'
  },
  {
    id: 'CF1',
    name: '🌍 Club Friendlies 1'
  }
];


const weights = [
  ['Forme pondérée', 18],
  ['xG / xGA', 20],
  ['Domicile / extérieur', 12],
  ['Compositions & absences', 18],
  ['Repos / fatigue', 8],
  ['Matchup tactique', 9],
  ['Cotes / consensus', 7],
  ['Météo / stade', 4],
  ['H2H récent', 4]
];


let selectedLeague =
  'all';

let selectedFilter =
  'all';

let currentMode =
  'live';

let historyDays =
  30;

let matches =
  [];

let loading =
  false;

let lastError =
  null;


const $ =
  selector =>
    document.querySelector(
      selector
    );


const grid =
  $('#matchGrid');

const panel =
  $('#analysisPanel');

const template =
  $('#matchTemplate');

const tabs =
  $('#leagueTabs');


// =====================================================
// OUTILS
// =====================================================

function initials(
  name = '?'
) {

  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .map(
      word =>
        word[0]
    )
    .join('')
    .slice(
      0,
      2
    )
    .toUpperCase();
}


function pct(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === '' ||
    Number.isNaN(
      Number(value)
    )
  ) {

    return '—';
  }


  return `${Math.round(
    Number(value)
  )}%`;
}


function safeArray(
  value
) {

  return Array.isArray(
    value
  )
    ? value
    : [];
}


function escapeHtml(
  value = ''
) {

  return String(value)

    .replaceAll(
      '&',
      '&amp;'
    )

    .replaceAll(
      '<',
      '&lt;'
    )

    .replaceAll(
      '>',
      '&gt;'
    )

    .replaceAll(
      '"',
      '&quot;'
    )

    .replaceAll(
      "'",
      '&#039;'
    );
}


// =====================================================
// TITRE
// =====================================================

function updateTitle() {

  const title =
    $('#sectionTitle');

  const eyebrow =
    $('#sectionEyebrow');


  const competition =
    competitions.find(
      item =>
        item.id ===
        selectedLeague
    );


  if (
    currentMode ===
    'history'
  ) {

    if (eyebrow) {

      eyebrow.textContent =
        'RÉSULTATS TERMINÉS';
    }


    if (title) {

      title.textContent =

        selectedLeague ===
        'all'

          ? `Historique • ${historyDays} jours`

          : `${competition?.name || ''} • ${historyDays} jours`;
    }

  } else {

    if (eyebrow) {

      eyebrow.textContent =
        'MATCHS À ANALYSER';
    }


    if (title) {

      title.textContent =

        selectedLeague ===
        'all'

          ? 'Tous les matchs'

          : competition?.name ||
            'Compétition';
    }
  }
}


// =====================================================
// ONGLETS LIGUES
// =====================================================

function renderTabs() {

  if (!tabs) {
    return;
  }


  tabs.innerHTML =
    '';


  competitions.forEach(
    competition => {

      const button =
        document.createElement(
          'button'
        );


      button.className =
        'league-tab' +
        (
          selectedLeague ===
          competition.id
            ? ' active'
            : ''
        );


      button.textContent =
        competition.name;


      button.onclick =
        () => {

          selectedLeague =
            competition.id;


          renderTabs();

          updateTitle();

          renderMatches();
        };


      tabs.appendChild(
        button
      );
    }
  );
}


// =====================================================
// FILTRAGE
// =====================================================

function visibleMatches() {

  return matches

    .filter(
      match =>

        selectedLeague ===
        'all' ||

        match.competition ===
        selectedLeague
    )

    .filter(
      match => {

        if (
          currentMode ===
          'history'
        ) {

          return true;
        }


        if (
          selectedFilter ===
          'lineups'
        ) {

          return (
            match.official ===
            true
          );
        }


        if (
          selectedFilter ===
          'high'
        ) {

          return (
            match.confidence !==
            null &&

            match.confidence !==
            undefined &&

            Number(
              match.confidence
            ) >= 70
          );
        }


        return true;
      }
    );
}


// =====================================================
// MESSAGE
// =====================================================

function renderMessage(
  title,
  message
) {

  grid.innerHTML = `

    <div class="panel-card">

      <strong>
        ${escapeHtml(title)}
      </strong>

      <p>
        ${escapeHtml(message)}
      </p>

    </div>
  `;
}


// =====================================================
// HISTORIQUE
// =====================================================

function renderHistoryMatches() {

  const data =
    visibleMatches();


  if (
    !data.length
  ) {

    renderMessage(
      'Aucun match historique',
      'Aucun résultat trouvé pour cette période.'
    );

    return;
  }


  data.forEach(
    match => {

      const article =
        document.createElement(
          'article'
        );


      article.className =
        'match-card history-card';


      const homeScore =
        match?.score?.home ??
        '—';


      const awayScore =
        match?.score?.away ??
        '—';


      article.innerHTML = `

        <div class="match-card-top">

          <span class="competition">
            ${escapeHtml(
              match.competitionName ||
              'Compétition'
            )}
          </span>

          <span class="history-status">
            ● TERMINÉ
          </span>

        </div>


        <div class="fixture-row">

          <div class="mini-team">

            <span class="mini-logo">
              ${escapeHtml(
                initials(
                  match.home
                )
              )}
            </span>

            <strong>
              ${escapeHtml(
                match.home
              )}
            </strong>

          </div>


          <div class="fixture-meta">

            <strong>
              ${homeScore}
              -
              ${awayScore}
            </strong>

            <span>
              ${escapeHtml(
                match.date ||
                ''
              )}
            </span>

          </div>


          <div class="mini-team right">

            <strong>
              ${escapeHtml(
                match.away
              )}
            </strong>

            <span class="mini-logo">
              ${escapeHtml(
                initials(
                  match.away
                )
              )}
            </span>

          </div>

        </div>


        <div class="history-result">

          <div>

            <strong>
              ${escapeHtml(
                match.venue ||
                'Stade non renseigné'
              )}
            </strong>

            <div>
              ${escapeHtml(
                match.time ||
                ''
              )}
            </div>

          </div>


          <div class="result-code">
            ${escapeHtml(
              match.actualResult ||
              '—'
            )}
          </div>

        </div>
      `;


      grid.appendChild(
        article
      );
    }
  );
}


// =====================================================
// LIVE
// =====================================================

function renderLiveMatches() {

  const data =
    visibleMatches();


  if (
    !data.length
  ) {

    renderMessage(
      'Aucun match trouvé',
      'Aucun match ne correspond actuellement à ce filtre.'
    );

    return;
  }


  data.forEach(
    match => {

      const node =
        template
          .content
          .cloneNode(
            true
          );


      const card =
        node.querySelector(
          '.match-card'
        );


      node
        .querySelector(
          '.competition'
        )
        .textContent =
          String(
            match.competitionName ||
            'Compétition'
          )
            .toUpperCase();


      const lineupState =
        node.querySelector(
          '.lineup-state'
        );


      if (
        match.official
      ) {

        lineupState.textContent =
          '● COMPOS OFFICIELLES';

        lineupState.style.color =
          'var(--success)';

      } else {

        lineupState.textContent =
          '○ COMPOS EN ATTENTE';

        lineupState.style.color =
          'var(--warn)';
      }


      node
        .querySelector(
          '.home-team'
        )
        .textContent =
          match.home ||
          'Domicile';


      node
        .querySelector(
          '.away-team'
        )
        .textContent =
          match.away ||
          'Extérieur';


      node
        .querySelector(
          '.home-logo'
        )
        .textContent =
          initials(
            match.home
          );


      node
        .querySelector(
          '.away-logo'
        )
        .textContent =
          initials(
            match.away
          );


      node
        .querySelector(
          '.fixture-time'
        )
        .textContent =
          match.time ||
          '—';


      node
        .querySelector(
          '.fixture-date'
        )
        .textContent =
          match.date ||
          '—';


      node
        .querySelector(
          '.mh'
        )
        .textContent =
          pct(
            match
              ?.probs
              ?.home
          );


      node
        .querySelector(
          '.md'
        )
        .textContent =
          pct(
            match
              ?.probs
              ?.draw
          );


      node
        .querySelector(
          '.ma'
        )
        .textContent =
          pct(
            match
              ?.probs
              ?.away
          );


      node
        .querySelector(
          '.confidence-chip'
        )
        .textContent =

          match.confidence ===
          null ||

          match.confidence ===
          undefined

            ? 'CONF. —'

            : `CONF. ${Math.round(
                Number(
                  match.confidence
                )
              )}%`;


      const signal =
        node.querySelector(
          '.signal'
        );


      signal.textContent =

        match.confidence ===
        null ||

        match.confidence ===
        undefined

          ? 'Analyse statistique en attente'

          : 'Analyse disponible';


      node
        .querySelector(
          '.analyse-btn'
        )
        .onclick =
          event => {

            event.stopPropagation();

            openAnalysis(
              match.id
            );
          };


      card.onclick =
        () => {

          openAnalysis(
            match.id
          );
        };


      grid.appendChild(
        node
      );
    }
  );
}


// =====================================================
// AFFICHAGE GLOBAL
// =====================================================

function renderMatches() {

  if (
    !grid ||
    !panel
  ) {

    return;
  }


  panel.classList.add(
    'hidden'
  );


  grid.classList.remove(
    'hidden'
  );


  grid.innerHTML =
    '';


  if (
    loading
  ) {

    renderMessage(
      'Chargement…',
      currentMode === 'history'
        ? 'Récupération des matchs historiques.'
        : 'Connexion aux données Sportmonks.'
    );

    return;
  }


  if (
    lastError
  ) {

    renderMessage(
      'Données indisponibles',
      lastError
    );

    return;
  }


  if (
    currentMode ===
    'history'
  ) {

    renderHistoryMatches();

  } else {

    renderLiveMatches();
  }
}


// =====================================================
// ANALYSE MATCH LIVE
// =====================================================

function openAnalysis(
  id
) {

  const match =
    matches.find(
      item =>
        String(item.id) ===
        String(id)
    );


  if (!match) {
    return;
  }


  grid.classList.add(
    'hidden'
  );


  panel.classList.remove(
    'hidden'
  );


  window.scrollTo({
    top:0,
    behavior:'smooth'
  });


  const officialBadge =
    $('#officialBadge');


  officialBadge.textContent =

    match.official

      ? 'COMPOS OFFICIELLES'

      : 'COMPOS EN ATTENTE';


  officialBadge.className =

    'pill ' +

    (
      match.official

        ? 'success'

        : 'warn'
    );


  $('#qualityBadge')
    .textContent =

      match.quality !==
      null &&

      match.quality !==
      undefined

        ? `QUALITÉ DONNÉES ${match.quality}%`

        : 'QUALITÉ DONNÉES —';


  $('#homeName')
    .textContent =
      match.home ||
      'Domicile';


  $('#awayName')
    .textContent =
      match.away ||
      'Extérieur';


  $('#homeLogo')
    .textContent =
      initials(
        match.home
      );


  $('#awayLogo')
    .textContent =
      initials(
        match.away
      );


  $('#kickoff')
    .textContent =
      match.time ||
      '—';


  $('#venue')
    .textContent =
      `${match.date || '—'} • ${match.venue || 'Stade à confirmer'}`;


  $('#pHome')
    .textContent =
      pct(
        match
          ?.probs
          ?.home
      );


  $('#pDraw')
    .textContent =
      pct(
        match
          ?.probs
          ?.draw
      );


  $('#pAway')
    .textContent =
      pct(
        match
          ?.probs
          ?.away
      );


  $('#confidence')
    .textContent =
      pct(
        match.confidence
      );


  $('#homeFormation')
    .textContent =
      `${match.home || 'Domicile'} • ${match.formationHome || '—'}`;


  $('#awayFormation')
    .textContent =
      `${match.away || 'Extérieur'} • ${match.formationAway || '—'}`;


  const homeXI =
    safeArray(
      match.homeXI
    );


  const awayXI =
    safeArray(
      match.awayXI
    );


  $('#homeLineup')
    .innerHTML =

      (
        homeXI.length
          ? homeXI
          : ['Composition en attente']
      )
        .map(
          player =>
            `<div class="player">${escapeHtml(player)}</div>`
        )
        .join('');


  $('#awayLineup')
    .innerHTML =

      (
        awayXI.length
          ? awayXI
          : ['Composition en attente']
      )
        .map(
          player =>
            `<div class="player">${escapeHtml(player)}</div>`
        )
        .join('');


  $('#absences')
    .textContent =
      match.absences ||
      'Données blessures et suspensions en attente.';


  const factors =
    safeArray(
      match.factors
    );


  $('#factorList')
    .innerHTML =

      factors.length

        ? factors
            .map(
              item => `

                <div class="factor">

                  <div>

                    <strong>
                      ${escapeHtml(
                        item[0]
                      )}
                    </strong>

                    <p>
                      ${escapeHtml(
                        item[1]
                      )}
                    </p>

                  </div>

                  <div class="impact ${escapeHtml(
                    item[3] ||
                    'mid'
                  )}">

                    ${escapeHtml(
                      item[2]
                    )}

                  </div>

                </div>
              `
            )
            .join('')

        : `
          <div class="note-box">
            Analyse avancée en attente.
          </div>
        `;


  const markets =
    safeArray(
      match.markets
    );


  $('#marketList')
    .innerHTML =

      markets.length

        ? markets
            .map(
              item => `

                <div class="market">

                  <div>

                    <strong>
                      ${escapeHtml(
                        item[0]
                      )}
                    </strong>

                    <p>
                      ${escapeHtml(
                        item[2] ||
                        ''
                      )}
                    </p>

                  </div>

                  <div class="market-prob">

                    <b>
                      ${escapeHtml(
                        item[1]
                      )}
                    </b>

                  </div>

                </div>
              `
            )
            .join('')

        : `
          <div class="note-box">
            Probabilités en attente.
          </div>
        `;


  const context = [
    [
      'Stade',
      match.venue ||
      'À confirmer'
    ],
    [
      'Surface',
      match.surface ||
      'À confirmer'
    ],
    [
      'Météo',
      match.weather ||
      'Indisponible'
    ],
    [
      'Statut XI',
      match.official
        ? 'Officiel'
        : 'En attente'
    ]
  ];


  $('#contextList')
    .innerHTML =

      context
        .map(
          item => `

            <div class="context-item">

              <strong>
                ${escapeHtml(
                  item[0]
                )}
              </strong>

              <p>
                ${escapeHtml(
                  item[1]
                )}
              </p>

            </div>
          `
        )
        .join('');


  $('#weightBars')
    .innerHTML =

      weights
        .map(
          item => `

            <div class="weight-row">

              <span>
                ${escapeHtml(
                  item[0]
                )}
              </span>

              <div class="weight-track">

                <div
                  class="weight-fill"
                  style="width:${item[1] * 4}%"
                >
                </div>

              </div>

              <em>
                ${item[1]}%
              </em>

            </div>
          `
        )
        .join('');


  const sources =
    safeArray(
      match.sources
    );


  $('#sourceList')
    .innerHTML =

      sources.length

        ? sources
            .map(
              item => `

                <div class="source-item">

                  <strong>
                    ${escapeHtml(
                      item[0]
                    )}
                  </strong>

                  <p>
                    ${escapeHtml(
                      item[1]
                    )}
                  </p>

                </div>
              `
            )
            .join('')

        : `
          <div class="source-item">
            <strong>
              Données live
            </strong>
          </div>
        `;


  $('#modelVersion')
    .textContent =
      'Moteur live v0.4';
}


// =====================================================
// LIVE
// =====================================================

async function tryLive() {

  currentMode =
    'live';


  loading =
    true;


  lastError =
    null;


  matches =
    [];


  $('#historyControls')
    ?.classList
    .add(
      'hidden'
    );


  $('#liveFilters')
    ?.classList
    .remove(
      'hidden'
    );


  updateTitle();

  renderMatches();


  const dataMode =
    $('#dataMode');


  if (dataMode) {

    dataMode.textContent =
      'CHARGEMENT LIVE…';

    dataMode.className =
      'pill neutral';
  }


  try {

    const response =
      await fetch(
        '/.netlify/functions/fixtures',
        {
          cache:'no-store'
        }
      );


    const data =
      await response.json();


    if (
      !response.ok
    ) {

      throw new Error(
        data.details ||
        data.error ||
        `Erreur ${response.status}`
      );
    }


    matches =
      Array.isArray(
        data.matches
      )
        ? data.matches
        : [];


    loading =
      false;


    if (dataMode) {

      dataMode.textContent =
        'DONNÉES LIVE';

      dataMode.className =
        'pill success';
    }


    renderMatches();


  } catch (
    error
  ) {

    loading =
      false;


    lastError =
      String(
        error?.message ||
        error
      );


    if (dataMode) {

      dataMode.textContent =
        'LIVE INDISPONIBLE';

      dataMode.className =
        'pill warn';
    }


    renderMatches();
  }
}


// =====================================================
// HISTORIQUE
// =====================================================

async function tryHistory(
  days = 30
) {

  currentMode =
    'history';


  historyDays =
    days;


  loading =
    true;


  lastError =
    null;


  matches =
    [];


  $('#historyControls')
    ?.classList
    .remove(
      'hidden'
    );


  $('#liveFilters')
    ?.classList
    .add(
      'hidden'
    );


  updateTitle();

  renderMatches();


  const dataMode =
    $('#dataMode');


  if (dataMode) {

    dataMode.textContent =
      'CHARGEMENT HISTORIQUE…';

    dataMode.className =
      'pill neutral';
  }


  try {

    const response =
      await fetch(
        `/.netlify/functions/history?days=${days}`,
        {
          cache:'no-store'
        }
      );


    const data =
      await response.json();


    if (
      !response.ok
    ) {

      throw new Error(
        data.details ||
        data.error ||
        `Erreur ${response.status}`
      );
    }


    matches =
      Array.isArray(
        data.matches
      )
        ? data.matches
        : [];


    loading =
      false;


    if (dataMode) {

      dataMode.textContent =
        `${matches.length} MATCHS • ${days}J`;

      dataMode.className =
        'pill success';
    }


    renderMatches();


  } catch (
    error
  ) {

    loading =
      false;


    lastError =
      String(
        error?.message ||
        error
      );


    if (dataMode) {

      dataMode.textContent =
        'HISTORIQUE INDISPONIBLE';

      dataMode.className =
        'pill warn';
    }


    renderMatches();
  }
}


// =====================================================
// FILTRES LIVE
// =====================================================

document
  .querySelectorAll(
    '.seg'
  )
  .forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          document
            .querySelectorAll(
              '.seg'
            )
            .forEach(
              item =>
                item.classList.remove(
                  'active'
                )
            );


          button.classList.add(
            'active'
          );


          selectedFilter =
            button.dataset.filter;


          renderMatches();
        }
      );
    }
  );


// =====================================================
// LIVE / HISTORIQUE
// =====================================================

document
  .querySelectorAll(
    '.mode-btn'
  )
  .forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          document
            .querySelectorAll(
              '.mode-btn'
            )
            .forEach(
              item =>
                item.classList.remove(
                  'active'
                )
            );


          button.classList.add(
            'active'
          );


          if (
            button.dataset.mode ===
            'history'
          ) {

            tryHistory(
              historyDays
            );

          } else {

            tryLive();
          }
        }
      );
    }
  );


// =====================================================
// 7 / 30 / 90 JOURS
// =====================================================

document
  .querySelectorAll(
    '.history-day'
  )
  .forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          document
            .querySelectorAll(
              '.history-day'
            )
            .forEach(
              item =>
                item.classList.remove(
                  'active'
                )
            );


          button.classList.add(
            'active'
          );


          tryHistory(
            Number(
              button.dataset.days
            )
          );
        }
      );
    }
  );


// =====================================================
// RETOUR
// =====================================================

$('#backBtn')
  ?.addEventListener(
    'click',
    () => {

      panel.classList.add(
        'hidden'
      );


      grid.classList.remove(
        'hidden'
      );


      renderMatches();
    }
  );


// =====================================================
// ACTUALISER
// =====================================================

$('#refreshBtn')
  ?.addEventListener(
    'click',
    () => {

      if (
        currentMode ===
        'history'
      ) {

        tryHistory(
          historyDays
        );

      } else {

        tryLive();
      }
    }
  );


// =====================================================
// DÉMARRAGE
// =====================================================

$('#coverageValue')
  .textContent =
    '5';


renderTabs();

updateTitle();

tryLive();
