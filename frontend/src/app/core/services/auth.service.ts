import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, of, shareReplay, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import {
  AuthSession,
  AuthUser,
  LoginPayload,
  RegisterPayload,
  UserRole,
} from '../models/auth.model';

/**
 * Service d'authentification
 * ------------------------------------------------------------------
 * Détient l'état de connexion de l'application.
 *
 * OÙ EST STOCKÉ LE JETON D'ACCÈS ?
 * En mémoire, dans un signal — PAS dans localStorage.
 *
 * localStorage est lisible par n'importe quel JavaScript de la page.
 * Une seule faille XSS (une dépendance compromise, une saisie
 * affichée sans échappement) et le compte est volé.
 *
 * L'inconvénient : recharger la page perd le jeton. C'est là
 * qu'intervient `restoreSession()` — le cookie httpOnly de
 * rafraîchissement, lui, survit au rechargement, et permet d'obtenir
 * un nouveau jeton d'accès sans redemander le mot de passe.
 * Sécurité ET confort.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly baseUrl = `${environment.apiUrl}/auth`;

  /** Jeton d'accès courant. En mémoire uniquement. */
  private readonly accessToken = signal<string | null>(null);

  /** Utilisateur connecté, ou null. */
  readonly user = signal<AuthUser | null>(null);

  /** Vrai tant que la restauration de session au démarrage n'a pas fini. */
  readonly isRestoring = signal(true);

  readonly isAuthenticated = computed(() => this.user() !== null);
  readonly role = computed<UserRole | null>(() => this.user()?.role ?? null);

  /**
   * L'utilisateur a-t-il ce droit ?
   *
   * Applique la même règle d'étoile que le serveur : « vehicles.* »
   * couvre « vehicles.create ». Cinq lignes ici plutôt que deux cents
   * chaînes envoyées à chaque connexion.
   *
   * RAPPEL : cette méthode sert à cacher un bouton ou un lien, JAMAIS
   * à autoriser une action. Le serveur revérifie tout, à chaque
   * requête.
   */
  can(action: string): boolean {
    const granted = this.user()?.permissions ?? [];

    return granted.some((pattern) => {
      if (pattern === '*' || pattern === action) {
        return true;
      }

      return pattern.endsWith('.*') && action.startsWith(pattern.slice(0, -1));
    });
  }

  /** Lu par l'intercepteur pour ajouter l'en-tête Authorization. */
  token(): string | null {
    return this.accessToken();
  }

  // --- Connexion ---------------------------------------------------

  login(payload: LoginPayload): Observable<ApiResponse<AuthSession>> {
    return this.http
      .post<ApiResponse<AuthSession>>(`${this.baseUrl}/login`, payload, {
        // Indispensable : sans cela le navigateur n'accepterait pas le
        // cookie de rafraîchissement renvoyé par l'API.
        withCredentials: true,
      })
      .pipe(tap((response) => this.applySession(response.data)));
  }

  register(payload: RegisterPayload): Observable<ApiResponse<AuthSession>> {
    return this.http
      .post<ApiResponse<AuthSession>>(`${this.baseUrl}/register`, payload, {
        withCredentials: true,
      })
      .pipe(tap((response) => this.applySession(response.data)));
  }

  /**
   * Le renouvellement en cours, s'il y en a un.
   *
   * Voir `refresh()` : c'est ce champ qui garantit qu'il n'y en a
   * jamais deux à la fois.
   */
  private inFlightRefresh: Observable<AuthSession | null> | null = null;

  /**
   * Demande un nouveau jeton d'accès à partir du cookie httpOnly.
   *
   * ==================================================================
   * UN SEUL RENOUVELLEMENT À LA FOIS — CORRIGÉ À L'AUDIT DU LOT 21.
   * ==================================================================
   * Le serveur applique une ROTATION : le jeton de rafraîchissement
   * ne sert qu'une fois, et le présenter une seconde fois échoue.
   * C'est une bonne protection — un jeton volé ne resservira pas.
   *
   * Elle se retournait contre l'utilisateur. Le tableau de bord lance
   * une quinzaine de requêtes en parallèle ; quand le jeton d'accès
   * expire pendant cette rafale, elles répondent toutes 401 en même
   * temps, et l'intercepteur appelait CETTE méthode autant de fois.
   * La première rotation réussissait, les suivantes présentaient un
   * jeton déjà consommé — et depuis le lot 18, un renouvellement
   * échoué renvoie à l'écran de connexion.
   *
   * Autrement dit : toutes les trente minutes, l'utilisateur pouvait
   * être déconnecté au milieu de son travail, d'autant plus sûrement
   * que l'écran ouvert chargeait beaucoup de données.
   *
   * `shareReplay` fait que les appels simultanés PARTAGENT la même
   * requête : une seule rotation, un seul jeton consommé, et tout le
   * monde reçoit le même résultat. Le champ est remis à zéro à la fin
   * pour que le renouvellement suivant reparte bien du serveur.
   */
  refresh(): Observable<AuthSession | null> {
    if (this.inFlightRefresh !== null) {
      return this.inFlightRefresh;
    }

    this.inFlightRefresh = this.http
      .post<ApiResponse<AuthSession>>(`${this.baseUrl}/refresh`, {}, { withCredentials: true })
      .pipe(
        tap((response) => this.applySession(response.data)),
        // Un échec est un cas NORMAL : personne n'était connecté, ou
        // la session a expiré. On renvoie null plutôt qu'une erreur.
        catchError(() => {
          this.clearSession();

          return of(null);
        }),
        // `finalize` passe aussi bien après un succès qu'après une
        // erreur : sans lui, un échec laisserait le verrou posé et
        // plus aucun renouvellement ne serait tenté.
        finalize(() => {
          this.inFlightRefresh = null;
        }),
        // Le renouvellement doit partir UNE fois même si plusieurs
        // requêtes s'y abonnent, et les retardataires doivent recevoir
        // le résultat déjà obtenu : c'est exactement ce que fait
        // shareReplay avec un tampon de un.
        shareReplay({ bufferSize: 1, refCount: false }),
      ) as Observable<AuthSession | null>;

    return this.inFlightRefresh;
  }

  /**
   * Appelé une fois au démarrage de l'application.
   * Permet de rester connecté après un rechargement de page.
   */
  restoreSession(): Observable<AuthSession | null> {
    return this.refresh().pipe(tap(() => this.isRestoring.set(false)));
  }

  logout(): void {
    // On prévient le serveur pour qu'il révoque le jeton de
    // rafraîchissement. Même si l'appel échoue (réseau coupé), on
    // efface la session locale : l'utilisateur a demandé à partir.
    this.http
      .post(`${this.baseUrl}/logout`, {}, { withCredentials: true })
      .pipe(catchError(() => of(null)))
      .subscribe(() => {
        this.clearSession();
        void this.router.navigate(['/login']);
      });
  }

  // --- Mot de passe oublié -----------------------------------------

  forgotPassword(email: string): Observable<ApiResponse<{ debug_reset_link?: string } | null>> {
    return this.http.post<ApiResponse<{ debug_reset_link?: string } | null>>(
      `${this.baseUrl}/forgot-password`,
      { email },
    );
  }

  resetPassword(token: string, password: string): Observable<ApiResponse<null>> {
    return this.http.post<ApiResponse<null>>(`${this.baseUrl}/reset-password`, {
      token,
      password,
    });
  }

  // --- Interne -----------------------------------------------------

  private applySession(session: AuthSession): void {
    this.accessToken.set(session.access_token);
    this.user.set(session.user);
  }

  private clearSession(): void {
    this.accessToken.set(null);
    this.user.set(null);
  }
}
