<?php

declare(strict_types=1);

namespace Autocare\Core;

use InvalidArgumentException;

/**
 * Lecture et application du parcours d'un rendez-vous
 * ------------------------------------------------------------------
 * Même rôle que `OperationStatus` pour les opérations : cette classe
 * ne décide de rien, elle applique ce qui est déclaré dans
 * config/booking_status.php.
 *
 * POURQUOI DEUX CLASSES PLUTÔT QU'UNE, GÉNÉRIQUE ?
 *
 * La tentation était réelle : les deux lisent une table de
 * transitions, et une classe `StateMachine` paramétrée par un nom de
 * fichier aurait « évité une duplication ».
 *
 * Elle n'aurait rien évité du tout. Les deux parcours ne partagent
 * que la forme, pas les besoins : celui des opérations a des jalons
 * horodatés, des colonnes de tableau et des seuils d'alerte ; celui
 * des rendez-vous a un délai de grâce et une borne à un an. La classe
 * commune aurait porté l'union des deux, chaque méthode ne servant
 * qu'à un seul appelant — c'est-à-dire plus de code, pas moins, et
 * un endroit de plus à comprendre avant de modifier une règle.
 *
 * Deux fichiers courts qui se ressemblent valent mieux qu'une
 * abstraction qui les fait tous les deux à moitié.
 */
final class BookingStatus
{
    /** @var array<string,mixed>|null Chargé une fois par requête. */
    private static ?array $config = null;

    /** @return list<string> */
    public static function all(): array
    {
        return array_keys(self::config()['transitions']);
    }

    public static function exists(string $status): bool
    {
        return isset(self::config()['transitions'][$status]);
    }

    public static function label(string $status): string
    {
        return self::config()['labels'][$status] ?? $status;
    }

    /** @return list<string> */
    public static function allowedFrom(string $status): array
    {
        return self::config()['transitions'][$status] ?? [];
    }

    public static function canTransition(string $from, string $to): bool
    {
        return in_array($to, self::allowedFrom($from), true);
    }

    public static function isFinal(string $status): bool
    {
        return self::allowedFrom($status) === [];
    }

    /** @return list<string> Les rendez-vous qui restent à traiter. */
    public static function open(): array
    {
        return self::config()['open'];
    }

    /**
     * Ce statut a-t-il un effet de bord qui interdit la route
     * générique de changement de statut ?
     *
     * ARRIVED ouvre un dossier : le poser sans créer l'opération
     * laisserait un véhicule officiellement pris en charge que
     * personne ne verrait dans la file.
     */
    public static function isRouteOnly(string $status): bool
    {
        return in_array($status, self::config()['set_by_route_only'] ?? [], true);
    }

    /**
     * Le délai après l'heure du rendez-vous avant de pouvoir déclarer
     * une absence.
     */
    public static function noShowGraceMinutes(): int
    {
        return (int) (self::config()['no_show_grace_minutes'] ?? 15);
    }

    public static function maxDaysAhead(): int
    {
        return (int) (self::config()['max_days_ahead'] ?? 365);
    }

    /**
     * Les statuts que le frontend peut proposer depuis celui-ci.
     *
     * On en retire les statuts à effet de bord : ils ont leur propre
     * bouton, avec leur propre écran. C'est un CONFORT D'AFFICHAGE —
     * le serveur revérifie de toute façon.
     *
     * @return list<string>
     */
    public static function directlySettableFrom(string $status): array
    {
        return array_values(array_filter(
            self::allowedFrom($status),
            static fn (string $next): bool => !self::isRouteOnly($next),
        ));
    }

    /**
     * Message expliquant pourquoi un passage est refusé.
     * Rédigé pour l'employé au comptoir, pas pour le développeur.
     */
    public static function refusalMessage(string $from, string $to): string
    {
        if (!self::exists($to)) {
            return "Ce statut n'existe pas.";
        }

        if (self::isFinal($from)) {
            return sprintf(
                'Ce rendez-vous est déjà « %s » : son statut ne change plus. '
                . 'Si le client reprend un créneau, notez un nouveau rendez-vous.',
                self::label($from)
            );
        }

        if (self::isRouteOnly($to)) {
            return 'L\'arrivée d\'un client ouvre un dossier : utilisez « Le client est là ».';
        }

        $possible = array_map(self::label(...), self::allowedFrom($from));

        return sprintf(
            'Un rendez-vous « %s » ne peut pas passer à « %s ». Suites possibles : %s.',
            self::label($from),
            self::label($to),
            implode(', ', $possible)
        );
    }

    /** @return array<string,mixed> */
    private static function config(): array
    {
        if (self::$config === null) {
            $path = dirname(__DIR__, 2) . '/config/booking_status.php';

            if (!is_file($path)) {
                throw new InvalidArgumentException("Configuration des rendez-vous introuvable : {$path}");
            }

            /** @var array<string,mixed> $loaded */
            $loaded = require $path;
            self::$config = $loaded;
        }

        return self::$config;
    }
}
