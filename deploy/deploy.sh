#!/usr/bin/env bash
# ==================================================================
# AUTOCARE OS — mise en ligne d'une version
# ==================================================================
# Usage, sur le serveur :
#
#   ./deploy/deploy.sh
#
# Il n'y a pas de magie ici : c'est la suite des commandes qu'on
# taperait à la main, dans le bon ordre, avec les garde-fous qu'on
# oublie quand on est pressé.
#
# ------------------------------------------------------------------
# CE QU'IL FAIT DANS CET ORDRE, ET POURQUOI CET ORDRE
#
#   1. SAUVEGARDE D'ABORD. Avant toute migration. Si la mise en ligne
#      se passe mal, on a l'état d'avant — pas celui d'hier soir.
#   2. Récupère le code, installe les dépendances.
#   3. Applique les migrations.
#   4. Compile l'application, puis la publie d'un seul coup.
#   5. Contrôle d'avant-vol. En dernier, parce qu'il vérifie l'état
#      RÉEL du serveur après déploiement.
#
# ------------------------------------------------------------------
# set -e : la moindre erreur arrête tout.
# Sans lui, une migration qui échoue laisserait quand même publier le
# nouveau frontend — c'est-à-dire une application qui appelle des
# colonnes inexistantes.
set -euo pipefail

RACINE="${AUTOCARE_ROOT:-/var/www/autocare}"
BRANCHE="${AUTOCARE_BRANCH:-main}"

cd "$RACINE"

echo "=== 1. Sauvegarde avant tout ==="
(cd backend && php tools/backup.php)

echo
echo "=== 2. Code ==="
git fetch origin "$BRANCHE"
git checkout "$BRANCHE"
git pull --ff-only origin "$BRANCHE"

(cd backend && composer install --no-dev --optimize-autoloader --no-interaction)

echo
echo "=== 3. Base de données ==="
(cd backend && php tools/migrate.php)

echo
echo "=== 4. Application ==="
(cd frontend && npm ci && npm run build)

# PUBLICATION ATOMIQUE.
#
# Copier fichier par fichier par-dessus la version en place laisse,
# pendant quelques secondes, un index.html neuf qui réclame des
# fichiers pas encore copiés — et l'utilisateur voit une page blanche.
#
# On prépare à côté, puis on échange les dossiers d'un seul geste.
rm -rf /var/www/autocare-web-nouveau
cp -r frontend/dist/frontend/browser /var/www/autocare-web-nouveau
rm -rf /var/www/autocare-web-ancien
if [ -d /var/www/autocare-web ]; then
  mv /var/www/autocare-web /var/www/autocare-web-ancien
fi
mv /var/www/autocare-web-nouveau /var/www/autocare-web

echo
echo "=== 5. Contrôle d'avant-vol ==="
(cd backend && php tools/preflight.php)

echo
echo "=== 6. L'API répond ? ==="
php -r 'exit(@file_get_contents("https://".getenv("AUTOCARE_HOST")."/api/health") ? 0 : 1);' \
  && echo "  /api/health répond." \
  || { echo "  [ÉCHEC] /api/health ne répond pas."; exit 1; }

echo
echo "Mise en ligne terminée."
echo "Pour revenir en arrière : mv /var/www/autocare-web-ancien /var/www/autocare-web"
