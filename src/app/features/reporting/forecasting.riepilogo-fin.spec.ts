import { riepilogoFinanziario, RigaFin } from './forecasting.component';

/**
 * P4 di docs/specs/previsionale-correzioni.md — il credito da eventi celebrati è visibile
 * ma FUORI dalla cassa.
 *
 * R4.4: la UI non deve mai presentare il credito sommato al saldo finale. Il template rende un
 * solo @for su queste righe, quindi verificarle qui verifica ciò che si vede.
 *
 * CONTROPROVA ESEGUITA: aggiungendo a `riepilogoFinanziario` una riga «Saldo potenziale» pari a
 * saldoFinale + credito, 2 di questi test falliscono.
 */
const FIN = { saldoPartenza: 2074.29, incassiPrevisti: 26403, uscitePreviste: 7513.11, saldoFinale: 20964.18 };
const CREDITO = 26616;

const val = (righe: RigaFin[], label: string) => righe.find(r => r.label === label)?.valore;

describe('previsionale — riepilogo finanziario', () => {

  it('il credito è una riga a sé, marcata «fuori», con il suo valore intero', () => {
    const righe = riepilogoFinanziario(FIN, CREDITO, 0);
    const fuori = righe.filter(r => r.kind === 'fuori');
    expect(fuori.length).toBe(1);
    expect(fuori[0].valore).toBeCloseTo(CREDITO, 2);
    expect(fuori[0].label).toContain('Credito da eventi');
  });

  it('R4.4 — nessuna riga somma il credito a un saldo', () => {
    for (const stima of [0, 1500]) {
      for (const r of riepilogoFinanziario(FIN, CREDITO, stima)) {
        expect(r.valore).not.toBeCloseTo(FIN.saldoFinale + CREDITO, 2);
        expect(r.valore).not.toBeCloseTo(FIN.saldoPartenza + CREDITO, 2);
        expect(r.valore).not.toBeCloseTo(FIN.saldoFinale + CREDITO + stima, 2);
      }
    }
  });

  it('R4.3 — il saldo finale resta saldoPartenza + incassi − uscite, credito o non credito', () => {
    for (const credito of [0, CREDITO]) {
      const righe = riepilogoFinanziario(FIN, credito, 0);
      expect(val(righe, 'Saldo finale previsto (certo)'))
        .toBeCloseTo(FIN.saldoPartenza + FIN.incassiPrevisti - FIN.uscitePreviste, 2);
    }
  });

  it('senza credito la riga non compare: nessuno zero da interpretare', () => {
    const righe = riepilogoFinanziario(FIN, 0, 0);
    expect(righe.some(r => r.kind === 'fuori')).toBe(false);
    expect(righe.map(r => r.label)).toEqual([
      'Saldo oggi', '+ Incassi attesi (certo)', '− Uscite attese', 'Saldo finale previsto (certo)',
    ]);
  });

  it('il layer stimato somma solo se stesso, e resta sopra il credito', () => {
    const righe = riepilogoFinanziario(FIN, CREDITO, 1500);
    expect(val(righe, 'Saldo finale + stime')).toBeCloseTo(FIN.saldoFinale + 1500, 2);
    const iStima = righe.findIndex(r => r.label === 'Saldo finale + stime');
    const iFuori = righe.findIndex(r => r.kind === 'fuori');
    expect(iFuori).toBeGreaterThan(iStima);
  });

  it('P7 — il combinato SOTTRAE i costi stimati, non solo somma i ricavi', () => {
    const righe = riepilogoFinanziario(FIN, 0, 1500, 900);
    expect(val(righe, 'Saldo finale + stime')).toBeCloseTo(FIN.saldoFinale + 1500 - 900, 2);
    expect(val(righe, '− Stima costi ricorrenti')).toBeCloseTo(900, 2);
  });

  it('P7 — con soli costi stimati il combinato sta SOTTO il certo', () => {
    const righe = riepilogoFinanziario(FIN, 0, 0, 900);
    expect(val(righe, 'Saldo finale + stime')).toBeCloseTo(FIN.saldoFinale - 900, 2);
    expect(val(righe, 'Saldo finale + stime')!).toBeLessThan(FIN.saldoFinale);
  });

  it('P7 — senza stime la riga combinata non compare (gate chiuso)', () => {
    const righe = riepilogoFinanziario(FIN, CREDITO, 0, 0);
    expect(righe.some(r => r.label === 'Saldo finale + stime')).toBe(false);
    expect(righe.some(r => r.label.includes('costi ricorrenti'))).toBe(false);
  });

  it('R7.6 — toggle OFF: il chiamante passa 0 per entrambi i layer, spariscono insieme', () => {
    const acceso = riepilogoFinanziario(FIN, 0, 1500, 900);
    const spento  = riepilogoFinanziario(FIN, 0, 0, 0);
    expect(acceso.filter(r => r.kind === 'stima').length).toBe(2);
    expect(spento.filter(r => r.kind === 'stima').length).toBe(0);
    expect(val(spento, 'Saldo finale previsto (certo)')).toBeCloseTo(FIN.saldoFinale, 2);
  });

  it('un solo totale è il saldo finale: il credito non ne crea un secondo', () => {
    const totali = riepilogoFinanziario(FIN, CREDITO, 0).filter(r => r.kind === 'totale');
    expect(totali.length).toBe(1);
    expect(totali[0].label).toBe('Saldo finale previsto (certo)');
  });
});
