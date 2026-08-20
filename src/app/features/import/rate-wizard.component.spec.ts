import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { RateWizardComponent } from './rate-wizard.component';
import { MovimentiService } from '../../core/services/movimenti.service';
import { SpeseRicorrentiService } from '../../core/services/spese-ricorrenti.service';
import { ImportCountsService } from './import-counts.service';
import { RicorrenteParcheggiataDTO, CandidatoRataDTO } from '../../core/models/movimenti.models';
import { PlanSummaryDTO, PlanDetailDTO, InstallmentDTO } from '../spese-ricorrenti/spese-ricorrenti.models';

/**
 * Spec ricorrenti-aggancio-manuale (lotto 19/08/2026, SPEC 2) — tutta frontend.
 * Le guardie sul denaro stanno nel server (I1–I6): qui si difende solo che la terza via esista
 * quando il motore non propone, che non rimpiazzi la proposta quando c'è, e che il payload
 * inviato sia LO STESSO del percorso automatico.
 */

const RATA_MUTUO: RicorrenteParcheggiataDTO = {
  id: 'a547f454', fonte: 'BPM', dataMovimento: '2026-07-31', importo: 2501.17, tipo: 'USCITA',
  contoBancarioId: 1, descrizione: 'RIMBORSO FINANZ. - MUTUO N.1273 5796807 RATA 31/07/2026',
  tipoPresunto: 'MUTUO', recurringPlanId: null, stato: 'DA_RICONCILIARE',
  cogeSuggeritoId: null, cogeSuggeritoCodice: null, propostaRataId: null, candidati: [],
};

const CANDIDATO: CandidatoRataDTO = {
  pianoId: 'p1', pianoDescrizione: 'Mutuo Banco BPM', rataId: 'r7', numeroRata: 7,
  dataScadenza: '2026-07-31', importoRata: 2500, scartoGiorni: 0, scartoImporto: 1.17,
  motivo: 'il nome del piano compare nella causale',
};

const PIANO: PlanSummaryDTO = {
  id: 'p1', descrizione: 'Mutuo Banco BPM', contoBancarioId: 1, contoBancarioNome: 'Banco BPM',
  contoCoge: 1, contoCogeDescrizione: 'Mutui', importoRata: 2500, variazionePct: 0,
  giornoDelMese: 31, frequenza: 'MENSILE', numeroRate: 60, dataPrimaRata: '2026-01-31',
  stato: 'ATTIVO', riferimentoEstrattoConto: null, ratePending: 54, ratePaid: 6,
  rateSkipped: 0, rateCancelled: 0, totalePagato: 15000, totaleResiduo: 135000,
};

function rata(id: string, n: number, stato: InstallmentDTO['stato']): InstallmentDTO {
  return {
    id, numeroRata: n, dataScadenza: '2026-07-31', importo: 2500, stato,
    movimentoId: null, note: null, quotaCapitale: 2000, quotaInteressi: 500,
  };
}

const DETTAGLIO = {
  ...PIANO, note: null, totalePiano: 150000, totaleInteressi: 30000, totaleCapitale: 120000,
  tipoPiano: 'FINANZIAMENTO', tassoInteresseAnnuo: 4, importoDebitoIniziale: 120000,
  contoCogeInteressiId: 2, contoCogeInteressiDescrizione: 'Interessi', saldoContoBancario: 0,
  rate: [rata('r6', 6, 'PAID'), rata('r7', 7, 'PENDING'), rata('r8', 8, 'CANCELLED')],
} as PlanDetailDTO;

interface Inviato { id: string; body: unknown; }

function crea(riga: RicorrenteParcheggiataDTO, inviati: Inviato[] = [], piani = [PIANO]) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [RateWizardComponent],
    providers: [
      provideRouter([]), provideNoopAnimations(),
      { provide: MovimentiService, useValue: {
          getRicorrenti: () => of({ content: [riga] }),
          risolviRicorrente: (id: string, body: unknown) => { inviati.push({ id, body }); return of({}); },
        } },
      { provide: SpeseRicorrentiService, useValue: {
          listPlans: () => of(piani),
          getPlan: () => of(DETTAGLIO),
        } },
      { provide: ImportCountsService, useValue: { reload: () => {} } },
      { provide: MatSnackBar, useValue: { open: () => {} } },
    ],
  });
  const f: ComponentFixture<RateWizardComponent> = TestBed.createComponent(RateWizardComponent);
  f.detectChanges();
  return f;
}

function testi(f: ComponentFixture<RateWizardComponent>): string {
  return (f.nativeElement as HTMLElement).textContent ?? '';
}

describe('RateWizardComponent — aggancio manuale piano+rata', () => {

  it('R1 — senza candidati compare la terza via, e porta ai piani e alle rate', () => {
    const f = crea(RATA_MUTUO);
    expect(testi(f)).toContain('Scelgo io il piano e la rata');

    f.componentInstance.apriManuale();
    f.detectChanges();
    expect(testi(f)).toContain('Mutuo Banco BPM');          // elenco piani attivi

    f.componentInstance.scegliPiano(PIANO);
    f.detectChanges();
    expect(f.componentInstance.pianoManuale()?.id).toBe('p1');
    expect(testi(f)).toContain('Rata 7');                   // elenco rate del piano
  });

  it('R3 — con la proposta del motore la terza via non compare e la proposta resta', () => {
    const conProposta = { ...RATA_MUTUO, propostaRataId: 'r7', candidati: [CANDIDATO] };
    const f = crea(conProposta);
    expect(testi(f)).toContain('Il piano che corrisponde');
    expect(testi(f)).toContain('perché: il nome del piano compare nella causale');
    expect(testi(f)).not.toContain('Scelgo io il piano e la rata');
    expect(f.componentInstance.proposta(conProposta)).toBe(CANDIDATO);
  });

  it('R2 — la scelta manuale invia lo STESSO payload del percorso automatico', () => {
    const inviati: Inviato[] = [];
    const f = crea(RATA_MUTUO, inviati);
    const c = f.componentInstance;

    c.apriManuale();
    c.scegliPiano(PIANO);
    c.scegliRataManuale(DETTAGLIO, rata('r7', 7, 'PENDING'));
    f.detectChanges();

    expect(c.candidatoScelto()?.rataId).toBe('r7');
    c.collega(RATA_MUTUO, c.candidatoScelto()!);

    expect(inviati.length).toBe(1);
    expect(inviati[0].id).toBe('a547f454');
    expect(inviati[0].body).toEqual({
      azione: 'COLLEGA', cogeId: null, pianoId: 'p1', rataId: 'r7', nota: null,
    });
  });

  it('R4 — lo stato della rata si legge prima di cliccare; annullate e saltate non si scelgono', () => {
    const f = crea(RATA_MUTUO);
    const c = f.componentInstance;

    expect(c.statoRata(rata('r7', 7, 'PENDING'))).toBe('da pagare');
    expect(c.statoRata(rata('r6', 6, 'PAID'))).toContain('già pagata');
    expect(c.rataCollegabile(rata('r8', 8, 'CANCELLED'))).toBeFalse();
    expect(c.rataCollegabile(rata('r9', 9, 'SKIPPED'))).toBeFalse();

    c.scegliRataManuale(DETTAGLIO, rata('r8', 8, 'CANCELLED'));
    expect(c.candidatoScelto()).toBeNull();                 // il click non fa nulla
  });

  it('riga senza data: l\'errore si dice prima, non si aggira', () => {
    const f = crea({ ...RATA_MUTUO, dataMovimento: null });
    const c = f.componentInstance;
    c.apriManuale();
    c.scegliPiano(PIANO);
    c.scegliRataManuale(DETTAGLIO, rata('r7', 7, 'PENDING'));
    f.detectChanges();
    expect(testi(f)).toContain('non ha data di addebito');
  });
});
