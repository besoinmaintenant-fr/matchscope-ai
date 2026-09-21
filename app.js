const competitions = [
  {
    id: 'all',
    name: 'Tous'
  },
  {
    id: 'L1',
    name: '🇫🇷 Ligue 1'
  },
  {
    id: 'PL',
    name: '🏴 Premier League'
  },
  {
    id: 'LL',
    name: '🇪🇸 La Liga'
  },
  {
    id: 'BL',
    name: '🇩🇪 Bundesliga'
  },
  {
    id: 'SA',
    name: '🇮🇹 Serie A'
  }
];

const weights = [
  [
    'Forme pondérée',
    18
  ],
  [
    'xG / xGA',
    20
  ],
  [
    'Domicile / extérieur',
    12
  ],
  [
    'Compositions & absences',
    18
  ],
  [
    'Repos / fatigue',
    8
  ],
  [
    'Matchup tactique',
    9
  ],
  [
    'Cotes / consensus marché',
    7
  ],
  [
    'Météo / pelouse / stade',
    4
  ],
  [
    'H2H récent',
    4
  ]
];

let selectedLeague =
  'all';

let selectedFilter =
  'all';

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

const tabs =
  $('#leagueTabs');

const grid =
  $('#matchGrid');

const template =
  $('#matchTemplate');

const panel =
  $('#analysisPanel');


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


function pct(value) {

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


function confidenceText(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return 'En attente';
  }

  const number =
    Number(value);

  if (
    number >= 80
  ) {

    return 'Très forte';
  }

  if (
    number >= 70
  ) {

    return 'Forte';
  }

  if (
    number >= 60
  ) {

    return 'Moyenne';
  }

  return 'Faible';
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


function safeArray(
  value
) {

  return Array.isArray(
    value
  )
    ? value
    : [];
}


// ================================
// ONGLETS DES CHAMPIONNATS
// ================================

function renderTabs() {

  if (!tabs) {
    return;
  }

  tabs.innerHTML =
    '';

  competitions
    .forEach(
      competition => {

        const button =
          document
            .createElement(
              'button'
            );

        button.className =
          'league-tab' +
          (
            competition.id ===
            selectedLeague
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

            renderMatches();

            const title =
              $('#sectionTitle');

            if (title) {

              title.textContent =
                competition.id ===
                'all'

                  ? 'Tous les matchs'

                  : competition.name;
            }
          };

        tabs.appendChild(
          button
        );
      }
    );
}


// ================================
// FILTRES
// ================================

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


// ================================
// LISTE DES MATCHS
// ================================

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

    grid.innerHTML = `
      <div class="panel-card">

        <strong>
          Chargement des matchs…
        </strong>

        <p>
          Connexion à Sportmonks.
        </p>

      </div>
    `;

    return;
  }

  if (
    lastError
  ) {

    grid.innerHTML = `
      <div class="panel-card">

        <strong>
          Données live indisponibles
        </strong>

        <p>
          ${escapeHtml(
            lastError
          )}
        </p>

      </div>
    `;

    return;
  }

  const data =
    visibleMatches();

  if (
    !data.length
  ) {

    grid.innerHTML = `
      <div class="panel-card">

        <strong>
          Aucun match trouvé
        </strong>

        <p>
          Aucun match ne correspond
          actuellement à ce filtre
          ou à la période récupérée.
        </p>

      </div>
    `;

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
            match
              .competitionName ||
            'Compétition'
          )
            .toUpperCase();

      const lineupState =
        node
          .querySelector(
            '.lineup-state'
          );

      if (
        match.official
      ) {

        lineupState
          .textContent =
            '● COMPOS OFFICIELLES';

        lineupState
          .style
          .color =
            'var(--success)';

      } else {

        lineupState
          .textContent =
            '○ COMPOS EN ATTENTE';

        lineupState
          .style
          .color =
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
              .probs
              ?.home
          );

      node
        .querySelector(
          '.md'
        )
        .textContent =
          pct(
            match
              .probs
              ?.draw
          );

      node
        .querySelector(
          '.ma'
        )
        .textContent =
          pct(
            match
              .probs
              ?.away
          );

      const confidence =
        node
          .querySelector(
            '.confidence-chip'
          );

      confidence
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
        node
          .querySelector(
            '.signal'
          );

      if (
        match.confidence ===
        null ||

        match.confidence ===
        undefined
      ) {

        signal.textContent =
          'Analyse statistique en attente';

      } else if (
        Number(
          match.confidence
        ) >= 80
      ) {

        signal.textContent =
          'Signal modèle solide';

      } else if (
        Number(
          match.confidence
        ) >= 70
      ) {

        signal.textContent =
          'Signal exploitable';

      } else {

        signal.textContent =
          'À confirmer';
      }

      const analyseButton =
        node
          .querySelector(
            '.analyse-btn'
          );

      analyseButton.onclick =
        event => {

          event
            .stopPropagation();

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


// ================================
// FICHE DU MATCH
// ================================

function openAnalysis(
  id
) {

  const match =
    matches.find(
      item =>

        String(
          item.id
        ) ===

        String(
          id
        )
    );

  if (
    !match
  ) {

    return;
  }

  grid.classList.add(
    'hidden'
  );

  panel.classList.remove(
    'hidden'
  );

  window.scrollTo({
    top:
      0,

    behavior:
      'smooth'
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
      `${
        match.date ||
        '—'
      } • ${
        match.venue ||
        'Stade à confirmer'
      }`;

  $('#pHome')
    .textContent =
      pct(
        match
          .probs
          ?.home
      );

  $('#pDraw')
    .textContent =
      pct(
        match
          .probs
          ?.draw
      );

  $('#pAway')
    .textContent =
      pct(
        match
          .probs
          ?.away
      );

  $('#confidence')
    .textContent =
      pct(
        match.confidence
      );

  $('#homeFormation')
    .textContent =
      `${
        match.home ||
        'Domicile'
      } • ${
        match
          .formationHome ||
        '—'
      }`;

  $('#awayFormation')
    .textContent =
      `${
        match.away ||
        'Extérieur'
      } • ${
        match
          .formationAway ||
        '—'
      }`;

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

          : [
              'Composition en attente'
            ]
      )
        .map(
          player =>
            `<div class="player">${
              escapeHtml(
                player
              )
            }</div>`
        )
        .join('');

  $('#awayLineup')
    .innerHTML =

      (
        awayXI.length

          ? awayXI

          : [
              'Composition en attente'
            ]
      )
        .map(
          player =>
            `<div class="player">${
              escapeHtml(
                player
              )
            }</div>`
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

  if (
    factors.length
  ) {

    $('#factorList')
      .innerHTML =

        factors
          .map(
            (
              [
                title,
                description,
                impact,
                color
              ]
            ) => `

              <div class="factor">

                <div>

                  <strong>
                    ${
                      escapeHtml(
                        title
                      )
                    }
                  </strong>

                  <p>
                    ${
                      escapeHtml(
                        description
                      )
                    }
                  </p>

                </div>

                <div class="impact ${
                  escapeHtml(
                    color ||
                    'mid'
                  )
                }">

                  ${
                    escapeHtml(
                      impact
                    )
                  }

                </div>

              </div>
            `
          )
          .join('');

  } else {

    $('#factorList')
      .innerHTML = `

        <div class="note-box">

          L'analyse avancée sera calculée
          lorsque les données statistiques
          seront disponibles.

        </div>
      `;
  }

  const markets =
    safeArray(
      match.markets
    );

  if (
    markets.length
  ) {

    $('#marketList')
      .innerHTML =

        markets
          .map(
            (
              [
                name,
                probability,
                level
              ]
            ) => `

              <div class="market">

                <div>

                  <strong>
                    ${
                      escapeHtml(
                        name
                      )
                    }
                  </strong>

                  <p>
                    Niveau :
                    ${
                      escapeHtml(
                        level
                      )
                    }
                  </p>

                </div>

                <div class="market-prob">

                  <b>
                    ${
                      escapeHtml(
                        probability
                      )
                    }
                  </b>

                  <span>
                    probabilité
                  </span>

                </div>

              </div>
            `
          )
          .join('');

  } else {

    $('#marketList')
      .innerHTML = `

        <div class="note-box">

          Probabilités en attente.

          Aucun pronostic fictif
          n'est généré.

        </div>
      `;
  }

  const confidenceLabel =

    match.confidence ===
    null ||

    match.confidence ===
    undefined

      ? 'En attente'

      : `${Math.round(
          Number(
            match.confidence
          )
        )}% — ${
          confidenceText(
            match.confidence
          )
        }`;

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
      'À connecter'
    ],

    [
      'Confiance',

      confidenceLabel
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
          (
            [
              name,
              value
            ]
          ) => `

            <div class="context-item">

              <strong>
                ${
                  escapeHtml(
                    name
                  )
                }
              </strong>

              <p>
                ${
                  escapeHtml(
                    value
                  )
                }
              </p>

            </div>
          `
        )
        .join('');

  $('#weightBars')
    .innerHTML =

      weights
        .map(
          (
            [
              name,
              weight
            ]
          ) => `

            <div class="weight-row">

              <span>
                ${
                  escapeHtml(
                    name
                  )
                }
              </span>

              <div class="weight-track">

                <div
                  class="weight-fill"
                  style="width:${
                    weight * 4
                  }%"
                ></div>

              </div>

              <em>
                ${weight}%
              </em>

            </div>
          `
        )
        .join('');

  const sources =
    safeArray(
      match.sources
    );

  if (
    sources.length
  ) {

    $('#sourceList')
      .innerHTML =

        sources
          .map(
            (
              [
                name,
                description,
                role
              ]
            ) => `

              <div class="source-item">

                <strong>

                  ${
                    escapeHtml(
                      name
                    )
                  }

                  <span class="tiny">
                    • ${
                      escapeHtml(
                        role
                      )
                    }
                  </span>

                </strong>

                <p>
                  ${
                    escapeHtml(
                      description
                    )
                  }
                </p>

              </div>
            `
          )
          .join('');

  } else {

    $('#sourceList')
      .innerHTML = `

        <div class="source-item">

          <strong>
            Données live
          </strong>

          <p>
            Sources supplémentaires
            à connecter.
          </p>

        </div>
      `;
  }

  const modelVersion =
    $('#modelVersion');

  if (
    modelVersion
  ) {

    modelVersion
      .textContent =
        'Moteur live v0.2';
  }
}


// ================================
// CONNEXION À SPORTMONKS
// ================================

async function tryLive() {

  loading =
    true;

  lastError =
    null;

  matches =
    [];

  const dataMode =
    $('#dataMode');

  if (
    dataMode
  ) {

    dataMode.textContent =
      'CHARGEMENT LIVE…';

    dataMode.className =
      'pill neutral';
  }

  renderMatches();

  try {

    const response =
      await fetch(
        '/.netlify/functions/fixtures',
        {
          cache:
            'no-store'
        }
      );

    let data =
      {};

    try {

      data =
        await response.json();

    } catch (
      _error
    ) {

      data =
        {};
    }

    if (
      !response.ok
    ) {

      throw new Error(
        data.details ||
        data.error ||
        `Erreur API ${
          response.status
        }`
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

    lastError =
      null;

    if (
      dataMode
    ) {

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

    matches =
      [];

    lastError =
      String(
        error?.message ||
        error
      );

    if (
      dataMode
    ) {

      dataMode.textContent =
        'LIVE INDISPONIBLE';

      dataMode.className =
        'pill warn';
    }

    renderMatches();
  }
}


// ================================
// FILTRES
// ================================

document
  .querySelectorAll(
    '.seg'
  )
  .forEach(
    button => {

      button
        .addEventListener(
          'click',
          () => {

            document
              .querySelectorAll(
                '.seg'
              )
              .forEach(
                item =>
                  item
                    .classList
                    .remove(
                      'active'
                    )
              );

            button
              .classList
              .add(
                'active'
              );

            selectedFilter =
              button
                .dataset
                .filter;

            renderMatches();
          }
        );
    }
  );


// ================================
// BOUTONS
// ================================

const backButton =
  $('#backBtn');

if (
  backButton
) {

  backButton.onclick =
    () =>
      renderMatches();
}

const refreshButton =
  $('#refreshBtn');

if (
  refreshButton
) {

  refreshButton.onclick =
    () =>
      tryLive();
}


// ================================
// NOMBRE DE COMPÉTITIONS
// ================================

const coverageValue =
  $('#coverageValue');

if (
  coverageValue
) {

  coverageValue.textContent =
    '5';
}


// ================================
// DÉMARRAGE
// ================================

renderTabs();

tryLive();
