import { compressPhoto, formatBytes } from './image-compressor';

/**
 * Tests de la compression avant envoi
 * ------------------------------------------------------------------
 * Le point vraiment important est le COMPORTEMENT DE REPLI : si le
 * navigateur ne sait pas décoder l'image, la fonction doit renvoyer
 * le fichier d'origine, jamais lever une erreur.
 *
 * Pourquoi ? Parce qu'une exception ici ferait échouer l'envoi de la
 * photo — et une inspection sans photo ne protège personne. Mieux
 * vaut un envoi lent qu'une preuve manquante.
 */
describe('image-compressor', () => {
  describe('formatBytes', () => {
    it('affiche les petits fichiers en octets', () => {
      expect(formatBytes(512)).toBe('512 o');
    });

    it('bascule en kilooctets', () => {
      expect(formatBytes(2048)).toBe('2 ko');
    });

    it('bascule en mégaoctets avec une décimale et une virgule', () => {
      // Virgule et non point : c'est la convention française, et
      // « 3.4 Mo » se lit mal pour un utilisateur francophone.
      expect(formatBytes(3_565_158)).toBe('3,4 Mo');
    });
  });

  describe('compressPhoto', () => {
    it("renvoie le fichier d'origine quand l'image n'est pas décodable", async () => {
      // Un fichier texte déguisé : createImageBitmap va échouer.
      const file = new File(['ceci n est pas une image'], 'faux.jpg', { type: 'image/jpeg' });

      const result = await compressPhoto(file);

      expect(result.blob).toBe(file);
      expect(result.originalSize).toBe(file.size);
    });
  });
});
