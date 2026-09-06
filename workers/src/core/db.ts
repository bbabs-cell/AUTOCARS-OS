/**
 * Accès aux données cloisonné par organisation
 * ==================================================================
 * LA GARANTIE QUE CETTE CLASSE EXISTE POUR TENIR
 *
 * Toutes les données métier appartiennent à une organisation. Si une
 * seule requête oublie de filtrer sur `organization_id`, un client
 * voit les véhicules — ou les recettes — d'un autre. C'est la faute la
 * plus grave que ce produit puisse commettre, et c'est une faute
 * d'inattention : il suffit d'un `WHERE` oublié un vendredi soir.
 *
 * La parade n'est pas la vigilance, c'est de rendre l'oubli
 * IMPOSSIBLE. En PHP, `TenantRepository` injectait le filtre lui-même
 * et aucun contrôleur ne pouvait s'en passer. Même principe ici :
 *
 *   - `TenantDb` ne s'obtient qu'à partir d'un utilisateur authentifié
 *   - `select()` ajoute le filtre, l'appelant ne l'écrit jamais
 *   - le paramètre lié n'est pas exposé : on ne peut pas le contourner
 *
 * Écrire une requête cloisonnée est ainsi plus court que d'en écrire
 * une qui ne l'est pas. C'est le seul mécanisme qui tienne dans la
 * durée : celui où la voie correcte est aussi la voie facile.
 *
 * ------------------------------------------------------------------
 * ET QUAND IL FAUT VRAIMENT SORTIR DU CADRE ?
 *
 * `sansCloisonnement()` existe, porte un nom qui se remarque en
 * relecture, et ne sert qu'à deux choses : la connexion (on cherche un
 * utilisateur avant de savoir à quelle organisation il appartient) et
 * la table `organizations` elle-même, qui EST le client.
 */

export class TenantDb {
  private constructor(
    private readonly db: D1Database,
    public readonly organizationId: number,
  ) {}

  static pour(db: D1Database, organizationId: number): TenantDb {
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new Error(
        "TenantDb exige un identifiant d'organisation valide : " +
          'sans lui, la requête ne serait pas cloisonnée.',
      );
    }

    return new TenantDb(db, organizationId);
  }

  /**
   * Prépare une requête en injectant le filtre d'organisation.
   *
   * `sql` DOIT contenir le marqueur `{ORG}` à l'endroit où la
   * condition doit s'insérer — typiquement
   * `WHERE {ORG} AND plate_number = ?`.
   *
   * Le marqueur absent est une ERREUR, pas un cas toléré : une requête
   * métier sans cloisonnement est un défaut, et elle échoue ici plutôt
   * que de fuir des données en production.
   */
  select(sql: string, ...parametres: unknown[]): D1PreparedStatement {
    if (!sql.includes('{ORG}')) {
      throw new Error(
        'Requête sans cloisonnement : le marqueur {ORG} est absent de « ' +
          sql.slice(0, 60) +
          ' ». Utilisez sansCloisonnement() si c\'est délibéré.',
      );
    }

    // ON INSÈRE L'ORGANISATION À SA VRAIE POSITION.
    //
    // La première version liait toujours l'organisation en PREMIER.
    // Cela fonctionnait pour un SELECT, où le marqueur {ORG} précède
    // tout autre `?`. Mais dans
    //
    //     UPDATE operations SET status = ? WHERE {ORG} AND id = ?
    //
    // le `?` de `SET status` vient AVANT : l'organisation partait
    // dans la colonne `status`, et la mise à jour ne touchait aucune
    // ligne. Sans erreur — juste une opération qui ne bougeait pas.
    //
    // Le défaut n'est apparu qu'à la première écriture, à l'étape 4.
    // On compte donc les paramètres qui précèdent le marqueur et on
    // glisse l'organisation à cet endroit précis.
    //
    // ------------------------------------------------------------------
    // ET AUTANT DE FOIS QUE LE MARQUEUR APPARAÎT.
    //
    // Une requête peut porter DEUX ensembles cloisonnés — « les
    // clients venus pendant la période » et « ceux venus avant » se
    // calculent séparément avant d'être rapprochés. Le remplacement du
    // texte les traitait déjà tous les deux ; la liaison, non : deux
    // `?` apparaissaient et une seule valeur était fournie.
    //
    // Selon la requête, D1 aurait refusé — ou pire, décalé les
    // paramètres suivants d'un cran et rendu des chiffres faux sans
    // rien signaler. C'est exactement la faute que cette classe existe
    // pour rendre impossible, et elle était possible ici.
    const morceaux = sql.split('{ORG}');
    const lies = [...parametres];
    let decalage = 0;

    // De la GAUCHE vers la droite, en tenant un décalage : chaque
    // organisation insérée pousse d'un cran les positions suivantes.
    for (let i = 0; i < morceaux.length - 1; i += 1) {
      const avant = (morceaux.slice(0, i + 1).join('').match(/\?/g) ?? []).length;

      lies.splice(avant + decalage, 0, this.organizationId);
      decalage += 1;
    }

    return this.db.prepare(sql.replaceAll('{ORG}', 'organization_id = ?')).bind(...lies);
  }

  /**
   * Sortie explicite du cloisonnement. Le nom est long exprès : il
   * doit sauter aux yeux en relecture de code.
   */
  static sansCloisonnement(db: D1Database, sql: string, ...parametres: unknown[]): D1PreparedStatement {
    return db.prepare(sql).bind(...parametres);
  }
}
