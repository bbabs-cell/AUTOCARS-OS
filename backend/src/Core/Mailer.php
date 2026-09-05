<?php

declare(strict_types=1);

namespace Autocare\Core;

/**
 * L'envoi de courrier
 * ==================================================================
 * CE QUI N'ÉTAIT PAS ENVOYÉ DEPUIS LE LOT 4.
 * ==================================================================
 *
 * Le mot de passe oublié fonctionnait à moitié : le jeton était
 * généré, stocké haché, vérifié à l'usage — et le lien n'arrivait
 * nulle part. Il partait dans le journal du serveur, ce qui est
 * commode pour développer et inutile pour un gérant enfermé dehors.
 *
 * ------------------------------------------------------------------
 * POURQUOI CE N'EST PAS UNE « FAUSSE INTÉGRATION »
 *
 * Le produit s'interdit de simuler un fournisseur de paiement tant
 * qu'aucun compte marchand n'existe (lot 9). La règle vaut toujours,
 * et cette classe ne la contredit pas : SMTP n'est pas un
 * fournisseur, c'est un protocole, et `mail()` est la façon standard
 * de l'utiliser en PHP sans bibliothèque. Rien n'est simulé ici — ou
 * bien le message part, ou bien il est écrit dans un fichier, et on
 * sait lequel des deux.
 *
 * ------------------------------------------------------------------
 * DEUX TRANSPORTS, ET LE DÉFAUT EST LE PLUS HONNÊTE
 *
 *   log   (défaut) le message est écrit dans storage/logs/mail.log,
 *                  en clair, avec son destinataire et son contenu.
 *                  C'est ce qu'il faut en développement : on relit le
 *                  lien de réinitialisation sans configurer quoi que
 *                  ce soit, et rien ne part par erreur vers l'adresse
 *                  réelle d'un client pendant un test.
 *
 *   mail           `mail()`, donc le serveur de courrier de la
 *                  machine. C'est le transport de production tant
 *                  qu'aucun prestataire n'est choisi — décision
 *                  attendue au lot 22, avec l'hébergement.
 *
 * Le transport se règle par MAIL_DRIVER dans `.env`. Un nom inconnu
 * retombe sur `log` : mieux vaut un message écrit quelque part qu'une
 * erreur fatale au milieu d'une demande de mot de passe.
 *
 * ------------------------------------------------------------------
 * CETTE CLASSE NE LÈVE JAMAIS D'EXCEPTION
 *
 * Un envoi qui échoue ne doit pas casser la requête qui l'a déclenché.
 * D'abord parce que l'utilisateur n'y peut rien. Ensuite parce qu'une
 * erreur visible sur « mot de passe oublié » trahirait l'existence du
 * compte : la réponse est volontairement la même que l'adresse soit
 * connue ou non, et une panne d'envoi ne doit pas rompre ce silence.
 */
final class Mailer
{
    /**
     * Envoie un message.
     *
     * @return bool false si le transport a échoué — l'appelant peut
     *              le journaliser, il ne doit pas en informer
     *              l'utilisateur.
     */
    public static function send(string $to, string $subject, string $body): bool
    {
        // Une adresse invalide n'est pas une erreur de configuration :
        // c'est une donnée douteuse, et on s'arrête avant d'appeler
        // quoi que ce soit.
        if (filter_var($to, FILTER_VALIDATE_EMAIL) === false) {
            error_log("[AUTOCARE][MAIL] Adresse invalide, message non envoyé : {$to}");

            return false;
        }

        return match (mb_strtolower((string) Env::get('MAIL_DRIVER', 'log'))) {
            'mail'  => self::sendWithMailFunction($to, $subject, $body),
            default => self::writeToLog($to, $subject, $body),
        };
    }

    /**
     * Le transport de développement.
     *
     * Le fichier est hors du dossier exposé au web et ignoré par Git,
     * comme les photos d'inspection : il contient des liens de
     * réinitialisation, donc de quoi prendre la main sur un compte.
     */
    private static function writeToLog(string $to, string $subject, string $body): bool
    {
        $directory = dirname(__DIR__, 2) . '/storage/logs';

        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
            error_log('[AUTOCARE][MAIL] Dossier de journal introuvable : ' . $directory);

            return false;
        }

        $entry = sprintf(
            "[%s] À : %s\nSujet : %s\n%s\n%s\n\n",
            date('Y-m-d H:i:s'),
            $to,
            $subject,
            str_repeat('-', 60),
            $body,
        );

        $written = @file_put_contents($directory . '/mail.log', $entry, FILE_APPEND | LOCK_EX);

        if ($written === false) {
            error_log('[AUTOCARE][MAIL] Écriture impossible dans storage/logs/mail.log');

            return false;
        }

        return true;
    }

    /**
     * Le transport de production, tant qu'aucun prestataire n'est
     * choisi.
     *
     * `mail()` remet le message au serveur de courrier de la machine.
     * S'il n'y en a pas, l'appel échoue et renvoie false — il ne
     * prétend pas avoir envoyé.
     */
    private static function sendWithMailFunction(string $to, string $subject, string $body): bool
    {
        $from = (string) Env::get('MAIL_FROM', 'no-reply@autocare-os.local');
        $name = (string) Env::get('MAIL_FROM_NAME', 'AUTOCARE OS');

        // Un sujet contenant des accents doit être encodé, sinon il
        // arrive en caractères illisibles dans la plupart des
        // messageries.
        $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';

        $headers = implode("\r\n", [
            'From: ' . self::encodeName($name) . ' <' . $from . '>',
            'Reply-To: ' . $from,
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
            'MIME-Version: 1.0',
        ]);

        // Les retours à la ligne d'un corps de message doivent être en
        // CRLF : certains serveurs tronquent le message au premier
        // saut de ligne isolé.
        $normalized = str_replace(["\r\n", "\r", "\n"], "\r\n", $body);

        $sent = @mail($to, $encodedSubject, $normalized, $headers);

        if (!$sent) {
            error_log("[AUTOCARE][MAIL] Échec de l'envoi à {$to} — sujet : {$subject}");
        }

        return $sent;
    }

    private static function encodeName(string $name): string
    {
        return preg_match('/^[\x20-\x7E]+$/', $name) === 1
            ? $name
            : '=?UTF-8?B?' . base64_encode($name) . '?=';
    }
}
