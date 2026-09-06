import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MovimentiFormComponent } from './movimenti-form.component';
import { MovimentiService } from '../../core/services/movimenti.service';
import { ContiService } from '../../core/services/conti.service';
import { LookupService } from '../../core/services/lookup.service';
import { CategorieService } from '../../core/services/categorie.service';
import { FornitoriService } from '../../core/services/fornitori.service';
import { EventiService } from '../../core/services/eventi.service';
import { BuService } from '../../core/services/bu.service';

/**
 * Spec movimento-etichette-costo-ricavo (lotto 19/08/2026, punto 6).
 * Solo copy: le tre schede del passo 1 devono parlare di costo quando si registra un'uscita.
 * Si testa la mappa `flusso × tipo` senza renderizzare il form (che monta mezzo modulo Material).
 */
function creaForm(): MovimentiFormComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      MovimentiFormComponent,
      { provide: ChangeDetectorRef, useValue: { markForCheck: () => {} } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
      ...[MovimentiService, ContiService, LookupService, CategorieService,
          FornitoriService, EventiService, BuService, Router, Location, MatDialog, MatSnackBar]
        .map(t => ({ provide: t, useValue: {} })),
    ],
  });
  const c = TestBed.inject(MovimentiFormComponent);
  c.form.controls.tipo.valueChanges.subscribe(v => (c as unknown as { _tipo: { set(v: unknown): void } })._tipo.set(v));
  return c;
}

/**
 * Cambia la direzione come fa l'utente col toggle. Il collegamento FormControl → signal specchio
 * (`_tipo`) è cablato in `ngOnInit`, che qui non gira (monterebbe tutti i servizi del form): il
 * test lo riproduce con la stessa sottoscrizione. Che in pagina sia davvero cablato è verificato
 * a browser, §Esito della spec — questo test difende la MAPPA dei testi, non il cablaggio.
 */
function conTipo(c: MovimentiFormComponent, tipo: 'ENTRATA' | 'USCITA') {
  c.form.controls.tipo.setValue(tipo);
  return c.schedeFlusso();
}

describe('MovimentiFormComponent — etichette costo/ricavo del passo 1', () => {

  it('R1 — su USCITA la scheda differita parla di pagamento, non di incasso', () => {
    const s = conTipo(creaForm(), 'USCITA').differito;
    expect(s.label).toBe('Economico con pagamento differito');
    expect(s.desc).toContain('Il costo è ora');
    expect(s.esempio.toLowerCase()).toContain('pagat');
    expect(s.label.toLowerCase()).not.toContain('incasso');
  });

  it('R2 — su ENTRATA la stessa scheda parla di ricavo e di incasso', () => {
    const s = conTipo(creaForm(), 'ENTRATA').differito;
    expect(s.label).toBe('Economico con incasso differito');
    expect(s.desc).toContain('Il ricavo è ora');
    expect(s.esempio.toLowerCase()).toContain('incassat');
  });

  /**
   * La scheda non deve promettere che la cassa «arriva dopo»: il passo 4 chiede poi se il denaro
   * è GIÀ passato (movimento vecchio da mettere a libro). Con la vecchia copy le due domande si
   * contraddicevano — è l'incongruenza segnalata il 05/09/2026.
   */
  it('R2b — la scheda differita non promette un verso temporale', () => {
    const c = creaForm();
    for (const tipo of ['ENTRATA', 'USCITA'] as const) {
      const s = conTipo(c, tipo).differito;
      expect(`${s.desc} ${s.esempio}`.toLowerCase()).not.toContain('arriva dopo');
    }
  });

  it('R3 — scheda immediata: ricevuto su entrata, effettuato su uscita', () => {
    const c = creaForm();
    expect(conTipo(c, 'ENTRATA').immediato.esempio).toBe('es. Pagamento ricevuto oggi');
    expect(conTipo(c, 'USCITA').immediato.esempio).toBe('es. Pagamento effettuato oggi');
  });

  it('R4 — il testo segue il toggle senza perdere la scheda già scelta', () => {
    const c = creaForm();
    c.onTipoFlussoChange('differito');
    conTipo(c, 'USCITA');
    expect(c.tipoFlusso()).toBe('differito');                       // selezione intatta
    expect(c.flussoMeta().label).toBe('Economico con pagamento differito');
    conTipo(c, 'ENTRATA');
    expect(c.tipoFlusso()).toBe('differito');
    expect(c.flussoMeta().label).toBe('Economico con incasso differito');
  });

  it('R5/R6 — badge bloccato e riga «Tipo» della revisione leggono la stessa mappa', () => {
    const c = creaForm();
    c.onTipoFlussoChange('soloFinanziario');
    conTipo(c, 'USCITA');
    expect(c.flussoMeta()).toBe(c.schedeFlusso().soloFinanziario);
  });

  it('il solo finanziario non ha una versione costo/ricavo', () => {
    const c = creaForm();
    expect(conTipo(c, 'ENTRATA').soloFinanziario.esempio)
      .toBe(conTipo(c, 'USCITA').soloFinanziario.esempio);
  });
});

/**
 * Spec incongruenze-flusso-movimento (05/09/2026).
 * Difende le regole che il flusso di creazione violava: il conto CoGe deve seguire la direzione,
 * lo scorporo IVA deve dare lo stesso numero del backend, e un movimento differito già liquidato
 * deve mostrare l'impatto di cassa (i soldi sono sul conto).
 */
describe('MovimentiFormComponent — coerenza del flusso di creazione', () => {

  it('F1 — su ENTRATA il picker CoGe offre solo conti di ricavo', () => {
    const c = creaForm();
    conTipo(c, 'ENTRATA');
    expect(c.cogeTipoFilter()).toEqual(['RICAVO']);
  });

  it('F2 — su USCITA offre costi, oneri finanziari e imposte, mai i ricavi', () => {
    const c = creaForm();
    conTipo(c, 'USCITA');
    expect(c.cogeTipoFilter()).toContain('COSTO');
    expect(c.cogeTipoFilter()).not.toContain('RICAVO');
  });

  it('F3 — il solo finanziario apre i patrimoniali e ignora la direzione', () => {
    const c = creaForm();
    c.onTipoFlussoChange('soloFinanziario');
    expect(c.cogeTipoFilter()).toEqual(['ATTIVITA', 'PASSIVITA']);
    conTipo(c, 'USCITA');
    expect(c.cogeTipoFilter()).toEqual(['ATTIVITA', 'PASSIVITA']);
  });

  it('F4 — IVA scorporata dal lordo, come applyDerivedAmounts: 400,70 al 10% ⇒ 36,43', () => {
    const c = creaForm();
    c.form.controls.importo.setValue(400.70);
    c.form.controls.aliquotaIva.setValue(0.10);
    expect(c.importoIvaCalcolato).toBe(36.43);
  });

  it('F5 — differito + già incassato: la cassa si muove, non resta a zero', () => {
    const c = creaForm();
    conTipo(c, 'ENTRATA');
    c.onTipoFlussoChange('differito');
    c.onStatoFinanziarioChange('incassato');
    c.form.controls.importo.setValue(1000);
    (c as unknown as { _importo: { set(v: unknown): void } })._importo.set(1000);
    expect(c.preview().finanziario).toBe(1000);
    expect(c.preview().economico).toBe(1000);
  });

  it('F6 — differito + non incassato: nessun impatto di cassa, solo previsione', () => {
    const c = creaForm();
    conTipo(c, 'ENTRATA');
    c.onTipoFlussoChange('differito');
    (c as unknown as { _importo: { set(v: unknown): void } })._importo.set(1000);
    expect(c.preview().finanziario).toBe(0);
    expect(c.preview().previsto).toBe(1000);
  });

  it('F7 — una scadenza nel passato è ammessa: il credito scaduto va registrabile', () => {
    const c = creaForm();
    c.onTipoFlussoChange('differito');
    const ieri = new Date(); ieri.setDate(ieri.getDate() - 30);
    c.form.controls.dataLiquidita.setValue(ieri);
    expect(c.form.controls.dataLiquidita.valid).toBe(true);
  });
});
