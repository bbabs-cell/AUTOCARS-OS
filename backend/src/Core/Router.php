<?php

declare(strict_types=1);

namespace Autocare\Core;

use Autocare\Http\Middleware\AuthMiddleware;

/**
 * Routeur : associe une URL a un morceau de code
 * ------------------------------------------------------------------
 * POURQUOI CE FICHIER ?
 * Toutes les requetes arrivent sur public/index.php (voir le fichier
 * .htaccess). Il faut donc decider quoi executer selon l'URL demandee :
 *
 *   GET  /api/vehicles      -> VehicleController::index()
 *   POST /api/vehicles      -> VehicleController::store()
 *   GET  /api/vehicles/42   -> VehicleController::show(42)
 *
 * C'est exactement le role de cette classe. Elle fait environ 100
 * lignes : c'est le prix a payer pour ne pas dependre d'un framework,
 * et c'est un tres bon exercice pour comprendre ce que font Laravel
 * ou Symfony sous le capot.
 *
 * AVANTAGE POUR LA SECURITE : comme toutes les requetes passent ici,
 * c'est le seul endroit ou brancher l'authentification et les
 * permissions. On ne peut donc pas les "oublier" sur une route.
 */
final class Router
{
    /**
     * Liste des routes enregistrees.
     * @var array<int, array{
     *     method:string,
     *     pattern:string,
     *     handler:array{0:class-string,1:string},
     *     auth:bool,
     *     permission:string|null
     * }>
     */
    private array $routes = [];

    /**
     * Enregistre une route.
     *
     * @param string $method  GET, POST, PUT, DELETE
     * @param string $pattern Chemin, ex: "/api/vehicles/{id}"
     * @param array{0:class-string,1:string} $handler [Controleur::class, 'methode']
     * @param array{auth?:bool, permission?:string} $options
     *
     * Les options declarent les exigences de securite DE LA ROUTE
     * elle-meme. C'est volontaire : en lisant config/routes.php, on
     * voit d'un coup d'oeil ce qui est public et ce qui ne l'est pas.
     * Une protection oubliee devient visible a la relecture.
     */
    public function add(string $method, string $pattern, array $handler, array $options = []): void
    {
        $this->routes[] = [
            'method'     => strtoupper($method),
            'pattern'    => rtrim($pattern, '/') ?: '/',
            'handler'    => $handler,
            'auth'       => (bool) ($options['auth'] ?? false),
            'permission' => $options['permission'] ?? null,
        ];
    }

    /**
     * @param array{0:class-string,1:string} $handler
     * @param array{auth?:bool, permission?:string} $options
     */
    public function get(string $pattern, array $handler, array $options = []): void
    {
        $this->add('GET', $pattern, $handler, $options);
    }

    /**
     * @param array{0:class-string,1:string} $handler
     * @param array{auth?:bool, permission?:string} $options
     */
    public function post(string $pattern, array $handler, array $options = []): void
    {
        $this->add('POST', $pattern, $handler, $options);
    }

    /**
     * @param array{0:class-string,1:string} $handler
     * @param array{auth?:bool, permission?:string} $options
     */
    public function put(string $pattern, array $handler, array $options = []): void
    {
        $this->add('PUT', $pattern, $handler, $options);
    }

    /**
     * @param array{0:class-string,1:string} $handler
     * @param array{auth?:bool, permission?:string} $options
     */
    public function delete(string $pattern, array $handler, array $options = []): void
    {
        $this->add('DELETE', $pattern, $handler, $options);
    }

    /**
     * Cherche la route correspondant a la requete et l'execute.
     * Si aucune route ne correspond, renvoie une erreur 404.
     */
    public function dispatch(Request $request): void
    {
        // On retient si le chemin existe mais avec un autre verbe HTTP,
        // pour renvoyer un message plus utile qu'un simple 404.
        $pathExistsWithOtherMethod = false;

        foreach ($this->routes as $route) {
            $parameters = $this->matchPattern($route['pattern'], $request->path);

            if ($parameters === null) {
                continue; // le chemin ne correspond pas du tout
            }

            if ($route['method'] !== $request->method) {
                $pathExistsWithOtherMethod = true;
                continue;
            }

            // La securite est appliquee ICI, avant le controleur.
            // Comme toutes les requetes passent par ce point unique,
            // il est impossible d'oublier la verification sur une
            // route : elle ne depend pas de ce que le controleur
            // pense a faire.
            if ($route['auth']) {
                AuthMiddleware::handle($request, $route['permission']);
            }

            [$controllerClass, $methodName] = $route['handler'];

            $controller = new $controllerClass();
            $controller->{$methodName}($request, ...array_values($parameters));

            return;
        }

        // Les deux messages qui suivent sont les seuls du produit
        // qu'aucun écran ne met en forme : ils sortent bruts, dans la
        // console d'un développeur ou dans un journal. Ils sont écrits
        // en français correct, accents compris, comme tous les autres.
        if ($pathExistsWithOtherMethod) {
            Response::error(
                "La méthode {$request->method} n'est pas autorisée sur {$request->path}.",
                [],
                405
            );
        }

        Response::notFound("La route {$request->method} {$request->path} n'existe pas.");
    }

    /**
     * Compare un motif de route au chemin demande.
     *
     * Exemple : pattern "/api/vehicles/{id}" et chemin "/api/vehicles/42"
     *           -> retourne ['id' => '42']
     *
     * Retourne null si le chemin ne correspond pas.
     *
     * @return array<string,string>|null
     */
    private function matchPattern(string $pattern, string $path): ?array
    {
        // Cas simple et le plus frequent : aucun parametre dans l'URL.
        if (!str_contains($pattern, '{')) {
            return $pattern === $path ? [] : null;
        }

        // On transforme "/api/vehicles/{id}" en expression reguliere.
        // preg_quote protege les caracteres speciaux (les "/" notamment),
        // puis on remplace \{id\} par un groupe nomme.
        $regex = preg_quote($pattern, '#');
        $regex = preg_replace('#\\\{([a-zA-Z_]+)\\\}#', '(?P<$1>[^/]+)', $regex);
        $regex = '#^' . $regex . '$#';

        if (preg_match($regex, $path, $matches) !== 1) {
            return null;
        }

        // On ne garde que les groupes nommes (id, stationId, ...).
        return array_filter(
            $matches,
            static fn (string|int $key): bool => is_string($key),
            ARRAY_FILTER_USE_KEY
        );
    }
}
