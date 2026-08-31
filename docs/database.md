# Base de données — AUTOCARE OS

> **État : conception.** Les tables seront créées au **Lot 3**.
> Ce document fixe dès maintenant les règles que toutes les tables
> devront respecter.

---

## Configuration

```sql
CREATE DATABASE autocare_os
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

`utf8mb4` est obligatoire : c'est ce qui permet de stocker les accents
français et les emojis. L'ancien `utf8` de MySQL est incomplet.

Moteur : **InnoDB** (le défaut en MySQL 8), seul à gérer les clés
étrangères et les transactions.

---

## Règles communes à toutes les tables

1. **Clé primaire** `id BIGINT UNSIGNED AUTO_INCREMENT`.
2. **`organization_id`** sur toute table métier — voir isolation
   ci-dessous.
3. **Horodatage** : `created_at` et `updated_at` (`TIMESTAMP`, en UTC).
4. **Clés étrangères** explicites, avec `ON DELETE` réfléchi
   (généralement `RESTRICT` : on ne supprime pas un client qui a un
   historique).
5. **Index** sur toute colonne servant à filtrer ou à joindre.
6. **Suppression logique** (`deleted_at`) sur les données à valeur de
   preuve : un véhicule ou une inspection ne se supprime pas.
7. **Montants en `BIGINT`**, jamais en `FLOAT` — le FCFA n'a pas de
   décimales et les flottants produisent des erreurs d'arrondi.

---

## Isolation des données — la règle la plus importante

AUTOCARE OS sert plusieurs entreprises depuis une seule base.

```
organizations
     └── stations
            └── station_users  (qui travaille où, avec quel rôle)
                   └── customers, vehicles, operations, payments…
```

**Toute requête métier doit filtrer sur `organization_id`.**

Une seule requête qui l'oublie expose les données d'une entreprise à
une autre. C'est pourquoi aucun contrôleur n'écrira de SQL librement :
tout passera par une couche qui ajoute le filtre automatiquement.

---

## Tables du MVP (Lot 3)

| Table | Rôle |
|---|---|
| `organizations` | L'entreprise cliente du SaaS |
| `users` | Comptes de connexion |
| `stations` | Les points de service |
| `station_users` | Affectation d'un utilisateur à une station + son rôle |
| `customers` | Les clients de la station |
| `vehicles` | Les véhicules, rattachés à un client |
| `services` | Les prestations proposées (lavage, detailing…) |
| `operations` | Un service réalisé sur un véhicule — **la table centrale** |
| `inspections` | État constaté d'un véhicule à son arrivée |
| `inspection_photos` | Photos associées à une inspection |
| `payments` | Encaissements |
| `audit_logs` | Journal des actions sensibles |

### Trois tables volontairement absentes

| Table écartée | Pourquoi |
|---|---|
| `queue` | La file d'attente n'est pas une entité mais une **vue** des opérations en cours. Une table séparée dupliquerait l'état et finirait par diverger. → un champ `priority` sur `operations` suffit. |
| `employees` | Un employé **est** un `user` rattaché à une station via `station_users`. On créera cette table le jour où il y aura des données RH réelles (contrat, horaires, salaire). |
| `roles` / `permissions` | Le rôle est un `ENUM('ADMIN','MANAGER','EMPLOYEE')` et la matrice de permissions vit dans un fichier PHP : lisible, testable, sans jointure. On passera en base le jour où un client voudra des rôles sur mesure. |

---

## Machine à états des opérations

`operations` est la table centrale du produit. Son statut suit un
cycle **strict** — les transitions non listées seront refusées par
l'API :

```
WAITING ──► IN_PROGRESS ──► INSPECTION ──► WASHING
                                              │
                                              ▼
COMPLETED ◄── READY ◄── QUALITY_CHECK ────────┘

(CANCELLED est accessible depuis tout état non terminal)
```

**Pourquoi cette rigueur ?** Parce que la traçabilité est le cœur du
produit. Si on pouvait passer directement de `WAITING` à `COMPLETED`,
un véhicule serait rendu sans inspection ni contrôle — exactement le
litige que le produit doit empêcher. Chaque transition sera
journalisée dans `audit_logs` avec son auteur et son horodatage.

> Cette machine à états sera validée explicitement avant d'être codée.
