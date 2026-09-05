<?php

declare(strict_types=1);

/**
 * Tests de la configuration de déploiement
 * ==================================================================
 * UNE CONFIGURATION QU'ON N'A JAMAIS FAIT TOURNER N'EST PAS UNE
 * CONFIGURATION : C'EST UNE INTENTION.
 * ==================================================================
 * Usage :
 *   php tests/deployment_test.php
 *
 * ------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE
 *
 * Le lot 22 a livré une procédure de mise en production complète :
 * une configuration Nginx commentée, un script de déploiement, un
 * contrôle d'avant-vol de 28 points, une documentation de 276 lignes.
 * 903 tests passaient. Rien de tout cela n'avait jamais été EXÉCUTÉ.
 *
 * À la première tentative réelle de mise en ligne, sept défauts sont
 * apparus, dont trois auraient rendu le site inutilisable et un
 * quatrième supprimait silencieusement toute la sécurité HTTP :
 *
 *   1. Le frontend compilé appelait « https://api.autocare-os.com »,
 *      un domaine qui n'existe pas, alors que Nginx sert l'API sur le
 *      même domaine sous /api.
 *   2. La racine Nginx pointait sur le dossier SOURCE du frontend,
 *      pas sur le dossier publié par deploy.sh.
 *   3. Le bloc /api utilisait `alias` + `try_files` : dans un bloc
 *      `alias`, le repli de try_files est résolu depuis la racine du
 *      SITE. Aucune route de l'API ne fonctionnait ; un POST vers
 *      /api/auth/login recevait « 405 Not Allowed ».
 *   4. Trois `location` posaient un `add_header` de cache, ce qui
 *      REMPLACE tous les add_header hérités : HSTS, CSP, X-Frame,
 *      nosniff, Referrer-Policy et Permissions-Policy n'étaient
 *      servis sur AUCUN chemin.
 *   5. La CSP `script-src 'self'` bloquait le `onload=` inline
 *      qu'Angular pose pour différer sa feuille de style : le site
 *      s'affichait entièrement sans style.
 *   6. Le retour arrière documenté (`mv ...-ancien ...-web`) imbrique
 *      l'ancien dossier DANS le nouveau au lieu de le remplacer, sans
 *      renvoyer d'erreur.
 *   7. deploy.sh lisait trois variables d'environnement que la
 *      documentation ne mentionnait nulle part.
 *
 * Aucun de ces défauts n'était détectable par un test unitaire du
 * code applicatif : ils vivent tous dans l'espace ENTRE les fichiers
 * — entre le build et le serveur, entre le serveur et la doc, entre
 * la CSP et le HTML généré. Ce sont ces accords-là qu'on vérifie ici.
 *
 * CE QUE CE FICHIER NE PEUT PAS FAIRE : démarrer un vrai Nginx. Il
 * lit les fichiers et vérifie qu'ils se répondent. La preuve qu'ils
 * FONCTIONNENT reste une mise en ligne réelle suivie d'un `curl -I`
 * — c'est le sens du §6 de docs/deploiement.md.
 */

$racine  = dirname(__DIR__, 1);
$projet  = dirname($racine);

$passed = 0;
$failed = 0;

function check(string $d, bool $c, string $x = ''): void {
    global $passed, $failed;
    if ($c) { $passed++; echo "  [OK]     {$d}\n"; }
    else { $failed++; echo "  [ÉCHEC]  {$d}" . ($x !== '' ? " — {$x}" : '') . "\n"; }
}

$nginx    = (string) @file_get_contents($projet . '/deploy/nginx.conf.example');
$entetes  = (string) @file_get_contents($projet . '/deploy/security-headers.conf');
$deploy   = (string) @file_get_contents($projet . '/deploy/deploy.sh');
$rollback = (string) @file_get_contents($projet . '/deploy/rollback.sh');
$doc      = (string) @file_get_contents($projet . '/docs/deploiement.md');
$env      = (string) @file_get_contents($projet . '/frontend/src/environments/environment.ts');
$angular  = (string) @file_get_contents($projet . '/frontend/angular.json');

echo "\n=== Configuration de déploiement ===\n\n";

echo "1. Les fichiers existent\n";
check('deploy/nginx.conf.example',    $nginx !== '');
check('deploy/security-headers.conf', $entetes !== '');
check('deploy/deploy.sh',             $deploy !== '');
check('deploy/rollback.sh',           $rollback !== '');

echo "\n2. Nginx et deploy.sh publient au MÊME endroit (défaut n° 2)\n";
// Le fichier contient DEUX `root` : celui du bloc ACME (challenge
// Let's Encrypt) et celui du site. On veut le second — d'ou preg_match_all.
preg_match_all('/^\s*root\s+([^;]+);/m', $nginx, $m);
$racines = array_map('trim', $m[1] ?? []);
$racineNginx = $racines === [] ? '' : end($racines);
preg_match('/AUTOCARE_WEB:-([^}]+)\}/', $deploy, $m2);
$cibleDeploy = isset($m2[1]) ? trim($m2[1]) : '';
check(
    'la racine Nginx est celle que publie deploy.sh',
    $racineNginx !== '' && $racineNginx === $cibleDeploy,
    "nginx sert « {$racineNginx} », deploy.sh publie dans « {$cibleDeploy} »",
);
check(
    'la racine Nginx n\'est PAS le dossier source du frontend',
    !str_contains($racineNginx, '/frontend'),
    "servir les sources exposerait src/ et package.json — trouvé « {$racineNginx} »",
);

echo "\n3. Le bloc /api ne retombe pas dans le piège alias+try_files (défaut n° 3)\n";
preg_match('/location \/api \{(.*?)\n    \}/s', $nginx, $m3);
$blocApi = $m3[1] ?? '';
check('un bloc location /api existe', $blocApi !== '');
check(
    'le bloc /api n\'utilise pas `alias` avec `try_files`',
    !(str_contains($blocApi, 'alias') && str_contains($blocApi, 'try_files')),
    'dans un bloc alias, le repli de try_files est résolu depuis la racine du site',
);
check(
    'le bloc /api passe directement au contrôleur frontal',
    str_contains($blocApi, 'fastcgi_pass') && str_contains($blocApi, 'SCRIPT_FILENAME'),
);
check(
    'SCRIPT_FILENAME est un chemin absolu vers index.php',
    (bool) preg_match('#SCRIPT_FILENAME\s+/\S+/public/index\.php#', $blocApi),
);

echo "\n4. Les en-têtes de sécurité atteignent le navigateur (défaut n° 4)\n";
$attendus = [
    'Strict-Transport-Security',
    'Content-Security-Policy',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'X-Frame-Options',
    'Permissions-Policy',
];
foreach ($attendus as $e) {
    check("security-headers.conf pose {$e}", str_contains($entetes, $e));
}

// LA RÈGLE NGINX QUI A COÛTÉ LES SIX EN-TÊTES :
// un add_header dans un location REMPLACE tous ceux du parent.
// Donc tout location qui en pose un DOIT inclure le fichier commun.
$blocs = [];
preg_match_all('/location\s+[^\{]*\{((?:[^{}]|\{[^{}]*\})*)\}/', $nginx, $tous, PREG_SET_ORDER);
foreach ($tous as $b) {
    $corps = $b[1];
    if (str_contains($corps, 'add_header')) {
        $blocs[] = $corps;
    }
}
check(
    'au moins un location pose un add_header (sinon ce test ne teste rien)',
    $blocs !== [],
);
$manquants = 0;
foreach ($blocs as $corps) {
    if (!str_contains($corps, 'security-headers.conf')) {
        $manquants++;
    }
}
check(
    'CHAQUE location qui pose un add_header inclut security-headers.conf',
    $manquants === 0,
    "{$manquants} bloc(s) effacent silencieusement les en-têtes hérités",
);
check(
    'le bloc server inclut aussi le fichier',
    substr_count($nginx, 'security-headers.conf') >= count($blocs) + 1,
);

echo "\n5. La CSP et le HTML généré par Angular s'accordent (défaut n° 5)\n";
preg_match('/Content-Security-Policy.*?script-src ([^;"]+)/', $entetes, $m4);
$scriptSrc = $m4[1] ?? '';
check(
    "la CSP interdit le script inline (script-src : {$scriptSrc})",
    $scriptSrc !== '' && !str_contains($scriptSrc, 'unsafe-inline'),
);
// Angular pose `onload="this.media='all'"` sur sa feuille de style
// quand inlineCritical est actif. C'est un gestionnaire inline : la
// CSP ci-dessus le bloque, et le site s'affiche SANS AUCUN STYLE.
$conf = json_decode($angular, true);
$optim = $conf['projects']['frontend']['architect']['build']['configurations']['production']['optimization'] ?? null;
check(
    'inlineCritical est désactivé pour la production',
    is_array($optim) && ($optim['styles']['inlineCritical'] ?? true) === false,
    'sinon Angular pose un onload= inline que la CSP bloque : site sans style',
);

echo "\n6. Le frontend appelle une API qui existe (défaut n° 1)\n";
preg_match("/apiUrl:\s*'([^']+)'/", $env, $m5);
$apiUrl = $m5[1] ?? '';
check("apiUrl de production est renseigné (« {$apiUrl} »)", $apiUrl !== '');
check(
    'apiUrl est relatif — même origine que le site',
    str_starts_with($apiUrl, '/'),
    "« {$apiUrl} » est un domaine absolu : il doit exister ET être servi, ce que Nginx ne fait pas",
);
check(
    'apiUrl correspond au préfixe servi par Nginx',
    str_contains($nginx, 'location ' . rtrim($apiUrl, '/')),
    "Nginx ne déclare aucun location pour « {$apiUrl} »",
);

echo "\n7. Le retour arrière fonctionne (défaut n° 6)\n";
check(
    'la documentation renvoie vers rollback.sh',
    str_contains($doc, 'rollback.sh'),
);
// La doc CITE volontairement le `mv` fautif comme contre-exemple :
// c'est la partie pédagogique, on ne la supprime pas. Ce qu'on vérifie,
// c'est que la PREMIÈRE commande proposée sous « Revenir en arrière »
// est la bonne — un lecteur pressé ne lit que celle-là.
preg_match('/### Revenir en arrière(.*?)```bash\n(.*?)```/s', $doc, $m7);
$premiereCommande = trim($m7[2] ?? '');
check(
    'la première commande proposée pour revenir en arrière est rollback.sh',
    str_contains($premiereCommande, 'rollback.sh'),
    "un lecteur pressé tape la première : « {$premiereCommande} »",
);
check(
    'ce n\'est pas le `mv` qui imbrique',
    !preg_match('/^mv\s/', $premiereCommande),
    'mv vers un dossier existant déplace DEDANS au lieu de remplacer',
);
check(
    'rollback.sh refuse s\'il n\'y a rien à restaurer',
    str_contains($rollback, '-ancien') && str_contains($rollback, 'exit 1'),
);
check(
    'rollback.sh vérifie qu\'il restaure bien un frontend compilé',
    str_contains($rollback, 'index.html'),
);
check(
    'rollback.sh conserve la version fautive',
    str_contains($rollback, '-casse'),
);

echo "\n8. deploy.sh ne lit aucune variable non documentée (défaut n° 7)\n";
preg_match_all('/\$\{(AUTOCARE_[A-Z_]+)(?::-[^}]*)?\}/', $deploy, $m6);
$variables = array_values(array_unique($m6[1] ?? []));
check('deploy.sh lit au moins une variable AUTOCARE_*', $variables !== []);
foreach ($variables as $v) {
    check("{$v} est documentée dans docs/deploiement.md", str_contains($doc, $v));
}

echo "\n9. Vercel : la même application, servie autrement\n";
// Vercel ne fait tourner ni PHP ni MySQL. Le frontend y vit, l'API
// reste ailleurs, et une réécriture /api la ramène sur la MÊME
// origine — ce qui préserve exactement ce qui a été validé sous
// Nginx : pas de CORS, cookie SameSite=Strict, CSP connect-src 'self'.
$vercelBrut = (string) @file_get_contents($projet . '/vercel.json');
$vercel     = json_decode($vercelBrut, true);
check('vercel.json existe et est un JSON valide', is_array($vercel));

if (is_array($vercel)) {
    // Le dossier publié doit suivre angular.json. Sans outputPath
    // épinglé, ce chemin dépendait d'une valeur par défaut d'Angular
    // que personne ne contrôle.
    $confAngular = json_decode($angular, true);
    $sortieNg = $confAngular['projects']['frontend']['architect']['build']['options']['outputPath'] ?? '';
    check(
        'angular.json épingle outputPath',
        $sortieNg !== '',
        'sinon le chemin de sortie dépend d\'un défaut d\'Angular, et trois fichiers en dépendent',
    );
    check(
        'outputDirectory de Vercel suit angular.json',
        ($vercel['outputDirectory'] ?? '') === 'frontend/' . $sortieNg . '/browser',
        "vercel publie « " . ($vercel['outputDirectory'] ?? '') . " », angular produit « frontend/{$sortieNg}/browser »",
    );

    $reecritures = $vercel['rewrites'] ?? [];
    $sources = array_column($reecritures, 'source');
    check('une réécriture /api existe', ($sources[0] ?? '') === '/api/:chemin*');
    check(
        'la réécriture /api passe AVANT le repli de l\'application',
        count($sources) >= 2 && $sources[0] !== '/(.*)' && in_array('/(.*)', $sources, true),
        'inversées, toutes les routes de l\'API recevraient index.html',
    );
    $cible = $reecritures[0]['destination'] ?? '';
    check(
        'la réécriture conserve le préfixe /api attendu par le routeur PHP',
        str_contains($cible, '/api/:chemin*'),
        'src/Core/Request.php lit REQUEST_URI tel quel : le préfixe doit arriver intact',
    );

    // Les mêmes six en-têtes que sous Nginx, sinon le niveau de
    // sécurité dépend de l'hébergeur choisi ce jour-là.
    $posesVercel = [];
    foreach ($vercel['headers'] ?? [] as $regle) {
        foreach ($regle['headers'] ?? [] as $h) {
            $posesVercel[$h['key']] = $h['value'];
        }
    }
    foreach ($attendus as $e) {
        check("vercel.json pose {$e}", isset($posesVercel[$e]));
    }

    // La CSP ne doit pas diverger entre les deux hébergements : une
    // CSP plus permissive sur Vercel serait une régression invisible.
    preg_match('/add_header Content-Security-Policy "([^"]+)"/', $entetes, $mc);
    check(
        'la CSP de Vercel est identique à celle de Nginx',
        isset($mc[1]) && ($posesVercel['Content-Security-Policy'] ?? '') === $mc[1],
        'deux CSP qui divergent = un niveau de sécurité qui dépend de l\'hébergeur',
    );
}

echo "\n10. deploy.sh refuse de publier un dossier vide\n";
check(
    'deploy.sh vérifie la présence d\'index.html avant de publier',
    str_contains($deploy, 'index.html'),
    'sans ce contrôle, une compilation ratée met un site blanc en ligne',
);

echo "\n" . str_repeat('=', 60) . "\n";
printf("  %d test(s) réussi(s), %d échec(s)\n", $passed, $failed);
echo str_repeat('=', 60) . "\n";

exit($failed > 0 ? 1 : 0);
