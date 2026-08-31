<?php

declare(strict_types=1);

namespace Autocare\Core;

/**
 * Represente la requete HTTP entrante
 * ------------------------------------------------------------------
 * POURQUOI CE FICHIER ?
 * En PHP, les donnees d'une requete arrivent dans des variables
 * globales ($_SERVER, $_GET, php://input). Les manipuler directement
 * partout dans le code est une mauvaise idee :
 *   - on ne sait plus d'ou vient une donnee ;
 *   - on oublie de valider ;
 *   - c'est intestable.
 *
 * Cette classe rassemble tout au meme endroit. Le reste de
 * l'application ne touche plus jamais a $_GET ou $_POST.
 */
final class Request
{
    /**
     * @param string              $method Verbe HTTP : GET, POST, PUT, DELETE
     * @param string              $path   Chemin demande, ex: /api/vehicles/12
     * @param array<string,mixed> $query  Parametres d'URL (?page=2)
     * @param array<string,mixed> $body   Corps JSON decode
     * @param array<string,string> $headers En-tetes HTTP
     */
    private function __construct(
        public readonly string $method,
        public readonly string $path,
        private readonly array $query,
        private readonly array $body,
        private readonly array $headers,
    ) {
    }

    /**
     * Construit l'objet Request a partir des variables globales PHP.
     */
    public static function fromGlobals(): self
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

        // REQUEST_URI contient le chemin ET la query string
        // ("/api/vehicles?page=2"). On ne garde que le chemin.
        $uri  = $_SERVER['REQUEST_URI'] ?? '/';
        $path = parse_url($uri, PHP_URL_PATH) ?: '/';

        // On retire un eventuel "/" final pour que "/api/vehicles/"
        // et "/api/vehicles" mènent a la meme route.
        $path = rtrim($path, '/');
        if ($path === '') {
            $path = '/';
        }

        return new self(
            method:  $method,
            path:    $path,
            query:   $_GET,
            body:    self::parseJsonBody(),
            headers: self::readHeaders(),
        );
    }

    /**
     * Lit le corps de la requete et le decode s'il s'agit de JSON.
     * Notre API est 100% JSON (voir docs/api.md), on ne gere donc
     * pas les formulaires classiques.
     *
     * @return array<string,mixed>
     */
    private static function parseJsonBody(): array
    {
        $raw = file_get_contents('php://input');

        if ($raw === false || $raw === '') {
            return [];
        }

        $decoded = json_decode($raw, true);

        // Un JSON invalide n'est pas une erreur fatale ici : c'est le
        // controleur qui decidera si le champ manquant pose probleme.
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @return array<string,string>
     */
    private static function readHeaders(): array
    {
        $headers = [];

        foreach ($_SERVER as $key => $value) {
            // PHP expose les en-tetes sous la forme HTTP_CONTENT_TYPE.
            // On les remet au format "Content-Type".
            if (str_starts_with($key, 'HTTP_')) {
                $name = str_replace('_', '-', substr($key, 5));
                $headers[strtolower($name)] = (string) $value;
            }
        }

        return $headers;
    }

    /**
     * Valeur envoyee dans le corps JSON.
     * ATTENTION : cette valeur n'est PAS validee. Toute donnee passe
     * obligatoirement par le Validator avant d'etre utilisee.
     */
    public function input(string $key, mixed $default = null): mixed
    {
        return $this->body[$key] ?? $default;
    }

    /** @return array<string,mixed> */
    public function body(): array
    {
        return $this->body;
    }

    /**
     * Parametre passe dans l'URL (?statut=WAITING).
     */
    public function query(string $key, ?string $default = null): ?string
    {
        $value = $this->query[$key] ?? $default;

        return is_string($value) ? $value : $default;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }
}
