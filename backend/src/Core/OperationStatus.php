<?php

declare(strict_types=1);

namespace Autocare\Core;

use InvalidArgumentException;

/**
 * Lecture et application de la machine à états
 * ------------------------------------------------------------------
 * Cette classe ne décide de rien : elle applique ce qui est déclaré
 * dans config/operation_status.php. La séparation est volontaire —
 * la règle métier se lit dans un fichier de configuration commenté,
 * pas au milieu du code qui l'exécute.
 *
 * DEUX NIVEAUX DE VÉRIFICATION, À NE PAS CONFONDRE :
 *
 *   canTransition()  — « ce passage existe-t-il sur le plan ? »
 *                      Répond avec la seule table des transitions.
 *
 *   guardFor()       — « ce passage a-t-il une condition en plus ? »
 *                      Rend le nom de la condition à vérifier
 *                      (inspection enregistrée, paiement encaissé).
 *                      Le contrôleur va alors interroger la base.
 *
 * Le premier niveau est pur et testable sans base de données ; le
 * second a besoin du contexte. Les séparer permet de tester toute la
 * mécanique du parcours sans monter une base de test.
 */
final class OperationStatus
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

    /**
     * Les statuts atteignables depuis celui-ci.
     *
     * Le frontend consomme cette liste pour n'afficher que les
     * boutons réellement utilisables. C'est un CONFORT D'AFFICHAGE :
     * la vérification qui compte reste celle du serveur, ci-dessous.
     *
     * @return list<string>
     */
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

    /** @return list<string> Les statuts qui occupent la file d'attente. */
    public static function active(): array
    {
        return self::config()['active'];
    }

    /**
     * La condition supplémentaire à vérifier pour ce passage, s'il
     * y en a une. Retourne null quand la transition ne dépend que de
     * l'enchaînement.
     */
    public static function guardFor(string $from, string $to): ?string
    {
        return self::config()['guards']["{$from}:{$to}"] ?? null;
    }

    /**
     * La colonne d'horodatage à renseigner en entrant dans ce statut.
     */
    public static function timestampColumn(string $status): ?string
    {
        return self::config()['timestamps'][$status] ?? null;
    }

    /**
     * Message expliquant pourquoi un passage est refusé.
     *
     * Rédigé pour l'employé au comptoir, pas pour le développeur :
     * « Le lavage doit d'abord passer au contrôle qualité » lui dit
     * quoi faire, « transition invalide » ne lui dit rien.
     */
    public static function refusalMessage(string $from, string $to): string
    {
        if (!self::exists($to)) {
            return "Ce statut n'existe pas.";
        }

        if (self::isFinal($from)) {
            return sprintf(
                'Cette opération est %s : son statut ne peut plus changer.',
                mb_strtolower(self::label($from))
            );
        }

        $possible = array_map(self::label(...), self::allowedFrom($from));

        return sprintf(
            'Une opération « %s » ne peut pas passer à « %s ». Étapes possibles : %s.',
            self::label($from),
            self::label($to),
            implode(', ', $possible)
        );
    }

    /** @return array<string,mixed> */
    private static function config(): array
    {
        if (self::$config === null) {
            $path = dirname(__DIR__, 2) . '/config/operation_status.php';

            if (!is_file($path)) {
                throw new InvalidArgumentException("Configuration des statuts introuvable : {$path}");
            }

            /** @var array<string,mixed> $loaded */
            $loaded = require $path;
            self::$config = $loaded;
        }

        return self::$config;
    }
}
