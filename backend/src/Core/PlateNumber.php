<?php

declare(strict_types=1);

namespace Autocare\Core;

/**
 * Plaques d'immatriculation
 * ------------------------------------------------------------------
 * LE PROBLÈME QU'ELLE RÉSOUT.
 *
 * Au comptoir, un employé pressé saisit la même plaque de six façons
 * différentes : « DK-1234-AA », « dk 1234 aa », « DK1234AA »,
 * « DK.1234.AA ». Sans normalisation, la base contiendrait six
 * véhicules là où il n'y en a qu'un — et l'historique, cœur du
 * produit, serait éparpillé entre eux.
 *
 * RÈGLE DU PROJET :
 *   - on STOCKE la forme normalisée : majuscules, sans séparateur
 *   - on AFFICHE la forme lisible avec des tirets
 *
 * Le format sénégalais est « DK-1234-AA » : deux lettres de région,
 * quatre chiffres, deux lettres. Mais le produit doit rester utilisable
 * ailleurs : une plaque qui ne correspond pas à ce motif est acceptée
 * telle quelle, simplement normalisée. Refuser une plaque valide
 * ailleurs serait pire que d'accepter une plaque inhabituelle.
 */
final class PlateNumber
{
    /**
     * Forme de stockage : majuscules, uniquement lettres et chiffres.
     *
     * « dk-1234-aa » et « DK 1234 AA » donnent tous deux « DK1234AA ».
     */
    public static function normalize(string $plate): string
    {
        $cleaned = preg_replace('/[^A-Za-z0-9]/', '', $plate) ?? '';

        return mb_strtoupper($cleaned);
    }

    /**
     * Forme d'affichage, avec séparateurs.
     *
     * « DK1234AA » devient « DK-1234-AA ».
     * Une plaque au format inconnu est renvoyée telle quelle : mieux
     * vaut afficher quelque chose de brut que d'inventer un découpage
     * qui induirait en erreur.
     */
    public static function format(string $plate): string
    {
        $normalized = self::normalize($plate);

        // Format sénégalais courant : 2 lettres, 4 chiffres, 2 lettres
        if (preg_match('/^([A-Z]{2})(\d{4})([A-Z]{2})$/', $normalized, $parts) === 1) {
            return "{$parts[1]}-{$parts[2]}-{$parts[3]}";
        }

        // Variante à 3 lettres finales, rencontrée sur certaines séries
        if (preg_match('/^([A-Z]{2})(\d{4})([A-Z]{3})$/', $normalized, $parts) === 1) {
            return "{$parts[1]}-{$parts[2]}-{$parts[3]}";
        }

        return $normalized;
    }

    /**
     * La plaque est-elle exploitable ?
     *
     * On vérifie seulement qu'elle contient assez de caractères pour
     * identifier un véhicule, et qu'elle mélange lettres et chiffres.
     * On ne cherche PAS à valider un format national : le produit doit
     * pouvoir enregistrer un véhicule immatriculé en Gambie ou au Mali
     * qui se présente à la station.
     */
    public static function isPlausible(string $plate): bool
    {
        $normalized = self::normalize($plate);

        if (mb_strlen($normalized) < 5 || mb_strlen($normalized) > 12) {
            return false;
        }

        return preg_match('/[A-Z]/', $normalized) === 1
            && preg_match('/\d/', $normalized) === 1;
    }
}
