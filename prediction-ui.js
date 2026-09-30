(() => {

  if (
    typeof openAnalysis !==
    'function'
  ) {
    console.error(
      'MatchScope prediction-ui : openAnalysis introuvable.'
    );

    return;
  }


  const previousOpenAnalysis =
    openAnalysis;


  function pct(
    value
  ) {

    const number =
      Number(value);


    if (
      !Number.isFinite(number)
    ) {
      return '—';
    }


    return `${
      Math.round(
        number * 100
      )
    }%`;
  }


  function coverage(
    value
  ) {

    const number =
      Number(value);


    if (
      !Number.isFinite(number)
    ) {
      return '—';
    }


    return `${
      Math.round(number)
    }%`;
  }


  function setText(
    selector,
    value
  ) {

    const element =
      document.querySelector(
        selector
      );


    if (element) {
      element.textContent =
        value;
    }
  }


  function exactScorePayload(
    data,
    row = null
  ) {

    /*
     * Ancienne prédiction figée :
     * prediction.js renvoie exactScore séparément.
     */

    if (
      data?.exactScore
    ) {

      return data.exactScore;
    }


    /*
     * Nouvelle prédiction figée :
     * score exact enregistré dans snapshot.
     */

    if (
      row
        ?.snapshot
        ?.exactScore
    ) {

      return row
        .snapshot
        .exactScore;
    }


    /*
     * Nouvelle PRELINEUP calculée directement.
     */

    if (
      data
        ?.model
        ?.mostLikelyScore
    ) {

      return {

        mostLikelyScore:
          data.model.mostLikelyScore,

        topScores:
          data.model.topScores,

        scoreDistribution:
          data.model.scoreDistribution,

        scoreModel:
          data.model.scoreModel
      };
    }


    /*
     * Base V0.7 si les XI sont déjà officiels.
     */

    if (
      data
        ?.baseModel
        ?.mostLikelyScore
    ) {

      return {

        mostLikelyScore:
          data.baseModel.mostLikelyScore,

        topScores:
          data.baseModel.topScores,

        scoreDistribution:
          data.baseModel.scoreDistribution,

        scoreModel:
          data.baseModel.scoreModel
      };
    }


    return null;
  }


  function normalizePrediction(
    data
  ) {

    /*
     * Prédiction déjà enregistrée dans Supabase.
     */

    if (
      data?.prediction &&
      data.prediction.probability_home !==
      undefined
    ) {

      const row =
        data.prediction;


      const exactScore =
        exactScorePayload(
          data,
          row
        );


      return {

        home:
          Number(
            row.probability_home
          ),

        draw:
          Number(
            row.probability_draw
          ),

        away:
          Number(
            row.probability_away
          ),

        over15:
          Number(
            row.probability_over_15
          ),

        over25:
          Number(
            row.probability_over_25
          ),

        btts:
          Number(
            row.probability_btts
          ),

        lambdaHome:
          Number(
            row.lambda_home
          ),

        lambdaAway:
          Number(
            row.lambda_away
          ),

        eloHome:
          Number(
            row.elo_home
          ),

        eloAway:
          Number(
            row.elo_away
          ),

        quality:
          Number(
            row.data_coverage
          ),

        mostLikelyScore:
          exactScore
            ?.mostLikelyScore
          ||
          null,

        topScores:
          Array.isArray(
            exactScore
              ?.topScores
          )
            ? exactScore.topScores
            : [],

        scoreDistribution:
          Array.isArray(
            exactScore
              ?.scoreDistribution
          )
            ? exactScore.scoreDistribution
            : [],

        scoreModel:
          exactScore
            ?.scoreModel
          ||
          null,

        locked:
          row.locked === true
      };
    }


    /*
     * Nouvelle PRELINEUP.
     */

    if (
      data?.model
    ) {

      return {
        ...data.model,

        locked:
          Boolean(
            data.saved
          )
      };
    }


    /*
     * XI officiels :
     * V0.7 reste une base.
     */

    if (
      data?.baseModel
    ) {

      return {
        ...data.baseModel,

        locked:
          false
      };
    }


    return null;
  }


  function renderMarkets(
    model
  ) {

    const container =
      document.querySelector(
        '#marketList'
      );


    if (!container) {
      return;
    }


    const markets = [

      [
        '+1,5 buts',
        model.over15,
        'Probabilité calculée par V0.7'
      ],

      [
        '+2,5 buts',
        model.over25,
        'Probabilité calculée par V0.7'
      ],

      [
        'Les deux équipes marquent',
        model.btts,
        'Probabilité BTTS calculée par V0.7'
      ]
    ];


    const marketHtml =

      markets

        .filter(
          item =>
            Number.isFinite(
              Number(
                item[1]
              )
            )
        )

        .map(
          item => `

            <div class="market">

              <div>

                <strong>
                  ${item[0]}
                </strong>

                <p>
                  ${item[2]}
                </p>

              </div>

              <div class="market-prob">

                <b>
                  ${pct(
                    item[1]
                  )}
                </b>

              </div>

            </div>
          `
        )

        .join('');


    let exactScoreHtml =
      '';


    const mainScore =
      model
        ?.mostLikelyScore;


    if (
      mainScore &&
      Number.isFinite(
        Number(
          mainScore.probability
        )
      )
    ) {

      const scoreLabel =

        mainScore.score

        ||

        `${mainScore.homeGoals}-${mainScore.awayGoals}`;


      const alternatives =

        Array.isArray(
          model.topScores
        )

          ? model.topScores
              .slice(
                1,
                5
              )
              .filter(
                score =>
                  Number.isFinite(
                    Number(
                      score.probability
                    )
                  )
              )

          : [];


      const alternativesText =

        alternatives.length

          ? alternatives
              .map(
                score => {

                  const label =

                    score.score

                    ||

                    `${score.homeGoals}-${score.awayGoals}`;


                  return `${label} ${pct(
                    score.probability
                  )}`;
                }
              )

              .join(
                ' · '
              )

          : '—';


      exactScoreHtml =
        `

          <div class="market">

            <div>

              <strong>
                Score exact le plus probable
              </strong>

              <p>
                Dixon-Coles aligné sur les probabilités finales 1 / N / 2 de V0.7
              </p>

              <p>
                Alternatives :
                ${alternativesText}
              </p>

            </div>

            <div class="market-prob">

              <b>
                ${scoreLabel} · ${pct(
                  mainScore.probability
                )}
              </b>

            </div>

          </div>
        `;
    }


    container.innerHTML =

      marketHtml

      +

      exactScoreHtml;
  }


  function renderServerModel(
    data
  ) {

    const model =
      normalizePrediction(
        data
      );


    if (!model) {

      throw new Error(
        'Prédiction serveur illisible.'
      );
    }


    setText(
      '#pHome',
      pct(
        model.home
      )
    );


    setText(
      '#pDraw',
      pct(
        model.draw
      )
    );


    setText(
      '#pAway',
      pct(
        model.away
      )
    );


    setText(
      '#confidence',
      coverage(
        model.quality
      )
    );


    setText(
      '#qualityBadge',
      `COUVERTURE DONNÉES ${
        coverage(
          model.quality
        )
      }`
    );


    let versionText =
      `Moteur ${
        data.modelVersion ||
        'v0.7'
      }`;


    if (
      data.stage ===
      'PRELINEUP'
    ) {

      versionText +=
        data.alreadyExists

          ? ' • PRELINEUP FIGÉE'

          : ' • PRELINEUP';
    }


    if (
      data.stage ===
      'FINAL'
    ) {

      versionText +=
        ' • FINAL EN ATTENTE DU MODÈLE XI';
    }


    setText(
      '#modelVersion',
      versionText
    );


    const badge =
      document.querySelector(
        '#officialBadge'
      );


    if (badge) {

      if (
        data.officialLineups
      ) {

        badge.textContent =
          'COMPOS OFFICIELLES';

        badge.className =
          'pill success';

      } else {

        badge.textContent =
          'PRELINEUP FIGÉE';

        badge.className =
          'pill neutral';
      }
    }


    renderMarkets(
      model
    );
  }


  function renderLoading() {

    setText(
      '#pHome',
      '…'
    );

    setText(
      '#pDraw',
      '…'
    );

    setText(
      '#pAway',
      '…'
    );

    setText(
      '#confidence',
      '…'
    );

    setText(
      '#modelVersion',
      'Chargement V0.7 serveur…'
    );


    const marketList =
      document.querySelector(
        '#marketList'
      );


    if (
      marketList
    ) {

      marketList.innerHTML =
        '';
    }
  }


  function renderError(
    message
  ) {

    setText(
      '#pHome',
      '—'
    );

    setText(
      '#pDraw',
      '—'
    );

    setText(
      '#pAway',
      '—'
    );

    setText(
      '#confidence',
      '—'
    );

    setText(
      '#modelVersion',
      `V0.7 indisponible • ${message}`
    );


    const marketList =
      document.querySelector(
        '#marketList'
      );


    if (
      marketList
    ) {

      marketList.innerHTML =
        '';
    }
  }


  async function loadPrediction(
    match
  ) {

    if (
      ![
        'PL',
        'BL',
        'LL'
      ].includes(
        match.competition
      )
    ) {

      renderError(
        'championnat hors modèle'
      );

      return;
    }


    renderLoading();


    try {

      const response =
        await fetch(
          '/.netlify/functions/prediction',
          {
            method:
              'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({
                fixtureId:
                  Number(
                    match.id
                  )
              }),

            cache:
              'no-store'
          }
        );


      let data =
        {};


      try {

        data =
          await response.json();

      } catch {

        throw new Error(
          'Réponse serveur illisible.'
        );
      }


      if (
        !response.ok ||
        data.success !== true
      ) {

        throw new Error(
          data.message ||
          data.details ||
          data.error ||
          `Erreur ${response.status}`
        );
      }


      renderServerModel(
        data
      );


    } catch (
      error
    ) {

      console.error(
        'MatchScope prediction-ui:',
        error
      );


      renderError(
        error?.message ||
        String(error)
      );
    }
  }


  openAnalysis =
    function (
      id
    ) {

      /*
       * Conserve app.js + preanalysis.js.
       */

      previousOpenAnalysis(
        id
      );


      if (
        typeof currentMode !==
        'undefined' &&
        currentMode !==
        'live'
      ) {

        return;
      }


      if (
        typeof matches ===
        'undefined'
      ) {

        return;
      }


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


      if (!match) {
        return;
      }


      loadPrediction(
        match
      );
    };

})();
