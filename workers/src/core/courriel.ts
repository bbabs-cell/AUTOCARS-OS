/**
 * L'envoi de courriel, par Resend
 * ==================================================================
 * UN WORKER NE SAIT PAS ENVOYER DE COURRIEL TOUT SEUL.
 * ==================================================================
 *
 * Le PHP avait `mail()` : la machine s'en chargeait. Sur Cloudflare,
 * il n'y a pas de serveur SMTP local — il faut un service tiers, donc
 * un compte et une clé. Le commanditaire a choisi **Resend**.
 *
 * DEUX TRANSPORTS, ET LE CHOIX SE FAIT TOUT SEUL :
 *
 *   · RESEND   dès que `RESEND_TOKEN` est posé en secret.
 *   · JOURNAL  sinon. Le message part dans les traces du Worker, le
 *              produit continue de fonctionner, et le développeur
 *              voit le contenu exact sans compte chez personne.
 *
 * Ce n'est pas une solution de repli honteuse : c'est ce qui permet
 * de suivre tout le parcours « mot de passe oublié » en local, et de
 * faire tourner les tests sans jamais toucher au réseau.
 *
 * ------------------------------------------------------------------
 * L'ÉCHEC D'ENVOI NE REMONTE JAMAIS À L'APPELANT
 *
 * La route de mot de passe oublié répond exactement la même chose que
 * le compte existe ou non. Si un échec d'envoi changeait sa réponse,
 * ce formulaire deviendrait un moyen commode de découvrir quelles
 * adresses sont enregistrées — précisément ce que la réponse unique
 * existe pour empêcher.
 *
 * On renvoie donc `false` en silence, et l'appelant ne s'en sert que
 * pour ses propres traces.
 *
 * ------------------------------------------------------------------
 * CE QU'IL FAUT AVOIR FAIT CHEZ RESEND AVANT QUE ÇA MARCHE
 *
 * 1. Ajouter le domaine `magyapro.com` dans Resend, et poser les
 *    enregistrements DNS qu'il donne (SPF, DKIM) — chez Cloudflare,
 *    puisque c'est là qu'est la zone.
 * 2. `npx wrangler secret put RESEND_TOKEN`
 *
 * Sans le point 1, Resend accepte la requête et le courriel n'arrive
 * pas : les messageraies rejettent un expéditeur non authentifié.
 * C'est la panne la plus déroutante de ce module, parce qu'elle ne
 * ressemble pas à une panne.
 */

/** L'API de Resend. Fixe : c'est un service, pas une variable. */
const RESEND = 'https://api.resend.com/emails';

export interface Message {
  destinataire: string;
  sujet: string;
  texte: string;
}

export async function envoie(env: Env, message: Message): Promise<boolean> {
  const cle = env.RESEND_TOKEN ?? '';

  if (cle === '') {
    // Le transport JOURNAL. Le contenu apparaît dans `wrangler tail`.
    console.log(
      '[COURRIEL — non envoyé, RESEND_TOKEN absent]\n'
      + `À : ${message.destinataire}\nObjet : ${message.sujet}\n\n${message.texte}`,
    );

    return false;
  }

  try {
    const reponse = await fetch(env.MAIL_ENDPOINT ?? RESEND, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cle}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM ?? 'no-reply@magyapro.com',
        // Resend attend un TABLEAU, même pour un seul destinataire.
        // Une chaîne passe parfois et échoue ailleurs : autant s'en
        // tenir à ce que la documentation annonce.
        to: [message.destinataire],
        subject: message.sujet,
        text: message.texte,
      }),
    });

    if (reponse.ok) {
      return true;
    }

    // ON NE JOURNALISE PAS LE CORPS DE LA RÉPONSE TEL QUEL : il
    // reprend l'adresse du destinataire, et les traces d'un Worker
    // sont lisibles par toute personne ayant accès au compte. Le code
    // HTTP et le nom de l'erreur suffisent à diagnostiquer.
    const detail = await reponse.json().catch(() => null) as { name?: string } | null;

    // 422 : le domaine expéditeur n'est pas vérifié — la panne la
    // plus fréquente, et celle qui ne ressemble pas à une panne.
    // 429 : Resend limite le débit ; le message est perdu, pas
    // réessayé. Le client peut redemander son lien.
    console.error(
      `Resend a refusé l'envoi : HTTP ${reponse.status}`,
      detail?.name ?? '',
      reponse.status === 422
        ? '— le domaine expéditeur est-il vérifié chez Resend ?'
        : '',
    );

    return false;
  } catch (e) {
    console.error("Envoi de courriel impossible :", e);

    return false;
  }
}
