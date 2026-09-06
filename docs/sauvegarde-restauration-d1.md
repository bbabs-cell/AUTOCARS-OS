# Sauvegarder et restaurer la base D1

> **Une sauvegarde qu'on n'a jamais restaurée n'est pas une
> sauvegarde.** Ce document décrit des outils qui ont été exécutés,
> pas seulement écrits. Les deux pièges de la section 4 ont été
> trouvés en restaurant pour de vrai.

---

## 1. Pourquoi ces outils, alors que D1 sait revenir en arrière

D1 propose **Time Travel** : revenir à n'importe quelle seconde des
trente derniers jours, sans rien avoir préparé.

```bash
npx wrangler d1 time-travel info autocare
npx wrangler d1 time-travel restore autocare --timestamp=2026-09-05T08:00:00Z
```

**Pour le cas courant, c'est meilleur que ces scripts** : une table
effacée par erreur ce matin se rattrape en une commande, sans perdre
les heures qui ont suivi.

Time Travel ne couvre pas le cas qui fait perdre une entreprise :
**le compte Cloudflare lui-même**. Suspendu, fermé, facture impayée,
identifiants perdus — et Time Travel disparaît avec la base qu'il
protège.

**Ces outils existent pour sortir les données de chez Cloudflare.**
C'est leur seule raison d'être, et c'est pourquoi l'archive doit
finir ailleurs.

| | Time Travel | `tools/sauvegarde.mjs` |
|---|---|---|
| Erreur humaine (table vidée) | ✅ le meilleur outil | ✅ mais on perd la journée |
| Bogue applicatif découvert tard | ✅ jusqu'à 30 jours | ✅ selon la rétention |
| Compte Cloudflare perdu | ❌ **rien** | ✅ c'est tout l'objet |
| Changement d'hébergeur | ❌ | ✅ un fichier `.sql` |

---

## 2. Sauvegarder

```bash
cd workers

node tools/sauvegarde.mjs --local     # la base de développement
node tools/sauvegarde.mjs --remote    # la base de production
```

Dans une tâche planifiée, toutes les nuits à 2 h :

```cron
0 2 * * * cd /chemin/workers && node tools/sauvegarde.mjs --remote
```

**Ce qui sort :** `autocare-2026-09-06T02-00-00.sql.gz` et son
manifeste `.json` — empreinte SHA-256, taille, nombre de tables.

**Réglages** (variables d'environnement) :

| | Défaut | |
|---|---|---|
| `BACKUP_DIR` | `workers/storage/sauvegardes` | où écrire |
| `BACKUP_KEEP` | `14` | combien d'archives garder |

### Ce que la sauvegarde refuse de faire

- **Écrire dans un dossier suivi par Git.** Une archive, c'est toute
  la base en clair : clients, chiffre d'affaires, empreintes de mots
  de passe. Un seul `git add -A` la publierait. Le script s'arrête et
  indique la ligne à ajouter à `.gitignore`.
- **Garder un export minuscule** (moins de 1 ko) ou **incomplet**
  (moins de 20 tables). Une sauvegarde silencieusement tronquée
  ressemble à une bonne sauvegarde jusqu'au jour où on en a besoin.

---

## 3. Restaurer

```bash
node tools/restauration.mjs --list              # ce qu'on a sous la main
node tools/restauration.mjs --latest --local    # la plus récente
node tools/restauration.mjs autocare-2026-09-06T02-00-00 --local
```

**Sur la production, il faut le dire deux fois :**

```bash
node tools/restauration.mjs --latest --remote --je-sais-ce-que-je-fais
```

### L'ordre des vérifications compte

1. **L'empreinte, avant de toucher à quoi que ce soit.** Une archive
   abîmée restaurée par-dessus des données vivantes, c'est deux pertes
   au lieu d'une.
2. Le nombre de tables annoncé par le manifeste.
3. Le garde-fou de production.
4. **Puis seulement** : vider la base, restaurer, recompter.

---

## 4. Deux pièges de D1 que `mysqldump` n'avait pas

Les deux ont été trouvés en exécutant la restauration, pas en la
relisant. Ils sont corrigés dans l'outil ; ils sont écrits ici parce
qu'ils se reposeront à qui restaurera à la main.

### 4.1 L'export ne contient pas de `DROP TABLE`

`mysqldump` écrit `DROP TABLE IF EXISTS` devant chaque `CREATE`.
L'export de D1, non. Rejouer une archive sur une base qui contient
déjà ces tables échoue :

```
UNIQUE constraint failed: d1_migrations.id
```

**La restauration vide donc la base d'abord** — et c'est ce qui la
rend dangereuse, d'où les garde-fous.

Mais **l'ordre des suppressions n'est pas libre** : SQLite refuse de
supprimer une table dont une clé étrangère pointe vers une table déjà
supprimée.

```
no such table: main.organizations
```

`PRAGMA defer_foreign_keys` ne sauve pas : il diffère la vérification
des **lignes**, pas la résolution des **noms**. L'outil supprime donc
les enfants avant leurs parents, en lisant le graphe dans le schéma
de la base — `pragma_foreign_key_list` n'étant pas autorisée sur D1,
il est extrait du texte des `CREATE TABLE`.

### 4.2 L'export n'est pas rejouable dans son propre ordre

D1 écrit les tables **par ordre alphabétique**. `payments` arrive donc
avant `subscriptions`, qu'elle référence :

```
no such table: main.subscriptions
```

L'outil réordonne les seuls blocs `CREATE TABLE`, parents avant
enfants. Le reste — index, déclencheurs, `INSERT` — garde sa place et
son ordre. Le fichier n'est **pas** découpé en instructions : les
corps de déclencheurs contiennent des points-virgules, et un
découpage naïf les couperait en deux.

---

## 5. Le contrôle avant vol

```bash
node tools/avant-vol.mjs            # hors ligne
node tools/avant-vol.mjs --remote   # avec la base de production
```

Il sort en erreur sur un point **BLOQUANT**, ce qui permet de le
placer dans le script de déploiement : la mise en ligne s'arrête
plutôt que de partir avec un secret d'exemple.

**Ce qu'il refuse :** un `database_id` resté à sa valeur d'exemple, un
secret écrit dans `wrangler.toml` (fichier suivi par Git, donc secret
public), un `.dev.vars` ou une archive suivis par Git, et — avec
`--remote` — le jeu de démonstration resté en base ou un mot de passe
non haché.

**Ce qu'il refuse de prétendre :** l'envoi de courriel n'est pas
vérifiable hors ligne. `MAIL_ENDPOINT` et `MAIL_TOKEN` sont des
secrets Wrangler ; la présence d'un `.dev.vars` ne prouve rien. Le
contrôle est donc annoncé « non vérifiable » plutôt que « ok » — une
fausse assurance est pire que pas de contrôle.

---

## 6. La copie hors de chez Cloudflare

`deploy/backup-offsite.sh` reste valable : seule la source change.

```bash
BACKUP_DIR=/chemin/workers/storage/sauvegardes ./deploy/backup-offsite.sh
```

> Une sauvegarde qui reste chez Cloudflare ne protège pas d'un compte
> perdu.

---

## 7. L'essai trimestriel

Le jour où l'on a réellement besoin d'une restauration est le pire
moment pour découvrir qu'une archive était tronquée.

```bash
node tools/sauvegarde.mjs --remote          # 1. une archive fraîche
node tools/restauration.mjs --latest --local  # 2. sur la base LOCALE
npm run test:workers                          # 3. la suite passe-t-elle ?
```

Trois commandes, un quart d'heure, une fois par trimestre. C'est le
seul moyen de savoir que la sauvegarde en est une.
