# Sécurité — AUTOCARE OS

La sécurité n'est pas un lot en fin de projet : c'est une contrainte
présente à chaque lot. Ce document liste les règles du projet et leur
état d'application.

---

## 1. Secrets

**Règle : aucun mot de passe, clé ou jeton dans le code source.**

Tout vit dans `backend/.env`, qui est exclu de Git dès le premier
commit. Seul `.env.example` est versionné, avec des valeurs vides.

Si un secret se retrouve un jour dans Git, le retirer ne suffit pas :
l'historique le conserve. **Il faut le considérer comme compromis et
le changer.**

✅ Appliqué au Lot 1.

---

## 2. Injection SQL

**Règle : jamais de valeur concaténée dans une requête SQL.**

```php
// INTERDIT — un utilisateur saisissant  ' OR 1=1 --  lit toute la table
$sql = "SELECT * FROM users WHERE email = '$email'";

// CORRECT — MySQL traite la valeur comme du texte, jamais comme du code
$statement = $pdo->prepare('SELECT * FROM users WHERE email = :email');
$statement->execute(['email' => $email]);
```

PDO est configuré avec `ATTR_EMULATE_PREPARES => false`, ce qui envoie
la requête et les valeurs **séparément** à MySQL. C'est ce qui rend
l'injection structurellement impossible.

✅ Configuré au Lot 1 · appliqué à partir du Lot 3.

---

## 3. Mots de passe

**Règle : jamais stockés en clair, ni chiffrés — hachés.**

```php
$hash = password_hash($plainPassword, PASSWORD_DEFAULT);
password_verify($plainPassword, $hash);
```

`password_hash()` produit un hachage lent et salé. Même avec la base
volée, un attaquant ne peut pas retrouver les mots de passe.

Ne jamais utiliser `md5()` ou `sha1()` : ils sont conçus pour être
rapides, donc faciles à casser par force brute.

🔜 Lot 4.

---

## 4. Authentification

- Jeton d'accès **JWT de courte durée** (30 min), gardé en mémoire par
  Angular.
- Jeton de rafraîchissement dans un cookie
  `httpOnly; Secure; SameSite=Strict`.

**Pourquoi pas le `localStorage` ?** Il est lisible par n'importe quel
JavaScript de la page. Une seule faille XSS et le compte est volé pour
toute la durée du jeton. Un cookie `httpOnly` est invisible au
JavaScript : même en cas de XSS, il ne peut pas être exfiltré.

🔜 Lot 4.

---

## 5. Autorisation

**Règle : une permission cachée dans Angular n'est pas une
permission.**

Masquer un bouton améliore l'expérience utilisateur, rien de plus.
N'importe qui peut appeler l'API directement avec `curl`.

**Chaque action sensible est donc vérifiée côté serveur**, à chaque
requête :

- l'utilisateur est-il authentifié ?
- son rôle l'autorise-t-il à cette action ?
- la ressource visée appartient-elle bien à **son** organisation ?

Ce troisième point est le plus souvent oublié, et le plus grave.

🔜 Lot 4.

---

## 6. Isolation entre entreprises

C'est le risque le plus grave d'un SaaS : qu'une entreprise voie les
données d'une autre.

Parade : aucun contrôleur n'écrit de SQL librement. Toutes les
lectures passent par une couche qui **injecte automatiquement**
`WHERE organization_id = ?`. On ne peut pas l'oublier puisqu'on n'a pas
la possibilité de l'écrire.

Des tests automatisés tenteront explicitement de lire les données
d'une autre organisation et vérifieront que l'API refuse.

🔜 Lot 4 — avant tout autre module.

---

## 7. Upload de photos

Les photos d'inspection ont une valeur de **preuve** en cas de litige.

- Stockées dans `backend/storage/uploads/`, **hors du dossier web** :
  aucune URL directe n'y donne accès. Un endpoint PHP vérifie les
  droits avant de servir le fichier.
- Le nom fourni par l'utilisateur n'est **jamais** utilisé (il peut
  contenir `../../` ou une extension piégée). On génère un nom
  aléatoire.
- Vérification du **type MIME réel** avec `finfo`, pas de l'extension :
  un fichier `.jpg` peut contenir du PHP.
- Taille et dimensions limitées.
- Photos **jamais supprimées**, seulement archivées : une preuve
  effaçable ne vaut rien.

🔜 Lot 7.

---

## 8. En-têtes HTTP

Posés par `public/index.php` sur **toutes** les réponses :

| En-tête | Rôle |
|---|---|
| `X-Content-Type-Options: nosniff` | Empêche le navigateur de « deviner » le type d'un fichier envoyé par un utilisateur |
| `X-Frame-Options: DENY` | Empêche l'affichage en iframe (clickjacking) |
| `Referrer-Policy: no-referrer` | Ne divulgue pas les URL internes aux sites tiers |
| `X-Powered-By` **retiré** | N'annonce pas la version de PHP aux attaquants |

✅ Appliqué au Lot 1.

---

## 9. Messages d'erreur

**Règle : ne jamais renvoyer une erreur technique brute au client.**

Un message PHP contient des chemins de fichiers, des noms de classes,
parfois des identifiants de base. En production (`APP_DEBUG=false`),
l'API renvoie un message neutre et journalise le détail côté serveur.

✅ Appliqué au Lot 1 (`index.php`, bloc « filet de sécurité »).

---

## 10. Journal d'audit

Toute action sensible est enregistrée dans `audit_logs` :
connexion, création et modification de véhicule, inspection,
changement de statut, paiement, **restitution**, changement de
permissions.

Chaque entrée contient : `user_id`, `station_id`, `action`,
`entity_type`, `entity_id`, `timestamp`, `metadata`.

C'est ce qui permet de répondre à « qui a fait quoi, et quand ? » —
la question centrale en cas de litige sur un véhicule.

🔜 Lot 4 (structure) · alimenté à chaque lot suivant.

---

## Récapitulatif

| Règle | État |
|---|---|
| Secrets hors de Git | ✅ Lot 1 |
| En-têtes de sécurité | ✅ Lot 1 |
| Erreurs non divulguées | ✅ Lot 1 |
| PDO sans émulation | ✅ Lot 1 |
| CORS restreint à une origine | ✅ Lot 1 |
| Hachage des mots de passe | 🔜 Lot 4 |
| Autorisation côté API | 🔜 Lot 4 |
| Isolation multi-tenant + tests | 🔜 Lot 4 |
| Journal d'audit | 🔜 Lot 4 |
| Upload sécurisé | 🔜 Lot 7 |
| Audit de sécurité complet | 🔜 Lot 21 |
