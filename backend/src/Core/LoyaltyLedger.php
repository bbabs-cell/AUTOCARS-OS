<?php

declare(strict_types=1);

namespace Autocare\Core;

use Autocare\Core\Security\AuthContext;
use Autocare\Models\LoyaltyEntryRepository;
use Autocare\Models\LoyaltyProgramRepository;
use Autocare\Models\OperationRepository;
use PDOException;

/**
 * Les écritures du grand livre de fidélité
 * ==================================================================
 * POURQUOI UNE CLASSE, ALORS QUE TOUT LE RESTE DU PROJET FAIT LE
 * TRAVAIL DANS LES CONTRÔLEURS ?
 * ==================================================================
 *
 * Parce qu'une seule de ces règles est déclenchée depuis DEUX
 * modules différents : « un lavage payé donne un tampon » se produit
 * au moment où l'on enregistre un encaissement — donc dans
 * `PaymentController` — alors que la règle appartient à la fidélité.
 *
 * Les deux autres solutions étaient pires :
 *   · recopier la règle dans le contrôleur des paiements, c'est
 *     garantir qu'un jour les deux copies diffèrent ;
 *   · appeler `LoyaltyController` depuis `PaymentController`, c'est
 *     faire dépendre un contrôleur d'un autre, et rendre les deux
 *     impossibles à lire séparément.
 *
 * Cette classe n'est donc PAS une « couche service » qu'on
 * généraliserait au reste du produit. C'est une exception, née d'un
 * besoin précis, et elle le restera tant qu'un second besoin ne
 * l'aura pas justifiée.
 *
 * ------------------------------------------------------------------
 * ELLE N'ÉCRIT JAMAIS DE RÉPONSE HTTP
 *
 * Elle renvoie ce qui s'est passé, et le contrôleur décide quoi en
 * dire. C'est ce qui permet à l'attribution d'un tampon d'échouer en
 * silence pendant un encaissement : un problème de fidélité ne doit
 * jamais empêcher d'encaisser de l'argent.
 */
final class LoyaltyLedger
{
    /**
     * ==================================================================
     * UN LAVAGE PAYÉ DONNE UN TAMPON
     * ==================================================================
     * Appelée après chaque encaissement. Elle ne fait rien — et c'est
     * le cas le plus fréquent — si :
     *
     *   · l'entreprise n'a pas de programme actif ;
     *   · le dossier n'est pas encore entièrement réglé ;
     *   · le montant est sous le plancher du programme ;
     *   · un tampon a déjà été donné pour ce dossier.
     *
     * POURQUOI AU PAIEMENT, ET NON À LA RESTITUTION ?
     * Parce qu'un lavage qui n'est pas payé n'est pas un lavage. Un
     * véhicule rendu par dérogation à un client qui n'a rien réglé ne
     * doit pas faire avancer sa carte de fidélité — sinon la
     * dérogation devient une façon de gagner des tampons.
     *
     * @param array<string,mixed> $operation Le dossier, avec `paid_amount`
     * @return array{awarded:bool, reason:string, balance:int|null}
     */
    public static function awardIfSettled(array $operation): array
    {
        $programs = new LoyaltyProgramRepository();
        $program  = $programs->active();

        if ($program === null) {
            return self::outcome(false, 'no_program');
        }

        $customerId = (int) ($operation['customer_id'] ?? 0);

        if ($customerId === 0) {
            return self::outcome(false, 'no_customer');
        }

        $due  = OperationRepository::amountDue($operation);
        $paid = (int) ($operation['paid_amount'] ?? 0);

        if ($paid < $due) {
            return self::outcome(false, 'not_settled');
        }

        // ==============================================================
        // UN LAVAGE ENTIÈREMENT OFFERT NE RAPPORTE PAS DE TAMPON
        // ==============================================================
        // Ajouté au lot 15, quand les abonnements ont obligé à
        // regarder ce cas de près.
        //
        // Un dossier dont le dû est tombé à zéro grâce à une
        // RÉCOMPENSE, et pour lequel le client n'a rien sorti de sa
        // poche, ne doit pas faire avancer sa carte : le programme se
        // nourrirait lui-même, et dix lavages offerts en produiraient
        // un onzième.
        //
        // Un lavage couvert par un ABONNEMENT, lui, rapporte un
        // tampon : il a bien été payé — d'avance, mais payé. Le
        // contraire punirait le client le plus fidèle de la station.
        if ($paid === 0 && ($operation['discount_source'] ?? null) === 'LOYALTY') {
            return self::outcome(false, 'fully_rewarded');
        }

        // Le plancher se mesure sur le PRIX de la prestation, pas sur
        // ce qui a été encaissé. Sinon un lavage payé pour moitié avec
        // une récompense passerait sous le plancher et ne donnerait
        // pas de tampon — le client serait puni d'être fidèle.
        $price = (int) ($operation['price'] ?? 0);

        if ($price < (int) $program['min_operation_amount']) {
            return self::outcome(false, 'below_minimum');
        }

        $entries = new LoyaltyEntryRepository();
        $operationId = (int) $operation['id'];

        if ($entries->hasEarnFor($operationId)) {
            return self::outcome(false, 'already_awarded');
        }

        try {
            $entries->create([
                'program_id'  => (int) $program['id'],
                'customer_id' => $customerId,
                'type'        => 'EARN',
                'points'      => 1,
                'operation_id' => $operationId,
                // Ce que valait la récompense CE JOUR-LÀ : les règles
                // peuvent changer, l'historique ne doit pas bouger.
                'reward_amount' => (int) $program['reward_amount'],
                'note' => 'Dossier ' . ($operation['reference'] ?? $operationId),
                'created_by_user_id' => AuthContext::current()->userId,
            ]);
        } catch (PDOException $exception) {
            // 23000 = violation de contrainte d'unicité : deux
            // encaissements partis à la même seconde ont soldé le
            // dossier en même temps, et la base a refusé le second
            // tampon. C'est exactement ce qu'on lui demande de faire ;
            // ce n'est pas une erreur à remonter.
            if ($exception->getCode() !== '23000') {
                throw $exception;
            }

            return self::outcome(false, 'already_awarded');
        }

        return [
            'awarded' => true,
            'reason'  => 'awarded',
            'balance' => $entries->balanceFor($customerId),
        ];
    }

    /**
     * L'état de la carte d'un client : ce qu'on affiche au comptoir.
     *
     * @param array<string,mixed>|null $program
     * @return array{
     *     has_program:bool, balance:int, stamps_required:int,
     *     reward_amount:int, rewards_available:int, stamps_to_next:int
     * }
     */
    public static function card(int $customerId, ?array $program = null): array
    {
        $program ??= (new LoyaltyProgramRepository())->active();

        if ($program === null) {
            return [
                'has_program' => false,
                'balance' => 0,
                'stamps_required' => 0,
                'reward_amount' => 0,
                'rewards_available' => 0,
                'stamps_to_next' => 0,
            ];
        }

        $required = max(1, (int) $program['stamps_required']);
        $balance  = (new LoyaltyEntryRepository())->balanceFor($customerId);

        // Un solde négatif ne devrait pas exister — mais si une
        // écriture manque un jour, mieux vaut afficher 0 qu'un nombre
        // négatif que personne ne saura expliquer au client.
        $balance = max(0, $balance);

        $available = intdiv($balance, $required);

        return [
            'has_program' => true,
            'balance' => $balance,
            'stamps_required' => $required,
            'reward_amount' => (int) $program['reward_amount'],
            'rewards_available' => $available,
            // Ce que le client veut savoir : « il m'en reste combien ? »
            'stamps_to_next' => $available > 0 ? 0 : $required - ($balance % $required),
        ];
    }

    /**
     * @return array{awarded:bool, reason:string, balance:int|null}
     */
    private static function outcome(bool $awarded, string $reason): array
    {
        return ['awarded' => $awarded, 'reason' => $reason, 'balance' => null];
    }
}
