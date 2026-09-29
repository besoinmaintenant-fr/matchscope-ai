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


  function normalizePrediction(
    data
  ) {

    /*
     * Prédiction déjà enregistrée :
     * colonnes Supabase.
     */

    if (
      data?.prediction &&
      data.prediction.probability_home !==
      undefined
    ) {

      const row =
        data.prediction;


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

        locked:
          row.locked === true
      };
    }


    /*
     * Nouvelle PRELINEUP :
     * résultat direct de V0.7.
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
     * XI officiels présents :
     * V0.7 est seulement une base,
     * aucune FINAL n'est fabriquée.
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


    container.innerHTML =
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
  }


  async function loadPrediction(
    match
  ) {

    /*
     * V0.7 est actuellement validé
     * uniquement sur ces 3 ligues.
     */

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
