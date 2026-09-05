# Audit de sécurité — AUTOCARE OS

> Lot 21. Réalisé sur la branche de développement, contre une API
> réellement démarrée, avec des comptes et des données de test.

---

## 0. Un avertissement, d'abord

**Cet audit a été mené par l'auteur du code.** C'est la forme la plus
faible qui soit : on ne trouve pas facilement les défauts qu'on n'a
pas su éviter, parce qu'on les cherche avec la même façon de penser
qui les a produits.

Il a une valeur réelle — il a trouvé trois défauts et corrigé une
mauvaise interaction entre deux mécanismes — et il ne remplace pas une
relecture extérieure. **Avant qu'une vraie station y mette de vraies
données clients**, une paire d'yeux qui n'a jamais vu ce dépôt devrait
refaire ce travail.

Ce document est écrit pour lui faciliter la tâche : il dit ce qui a
été essayé, ce qui a été trouvé, et surtout **ce qui n'a pas été
regardé**.

---

## 1. Méthode

L'audit n'a pas relu le code en cherchant des motifs suspects. Il a
**attaqué l'API démarrée** — c'est la différence entre « ce code me
paraît juste » et « cette requête est refusée ».

La distinction a compté : la première version de la limitation de
débit écrite pendant cet audit était **inerte**. Le code était
correct, la donnée qu'il interrogeait n'existait pas. Elle aurait
passé toutes les relectures et tous les tests écrits en lisant le
code ; elle a échoué au premier essai réel.

### Ce qui a été essayé

| Surface | Essais |
|---|---|
| Jetons | Signature falsifiée, `alg: none`, jeton expiré, jeton d'une autre entreprise, jeton d'un compte désactivé, rejeu d'un jeton de session |
| Autorisation | Un employé qui se promeut, un employé sur les routes de caisse, un manager sur les routes de propriétaire |
| Isolation | Lecture, écriture, suppression, photos, stations, dossiers d'une autre entreprise |
| Formulaires | `organization_id`, `id`, `status`, `slug`, `currency_code` envoyés là où ils ne sont pas attendus |
| Injection | Charges SQL dans les recherches et les filtres ; contenu HTML stocké puis relu |
| Envoi | Débit sur la connexion et sur « mot de passe oublié » ; énumération de comptes |
| Transport | En-têtes de sécurité, drapeaux du cookie de session, mise en cache |
| Fichiers | Type réel, extension double, taille, dimensions, accès croisé aux photos |

### Ce qui n'a **pas** été regardé

- **Le déploiement.** HTTPS, HSTS, la configuration du serveur web,
  les droits sur les fichiers, la sauvegarde chiffrée : tout cela
  dépend de l'hébergement, qui n'est pas choisi. C'est le lot 22.
- **Les dépendances.** Le produit n'en a qu'une côté serveur
  (`firebase/php-jwt`) et l'écosystème Angular côté navigateur.
  Aucune analyse de vulnérabilités connues n'a été lancée.
- **Le déni de service.** Aucune limite globale de débit, aucune
  protection contre l'épuisement de ressources. Cela se traite au
  niveau du serveur web ou d'un service en amont, pas dans le code.
- **La sécurité physique du poste.** Un comptoir avec une session
  ouverte et personne devant reste un comptoir ouvert.

---

## 2. Ce qui a été trouvé

| # | Défaut | Gravité | État |
|---|---|---|---|
| 1 | Les réponses authentifiées se mettaient en cache | **Moyenne** | Corrigé |
| 2 | « Mot de passe oublié » sans limitation de débit | **Moyenne** | Corrigé |
| 3 | Un jeton de session rejoué ne fermait que lui-même | **Faible** | Corrigé |
| 4 | Renouvellements de session concurrents (déconnexions) | **Faible** | Corrigé — condition du n° 3 |
| 5 | Énumération de comptes à l'inscription | **Faible** | **Accepté**, voir §4 |

---

### N° 1 — Les réponses authentifiées se mettaient en cache

**Gravité : moyenne. Corrigé.**

Aucune réponse de l'API ne portait d'en-tête de cache. La liste des
clients, la recette du jour, le registre de pointage pouvaient donc
être écrits dans le cache disque du navigateur — et un mandataire
intermédiaire avait le droit de les garder aussi.

Le contexte rend le défaut concret : **le poste d'un comptoir est
partagé**. L'employé du matin se déconnecte, celui de l'après-midi
s'assied, et les pages consultées restent récupérables dans le cache
du navigateur. Aucune faille d'authentification n'est nécessaire.

**Correction.** `Cache-Control: no-store` et `Pragma: no-cache` sur
toutes les réponses de l'API, posés dans le contrôleur d'entrée.
`no-store` plutôt que `no-cache` : le second autorise à garder la
réponse à condition de la revalider, le premier interdit de l'écrire.

**Une exception, voulue.** Les photos d'inspection gardent
`Cache-Control: private, max-age=3600` : elles restent dans le
navigateur de l'employé, jamais dans un cache partagé, et les
recharger à chaque ouverture d'un dossier coûterait cher sur une
connexion lente.

---

### N° 2 — « Mot de passe oublié » sans limitation de débit

**Gravité : moyenne. Corrigé.**

La connexion était limitée depuis le lot 4 — cinq échecs par quart
d'heure. Cette route ne l'était pas. Six appels de suite fabriquaient
**six jetons de réinitialisation valides** et envoyaient six messages.

Trois conséquences, de la plus visible à la plus grave :

1. on inonde la boîte de quelqu'un dont on connaît l'adresse, sans
   même avoir de compte sur le produit ;
2. `password_resets` grossit sans limite ;
3. surtout, **chaque appel crée un jeton valable une heure**.
   Multiplier les jetons vivants multiplie les occasions qu'un seul
   fuite — par un journal, une capture d'écran, une boîte mail
   partagée.

**Correction.** Trois demandes par quart d'heure et par adresse.

**Le refus est silencieux, et c'est le point essentiel.** Répondre
« trop de demandes » distinguerait une adresse connue d'une adresse
inconnue — exactement l'énumération que la réponse unique de cette
route existe pour empêcher. Même code, même phrase, dans tous les cas.

> **La première version de cette correction ne faisait rien.**
> Le compteur cherchait l'adresse dans les métadonnées du journal
> d'audit ; l'écriture correspondante n'en enregistrait aucune. Le
> compte était donc toujours zéro, et la limite ne se déclenchait
> jamais. Le code était juste, la donnée qu'il interrogeait n'existait
> pas. Seul l'essai réel l'a montré.

---

### N° 3 — Un jeton de session rejoué ne fermait que lui-même

**Gravité : faible. Corrigé.**

Le produit applique une **rotation** : un jeton de rafraîchissement ne
sert qu'une fois, et le présenter une seconde fois échoue. C'est une
bonne protection, et elle fonctionnait.

Ce qu'elle ne faisait pas : **en tirer la conclusion**. Si un jeton
déjà consommé réapparaît, le porteur légitime a forcément reçu le
suivant lors de la rotation. Celui qui présente celui-ci en a donc une
copie. Le produit répondait « session expirée » et laissait la session
du voleur — ou celle de la victime — continuer.

**Correction.** Un jeton révoqué qui revient ferme **toutes** les
sessions du compte, et la tentative est tracée nominativement. On ne
peut pas savoir lequel des deux porteurs est l'imposteur : on ferme
tout, et l'utilisateur légitime se reconnecte.

---

### N° 4 — Renouvellements de session concurrents

**Gravité : faible (disponibilité). Corrigé — et c'était la condition
du n° 3.**

Ce défaut n'a pas été trouvé en attaquant, mais en réfléchissant à la
correction du précédent : **la livrer seule aurait été nuisible.**

Le tableau de bord lance une quinzaine de requêtes en parallèle. Quand
le jeton d'accès expire pendant cette rafale, elles répondent toutes
401 en même temps, et l'intercepteur du navigateur demandait autant de
renouvellements. La première rotation réussissait, les suivantes
présentaient un jeton déjà consommé — et depuis le lot 18, un
renouvellement échoué renvoie à l'écran de connexion.

Autrement dit : **toutes les trente minutes, l'utilisateur pouvait
être déconnecté au milieu de son travail**, d'autant plus sûrement que
l'écran ouvert chargeait beaucoup de données. Ajouter la fermeture de
toutes les sessions par-dessus aurait transformé cette gêne en panne
quotidienne.

**Correction.** Les renouvellements simultanés partagent désormais une
seule requête. Une rotation, un jeton consommé, tout le monde reçoit
le même résultat.

---

## 3. Ce qui a été vérifié sans rien trouver

Ces contrôles n'ont rien corrigé. Ils sont écrits en tests pour que la
prochaine relecture n'ait pas à les refaire, et pour qu'une régression
les rallume.

| Vérification | Résultat |
|---|---|
| `organization_id` et `id` envoyés dans un formulaire | Ignorés — la couche d'accès les retire avant l'écriture |
| Un employé qui se promeut administrateur | 403 |
| Le jeton d'un compte désactivé | 401 à la requête suivante, pas à l'expiration du jeton |
| Lecture, écriture, photos d'une autre entreprise | 404 — indistinguable de « n'existe pas » |
| Charges d'injection SQL dans les recherches | Aucun effet : requêtes préparées natives, sans émulation |
| Contenu HTML stocké | Renvoyé tel quel par l'API, échappé par Angular à l'affichage. Aucun `innerHTML` ni `bypassSecurityTrust` dans tout le frontend |
| En-têtes `nosniff`, `X-Frame-Options`, `Referrer-Policy` | Présents |
| Version de PHP annoncée | Retirée |
| Cookie de session | `HttpOnly`, `SameSite=Strict`, chemin restreint à `/api/auth`, `Secure` hors développement |
| Journal d'audit | Aucun mot de passe, aucun jeton, aucune donnée de carte |
| Envoi de photos | Type réel lu dans le contenu, taille et dimensions bornées, **image ré-encodée** — ce qui détruit toute charge cachée |

> **Une fausse alerte, pour mémoire.** La charge `x' OR '1'='1`
> renvoyait une ligne. Ce n'était pas une injection : la recherche
> extrait les chiffres du terme pour chercher un numéro de téléphone,
> et « 11 » correspondait à un numéro contenant 11. Un audit qui
> s'arrête à « la charge a renvoyé quelque chose » crie au loup.

---

## 4. Risque accepté : l'énumération de comptes à l'inscription

`POST /api/auth/register` répond « Cette adresse e-mail est déjà
utilisée. » On peut donc savoir si une adresse a un compte.

C'est une **incohérence réelle** : « mot de passe oublié » se donne du
mal pour ne rien révéler, et l'inscription le dit franchement.

**Il est accepté, pour trois raisons.**

1. Le cacher rendrait l'inscription pénible : quelqu'un qui a déjà un
   compte se verrait répondre « vérifiez votre boîte mail » et
   attendrait un message qui ne l'aide pas.
2. Les comptes sont des **entreprises**, pas des particuliers. Savoir
   que « contact@ma-station.sn » a un compte AUTOCARE OS n'apprend
   rien de sensible sur une personne.
3. Une adresse professionnelle est rarement secrète.

**Ce qui le rendrait inacceptable** : le jour où le produit ouvrira un
compte au client final d'une station — là, savoir si le numéro de
quelqu'un est enregistré devient une information sur une personne.
La décision serait à reprendre.

---

## 5. Ce qui reste, et pour quel lot

| Sujet | Pourquoi ce n'est pas ici | Lot |
|---|---|---|
| HTTPS, HSTS, redirection | Dépend de l'hébergement, non choisi | 22 |
| `Content-Security-Policy` | Se règle sur le serveur qui sert l'application, pas sur l'API | 22 |
| Sauvegarde chiffrée, restauration | Dépend de l'hébergement | 22 |
| Analyse des dépendances | À brancher sur l'intégration continue | 22 |
| Relecture par un tiers | **Avant les premières données réelles d'un client** | — |
| Limitation globale de débit | Se traite en amont de l'application | 22 |

Un point mérite d'être noté pour le lot 22 : le cookie de session
porte `Secure` dès que `APP_ENV` n'est pas `local`. C'est un défaut
**sûr** — il faut désigner explicitement le développement pour
l'assouplir, jamais l'inverse.

---

## 6. Ce que l'audit confirme

Trois décisions prises tôt ont tenu sous les essais, et méritent
d'être nommées parce qu'elles ont fait le travail :

**Le filtre d'isolation est dans l'infrastructure, pas dans les
contrôleurs.** Aucune requête ne peut l'oublier, parce qu'aucun
contrôleur n'a le pouvoir de le poser. Toutes les tentatives
inter-entreprises se heurtent au même mur, dans du code écrit une
seule fois.

**Le rôle est relu en base à chaque requête.** Un compte désactivé
perd l'accès à la seconde, pas à l'expiration de son jeton. La
requête supplémentaire est le prix d'une révocation immédiate.

**Les photos sont ré-encodées.** Le contrôle du type réel est bien ;
la ré-encodage est mieux : il ne vérifie pas que le fichier est une
image, il en **fabrique** une nouvelle.
