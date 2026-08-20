import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { CogePickerDialogComponent, CogePickerData } from './coge-picker-dialog.component';
import { PianoContiFormData } from '../../../features/piano-conti/piano-conti-form-dialog.component';
import { PianoContiCogeDTO, TipoCoge } from '../../../core/models/anagrafica.models';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Spec coge-01: ogni conto imputabile (= senza figli attivi) è raggiungibile dal picker.
 * Spec coge-02: la maschera è divisa in Costi | Ricavi | Altro.
 * L'oracolo NON è un numero scritto a mano ma l'insieme delle foglie ricalcolato dal fixture:
 * un conteggio direbbe «127 conti» anche con il conto sbagliato dentro (era il caso in produzione).
 */
function conto(id: number, codice: string, nome: string, parentId: number | null = null,
               tipo = 'COSTO'): PianoContiCogeDTO {
  return { id, codice, nome, tipo: tipo as TipoCoge, parentId, livello: codice.split('.').length };
}

/** Foglie attese: i conti che non compaiono come parentId di nessun altro conto della lista. */
function foglieAttese(conti: PianoContiCogeDTO[]): number[] {
  const padri = new Set(conti.map(c => c.parentId).filter(x => x != null));
  return conti.filter(c => !padri.has(c.id)).map(c => c.id).sort((a, b) => a - b);
}

// Forma reale del piano dei conti (prod 19/08/2026, dopo la bonifica di coge-01).
const PIANO: PianoContiCogeDTO[] = [
  conto(4, '40', 'COSTI OPERATIVI'),
  conto(94, '40.11', 'Altri costi operativi', 4),
  conto(95, '40.11.001', 'Sonvico – forniture varie', 94),          // categoria a foglia singola (R3)
  conto(162, '40.15', 'Commissioni su vendita prodotti', 4),
  conto(98, '40.15.001', 'Commissioni Alveare', 162),
  conto(161, '40.15.002', 'Commissione mercato Rebbio', 162),
  conto(5, '50', 'INVESTIMENTI (CAPEX)'),
  conto(71, '50.01', 'Attrezzature e macchinari', 5),
  conto(72, '50.01.001', 'Macchinari cucina', 71),
  conto(73, '50.01.002', 'Lavapavimenti', 71),
  conto(171, '94', 'Costo temporaneo'),                              // radice piatta creata a mano
  conto(3, '30', 'RICAVI', null, 'RICAVO'),
  conto(26, '30.01', 'Ricavi Ristorazione', 3, 'RICAVO'),
  conto(30, '30.01.001', 'Ricavi ristorazione privati', 26, 'RICAVO'),
  conto(31, '30.01.002', 'Ricavi bar', 26, 'RICAVO'),
  conto(172, '95', 'Ricavo Temporaneo', null, 'RICAVO'),             // radice piatta creata a mano
  conto(1, '10', 'ATTIVO', null, 'ATTIVITA'),
  conto(6, '10.01', 'Liquidità e disponibilità', 1, 'ATTIVITA'),
  conto(7, '10.01.001', 'Cassa contanti', 6, 'ATTIVITA'),
  conto(8, '10.01.002', 'Banca BPM', 6, 'ATTIVITA'),
  conto(109, '60.01', 'Interessi passivi', null, 'ONERE_FINANZIARIO'),
  conto(110, '60.01.001', 'Interessi mutuo', 109, 'ONERE_FINANZIARIO'),
  conto(117, '70.01', 'IRAP', null, 'IMPOSTA'),
  conto(118, '70.01.001', 'IRAP esercizio', 117, 'IMPOSTA'),
];

/** Stato del dialog di creazione annidato: cosa risponde, chi sono io, cosa è stato aperto. */
let admin = true;
let esitoCreazione: unknown = undefined;
let apertoCon: PianoContiFormData | undefined;

function creaPicker(data: Partial<CogePickerData> = {}): CogePickerDialogComponent {
  TestBed.resetTestingModule();
  apertoCon = undefined;
  TestBed.configureTestingModule({
    providers: [
      CogePickerDialogComponent,
      { provide: MAT_DIALOG_DATA, useValue: { conti: PIANO, ...data } as CogePickerData },
      { provide: MatDialogRef, useValue: { close: () => {} } },
      {
        provide: MatDialog,
        useValue: {
          open: (_c: unknown, config: { data: PianoContiFormData }) => {
            apertoCon = config.data;
            return { afterClosed: () => of(esitoCreazione) };
          },
        },
      },
      { provide: AuthService, useValue: { isAdmin: () => admin } },
    ],
  });
  return TestBed.inject(CogePickerDialogComponent);
}

/** Ciò che l'utente raggiunge NAVIGANDO: gruppo per gruppo, categoria per categoria. */
function offerti(p: CogePickerDialogComponent): number[] {
  const ids = p.gruppi().flatMap(g => {
    p.gruppoSel.set(g.key);
    return p.categorie().flatMap(c => c.conti.map(x => x.id));
  });
  return ids.sort((a, b) => a - b);
}

describe('CogePickerDialogComponent — raggiungibilità dei conti imputabili (coge-01)', () => {

  it('R1 — offre esattamente le foglie del piano (insieme, non conteggio)', () => {
    expect(offerti(creaPicker())).toEqual(foglieAttese(PIANO));
  });

  it('R1 — con allowedIds offre esattamente le foglie ammesse', () => {
    const allowedIds = [98, 161, 95, 94];   // 94 è un mastro: resta comunque fuori
    const atteso = foglieAttese(PIANO).filter(id => allowedIds.includes(id));
    expect(offerti(creaPicker({ allowedIds }))).toEqual(atteso);
  });

  it('R3 — «Commissioni Alveare» è selezionabile e sta sotto la categoria 40.15', () => {
    const cat = creaPicker().categorie().find(c => c.codice === '40.15');
    expect(cat?.conti.map(c => c.nome)).toEqual(['Commissioni Alveare', 'Commissione mercato Rebbio']);
  });

  it('regressione — se 40.15.002 torna appeso a 40.15.001, Alveare sparisce dal picker', () => {
    const rotto = PIANO.map(c => (c.id === 161 ? { ...c, parentId: 98 } : c));
    const picker = creaPicker({ conti: rotto });
    expect(offerti(picker)).not.toContain(98);
    expect(offerti(picker)).toEqual(foglieAttese(rotto));   // la regola resta vera: il dato era sporco
  });

  it('R5 — la ricerca trova «alveare» (nome) e «40.15» (codice)', () => {
    const picker = creaPicker();
    picker.query.set('alveare');
    expect(picker.risultati().map(c => c.id)).toEqual([98]);
    picker.query.set('40.15');
    expect(picker.risultati().map(c => c.id).sort((a, b) => a - b)).toEqual([98, 161]);
  });

  it('R6 — un conto rimasto senza figli ATTIVI diventa imputabile (i disattivi non arrivano dall\'API)', () => {
    const senzaRebbio = PIANO.filter(c => c.id !== 161);   // 161 soft-deleted → fuori dalla lista
    expect(offerti(creaPicker({ conti: senzaRebbio }))).toContain(98);
  });
});

describe('CogePickerDialogComponent — maschera Costi | Ricavi | Altro (coge-02)', () => {

  const gruppoDiTest = (tipo: string) => (tipo === 'COSTO' ? 'COSTI' : tipo === 'RICAVO' ? 'RICAVI' : 'ALTRO');

  it('R1 — tre gruppi nell\'ordine Costi, Ricavi, Altro; i conteggi sommano a tutte le foglie', () => {
    const picker = creaPicker();
    const gruppi = picker.gruppi();
    expect(gruppi.map(g => g.label)).toEqual(['Costi', 'Ricavi', 'Altro']);

    // Oracolo ricalcolato dal fixture, non scritto a mano.
    const foglie = PIANO.filter(c => foglieAttese(PIANO).includes(c.id));
    for (const g of gruppi) {
      expect(g.n).toBe(foglie.filter(c => gruppoDiTest(c.tipo) === g.key).length);
    }
    expect(gruppi.reduce((s, g) => s + g.n, 0)).toBe(foglie.length);
  });

  it('R1 — ogni gruppo contiene solo i tipi suoi; «Altro» prende tutto il resto', () => {
    const picker = creaPicker();
    for (const g of picker.gruppi()) {
      picker.gruppoSel.set(g.key);
      const tipi = new Set(picker.categorie().flatMap(c => c.conti).map(c => c.tipo));
      expect([...tipi].every(t => gruppoDiTest(t) === g.key)).toBe(true);
    }
    picker.gruppoSel.set('ALTRO');
    expect(new Set(picker.categorie().flatMap(c => c.conti).map(c => c.tipo)))
      .toEqual(new Set(['ATTIVITA', 'ONERE_FINANZIARIO', 'IMPOSTA']));
  });

  it('R1b — i conti radice stanno nel gruppo del loro tipo, non in una categoria «Altri» in cima', () => {
    const picker = creaPicker();
    // Nessuna categoria a codice vuoto da nessuna parte, e la preselezione non ci finisce sopra.
    for (const g of picker.gruppi()) {
      picker.gruppoSel.set(g.key);
      expect(picker.categorie().some(c => c.codice === '')).toBe(false);
    }
    expect(creaPicker().catSel()?.codice).not.toBe('');

    picker.gruppoSel.set('COSTI');
    const costi = picker.categorie();
    expect(costi.map(c => c.codice)[0]).not.toBe('94');                     // non è più la prima voce
    expect(costi.find(c => c.codice === '94')?.conti.map(x => x.id)).toEqual([171]);  // ma resta visibile
    picker.gruppoSel.set('RICAVI');
    expect(picker.categorie().find(c => c.codice === '95')?.conti.map(x => x.id)).toEqual([172]);
  });

  it('R2 — con tipoFilter a un solo tipo resta un gruppo solo, già selezionato', () => {
    const picker = creaPicker({ tipoFilter: ['RICAVO'] });
    expect(picker.gruppi().map(g => g.key)).toEqual(['RICAVI']);   // .length===1 → la barra non si mostra
    expect(picker.gruppoSel()).toBe('RICAVI');
  });

  it('R2 — con allowedIds su un solo ramo resta un gruppo solo', () => {
    const picker = creaPicker({ allowedIds: [98, 161] });
    expect(picker.gruppi().map(g => g.key)).toEqual(['COSTI']);
    expect(picker.gruppoSel()).toBe('COSTI');
  });

  it('R2 — allowedIds vuoto: nessun gruppo (empty state), non 3 gruppi da 0', () => {
    const picker = creaPicker({ allowedIds: [] });
    expect(picker.gruppi()).toEqual([]);
    expect(picker.gruppoSel()).toBeNull();
    expect(picker.categorie()).toEqual([]);
  });

  it('R3 — categorie ordinate per codice; quella a foglia singola resta una voce sola', () => {
    const picker = creaPicker();
    picker.gruppoSel.set('COSTI');
    const codici = picker.categorie().map(c => c.codice);
    expect(codici).toEqual([...codici].sort((a, b) => a.localeCompare(b)));
    expect(picker.categorie().find(c => c.codice === '40.11')?.conti.length).toBe(1);  // → resa come foglia
    expect(picker.catSel()?.conti.length).toBeGreaterThan(1);                          // si apre su una vera categoria
  });

  it('R4 — la ricerca resta globale e il percorso mostra il gruppo', () => {
    const picker = creaPicker();
    picker.gruppoSel.set('RICAVI');            // gruppo attivo diverso da quello del conto cercato
    picker.query.set('alveare');
    expect(picker.risultati().map(c => c.id)).toEqual([98]);
    expect(picker.pathOf(picker.risultati()[0])).toBe('Costi › Commissioni su vendita prodotti');
    expect(picker.pathOf(PIANO.find(c => c.id === 171)!)).toBe('Costi');   // radice: solo il gruppo
  });

  it('R5 — i recenti non sono filtrati dal gruppo attivo', () => {
    const picker = creaPicker({ recents: [98, 30, 7] });
    picker.gruppoSel.set('COSTI');
    expect(picker.recentiConti().map(c => c.id)).toEqual([98, 30, 7]);
  });

  it('CAPEX — la categoria 50.01 porta il mastro «INVESTIMENTI (CAPEX)» nella riga di metadati', () => {
    const picker = creaPicker();
    picker.gruppoSel.set('COSTI');
    expect(picker.categorie().find(c => c.codice === '50.01')?.padre).toBe('INVESTIMENTI (CAPEX)');
  });

  it('edge — un tipo nuovo non mappato finisce in «Altro», non fuori dalla lista', () => {
    const conMistero = [...PIANO, conto(900, '80.01', 'Conto misterioso', null, 'TIPO_NUOVO')];
    const picker = creaPicker({ conti: conMistero });
    picker.gruppoSel.set('ALTRO');
    expect(picker.categorie().flatMap(c => c.conti).map(c => c.id)).toContain(900);
    expect(offerti(picker)).toContain(900);
  });

  it('preselezione — con selectedId si apre sul gruppo e sulla categoria del conto', () => {
    const picker = creaPicker({ selectedId: 31 });
    expect(picker.gruppoSel()).toBe('RICAVI');
    expect(picker.catSel()?.codice).toBe('30.01');
    expect(picker.scelto()?.id).toBe(31);
  });
});

describe('CogePickerDialogComponent — creare un conto senza uscire dal picker', () => {

  const NUOVO = conto(300, '40.15.003', 'Commissioni Glovo', 162);   // foglia nuova sotto 40.15

  beforeEach(() => { admin = true; esitoCreazione = undefined; });

  it('il bottone c\'è per un ADMIN, non per un DIPENDENTE (la POST è ADMIN-only)', () => {
    expect(creaPicker().puoCreare()).toBe(true);
    admin = false;
    expect(creaPicker().puoCreare()).toBe(false);
  });

  it('il bottone c\'è anche con allowedIds: i chiamanti la calcolano per esclusione, non è un catalogo chiuso', () => {
    expect(creaPicker({ allowedIds: [98, 161] }).puoCreare()).toBe(true);
  });

  it('regressione — nello smistamento (allowedIds) il conto creato resta selezionabile', () => {
    // Com'è nel wizard spese: tutto il piano tranne i ricavi-evento e i due transitori.
    const ammessi = PIANO.filter(c => !c.codice.startsWith('30.02.')).map(c => c.id);
    const picker = creaPicker({ allowedIds: ammessi });
    const creato = conto(301, '40.15.004', 'Commissioni Deliveroo', 162);   // id NON in `ammessi`
    esitoCreazione = creato;
    picker.creaConto();

    expect(picker.scelto()?.id).toBe(301);
    expect(offerti(picker)).toContain(301);
  });

  it('con tipoFilter a un solo tipo la natura arriva preselezionata e bloccata', () => {
    creaPicker({ tipoFilter: ['RICAVO'] }).creaConto();
    expect(apertoCon?.presetTipo).toBe('RICAVO');
    expect(apertoCon?.bloccaTipo).toBe(true);
  });

  it('senza filtro di tipo la natura resta libera', () => {
    creaPicker().creaConto();
    expect(apertoCon?.presetTipo).toBeUndefined();
    expect(apertoCon?.bloccaTipo).toBe(false);
    expect(apertoCon?.conti.length).toBe(PIANO.length);   // il form vede il piano per generare il codice
  });

  it('il conto creato è selezionato E raggiungibile navigando (non solo scritto in scelto())', () => {
    const picker = creaPicker();
    esitoCreazione = NUOVO;
    picker.creaConto();

    expect(picker.scelto()?.id).toBe(300);
    expect(picker.catSelId()).toBe(162);                  // aperto sulla categoria del conto nuovo
    expect(picker.gruppoSel()).toBe('COSTI');
    // Oracolo ricalcolato: le foglie del piano + la nuova, nessuna persa per strada.
    expect(offerti(picker)).toEqual(foglieAttese([...PIANO, NUOVO]));
  });

  it('annullando la creazione la lista e la selezione non cambiano', () => {
    const picker = creaPicker({ selectedId: 31 });
    esitoCreazione = undefined;
    picker.creaConto();
    expect(picker.scelto()?.id).toBe(31);
    expect(offerti(picker)).toEqual(foglieAttese(PIANO));
  });
});
