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
    expect(s.desc).toBe("Il costo è ora, l'uscita di cassa arriva dopo");
    expect(s.esempio).toBe('es. Fattura ricevuta, pagamento a 60gg');
    expect(s.label.toLowerCase()).not.toContain('incasso');
  });

  it('R2 — su ENTRATA il testo resta quello di prima', () => {
    const s = conTipo(creaForm(), 'ENTRATA').differito;
    expect(s.label).toBe('Economico con incasso differito');
    expect(s.esempio).toBe('es. Fattura emessa, incasso tra 90gg');
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
