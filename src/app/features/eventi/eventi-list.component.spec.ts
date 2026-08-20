import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EventiListComponent } from './eventi-list.component';
import { EventiService } from '../../core/services/eventi.service';
import { BuService } from '../../core/services/bu.service';
import { AuthService } from '../../core/auth/auth.service';
import { EventoDTO } from '../../core/models/eventi.models';

/**
 * Spec eventi-storico-e-ordinamento (lotto 19/08/2026, punto 5) — parte frontend.
 * La partizione e l'ordinamento sono responsabilità del server (`vista`): qui si testano le sole
 * decisioni che vivono in pagina — il badge «da chiudere», i chip di stato e il rimando allo Storico.
 */
function evento(data: string, stato: EventoDTO['stato']): EventoDTO {
  return { id: 'x', nome: 'Evento', dataEvento: data, stato } as EventoDTO;
}

function creaLista(vista: 'LISTA' | 'STORICO'): EventiListComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      EventiListComponent,
      { provide: ChangeDetectorRef, useValue: { markForCheck: () => {} } },
      ...[EventiService, BuService, AuthService, Router, MatDialog, MatSnackBar]
        .map(t => ({ provide: t, useValue: {} })),
    ],
  });
  const c = TestBed.inject(EventiListComponent);
  c.vista = vista;
  return c;
}

describe('EventiListComponent — Lista e Storico', () => {

  it('R1 — «da chiudere» solo su un evento passato e non saldato, e solo nella Lista', () => {
    const lista = creaLista('LISTA');
    const ieri = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const domani = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    expect(lista.daChiudere(evento(ieri, 'CONFERMATO'))).toBeTrue();
    expect(lista.daChiudere(evento(domani, 'CONFERMATO'))).toBeFalse();
    expect(lista.daChiudere(evento(ieri, 'SALDATO'))).toBeFalse();
    // Nello Storico è tutto passato e tutto saldato: il badge non ha niente da dire.
    expect(creaLista('STORICO').daChiudere(evento(ieri, 'SALDATO'))).toBeFalse();
  });

  it('R2 — nello Storico i chip di stato spariscono (ogni riga è SALDATO)', () => {
    expect(creaLista('STORICO').stati).toEqual([]);
    expect(creaLista('LISTA').stati.length).toBeGreaterThan(0);
  });

  it('R5 — chiedere i SALDATI dalla Lista rimanda allo Storico invece di svuotare la lista', () => {
    const lista = creaLista('LISTA');
    let rimandato = 0;
    lista.vaiAlloStorico.subscribe(() => rimandato++);
    spyOn(lista, 'loadData');

    lista.selectStato('SALDATO');
    expect(rimandato).toBe(1);
    expect(lista.selectedStato()).toBe('');       // il filtro della Lista resta invariato
    expect(lista.loadData).not.toHaveBeenCalled();

    lista.selectStato('CONFERMATO');               // gli altri stati filtrano come sempre
    expect(lista.selectedStato()).toBe('CONFERMATO');
    expect(lista.loadData).toHaveBeenCalled();
  });
});
