#!/usr/bin/env bash
# ==================================================================
# AUTOCARE OS — envoi des sauvegardes vers Cloudflare R2
# ==================================================================
# Usage, sur le serveur, APRÈS tools/backup.php :
#
#   ./deploy/backup-offsite.sh
#
# ------------------------------------------------------------------
# POURQUOI CE SCRIPT EXISTE
#
# `tools/backup.php` écrit ses archives dans storage/backups, SUR LE
# VPS. Tant qu'elles n'en sortent pas, elles ne protègent que d'une
# seule chose : une fausse manœuvre dans la base.
#
# Elles ne protègent PAS de ce qui emporte le serveur entier — un
# disque perdu, un VPS résilié par erreur, un accès administrateur
# compromis. Dans ces trois cas, la base et ses sauvegardes
# disparaissent ensemble, ce qui revient à n'avoir jamais sauvegardé.
#
# Une sauvegarde qui vit sur la machine qu'elle protège n'est pas une
# sauvegarde : c'est une copie.
#
# ------------------------------------------------------------------
# CE QU'IL FAIT, ET DANS CET ORDRE
#
#   1. Refuse de tourner s'il n'y a rien à envoyer, plutôt que de
#      réussir en ne faisant rien.
#   2. Envoie sans jamais supprimer à distance (`copy`, pas `sync`) :
#      la rétention locale de 14 jours ne doit pas effacer l'archive
#      de l'an dernier restée chez Cloudflare.
#   3. VÉRIFIE que ce qui est arrivé correspond à ce qui est parti.
#      Un envoi non vérifié est une croyance, pas une sauvegarde.
#   4. Applique une rétention distante par ÂGE, plus longue que la
#      locale — le stockage objet coûte peu, et les erreurs se
#      découvrent parfois des semaines plus tard.
# ------------------------------------------------------------------
set -euo pipefail

DOSSIER="${AUTOCARE_BACKUP_DIR:-/var/www/autocare/backend/storage/backups}"
DISTANT="${AUTOCARE_R2_REMOTE:-r2:autocare-sauvegardes}"
GARDE_JOURS="${AUTOCARE_R2_KEEP_DAYS:-90}"

echo "=== Envoi hors site — $(date '+%Y-%m-%d %H:%M') ==="
echo "  source : ${DOSSIER}"
echo "  cible  : ${DISTANT}"
echo

# --- 1. De quoi travailler ----------------------------------------
if ! command -v rclone > /dev/null; then
  echo "  [ECHEC] rclone n'est pas installe."
  echo "          sudo apt install rclone"
  exit 1
fi

if [ ! -d "$DOSSIER" ]; then
  echo "  [ECHEC] le dossier de sauvegardes n'existe pas : ${DOSSIER}"
  exit 1
fi

# `ls` dans un `if` echouerait avec set -e : on compte autrement.
NOMBRE=$(find "$DOSSIER" -maxdepth 1 -name 'autocare-*.sql.gz' | wc -l)

if [ "$NOMBRE" -eq 0 ]; then
  echo "  [ECHEC] aucune archive dans ${DOSSIER}."
  echo "          tools/backup.php a-t-il tourne ?"
  exit 1
fi

echo "  ${NOMBRE} archive(s) locale(s)."

# --- 2. Envoyer, sans jamais supprimer a distance -----------------
# `copy` et non `sync` : sync refleterait la retention locale de 14
# jours et supprimerait chez Cloudflare tout ce que le VPS a deja
# oublie. C'est exactement ce qu'on ne veut pas.
echo
echo "--- Envoi ---"
rclone copy "$DOSSIER" "$DISTANT" \
  --include 'autocare-*' \
  --checksum \
  --transfers 2 \
  --stats-one-line \
  --stats 30s

# --- 3. Verifier ---------------------------------------------------
# Sans cette etape, on saurait seulement que rclone n'a pas protesté.
# `check --one-way` compare le contenu present des deux cotes : il
# echoue si un fichier manque a distance ou si son empreinte differe.
echo
echo "--- Verification ---"
# On ecrit la sortie dans un fichier AU LIEU de la passer dans un tuyau.
#
# Ce n'est pas une preference de style. `rclone check ... | tail` ne
# renvoie le code d'erreur de rclone que si `set -o pipefail` est actif
# — il l'est ici, mais la verification d'une sauvegarde ne doit pas
# dependre d'une option posee quarante lignes plus haut. Qui copierait
# cette ligne ailleurs, ou retirerait `pipefail`, obtiendrait un
# controle qui repond toujours « tout va bien ».
JOURNAL=$(mktemp)
trap 'rm -f "$JOURNAL"' EXIT

if rclone check "$DOSSIER" "$DISTANT" \
     --include 'autocare-*' --one-way --checkers 4 > "$JOURNAL" 2>&1; then
  grep -E "matching files|differences found" "$JOURNAL" | sed 's/^/  /' || true
  echo "  Tout ce qui est ici est la-bas, a l'identique."
else
  echo "  [ECHEC] ce qui est arrive ne correspond pas a ce qui est parti."
  tail -10 "$JOURNAL" | sed 's/^/    /'
  echo "          NE SUPPRIMEZ RIEN localement tant que ce n'est pas regle."
  exit 1
fi

# --- 4. Retention distante, par age -------------------------------
# Plus longue que la retention locale : le stockage objet coute peu,
# et une erreur de donnees se decouvre parfois des semaines apres.
echo
echo "--- Retention distante (${GARDE_JOURS} jours) ---"
rclone delete "$DISTANT" --min-age "${GARDE_JOURS}d" --include 'autocare-*' \
  --verbose > "$JOURNAL" 2>&1 || true
RETIRES=$(grep -c "Deleted" "$JOURNAL" || true)

if [ "${RETIRES:-0}" -gt 0 ]; then
  echo "  ${RETIRES} fichier(s) au-dela de ${GARDE_JOURS} jours retire(s)."
else
  echo "  Rien a retirer."
fi

echo
echo "--- Etat chez Cloudflare ---"
rclone size "$DISTANT" 2>&1 | sed 's/^/  /'

echo
echo "Envoi hors site termine."
