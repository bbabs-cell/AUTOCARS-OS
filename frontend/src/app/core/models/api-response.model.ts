/**
 * Contrat de reponse de l'API AUTOCARE OS
 * ------------------------------------------------------------------
 * Le backend PHP repond TOUJOURS avec cette structure
 * (voir backend/src/Core/Response.php et docs/api.md).
 *
 * Decrire ce contrat en TypeScript nous donne deux choses :
 *   1. l'autocompletion dans l'editeur ;
 *   2. une erreur a la compilation si le frontend et le backend
 *      cessent d'etre d'accord.
 *
 * Le <T> est un "generique" : il permet de reutiliser ce meme type
 * pour n'importe quelle donnee.
 *   ApiResponse<Vehicle>   -> data est un vehicule
 *   ApiResponse<Vehicle[]> -> data est une liste de vehicules
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
}

/**
 * Structure renvoyee par l'API en cas d'erreur.
 * `errors` detaille le probleme champ par champ, par exemple :
 *   { "email": "Cette adresse est deja utilisee." }
 */
export interface ApiError {
  success: false;
  message: string;
  errors: Record<string, string>;
}
