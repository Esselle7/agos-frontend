import { bucketLabel } from './forecasting.component';

/**
 * P1 di docs/specs/previsionale-correzioni.md — via «2026-W38» dalla UI del previsionale.
 *
 * L'etichetta si deriva da `bucketStart`/`bucketEnd`, che il backend tronca gia'
 * all'orizzonte: il primo e l'ultimo bucket possono essere piu' corti di una settimana e
 * l'etichetta deve dirlo (R1.4). Le date qui sotto sono quelle vere restituite
 * dall'endpoint il 06/09/2026 (banco: docs/specs/misure/previsionale-baseline-2026-09-06.md).
 *
 * CONTROPROVA ESEGUITA: rimettendo il parsing di `bucket` (`Sett. 38/2026`) 6 di questi 8
 * test falliscono (passano solo il caso mensile e il fallback senza date).
 */
describe('previsionale — etichetta del periodo', () => {

  it('settimana dentro lo stesso mese: 7–13 set', () => {
    expect(bucketLabel({ bucket: '2026-W37', bucketStart: '2026-09-07', bucketEnd: '2026-09-13' }))
      .toBe('7–13 set');
  });

  it('settimana a cavallo di mese: 28 set – 4 ott', () => {
    expect(bucketLabel({ bucket: '2026-W40', bucketStart: '2026-09-28', bucketEnd: '2026-10-04' }))
      .toBe('28 set – 4 ott');
  });

  it('bucket mensile: mese esteso + anno, anche se troncato dall\'orizzonte', () => {
    expect(bucketLabel({ bucket: '2026-09', bucketStart: '2026-09-07', bucketEnd: '2026-09-30' }))
      .toBe('Settembre 2026');
    expect(bucketLabel({ bucket: '2027-03', bucketStart: '2027-03-01', bucketEnd: '2027-03-05' }))
      .toBe('Marzo 2027');
  });

  it('R1.4 — l\'ultimo bucket e\' troncato all\'orizzonte, non esteso a domenica', () => {
    // orizzonte 30 al 06/09: l'ultimo bucket finisce il 06/10, non l'11.
    expect(bucketLabel({ bucket: '2026-W41', bucketStart: '2026-10-05', bucketEnd: '2026-10-06' }))
      .toBe('5–6 ott');
  });

  it('bucket di un giorno solo: «5 dic», non «5–5 dic»', () => {
    expect(bucketLabel({ bucket: '2026-W49', bucketStart: '2026-12-05', bucketEnd: '2026-12-05' }))
      .toBe('5 dic');
  });

  it('a cavallo d\'anno: l\'anno non compare ma i mesi si distinguono', () => {
    expect(bucketLabel({ bucket: '2026-W53', bucketStart: '2026-12-28', bucketEnd: '2027-01-03' }))
      .toBe('28 dic – 3 gen');
  });

  it('R1.3 — nessuna etichetta contiene «W» o «Sett.»', () => {
    const casi = [
      { bucket: '2026-W37', bucketStart: '2026-09-07', bucketEnd: '2026-09-13' },
      { bucket: '2026-W40', bucketStart: '2026-09-28', bucketEnd: '2026-10-04' },
      { bucket: '2026-09',  bucketStart: '2026-09-07', bucketEnd: '2026-09-30' },
    ];
    for (const c of casi) {
      const l = bucketLabel(c);
      expect(l).not.toContain('Sett.');
      expect(l).not.toMatch(/\bW\d/);
    }
  });

  it('senza date valide ricade sulla chiave grezza invece di inventare un mese', () => {
    expect(bucketLabel({ bucket: '2026-W37' })).toBe('2026-W37');
    expect(bucketLabel({ bucket: '2026-W37', bucketStart: 'boh', bucketEnd: 'boh' })).toBe('2026-W37');
  });
});
