<?php

declare(strict_types=1);

namespace Autocare\Core;

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
     * @var array<int, array{method:string, pattern:string, handler:array{0:class-string,1:string}}>
     */
    private array $routes = [];

    /**
     * Enregistre une route.
     *
     * @param string $method  GET, POST, PUT, DELETE
     * @param string $pattern Chemin, ex: "/api/vehicles/{id}"
     * @param array{0:class-string,1:string} $handler [Controleur::class, 'methode']
     */
    public function add(string $method, string $pattern, array $handler): void
    {
        $this->routes[] = [
            'method'  => strtoupper($method),
            'pattern' => rtrim($pattern, '/') ?: '/',
            'handler' => $handler,
        ];
    }

    /** @param array{0:class-string,1:string} $handler */
    public function get(string $pattern, array $handler): void
    {
        $this->add('GET', $pattern, $handler);
    }

    /** @param array{0:class-string,1:string} $handler */
    public function post(string $pattern, array $handler): void
    {
        $this->add('POST', $pattern, $handler);
    }

    /** @param array{0:class-string,1:string} $handler */
    public function put(string $pattern, array $handler): void
    {
        $this->add('PUT', $pattern, $handler);
    }

    /** @param array{0:class-string,1:string} $handler */
    public function delete(string $pattern, array $handler): void
    {
        $this->add('DELETE', $pattern, $handler);
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

            [$controllerClass, $methodName] = $route['handler'];

            $controller = new $controllerClass();
            $controller->{$methodName}($request, ...array_values($parameters));

            return;
        }

        if ($pathExistsWithOtherMethod) {
            Response::error(
                "La methode {$request->method} n'est pas autorisee sur {$request->path}.",
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
