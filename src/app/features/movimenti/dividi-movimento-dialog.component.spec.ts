import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DividiMovimentoDialogComponent, importiInCausale } from './dividi-movimento-dialog.component';
import { MovimentiService } from '../../core/services/movimenti.service';
import { BuService } from '../../core/services/bu.service';
import { MovimentoDTO } from '../../core/models/movimenti.models';

/**
 * Spec riba-split-importo (lotto 19/08/2026, punto 2) — parte in pagina.
 * La quadratura vera la difende il server (R3, test di integrazione): qui si difende che
 * l'interfaccia non PROPONGA un errore — precompilazione solo se la somma è esatta — e che il
 * bottone non si accenda su quote che non quadrano.
 */
const DESCR_REALE = 'PAGAMENTO EFFETTI/RIBA DETTAGLIO: E. 287,49 E. 663,68 E. 1.098,00';

function movimento(importo: number, descrizione: string): MovimentoDTO {
  return { id: 'm1', importo, descrizione, contoCoge: 7, businessUnitId: 5 } as MovimentoDTO;
}

function creaDialog(mov: MovimentoDTO): DividiMovimentoDialogComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      DividiMovimentoDialogComponent,
      { provide: MAT_DIALOG_DATA, useValue: { movimento: mov } },
      { provide: MatDialogRef, useValue: { close: () => {} } },
      { provide: BuService, useValue: { getAll: () => ({ subscribe: () => {} }) } },
      ...[MovimentiService, MatSnackBar].map(t => ({ provide: t, useValue: {} })),
    ],
  });
  const c = TestBed.inject(DividiMovimentoDialogComponent);
  c.ngOnInit();
  return c;
}

describe('importiInCausale — gli importi «E. …» del dettaglio RiBa', () => {

  it('legge i tre importi della riga reale del 31/07', () => {
    expect(importiInCausale(DESCR_REALE)).toEqual([287.49, 663.68, 1098.00]);
  });

  it('«E.» che non è un importo non diventa una quota', () => {
    expect(importiInCausale('PAGAMENTO A E. SRL RIF. E. 2026')).toEqual([]);
    expect(importiInCausale('BONIFICO SENZA DETTAGLIO')).toEqual([]);
    expect(importiInCausale(null)).toEqual([]);
  });
});

describe('DividiMovimentoDialogComponent', () => {

  it('R2 — dettaglio che quadra: tre quote precompilate e bottone pronto', () => {
    const c = creaDialog(movimento(2049.17, DESCR_REALE));
    expect(c.precompilato()).toBeTrue();
    expect(c.righe().map(r => r.importo)).toEqual([287.49, 663.68, 1098.00]);
    expect(c.quadra()).toBeTrue();
    expect(c.valido()).toBeTrue();                        // coge e BU ereditati dal padre
    expect(c.righe().every(r => r.contoCogeId === 7 && r.businessUnitId === 5)).toBeTrue();
  });

  it('R2 — dettaglio che NON quadra: nessuna precompilazione, e lo scarto è scritto', () => {
    const c = creaDialog(movimento(200, 'RIBA DETTAGLIO: E. 100,00 E. 50,00'));
    expect(c.precompilato()).toBeFalse();
    expect(c.righe().length).toBe(2);
    expect(c.righe().every(r => r.importo === null)).toBeTrue();
    expect(c.messaggioCausale()).toContain('50.00');       // lo scarto, in euro
    expect(c.valido()).toBeFalse();
  });

  it('R3 — il bottone non si accende finché le quote non quadrano al centesimo', () => {
    const c = creaDialog(movimento(100, 'BONIFICO CUMULATIVO'));
    c.setImporto(0, '60');
    c.setImporto(1, '39.99');
    expect(c.quadra()).toBeFalse();
    expect(c.valido()).toBeFalse();
    expect(c.residuo()).toBeCloseTo(0.01, 5);

    c.setImporto(1, '40');
    expect(c.quadra()).toBeTrue();
    expect(c.valido()).toBeTrue();
  });

  it('R3 — una quota senza conto non è valida, e sotto le due quote non si scende', () => {
    const c = creaDialog(movimento(100, 'BONIFICO CUMULATIVO'));
    c.setImporto(0, '60');
    c.setImporto(1, '40');
    c.setCoge(1, null);
    expect(c.valido()).toBeFalse();

    c.setCoge(1, 9);
    expect(c.valido()).toBeTrue();
    c.rimuovi(1);
    expect(c.righe().length).toBe(1);
    expect(c.valido()).toBeFalse();                        // N ≥ 2, come il server
  });

  it('la somma non usa la virgola mobile: 0,1 + 0,2 su un movimento da 0,30 quadra', () => {
    const c = creaDialog(movimento(0.30, 'ARROTONDAMENTO'));
    c.setImporto(0, '0.10');
    c.setImporto(1, '0.20');
    expect(c.quadra()).toBeTrue();
  });
});
