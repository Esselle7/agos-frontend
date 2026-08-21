import { meseIntero, parseIso } from './pl-comparativo.component';

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
