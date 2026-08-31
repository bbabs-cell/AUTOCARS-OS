<?php

declare(strict_types=1);

namespace Autocare\Core;

/**
 * Construit les reponses JSON de l'API
 * ------------------------------------------------------------------
 * POURQUOI CE FICHIER ?
 * Une API doit repondre TOUJOURS de la meme facon. Si un endpoint
 * renvoie {"ok": 1} et un autre {"status": "success"}, le frontend
 * Angular doit gerer chaque cas separement : c'est ingerable.
 *
 * On fixe donc ici un format unique, celui defini dans docs/api.md :
 *
 *   Succes : { "success": true,  "data": {...}, "message": "..." }
 *   Erreur : { "success": false, "message": "...", "errors": {...} }
 *
 * Toute reponse de l'API passe obligatoirement par cette classe.
 */
final class Response
{
    /**
     * Reponse de succes.
     *
     * @param mixed  $data    Les donnees utiles (objet, tableau, ou null)
     * @param string $message Message optionnel destine a l'utilisateur
     * @param int    $status  Code HTTP : 200 = OK, 201 = cree
     */
    public static function success(mixed $data = null, string $message = '', int $status = 200): never
    {
        self::send([
            'success' => true,
            'data'    => $data,
            'message' => $message,
        ], $status);
    }

    /**
     * Reponse d'erreur.
     *
     * @param string               $message Explication lisible par un humain
     * @param array<string,string> $errors  Detail par champ, ex:
     *                                      ['email' => 'Adresse invalide']
     * @param int                  $status  Code HTTP (voir ci-dessous)
     */
    public static function error(string $message, array $errors = [], int $status = 400): never
    {
        self::send([
            'success' => false,
            'message' => $message,
            'errors'  => (object) $errors, // (object) => "{}" et non "[]" en JSON
        ], $status);
    }

    // --- Raccourcis pour les erreurs les plus frequentes -----------
    //
    // Rappel des codes HTTP utilises dans AUTOCARE OS :
    //   400 Bad Request  : la requete est mal formee ou invalide
    //   401 Unauthorized : l'utilisateur n'est pas connecte
    //   403 Forbidden    : il est connecte mais n'a pas le droit
    //   404 Not Found    : la ressource n'existe pas
    //   422 Unprocessable: la validation des champs a echoue
    //   500 Server Error : bug cote serveur

    /** @param array<string,string> $errors */
    public static function validationFailed(array $errors): never
    {
        self::error('Les donnees envoyees sont invalides.', $errors, 422);
    }

    public static function unauthorized(string $message = 'Authentification requise.'): never
    {
        self::error($message, [], 401);
    }

    public static function forbidden(string $message = 'Action non autorisee.'): never
    {
        self::error($message, [], 403);
    }

    public static function notFound(string $message = 'Ressource introuvable.'): never
    {
        self::error($message, [], 404);
    }

    /**
     * Envoie effectivement la reponse et arrete le script.
     *
     * @param array<string,mixed> $payload
     */
    private static function send(array $payload, int $status): never
    {
        // On ne renvoie que du JSON : on le declare explicitement.
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
        }

        echo json_encode(
            $payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );

        exit;
    }
}
