export type TipoMovimento = 'ENTRATA' | 'USCITA';
export type StatoMovimento = 'REGISTRATO' | 'DA_LIQUIDARE' | 'ANNULLATO';
export type FonteMovimento = 'MANUALE' | 'IMPORT_CSV' | 'STRIPE' | 'SATISPAY' | 'SHOPIFY' | 'BILLY' | 'APERTURA';

export interface MovimentoDTO {
  id: string;
  tipo: TipoMovimento;
  importo: number;
  importoImponibile: number | null;
  importoIva: number | null;
  importoCommissione: number | null;
  /** Data di competenza economica (impatto P&L / EBITDA). */
  dataMovimento: string;
  dataCompetenza: string | null;
  /** Data di liquidazione effettiva. null = DA_LIQUIDARE. */
  dataFinanziaria: string | null;
  /** Scadenza finanziaria attesa. Obbligatoria se dataFinanziaria è null. */
  dataLiquidita: string | null;
  contoBancarioId: number;
  metodoPagamentoId: number;
  businessUnitId: number;
  contoCoge: number;
  categoriaId: number | null;
  fornitoreId: string | null;
  eventoId: string | null;
  tipoEventoMovimento: string | null;
  descrizione: string;
  note: string | null;
  stato: StatoMovimento;
  fonte: string | null;
  riferimentoEsterno: string | null;
  allegatoPath: string | null;
  createdAt: string;
  createdBy: string;
  /**
   * Feature 1 — campo derivato (solo DA_LIQUIDARE non liquidi): giorni alla scadenza
   * (dataLiquidita − oggi). > 0 = mancano N giorni; 0 = scade oggi; < 0 = in ritardo di |N|
   * giorni (USCITA: ritardo sul pagamento; ENTRATA: ritardo nel pagarti). null se non pertinente.
   */
  giorniAllaScadenza: number | null;
}

export interface MovimentoCreateRequest {
  tipo: TipoMovimento;
  importo: number;
  importoLordo: number | null;
  aliquotaIva: number | null;
  /** Data di competenza economica. Sempre valorizzata. */
  dataMovimento: string;
  /** Alias economico (= dataMovimento). Garantisce mv_conto_economico_mensile. */
  dataCompetenza: string | null;
  /** Data di liquidazione effettiva. null = DA_LIQUIDARE. */
  dataFinanziaria: string | null;
  /** Scadenza finanziaria attesa. Obbligatoria se dataFinanziaria è null. Auto-set = dataFinanziaria se liquidato. */
  dataLiquidita: string | null;
  contoBancarioId: number | null;
  metodoPagamentoId: number | null;
  businessUnitId: number;
  contoCoge: number;
  categoriaId: number | null;
  fornitoreId: string | null;
  eventoId: string | null;
  tipoEventoMovimento: string | null;
  descrizione: string;
  note: string | null;
  riferimentoEsterno: string | null;
  fonte: string | null;
  allegatoPath: string | null;
}

export interface MovimentoUpdateRequest {
  tipo?: TipoMovimento | null;
  importo?: number | null;
  importoLordo?: number | null;
  aliquotaIva?: number | null;
  dataMovimento?: string | null;
  dataCompetenza?: string | null;
  /** Impostare per liquidare il movimento. null = rimane DA_LIQUIDARE. */
  dataFinanziaria?: string | null;
  dataLiquidita?: string | null;
  contoBancarioId?: number | null;
  metodoPagamentoId?: number | null;
  businessUnitId?: number | null;
  contoCoge?: number | null;
  categoriaId?: number | null;
  fornitoreId?: string | null;
  eventoId?: string | null;
  tipoEventoMovimento?: string | null;
  descrizione?: string | null;
  note?: string | null;
  riferimentoEsterno?: string | null;
  fonte?: string | null;
  allegatoPath?: string | null;
}

export interface MovimentiSommarioStatoSomma {
  stato: StatoMovimento;
  totaleEntrate: number;
  totaleUscite: number;
  netto: number;
  countEntrate: number;
  countUscite: number;
}

export interface MovimentiSommarioDTO {
  perStato: MovimentiSommarioStatoSomma[];
  totaleEntrate: number;
  totaleUscite: number;
  netto: number;
  totaleCount: number;
}

export interface BulkImportRequest {
  movimenti: MovimentoCreateRequest[];
}

export interface ImportError {
  riga: number;
  campo: string;
  motivo: string;
}

export interface BulkImportResponse {
  importati: number;
  duplicati: number;
  errori: number;
  dettaglioErrori: ImportError[];
}

// ── Import ETL (Billy / BPM / CA) ────────────────────────────────────────────

export type FonteImport = 'billy' | 'bpm' | 'ca';

export interface EtlRowError {
  riga: number;
  messaggio: string;
  rawData: Record<string, string>;
}

export interface EtlImportResponse {
  importLogId: string;
  importati: number;
  duplicati: number;
  ambigui: number;
  scartati: number;      // SKIP_POS / SKIP_GIROCONTO (Gate A)
  parcheggiati: number;  // PARK_EVENTO → eventi_da_riconciliare (Gate B)
  ricorrenti?: number;   // spese ricorrenti/finanziamenti parcheggiate (V9, flusso congiunto)
  errori: EtlRowError[];
  /** Avvisi non bloccanti: scontrini Billy non agganciati. messaggio prefissato da
   *  EVENTO_ATTESO: (incasso-evento) o SPACCIO_DA_VERIFICARE: (spaccio non riconciliato). */
  avvisi?: EtlRowError[];
  /** Feature 2 — righe banca intercettate che combaciano con un movimento DA_LIQUIDARE
   *  esistente (non persistite come nuovi movimenti; da risolvere nello smistamento). */
  matchingDifferiti?: number;
}

export interface ImportLogDTO {
  id: string;
  fonte: string;
  filename: string;
  dataImport: string;
  righeTotali: number | null;
  righeImportate: number | null;
  righeErrore: number | null;
  righeDuplicate: number | null;
  righeAmbigue: number | null;
  righeAmbigueClassificate: number | null;
  righeScartate: number | null;
  righeParcheggiate: number | null;
  stato: string;
  importedBy: string | null;
}

// ── Triage assistito / KPI / regole data-driven (ETL v2 §8/§9/§13) ──────────

export interface ImportKpiDTO {
  righeTotali: number;
  importate: number;
  ambigue: number;
  scartate: number;
  parcheggiate: number;
  movimentiTransitori: number;
  saldoTransitori: number;
  tassoAmbiguitaPct: number;
  coperturaFornitoriPct: number;
  ricaviTransitoriCount: number;
  ricaviDaClassificare: number;
  costiTransitoriCount: number;
  costiDaClassificare: number;
}

export interface RegolaClassificazioneDTO {
  id: number | null;
  priorita: number;
  sorgente: string;        // BILLY | CA | BPM | *
  tipoMovimento: string;   // ENTRATA | USCITA | *
  campo: string;           // CAUSALE | DESC_SPACED | DESC_COMPACT | IBAN
  matchType: string;       // EQUALS | CONTAINS | STARTS_WITH | REGEX | IN_LIST
  pattern: string;
  azione: string;          // SKIP_POS | SKIP_GIROCONTO | SKIP_RICORRENTE | PARK_EVENTO | MAP
  cogeCodice: string | null;
  buId: number | null;
  metodoCodice: string | null;
  confidence: number | null;
  attivo: boolean;
  note: string | null;
}

// ── Centro smistamento import: transitori + eventi parcheggiati ─────────────

export interface TransitorioDTO {
  id: string;
  tipo: string;               // ENTRATA | USCITA
  importo: number;
  dataMovimento: string;
  descrizione: string;
  cogeCodiceAttuale: string;  // 39.99.999 | 49.99.999
  fornitoreId: string | null;
  contoBancarioId: number | null;
  ibanEstratto: string | null;
  controparteEstratta: string | null;
}

export interface ClassificaTransitorioRequest {
  cogeId: number;
  businessUnitId: number;
  fornitoreId: string | null;
  apprendiKeyword: boolean;
  nota: string | null;
}

// ── Quadratura di periodo POS (Billy = verità) ──────────────────────────────
// Pannello informativo che sostituisce la vecchia vista "Incassi POS da ripartire" a scontrino:
// confronto Σ Billy elettronico ↔ Σ POS banca scomposto per causa (PROMPT-RICONCILIAZIONE-PERIODO §5).
export interface InAttesaDTO {
  data: string | null;
  importo: number;
  rif: string;
  descrizione: string;
}

export interface QuadraturaPeriodoDTO {
  importLogId: string;
  importDataOra: string | null;
  anno: number;
  billyElettronicoNonAgri: number;
  billyContabilizzato: number;
  posBancaTotale: number;
  posBancaCore: number;
  sigmaBpm: number;
  sigmaCa: number;
  assegnatoBpm: number;
  assegnatoCa: number;
  codaTesta: number;
  codaFondo: number;
  residuoCore: number;
  maxDelBanca: string | null;
  note: string[];
  approssimazioni: string[];
  inAttesa: InAttesaDTO[];
}

export interface EventoParcheggiatoDTO {
  id: string;
  fonte: string;
  chiaveAggancio: string | null;
  dataMovimento: string | null;
  importo: number;
  tipo: string;
  contoBancarioId: number | null;
  descrizioneNorm: string | null;
  tipoEventoPresunto: string | null;  // CAPARRA | ACCONTO | SALDO | AFFITTO_SALA | null
  keywordMatch: string | null;
  controparteNome: string | null;
  controparteIban: string | null;
  dataEventoEstratta: string | null;
  stato: string;                       // DA_RICONCILIARE | RICONCILIATO | SCARTATO
}

export interface RisolviEventoRequest {
  azione: 'SCARTA' | 'CLASSIFICA' | 'RICONCILIA';
  cogeId: number | null;
  businessUnitId: number | null;
  eventoId: string | null;
  nota: string | null;
}

// ── Analisi duplicati eventi (aggancio cross-sorgente senza chiave) ────────────

export type TonoMotivo = 'FORTE' | 'MEDIO' | 'DEBOLE' | 'CONFLITTO';

export interface MotivoMatchDTO {
  segnale: string;
  dettaglio: string;
  tono: TonoMotivo;
}

export interface EventoBreveDTO {
  id: string;
  fonte: string;                     // IMPORT_BILLY | IMPORT_BANCA
  dataMovimento: string | null;
  importo: number;
  tipo: string;
  controparteNome: string | null;
  controparteIban: string | null;
  dataEvento: string | null;
  tipoEvento: string | null;
  descrizione: string | null;
}

export interface CoppiaSospettaDTO {
  confidenza: 'CERTA' | 'PROBABILE';
  punteggio: number;                 // 0-100
  eventoA: EventoBreveDTO;
  eventoB: EventoBreveDTO;
  motivi: MotivoMatchDTO[];
}

export interface AnalisiDuplicatiDTO {
  eventiInCoda: number;
  coppieSospette: number;
  coppie: CoppiaSospettaDTO[];
}

export interface AmbiguitaDTO {
  id: string;
  importLogId: string;
  rigaNumero: number;
  fonte: string;
  rawData: Record<string, string>;
  motivo: string;
  stato: string;
  movimentoId: string | null;
  classificatoAt: string | null;
  noteOperatore: string | null;
}

export interface ClassificaAmbiguitaRequest {
  cogeId: number | null;
  businessUnitId: number | null;
  metodoPagamentoId: number | null;
  contoBancarioId: number | null;
  fornitoreId: string | null;
  eventoId: string | null;
  tipoEventoMovimento: string | null;
  nota: string | null;
  apprendiKeyword: boolean;
  scarta: boolean;
}

// ── Gestione Keyword (PROMPT-KEYWORD-LEARNING.md §4.8) ──────────────────────

export interface KeywordFirmaDTO {
  id: string | null;
  natura: 'DOMINIO' | 'IDENTITA';
  azione: 'BOOK' | 'PARK_EVENTO';
  tipoMovimento: string;   // ENTRATA | USCITA | *
  sorgente: string;        // BILLY | BPM | CA | *
  buId: number | null;
  cogeCodice: string | null;
  fornitoreId: string | null;
  eventoForza: string | null;   // FORTE | DEBOLE
  tipoEvento: string | null;
  confidence: number | null;
  origine: string | null;       // APPRESA | MANUALE | SEED
  stato: string | null;         // ATTIVA | IN_CONFLITTO | DISATTIVATA
  note: string | null;
  token: string[];
  createdAt: string | null;
}

export interface KeywordConflittoDTO {
  id: string;
  tipo: string;            // APPRENDIMENTO | MATCH
  stato: string;           // APERTO | RISOLTO | IGNORATO
  signatureHash: string | null;
  firmaEsistenteId: string | null;
  movimentoId: string | null;
  targetEsistente: string | null;
  targetNuovo: string | null;
  descrizione: string | null;
  createdAt: string | null;
}

export interface RisolviConflittoKeywordRequest {
  azione: 'TIENI_ESISTENTE' | 'USA_NUOVO' | 'SCARTA';
  note: string | null;
}

export interface KeywordAnteprimaFirma {
  token: string[];
  natura: 'DOMINIO' | 'IDENTITA';
}

export interface KeywordAnteprimaDTO {
  firme: KeywordAnteprimaFirma[];
}

// ── Parcheggio spese ricorrenti / finanziamenti (V9) ────────────────────────

export interface RicorrenteParcheggiataDTO {
  id: string;
  fonte: string;
  dataMovimento: string | null;
  importo: number;
  tipo: string;
  contoBancarioId: number | null;
  descrizione: string;
  tipoPresunto: string;   // MUTUO | FINANZIAMENTO | LEASING | CANONE | CAMBIALE | ASSICURAZIONE | BOLLO | RATA | ALTRO
  recurringPlanId: string | null;
  stato: string;          // DA_RICONCILIARE | CONFERMATA | IGNORATA | RICONCILIATA(legacy)
  cogeSuggeritoId: number | null;
  cogeSuggeritoCodice: string | null;
}

export interface RisolviRicorrenteRequest {
  azione: 'COLLEGA' | 'CONFERMA' | 'IGNORA';
  cogeId: number | null;   // obbligatorio su CONFERMA di una USCITA; ignorato su ENTRATA
  /** Obbligatori su COLLEGA: la rata del piano a cui agganciare l'addebito. */
  pianoId?: string | null;
  rataId?: string | null;
  nota: string | null;
}

/**
 * Feature 2 — Matching differiti: riga banca intercettata dall'import che combacia (importo al
 * centesimo + descrizione) con un movimento MANUALE già presente in stato DA_LIQUIDARE. Espone
 * entrambi i lati del match (movimento esistente + riga banca) per la riconciliazione manuale.
 */
export interface MatchingDifferitoDTO {
  id: string;
  importLogId: string;
  // Lato movimento Da Liquidare esistente
  movimentoId: string;
  movimentoTipo: TipoMovimento;
  movimentoDataMovimento: string | null;
  movimentoDataLiquidita: string | null;
  movimentoImporto: number;
  movimentoDescrizione: string | null;
  movimentoStato: string;
  movimentoFonte: string | null;
  // Lato riga banca intercettata
  fonte: string;             // IMPORT_BANCA | IMPORT_BILLY
  rigaNumero: number | null;
  dataBanca: string | null;
  importo: number;
  descrizione: string | null;
  contoBancarioId: number | null;
  // Stato risoluzione
  stato: string;             // DA_RICONCILIARE | COLLEGATO | IGNORATO
  note: string | null;
  risoltoAt: string | null;
  risoltoBy: string | null;
  createdAt: string | null;
}

export interface RisolviMatchingDifferitoRequest {
  azione: 'COLLEGA' | 'IGNORA';
  /** opzionale per COLLEGA: override del metodo di pagamento da usare in liquidazione. */
  metodoPagamentoId: number | null;
  nota: string | null;
}
