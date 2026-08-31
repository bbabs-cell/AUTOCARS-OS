<?php

declare(strict_types=1);

/**
 * Routeur du serveur de developpement PHP
 * ------------------------------------------------------------------
 * Le serveur integre de PHP (php -S) ne lit pas les fichiers
 * .htaccess. Sans ce petit fichier, une URL comme /api/health
 * renverrait "404 Not Found" au lieu d'atteindre index.php.
 *
 * Utilisation :
 *   php -S localhost:8000 -t public router.php
 *
 * Ce fichier n'a AUCUN role en production : sous Apache ou Nginx,
 * c'est la configuration du serveur qui fait ce travail.
 */

$requestedPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$fileOnDisk    = __DIR__ . '/public' . $requestedPath;

// Si le fichier existe vraiment (favicon, image...), on laisse le
// serveur integre le servir directement.
if ($requestedPath !== '/' && is_file($fileOnDisk)) {
    return false;
}

require __DIR__ . '/public/index.php';
