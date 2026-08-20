import { TestBed } from '@angular/core/testing';
import { MovimentiFiltriPanelComponent } from './movimenti-filtri-panel.component';
import { filtriVuoti } from './movimenti-filtri.model';
import { ContiService } from '../../core/services/conti.service';
import { BuService } from '../../core/services/bu.service';
import { LookupService } from '../../core/services/lookup.service';
import { PianoContiService } from '../../core/services/piano-conti.service';
import { FornitoriService } from '../../core/services/fornitori.service';
import { EventiService } from '../../core/services/eventi.service';
import { CategorieService } from '../../core/services/categorie.service';

/**
 * Spec ricerca-eventi-parole-in-mezzo (lotto 19/08/2026, punto 4).
 * L'oracolo è la SOTTOSTRINGA: il typeahead nativo del CDK dentro un mat-select cerca solo per
 * prefisso (`indexOf(q) === 0`), e con 22 eventi su 94 che iniziano per «18esimo» digitare
 * «marika» non portava a «18esimo Marika lupo». Qui si testano i computed, senza renderizzare.
 */

// Etichette reali di produzione (dump 19/08/2026): 22 eventi iniziano per «18esimo»,
// due si chiamano «18esimo» e basta — è il caso che rompeva la ricerca a prefisso.
const EVENTI = [
  { id: 'e1', label: '18esimo Marika lupo — 24/01/2026' },
  { id: 'e2', label: '18esimo — 07/02/2026' },
  { id: 'e3', label: '18esimo Spanò — 27/02/2026' },
  { id: 'e4', label: 'Matrimonio Gianluca — 27/06/2026' },
  { id: 'e5', label: 'Evento senza nome — 12/03/2026' },
];

const FORNITORI = [
  { id: 'f1', ragioneSociale: 'Sonvico Forniture' },
  { id: 'f2', ragioneSociale: 'Crédit Agricole Leasing' },
] as any[];

const METODI = [
  { id: 1, descrizione: 'POS_BPM' },
  { id: 4, descrizione: 'SATISPAY' },
] as any[];

function creaPanel(): MovimentiFiltriPanelComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      MovimentiFiltriPanelComponent,
      // ngOnInit non viene chiamato: i servizi servono solo a soddisfare gli inject().
      ...[ContiService, BuService, LookupService, PianoContiService,
          FornitoriService, EventiService, CategorieService]
        .map(t => ({ provide: t, useValue: {} })),
    ],
  });
  const c = TestBed.inject(MovimentiFiltriPanelComponent);
  c.draft.set(filtriVuoti());
  c.eventi.set(EVENTI);
  c.fornitori.set(FORNITORI);
  c.metodi.set(METODI);
  return c;
}

const etichette = (v: { label: string }[]) => v.map(e => e.label);

describe('MovimentiFiltriPanelComponent — ricerca nelle tendine lunghe', () => {

  it('R1 — «marika» trova «18esimo Marika lupo» (parola in mezzo, non prefisso)', () => {
    const c = creaPanel();
    c.eventoQuery.set('marika');
    expect(etichette(c.eventiFiltrati())).toEqual(['18esimo Marika lupo — 24/01/2026']);
  });

  it('R1 — si può cercare anche per data, che è nell\'etichetta', () => {
    const c = creaPanel();
    c.eventoQuery.set('24/01');
    expect(etichette(c.eventiFiltrati())).toEqual(['18esimo Marika lupo — 24/01/2026']);
  });

  it('R1 — query vuota (o soli spazi) = tutte le opzioni', () => {
    const c = creaPanel();
    expect(c.eventiFiltrati().length).toBe(EVENTI.length);
    c.eventoQuery.set('   ');
    expect(c.eventiFiltrati().length).toBe(EVENTI.length);
  });

  it('R2 — stessa ricerca su fornitori e metodi di pagamento', () => {
    const c = creaPanel();
    c.fornitoreQuery.set('forniture');
    expect(c.fornitoriFiltrati().map(f => f.ragioneSociale)).toEqual(['Sonvico Forniture']);
    c.metodoQuery.set('pay');
    expect(c.metodiFiltrati().map(m => m.descrizione)).toEqual(['SATISPAY']);
  });

  it('R3 — una voce già selezionata resta in lista anche se non corrisponde alla query', () => {
    const c = creaPanel();
    c.setMulti('eventoId', ['e4']);          // Matrimonio Gianluca
    c.eventoQuery.set('marika');
    expect(etichette(c.eventiFiltrati()).sort()).toEqual(
      ['18esimo Marika lupo — 24/01/2026', 'Matrimonio Gianluca — 27/06/2026']);
  });

  it('R6 — insensibile ad accenti e maiuscole: «credit» trova «Crédit», «SPANO» trova «Spanò»', () => {
    const c = creaPanel();
    c.fornitoreQuery.set('CREDIT');
    expect(c.fornitoriFiltrati().map(f => f.ragioneSociale)).toEqual(['Crédit Agricole Leasing']);
    c.eventoQuery.set('SPANO');
    expect(etichette(c.eventiFiltrati())).toEqual(['18esimo Spanò — 27/02/2026']);
  });

  it('nessun risultato → lista vuota (il messaggio a video si attacca a questa condizione)', () => {
    const c = creaPanel();
    c.eventoQuery.set('zzz');
    expect(c.eventiFiltrati()).toEqual([]);
  });

  it('azzera() ripulisce anche le query di ricerca', () => {
    const c = creaPanel();
    c.eventoQuery.set('marika');
    c.fornitoreQuery.set('sonvico');
    c.metodoQuery.set('pay');
    c.cogeQuery.set('49.99');
    c.azzera();
    expect([c.eventoQuery(), c.fornitoreQuery(), c.metodoQuery(), c.cogeQuery()])
      .toEqual(['', '', '', '']);
  });
});
