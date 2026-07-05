import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { CespiteAcquistoRequest, CespiteDTO, CespiteLiquidazioneRequest, CespiteRequest, PianoContiCogeDTO } from '../models/anagrafica.models';
import { API_PATHS } from '../constants/api-paths';
import { environment } from '../../../environments/environment';
import { CacheService } from './cache.service';

@Injectable({ providedIn: 'root' })
export class CespitiService {
  private readonly http = inject(HttpClient);
  private readonly cache = inject(CacheService);

  getAll(): Observable<CespiteDTO[]> {
    return this.http.get<CespiteDTO[]>(environment.apiBaseUrl + API_PATHS.CESPITI);
  }

  create(body: CespiteRequest): Observable<CespiteDTO> {
    return this.http.post<CespiteDTO>(environment.apiBaseUrl + API_PATHS.CESPITI, body);
  }

  /** Acquisto operativo: crea cespite + movimento di acquisto CAPEX collegato. */
  registraAcquisto(body: CespiteAcquistoRequest): Observable<CespiteDTO> {
    return this.http.post<CespiteDTO>(environment.apiBaseUrl + API_PATHS.CESPITI_ACQUISTO, body);
  }

  /** Liquidazione differita: paga ora l'acquisto rimasto DA_LIQUIDARE. */
  liquidaAcquisto(id: string, body: CespiteLiquidazioneRequest): Observable<CespiteDTO> {
    return this.http.post<CespiteDTO>(environment.apiBaseUrl + API_PATHS.CESPITI_LIQUIDAZIONE(id), body);
  }

  update(id: string, body: CespiteRequest): Observable<CespiteDTO> {
    return this.http.put<CespiteDTO>(environment.apiBaseUrl + API_PATHS.CESPITI_ID(id), body);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(environment.apiBaseUrl + API_PATHS.CESPITI_ID(id));
  }

  /** Crea al volo una categoria investimento (conto CAPEX). Invalida la cache lookup del piano conti. */
  creaCategoria(descrizione: string): Observable<PianoContiCogeDTO> {
    return this.http.post<PianoContiCogeDTO>(
      environment.apiBaseUrl + API_PATHS.CESPITI_CATEGORIA, { descrizione }
    ).pipe(tap(() => this.cache.invalidate('lookup:piano-dei-conti')));
  }
}
