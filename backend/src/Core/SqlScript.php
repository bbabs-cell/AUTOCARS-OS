<?php

declare(strict_types=1);

namespace Autocare\Core;

/**
 * Découpage d'un fichier SQL en instructions
 * ------------------------------------------------------------------
 * POURQUOI CE FICHIER ?
 * Un fichier de migration contient plusieurs instructions séparées
 * par des points-virgules. PDO ne sait exécuter qu'une instruction à
 * la fois de façon fiable : il faut donc découper.
 *
 * Le piège : on ne peut PAS simplement faire explode(';', $sql).
 * Un point-virgule peut se trouver à l'intérieur d'une chaîne de
 * caractères, et le découpage naïf casserait la requête :
 *
 *     INSERT INTO customers (notes) VALUES ('Appeler ; puis passer');
 *                                                       ^ ici
 *
 * Cette classe lit donc le fichier caractère par caractère en
 * sachant si elle se trouve à l'intérieur d'une chaîne ou d'un
 * commentaire. C'est un tout petit analyseur lexical, et c'est un
 * bon exemple de pourquoi « ça marche sur mes exemples » ne suffit
 * pas quand on manipule du SQL.
 */
final class SqlScript
{
    /**
     * Découpe un script SQL en instructions exécutables.
     * Les commentaires et les lignes vides sont retirés.
     *
     * @return list<string>
     */
    public static function split(string $sql): array
    {
        $statements = [];
        $current    = '';

        $length          = strlen($sql);
        $insideSingle    = false;  // à l'intérieur de '...'
        $insideDouble    = false;  // à l'intérieur de "..."
        $insideLineNote  = false;  // commentaire -- jusqu'à la fin de ligne
        $insideBlockNote = false;  // commentaire /* ... */

        for ($i = 0; $i < $length; $i++) {
            $char = $sql[$i];
            $next = $i + 1 < $length ? $sql[$i + 1] : '';

            // --- Fin des commentaires ---------------------------------
            if ($insideLineNote) {
                if ($char === "\n") {
                    $insideLineNote = false;
                    $current .= "\n";
                }
                continue;
            }

            if ($insideBlockNote) {
                if ($char === '*' && $next === '/') {
                    $insideBlockNote = false;
                    $i++;
                }
                continue;
            }

            // --- Début des commentaires (hors chaîne) ------------------
            if (!$insideSingle && !$insideDouble) {
                if ($char === '-' && $next === '-') {
                    $insideLineNote = true;
                    $i++;
                    continue;
                }

                if ($char === '/' && $next === '*') {
                    $insideBlockNote = true;
                    $i++;
                    continue;
                }
            }

            // --- Gestion des chaînes ----------------------------------
            if ($char === "'" && !$insideDouble) {
                // Une apostrophe échappée par un antislash ne ferme pas
                // la chaîne : 'l\'atelier'
                if (!self::isEscaped($current)) {
                    $insideSingle = !$insideSingle;
                }
            } elseif ($char === '"' && !$insideSingle) {
                if (!self::isEscaped($current)) {
                    $insideDouble = !$insideDouble;
                }
            }

            // --- Fin d'instruction ------------------------------------
            if ($char === ';' && !$insideSingle && !$insideDouble) {
                $statement = trim($current);

                if ($statement !== '') {
                    $statements[] = $statement;
                }

                $current = '';
                continue;
            }

            $current .= $char;
        }

        // Dernière instruction, si le fichier ne finit pas par « ; »
        $last = trim($current);

        if ($last !== '') {
            $statements[] = $last;
        }

        return $statements;
    }

    /**
     * Le caractère qui vient d'être lu est-il précédé d'un nombre
     * IMPAIR d'antislashs ? Si oui, il est échappé.
     * ("\\'" contient un antislash échappé, l'apostrophe compte.)
     */
    private static function isEscaped(string $before): bool
    {
        $backslashes = 0;
        $position    = strlen($before) - 1;

        while ($position >= 0 && $before[$position] === '\\') {
            $backslashes++;
            $position--;
        }

        return $backslashes % 2 === 1;
    }
}
