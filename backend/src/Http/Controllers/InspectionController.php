<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\OperationStatus;
use Autocare\Core\PhotoStorage;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Models\InspectionPhotoRepository;
use Autocare\Models\InspectionRepository;
use Autocare\Models\OperationRepository;
use RuntimeException;

/**
 * Les inspections : constater, photographier, prouver
 * ------------------------------------------------------------------
 * LE MODULE QUI JUSTIFIE LE PRODUIT.
 *
 * Un gérant de station accepte de changer ses habitudes pour une
 * seule raison : ne plus perdre d'argent sur les litiges. Tout ce qui
 * est écrit ici sert cet objectif — et rien d'autre.
 *
 * TROIS DÉCISIONS À COMPRENDRE :
 *
 * 1. UNE INSPECTION NE SE MODIFIE PAS.
 *    Il n'y a ni PUT ni DELETE sur ce module. Un constat qu'on peut
 *    réécrire après coup ne prouve rien : c'est justement au moment
 *    où le litige survient que quelqu'un voudrait le corriger.
 *    Une erreur de saisie se rattrape par une observation ajoutée à
 *    l'inspection de sortie, pas en réécrivant l'entrée.
 *
 * 2. LES PHOTOS S'ENVOIENT UNE PAR UNE.
 *    Cinq photos en un seul envoi, sur une connexion mobile qui
 *    coupe, c'est cinq photos perdues et un employé qui recommence.
 *    Une par une, chacune est acquise dès qu'elle est passée.
 *
 * 3. LES FICHIERS NE SONT PAS ACCESSIBLES PAR URL DIRECTE.
 *    Ils vivent hors du dossier web. La route de lecture vérifie
 *    l'organisation avant de servir le moindre octet — sans quoi
 *    l'adresse d'une photo, une fois devinée ou partagée, ouvrirait
 *    les preuves d'une autre entreprise.
 */
final class InspectionController
{
    /** Cinq prises de vue à l'arrivée, plus les gros plans. */
    private const MAX_PHOTOS_PER_INSPECTION = 12;

    /**
     * POST /api/operations/{id}/inspections
     * Enregistre l'état constaté d'un véhicule.
     */
    public function store(Request $request, string $operationId): void
    {
        $operationId = (int) $operationId;
        $operations  = new OperationRepository();
        $operation   = $operations->find($operationId);

        if ($operation === null) {
            Response::notFound("Ce dossier n'existe pas.");
        }

        $validator = Validator::make($request->body())
            ->required('type', 'Le type d\'inspection')
            ->in('type', ['ENTRY', 'EXIT'])
            ->in('fuel_level', ['EMPTY', 'QUARTER', 'HALF', 'THREE_QUARTERS', 'FULL'])
            ->maxLength('damage_notes', 2000)
            ->maxLength('items_left', 1000)
            ->maxLength('observations', 2000)
            ->maxLength('signature_name', 120);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $type = $validator->string('type');

        // Une seule inspection par type et par dossier : la contrainte
        // existe en base, on la vérifie ici pour renvoyer une phrase
        // compréhensible plutôt qu'une erreur SQL.
        $repository = new InspectionRepository();

        if ($repository->findForOperation($operationId, $type) !== null) {
            Response::error(
                $type === 'ENTRY'
                    ? "L'inspection d'entrée de ce dossier est déjà enregistrée. Un constat ne se réécrit pas."
                    : "L'inspection de sortie de ce dossier est déjà enregistrée.",
                [],
                409
            );
        }

        // Une inspection d'entrée se fait AVANT le lavage. Après, elle
        // ne constate plus l'état d'arrivée mais celui d'un véhicule
        // déjà manipulé : elle perdrait toute valeur de preuve.
        if ($type === 'ENTRY' && !in_array($operation['status'], ['WAITING', 'IN_PROGRESS', 'INSPECTION'], true)) {
            Response::error(
                'Le lavage a déjà commencé : une inspection d\'entrée enregistrée maintenant '
                . 'ne constaterait plus l\'état d\'arrivée du véhicule.',
                [],
                409
            );
        }

        $damageNotes = $validator->stringOrNull('damage_notes');
        $hasDamage   = $this->readBool($request->input('has_damage'));

        // Cocher « dommage constaté » sans le décrire ne sert à rien :
        // « il y avait une rayure » ne dit ni où, ni laquelle.
        if ($hasDamage && $damageNotes === null) {
            Response::validationFailed([
                'damage_notes' => 'Décrivez le dommage constaté : sans description, la photo seule ne prouve rien.',
            ]);
        }

        $mileage = $request->input('mileage');

        if ($mileage !== null && $mileage !== '' && (!is_numeric($mileage) || (int) $mileage < 0)) {
            Response::validationFailed(['mileage' => 'Le kilométrage doit être un nombre.']);
        }

        $customerPresent = $this->readBool($request->input('customer_present'));
        $signatureName   = $validator->stringOrNull('signature_name');

        // Le nom saisi VAUT ACCORD sur l'état constaté. S'il est
        // absent alors que le client est là, on perd la seule chose
        // qui transforme un constat interne en constat contradictoire.
        if ($customerPresent && $signatureName === null) {
            Response::validationFailed([
                'signature_name' => 'Saisissez le nom du client : c\'est ce qui vaut accord sur l\'état constaté.',
            ]);
        }

        $id = $repository->create([
            'operation_id' => $operationId,
            'vehicle_id'   => (int) $operation['vehicle_id'],
            'type'         => $type,
            'performed_by_user_id' => AuthContext::current()->userId,
            'fuel_level'   => $validator->stringOrNull('fuel_level'),
            'mileage'      => $mileage === null || $mileage === '' ? null : (int) $mileage,
            'has_damage'   => $hasDamage ? 1 : 0,
            'damage_notes' => $damageNotes,
            'items_left'   => $validator->stringOrNull('items_left'),
            'observations' => $validator->stringOrNull('observations'),
            'customer_present' => $customerPresent ? 1 : 0,
            'signature_name'   => $signatureName,
        ]);

        // Enregistrer l'inspection d'entrée fait avancer le dossier :
        // sans cela, l'employé devrait changer le statut à la main
        // juste après, et oublierait une fois sur deux.
        if ($type === 'ENTRY' && OperationStatus::canTransition((string) $operation['status'], 'INSPECTION')) {
            $operations->applyStatus($operationId, 'INSPECTION');
        }

        AuditLogger::record(
            action: 'inspection.created',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $operation['station_id'],
            entityType: 'inspection',
            entityId: $id,
            metadata: [
                'operation_reference' => $operation['reference'],
                'type'       => $type,
                'has_damage' => $hasDamage,
            ],
        );

        Response::success(
            ['inspection' => $this->present($repository->find($id) ?? [], [])],
            'État du véhicule enregistré.',
            201
        );
    }

    /** GET /api/inspections/{id} */
    public function show(Request $request, string $id): void
    {
        $inspectionId = (int) $id;
        $inspection   = (new InspectionRepository())->find($inspectionId);

        if ($inspection === null) {
            Response::notFound("Cette inspection n'existe pas.");
        }

        $photos = (new InspectionPhotoRepository())->forInspection($inspectionId);

        Response::success(['inspection' => $this->present($inspection, $photos)]);
    }

    /**
     * POST /api/inspections/{id}/photos
     * L'ENVOI D'UNE PREUVE.
     *
     * Envoi multipart et non JSON : c'est le seul endroit de l'API
     * qui ne reçoit pas du JSON. Encoder une image en base64 dans du
     * JSON l'alourdirait d'un tiers — sur une connexion mobile, ce
     * tiers se compte en secondes d'attente.
     */
    public function uploadPhoto(Request $request, string $id): void
    {
        $inspectionId = (int) $id;
        $inspections  = new InspectionRepository();
        $inspection   = $inspections->find($inspectionId);

        if ($inspection === null) {
            Response::notFound("Cette inspection n'existe pas.");
        }

        $photos = new InspectionPhotoRepository();

        if ($photos->countForInspection($inspectionId) >= self::MAX_PHOTOS_PER_INSPECTION) {
            Response::error(
                sprintf('Cette inspection contient déjà %d photos.', self::MAX_PHOTOS_PER_INSPECTION),
                [],
                409
            );
        }

        // $_FILES est la seule variable globale que le reste du code
        // ne touche jamais : PHP la remplit lui-même pour les envois
        // multipart, il n'existe pas d'équivalent dans Request.
        $uploaded = $_FILES['photo'] ?? null;

        if (!is_array($uploaded)) {
            Response::validationFailed(['photo' => 'Aucune photo reçue.']);
        }

        $position = strtoupper((string) ($_POST['position'] ?? 'OTHER'));

        if (!in_array($position, ['FRONT', 'REAR', 'LEFT', 'RIGHT', 'INTERIOR', 'DAMAGE', 'OTHER'], true)) {
            $position = 'OTHER';
        }

        $caption = trim((string) ($_POST['caption'] ?? ''));

        try {
            // Tout le traitement dangereux est dans PhotoStorage :
            // vérification du type réel, garde contre les bombes de
            // décompression, ré-encodage complet de l'image, nom de
            // fichier généré, écriture hors du dossier web.
            $stored = PhotoStorage::store($uploaded);
        } catch (RuntimeException $exception) {
            Response::validationFailed(['photo' => $exception->getMessage()]);
        }

        $photoId = $photos->create([
            'inspection_id' => $inspectionId,
            'position'  => $position,
            'file_path' => $stored['path'],
            'file_hash' => $stored['hash'],
            'mime_type' => $stored['mime'],
            'file_size' => $stored['size'],
            'width'     => $stored['width'],
            'height'    => $stored['height'],
            'caption'   => $caption === '' ? null : mb_substr($caption, 0, 255),
            'uploaded_by_user_id' => AuthContext::current()->userId,
            'status'    => 'ACTIVE',
        ]);

        Response::success(
            ['photo' => $this->presentPhoto($photos->find($photoId) ?? [])],
            'Photo enregistrée.',
            201
        );
    }

    /**
     * GET /api/photos/{id}
     * SERT LE FICHIER LUI-MÊME.
     *
     * La seule route de l'API qui ne renvoie pas du JSON. Elle existe
     * parce que les fichiers sont stockés HORS du dossier web : sans
     * elle, aucune URL ne permettrait de les afficher — et avec un
     * stockage dans le dossier web, n'importe qui connaissant
     * l'adresse verrait les preuves d'une autre entreprise.
     *
     * Le filtre d'organisation est appliqué par le dépôt : une photo
     * appartenant à une autre entreprise répond 404, exactement
     * comme si elle n'existait pas.
     */
    public function servePhoto(Request $request, string $id): void
    {
        $photo = (new InspectionPhotoRepository())->find((int) $id);

        if ($photo === null) {
            Response::notFound('Cette photo est introuvable.');
        }

        try {
            $path = PhotoStorage::absolutePath((string) $photo['file_path']);
        } catch (RuntimeException) {
            Response::notFound('Cette photo est introuvable.');
        }

        if (!is_file($path)) {
            // La ligne existe mais le fichier a disparu. C'est un
            // incident sérieux sur des preuves : on le trace.
            error_log('[AUTOCARE][PHOTO] Fichier manquant : ' . $photo['file_path']);

            Response::notFound('Le fichier de cette photo est introuvable.');
        }

        header('Content-Type: ' . $photo['mime_type']);
        header('Content-Length: ' . (string) filesize($path));

        // Cache privé : l'image peut rester dans le navigateur de
        // l'employé, jamais dans un cache partagé — ce sont des
        // données d'une entreprise précise.
        header('Cache-Control: private, max-age=3600');

        // Le navigateur ne doit pas deviner un autre type que celui
        // annoncé : c'est ce qui empêcherait un fichier piégé de
        // s'exécuter s'il en restait un.
        header('X-Content-Type-Options: nosniff');

        readfile($path);

        exit;
    }

    /**
     * GET /api/vehicles/{id}/inspections
     * L'historique des états constatés — l'écran du litige.
     */
    public function forVehicle(Request $request, string $id): void
    {
        $inspections = (new InspectionRepository())->historyForVehicle((int) $id);

        Response::success([
            'inspections' => array_map(
                static fn (array $row): array => [
                    'id'   => (int) $row['id'],
                    'type' => $row['type'],
                    'operation_reference' => $row['reference'],
                    'performed_by_name'   => $row['performed_by_name'],
                    'performed_at'        => $row['performed_at'],
                    'has_damage'   => (int) $row['has_damage'] === 1,
                    'damage_notes' => $row['damage_notes'],
                    'photo_count'  => (int) $row['photo_count'],
                ],
                $inspections
            ),
        ]);
    }

    // ==================================================================

    /**
     * Une case cochée peut arriver en `true`, `"true"`, `1` ou `"1"`
     * selon la façon dont le client la sérialise. On accepte les
     * quatre plutôt que d'imposer une forme au frontend.
     */
    private function readBool(mixed $value): bool
    {
        return in_array($value, [true, 1, '1', 'true', 'on'], true);
    }

    /**
     * @param array<string,mixed> $inspection
     * @param list<array<string,mixed>> $photos
     * @return array<string,mixed>
     */
    private function present(array $inspection, array $photos): array
    {
        return [
            'id'   => (int) ($inspection['id'] ?? 0),
            'operation_id' => (int) ($inspection['operation_id'] ?? 0),
            'vehicle_id'   => (int) ($inspection['vehicle_id'] ?? 0),
            'type'         => $inspection['type'] ?? 'ENTRY',
            'fuel_level'   => $inspection['fuel_level'] ?? null,
            'mileage'      => $inspection['mileage'] === null ? null : (int) $inspection['mileage'],
            'has_damage'   => (int) ($inspection['has_damage'] ?? 0) === 1,
            'damage_notes' => $inspection['damage_notes'] ?? null,
            'items_left'   => $inspection['items_left'] ?? null,
            'observations' => $inspection['observations'] ?? null,
            'customer_present' => (int) ($inspection['customer_present'] ?? 0) === 1,
            'signature_name'   => $inspection['signature_name'] ?? null,
            'performed_at'     => $inspection['performed_at'] ?? null,
            'photos' => array_map($this->presentPhoto(...), $photos),
        ];
    }

    /**
     * @param array<string,mixed> $photo
     * @return array<string,mixed>
     */
    private function presentPhoto(array $photo): array
    {
        return [
            'id'       => (int) ($photo['id'] ?? 0),
            'position' => $photo['position'] ?? 'OTHER',
            // On n'expose JAMAIS le chemin sur le disque : il ne sert
            // à rien au navigateur et renseignerait un attaquant sur
            // l'arborescence du serveur.
            'url'      => '/api/photos/' . (int) ($photo['id'] ?? 0),
            'caption'  => $photo['caption'] ?? null,
            'width'    => $photo['width'] === null ? null : (int) $photo['width'],
            'height'   => $photo['height'] === null ? null : (int) $photo['height'],
            'file_size' => (int) ($photo['file_size'] ?? 0),
            'created_at' => $photo['created_at'] ?? null,
        ];
    }
}
