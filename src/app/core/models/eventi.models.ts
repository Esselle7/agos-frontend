export type StatoEvento = 'PREVENTIVATO' | 'CONFERMATO' | 'SALDATO' | 'ANNULLATO';

/**
 * Tipi di pagamento collegabili a un evento.
 *
 * RIMBORSO esiste nel backend (V21 lo ripristina nel lookup `lk_tipi_evento_mov`):
 * viene registrato come ENTRATA con importo negativo per ridurre `importoIncassato`.
 * Non è selezionabile manualmente dal form, ma può comparire nella lista pagamenti.
 */
export type TipoPagamentoEvento = 'CAPARRA' | 'ACCONTO' | 'SALDO' | 'PENALE' | 'RIMBORSO';

/** Sottotipi creabili dal form (esclude RIMBORSO che è generato in altri flussi). */
export type TipoPagamentoForm = Exclude<TipoPagamentoEvento, 'RIMBORSO'>;

export interface PagamentoEventoDTO {
  movimentoId: string;
  tipo: TipoPagamentoEvento;
  /** ADMIN-only: null per i DIPENDENTE. Negativo per RIMBORSO. */
  importo: number | null;
  dataFinanziaria: string;
  /** ADMIN-only: null per i DIPENDENTE. */
  note: string | null;
  stato: string;
}

/**
 * Dettaglio evento. Tutti i campi finanziari sono nullable: il backend li
 * restituisce {@code null} ai DIPENDENTE (visibility policy ADMIN-only).
 */
export interface EventoDTO {
  id: string;
  nome: string;
  tipo: string;
  dataEvento: string;
  dataPreventivo: string | null;
  /** ADMIN-only. */
  importoTotalePreviventivato: number | null;
  /** ADMIN-only. */
  importoIncassato: number | null;
  /** ADMIN-only. */
  caparreIncassate: number | null;
  /** ADMIN-only. */
  costiDirettiImputati: number | null;
  stato: StatoEvento;
  businessUnitId: number;
  contattoNome: string;
  contattoTelefono: string | null;
  contattoEmail: string | null;
  numeroTotalePartecipanti: number;
  numeroBambini: number | null;
  allergie: string[];
  note: string | null;
  /** URL pubblica del menu PDF su R2, o null se non caricato. */
  menuPdfUrl: string | null;
  /** ADMIN-only. */
  noteAnnullamento: string | null;
  /** ADMIN-only. */
  importoResiduo: number | null;
  /** ADMIN-only. */
  percentualeIncassata: number | null;
  /** ADMIN-only. */
  costiReali: number | null;
  /** ADMIN-only. */
  profitto: number | null;
  /** Data del primo CAPARRA/ACCONTO non annullato. Visibile a tutti. */
  dataConferma: string | null;
  /** Data del SALDO non annullato. Visibile a tutti. */
  dataSaldo: string | null;
  pagamenti: PagamentoEventoDTO[];
  /** ADMIN-only. Voci che compongono preventivo/consuntivo. */
  voci: EventoVoceDTO[] | null;
  /** ADMIN-only. Σ COALESCE(consuntivo, preventivo). */
  totaleConsuntivato: number | null;
  /** ADMIN-only. totaleConsuntivato − preventivato. */
  scostamentoConsuntivo: number | null;
  createdAt: string;
  createdBy: string;
}

// ── Voci di preventivo/consuntivo ─────────────────────────────────────────
export type OrigineVoce = 'MANUALE' | 'COSTO_DIRETTO';

export interface EventoVoceDTO {
  id: number;
  catalogoId: number | null;
  label: string;
  prezzoUnitario: number;
  quantitaPreventivo: number;
  quantitaConsuntivo: number | null;
  importoPreventivo: number;
  importoConsuntivo: number | null;
  /** consuntivo − preventivo, o null se non ancora consuntivata. */
  scostamento: number | null;
  origine: OrigineVoce;
  costoDirettoId: number | null;
  note: string | null;
}

export interface EventoVoceRequest {
  /** Voce di listino esistente selezionata (alternativa a label). */
  catalogoId?: number | null;
  /** Label nuova → registrata nel listino (alternativa a catalogoId). */
  label?: string | null;
  prezzoUnitario?: number | null;
  quantitaPreventivo?: number | null;
  quantitaConsuntivo?: number | null;
  note?: string | null;
}

export interface EventoVoceCatalogoDTO {
  id: number;
  label: string;
  isDefault: boolean;
  prezzoDefault: number | null;
  unita: string | null;
}

export interface EventoCreateRequest {
  nome: string;
  tipo: string;
  dataEvento: string;
  dataPreventivo: string | null;
  /** Opzionale: se valorizzato diventa una voce "Preventivo iniziale". Il form voci-first non lo invia. */
  importoTotalePreviventivato?: number | null;
  contattoNome: string;
  contattoTelefono: string | null;
  contattoEmail: string | null;
  numeroTotalePartecipanti: number;
  numeroBambini: number | null;
  allergie: string[];
  note: string | null;
  businessUnitId: number | null;
  /** UUID dei dipendenti da associare all'evento. */
  personaleIds: string[];
}

export interface EventoUpdateRequest {
  nome?: string | null;
  tipo?: string | null;
  dataEvento?: string | null;
  dataPreventivo?: string | null;
  importoTotalePreviventivato?: number | null;
  contattoNome?: string | null;
  contattoTelefono?: string | null;
  contattoEmail?: string | null;
  numeroTotalePartecipanti?: number | null;
  numeroBambini?: number | null;
  allergie?: string[] | null;
  note?: string | null;
  stato?: StatoEvento | null;
  noteAnnullamento?: string | null;
  businessUnitId?: number | null;
  /** Se presente, sostituisce integralmente la lista dei partecipanti. */
  personaleIds?: string[] | null;
}

export interface EventoCalendarioDTO {
  id: string;
  nome: string;
  dataEvento: string;
  stato: StatoEvento;
  /** ADMIN-only. */
  importoTotale: number | null;
  /** ADMIN-only. */
  importoResiduo: number | null;
  coloreStato: string;
}

export interface EventiDashboardDTO {
  totaleEventi: number;
  /** ADMIN-only. */
  totaleIncassato: number | null;
  /** ADMIN-only. */
  totaleCosti: number | null;
  /** ADMIN-only. */
  profittoTotale: number | null;
  from: string;
  to: string;
}

export interface PagamentoRequest {
  tipo: TipoPagamentoForm;
  importo: number;
  data: string;
  note: string | null;
  metodoPagamentoId: number;
  contoBancarioId: number;
  contoCoge: number | null;
}

export interface EventoPartecipanteDTO {
  id: number;
  eventoId: string;
  personaleId: string;
  nome: string;
  cognome: string;
  mansione: string | null;
  ruolo: string | null;
  /** ADMIN-only: null per i DIPENDENTE. Per ORARIA = ore * pagaOraria. */
  costo: number | null;
  /** MENSILE | ORARIA. */
  tipoRetribuzione: 'MENSILE' | 'ORARIA';
  /** ADMIN-only. Paga oraria lorda (solo ORARIA). */
  pagaOraria: number | null;
  /** ADMIN-only. Ore allocate per questo evento (solo ORARIA). */
  ore: number | null;
  /** True se esiste un movimento di costo attivo collegato. */
  hasMovimento: boolean;
  note: string | null;
}

export interface AggiungiPartecipanteRequest {
  personaleId: string;
  ruolo: string | null;
  costo: number | null;
  note: string | null;
}

export type TipoCostoEvento = 'FISSO' | 'VARIABILE';
export type VoceCostoEvento = 'DJ' | 'TORTA' | 'CUSTOM';

/** Costo diretto reale (genera movimento USCITA). */
export interface EventoCostoDirettoDTO {
  id: number;
  tipoCosto: TipoCostoEvento;
  voce: VoceCostoEvento;
  etichetta: string;
  importo: number;
  // Movimento collegato
  movimentoId?: string | null;
  movimentoData?: string | null;
  contoCodice?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface EventoCostoDirettoRequest {
  tipoCosto: TipoCostoEvento;
  voce: VoceCostoEvento;
  etichetta?: string | null;
  importo?: number | null;
  /** Opzionale: importo addebitato al cliente (ricarico) → crea una voce di preventivo. */
  importoAddebitoCliente?: number | null;
  /** BU a cui imputare il movimento di costo. Se null, la BU dell'evento. */
  businessUnitId?: number | null;
  note?: string | null;
}

// ── Monitoring preventivato (no contabilità) ──────────────────────────────
export type TipoTrackingPreventivo = 'AFFITTO' | 'CATERING';

export interface EventoPreventivoTrackingDTO {
  id: number;
  tipo: TipoTrackingPreventivo;
  // AFFITTO
  importoIncasso?: number | null;
  // CATERING
  costoPerPersona?: number | null;
  prezzoPerPersona?: number | null;
  numPersone?: number | null;
  costoTotale?: number | null;
  ricavo?: number | null;
  margine?: number | null;
  marginePerc?: number | null;
  note?: string | null;
}

export interface EventoPreventivoTrackingRequest {
  tipo: TipoTrackingPreventivo;
  importoIncasso?: number | null;
  costoPerPersona?: number | null;
  prezzoPerPersona?: number | null;
  numPersone?: number | null;
  note?: string | null;
}
