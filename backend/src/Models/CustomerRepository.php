<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\TenantRepository;

/**
 * Les clients de la station
 * ------------------------------------------------------------------
 * Le cloisonnement vient de TenantRepository. Ce dépôt n'ajoute que
 * ce qui lui est propre : la recherche au comptoir et les compteurs
 * affichés dans la liste.
 */
final class CustomerRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'customers';
    }

    protected function usesSoftDeletes(): bool
    {
        return true;
    }

    /**
     * Recherche au comptoir.
     *
     * C'EST LA REQUÊTE LA PLUS UTILISÉE DU PRODUIT.
     * Un client se présente, l'employé tape trois chiffres de son
     * numéro ou les premières lettres de son nom, et doit le
     * retrouver en une seconde — sinon il ressaisit tout et crée un
     * doublon, ce qui éparpille l'historique.
     *
     * On cherche sur le téléphone ET sur le nom : au Sénégal on
     * retient plus souvent un numéro qu'une orthographe exacte.
     *
     * @return list<array<string,mixed>>
     */
    public function search(string $term, int $limit = 50): array
    {
        $term = trim($term);

        if ($term === '') {
            return $this->withCounters('', [], $limit);
        }

        // Sur le téléphone, on compare les chiffres seuls : l'employé
        // tape « 771234567 » alors que la base contient
        // « +221 77 123 45 67 ». Sans ce nettoyage, aucune
        // correspondance.
        $digits = preg_replace('/\D/', '', $term) ?? '';

        // ATTENTION — PIÈGE DES REQUÊTES PRÉPARÉES NATIVES.
        //
        // La connexion utilise ATTR_EMULATE_PREPARES => false, donc de
        // VRAIES requêtes préparées MySQL. Dans ce mode, un même
        // paramètre nommé ne peut PAS être réutilisé deux fois : MySQL
        // répond « Invalid parameter number ».
        //
        // On donne donc un nom distinct à chaque occurrence, même
        // lorsqu'elles portent la même valeur. C'est plus verbeux,
        // mais c'est le prix de la protection réelle contre
        // l'injection SQL — et l'erreur est explicite si on l'oublie.
        $where = "AND (
                        c.last_name  LIKE :name_last
                     OR c.first_name LIKE :name_first
                     OR REPLACE(REPLACE(REPLACE(c.phone, ' ', ''), '-', ''), '+', '') LIKE :digits
                  )";

        return $this->withCounters($where, [
            'name_last'  => $term . '%',
            'name_first' => $term . '%',
            // Le numéro peut être tapé sans indicatif : on cherche
            // donc n'importe où dans le numéro, pas seulement au début.
            // La valeur impossible évite qu'un terme sans chiffre ne
            // remonte tous les clients via « %% ».
            'digits' => '%' . ($digits === '' ? 'AUCUN-CHIFFRE' : $digits) . '%',
        ], $limit);
    }

    /**
     * Un client avec ses compteurs : véhicules, visites, dernière visite.
     *
     * @return array<string,mixed>|null
     */
    public function findWithCounters(int $id): ?array
    {
        $rows = $this->withCounters('AND c.id = :id', ['id' => $id], 1);

        return $rows[0] ?? null;
    }

    /**
     * Les clients partageant ce numéro.
     *
     * Le téléphone n'est volontairement PAS unique en base — un couple
     * partage souvent un numéro, et bloquer l'enregistrement au
     * comptoir serait pire que le doublon. L'interface s'en sert pour
     * AVERTIR au moment de la saisie : « ce numéro correspond déjà à
     * Cheikh Fall », et proposer de réutiliser la fiche existante.
     *
     * @return list<array<string,mixed>>
     */
    public function findByPhone(string $phone): array
    {
        $digits = preg_replace('/\D/', '', $phone) ?? '';

        // En dessous de 8 chiffres, on ne cherche pas : le résultat
        // serait trop large pour signifier quoi que ce soit.
        if (mb_strlen($digits) < 8) {
            return [];
        }

        // COMPARAISON PAR LA FIN, ET NON EXACTE.
        //
        // La base contient « +221 77 611 22 33 », soit « 221776112233 »
        // une fois nettoyé. L'employé, lui, tape « 776112233 » sans
        // l'indicatif — c'est ainsi qu'on donne son numéro au Sénégal.
        // Une égalité stricte ne trouverait donc jamais rien, et
        // l'avertissement de doublon ne se déclencherait jamais.
        //
        // Le « % » en tête compare les derniers chiffres : le même
        // abonné est reconnu qu'il soit enregistré avec ou sans
        // indicatif.
        return $this->select(
            'id, first_name, last_name, phone',
            "AND REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE :digits
             AND deleted_at IS NULL
             LIMIT 5",
            ['digits' => '%' . $digits],
        );
    }

    /**
     * Requête commune de la liste et de la fiche.
     *
     * Elle joint véhicules et opérations pour afficher les compteurs.
     * Le filtre d'organisation est écrit EXPLICITEMENT ici parce que
     * la requête porte sur plusieurs tables — TenantRepository ne sait
     * cloisonner qu'une table à la fois. C'est une exception assumée,
     * visible, et couverte par les tests d'isolation.
     *
     * @param array<string,mixed> $parameters
     * @return list<array<string,mixed>>
     */
    private function withCounters(string $extraWhere, array $parameters, int $limit): array
    {
        $sql = "SELECT c.*,
                       (SELECT COUNT(*) FROM vehicles v
                         WHERE v.customer_id = c.id AND v.deleted_at IS NULL) AS vehicle_count,
                       (SELECT COUNT(*) FROM operations o
                         WHERE o.customer_id = c.id) AS visit_count,
                       (SELECT MAX(o.created_at) FROM operations o
                         WHERE o.customer_id = c.id) AS last_visit_at,
                       (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
                         WHERE p.customer_id = c.id AND p.status = 'PAID') AS total_spent
                  FROM customers c
                 WHERE c.organization_id = :organization_id
                   AND c.deleted_at IS NULL
                   {$extraWhere}
              ORDER BY c.last_name ASC, c.first_name ASC
                 LIMIT {$limit}";

        $statement = $this->db->prepare($sql);
        $statement->execute($parameters + ['organization_id' => $this->organizationId()]);

        return $statement->fetchAll();
    }
}
