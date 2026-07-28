import { DateField, MovimentiFilter } from '../../core/services/movimenti.service';

/**
 * Stato dei filtri della lista movimenti — docs/specs/movimenti-filtri-avanzati.md.
 * Tutti i campi sono sempre presenti (array vuoti, non undefined): confrontare e ripulire
 * uno stato con forma fissa è molto più semplice che gestire assenze opzionali.
 */
export interface MovimentiFiltri {
  tipo: string[];
  stato: string[];
  fonte: string[];
  /** id conto bancario; 0 = «senza banca» (conto_bancario_id IS NULL). */
  contoId: number[];
  cogeId: number[];
  buId: number[];
  categoriaId: number[];
  metodoPagamentoId: number[];
  fornitoreId: string[];
  eventoId: string[];
  importoMin: number | null;
  importoMax: number | null;
  dateField: DateField;
  from: string | null;
  to: string | null;
  search: string;
}

/** Sentinella «senza banca»: gli id reali dei conti partono da 1. */
export const CONTO_SENZA_BANCA = 0;

/** Dimensioni multi-valore: usate per iterare in modo generico su chip e conteggi. */
export const DIMENSIONI_MULTI = [
  'tipo', 'stato', 'fonte', 'contoId', 'cogeId', 'buId',
  'categoriaId', 'metodoPagamentoId', 'fornitoreId', 'eventoId',
] as const;

export type DimensioneMulti = typeof DIMENSIONI_MULTI[number];

/** Chip riassuntiva di un filtro attivo. Dato puro: la rimozione la esegue chi possiede lo stato. */
export interface FiltroChip {
  /** Dimensione multi-valore, oppure una delle pseudo-dimensioni scalari. */
  dim: DimensioneMulti | 'importo' | 'date' | 'search';
  /** Valore da rimuovere dall'array (solo per le dimensioni multi). */
  value?: string | number;
  label: string;
}

export function filtriVuoti(): MovimentiFiltri {
  return {
    tipo: [], stato: [], fonte: [], contoId: [], cogeId: [], buId: [],
    categoriaId: [], metodoPagamentoId: [], fornitoreId: [], eventoId: [],
    importoMin: null, importoMax: null,
    dateField: 'MOVIMENTO', from: null, to: null, search: '',
  };
}

/** Copia difensiva: il pannello lavora su una bozza e non muta lo stato applicato. */
export function cloneFiltri(f: MovimentiFiltri): MovimentiFiltri {
  return {
    ...f,
    tipo: [...f.tipo], stato: [...f.stato], fonte: [...f.fonte],
    contoId: [...f.contoId], cogeId: [...f.cogeId], buId: [...f.buId],
    categoriaId: [...f.categoriaId], metodoPagamentoId: [...f.metodoPagamentoId],
    fornitoreId: [...f.fornitoreId], eventoId: [...f.eventoId],
  };
}

/**
 * Quanti filtri sono attivi NEL PANNELLO. Il range date conta 1 anche se ha due estremi: per
 * l'utente «periodo» è un filtro solo, e il badge deve dire quante cose sta guardando, non
 * quanti campi. La ricerca testuale è esclusa di proposito — ha una casella sempre visibile
 * fuori dal pannello, e contarla farebbe dire al badge più di quello che il pannello contiene.
 */
export function contaFiltriAttivi(f: MovimentiFiltri): number {
  let n = DIMENSIONI_MULTI.reduce((acc, d) => acc + (f[d] as unknown[]).length, 0);
  if (f.importoMin != null || f.importoMax != null) n++;
  if (f.from || f.to) n++;
  return n;
}

/**
 * Etichette leggibili dei valori selezionati, chiave `dimensione:valore`.
 * Le produce il pannello (che ha già caricato conti, fornitori, eventi… per le tendine) e le
 * passa alla lista insieme ai filtri: così le chip mostrano nomi veri senza che la lista debba
 * ricaricare gli stessi elenchi una seconda volta.
 */
export type EtichetteFiltri = Record<string, string>;

export function chiaveEtichetta(dim: DimensioneMulti, value: string | number): string {
  return `${dim}:${value}`;
}

/** Chip da mostrare sopra la tabella, una per valore selezionato. */
export function chipsDa(f: MovimentiFiltri, etichette: EtichetteFiltri): FiltroChip[] {
  const chips: FiltroChip[] = [];

  for (const dim of DIMENSIONI_MULTI) {
    for (const value of f[dim] as (string | number)[]) {
      chips.push({
        dim,
        value,
        label: etichette[chiaveEtichetta(dim, value)] ?? String(value),
      });
    }
  }

  if (f.importoMin != null || f.importoMax != null) {
    const min = f.importoMin != null ? `${f.importoMin} €` : null;
    const max = f.importoMax != null ? `${f.importoMax} €` : null;
    const label = min && max ? `${min} – ${max}` : min ? `oltre ${min}` : `fino a ${max}`;
    chips.push({ dim: 'importo', label });
  }

  if (f.from || f.to) {
    const d = (iso: string) => iso.split('-').reverse().join('/');
    const periodo = f.from && f.to ? `${d(f.from)} – ${d(f.to)}`
      : f.from ? `dal ${d(f.from)}` : `fino al ${d(f.to!)}`;
    chips.push({ dim: 'date', label: `${DATE_FIELD_LABEL[f.dateField]}: ${periodo}` });
  }

  return chips;
}

/** Rimuove dai filtri ciò che la chip rappresenta. Non muta l'originale. */
export function rimuoviChip(f: MovimentiFiltri, chip: FiltroChip): MovimentiFiltri {
  const next = cloneFiltri(f);
  switch (chip.dim) {
    case 'importo':
      next.importoMin = null;
      next.importoMax = null;
      break;
    case 'date':
      next.from = null;
      next.to = null;
      break;
    case 'search':
      next.search = '';
      break;
    default: {
      const arr = next[chip.dim] as (string | number)[];
      (next[chip.dim] as (string | number)[]) = arr.filter(v => v !== chip.value);
    }
  }
  return next;
}

/** Traduce lo stato UI nel filtro di rete; omette tutto ciò che è vuoto. */
export function toMovimentiFilter(f: MovimentiFiltri): MovimentiFilter {
  const out: MovimentiFilter = {};
  for (const d of DIMENSIONI_MULTI) {
    const values = f[d] as unknown[];
    if (values.length) (out as Record<string, unknown>)[d] = values;
  }
  if (f.importoMin != null) out.importoMin = f.importoMin;
  if (f.importoMax != null) out.importoMax = f.importoMax;
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  if (f.from || f.to) out.dateField = f.dateField;
  const search = f.search.trim();
  if (search) out.search = search;
  return out;
}

export const DATE_FIELD_LABEL: Record<DateField, string> = {
  MOVIMENTO:   'Data movimento',
  FINANZIARIA: 'Data finanziaria',
  LIQUIDITA:   'Data liquidità',
};

/** Nota mostrata sotto il selettore: spiega cosa cambia davvero scegliendo una data o l'altra. */
export const DATE_FIELD_HINT: Record<DateField, string> = {
  MOVIMENTO:   'Competenza economica: quando il costo o il ricavo matura. È la vista del conto economico.',
  FINANZIARIA: 'Quando i soldi entrano o escono davvero dal conto. È la vista della cassa: i movimenti non ancora liquidati restano fuori.',
  LIQUIDITA:   'Scadenza attesa del pagamento. Serve a vedere cosa deve ancora muoversi.',
};

export const FONTI: { value: string; label: string }[] = [
  { value: 'MANUALE',      label: 'Manuale' },
  { value: 'IMPORT_BANCA', label: 'Import banca' },
  { value: 'IMPORT_BILLY', label: 'Import Billy' },
  { value: 'RICORRENTE',   label: 'Spesa ricorrente' },
  { value: 'APERTURA',     label: 'Apertura' },
];

export const STATI: { value: string; label: string }[] = [
  { value: 'REGISTRATO',   label: 'Registrato' },
  { value: 'ATTIVO',       label: 'Attivo' },
  { value: 'DA_LIQUIDARE', label: 'Da liquidare' },
  { value: 'ANNULLATO',    label: 'Annullato' },
];
