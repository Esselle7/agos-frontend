export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface BuRefDTO {
  id: number;
  nome: string;
}

export interface VoceDTO {
  codiceCoge: string;
  categoria: string;
  importo: number;
  pct: number;
}

export interface RicaviDTO {
  totale: number;
  perCategoria: VoceDTO[];
}

export interface CostiDTO {
  totale: number;
  capex: number;
  perCategoria: VoceDTO[];
}

/**
 * Fase 6 — attendibilità del numero esposto: non cambia il totale, dichiara quanto di esso
 * è ancora su conti transitori, quanto è credito non incassato, e se il periodo richiesto
 * comprende mesi anteriori al go-live (dove i costi non ci sono).
 */
export interface QualitaDTO {
  nonClassificatoRicavi: number;
  nonClassificatoRicaviPct: number;
  nonClassificatoCosti: number;
  nonClassificatoCostiPct: number;
  creditiEventiAperti: number;
  perimetroIncompleto: boolean;
  perimetroNota: string | null;
}

export interface PlDTO {
  bu: BuRefDTO;
  from: string;
  to: string;
  ricavi: RicaviDTO;
  costi: CostiDTO;
  ebitda: number;
  marginePct: number;
  ammortamenti: number;
  ebit: number;
  oneriFinanziari: number;
  ebt: number;
  imposte: number;
  utileNetto: number;
  qualita: QualitaDTO;
}

export interface BuPlRiepilogoDTO {
  bu: BuRefDTO;
  ricavi: number;
  costi: number;
  ebitda: number;
  marginePct: number;
  ebit: number;
  utileNetto: number;
}

export interface TotaleConsolidatoDTO {
  ricavi: number;
  costi: number;
  ebitda: number;
  ammortamenti: number;
  ebit: number;
  oneriFinanziari: number;
  imposte: number;
  utileNetto: number;
  marginePct: number;
}

export interface PlComparativoDTO {
  from: string;
  to: string;
  businessUnits: BuPlRiepilogoDTO[];
  totaleConsolidato: TotaleConsolidatoDTO;
  qualita: QualitaDTO;
}

export interface CashFlowPeriodoDTO {
  periodoInizio: string;
  periodoFine: string;
  entrate: number;
  uscite: number;
  saldoPeriodo: number;
  saldoCumulato: number;
}

export interface ForecastPointDTO {
  data: string;
  tipo: string;
  entratePreviste: number;
  uscitePreviste: number;
  liquiditaProiettata: number;
  note: string | null;
}

export interface JobStatusDTO {
  jobId: string;
  status: JobStatus;
  result: PlDTO | null;
  error: string | null;
}

export interface RiepilogoCategoriaDTO {
  codiceCoge: string;
  categoria: string;
  importo: number;
  pct: number;
}

// ── Forecasting ──────────────────────────────────────────────────────────────

export type ForecastingHorizon = '30' | '60' | '90' | '180' | 'FINE_ANNO';
export type ForecastingCategoria = 'MOVIMENTO' | 'EVENTO' | 'RATA_RICORRENTE' | 'RATA_RICORRENTE_CAPITALE' | 'RATA_RICORRENTE_INTERESSI' | 'STIPENDIO';
export type ForecastingVista = 'ECONOMICA' | 'FINANZIARIA' | 'ENTRAMBE';
export type ForecastingAffidabilita = 'CERTO' | 'STIMATO';

export interface ForecastingAsIsDTO {
  saldoLiquidita: number;
  ricaviYtd: number;
  costiYtd: number;
  ebitdaYtd: number;
  creditiAperti: number;
  debitiAperti: number;
  /**
   * Credito da eventi già celebrati e non ancora incassati. Sottoinsieme di `creditiAperti`.
   * Sta FUORI dalla proiezione di cassa: non ha una data attesa di incasso e non va mai sommato
   * al saldo finale previsto.
   */
  creditoEventiCelebrati: number;
  /** Data dell'ultimo movimento con cassa a libro (MAX data_finanziaria). Null se non ce n'è. */
  ultimaDataCassa: string | null;
  /** true se il dato di cassa è più vecchio della soglia di freschezza, o assente. */
  datiIncompleti: boolean;
  /** Testo che dichiara la data e i mesi scoperti. Valorizzato solo se `datiIncompleti`. */
  nota: string | null;
}

export interface ForecastingDettaglioDTO {
  data: string;
  categoria: ForecastingCategoria;
  descrizione: string;
  importoEntrata: number;
  importoUscita: number;
  vista: ForecastingVista;
  affidabilita: ForecastingAffidabilita;
}

export interface ForecastingTimelineDTO {
  bucket: string;
  bucketStart: string;
  bucketEnd: string;
  entratePreviste: number;
  uscitePreviste: number;
  ebitdaPeriodo: number;
  saldoLiquiditaFine: number;
  entrateStimate: number;
  /** Costi ricorrenti stimati del bucket (P7). Come entrateStimate, NON entra in saldoLiquiditaFine. */
  usciteStimate: number;
}

export interface ForecastingEconomicoDTO {
  ricaviPrevisti: number;
  costiPrevisti: number;
  ebitdaPrevisto: number;
  ammortamentiPrevisti: number;
  oneriFinanziariPrevisti: number;
  ebitPrevisto: number;
  dettaglio: ForecastingDettaglioDTO[];
  /** EBT = ebitPrevisto − oneriFinanziariPrevisti. La cascata si ferma qui: niente imposte. */
  ebtPrevisto: number;
  /** Perché la stima dei costi non è disponibile, o null se lo è. */
  notaStimaCosti: string | null;
}

export interface ForecastingFinanziarioDTO {
  saldoPartenza: number;
  incassiPrevisti: number;
  uscitePreviste: number;
  saldoFinale: number;
  timeline: ForecastingTimelineDTO[];
}

export interface ForecastingRispostaDTO {
  asIs: ForecastingAsIsDTO;
  economico: ForecastingEconomicoDTO;
  finanziario: ForecastingFinanziarioDTO;
}
