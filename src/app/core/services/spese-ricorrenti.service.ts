import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { API_PATHS } from '../constants/api-paths';
import {
  PlanSummaryDTO, PlanDetailDTO, PlanCreateRequest, CogeOption,
} from '../../features/spese-ricorrenti/spese-ricorrenti.models';
import { ContoBancarioDTO } from '../models/anagrafica.models';
import { ContiService } from './conti.service';

@Injectable({ providedIn: 'root' })
export class SpeseRicorrentiService {
  private readonly http  = inject(HttpClient);
  private readonly conti = inject(ContiService);
  private readonly base  = environment.apiBaseUrl;

  listPlans(): Observable<PlanSummaryDTO[]> {
    return this.http.get<PlanSummaryDTO[]>(this.base + API_PATHS.SPESE_RICORRENTI.PIANI);
  }

  getPlan(id: string): Observable<PlanDetailDTO> {
    return this.http.get<PlanDetailDTO>(this.base + API_PATHS.SPESE_RICORRENTI.PIANO(id));
  }

  createPlan(req: PlanCreateRequest): Observable<PlanDetailDTO> {
    return this.http.post<PlanDetailDTO>(this.base + API_PATHS.SPESE_RICORRENTI.PIANI, req);
  }

  liquidatePlan(id: string, importoTotale?: number, note?: string): Observable<PlanDetailDTO> {
    return this.http.post<PlanDetailDTO>(
      this.base + API_PATHS.SPESE_RICORRENTI.LIQUIDA(id),
      { importoTotale: importoTotale ?? null, note: note ?? null }
    );
  }

  /** Eliminazione fisica: consentita dal server solo su piani ATTIVI senza movimenti (409 altrimenti). */
  deletePlan(id: string): Observable<void> {
    return this.http.delete<void>(this.base + API_PATHS.SPESE_RICORRENTI.PIANO(id));
  }

  cancelPlan(id: string, importoPenale?: number, note?: string): Observable<PlanDetailDTO> {
    return this.http.post<PlanDetailDTO>(
      this.base + API_PATHS.SPESE_RICORRENTI.ANNULLA(id),
      { importoPenale: importoPenale ?? 0, note: note ?? null }
    );
  }

  updateInstallment(pianoId: string, rataId: string,
                    importo?: number, dataScadenza?: string, note?: string): Observable<unknown> {
    return this.http.put(
      this.base + API_PATHS.SPESE_RICORRENTI.UPDATE_RATA(pianoId, rataId),
      { importo: importo ?? null, dataScadenza: dataScadenza ?? null, note: note ?? null }
    );
  }

  payInstallment(pianoId: string, rataId: string): Observable<PlanDetailDTO> {
    return this.http.post<PlanDetailDTO>(
      this.base + API_PATHS.SPESE_RICORRENTI.PAGA_RATA(pianoId, rataId),
      {}
    );
  }

  skipInstallment(pianoId: string, rataId: string, modalita: 'RIMANDA' | 'ACCORPA'): Observable<unknown> {
    return this.http.post(
      this.base + API_PATHS.SPESE_RICORRENTI.SKIP_RATA(pianoId, rataId),
      { modalita }
    );
  }

  getContiCoge(): Observable<CogeOption[]> {
    return this.http.get<[number, string, string][]>(
      this.base + API_PATHS.SPESE_RICORRENTI.CONTI_COGE
    ).pipe(
      map(rows => rows.map(r => ({ id: r[0], codice: r[1], descrizione: r[2] })))
    );
  }

  getContiCogeInteressi(): Observable<CogeOption[]> {
    return this.http.get<[number, string, string][]>(
      this.base + API_PATHS.SPESE_RICORRENTI.CONTI_COGE_INTERESSI
    ).pipe(
      map(rows => rows.map(r => ({ id: r[0], codice: r[1], descrizione: r[2] })))
    );
  }

  getContiBancari(): Observable<ContoBancarioDTO[]> {
    return this.conti.getAll();
  }
}
