import { TipoCoge } from '../../core/models/anagrafica.models';

/**
 * Metadati delle nature contabili (COGE), fonte unica condivisa fra la pagina /piano-conti (titoli di
 * sezione al plurale + icona) e il dialog di creazione (chip natura + anteprima to-be). Il colore
 * accento resta come token CSS (classe {@code --TIPO}) perché è presentazione scoped al componente.
 */
export interface TipoCogeMeta {
  value: TipoCoge;
  label: string;     // singolare/esteso, per la form
  plurale: string;   // per i titoli di insieme
  icon: string;
}

export const TIPI_COGE: readonly TipoCogeMeta[] = [
  { value: 'RICAVO',            label: 'Ricavo',             plurale: 'Ricavi',           icon: 'trending_up' },
  { value: 'COSTO',             label: 'Costo operativo',    plurale: 'Costi',            icon: 'trending_down' },
  { value: 'ATTIVITA',          label: 'Attività',           plurale: 'Attività',         icon: 'account_balance_wallet' },
  { value: 'PASSIVITA',         label: 'Passività / debito', plurale: 'Passività',        icon: 'credit_card' },
  { value: 'ONERE_FINANZIARIO', label: 'Onere finanziario',  plurale: 'Oneri finanziari', icon: 'percent' },
  { value: 'IMPOSTA',           label: 'Imposta / tributo',  plurale: 'Imposte',          icon: 'gavel' },
];
