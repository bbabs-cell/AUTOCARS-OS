<?php

declare(strict_types=1);

namespace Autocare\Core;

use PDO;
use PDOException;
use RuntimeException;

/**
 * Connexion a la base de donnees MySQL
 * ------------------------------------------------------------------
 * POURQUOI CE FICHIER ?
 * Ouvrir une connexion MySQL coute du temps. On veut donc l'ouvrir
 * UNE SEULE FOIS par requete HTTP et la reutiliser partout : c'est ce
 * qu'on appelle un singleton.
 *
 * On utilise PDO plutot que mysqli pour deux raisons :
 *   1. PDO gere les requetes preparees de facon simple et lisible ;
 *   2. les requetes preparees rendent l'injection SQL impossible.
 *
 * REGLE ABSOLUE DU PROJET
 * -----------------------
 * On n'ecrit JAMAIS une valeur directement dans une requete SQL :
 *
 *   INTERDIT : "SELECT * FROM users WHERE email = '$email'"
 *   CORRECT  : "SELECT * FROM users WHERE email = :email"
 *              puis ->execute(['email' => $email])
 *
 * Dans le premier cas, un utilisateur qui saisit
 * "' OR 1=1 --" comme email recupere toute la table.
 * Dans le second, MySQL traite la valeur comme du texte, jamais
 * comme du code : l'attaque n'a aucun effet.
 */
final class Database
{
    private static ?PDO $connection = null;

    /**
     * Retourne la connexion PDO, en la creant au premier appel.
     */
    public static function connection(): PDO
    {
        if (self::$connection instanceof PDO) {
            return self::$connection;
        }

        $host     = Env::mustGet('DB_HOST');
        $port     = Env::get('DB_PORT', '3306');
        $database = Env::mustGet('DB_NAME');
        $username = Env::mustGet('DB_USER');
        $password = Env::get('DB_PASSWORD', '') ?? '';

        // utf8mb4 : indispensable pour stocker correctement les accents
        // francais ET les emojis (un client peut en mettre dans un nom).
        $dsn = "mysql:host={$host};port={$port};dbname={$database};charset=utf8mb4";

        try {
            self::$connection = new PDO($dsn, $username, $password, [
                // Une erreur SQL leve une exception au lieu d'etre ignoree
                // silencieusement. Indispensable pour ne pas laisser
                // passer un bug.
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,

                // Les resultats arrivent sous forme de tableau associatif
                // ['plate_number' => 'DK-1234-AA'] plutot qu'un tableau
                // a double indexation.
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,

                // false = de VRAIES requetes preparees, envoyees a MySQL
                // en deux temps (requete puis valeurs). C'est ce qui
                // garantit la protection contre l'injection SQL.
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        } catch (PDOException $exception) {
            // On ne renvoie JAMAIS le message brut de PDO au client :
            // il contient l'hote, l'utilisateur et parfois le mot de
            // passe de la base. On le journalise cote serveur.
            error_log('[AUTOCARE][DB] ' . $exception->getMessage());

            throw new RuntimeException('Connexion a la base de donnees impossible.');
        }

        return self::$connection;
    }

    /**
     * Verifie que la base repond. Utilise par /api/health et par
     * l'outil tools/check_db.php.
     */
    public static function isReachable(): bool
    {
        try {
            self::connection()->query('SELECT 1');

            return true;
        } catch (\Throwable) {
            return false;
        }
    }
}
