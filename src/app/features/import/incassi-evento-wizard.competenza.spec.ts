import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { IncassiEventoWizardComponent } from './incassi-evento-wizard.component';
import { MovimentiService } from '../../core/services/movimenti.service';
import { EventiService } from '../../core/services/eventi.service';
import { ImportCountsService } from './import-counts.service';
import { EventoParcheggiatoDTO } from '../../core/models/movimenti.models';
import { EventoDTO } from '../../core/models/eventi.models';

/**
 * Guardia del difetto del 08/09/2026: `lk_tipi_evento_mov` ha SEI codici, il frontend ne
 * mappava cinque. La riga COMPETENZA (Fase 4: ricavo maturato non incassato) arriva dentro
 * `EventoDTO.pagamenti` come qualunque altro pagamento — `buildEventoDTO` la mappa verbatim —
 * e faceva esplodere `parolaBreve()` con
 *   TypeError: Cannot read properties of undefined (reading 'replace')
 * abortendo il render del resto del template, cioè la scelta del tipo di movimento.
 *
 * Dato reale che lo innesca (agosdb allineato a prod l'08/09/2026): 20 eventi CONFERMATO —
 * quindi tutti selezionabili nel wizard — con una riga COMPETENZA DA_LIQUIDARE, 23.716,00 €
 * in totale. Qui è riprodotto «Matrimonio Locatelli» (29/08/2026, 3.200,00 €).
 */

const RIGA: EventoParcheggiatoDTO = {
  id: 'r1', fonte: 'IMPORT_BANCA', chiaveAggancio: null, dataMovimento: '2026-08-29',
  importo: 1000, tipo: 'ENTRATA', contoBancarioId: 1,
  descrizioneNorm: 'BONIFICO DA LOCATELLI', tipoEventoPresunto: null, keywordMatch: null,
  controparteNome: 'LOCATELLI', controparteIban: null, dataEventoEstratta: '2026-08-29',
  stato: 'DA_RICONCILIARE', eventoSuggeritoId: null, eventoSuggeritoNome: null,
  gemelloInseritoIl: null, gemelloEventoNome: null,
};

/** L'evento come lo restituisce il server oggi in produzione: con la riga COMPETENZA dentro. */
const EVENTO_CON_COMPETENZA = {
  id: 'e1', nome: 'Matrimonio Locatelli', tipo: 'MATRIMONIO', dataEvento: '2026-08-29',
  dataPreventivo: null, importoTotalePreviventivato: 3200, importoIncassato: 0,
  caparreIncassate: 0, costiDirettiImputati: 0, stato: 'CONFERMATO', businessUnitId: 2,
  contattoNome: 'Locatelli', contattoTelefono: null, contattoEmail: null,
  numeroTotalePartecipanti: 80, numeroBambini: null, allergie: [], note: null,
  menuPdfUrl: null, noteAnnullamento: null, importoResiduo: 3200, percentualeIncassata: 0,
  costiReali: 0, profitto: 0, dataConferma: null, dataSaldo: null,
  pagamenti: [
    // tipo fuori dai 5 codici del frontend: è il 6° di lk_tipi_evento_mov.
    { movimentoId: 'm1', tipo: 'COMPETENZA', importo: 3200,
      dataFinanziaria: '2026-08-29', note: null, stato: 'DA_LIQUIDARE' },
  ],
  voci: null, totaleConsuntivato: null, scostamentoConsuntivo: null,
  createdAt: '2026-08-01T10:00:00Z', createdBy: 'u1',
} as unknown as EventoDTO;

function crea(evento: EventoDTO): ComponentFixture<IncassiEventoWizardComponent> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [IncassiEventoWizardComponent],
    providers: [
      provideRouter([]), provideNoopAnimations(),
      { provide: MovimentiService, useValue: {
          getEventiParcheggiati: () => of({ content: [RIGA] }),
          risolviEvento: () => of({}),
        } },
      { provide: EventiService, useValue: { getList: () => of({ content: [evento] }) } },
      { provide: ImportCountsService, useValue: { reload: () => {} } },
      { provide: MatSnackBar, useValue: { open: () => {} } },
    ],
  });
  const f = TestBed.createComponent(IncassiEventoWizardComponent);
  f.detectChanges();
  return f;
}

function testi(f: ComponentFixture<IncassiEventoWizardComponent>): string {
  return (f.nativeElement as HTMLElement).textContent ?? '';
}

describe('IncassiEventoWizardComponent — tipo di pagamento fuori dai 5 codici del frontend', () => {

  it('C1 — scegliere un evento con una riga COMPETENZA non fa esplodere il render', () => {
    const f = crea(EVENTO_CON_COMPETENZA);
    f.componentInstance.scegliEvento(EVENTO_CON_COMPETENZA);
    expect(() => f.detectChanges()).not.toThrow();
  });

  it('C2 — con la riga COMPETENZA la scelta del tipo di movimento resta selezionabile', () => {
    const f = crea(EVENTO_CON_COMPETENZA);
    f.componentInstance.scegliEvento(EVENTO_CON_COMPETENZA);
    f.detectChanges();

    // È il secondo sintomo riportato dal titolare: «non riesco più a selezionare il tipo».
    expect(testi(f)).toContain('È una caparra, un acconto o il saldo?');
    const bottoni = (f.nativeElement as HTMLElement)
      .querySelectorAll('.wz__voce--stretta');
    expect(bottoni.length).toBe(5);
  });

  it('C3 — parolaBreve non esplode su un codice che il frontend non conosce', () => {
    const f = crea(EVENTO_CON_COMPETENZA);
    const c = f.componentInstance as unknown as { parolaBreve: (t: string) => string };
    expect(() => c.parolaBreve('COMPETENZA')).not.toThrow();
    expect(c.parolaBreve('COMPETENZA')).toBeTruthy();
  });
});
