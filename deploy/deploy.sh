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

# ------------------------------------------------------------------
# LES QUATRE VARIABLES QUE CE SCRIPT LIT
#
# Chacune a une valeur par defaut utilisable telle quelle. Elles sont
# documentees dans docs/deploiement.md §5 : un script qui lit une
# variable que la documentation ne mentionne pas est un piege.
#
#   AUTOCARE_ROOT    ou le depot est clone        /var/www/autocare
#   AUTOCARE_BRANCH  la branche a mettre en ligne main
#   AUTOCARE_WEB     ou le frontend est publie    /var/www/autocare-web
#                    (DOIT etre identique au `root` de nginx)
#   AUTOCARE_HOST    le domaine, pour l'appel de verification finale
#                    (sans valeur par defaut : sans lui, l'etape 6
#                     est annoncee comme non faite au lieu d'echouer)
# ------------------------------------------------------------------
RACINE="${AUTOCARE_ROOT:-/var/www/autocare}"
BRANCHE="${AUTOCARE_BRANCH:-main}"
WEB="${AUTOCARE_WEB:-/var/www/autocare-web}"

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
rm -rf "${WEB}-nouveau"
cp -r frontend/dist/frontend/browser "${WEB}-nouveau"

# On refuse de publier un dossier sans index.html : ce serait un site
# blanc en ligne, et le retour arriere devrait etre fait a la main.
if [ ! -f "${WEB}-nouveau/index.html" ]; then
  echo "  [ECHEC] la compilation n'a pas produit d'index.html."
  rm -rf "${WEB}-nouveau"
  exit 1
fi

rm -rf "${WEB}-ancien"
if [ -d "$WEB" ]; then
  mv "$WEB" "${WEB}-ancien"
fi
mv "${WEB}-nouveau" "$WEB"

echo
echo "=== 5. Contrôle d'avant-vol ==="
(cd backend && php tools/preflight.php)

echo
echo "=== 6. L'API répond ? ==="
# Sans AUTOCARE_HOST, on ne peut pas verifier. On le DIT, au lieu de
# tester "https:///api/health" et de faire echouer une mise en ligne
# par ailleurs reussie.
if [ -z "${AUTOCARE_HOST:-}" ]; then
  echo "  [NON VÉRIFIÉ] AUTOCARE_HOST n'est pas defini."
  echo "                Ouvrez https://votre-domaine/api/health a la main."
else
  php -r 'exit(@file_get_contents("https://".getenv("AUTOCARE_HOST")."/api/health") ? 0 : 1);' \
    && echo "  /api/health répond." \
    || { echo "  [ÉCHEC] /api/health ne répond pas."; exit 1; }
fi


# ------------------------------------------------------------------
# 7. ON VERIFIE CE QUI SORT, PAS CE QU'ON A ECRIT
# ------------------------------------------------------------------
# La configuration Nginx contenait six en-tetes de securite. Ils
# etaient servis a PERSONNE : un `add_header` dans un `location`
# remplace tous ceux herites du bloc `server`, et trois `location` en
# posaient un pour le cache. Relire le fichier ne le montrait pas.
# Un `curl -I` le montre en une seconde.
#
# De meme pour la feuille de style : si Angular remet un gestionnaire
# `onload=` inline, la CSP le bloque et le site s'affiche sans aucun
# style — sans la moindre erreur cote serveur.
if [ -n "${AUTOCARE_HOST:-}" ] && command -v curl > /dev/null; then
  echo
  echo "=== 7. Ce que le navigateur recoit vraiment ==="

  ENTETES=$(curl -sI "https://${AUTOCARE_HOST}/" || true)
  MANQUANTS=""
  for h in Strict-Transport-Security Content-Security-Policy \
           X-Content-Type-Options Referrer-Policy \
           X-Frame-Options Permissions-Policy; do
    echo "$ENTETES" | grep -qi "^${h}:" || MANQUANTS="$MANQUANTS $h"
  done

  if [ -n "$MANQUANTS" ]; then
    echo "  [ECHEC] en-tetes de securite absents de la reponse :$MANQUANTS"
    echo '          Verifiez que chaque location posant un add_header'
    echo "          inclut autocare-security-headers.conf."
    exit 1
  fi
  echo "  Les 6 en-tetes de securite sont servis."

  if curl -s "https://${AUTOCARE_HOST}/" | grep -q 'rel="stylesheet"[^>]*onload='; then
    echo "  [ECHEC] la feuille de style utilise un onload= inline."
    echo "          La CSP le bloque : le site s'affichera SANS STYLE."
    echo "          Mettez optimization.styles.inlineCritical a false."
    exit 1
  fi
  echo "  La feuille de style se charge sans script inline."
fi

echo
echo "Mise en ligne terminée."
echo "Pour revenir en arrière :  ./deploy/rollback.sh"
