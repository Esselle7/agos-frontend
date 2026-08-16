import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ContaContantiRequest,
  EsitoContaDTO,
  GirocontoContantiRequest,
  IncassoContantiRequest,
  SaldoContantiDTO,
  SpesaContantiRequest,
} from '../models/contanti.models';
import { MovimentoDTO } from '../models/movimenti.models';
import { API_PATHS } from '../constants/api-paths';
import { environment } from '../../../environments/environment';

/**
 * Modulo «Contanti»: un endpoint per operazione, nessun CRUD generico.
 *
 * Il saldo NON si mette in cache: è la ragione per cui esiste `/api/contanti/saldo` invece di
 * leggerlo da `/api/conti`, che passa dalla materialized view asincrona e non vede la scrittura
 * appena fatta. Storico e annullamento restano su `/api/movimenti` — qui non si duplicano.
 */
@Injectable({ providedIn: 'root' })
export class ContantiService {
  private readonly http = inject(HttpClient);

  saldo(): Observable<SaldoContantiDTO> {
    return this.http.get<SaldoContantiDTO>(environment.apiBaseUrl + API_PATHS.CONTANTI.SALDO);
  }

  prelievo(req: GirocontoContantiRequest): Observable<MovimentoDTO> {
    return this.http.post<MovimentoDTO>(environment.apiBaseUrl + API_PATHS.CONTANTI.PRELIEVO, req);
  }

  deposito(req: GirocontoContantiRequest): Observable<MovimentoDTO> {
    return this.http.post<MovimentoDTO>(environment.apiBaseUrl + API_PATHS.CONTANTI.DEPOSITO, req);
  }

  incasso(req: IncassoContantiRequest): Observable<MovimentoDTO> {
    return this.http.post<MovimentoDTO>(environment.apiBaseUrl + API_PATHS.CONTANTI.INCASSO, req);
  }

  spesa(req: SpesaContantiRequest): Observable<MovimentoDTO> {
    return this.http.post<MovimentoDTO>(environment.apiBaseUrl + API_PATHS.CONTANTI.SPESA, req);
  }

  conta(req: ContaContantiRequest): Observable<EsitoContaDTO> {
    return this.http.post<EsitoContaDTO>(environment.apiBaseUrl + API_PATHS.CONTANTI.CONTA, req);
  }
}
