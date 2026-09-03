<?php

declare(strict_types=1);

namespace Autocare\Core;

use RuntimeException;

/**
 * Stockage sécurisé des photos d'inspection
 * ==================================================================
 * LE FICHIER LE PLUS SENSIBLE DU PROJET.
 * ==================================================================
 *
 * Accepter un fichier envoyé par un utilisateur est l'une des
 * opérations les plus dangereuses d'une application web. Un fichier
 * mal traité, c'est un serveur compromis.
 *
 * SIX PROTECTIONS, APPLIQUÉES DANS CET ORDRE :
 *
 * 1. On vérifie que le fichier vient bien d'un envoi HTTP
 *    (is_uploaded_file), et non d'un chemin fabriqué.
 *
 * 2. On lit le TYPE RÉEL du fichier avec finfo, jamais son extension.
 *    Renommer « payload.php » en « photo.jpg » ne trompe personne :
 *    finfo lit les premiers octets du contenu.
 *
 * 3. On vérifie la taille AVANT toute manipulation. Une image de
 *    50 000 × 50 000 pixels tient dans quelques kilo-octets
 *    compressés mais demande des gigaoctets de mémoire à décoder :
 *    c'est la « bombe de décompression ».
 *
 * 4. ON RÉ-ENCODE L'IMAGE. C'est la protection la plus forte.
 *    Une image peut contenir du code PHP caché dans ses métadonnées.
 *    Décoder les pixels puis les réécrire dans un fichier neuf
 *    détruit tout ce qui n'est pas de l'image. Rien ne survit.
 *
 * 5. Le nom du fichier est GÉNÉRÉ, jamais celui fourni. Celui de
 *    l'utilisateur peut contenir « ../../ » pour sortir du dossier,
 *    ou une double extension « .jpg.php ».
 *
 * 6. Le fichier est écrit HORS du dossier web. Aucune URL n'y donne
 *    accès : un contrôleur vérifie les droits avant de le servir.
 *
 * ------------------------------------------------------------------
 * POURQUOI CONVERTIR EN WEBP ?
 * Une photo de téléphone fait 3 à 5 Mo. Cinq par inspection, sur une
 * connexion mobile sénégalaise, c'est plusieurs minutes d'attente —
 * et un employé qui abandonne la procédure. Le WebP divise le poids
 * par quatre à qualité visuelle équivalente, et reste amplement
 * suffisant pour constater une rayure.
 */
final class PhotoStorage
{
    /** 12 Mo : une photo de téléphone moderne dépasse rarement 8 Mo. */
    private const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

    /**
     * Garde-fou contre les bombes de décompression : au-delà, on
     * refuse de décoder plutôt que de saturer la mémoire du serveur.
     */
    private const MAX_PIXELS = 50_000_000;

    /**
     * 2048 px sur le plus grand côté. Assez pour distinguer une
     * rayure de dix centimètres, quatre fois plus léger qu'une photo
     * brute de téléphone.
     */
    private const MAX_DIMENSION = 2048;

    private const WEBP_QUALITY = 82;

    /** Types réellement acceptés, détectés par le contenu. */
    private const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    /**
     * Enregistre une photo envoyée et retourne ses métadonnées.
     *
     * @param array{tmp_name?:string, size?:int, error?:int, name?:string} $uploaded
     *        Une entrée de $_FILES
     *
     * @return array{path:string, hash:string, mime:string, size:int, width:int, height:int}
     *
     * @throws RuntimeException Message destiné à l'utilisateur
     */
    public static function store(array $uploaded): array
    {
        // --- 1. L'envoi s'est-il bien passé ? -----------------------
        $error = $uploaded['error'] ?? UPLOAD_ERR_NO_FILE;

        if ($error !== UPLOAD_ERR_OK) {
            throw new RuntimeException(self::describeUploadError((int) $error));
        }

        $temporaryPath = $uploaded['tmp_name'] ?? '';

        // is_uploaded_file garantit que le chemin correspond bien à un
        // fichier déposé par PHP lors de cette requête. Sans cette
        // vérification, un contrôleur boguée pourrait être amené à
        // lire /etc/passwd.
        if ($temporaryPath === '' || !is_uploaded_file($temporaryPath)) {
            throw new RuntimeException("Fichier invalide.");
        }

        // --- 2. Taille ---------------------------------------------
        $size = (int) ($uploaded['size'] ?? 0);

        if ($size <= 0) {
            throw new RuntimeException('Le fichier est vide.');
        }

        if ($size > self::MAX_UPLOAD_BYTES) {
            $limit = (int) (self::MAX_UPLOAD_BYTES / 1024 / 1024);

            throw new RuntimeException("La photo dépasse {$limit} Mo.");
        }

        // --- 3. Type réel, lu dans le contenu ----------------------
        $finfo = finfo_open(FILEINFO_MIME_TYPE);

        if ($finfo === false) {
            throw new RuntimeException('Impossible de vérifier le fichier.');
        }

        $mimeType = finfo_file($finfo, $temporaryPath);
        finfo_close($finfo);

        if (!is_string($mimeType) || !in_array($mimeType, self::ALLOWED_TYPES, true)) {
            throw new RuntimeException(
                'Seules les images JPEG, PNG et WebP sont acceptées.'
            );
        }

        // --- 4. Dimensions, avant de décoder -----------------------
        $dimensions = getimagesize($temporaryPath);

        if ($dimensions === false) {
            throw new RuntimeException("Ce fichier n'est pas une image lisible.");
        }

        [$width, $height] = $dimensions;

        if ($width * $height > self::MAX_PIXELS) {
            throw new RuntimeException('Cette image est trop grande pour être traitée.');
        }

        // --- 5. Décodage puis ré-encodage --------------------------
        $image = self::decode($temporaryPath, $mimeType);

        try {
            // L'orientation doit être appliquée AVANT le ré-encodage :
            // les métadonnées EXIF qui la portent seront détruites, et
            // sans cela les photos prises en tenant le téléphone de
            // travers apparaîtraient couchées.
            if ($mimeType === 'image/jpeg') {
                $image = self::applyExifOrientation($image, $temporaryPath);
            }

            $image = self::resizeIfNeeded($image);

            $finalWidth  = imagesx($image);
            $finalHeight = imagesy($image);

            // --- 6. Écriture sous un nom généré, hors du web -------
            $relativePath = date('Y/m') . '/' . bin2hex(random_bytes(16)) . '.webp';
            $absolutePath = self::uploadRoot() . '/' . $relativePath;

            $directory = dirname($absolutePath);

            if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
                throw new RuntimeException("Impossible de créer le dossier de stockage.");
            }

            if (!imagewebp($image, $absolutePath, self::WEBP_QUALITY)) {
                throw new RuntimeException("L'enregistrement de la photo a échoué.");
            }
        } finally {
            imagedestroy($image);
        }

        // L'empreinte porte sur le fichier FINAL, celui qui est sur le
        // disque. Si quelqu'un le remplace plus tard, l'empreinte ne
        // correspondra plus et la substitution devient détectable.
        $hash = hash_file('sha256', $absolutePath);

        return [
            'path'   => $relativePath,
            'hash'   => $hash === false ? '' : $hash,
            'mime'   => 'image/webp',
            'size'   => (int) filesize($absolutePath),
            'width'  => $finalWidth,
            'height' => $finalHeight,
        ];
    }

    /**
     * Chemin absolu d'une photo stockée.
     * Le chemin relatif vient de la base ; on refuse tout ce qui
     * pourrait sortir du dossier de stockage.
     */
    public static function absolutePath(string $relativePath): string
    {
        // « ../ » dans un chemin venu de la base ne devrait jamais
        // arriver — mais on ne parie pas là-dessus.
        if (str_contains($relativePath, '..') || str_starts_with($relativePath, '/')) {
            throw new RuntimeException('Chemin de photo invalide.');
        }

        return self::uploadRoot() . '/' . $relativePath;
    }

    /**
     * Le fichier correspond-il toujours à son empreinte ?
     * Répond à « cette photo a-t-elle été remplacée depuis
     * l'inspection ? », question décisive en cas de litige.
     */
    public static function verifyIntegrity(string $relativePath, string $expectedHash): bool
    {
        $absolutePath = self::absolutePath($relativePath);

        if (!is_file($absolutePath)) {
            return false;
        }

        $actual = hash_file('sha256', $absolutePath);

        // hash_equals compare en temps constant : la durée de la
        // comparaison ne révèle rien sur la valeur attendue.
        return $actual !== false && hash_equals($expectedHash, $actual);
    }

    // ==================================================================

    private static function uploadRoot(): string
    {
        return dirname(__DIR__, 2) . '/storage/uploads';
    }

    /** @return \GdImage */
    private static function decode(string $path, string $mimeType)
    {
        $image = match ($mimeType) {
            'image/jpeg' => @imagecreatefromjpeg($path),
            'image/png'  => @imagecreatefrompng($path),
            'image/webp' => @imagecreatefromwebp($path),
            default      => false,
        };

        if ($image === false) {
            // Le fichier annonçait un type d'image mais n'a pas pu
            // être décodé : soit il est corrompu, soit il est piégé.
            // Dans les deux cas, on s'arrête.
            throw new RuntimeException("Cette image n'a pas pu être lue.");
        }

        return $image;
    }

    /**
     * Redresse une photo selon son orientation EXIF.
     *
     * Un téléphone n'enregistre pas l'image tournée : il note dans les
     * métadonnées comment l'afficher. Comme le ré-encodage détruit ces
     * métadonnées, il faut appliquer la rotation d'abord — sinon les
     * photos prises à la verticale s'afficheraient couchées.
     *
     * @param \GdImage $image
     * @return \GdImage
     */
    private static function applyExifOrientation($image, string $path)
    {
        if (!function_exists('exif_read_data')) {
            return $image;
        }

        $exif = @exif_read_data($path);

        if ($exif === false || !isset($exif['Orientation'])) {
            return $image;
        }

        $rotation = match ((int) $exif['Orientation']) {
            3 => 180,
            6 => -90,
            8 => 90,
            default => 0,
        };

        if ($rotation === 0) {
            return $image;
        }

        $rotated = imagerotate($image, $rotation, 0);

        if ($rotated === false) {
            return $image;
        }

        imagedestroy($image);

        return $rotated;
    }

    /**
     * @param \GdImage $image
     * @return \GdImage
     */
    private static function resizeIfNeeded($image)
    {
        $width  = imagesx($image);
        $height = imagesy($image);
        $longest = max($width, $height);

        if ($longest <= self::MAX_DIMENSION) {
            return $image;
        }

        $ratio     = self::MAX_DIMENSION / $longest;
        $newWidth  = (int) round($width * $ratio);
        $newHeight = (int) round($height * $ratio);

        // imagescale utilise un rééchantillonnage de qualité : une
        // réduction brutale rendrait les petites rayures invisibles,
        // ce qui viderait la photo de son intérêt.
        $resized = imagescale($image, $newWidth, $newHeight, IMG_BICUBIC);

        if ($resized === false) {
            return $image;
        }

        imagedestroy($image);

        return $resized;
    }

    private static function describeUploadError(int $code): string
    {
        return match ($code) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'La photo est trop volumineuse.',
            UPLOAD_ERR_PARTIAL => "L'envoi a été interrompu. Réessayez.",
            UPLOAD_ERR_NO_FILE => 'Aucune photo reçue.',
            UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE => "Le serveur n'a pas pu enregistrer la photo.",
            default => "L'envoi de la photo a échoué.",
        };
    }
}
