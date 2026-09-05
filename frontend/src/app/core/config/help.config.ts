/**
 * L'aide du produit
 * ==================================================================
 * ELLE EST ORGANISÉE PAR REFUS, PAS PAR MENU.
 * ==================================================================
 *
 * Une aide classique décrit les écrans : « la page Rendez-vous vous
 * permet de… ». Personne ne la lit, parce que personne n'ouvre l'aide
 * pour apprendre à quoi sert un écran qu'il a sous les yeux.
 *
 * On ouvre l'aide quand le logiciel a DIT NON. « Pourquoi je ne peux
 * pas rendre ce véhicule ? » — et à ce moment-là, une table des
 * matières par module ne sert à rien.
 *
 * Chaque entrée est donc formulée comme la question qu'on se pose
 * devant le refus, et répond dans cet ordre :
 *   1. ce que le logiciel refuse,
 *   2. POURQUOI — la raison métier, jamais « c'est comme ça »,
 *   3. QUOI FAIRE maintenant.
 *
 * ------------------------------------------------------------------
 * CETTE AIDE NE RECOPIE AUCUN SEUIL
 *
 * C'est la règle qui la garde honnête. Les vraies règles vivent dans
 * le serveur — c'est lui qui refuse — et ce fichier en est
 * forcément une SECONDE COPIE, écrite en français. Une seconde copie
 * finit toujours par diverger de la première.
 *
 * On limite les dégâts en n'écrivant ici que ce qui ne bouge pas :
 * le sens de la règle, jamais sa valeur. « On ne déclare pas une
 * absence avant l'heure du rendez-vous » restera vrai si le délai de
 * grâce passe de quinze à trente minutes ; « quinze minutes après
 * l'heure » serait faux le jour même du changement, et personne ne
 * penserait à venir le corriger ici.
 *
 * ------------------------------------------------------------------
 * `id` EST UNE ANCRE, ET ELLE EST PUBLIQUE
 *
 * Un écran peut renvoyer vers `/help#restitution-impayee`. Les
 * identifiants ne se renomment donc pas à la légère : un lien envoyé
 * dans un message d'erreur doit continuer de tomber au bon endroit.
 */

export interface HelpEntry {
  /** Ancre stable, utilisable dans une URL : `/help#…`. */
  readonly id: string;

  /** La question telle qu'on se la pose devant le refus. */
  readonly question: string;

  /** La règle, et surtout sa raison. */
  readonly answer: string;

  /** Ce qu'il faut faire maintenant. */
  readonly todo: string;
}

export interface HelpSection {
  readonly id: string;
  readonly label: string;
  /** Icône Bootstrap Icons, sans le préfixe `bi-`. */
  readonly icon: string;
  readonly entries: readonly HelpEntry[];
}

export const HELP: readonly HelpSection[] = [
  {
    id: 'parcours',
    label: 'Le parcours d’un véhicule',
    icon: 'shield-check',
    entries: [
      {
        id: 'lavage-sans-inspection',
        question: 'Pourquoi je ne peux pas passer ce véhicule au lavage ?',
        answer:
          "Parce que son inspection d'entrée n'a pas été enregistrée. C'est la "
          + 'seule protection de la station le jour où un client affirme qu’une rayure '
          + "n'y était pas : sans état constaté à l'arrivée, c'est sa parole "
          + 'contre la vôtre, et vous payez.',
        todo:
          "Ouvrez le dossier, faites l'inspection d'entrée avec des photos, puis "
          + 'lancez le lavage. Cela prend une minute et vaut une carrosserie.',
      },
      {
        id: 'restitution-controle',
        question: 'Pourquoi je ne peux pas rendre le véhicule après le lavage ?',
        answer:
          "Le contrôle qualité est une étape obligatoire, et il peut RENVOYER au "
          + 'lavage : un contrôle qui ne pourrait que valider ne serait pas un '
          + 'contrôle.',
        todo:
          'Passez le dossier au contrôle qualité. S’il est conforme, il devient '
          + '« prêt à restituer » ; sinon, renvoyez-le au lavage.',
      },
      {
        id: 'restitution-impayee',
        question: 'Le véhicule est prêt mais je ne peux pas rendre les clés.',
        answer:
          "La prestation n'est pas réglée. C'est la règle la plus sensible du "
          + 'produit : un véhicule rendu impayé ne se rattrape presque jamais.',
        todo:
          "Encaissez au comptoir, et le dossier se débloque. Si le client part sans "
          + 'payer malgré tout, un responsable peut lever le blocage — la '
          + 'dérogation est alors enregistrée à son nom, avec la date.',
      },
      {
        id: 'deux-dossiers',
        question: 'Le logiciel dit qu’un dossier est déjà ouvert sur ce véhicule.',
        answer:
          'Deux dossiers ouverts sur la même voiture, ce sont deux inspections qui '
          + 'se contredisent, et un litige garanti sur « laquelle des deux fait '
          + 'foi ».',
        todo:
          'Terminez ou annulez le dossier en cours avant d’en ouvrir un nouveau. Le '
          + 'message vous donne sa référence.',
      },
      {
        id: 'annulation',
        question: 'Le client repart au milieu du lavage. Que faire ?',
        answer:
          'Annulez le dossier, à n’importe quelle étape. Le produit l’autorise '
          + 'partout, exprès : un logiciel qui refuse d’annuler oblige à mentir '
          + 'sur les statuts, et des données fausses valent moins que pas de '
          + 'données du tout.',
        todo:
          'Annulez : le dossier reste dans l’historique du véhicule, marqué '
          + 'comme annulé.',
      },
    ],
  },

  {
    id: 'argent',
    label: 'L’argent',
    icon: 'cash-stack',
    entries: [
      {
        id: 'encaissement-erreur',
        question: 'Je me suis trompé de montant. Comment corriger ?',
        answer:
          'Un encaissement ne se modifie pas et ne s’efface pas. Une caisse dont on '
          + 'peut réécrire les lignes ne prouve plus rien — ni pour vous, ni '
          + 'devant un contrôle.',
        todo:
          'Enregistrez un remboursement, puis le bon montant. Les deux écritures '
          + 'restent visibles, et c’est exactement ce qu’on veut : on voit '
          + 'l’erreur ET sa correction.',
      },
      {
        id: 'ecart-caisse',
        question: 'Ma caisse ne tombe pas juste. Puis-je ajuster le total ?',
        answer:
          'Non. L’écart entre ce que vous avez compté et ce que le logiciel '
          + 'attendait est ENREGISTRÉ, pas corrigé. Un écart qu’on efface est '
          + 'un écart qu’on ne cherchera jamais ; un écart qui revient tous '
          + 'les soirs raconte quelque chose.',
        todo:
          'Clôturez avec le montant réellement compté. L’écart est noté avec '
          + 'la vacation, et vous pourrez le relire plus tard.',
      },
      {
        id: 'deux-caisses',
        question: 'Je ne peux pas ouvrir une caisse : il y en a déjà une.',
        answer:
          'Une seule caisse peut être ouverte par station à la fois. Deux caisses '
          + 'ouvertes en même temps, c’est un encaissement qui tombe dans '
          + 'l’une ou l’autre sans qu’on sache laquelle.',
        todo:
          'Clôturez la vacation en cours avant d’en ouvrir une nouvelle.',
      },
      {
        id: 'recette-invisible',
        question: 'Je ne vois pas la recette du jour ni la caisse.',
        answer:
          'Un compte employé encaisse au comptoir et voit ce qui est dû SUR LE '
          + 'DOSSIER qu’il rend, mais pas le cumul de la journée. Ce n’est pas '
          + 'de la méfiance : un compte volé ne doit pas donner accès au '
          + 'chiffre d’affaires de la station.',
        todo:
          'Demandez à un responsable. S’il s’agit d’un besoin permanent, le '
          + 'propriétaire peut changer le rôle du compte.',
      },
    ],
  },

  {
    id: 'rendez-vous',
    label: 'Les rendez-vous',
    icon: 'calendar-week',
    entries: [
      {
        id: 'creneau-plein',
        question: 'Le logiciel me prévient que l’heure est chargée. Dois-je refuser ?',
        answer:
          'C’est vous qui décidez. Le logiciel ne connaît pas la capacité réelle '
          + 'de votre station : trois laveurs sur un lavage simple, c’est six '
          + 'voitures à l’heure ; sur un detailing, c’est une. Il prévient, '
          + 'il ne refuse jamais.',
        todo:
          'Notez le rendez-vous si vous pouvez le tenir. L’avertissement reste '
          + 'affiché, il ne bloque rien.',
      },
      {
        id: 'absence-avant-heure',
        question: 'Je ne peux pas déclarer ce client absent.',
        answer:
          'On ne déclare pas une absence avant l’heure du rendez-vous, plus un '
          + 'court délai. Une absence reste dans l’historique d’un client : '
          + 'l’inscrire pour quelqu’un qui arrive avec cinq minutes de retard '
          + 'serait injuste, et le logiciel n’a aucun moyen de le savoir.',
        todo:
          'Attendez l’heure passée. Le rendez-vous apparaîtra alors dans le '
          + 'bloc « à traiter », en haut du carnet.',
      },
      {
        id: 'prix-promis',
        question: 'J’ai changé mon tarif, mais le rendez-vous garde l’ancien prix.',
        answer:
          'C’est voulu : LE PRIX PROMIS EST LE PRIX FACTURÉ. Le tarif annoncé '
          + 'au client au téléphone est recopié sur son rendez-vous et ne bouge '
          + 'plus. Une augmentation découverte à l’arrivée est le meilleur '
          + 'moyen de perdre un client.',
        todo:
          'Si le client accepte un autre tarif, changez la prestation du '
          + 'rendez-vous : le prix est alors refixé sur ce qu’il a accepté.',
      },
      {
        id: 'rendez-vous-termine',
        question: 'Je ne peux plus modifier ce rendez-vous.',
        answer:
          'Un rendez-vous honoré, annulé ou déclaré absent est terminé, '
          + 'définitivement. Rouvrir une issue déjà constatée reviendrait à '
          + 'réécrire ce qui s’est passé.',
        todo:
          'Notez un nouveau rendez-vous si le client reprend un créneau.',
      },
    ],
  },

  {
    id: 'fidelite',
    label: 'La fidélité et les forfaits',
    icon: 'award',
    entries: [
      {
        id: 'recompense-refusee',
        question: 'Le client a ses tampons mais la récompense est refusée.',
        answer:
          'Deux causes possibles : le programme de fidélité n’est pas encore '
          + 'activé, ou les lavages comptés n’ont pas tous été réell'
          + 'ement réglés. Un tampon récompense un passage payé, sinon la '
          + 'carte se remplit toute seule.',
        todo:
          'Ouvrez l’écran Fidélité : il affiche la carte du client et ce qui '
          + 'manque. Le propriétaire active le programme.',
      },
      {
        id: 'forfait-refuse',
        question: 'Le forfait du client ne couvre pas ce lavage.',
        answer:
          'Un forfait porte sur UNE prestation, un nombre de lavages et une date '
          + 'limite. Le serveur vérifie les trois. S’il refuse, c’est que la '
          + 'prestation ne correspond pas, que le solde est épuisé, ou que le '
          + 'forfait est périmé.',
        todo:
          'L’écran Abonnements montre ce qu’il reste et jusqu’à quand. Le '
          + 'client peut régler ce lavage normalement, ou reprendre un forfait.',
      },
      {
        id: 'forfait-remboursement',
        question: 'Le client annule son forfait. Est-il remboursé ?',
        answer:
          'Le logiciel ne rembourse rien tout seul et ne calcule aucun prorata. '
          + 'Combien rendre à quelqu’un qui a utilisé trois lavages sur dix '
          + 'est une décision commerciale, pas une division.',
        todo:
          'Annulez le forfait, puis, si vous décidez de rembourser, enregistrez '
          + 'le remboursement en caisse.',
      },
    ],
  },

  {
    id: 'equipe',
    label: 'L’équipe',
    icon: 'person-badge',
    entries: [
      {
        id: 'dernier-administrateur',
        question: 'Je ne peux pas désactiver ce compte.',
        answer:
          'C’est le dernier administrateur actif. Une entreprise dont plus '
          + 'personne ne peut gérer les comptes est enfermée dehors, et il faut '
          + 'intervenir dans la base pour l’en sortir.',
        todo: 'Nommez un autre administrateur, puis désactivez celui-ci.',
      },
      {
        id: 'propre-role',
        question: 'Je ne peux pas changer mon propre rôle.',
        answer:
          'Le seul effet garanti serait de ne plus pouvoir revenir en arrière.',
        todo: 'Demandez-le à un autre administrateur.',
      },
      {
        id: 'suppression-compte',
        question: 'Comment supprimer le compte de quelqu’un qui est parti ?',
        answer:
          'On ne supprime pas un compte, on le désactive. Son nom figure sur des '
          + 'inspections, des encaissements et des restitutions : effacer la ligne '
          + 'trouerait l’historique, c’est-à-dire ce qui vous sert en cas de '
          + 'litige. L’accès est coupé immédiatement, la trace reste.',
        todo: 'Écran Équipe, modifiez le membre, passez son compte à « désactivé ».',
      },
      {
        id: 'pointage-oublie',
        question: 'Quelqu’un a oublié de pointer son départ.',
        answer:
          'Le logiciel ne ferme AUCUN pointage tout seul. Il ne sait pas à quelle '
          + 'heure la personne est partie, et ces heures servent à la payer. '
          + 'Inventer un horaire serait pire que ne rien noter.',
        todo:
          'Un responsable corrige l’heure sur l’écran Pointage. La correction '
          + 'est enregistrée à son nom, avec son motif, et la personne '
          + 'concernée peut la relire.',
      },
      {
        id: 'pointer-pour-un-collegue',
        question: 'Je ne peux pas pointer pour un collègue.',
        answer:
          'Chacun pointe pour soi. Pointer à la place de quelqu’un est le '
          + 'premier détournement d’un registre de présence.',
        todo:
          'Si un collègue a oublié, un responsable ajoute ou corrige son '
          + 'pointage — nominativement.',
      },
    ],
  },

  {
    id: 'stations',
    label: 'Les stations et les paramètres',
    icon: 'geo-alt',
    entries: [
      {
        id: 'fermer-station',
        question: 'Je ne peux pas fermer cette station.',
        answer:
          'Deux raisons possibles. Des véhicules sont encore sur place : ils '
          + 'appartiennent à des clients qui vont revenir les chercher, et leur '
          + 'dossier doit pouvoir aller jusqu’à la restitution. Ou c’est votre '
          + 'dernière station ouverte : sans aucun point de service, vous ne '
          + 'pourriez plus rien enregistrer.',
        todo:
          'La colonne « sur place » de l’écran Stations dit combien de '
          + 'dossiers restent à terminer. Terminez-les, ou ouvrez une autre '
          + 'station d’abord.',
      },
      {
        id: 'supprimer-station',
        question: 'Comment supprimer une station ?',
        answer:
          'On la ferme, on ne l’efface pas. Elle figure sur des milliers de '
          + 'dossiers, d’encaissements et d’heures de travail déjà '
          + 'enregistrés. Une station fermée n’accueille plus de véhicule, '
          + 'mais son historique reste consultable et ses chiffres comptent '
          + 'toujours dans vos statistiques.',
        todo: 'Écran Stations, bouton de fermeture au bout de la ligne.',
      },
      {
        id: 'changer-devise',
        question: 'Je ne peux pas changer ma devise.',
        answer:
          'Tous vos montants sont enregistrés en francs entiers. Cocher une autre '
          + 'devise ne les convertirait pas : 5 000 F deviendrait 50,00 €, et '
          + 'votre chiffre d’affaires serait divisé par cent d’un seul clic. '
          + 'Changer de devise est une conversion de toutes vos données, pas un '
          + 'réglage.',
        todo:
          'Contactez-nous si vous en avez réellement besoin : cela se prépare, '
          + 'avec un taux et une date.',
      },
      {
        id: 'personne-sans-station',
        question: 'Je ne peux pas retirer toutes les stations de quelqu’un.',
        answer:
          'Sans rattachement, une personne n’a aucun rôle, donc aucun droit : '
          + 'elle pourrait se connecter sans rien pouvoir faire, ce qui ressemble '
          + 'à une panne bien plus qu’à un retrait d’accès.',
        todo:
          'Pour retirer l’accès à quelqu’un, désactivez son compte sur '
          + 'l’écran Équipe.',
      },
    ],
  },

  {
    id: 'limites',
    label: 'Ce que le logiciel ne fait pas',
    icon: 'info-circle',
    entries: [
      {
        id: 'aucun-sms',
        question: 'Le client reçoit-il un SMS de rappel ?',
        answer:
          'Non. AUCUN message n’est envoyé à vos clients — ni SMS, ni '
          + 'WhatsApp, ni e-mail. Nous préférons le dire clairement plutôt que '
          + 'de laisser croire le contraire : un rappel qu’on croit envoyé et '
          + 'qui ne part pas est pire que pas de rappel du tout.',
        todo:
          'La liste « à rappeler » du carnet vous donne qui appeler, et le '
          + 'numéro est à côté.',
      },
      {
        id: 'aucun-paiement-en-ligne',
        question: 'Puis-je encaisser par mobile money depuis le logiciel ?',
        answer:
          'Vous enregistrez le règlement, y compris son moyen — espèces, '
          + 'mobile money, carte, virement — mais la transaction elle-même se '
          + 'fait comme aujourd’hui, entre le client et vous. Aucun opérateur '
          + 'n’est branché, et nous n’en simulons aucun.',
        todo:
          'Encaissez comme d’habitude, puis notez le règlement avec son moyen '
          + 'de paiement.',
      },
      {
        id: 'rien-de-automatique',
        question: 'Pourquoi rien ne se ferme ni ne se classe tout seul ?',
        answer:
          'Un pointage oublié, un rendez-vous dépassé, un dossier qui traîne : '
          + 'le logiciel les SIGNALE et attend. Il ne sait pas ce qui s’est '
          + 'réellement passé, et ce qu’il inscrirait à votre place resterait '
          + 'dans l’historique d’un client ou dans les heures de quelqu’un.',
        todo:
          'Les blocs « à traiter », en haut des écrans, regroupent ce qui '
          + 'attend une décision de votre part.',
      },
    ],
  },
];

/** Toutes les entrées, à plat — pour la recherche. */
export const HELP_ENTRIES: readonly (HelpEntry & { section: string })[] = HELP.flatMap(
  (section) => section.entries.map((entry) => ({ ...entry, section: section.label })),
);
