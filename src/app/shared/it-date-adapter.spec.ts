import { TestBed } from '@angular/core/testing';
import { MAT_DATE_LOCALE } from '@angular/material/core';
import { ItDateAdapter } from './it-date-adapter';

/**
 * Regression del 05/09/2026: una data digitata a mano entrava nel form con giorno e mese
 * scambiati (`01/07/2026` → 7 gennaio), perché NativeDateAdapter.parse() usa Date.parse().
 */
describe('ItDateAdapter — parsing di una data digitata a mano', () => {
  let a: ItDateAdapter;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ItDateAdapter, { provide: MAT_DATE_LOCALE, useValue: 'it-IT' }],
    });
    a = TestBed.inject(ItDateAdapter);
  });

  it('D1 — 01/07/2026 è il 1° LUGLIO, non il 7 gennaio', () => {
    const d = a.parse('01/07/2026')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);   // luglio
    expect(d.getDate()).toBe(1);
  });

  it('D2 — 25/12/2026 si legge, dove Date.parse dava una data invalida', () => {
    const d = a.parse('25/12/2026')!;
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(25);
  });

  it('D3 — anche senza zeri iniziali e con altri separatori', () => {
    for (const s of ['1/7/2026', '01-07-2026', '01.07.2026']) {
      const d = a.parse(s)!;
      expect(`${d.getDate()}/${d.getMonth() + 1}`).withContext(s).toBe('1/7');
    }
  });

  it('D4 — una data inesistente resta invalida, non scivola al mese dopo', () => {
    expect(a.isValid(a.parse('31/02/2026')!)).toBe(false);
    expect(a.isValid(a.parse('30/02/2026')!)).toBe(false);
  });

  it('D5 — il testo che non è una data resta invalido', () => {
    expect(a.isValid(a.parse('pippo')!)).toBe(false);
  });
});
