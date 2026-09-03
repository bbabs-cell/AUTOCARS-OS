<?php

declare(strict_types=1);

namespace Autocare\Core;

/**
 * Validation des données entrantes
 * ------------------------------------------------------------------
 * PREMIÈRE LIGNE DE DÉFENSE DE L'API.
 *
 * Tout ce qui vient du client est suspect : un formulaire mal rempli,
 * mais aussi une requête fabriquée à la main pour contourner
 * l'interface. On ne fait donc JAMAIS confiance à ce qu'Angular a
 * vérifié de son côté — un utilisateur peut appeler l'API avec curl.
 *
 * Utilisation :
 *
 *     $validator = Validator::make($request->body())
 *         ->required('email')->email('email')
 *         ->required('password')->minLength('password', 10);
 *
 *     if ($validator->fails()) {
 *         Response::validationFailed($validator->errors());
 *     }
 *
 * Les messages sont en français : ils s'affichent directement sous le
 * champ concerné dans l'interface.
 */
final class Validator
{
    /** @var array<string,mixed> */
    private array $data;

    /** @var array<string,string> Un message par champ, le premier trouvé. */
    private array $errors = [];

    /** @param array<string,mixed> $data */
    private function __construct(array $data)
    {
        $this->data = $data;
    }

    /** @param array<string,mixed> $data */
    public static function make(array $data): self
    {
        return new self($data);
    }

    // --- Règles ----------------------------------------------------

    public function required(string $field, string $label = 'Ce champ'): self
    {
        $value = $this->raw($field);

        if ($value === null || (is_string($value) && trim($value) === '')) {
            $this->addError($field, "{$label} est obligatoire.");
        }

        return $this;
    }

    public function email(string $field): self
    {
        return $this->when($field, function (mixed $value) use ($field): void {
            if (!filter_var((string) $value, FILTER_VALIDATE_EMAIL)) {
                $this->addError($field, 'Cette adresse e-mail est invalide.');
            }
        });
    }

    public function minLength(string $field, int $minimum): self
    {
        return $this->when($field, function (mixed $value) use ($field, $minimum): void {
            // mb_strlen et non strlen : « é » compte pour un caractère,
            // pas pour les deux octets qu'il occupe en UTF-8.
            if (mb_strlen((string) $value) < $minimum) {
                $this->addError($field, "Ce champ doit contenir au moins {$minimum} caractères.");
            }
        });
    }

    public function maxLength(string $field, int $maximum): self
    {
        return $this->when($field, function (mixed $value) use ($field, $maximum): void {
            if (mb_strlen((string) $value) > $maximum) {
                $this->addError($field, "Ce champ ne peut pas dépasser {$maximum} caractères.");
            }
        });
    }

    /** @param list<string> $allowed */
    public function in(string $field, array $allowed): self
    {
        return $this->when($field, function (mixed $value) use ($field, $allowed): void {
            if (!in_array((string) $value, $allowed, true)) {
                $this->addError($field, 'Cette valeur n\'est pas autorisée.');
            }
        });
    }

    /**
     * Numéro de téléphone. Volontairement permissif : le produit vise
     * plusieurs pays, et un format trop strict rejetterait des numéros
     * parfaitement valides. On vérifie seulement qu'il s'agit de
     * chiffres, éventuellement précédés d'un « + ».
     */
    public function phone(string $field): self
    {
        return $this->when($field, function (mixed $value) use ($field): void {
            $cleaned = preg_replace('/[\s.\-()]/', '', (string) $value) ?? '';

            if (preg_match('/^\+?[0-9]{6,15}$/', $cleaned) !== 1) {
                $this->addError($field, 'Ce numéro de téléphone est invalide.');
            }
        });
    }

    /**
     * Robustesse d'un mot de passe.
     *
     * On exige 10 caractères minimum plutôt qu'un cocktail de
     * majuscules, chiffres et symboles sur 8 caractères. La longueur
     * protège davantage que la complexité : « cheval correct pile
     * agrafe » est bien plus difficile à casser que « P@ssw0rd », et
     * infiniment plus facile à retenir — donc moins souvent noté sur
     * un papier collé à l'écran.
     */
    public function password(string $field): self
    {
        return $this->when($field, function (mixed $value) use ($field): void {
            $password = (string) $value;

            if (mb_strlen($password) < 10) {
                $this->addError($field, 'Le mot de passe doit contenir au moins 10 caractères.');

                return;
            }

            if (mb_strlen($password) > 200) {
                $this->addError($field, 'Le mot de passe est trop long.');

                return;
            }

            // Quelques mots de passe si répandus qu'ils sont testés en
            // premier par n'importe quelle attaque.
            $tooCommon = ['motdepasse', 'password', 'azertyuiop', '1234567890', 'qwertyuiop'];

            if (in_array(mb_strtolower($password), $tooCommon, true)) {
                $this->addError($field, 'Ce mot de passe est trop courant.');
            }
        });
    }

    // --- Résultats -------------------------------------------------

    public function fails(): bool
    {
        return $this->errors !== [];
    }

    /** @return array<string,string> */
    public function errors(): array
    {
        return $this->errors;
    }

    /**
     * Valeur nettoyée d'un champ texte.
     * Le trim évite les espaces avant/après collés par un
     * copier-coller, cause de « cet e-mail n'existe pas » incompris.
     */
    public function string(string $field, string $default = ''): string
    {
        $value = $this->raw($field);

        return is_scalar($value) ? trim((string) $value) : $default;
    }

    public function stringOrNull(string $field): ?string
    {
        $value = $this->string($field);

        return $value === '' ? null : $value;
    }

    // --- Interne ---------------------------------------------------

    private function raw(string $field): mixed
    {
        return $this->data[$field] ?? null;
    }

    /**
     * Applique une règle seulement si le champ est renseigné.
     * Sans cela, un champ facultatif laissé vide déclencherait une
     * erreur de format — et l'utilisateur ne comprendrait pas.
     */
    private function when(string $field, callable $rule): self
    {
        $value = $this->raw($field);

        if ($value !== null && (!is_string($value) || trim($value) !== '')) {
            $rule($value);
        }

        return $this;
    }

    /** On garde la PREMIÈRE erreur par champ : la plus utile. */
    private function addError(string $field, string $message): void
    {
        $this->errors[$field] ??= $message;
    }
}
