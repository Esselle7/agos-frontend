import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, tap } from 'rxjs';
import {
  AggiungiPartecipanteRequest,
  EventoCalendarioDTO,
  EventoCostoDirettoDTO,
  EventoCostoDirettoRequest,
  EventoPreventivoTrackingDTO,
  EventoPreventivoTrackingRequest,
  EventoCreateRequest,
  EventoDTO,
  EventoPartecipanteDTO,
  EventoUpdateRequest,
  EventoVoceDTO,
  EventoVoceRequest,
  EventoVoceCatalogoDTO,
  EventiDashboardDTO,
  PagamentoEventoDTO,
  PagamentoRequest,
  StatoEvento,
} from '../models/eventi.models';
import { CacheService } from './cache.service';
import { PagedResponse } from '../models/shared.models';
import { API_PATHS } from '../constants/api-paths';
import { environment } from '../../../environments/environment';

const CAL_CACHE_PREFIX = 'eventi:cal:';
const CAL_TTL_MS = 60_000;

export interface EventiFilter {
  stato?: StatoEvento;
  buId?: number;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  size?: number;
}

@Injectable({ providedIn: 'root' })
export class EventiService {
  private readonly http = inject(HttpClient);
  private readonly cache = inject(CacheService);

  getList(filter: EventiFilter = {}): Observable<PagedResponse<EventoDTO>> {
    let params = new HttpParams();
    if (filter.stato != null) params = params.set('stato', filter.stato);
    if (filter.buId != null) params = params.set('buId', filter.buId);
    if (filter.from != null) params = params.set('from', filter.from);
    if (filter.to != null) params = params.set('to', filter.to);
    if (filter.search != null) params = params.set('search', filter.search);
    if (filter.page != null) params = params.set('page', filter.page);
    if (filter.size != null) params = params.set('size', filter.size);
    return this.http.get<PagedResponse<EventoDTO>>(
      environment.apiBaseUrl + API_PATHS.EVENTI,
      { params }
    );
  }

  getCalendario(from: string, to: string): Observable<EventoCalendarioDTO[]> {
    const key = `${CAL_CACHE_PREFIX}${from}:${to}`;
    const cached = this.cache.get<EventoCalendarioDTO[]>(key);
    if (cached) return of(cached);
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http
      .get<EventoCalendarioDTO[]>(`${environment.apiBaseUrl}${API_PATHS.EVENTI}/calendario`, { params })
      .pipe(tap(data => this.cache.set(key, data, CAL_TTL_MS)));
  }

  /**
   * Invalida tutte le pagine del calendario in cache. Da chiamare dopo
   * ogni operazione che possa modificare la visualizzazione del calendario
   * (create/update/delete evento, registrazione pagamento, cambio stato).
   */
  invalidateCalendarCache(): void {
    this.cache.invalidatePattern(CAL_CACHE_PREFIX);
  }

  getDashboard(from: string, to: string): Observable<EventiDashboardDTO> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<EventiDashboardDTO>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/dashboard`,
      { params }
    );
  }

  getById(id: string): Observable<EventoDTO> {
    return this.http.get<EventoDTO>(`${environment.apiBaseUrl}${API_PATHS.EVENTI}/${id}`);
  }

  create(body: EventoCreateRequest): Observable<EventoDTO> {
    return this.http.post<EventoDTO>(environment.apiBaseUrl + API_PATHS.EVENTI, body)
      .pipe(tap(() => this.invalidateCalendarCache()));
  }

  update(id: string, body: EventoUpdateRequest): Observable<EventoDTO> {
    return this.http.put<EventoDTO>(`${environment.apiBaseUrl}${API_PATHS.EVENTI}/${id}`, body)
      .pipe(tap(() => this.invalidateCalendarCache()));
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiBaseUrl}${API_PATHS.EVENTI}/${id}`)
      .pipe(tap(() => this.invalidateCalendarCache()));
  }

  addPagamento(eventoId: string, body: PagamentoRequest): Observable<PagamentoEventoDTO> {
    return this.http.post<PagamentoEventoDTO>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/pagamenti`,
      body
    ).pipe(tap(() => this.invalidateCalendarCache()));
  }

  /** Carica il menu PDF dell'evento. Ritorna l'URL pubblica salvata. */
  uploadMenuPdf(eventoId: string, file: File): Observable<{ menuPdfUrl: string }> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<{ menuPdfUrl: string }>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/menu-pdf`,
      form
    );
  }

  /** Scarica il menu PDF autenticato e lo ritorna come Blob. */
  getMenuPdfBlob(eventoId: string): Observable<Blob> {
    return this.http.get(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/menu-pdf`,
      { responseType: 'blob' }
    );
  }

  /** Rimuove il menu PDF dell'evento. */
  deleteMenuPdf(eventoId: string): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/menu-pdf`
    );
  }

  getPartecipanti(eventoId: string): Observable<EventoPartecipanteDTO[]> {
    return this.http.get<EventoPartecipanteDTO[]>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/partecipanti`
    );
  }

  addPartecipante(eventoId: string, body: AggiungiPartecipanteRequest): Observable<EventoPartecipanteDTO> {
    return this.http.post<EventoPartecipanteDTO>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/partecipanti`,
      body
    );
  }

  deletePartecipante(id: number): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/partecipanti/${id}`
    );
  }

  getCostiDiretti(eventoId: string): Observable<EventoCostoDirettoDTO[]> {
    return this.http.get<EventoCostoDirettoDTO[]>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/costi-diretti`
    );
  }

  aggiungiCostoDiretto(eventoId: string, req: EventoCostoDirettoRequest): Observable<EventoCostoDirettoDTO> {
    return this.http.post<EventoCostoDirettoDTO>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/costi-diretti`,
      req
    ).pipe(tap(() => this.invalidateCalendarCache()));
  }

  rimuoviCostoDiretto(eventoId: string, costoId: number): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/costi-diretti/${costoId}`
    ).pipe(tap(() => this.invalidateCalendarCache()));
  }

  // ── Monitoring preventivato ────────────────────────────────────────────────
  getPreventivoTracking(eventoId: string): Observable<EventoPreventivoTrackingDTO[]> {
    return this.http.get<EventoPreventivoTrackingDTO[]>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/preventivo-tracking`
    );
  }

  savePreventivoTracking(eventoId: string, req: EventoPreventivoTrackingRequest): Observable<EventoPreventivoTrackingDTO> {
    return this.http.post<EventoPreventivoTrackingDTO>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/preventivo-tracking`,
      req
    );
  }

  deletePreventivoTracking(eventoId: string, trackingId: number): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/preventivo-tracking/${trackingId}`
    );
  }

  // ── Voci preventivo / consuntivo ───────────────────────────────────────────
  getVociCatalogo(): Observable<EventoVoceCatalogoDTO[]> {
    return this.http.get<EventoVoceCatalogoDTO[]>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/voci-catalogo`
    );
  }

  getVoci(eventoId: string): Observable<EventoVoceDTO[]> {
    return this.http.get<EventoVoceDTO[]>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/voci`
    );
  }

  aggiungiVoce(eventoId: string, req: EventoVoceRequest): Observable<EventoVoceDTO> {
    return this.http.post<EventoVoceDTO>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/${eventoId}/voci`,
      req
    ).pipe(tap(() => this.invalidateCalendarCache()));
  }

  updateVoce(voceId: number, req: EventoVoceRequest): Observable<EventoVoceDTO> {
    return this.http.put<EventoVoceDTO>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/voci/${voceId}`,
      req
    ).pipe(tap(() => this.invalidateCalendarCache()));
  }

  rimuoviVoce(voceId: number): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/voci/${voceId}`
    ).pipe(tap(() => this.invalidateCalendarCache()));
  }

  // ── Ore personale su evento ────────────────────────────────────────────────
  allocaOrePartecipante(partecipanteId: number, ore: number): Observable<EventoPartecipanteDTO> {
    return this.http.post<EventoPartecipanteDTO>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/partecipanti/${partecipanteId}/ore`,
      { ore }
    ).pipe(tap(() => this.invalidateCalendarCache()));
  }

  rimuoviOrePartecipante(partecipanteId: number): Observable<EventoPartecipanteDTO> {
    return this.http.delete<EventoPartecipanteDTO>(
      `${environment.apiBaseUrl}${API_PATHS.EVENTI}/partecipanti/${partecipanteId}/ore`
    ).pipe(tap(() => this.invalidateCalendarCache()));
  }

  getMiei(page = 0, size = 20): Observable<PagedResponse<EventoDTO>> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<PagedResponse<EventoDTO>>(
      environment.apiBaseUrl + API_PATHS.EVENTI_MIEI,
      { params }
    );
  }
}
