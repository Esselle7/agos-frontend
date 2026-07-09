import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BulkImportResponse,
  MovimentoCreateRequest,
  MovimentoDTO,
  MovimentoUpdateRequest,
  MovimentiSommarioDTO,
  EtlImportResponse,
  ImportLogDTO,
  AmbiguitaDTO,
  ClassificaAmbiguitaRequest,
  ImportKpiDTO,
  RegolaClassificazioneDTO,
  TransitorioDTO,
  ClassificaTransitorioRequest,
  EventoParcheggiatoDTO,
  RisolviEventoRequest,
  AnalisiDuplicatiDTO,
  KeywordFirmaDTO,
  KeywordConflittoDTO,
  RisolviConflittoKeywordRequest,
  KeywordAnteprimaDTO,
  RicorrenteParcheggiataDTO,
  RisolviRicorrenteRequest,
  QuadraturaPeriodoDTO,
  MatchingDifferitoDTO,
  RisolviMatchingDifferitoRequest,
} from '../models/movimenti.models';
import { PagedResponse, MovimentoDTOShared } from '../models/shared.models';
import { API_PATHS } from '../constants/api-paths';
import { environment } from '../../../environments/environment';

export interface MovimentiFilter {
  from?: string;
  to?: string;
  tipo?: 'ENTRATA' | 'USCITA';
  buId?: number;
  categoriaId?: number;
  metodoPagamentoId?: number;
  stato?: string;
  fornitoreId?: string;
  eventoId?: string;
  search?: string;
  page?: number;
  size?: number;
  sort?: string;
}

@Injectable({ providedIn: 'root' })
export class MovimentiService {
  private readonly http = inject(HttpClient);

  getList(filter: MovimentiFilter = {}): Observable<PagedResponse<MovimentoDTO>> {
    let params = new HttpParams();
    if (filter.from != null) params = params.set('from', filter.from);
    if (filter.to != null) params = params.set('to', filter.to);
    if (filter.tipo != null) params = params.set('tipo', filter.tipo);
    if (filter.buId != null) params = params.set('buId', filter.buId);
    if (filter.categoriaId != null) params = params.set('categoriaId', filter.categoriaId);
    if (filter.metodoPagamentoId != null) params = params.set('metodoPagamentoId', filter.metodoPagamentoId);
    if (filter.stato != null) params = params.set('stato', filter.stato);
    if (filter.fornitoreId != null) params = params.set('fornitoreId', filter.fornitoreId);
    if (filter.eventoId != null) params = params.set('eventoId', filter.eventoId);
    if (filter.search != null) params = params.set('search', filter.search);
    if (filter.page != null) params = params.set('page', filter.page);
    if (filter.size != null) params = params.set('size', filter.size);
    if (filter.sort != null) params = params.set('sort', filter.sort);
    return this.http.get<PagedResponse<MovimentoDTO>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.BASE,
      { params }
    );
  }

  getSommario(filter: Omit<MovimentiFilter, 'page' | 'size' | 'sort'> = {}): Observable<MovimentiSommarioDTO> {
    let params = new HttpParams();
    if (filter.from != null) params = params.set('from', filter.from);
    if (filter.to != null) params = params.set('to', filter.to);
    if (filter.tipo != null) params = params.set('tipo', filter.tipo);
    if (filter.buId != null) params = params.set('buId', filter.buId);
    if (filter.categoriaId != null) params = params.set('categoriaId', filter.categoriaId);
    if (filter.metodoPagamentoId != null) params = params.set('metodoPagamentoId', filter.metodoPagamentoId);
    if (filter.stato != null) params = params.set('stato', filter.stato);
    if (filter.fornitoreId != null) params = params.set('fornitoreId', filter.fornitoreId);
    if (filter.eventoId != null) params = params.set('eventoId', filter.eventoId);
    if (filter.search != null) params = params.set('search', filter.search);
    return this.http.get<MovimentiSommarioDTO>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.SOMMARIO,
      { params }
    );
  }

  getById(id: string): Observable<MovimentoDTO> {
    return this.http.get<MovimentoDTO>(
      `${environment.apiBaseUrl}${API_PATHS.MOVIMENTI.BASE}/${id}`
    );
  }

  /** Movimenti attivi non ancora attribuiti a un conto/cassa (da catalogare a mano). */
  getSenzaBanca(): Observable<MovimentoDTOShared[]> {
    return this.http.get<MovimentoDTOShared[]>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.SENZA_BANCA
    );
  }

  /** Crediti (ENTRATA) / debiti (USCITA) di apertura pre-2026 da liquidare. */
  getPartiteApertura(tipo: 'ENTRATA' | 'USCITA'): Observable<MovimentoDTOShared[]> {
    return this.http.get<MovimentoDTOShared[]>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.PARTITE_APERTURA, { params: { tipo } }
    );
  }

  /** Attribuisce un movimento a un conto/cassa (PATCH mirato: tocca solo conto_bancario_id). */
  assegnaConto(id: string, contoBancarioId: number): Observable<MovimentoDTO> {
    return this.http.patch<MovimentoDTO>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.ASSEGNA_CONTO(id),
      { contoBancarioId }
    );
  }

  create(body: MovimentoCreateRequest): Observable<MovimentoDTO> {
    return this.http.post<MovimentoDTO>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.BASE,
      body
    );
  }

  update(id: string, body: MovimentoUpdateRequest): Observable<MovimentoDTO> {
    return this.http.put<MovimentoDTO>(
      `${environment.apiBaseUrl}${API_PATHS.MOVIMENTI.BASE}/${id}`,
      body
    );
  }

  liquida(id: string, contoBancarioId: number, metodoPagamentoId?: number): Observable<MovimentoDTO> {
    return this.http.patch<MovimentoDTO>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.LIQUIDA(id),
      { contoBancarioId, metodoPagamentoId: metodoPagamentoId ?? null }
    );
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiBaseUrl}${API_PATHS.MOVIMENTI.BASE}/${id}`
    );
  }

  bulkImport(movimenti: MovimentoCreateRequest[]): Observable<BulkImportResponse> {
    return this.http.post<BulkImportResponse>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.BULK,
      { movimenti }
    );
  }

  // ── Import ETL CONGIUNTO (unica modalità: Billy + BPM + CA insieme) ───────────

  /**
   * Import CONGIUNTO: i 3 file (Billy + BPM + CA) dello stesso periodo, caricati e
   * riconciliati insieme in un'unica operazione (rollback atomico). L'import single-file
   * è stato rimosso (PROMPT-KEYWORD-LEARNING.md §4.9).
   */
  importCongiunto(billy: File, bpm: File, ca: File): Observable<EtlImportResponse> {
    const fd = new FormData();
    fd.append('billy', billy, billy.name);
    fd.append('bpm', bpm, bpm.name);
    fd.append('ca', ca, ca.name);
    fd.append('filenameBilly', billy.name);
    fd.append('filenameBpm', bpm.name);
    fd.append('filenameCa', ca.name);
    return this.http.post<EtlImportResponse>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_CONGIUNTO, fd);
  }

  getImportHistory(fonte?: string, page = 0, size = 20): Observable<PagedResponse<ImportLogDTO>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (fonte) params = params.set('fonte', fonte);
    return this.http.get<PagedResponse<ImportLogDTO>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_HISTORY,
      { params }
    );
  }

  getAmbiguita(importLogId: string, stato?: string, page = 0, size = 50): Observable<PagedResponse<AmbiguitaDTO>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (stato) params = params.set('stato', stato);
    return this.http.get<PagedResponse<AmbiguitaDTO>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_AMBIGUITA(importLogId),
      { params }
    );
  }

  classificaAmbiguita(id: string, req: ClassificaAmbiguitaRequest): Observable<void> {
    return this.http.put<void>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.CLASSIFICA_AMBIGUITA(id),
      req
    );
  }

  // ── Triage assistito / KPI / regole data-driven (ETL v2 §8/§9/§13) ──────────

  getImportKpi(): Observable<ImportKpiDTO> {
    return this.http.get<ImportKpiDTO>(environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_KPI);
  }

  getRegole(): Observable<RegolaClassificazioneDTO[]> {
    return this.http.get<RegolaClassificazioneDTO[]>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_REGOLE
    );
  }

  createRegola(regola: RegolaClassificazioneDTO): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_REGOLE, regola
    );
  }

  setRegolaAttiva(id: number, attiva: boolean): Observable<void> {
    let params = new HttpParams().set('attiva', attiva);
    return this.http.put<void>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_REGOLA_ATTIVA(id), null, { params }
    );
  }

  deleteRegola(id: number): Observable<void> {
    return this.http.delete<void>(environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_REGOLA(id));
  }

  rollbackImport(importLogId: string): Observable<Record<string, unknown>> {
    return this.http.delete<Record<string, unknown>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_ROLLBACK(importLogId)
    );
  }

  // ── Centro smistamento: transitori ──────────────────────────────────────────

  getTransitori(tipo?: string, page = 0, size = 20): Observable<PagedResponse<TransitorioDTO>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (tipo) params = params.set('tipo', tipo);
    return this.http.get<PagedResponse<TransitorioDTO>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_TRANSITORI, { params }
    );
  }

  classificaTransitorio(movimentoId: string, req: ClassificaTransitorioRequest): Observable<void> {
    return this.http.put<void>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_TRANSITORIO_CLASSIFICA(movimentoId), req
    );
  }

  // ── Centro smistamento: eventi parcheggiati ─────────────────────────────────

  getEventiParcheggiati(stato = 'DA_RICONCILIARE', page = 0, size = 20): Observable<PagedResponse<EventoParcheggiatoDTO>> {
    const params = new HttpParams().set('stato', stato).set('page', page).set('size', size);
    return this.http.get<PagedResponse<EventoParcheggiatoDTO>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_EVENTI, { params }
    );
  }

  risolviEvento(id: string, req: RisolviEventoRequest): Observable<void> {
    return this.http.put<void>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_EVENTO_RISOLVI(id), req
    );
  }

  // ── Parcheggio spese ricorrenti (V9) + vista RiBa ───────────────────────────

  getRicorrenti(stato = 'DA_RICONCILIARE', page = 0, size = 2000): Observable<PagedResponse<RicorrenteParcheggiataDTO>> {
    const params = new HttpParams().set('stato', stato).set('page', page).set('size', size);
    return this.http.get<PagedResponse<RicorrenteParcheggiataDTO>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_RICORRENTI, { params });
  }

  risolviRicorrente(id: string, req: RisolviRicorrenteRequest): Observable<void> {
    return this.http.put<void>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_RICORRENTE_RISOLVI(id), req);
  }

  getRibaTransitori(page = 0, size = 2000): Observable<PagedResponse<TransitorioDTO>> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<PagedResponse<TransitorioDTO>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_TRANSITORI_RIBA, { params });
  }

  // ── Feature 1: movimenti DA_LIQUIDARE scaduti (in ritardo) ──────────────────

  /** Movimenti Da Liquidare con scadenza superata (in ritardo). tipo opzionale ENTRATA/USCITA. */
  getDaLiquidareInRitardo(tipo?: 'ENTRATA' | 'USCITA', page = 0, size = 50, sort?: string): Observable<PagedResponse<MovimentoDTO>> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (tipo) params = params.set('tipo', tipo);
    if (sort) params = params.set('sort', sort);
    return this.http.get<PagedResponse<MovimentoDTO>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.DA_LIQUIDARE_RITARDO, { params });
  }

  // ── Feature 2: matching differiti (import banche ↔ movimenti Da Liquidare) ───

  getMatchingDifferiti(stato = 'DA_RICONCILIARE', page = 0, size = 2000): Observable<PagedResponse<MatchingDifferitoDTO>> {
    const params = new HttpParams().set('stato', stato).set('page', page).set('size', size);
    return this.http.get<PagedResponse<MatchingDifferitoDTO>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_MATCHING_DIFFERITI, { params });
  }

  risolviMatchingDifferito(id: string, req: RisolviMatchingDifferitoRequest): Observable<void> {
    return this.http.put<void>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_MATCHING_DIFFERITO_RISOLVI(id), req);
  }

  /**
   * Quadratura di periodo dell'ultimo import congiunto (o di {@code importLogId} se passato).
   * 204 (body vuoto) se non c'è ancora nessuna quadratura → ritorna null.
   */
  getQuadratura(importLogId?: string): Observable<QuadraturaPeriodoDTO | null> {
    let params = new HttpParams();
    if (importLogId) params = params.set('importLogId', importLogId);
    return this.http.get<QuadraturaPeriodoDTO | null>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_QUADRATURA, { params });
  }

  /** Coppie di eventi sospette duplicate (confidenza + motivazioni), per la revisione. */
  getAnalisiDuplicati(): Observable<AnalisiDuplicatiDTO> {
    return this.http.get<AnalisiDuplicatiDTO>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_ANALISI_DUPLICATI
    );
  }

  // ── Gestione Keyword (PROMPT-KEYWORD-LEARNING.md §4.8) ──────────────────────

  getKeyword(natura?: string, stato?: string): Observable<KeywordFirmaDTO[]> {
    let params = new HttpParams();
    if (natura) params = params.set('natura', natura);
    if (stato) params = params.set('stato', stato);
    return this.http.get<KeywordFirmaDTO[]>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.KEYWORD, { params }
    );
  }

  createKeyword(firma: KeywordFirmaDTO): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.KEYWORD, firma
    );
  }

  updateKeyword(id: string, firma: KeywordFirmaDTO): Observable<void> {
    return this.http.put<void>(environment.apiBaseUrl + API_PATHS.MOVIMENTI.KEYWORD_ID(id), firma);
  }

  deleteKeyword(id: string): Observable<void> {
    return this.http.delete<void>(environment.apiBaseUrl + API_PATHS.MOVIMENTI.KEYWORD_ID(id));
  }

  getKeywordConflitti(stato?: string): Observable<KeywordConflittoDTO[]> {
    let params = new HttpParams();
    if (stato) params = params.set('stato', stato);
    return this.http.get<KeywordConflittoDTO[]>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.KEYWORD_CONFLITTI, { params }
    );
  }

  risolviKeywordConflitto(id: string, req: RisolviConflittoKeywordRequest): Observable<void> {
    return this.http.put<void>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.KEYWORD_CONFLITTO_RISOLVI(id), req
    );
  }

  /** Firme attive che si contendono la riga di un conflitto MATCH ("In import"). */
  getKeywordConflittoFirme(id: string): Observable<KeywordFirmaDTO[]> {
    return this.http.get<KeywordFirmaDTO[]>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.KEYWORD_CONFLITTO_FIRME(id)
    );
  }

  /** Chiude i conflitti MATCH non più ambigui e ri-cataloga i movimenti incastrati. */
  rivalutaKeywordConflitti(): Observable<{ chiusi: number; catalogati: number }> {
    return this.http.post<{ chiusi: number; catalogati: number }>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.KEYWORD_CONFLITTI_RIVALUTA, {}
    );
  }

  /** Anteprima delle keyword che verrebbero apprese da una descrizione (per il triage). */
  anteprimaKeyword(descrizione: string, sorgente?: string): Observable<KeywordAnteprimaDTO> {
    return this.http.post<KeywordAnteprimaDTO>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.KEYWORD_ANTEPRIMA, { descrizione, sorgente: sorgente ?? null }
    );
  }
}
