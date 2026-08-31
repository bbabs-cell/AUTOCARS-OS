<?php

declare(strict_types=1);

namespace Autocare\Core;

use RuntimeException;

/**
 * Lecture du fichier .env
 * ------------------------------------------------------------------
 * POURQUOI CE FICHIER ?
 * Les identifiants de la base de donnees et les cles de securite ne
 * doivent JAMAIS se trouver dans le code source (donc jamais dans Git).
 * On les place dans un fichier ".env" qui reste sur le serveur, et
 * cette classe se charge de le lire.
 *
 * On n'utilise volontairement aucune librairie externe : le format
 * d'un fichier .env est simple (CLE=valeur), une trentaine de lignes
 * suffisent et tu vois exactement ce qui se passe.
 */
final class Env
{
    /** @var array<string,string> Toutes les valeurs lues dans le .env */
    private static array $values = [];

    private static bool $loaded = false;

    /**
     * Charge le fichier .env en memoire. A appeler une seule fois,
     * au demarrage de l'application (voir public/index.php).
     */
    public static function load(string $filePath): void
    {
        if (!is_file($filePath)) {
            throw new RuntimeException(
                "Fichier de configuration introuvable : {$filePath}. "
                . "Copie backend/.env.example vers backend/.env et remplis-le."
            );
        }

        $lines = file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);

        foreach ($lines as $line) {
            $line = trim($line);

            // On ignore les lignes vides et les commentaires (# ...)
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            // On ignore les lignes mal formees (sans signe "=")
            if (!str_contains($line, '=')) {
                continue;
            }

            // On coupe sur le PREMIER "=" seulement : un mot de passe
            // peut lui-meme contenir des "=".
            [$name, $value] = explode('=', $line, 2);

            $name  = trim($name);
            $value = trim($value);

            // On retire les guillemets entourant la valeur, s'il y en a.
            $isQuoted = strlen($value) >= 2
                && ($value[0] === '"' || $value[0] === "'")
                && $value[strlen($value) - 1] === $value[0];

            if ($isQuoted) {
                $value = substr($value, 1, -1);
            }

            self::$values[$name] = $value;
        }

        self::$loaded = true;
    }

    /**
     * Recupere une valeur, ou la valeur par defaut si elle n'existe pas.
     */
    public static function get(string $name, ?string $default = null): ?string
    {
        return self::$values[$name] ?? $default;
    }

    /**
     * Recupere une valeur OBLIGATOIRE.
     * Si elle manque, l'application s'arrete immediatement avec un
     * message clair. C'est voulu : mieux vaut un echec net au demarrage
     * qu'un bug incomprehensible plus tard.
     */
    public static function mustGet(string $name): string
    {
        if (!self::$loaded) {
            throw new RuntimeException('Env::load() n\'a pas ete appele.');
        }

        $value = self::$values[$name] ?? '';

        if ($value === '') {
            throw new RuntimeException(
                "La variable {$name} est absente ou vide dans le fichier .env"
            );
        }

        return $value;
    }

    /**
     * Recupere une valeur booleenne (true/false, 1/0, yes/no).
     */
    public static function bool(string $name, bool $default = false): bool
    {
        $value = self::$values[$name] ?? null;

        if ($value === null) {
            return $default;
        }

        return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
    }
}
