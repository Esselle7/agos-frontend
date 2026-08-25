import { dataAperturaGestionale, meseIntero, parseIso } from './pl-comparativo.component';

/**
 * Fase 5 / decisione C — il conto economico e' MENSILE.
 *
 * Il backend rifiuta con 400 RANGE_NON_MENSILE ogni finestra che non copre mesi interi
 * (`ReportingService.validateRangeMensile`). Questa pagina e' l'unico chiamante di `/pl/tutte-bu`:
 * se i suoi preset smettessero di arrotondare a mese, la pagina prenderebbe 400 invece di mentire —
 * ma prenderebbe 400. Questi test sono la guardia su quell'arrotondamento.
 *
 * Il caso che ha originato la fase: MTD chiedeva `2026-08-01 -> 2026-08-21` (oggi) e riceveva
 * TUTTO agosto in silenzio, perche' `mv_conto_economico_mensile` aggrega per anno*100+mese.
 *
 * CONTROPROVA ESEGUITA: rimettendo `to: <oggi>` al posto di `meseIntero(...)` questi test
 * falliscono.
 */
describe('pl-comparativo — arrotondamento del periodo a mese intero', () => {

  it('un giorno qualsiasi diventa il suo mese intero', () => {
    const d = new Date(2026, 6, 15); // 15 luglio 2026
    expect(meseIntero(d, d)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('il caso misurato: 01/07 -> 20/08 diventa 01/07 -> 31/08', () => {
    expect(meseIntero(parseIso('2026-07-01'), parseIso('2026-08-20')))
      .toEqual({ from: '2026-07-01', to: '2026-08-31' });
  });

  it('il caso del piano: 10/07 -> 20/07 diventa luglio intero', () => {
    expect(meseIntero(parseIso('2026-07-10'), parseIso('2026-07-20')))
      .toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('YTD: dal 1 gennaio a un giorno di agosto -> fino al 31 agosto', () => {
    expect(meseIntero(new Date(2026, 0, 1), new Date(2026, 7, 21)))
      .toEqual({ from: '2026-01-01', to: '2026-08-31' });
  });

  it('febbraio bisestile: la fine mese non e\' hardcoded a 28', () => {
    expect(meseIntero(parseIso('2028-02-10'), parseIso('2028-02-10')))
      .toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('un intervallo gia\' mensile resta identico (idempotente)', () => {
    expect(meseIntero(parseIso('2026-07-01'), parseIso('2026-07-31')))
      .toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('parseIso non sposta il giorno: legge la data come LOCALE, non UTC', () => {
    const d = parseIso('2026-08-01');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 7, 1]);
  });
});

/**
 * Il cartello «Il gestionale parte dal …» mostrava il 5 AGOSTO invece del 1 LUGLIO.
 *
 * Root cause misurata il 21/08/2026 su una copia della produzione: la pagina prendeva il massimo
 * di `dataSaldoIniziale` su TUTTI i conti, e «Cassa contanti» — placeholder a saldo 0,00 aperto il
 * 05/08 — batteva i due conti correnti veri, entrambi al 30/06. I movimenti pero' partono dal
 * 1 luglio, perche' il saldo iniziale filtra con `>` stretto.
 *
 * CONTROPROVA ESEGUITA: rimettendo il massimo su tutti i conti, il primo test qui sotto torna
 * '2026-08-06' invece di '2026-07-01' e fallisce.
 */
describe('pl-comparativo — data di apertura del gestionale', () => {

  /** I cinque conti come stanno in produzione al 21/08/2026. */
  const contiProduzione = [
    { tipo: 'BANCARIO', dataSaldoIniziale: '2026-06-30' },  // Banco BPM
    { tipo: 'BANCARIO', dataSaldoIniziale: '2026-06-30' },  // Credit Agricole
    { tipo: 'CASSA',    dataSaldoIniziale: '2026-08-05' },  // Cassa contanti, saldo 0,00
    { tipo: 'DIGITALE', dataSaldoIniziale: '2024-01-01' },  // Satispay, placeholder
    { tipo: 'DIGITALE', dataSaldoIniziale: '2024-01-01' },  // Stripe, placeholder
  ];

  it('sui conti veri di produzione dice 1 luglio 2026, non 5 agosto', () => {
    expect(dataAperturaGestionale(contiProduzione)).toBe('2026-07-01');
  });

  it('un portafoglio aperto domani non sposta la data di apertura', () => {
    expect(dataAperturaGestionale([...contiProduzione,
      { tipo: 'DIGITALE', dataSaldoIniziale: '2026-12-31' }])).toBe('2026-07-01');
  });

  it('e\' il giorno DOPO il saldo iniziale: il filtro sui movimenti e\' > stretto', () => {
    expect(dataAperturaGestionale([{ tipo: 'BANCARIO', dataSaldoIniziale: '2026-06-30' }]))
      .toBe('2026-07-01');
  });

  it('fine mese e anno bisestile non sono hardcoded', () => {
    expect(dataAperturaGestionale([{ tipo: 'BANCARIO', dataSaldoIniziale: '2026-12-31' }]))
      .toBe('2027-01-01');
    expect(dataAperturaGestionale([{ tipo: 'BANCARIO', dataSaldoIniziale: '2028-02-28' }]))
      .toBe('2028-02-29');
  });

  it('senza conti correnti ricade sul massimo di tutti', () => {
    expect(dataAperturaGestionale([{ tipo: 'CASSA', dataSaldoIniziale: '2026-08-05' }]))
      .toBe('2026-08-06');
  });

  it('nessuna data disponibile: nessun cartello', () => {
    expect(dataAperturaGestionale([{ tipo: 'BANCARIO', dataSaldoIniziale: null }])).toBeNull();
    expect(dataAperturaGestionale([])).toBeNull();
  });
});
