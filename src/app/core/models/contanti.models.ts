import { MovimentoDTO } from './movimenti.models';

/**
 * Modulo «Contanti» (docs/specs/modulo-contanti.md §1).
 *
 * Nei request compaiono SOLO i campi che il wizard chiede a schermo: conto, metodo di pagamento,
 * data finanziaria, stato, fonte ed evento li impone il server e non esistono nemmeno nel DTO —
 * quel che non c'è non si può forzare.
 */

/** Il cassetto: saldo calcolato al volo (non dalla MV asincrona) + data di apertura del saldo. */
export interface SaldoContantiDTO {
  contoId: number;
  nome: string;
  saldo: number;
  /** Movimenti con data ≤ questa restano fuori dal saldo (filtro `>` stretto, V24). */
  dataSaldoIniziale: string | null;
}

/** Op. 1 e 2 — la banca scelta finisce nella descrizione, non nel conto del movimento. */
export interface GirocontoContantiRequest {
  importo: number;
  data: string;
  contoBancarioId: number;
}

/** Op. 3 — incasso: CoGe di tipo RICAVO. */
export interface IncassoContantiRequest {
  importo: number;
  data: string;
  contoCoge: number;
  businessUnitId: number;
  descrizione: string;
}

/** Op. 4 — spesa: CoGe di tipo COSTO, fornitore facoltativo. */
export interface SpesaContantiRequest extends IncassoContantiRequest {
  fornitoreId?: string | null;
}

/** Op. 5 — si dichiara quanto c'è davvero; il delta contro il teorico lo calcola il server. */
export interface ContaContantiRequest {
  contato: number;
  data: string;
  motivo: string;
}

/** `creato: false` = contato uguale al teorico: nessun movimento, e va bene così. */
export interface EsitoContaDTO {
  creato: boolean;
  delta: number;
  movimento: MovimentoDTO | null;
}
