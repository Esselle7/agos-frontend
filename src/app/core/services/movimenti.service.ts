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
  ImportBadgeDTO,
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
  RicorrenteParcheggiataDTO,
  RisolviRicorrenteRequest,
  ScartatoDTO,
  RisolviScartatoRequest,
  QuadraturaPeriodoDTO,
  MatchingDifferitoDTO,
  RisolviMatchingDifferitoRequest,
  BuPanelDTO,
  ContatoreImportDTO,
  RigaImportDTO,
  RegistroImportDTO,
  SpostaRigaRequest,
} from '../models/movimenti.models';
import { PagedResponse, MovimentoDTOShared } from '../models/shared.models';
import { API_PATHS } from '../constants/api-paths';
import { environment } from '../../../environments/environment';

/** A quale delle tre date del modello si applica il range from/to. */
export type DateField = 'MOVIMENTO' | 'FINANZIARIA' | 'LIQUIDITA';

/**
 * Filtri della lista movimenti (docs/specs/movimenti-filtri-avanzati.md).
 * Ogni dimensione è un array: i valori vanno in OR fra loro, le dimensioni in AND.
 * `contoId: 0` è la sentinella per «senza banca» (conto_bancario_id IS NULL).
 */
/** Una quota della divisione di un movimento cumulativo (spec riba-split-importo). */
export interface QuotaDivisione {
  importo: number;
  contoCogeId: number;
  businessUnitId: number;
  fornitoreId?: string | null;
  descrizione?: string | null;
}

export interface MovimentiFilter {
  from?: string;
  to?: string;
  dateField?: DateField;
  tipo?: string[];
  stato?: string[];
  fonte?: string[];
  contoId?: number[];
  cogeId?: number[];
  buId?: number[];
  categoriaId?: number[];
  metodoPagamentoId?: number[];
  fornitoreId?: string[];
  eventoId?: string[];
  importoMin?: number | null;
  importoMax?: number | null;
  search?: string;
  page?: number;
  size?: number;
  sort?: string;
}

@Injectable({ providedIn: 'root' })
export class MovimentiService {
  private readonly http = inject(HttpClient);

  /**
   * Costruisce la query string dei filtri. Unica fonte di verità condivisa da lista e sommario:
   * i due endpoint devono vedere gli stessi criteri, e duplicare la costruzione qui li farebbe
   * divergere esattamente come divergevano le firme lato server.
   * Le dimensioni multi-valore diventano parametri ripetuti (?stato=A&stato=B).
   */
  private buildFilterParams(filter: MovimentiFilter): HttpParams {
    let params = new HttpParams();

    const appendAll = (key: string, values?: readonly (string | number)[]) => {
      for (const v of values ?? []) {
        if (v !== null && v !== undefined) params = params.append(key, v);
      }
    };

    appendAll('tipo', filter.tipo);
    appendAll('stato', filter.stato);
    appendAll('fonte', filter.fonte);
    appendAll('contoId', filter.contoId);
    appendAll('cogeId', filter.cogeId);
    appendAll('buId', filter.buId);
    appendAll('categoriaId', filter.categoriaId);
    appendAll('metodoPagamentoId', filter.metodoPagamentoId);
    appendAll('fornitoreId', filter.fornitoreId);
    appendAll('eventoId', filter.eventoId);

    if (filter.importoMin != null) params = params.set('importoMin', filter.importoMin);
    if (filter.importoMax != null) params = params.set('importoMax', filter.importoMax);
    // dateField si manda solo se diverso dal default: query più corta e leggibile in rete.
    if (filter.dateField && filter.dateField !== 'MOVIMENTO') params = params.set('dateField', filter.dateField);
    if (filter.from != null) params = params.set('from', filter.from);
    if (filter.to != null) params = params.set('to', filter.to);
    if (filter.search) params = params.set('search', filter.search);

    return params;
  }

  getList(filter: MovimentiFilter = {}): Observable<PagedResponse<MovimentoDTO>> {
    let params = this.buildFilterParams(filter);
    if (filter.page != null) params = params.set('page', filter.page);
    if (filter.size != null) params = params.set('size', filter.size);
    if (filter.sort != null) params = params.set('sort', filter.sort);
    return this.http.get<PagedResponse<MovimentoDTO>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.BASE,
      { params }
    );
  }

  getSommario(filter: Omit<MovimentiFilter, 'page' | 'size' | 'sort'> = {}): Observable<MovimentiSommarioDTO> {
    return this.http.get<MovimentiSommarioDTO>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.SOMMARIO,
      { params: this.buildFilterParams(filter) }
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

  /**
   * Divide un movimento cumulativo (RiBa/effetti) in N quote — spec riba-split-importo.
   * La quadratura la verifica il server: qui non si arrotonda niente.
   */
  dividi(id: string, quote: QuotaDivisione[]): Observable<MovimentoDTO[]> {
    return this.http.post<MovimentoDTO[]>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.DIVIDI(id),
      { quote }
    );
  }

  /** ATTENZIONE: non cancella, ANNULLA (il server scrive stato = ANNULLATO). */
  delete(id: string): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiBaseUrl}${API_PATHS.MOVIMENTI.BASE}/${id}`
    );
  }

  /** Cancellazione FISICA di un movimento già annullato: la riga sparisce dal database. */
  cestina(id: string): Observable<void> {
    return this.http.delete<void>(environment.apiBaseUrl + API_PATHS.MOVIMENTI.CESTINA(id));
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

  /** "Va che è un evento": sposta la riga ambigua nella coda degli incassi-evento. */
  ambiguitaEUnEvento(id: string): Observable<void> {
    return this.http.put<void>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.AMBIGUITA_E_UN_EVENTO(id), {}
    );
  }

  // ── Triage assistito / KPI / regole data-driven (ETL v2 §8/§9/§13) ──────────

  getImportKpi(): Observable<ImportKpiDTO> {
    return this.http.get<ImportKpiDTO>(environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_KPI);
  }

  /** I contatori dei badge + l'id dell'ultimo import: sostituisce 6 liste con size=1 e /history. */
  getImportBadge(): Observable<ImportBadgeDTO> {
    return this.http.get<ImportBadgeDTO>(environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_BADGE);
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

  /**
   * ponytail: TEMPORANEO (SPEC bpm-luglio-2026-recupero.md R8) — ri-manda nel motore le righe
   * ancora in coda per questo import. Si cancella insieme al bottone dello Storico import.
   */
  riprocessaCodaImport(importLogId: string): Observable<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_RIPROCESSA(importLogId), {}
    );
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

  // ── Coda «Righe fuori dai conti» (audit §7.4) ───────────────────────────────

  getScartati(stato = 'DA_VEDERE', page = 0, size = 2000): Observable<PagedResponse<ScartatoDTO>> {
    const params = new HttpParams().set('stato', stato).set('page', page).set('size', size);
    return this.http.get<PagedResponse<ScartatoDTO>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_SCARTATI, { params });
  }

  risolviScartato(id: string, req: RisolviScartatoRequest): Observable<void> {
    return this.http.put<void>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_SCARTATO_RISOLVI(id), req);
  }

  /**
   * Rimanda una riga del transitorio alla coda giusta. Il movimento sparisce e il suo importo
   * esce dai saldi finché la coda non lo risolve: lo stesso trattamento delle righe che l'import
   * parcheggia da solo.
   */
  spostaInCoda(movimentoId: string, req: SpostaRigaRequest): Observable<void> {
    return this.http.put<void>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_TRANSITORIO_SPOSTA(movimentoId), req);
  }

  // ── Contatore e registro dell'import (SPEC import-v2 §5/§6) ─────────────────

  /** Quanto è uscito dalle banche e dove si trova adesso, al centesimo e per direzione. */
  getContatoreImport(importLogId: string): Observable<ContatoreImportDTO> {
    return this.http.get<ContatoreImportDTO>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_CONTATORE(importLogId));
  }

  /** Il registro: tutte le righe bancarie dell'import, con stato, filtri e ricerca. */
  getRigheImport(importLogId: string, f: {
    stato?: string; conto?: number; da?: string; a?: string; q?: string;
  } = {}, page = 0, size = 50): Observable<RegistroImportDTO> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (f.stato) params = params.set('stato', f.stato);
    if (f.conto != null) params = params.set('conto', f.conto);
    if (f.da) params = params.set('da', f.da);
    if (f.a) params = params.set('a', f.a);
    if (f.q) params = params.set('q', f.q);
    return this.http.get<RegistroImportDTO>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_RIGHE(importLogId), { params });
  }

  /** Rami storicamente usati per ogni conto: il wizard chiede la BU solo se ce n'è più d'uno. */
  getBuPerCoge(): Observable<Record<number, number[]>> {
    return this.http.get<Record<number, number[]>>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_BU_PER_COGE);
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

  // ── Pannello BU dell'import ─────────────────────────────────────────────────

  /** Movimenti dell'import raggruppati per BU, con la coda "da assegnare" a parte. */
  getBuPanel(importLogId: string): Observable<BuPanelDTO> {
    return this.http.get<BuPanelDTO>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_BU_PANEL(importLogId));
  }

  /** Sposta un movimento su un'altra BU. Dimensione analitica: nessun saldo si muove. */
  cambiaBu(importLogId: string, movimentoId: string, businessUnitId: number): Observable<void> {
    return this.http.put<void>(
      environment.apiBaseUrl + API_PATHS.MOVIMENTI.IMPORT_BU_CAMBIA(importLogId, movimentoId),
      { businessUnitId });
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

  // `anteprimaKeyword()` è stata rimossa il 13/08/2026: era morta da quando il wizard ha sostituito
  // il vecchio dialog di triage, e l'anteprima ora viaggia dentro TransitorioDTO.firmeDaImparare —
  // stessa estrazione del server, zero round-trip per riga. L'endpoint /keyword/anteprima resta
  // vivo lato server.
}
