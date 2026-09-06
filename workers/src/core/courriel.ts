/**
 * L'envoi de courriel
 * ==================================================================
 * UN WORKER NE SAIT PAS ENVOYER DE COURRIEL TOUT SEUL.
 * ==================================================================
 *
 * Le PHP avait `mail()` : la machine s'en chargeait. Sur Cloudflare,
 * il n'y a pas de serveur SMTP local — il faut un service tiers, donc
 * un compte et une clé. C'est une décision qui appartient au
 * commanditaire, pas au code.
 *
 * Ce module rend donc l'envoi ENFICHABLE, avec deux transports :
 *
 *   · JOURNAL   le message est écrit dans les traces du Worker. Sans
 *               configuration, c'est ce qui se passe — le produit
 *               continue de fonctionner et le développeur voit le
 *               contenu exact.
 *   · HTTP      un appel à l'API d'un service d'envoi, dès que
 *               `MAIL_ENDPOINT` et `MAIL_TOKEN` sont renseignés.
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
 */

export interface Message {
  destinataire: string;
  sujet: string;
  texte: string;
}

export async function envoie(env: Env, message: Message): Promise<boolean> {
  const url = env.MAIL_ENDPOINT ?? '';
  const jeton = env.MAIL_TOKEN ?? '';

  if (url === '' || jeton === '') {
    // Le transport JOURNAL. Le contenu du message apparaît dans
    // `wrangler tail` : c'est ce qui permet de suivre le parcours
    // complet en développement sans compte chez personne.
    console.log(
      `[COURRIEL — non envoyé, aucun service configuré]\n`
      + `À : ${message.destinataire}\nObjet : ${message.sujet}\n\n${message.texte}`,
    );

    return false;
  }

  try {
    const reponse = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jeton}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM ?? 'no-reply@autocare.local',
        to: message.destinataire,
        subject: message.sujet,
        text: message.texte,
      }),
    });

    if (!reponse.ok) {
      console.error("Envoi de courriel refusé par le service :", reponse.status);

      return false;
    }

    return true;
  } catch (e) {
    console.error("Envoi de courriel impossible :", e);

    return false;
  }
}
