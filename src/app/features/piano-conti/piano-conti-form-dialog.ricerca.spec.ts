import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PianoContiFormDialogComponent } from './piano-conti-form-dialog.component';
import { PianoContiService } from '../../core/services/piano-conti.service';
import { PianoContiCogeDTO } from '../../core/models/anagrafica.models';

/**
 * Ricerca nel select "conto padre": substring (non solo prefisso) su nome E codice,
 * insensibile a maiuscole/accenti, e il selezionato non sparisce mai dalla lista
 * (fuori dal DOM mat-select mostrerebbe un trigger vuoto).
 */
function conto(id: number, codice: string, nome: string): PianoContiCogeDTO {
  return { id, codice, nome, tipo: 'RICAVO', parentId: null, livello: codice.split('.').length } as PianoContiCogeDTO;
}

const CONTI = [
  conto(1, '30', 'Ricavi delle vendite'),
  conto(2, '30.01', 'Vendita torte da asporto'),
  conto(3, '30.02', 'Eventi privati'),
  conto(4, '31', 'Città metropolitana'),
];

function crea(): PianoContiFormDialogComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      PianoContiFormDialogComponent,
      { provide: MAT_DIALOG_DATA, useValue: { conti: CONTI } },
      { provide: MatDialogRef, useValue: { close: () => {}, updateSize: () => {} } },
      ...[PianoContiService, MatSnackBar, MatDialog].map(t => ({ provide: t, useValue: {} })),
    ],
  });
  const c = TestBed.inject(PianoContiFormDialogComponent);
  c.scegliTipo('RICAVO');
  return c;
}

describe('piano conti · ricerca conto padre', () => {
  it('senza query mostra tutte le opzioni', () => {
    const c = crea();
    expect(c.parentOptionsFiltrate().length).toBe(4);
  });

  it('trova per substring, non solo dall’iniziale', () => {
    const c = crea();
    c.parentQuery.set('torte');
    expect(c.parentOptionsFiltrate().map(o => o.id)).toEqual([2]);
  });

  it('cerca anche nel codice', () => {
    const c = crea();
    c.parentQuery.set('30.02');
    expect(c.parentOptionsFiltrate().map(o => o.id)).toEqual([3]);
  });

  it('ignora maiuscole e accenti, e accetta più token in qualsiasi ordine', () => {
    const c = crea();
    c.parentQuery.set('CITTA');
    expect(c.parentOptionsFiltrate().map(o => o.id)).toEqual([4]);
    c.parentQuery.set('asporto vend');
    expect(c.parentOptionsFiltrate().map(o => o.id)).toEqual([2]);
  });

  it('tiene in lista il conto selezionato anche se non matcha', () => {
    const c = crea();
    c.form.controls.parentId.setValue(4);
    c.parentQuery.set('torte');
    expect(c.parentOptionsFiltrate().map(o => o.id).sort()).toEqual([2, 4]);
  });

  it('query senza match ⇒ lista vuota (l’empty state del pannello)', () => {
    const c = crea();
    c.parentQuery.set('zzz');
    expect(c.parentOptionsFiltrate().length).toBe(0);
  });
});
