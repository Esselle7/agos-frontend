import { Frequenza, TipoPiano } from './spese-ricorrenti.models';

/**
 * SCAFFOLDING DEL GO-LIVE — DA CANCELLARE quando i piani saranno stati creati tutti.
 *
 * Il reset del 05/08/2026 ha azzerato i piani ricorrenti: `recurring_expense_plan` è vuota e vanno
 * ricreati dai contratti. Questa è la lista di ciò che va ricreato, **compilata a mano** leggendo
 * 6 mesi di estratti conto reali (gen–giu 2026, 461 uscite BPM+CA in `esempi_input_per_ETL_new/`)
 * più le 79 uscite di luglio in produzione. Analisi e numeri: `docs/specs/ricorrenti-match-strutturato.md`.
 *
 * NON è un motore che deduce: sono **dati statici**, decisi una volta su evidenza. Il codice qui
 * sotto sa solo (a) mostrarli, (b) copiarli nel form, (c) nascondere quelli già creati.
 * ponytail: quando la lista si svuota per tutti, si cancella questo file, il blocco `<details>`
 * nel form di creazione e il metodo `applicaSuggerimento` — niente resta a marcire.
 *
 * Gli **importi non ci sono di proposito**: sono l'unico dato che va preso dal contratto, non
 * dall'estratto conto (l'addebito è la conseguenza, la rata è il patto). Quelli osservati sono
 * riportati come testo in `osservato`, per orientarsi.
 */
export interface PianoDaCreare {
  /** Nome proposto: è anche il segnale di riconoscimento, quindi contiene la parola che compare in banca. */
  descrizione: string;
  contoBancarioId: number;        // 1 = Banco BPM · 2 = Crédit Agricole
  contoBancarioNome: string;
  giornoDelMese: number;          // giorno che minimizza lo scarto misurato (CHECK 1..28)
  frequenza: Frequenza;
  tipoPiano: TipoPiano;
  /** Testo con cui l'import riconosce l'addebito: mandato SDD o nome del creditore. */
  riferimentoEstrattoConto: string;
  /** CoGe suggerito, o null quando l'evidenza non basta a sceglierlo (allora lo dice `attenzione`). */
  cogeCodice: string | null;
  cogeInteressiCodice?: string;
  /** Cosa si è visto in estratto conto: occorrenze, giorni, importi. Va mostrato, non usato. */
  osservato: string;
  /** Avvertenza da leggere prima di salvare (importi variabili, CoGe da confermare, ecc.). */
  attenzione?: string;
}

export const PIANI_DA_CREARE: PianoDaCreare[] = [
  {
    descrizione: 'Mutuo N.1273 – Banco BPM',
    contoBancarioId: 1, contoBancarioNome: 'Banco BPM',
    giornoDelMese: 28, frequenza: 'MENSILE', tipoPiano: 'FINANZIAMENTO',
    riferimentoEstrattoConto: 'MUTUO N.1273',
    cogeCodice: '20.01.001', cogeInteressiCodice: '60.01.001',
    osservato: '6 addebiti gen–lug, sempre a fine mese (30/31, a marzo spezzato in 251,00 + 2.226,65). '
      + 'Rata da 2.479,58 a 2.501,17, in crescita.',
    attenzione: 'Addebitato il 30/31 ma il giorno del piano può arrivare al massimo a 28: lo scarto '
      + 'rientra nella finestra di riconoscimento. Debito residuo e tasso vanno presi dal contratto.',
  },
  {
    descrizione: 'Mutuo Asconfidi Lombardia – Crédit Agricole',
    contoBancarioId: 2, contoBancarioNome: 'Crédit Agricole',
    giornoDelMese: 5, frequenza: 'MENSILE', tipoPiano: 'FINANZIAMENTO',
    riferimentoEstrattoConto: 'ASSOCIAZIONE DEI CONFIDI',
    cogeCodice: null, cogeInteressiCodice: undefined,
    osservato: '3 addebiti (mag 1.771,90 · giu 1.765,32 · lug 1.765,32), sempre il 5 (il 6 a luglio). '
      + 'Causale: «SDD03 RIF. MUTUO N. 030910000075300».',
    attenzione: 'CoGe da scegliere a mano: a luglio è stato messo su 20.01.001 (Rata mutuo ipotecario) '
      + 'ma la controparte è Asconfidi Lombardia, quindi potrebbe essere 20.01.006 (Rata Asconfidi 40k) '
      + 'con interessi 60.01.006. Guarda il contratto prima di salvare.',
  },
  {
    descrizione: 'Leasing Crédit Agricole',
    contoBancarioId: 2, contoBancarioNome: 'Crédit Agricole',
    giornoDelMese: 4, frequenza: 'MENSILE', tipoPiano: 'FLAT',
    riferimentoEstrattoConto: 'CREDIT AGRICOLE LEASING',
    cogeCodice: '20.01.005',
    osservato: '4 addebiti (apr 16,00 · mag 510,16 · giu 849,19 · lug 515,73), giorni 8/4/1/1.',
    attenzione: 'Canone molto variabile: metti la rata di contratto, l\'import correggerà con '
      + 'l\'addebito reale a ogni collegamento.',
  },
  {
    descrizione: 'Enel Energia',
    contoBancarioId: 1, contoBancarioNome: 'Banco BPM',
    giornoDelMese: 25, frequenza: 'MENSILE', tipoPiano: 'FLAT',
    riferimentoEstrattoConto: '2C1071113500569T',
    cogeCodice: '40.03.003',
    osservato: '6 addebiti gen–lug, giorni 23/23/27/28 + luglio 13 e 27. Da 526,20 a 1.449,04.',
    attenzione: 'A luglio ha addebitato DUE volte nello stesso mese: il secondo addebito non aggancia '
      + 'la rata del mese dopo (il piano non deve scivolare in avanti) e resta da decidere a mano.',
  },
  {
    descrizione: 'Telepass',
    contoBancarioId: 2, contoBancarioNome: 'Crédit Agricole',
    giornoDelMese: 2, frequenza: 'MENSILE', tipoPiano: 'FLAT',
    riferimentoEstrattoConto: 'TELEPASS S.P.A.',
    cogeCodice: '40.06.001',
    osservato: '7 addebiti feb–lug, giorni 1/2/3/4/31. Da 102,25 a 194,76.',
  },
  {
    descrizione: 'Commissioni Nexi POS – Crédit Agricole',
    contoBancarioId: 2, contoBancarioNome: 'Crédit Agricole',
    giornoDelMese: 5, frequenza: 'MENSILE', tipoPiano: 'FLAT',
    riferimentoEstrattoConto: 'NEXI PAYMENTS SPA',
    cogeCodice: '40.02.001',
    osservato: '7 addebiti gen–lug, giorni 4 e 7. Da 23,51 a 126,51 (segue il volume POS del mese).',
  },
  {
    descrizione: 'TIM – telefonia',
    contoBancarioId: 1, contoBancarioNome: 'Banco BPM',
    giornoDelMese: 13, frequenza: 'MENSILE', tipoPiano: 'FLAT',
    riferimentoEstrattoConto: 'MU010100000037978901382025110600001',
    cogeCodice: '40.03.004',
    osservato: '6 addebiti gen–lug, giorni 13/13/16/13/14/13. Da 34,03 a 58,02.',
    attenzione: 'Il nome «TIM» è troppo corto per fare da segnale: qui il riconoscimento si regge '
      + 'tutto sul codice mandato — non svuotarlo.',
  },
  {
    descrizione: 'Confidi Lombardia – mandato …901',
    contoBancarioId: 1, contoBancarioNome: 'Banco BPM',
    giornoDelMese: 5, frequenza: 'MENSILE', tipoPiano: 'FLAT',
    riferimentoEstrattoConto: '981811800294901',
    cogeCodice: null,
    osservato: '7 addebiti gen–lug, sempre il 5 (il 7 due volte). Importo FISSO 118,54.',
    attenzione: 'CoGe da scegliere: a luglio è finito su 40.02.002 (Spese tenuta conto), che con '
      + 'ogni probabilità è sbagliato — è una linea Asconfidi/Confidi. Verifica il contratto.',
  },
  {
    descrizione: 'Confidi Lombardia – mandato …902',
    contoBancarioId: 1, contoBancarioNome: 'Banco BPM',
    giornoDelMese: 5, frequenza: 'MENSILE', tipoPiano: 'FLAT',
    riferimentoEstrattoConto: '981811800294902',
    cogeCodice: null,
    osservato: '7 addebiti gen–lug, sempre il 5 (il 7 due volte). Da 518,71 a 528,30.',
    attenzione: 'Stessa incertezza di CoGe del mandato …901: stesso creditore, due mandati distinti.',
  },
  {
    descrizione: 'Polizza Protezione Vita 7487950',
    contoBancarioId: 1, contoBancarioNome: 'Banco BPM',
    giornoDelMese: 16, frequenza: 'MENSILE', tipoPiano: 'FLAT',
    riferimentoEstrattoConto: 'POLIZZA 7487950',
    cogeCodice: '40.05.002',
    osservato: 'UNA sola occorrenza in 6 mesi: 16/04/2026, 162,00 («RATA-SUCC. PROTEZIONE VITA»).',
    attenzione: 'Con un solo addebito la frequenza non si può dedurre: quasi certamente NON è '
      + 'mensile. Correggi frequenza e giorno leggendo la polizza, altrimenti non crearlo.',
  },
];
