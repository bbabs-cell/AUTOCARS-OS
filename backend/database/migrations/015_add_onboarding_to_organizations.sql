-- =================================================================
-- Suivi de l'installation guidée
-- =================================================================
-- Une seule colonne, pas une table : il n'y a qu'une information à
-- retenir — l'installation est-elle terminée, et quand.
--
-- Pourquoi une DATE plutôt qu'un booléen ? Parce qu'elle répond à
-- deux questions au lieu d'une. « Est-ce terminé ? » se lit avec
-- « IS NOT NULL », et « depuis quand ce client est-il opérationnel ? »
-- devient mesurable — ce sera utile pour comprendre où les nouveaux
-- inscrits abandonnent.
-- =================================================================

ALTER TABLE organizations
    ADD COLUMN onboarding_completed_at TIMESTAMP NULL DEFAULT NULL
    AFTER status;
