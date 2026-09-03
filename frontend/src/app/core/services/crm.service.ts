import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import {
  Customer,
  CustomerPayload,
  PhoneMatch,
  Vehicle,
  VehicleHistoryEntry,
  VehiclePayload,
} from '../models/crm.model';

/**
 * Clients et véhicules
 * ------------------------------------------------------------------
 * Le service le plus sollicité du produit : c'est lui qu'on appelle
 * chaque fois qu'un client se présente au comptoir.
 */
@Injectable({ providedIn: 'root' })
export class CrmService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  private unwrap<T>(source: Observable<ApiResponse<T>>): Observable<T> {
    return source.pipe(map((response) => response.data));
  }

  // --- Clients -------------------------------------------------------

  customers(search = ''): Observable<Customer[]> {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';

    return this.unwrap(this.http.get<ApiResponse<Customer[]>>(`${this.api}/customers${query}`));
  }

  customer(id: number): Observable<{ customer: Customer; vehicles: Vehicle[] }> {
    return this.unwrap(
      this.http.get<ApiResponse<{ customer: Customer; vehicles: Vehicle[] }>>(
        `${this.api}/customers/${id}`,
      ),
    );
  }

  /**
   * Ce numéro est-il déjà enregistré ?
   *
   * Sert à AVERTIR pendant la saisie, pas à bloquer : un couple
   * partage souvent un numéro, et refuser l'enregistrement en pleine
   * affluence serait pire que le doublon.
   */
  checkPhone(phone: string): Observable<PhoneMatch[]> {
    return this.unwrap(
      this.http.get<ApiResponse<PhoneMatch[]>>(
        `${this.api}/customers/check-phone?phone=${encodeURIComponent(phone)}`,
      ),
    );
  }

  createCustomer(payload: CustomerPayload): Observable<Customer> {
    return this.unwrap(this.http.post<ApiResponse<Customer>>(`${this.api}/customers`, payload));
  }

  updateCustomer(id: number, payload: CustomerPayload): Observable<Customer> {
    return this.unwrap(
      this.http.put<ApiResponse<Customer>>(`${this.api}/customers/${id}`, payload),
    );
  }

  // --- Véhicules -----------------------------------------------------

  vehicles(search = '', customerId?: number): Observable<Vehicle[]> {
    const parameters = new URLSearchParams();

    if (search) {
      parameters.set('search', search);
    }

    if (customerId) {
      parameters.set('customer_id', String(customerId));
    }

    const query = parameters.toString() ? `?${parameters}` : '';

    return this.unwrap(this.http.get<ApiResponse<Vehicle[]>>(`${this.api}/vehicles${query}`));
  }

  vehicle(id: number): Observable<{ vehicle: Vehicle; history: VehicleHistoryEntry[] }> {
    return this.unwrap(
      this.http.get<ApiResponse<{ vehicle: Vehicle; history: VehicleHistoryEntry[] }>>(
        `${this.api}/vehicles/${id}`,
      ),
    );
  }

  createVehicle(payload: VehiclePayload): Observable<Vehicle> {
    return this.unwrap(this.http.post<ApiResponse<Vehicle>>(`${this.api}/vehicles`, payload));
  }

  updateVehicle(id: number, payload: VehiclePayload): Observable<Vehicle> {
    return this.unwrap(this.http.put<ApiResponse<Vehicle>>(`${this.api}/vehicles/${id}`, payload));
  }
}
