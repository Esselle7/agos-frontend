export type InstallmentStato = 'PENDING' | 'PAID' | 'CANCELLED' | 'SKIPPED';
export type PlanStato = 'ATTIVO' | 'COMPLETATO' | 'ANNULLATO';
export type Frequenza = 'MENSILE' | 'BIMESTRALE' | 'TRIMESTRALE' | 'ANNUALE';
export type TipoPiano = 'FLAT' | 'FINANZIAMENTO';

export interface InstallmentDTO {
  id: string;
  numeroRata: number;
  dataScadenza: string;
  importo: number;
  stato: InstallmentStato;
  movimentoId: string | null;
  note: string | null;
  quotaCapitale: number | null;
  quotaInteressi: number | null;
}

export interface PlanSummaryDTO {
  id: string;
  descrizione: string;
  contoBancarioId: number;
  contoBancarioNome: string;
  contoCoge: number;
  contoCogeDescrizione: string;
  importoRata: number;
  variazionePct: number;
  giornoDelMese: number;
  frequenza: Frequenza;
  numeroRate: number;
  dataPrimaRata: string;
  stato: PlanStato;
  riferimentoEstrattoConto: string | null;
  ratePending: number;
  ratePaid: number;
  rateSkipped: number;
  rateCancelled: number;
  totalePagato: number;
  totaleResiduo: number;
}

/** Modifica di un piano esistente: solo anagrafica + riconoscimento, mai gli importi. */
export interface PlanUpdateRequest {
  descrizione: string;
  contoBancarioId: number;
  riferimentoEstrattoConto: string | null;
  note: string | null;
}

export interface PlanDetailDTO extends PlanSummaryDTO {
  note: string | null;
  totalePiano: number;
  totaleInteressi: number;
  totaleCapitale: number;
  tipoPiano: TipoPiano;
  tassoInteresseAnnuo: number | null;
  importoDebitoIniziale: number | null;
  contoCogeInteressiId: number | null;
  contoCogeInteressiDescrizione: string | null;
  saldoContoBancario: number;
  rate: InstallmentDTO[];
}

export interface PlanCreateRequest {
  descrizione: string;
  contoBancarioId: number;
  contoCoge: number;
  importoRata: number;
  variazionePct: number;
  giornoDelMese: number;
  frequenza: Frequenza;
  numeroRate: number;
  dataInizio: string;
  note?: string;
  /** Testo con cui l'import riconosce l'addebito in estratto conto (mandato SDD, creditore, n. contratto). */
  riferimentoEstrattoConto?: string;
  tipoPiano?: TipoPiano;
  importoDebitoIniziale?: number;
  tassoInteresseAnnuo?: number;
  contoCogeInteressiId?: number;
}

export interface CogeOption {
  id: number;
  codice: string;
  descrizione: string;
  /** PASSIVITA | COSTO — un FINANZIAMENTO ammette solo PASSIVITA. */
  tipo?: string;
}
