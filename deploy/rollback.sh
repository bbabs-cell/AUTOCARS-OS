#!/usr/bin/env bash
# ==================================================================
# AUTOCARE OS — revenir à la version précédente du frontend
# ==================================================================
# Usage, sur le serveur :
#
#   ./deploy/rollback.sh
#
# ------------------------------------------------------------------
# POURQUOI CE SCRIPT EXISTE PLUTÔT QU'UNE LIGNE DANS LA DOC
#
# La documentation disait :
#
#     mv /var/www/autocare-web-ancien /var/www/autocare-web
#
# Cette commande est fausse, et elle est fausse silencieusement. Quand
# la destination existe déjà — ce qui est TOUJOURS le cas ici, puisque
# la version cassée est en place — `mv` ne remplace pas le dossier :
# il déplace la source À L'INTÉRIEUR. On obtient
#
#     /var/www/autocare-web/autocare-web-ancien/
#
# le site reste cassé, `mv` ne renvoie aucune erreur, et la personne
# qui vient de taper la commande croit avoir réparé.
#
# Un retour arrière se tape en panique, à une heure où l'on ne relit
# rien. C'est le dernier endroit du projet où l'on peut se permettre
# une commande qui échoue sans le dire.
#
# ------------------------------------------------------------------
set -euo pipefail

WEB="${AUTOCARE_WEB:-/var/www/autocare-web}"

if [ ! -d "${WEB}-ancien" ]; then
  echo "[ÉCHEC] Aucune version précédente dans ${WEB}-ancien."
  echo "        Il n'y a rien à restaurer : ne touchez pas à ${WEB}."
  exit 1
fi

if [ ! -f "${WEB}-ancien/index.html" ]; then
  echo "[ÉCHEC] ${WEB}-ancien ne contient pas d'index.html."
  echo "        Ce n'est pas un frontend compilé — on ne publie pas ça."
  exit 1
fi

# On garde la version cassée : c'est la seule pièce à conviction pour
# comprendre demain ce qui s'est passé cette nuit.
rm -rf "${WEB}-casse"

if [ -d "$WEB" ]; then
  mv "$WEB" "${WEB}-casse"
fi

mv "${WEB}-ancien" "$WEB"

echo "Version précédente rétablie dans $WEB."
echo "La version fautive est conservée dans ${WEB}-casse."
echo
echo "ATTENTION : seul le frontend est revenu en arrière."
echo "Les migrations de base de données, elles, sont toujours"
echo "appliquées. Si le problème vient d'une migration, voir la"
echo "restauration de sauvegarde (docs/deploiement.md §7)."
