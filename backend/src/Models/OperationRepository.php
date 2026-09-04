<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\OperationStatus;
use Autocare\Core\TenantRepository;
use PDO;
use PDOException;
use RuntimeException;

/**
 * Les opérations : le passage d'un véhicule en station
 * ------------------------------------------------------------------
 * Une opération relie un véhicule, un client, une prestation et une
 * station à un moment donné. Tout le produit tourne autour d'elle.
 *
 * RAPPEL : il n'y a pas de table « file d'attente ». La file est
 * simplement la liste des opérations dont le statut est actif, triée
 * par priorité puis par heure d'arrivée. Une table séparée
 * dupliquerait l'état et divergerait tôt ou tard.
 */
final class OperationRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'operations';
    }

    /**
     * ==================================================================
     * CE QUE LE CLIENT DOIT VRAIMENT PAYER
     * ==================================================================
     * Jusqu'au lot 14, cette formule était simplement `price`, et
     * elle était recopiée à CINQ endroits : le contrôle avant
     * restitution, la restitution elle-même, la saisie d'un paiement,
     * la liste des paiements d'un dossier, et le total des impayés du
     * tableau de bord.
     *
     * Tant que la formule tenait en un mot, la duplication ne se
     * voyait pas. L'arrivée d'une remise de fidélité l'a rendue
     * dangereuse : un seul de ces cinq endroits oublié, et un client
     * se voit refuser sa voiture pour un solde qu'il ne doit pas — ou
     * repart sans avoir payé ce qu'il devait.
     *
     * Une règle d'argent s'écrit UNE FOIS.
     *
     * @param array<string,mixed> $operation Une ligne de `operations`
     */
    public static function amountDue(array $operation): int
    {
        $price    = (int) ($operation['price'] ?? 0);
        $discount = (int) ($operation['discount_amount'] ?? 0);

        // La remise ne peut pas rendre un dossier négatif : on ne doit
        // pas d'argent à un client parce qu'il est fidèle.
        return max(0, $price - $discount);
    }

    /**
     * Le total des remises accordées sur une période.
     *
     * C'EST LE COÛT RÉEL DU PROGRAMME DE FIDÉLITÉ, et la raison pour
     * laquelle une récompense est une remise et non un faux
     * encaissement : ce chiffre-là n'existerait pas autrement.
     *
     * Il porte sur ce qui a été RÉELLEMENT déduit, pas sur la valeur
     * annoncée des récompenses : une récompense de 5 000 F appliquée
     * à un dossier de 3 000 F ne coûte que 3 000 F.
     */
    public function discountTotal(string $from, string $to, ?int $stationId = null): int
    {
        $extra = '';
        $parameters = [
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to'   => $to . ' 23:59:59',
        ];

        if ($stationId !== null) {
            $extra = ' AND station_id = :station_id';
            $parameters['station_id'] = $stationId;
        }

        $statement = $this->db->prepare(
            "SELECT COALESCE(SUM(discount_amount), 0)
               FROM operations
              WHERE organization_id = :organization_id
                AND discount_amount > 0
                AND discounted_at >= :from
                AND discounted_at <= :to
                    {$extra}"
        );

        $statement->execute($parameters);

        return (int) $statement->fetchColumn();
    }

    /**
     * Génère la référence remise au client : « DKP-2609-0042 ».
     *
     * TROIS PARTIES, CHACUNE UTILE :
     *   DKP   code de la station — on sait d'où vient le véhicule
     *   2609  année et mois     — on situe le dossier sans requête
     *   0042  numéro du mois    — court, dictable au téléphone
     *
     * Le compteur repart à 1 chaque mois. Une station qui traite
     * 40 véhicules par jour reste très loin des 9999 possibles ; si
     * un jour elle les dépasse, le format passera à cinq chiffres
     * sans casser l'existant, la colonne étant en VARCHAR(30).
     *
     * POURQUOI PAS SIMPLEMENT L'ID DE LA BASE ?
     * Parce qu'il révèle le volume d'activité : un concurrent qui
     * dépose une voiture le lundi et une autre le vendredi lit
     * exactement combien de dossiers ont été créés entre les deux.
     * Le compteur mensuel par station ne fuite rien d'utile.
     *
     * SUR LA CONCURRENCE : deux comptoirs qui enregistrent un
     * véhicule à la même seconde peuvent calculer le même numéro.
     * La contrainte d'unicité en base rejette alors le second, et
     * l'appelant réessaie (voir createWithReference). On n'utilise
     * pas de table de compteurs verrouillée : elle sérialiserait
     * toutes les créations pour un incident qui se produit quelques
     * fois par an.
     */
    public function nextReference(string $stationCode, ?string $month = null): string
    {
        $month  = $month ?? date('ym');
        $prefix = strtoupper($stationCode) . '-' . $month . '-';

        $statement = $this->db->prepare(
            'SELECT reference FROM operations
              WHERE organization_id = :organization_id
                AND reference LIKE :prefix
           ORDER BY reference DESC
              LIMIT 1'
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'prefix'          => $prefix . '%',
        ]);

        $last = $statement->fetchColumn();

        // Le tri alphabétique donne bien le plus grand numéro parce
        // que le suffixe est rempli de zéros à gauche : « 0009 »
        // précède « 0010 ». Sans ce remplissage, « 9 » passerait
        // après « 10 » et le compteur reculerait.
        $number = $last === false ? 0 : (int) substr((string) $last, -4);

        return $prefix . str_pad((string) ($number + 1), 4, '0', STR_PAD_LEFT);
    }

    /**
     * Crée l'opération en lui attribuant une référence libre.
     *
     * Si deux postes créent un dossier dans la même seconde, l'un des
     * deux se voit refuser par la contrainte d'unicité : on relit le
     * compteur et on réessaie. Trois tentatives suffisent largement —
     * au-delà, ce n'est plus une collision mais un vrai problème, et
     * mieux vaut une erreur visible qu'une boucle infinie.
     *
     * @param array<string,mixed> $data
     * @return array{id:int, reference:string}
     */
    public function createWithReference(string $stationCode, array $data): array
    {
        for ($attempt = 1; $attempt <= 3; $attempt++) {
            $reference = $this->nextReference($stationCode);

            try {
                // status_changed_at dès l'ouverture : un dossier créé
                // est déjà « en attente depuis maintenant ». Le laisser
                // à NULL obligerait chaque lecture à retomber sur
                // created_at, donc à écrire la règle deux fois.
                $id = $this->create($data + [
                    'reference'         => $reference,
                    'status_changed_at' => date('Y-m-d H:i:s'),
                ]);

                return ['id' => $id, 'reference' => $reference];
            } catch (PDOException $exception) {
                // 23000 = violation de contrainte d'intégrité. On ne
                // réessaie QUE dans ce cas : une erreur de colonne ou
                // de connexion doit remonter telle quelle.
                if ($exception->getCode() !== '23000' || $attempt === 3) {
                    throw $exception;
                }
            }
        }

        throw new RuntimeException("Impossible d'attribuer une référence à cette opération.");
    }

    /**
     * La liste de travail : opérations avec véhicule, client,
     * prestation et employé.
     *
     * @param array{status?:string, station_id?:int, vehicle_id?:int,
     *              customer_id?:int, active?:bool, search?:string} $filters
     * @param string $orderBy Clause de tri. Elle vient TOUJOURS du code,
     *        jamais de la requête HTTP : c'est du SQL inséré tel quel.
     *        Le jour où un écran voudra laisser l'utilisateur choisir
     *        son tri, il faudra passer par une liste blanche.
     * @return list<array<string,mixed>>
     */
    public function listDetailed(
        array $filters = [],
        int $limit = 100,
        string $orderBy = 'o.priority DESC, o.created_at ASC',
    ): array {
        $conditions = [];
        $parameters = [];

        if (isset($filters['status']) && OperationStatus::exists($filters['status'])) {
            $conditions[] = 'o.status = :status';
            $parameters['status'] = $filters['status'];
        }

        // « Ce qui est en cours » : les statuts actifs, ceux qui
        // occupent réellement la station. C'est la vue par défaut du
        // comptoir — un dossier restitué la semaine dernière n'a rien
        // à y faire.
        if (($filters['active'] ?? false) === true) {
            $active = OperationStatus::active();

            // Les valeurs viennent de notre configuration, jamais du
            // client : les injecter directement est sûr ici. On les
            // encadre malgré tout de guillemets simples échappés.
            $quoted = implode(', ', array_map(
                fn (string $status): string => $this->db->quote($status),
                $active
            ));

            $conditions[] = "o.status IN ({$quoted})";
        }

        foreach (['station_id', 'vehicle_id', 'customer_id', 'assigned_user_id'] as $column) {
            if (isset($filters[$column]) && $filters[$column] !== null) {
                $conditions[] = "o.{$column} = :{$column}";
                $parameters[$column] = (int) $filters[$column];
            }
        }

        $search = trim((string) ($filters['search'] ?? ''));

        if ($search !== '') {
            // Un paramètre nommé par occurrence : les requêtes
            // préparées natives de MySQL refusent la réutilisation
            // d'un même nom.
            $conditions[] = '(o.reference LIKE :ref OR v.plate_number LIKE :plate
                              OR c.last_name LIKE :last_name OR c.first_name LIKE :first_name)';
            $parameters['ref']        = $search . '%';
            $parameters['plate']      = str_replace([' ', '-'], '', strtoupper($search)) . '%';
            $parameters['last_name']  = $search . '%';
            $parameters['first_name'] = $search . '%';
        }

        $extra = $conditions === [] ? '' : ' AND ' . implode(' AND ', $conditions);
        $limit = max(1, min($limit, 500));

        $statement = $this->db->prepare(
            "SELECT o.*,
                    v.plate_number, v.brand, v.model, v.color, v.vehicle_type,
                    c.first_name AS customer_first_name,
                    c.last_name  AS customer_last_name,
                    c.phone      AS customer_phone,
                    s.name       AS service_name,
                    s.duration_minutes,
                    st.name      AS station_name,
                    st.code      AS station_code,
                    CONCAT(u.first_name, ' ', u.last_name) AS assigned_name,
                    (SELECT COUNT(*) FROM inspections i
                      WHERE i.operation_id = o.id AND i.type = 'ENTRY') AS has_entry_inspection,
                    (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
                      WHERE p.operation_id = o.id AND p.status = 'PAID') AS paid_amount
               FROM operations o
               JOIN vehicles  v  ON v.id  = o.vehicle_id
               JOIN customers c  ON c.id  = o.customer_id
               JOIN services  s  ON s.id  = o.service_id
               JOIN stations  st ON st.id = o.station_id
          LEFT JOIN users     u  ON u.id  = o.assigned_user_id
              WHERE o.organization_id = :organization_id
                    {$extra}
           ORDER BY {$orderBy}
              LIMIT {$limit}"
        );

        $statement->execute($parameters + ['organization_id' => $this->organizationId()]);

        return $statement->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public function findDetailed(int $id): ?array
    {
        // Requête ciblée plutôt qu'un filtrage en PHP de listDetailed :
        // sur une station chargée, cette liste compte des centaines de
        // lignes qu'il serait absurde de rapatrier pour n'en garder qu'une.
        $statement = $this->db->prepare(
            "SELECT o.*,
                    v.plate_number, v.brand, v.model, v.color, v.vehicle_type,
                    c.first_name AS customer_first_name,
                    c.last_name  AS customer_last_name,
                    c.phone      AS customer_phone,
                    s.name       AS service_name,
                    s.duration_minutes,
                    st.name      AS station_name,
                    st.code      AS station_code,
                    CONCAT(u.first_name, ' ', u.last_name) AS assigned_name,
                    (SELECT COUNT(*) FROM inspections i
                      WHERE i.operation_id = o.id AND i.type = 'ENTRY') AS has_entry_inspection,
                    (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
                      WHERE p.operation_id = o.id AND p.status = 'PAID') AS paid_amount
               FROM operations o
               JOIN vehicles  v  ON v.id  = o.vehicle_id
               JOIN customers c  ON c.id  = o.customer_id
               JOIN services  s  ON s.id  = o.service_id
               JOIN stations  st ON st.id = o.station_id
          LEFT JOIN users     u  ON u.id  = o.assigned_user_id
              WHERE o.id = :id
                AND o.organization_id = :organization_id
              LIMIT 1"
        );

        $statement->execute([
            'id'              => $id,
            'organization_id' => $this->organizationId(),
        ]);

        $row = $statement->fetch();

        return $row === false ? null : $row;
    }

    /**
     * Une référence de dossier, telle que présentée au comptoir.
     *
     * La recherche est insensible à la casse et tolère les espaces :
     * un client qui lit son reçu à voix haute et un employé qui tape
     * vite ne produisent pas la même chaîne.
     *
     * @return array<string,mixed>|null
     */
    public function findByReference(string $reference): ?array
    {
        $normalized = strtoupper(preg_replace('/\s+/', '', $reference) ?? '');

        $rows = $this->select('id', 'AND reference = :reference LIMIT 1', [
            'reference' => $normalized,
        ]);

        if ($rows === []) {
            return null;
        }

        return $this->findDetailed((int) $rows[0]['id']);
    }

    /**
     * Le véhicule a-t-il déjà un dossier en cours ?
     *
     * Enregistrer deux fois le même véhicule crée deux files, deux
     * inspections et un litige assuré sur « laquelle des deux est la
     * bonne ». On le détecte à la création.
     *
     * @return array<string,mixed>|null Le dossier ouvert, s'il existe
     */
    public function openOperationFor(int $vehicleId): ?array
    {
        $quoted = implode(', ', array_map(
            fn (string $status): string => $this->db->quote($status),
            OperationStatus::active()
        ));

        $rows = $this->select(
            'id, reference, status',
            "AND vehicle_id = :vehicle_id AND status IN ({$quoted}) LIMIT 1",
            ['vehicle_id' => $vehicleId]
        );

        return $rows[0] ?? null;
    }

    /**
     * Applique un changement de statut et son jalon horodaté.
     *
     * La vérification de la transition N'EST PAS ici : elle appartient
     * au contrôleur, qui seul connaît le contexte (inspection
     * existante, paiement encaissé, dérogation d'un responsable). Ce
     * dépôt écrit ; il ne décide pas.
     *
     * @param array<string,mixed> $extra Colonnes supplémentaires
     */
    public function applyStatus(int $id, string $status, array $extra = []): bool
    {
        $data = ['status' => $status] + $extra;

        // Depuis quand le dossier est-il à cette étape ? C'est ce qui
        // permet à la file d'attente de dire « en lavage depuis 1 h 40 »
        // plutôt que « en lavage ». Sans cette date, le tableau
        // affiche un état sans jamais signaler un oubli.
        $data['status_changed_at'] = date('Y-m-d H:i:s');

        $column = OperationStatus::timestampColumn($status);

        if ($column !== null) {
            // On n'écrase pas un jalon déjà posé : un aller-retour
            // QUALITY_CHECK → WASHING → QUALITY_CHECK ne doit pas
            // faire croire que la prestation a démarré deux fois.
            $existing = $this->find($id);

            if (($existing[$column] ?? null) === null) {
                $data[$column] = date('Y-m-d H:i:s');
            }
        }

        return $this->update($id, $data);
    }

    /**
     * Somme réglée sur cette opération, en francs CFA.
     * Les paiements arrivent au lot 9 ; la requête existe dès
     * maintenant parce que la restitution en dépend.
     */
    public function paidAmount(int $operationId): int
    {
        $statement = $this->db->prepare(
            'SELECT COALESCE(SUM(p.amount), 0)
               FROM payments p
              WHERE p.operation_id = :operation_id
                AND p.organization_id = :organization_id
                AND p.status = :status'
        );

        $statement->execute([
            'operation_id'    => $operationId,
            'organization_id' => $this->organizationId(),
            'status'          => 'PAID',
        ]);

        return (int) $statement->fetchColumn();
    }

    /**
     * La file d'attente : tout ce qui occupe réellement la station.
     *
     * L'ORDRE EST LA MOITIÉ DU TRAVAIL. Priorité décroissante d'abord
     * — un client pressé passe devant — puis ancienneté dans l'étape
     * courante. Trier par date d'arrivée serait plus intuitif mais
     * faux : un véhicule renvoyé au lavage après un contrôle raté
     * remonterait tout en haut de la colonne alors qu'il vient d'y
     * entrer, et masquerait celui qui attend vraiment.
     *
     * @return list<array<string,mixed>>
     */
    public function queue(?int $stationId = null): array
    {
        $filters = ['active' => true];

        if ($stationId !== null) {
            $filters['station_id'] = $stationId;
        }

        return $this->listDetailed($filters, 500, 'o.priority DESC, o.status_changed_at ASC');
    }

    /**
     * Compte les opérations par statut, pour une station donnée.
     * Alimente les compteurs du comptoir et, au lot 10, le tableau
     * de bord.
     *
     * @return array<string,int>
     */
    public function countByStatus(?int $stationId = null): array
    {
        $sql = 'SELECT status, COUNT(*) AS total
                  FROM operations
                 WHERE organization_id = :organization_id';

        $parameters = ['organization_id' => $this->organizationId()];

        if ($stationId !== null) {
            $sql .= ' AND station_id = :station_id';
            $parameters['station_id'] = $stationId;
        }

        $sql .= ' GROUP BY status';

        $statement = $this->db->prepare($sql);
        $statement->execute($parameters);

        // Toutes les clés sont présentes, même à zéro : sans cela le
        // frontend devrait tester l'existence de chaque colonne avant
        // de l'afficher.
        $counts = array_fill_keys(OperationStatus::all(), 0);

        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $counts[(string) $row['status']] = (int) $row['total'];
        }

        return $counts;
    }
}
