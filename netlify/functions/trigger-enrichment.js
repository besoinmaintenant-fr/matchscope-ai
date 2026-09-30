// =====================================================
// MATCHSCOPE
// DÉCLENCHEUR AUTOMATIQUE D'ENRICHISSEMENT
//
// Cette fonction est volontairement très légère.
//
// Elle NE récupère PAS elle-même les données Sportmonks.
//
// Elle déclenche :
//
// enrich-history-background
//
// qui peut ensuite travailler en arrière-plan
// sans bloquer la fonction planifiée.
// =====================================================


exports.handler =
  async () => {

    // =================================================
    // 1. VARIABLES NETLIFY
    // =================================================

    const secret =
      process
        .env
        .MATCHSCOPE_SYNC_SECRET;


    const siteUrl =
      process
        .env
        .URL;


    if (
      !secret
    ) {

      console.error(
        'trigger-enrichment : MATCHSCOPE_SYNC_SECRET absent.'
      );


      return {

        statusCode:
          500,

        body:
          JSON.stringify({

            success:
              false,

            error:
              'MATCHSCOPE_SYNC_SECRET absent.'
          })
      };
    }


    if (
      !siteUrl
    ) {

      console.error(
        'trigger-enrichment : URL Netlify absente.'
      );


      return {

        statusCode:
          500,

        body:
          JSON.stringify({

            success:
              false,

            error:
              'URL Netlify absente.'
          })
      };
    }


    // =================================================
    // 2. ENDPOINT BACKGROUND
    // =================================================

    const endpoint =

      `${siteUrl.replace(
        /\/$/,
        ''
      )}/.netlify/functions/enrich-history-background`;


    try {

      // =================================================
      // 3. LANCEMENT DU TRAITEMENT BACKGROUND
      // =================================================

      const response =
        await fetch(
          endpoint,
          {

            method:
              'POST',

            headers: {

              'content-type':
                'application/json'
            },

            body:
              JSON.stringify({

                secret
              })
          }
        );


      /*
       * Une Background Function Netlify
       * répond normalement immédiatement
       * pendant que le vrai traitement
       * continue côté serveur.
       */


      if (
        !response.ok
      ) {

        const text =
          await response.text();


        throw new Error(

          `Déclenchement enrichissement impossible : ${response.status} ${text}`
        );
      }


      // =================================================
      // 4. LOG
      // =================================================

      const summary = {

        success:
          true,

        function:
          'trigger-enrichment',

        triggeredAt:
          new Date()
            .toISOString(),

        target:
          'enrich-history-background',

        status:
          response.status
      };


      console.log(

        JSON.stringify(
          summary,
          null,
          2
        )
      );


      return {

        statusCode:
          200,

        body:
          JSON.stringify(
            summary
          )
      };


    } catch (
      error
    ) {

      console.error(

        'trigger-enrichment :',

        error
      );


      return {

        statusCode:
          500,

        body:
          JSON.stringify({

            success:
              false,

            error:
              error?.message
              ||
              String(
                error
              )
          })
      };
    }
  };
