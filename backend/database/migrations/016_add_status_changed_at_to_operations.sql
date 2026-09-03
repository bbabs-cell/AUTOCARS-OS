-- =================================================================
-- operations.status_changed_at — depuis quand ce véhicule attend
-- =================================================================
-- LA COLONNE QUI REND LA FILE D'ATTENTE UTILE.
--
-- Un tableau de bord qui affiche « 6 véhicules en lavage » ne dit
-- rien d'actionnable. Ce qu'un gérant doit voir, c'est : « cette
-- voiture est en lavage depuis 1 h 40 alors que la prestation en
-- prend 30 ». C'est cette information qui déclenche une action.
--
-- POURQUOI UNE COLONNE PLUTÔT QUE LE JOURNAL D'AUDIT ?
-- L'information existe déjà : chaque changement de statut est tracé
-- dans audit_logs. On pourrait donc la recalculer avec une
-- sous-requête par ligne. Mais la file d'attente est rechargée en
-- permanence, sur tous les postes de la station : c'est LA requête
-- la plus fréquente du produit. Une sous-requête corrélée par carte,
-- toutes les trente secondes, sur chaque poste, finirait par se
-- sentir.
--
-- C'est la même logique que started_at et completed_at, déjà
-- présents : une dénormalisation assumée, au service d'une lecture
-- qu'on fait mille fois plus souvent qu'on ne l'écrit.
--
-- POURQUOI PAS updated_at, QUI EXISTE DÉJÀ ?
-- Parce qu'il change à CHAQUE modification : assigner un employé ou
-- monter la priorité remettrait le compteur à zéro. Un véhicule
-- oublié depuis deux heures paraîtrait arrivé à l'instant — soit
-- exactement le contraire de ce qu'on cherche à voir.
-- =================================================================

ALTER TABLE operations
    ADD COLUMN status_changed_at TIMESTAMP NULL DEFAULT NULL AFTER status;

-- Les dossiers existants n'ont jamais eu cette date. On la remplit
-- avec la meilleure approximation disponible, du jalon le plus
-- proche du statut actuel vers le plus ancien.
--
-- Sans ce remplissage, toutes les cartes déjà en base afficheraient
-- « depuis 0 minute » — une donnée fausse est pire qu'une donnée
-- absente, parce qu'on la croit.
UPDATE operations
   SET status_changed_at = COALESCE(released_at, completed_at, started_at, created_at)
 WHERE status_changed_at IS NULL;

-- La file d'attente trie par priorité puis par ancienneté dans
-- l'étape. L'index de file existant couvre déjà le filtrage
-- (organisation, station, statut) ; on ne l'élargit pas :
-- une station affiche quelques dizaines de dossiers actifs, le tri
-- de ce volume en mémoire coûte moins cher qu'un index de plus à
-- maintenir à chaque écriture.
