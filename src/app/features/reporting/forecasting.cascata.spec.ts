import { cascataEconomica, RigaCascata } from './forecasting.component';

/**
 * P3 di docs/specs/previsionale-correzioni.md — la cascata smette di mentire.
 *
 * Il pannello mostrava «EBITDA 25.760,00 → − Oneri finanziari 2.201,82 → EBIT 25.760,00»:
 * una riga di sottrazione a video che nessun totale sottraeva.
 *
 * R3.3: ogni riga «−» dev'essere effettivamente sottratta dal totale che la segue. Qui la
 * verifica è sull'ARRAY che il template rende (un solo @for), quindi il DOM non può
 * disallinearsi dalla catena verificata.
 *
 * CONTROPROVA ESEGUITA: rimettendo l'ordine vecchio (oneri sopra l'EBIT) `catena()` fallisce.
 */

/** Percorre le righe: ogni sottrazione deve portare dal totale precedente a quello successivo. */
function verificaCatena(righe: RigaCascata[]): void {
  let totalePrecedente: number | null = null;
  for (let i = 0; i < righe.length; i++) {
    const r = righe[i];
    if (!r.sottrazione) { totalePrecedente = r.valore; continue; }

    const successiva = righe[i + 1];
    expect(successiva)
      .withContext(`la riga «${r.label}» non è seguita da nessun totale`).toBeDefined();
    expect(successiva.sottrazione)
      .withContext(`dopo «${r.label}» deve venire un totale, non un'altra sottrazione`).toBe(false);
    expect(totalePrecedente)
      .withContext(`la riga «${r.label}» non ha un totale sopra da cui sottrarre`).not.toBeNull();
    expect(successiva.valore).toBeCloseTo(totalePrecedente! - r.valore, 2);
  }
}

describe('previsionale — cascata EBITDA → EBIT → EBT', () => {

  /** I numeri veri del 06/09/2026, orizzonte 90 (baseline §C): ammortamenti 0, oneri 2.201,82. */
  const orizzonte90 = {
    ebitdaPrevisto: 30180, ammortamentiPrevisti: 0,
    oneriFinanziariPrevisti: 2201.82, ebitPrevisto: 30180, ebtPrevisto: 27978.18,
  };

  it('il caso misurato: gli oneri finanziari arrivano a un totale che li sottrae', () => {
    const righe = cascataEconomica(orizzonte90);
    verificaCatena(righe);
    expect(righe.map(r => r.label))
      .toEqual(['EBITDA previsto (certo)', '− Oneri finanziari previsti', 'EBT previsto']);
    expect(righe[2].valore).toBeCloseTo(27978.18, 2);
  });

  it('con ammortamenti e oneri: EBITDA → − Amm → EBIT → − Oneri → EBT', () => {
    const righe = cascataEconomica({
      ebitdaPrevisto: 10000, ammortamentiPrevisti: 1000,
      oneriFinanziariPrevisti: 500, ebitPrevisto: 9000, ebtPrevisto: 8500,
    });
    verificaCatena(righe);
    expect(righe.map(r => r.label)).toEqual([
      'EBITDA previsto (certo)', '− Ammortamenti (cespiti)', 'EBIT previsto',
      '− Oneri finanziari previsti', 'EBT previsto',
    ]);
  });

  it('senza ammortamenti né oneri resta il solo EBITDA: nessun livello ripetuto', () => {
    const righe = cascataEconomica({
      ebitdaPrevisto: 10000, ammortamentiPrevisti: 0,
      oneriFinanziariPrevisti: 0, ebitPrevisto: 10000, ebtPrevisto: 10000,
    });
    expect(righe.map(r => r.label)).toEqual(['EBITDA previsto (certo)']);
    verificaCatena(righe);
  });

  it('con soli ammortamenti la catena si ferma all\'EBIT: niente EBT senza oneri', () => {
    const righe = cascataEconomica({
      ebitdaPrevisto: 10000, ammortamentiPrevisti: 400,
      oneriFinanziariPrevisti: 0, ebitPrevisto: 9600, ebtPrevisto: 9600,
    });
    expect(righe.map(r => r.label))
      .toEqual(['EBITDA previsto (certo)', '− Ammortamenti (cespiti)', 'EBIT previsto']);
    verificaCatena(righe);
  });

  it('EBITDA negativo: la catena regge anche in perdita', () => {
    const righe = cascataEconomica({
      ebitdaPrevisto: -5000, ammortamentiPrevisti: 200,
      oneriFinanziariPrevisti: 300, ebitPrevisto: -5200, ebtPrevisto: -5500,
    });
    verificaCatena(righe);
    expect(righe[righe.length - 1].valore).toBeCloseTo(-5500, 2);
  });

  it('la cascata si ferma a EBT: nessuna riga di imposte o utile netto', () => {
    for (const righe of [cascataEconomica(orizzonte90),
                         cascataEconomica({ ebitdaPrevisto: 1, ammortamentiPrevisti: 1,
                                            oneriFinanziariPrevisti: 1, ebitPrevisto: 0, ebtPrevisto: -1 })]) {
      for (const r of righe) {
        expect(r.label.toLowerCase()).not.toContain('impost');
        expect(r.label.toLowerCase()).not.toContain('utile netto');
      }
    }
  });

  it('ogni riga di sottrazione ha un totale subito dopo, su tutte le combinazioni', () => {
    for (const amm of [0, 250]) {
      for (const oneri of [0, 700]) {
        const ebit = 8000 - amm;
        verificaCatena(cascataEconomica({
          ebitdaPrevisto: 8000, ammortamentiPrevisti: amm,
          oneriFinanziariPrevisti: oneri, ebitPrevisto: ebit, ebtPrevisto: ebit - oneri,
        }));
      }
    }
  });
});
