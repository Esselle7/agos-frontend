import {
  Component,
  signal,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { AuthService } from '../../core/auth/auth.service';
import { EventiListComponent } from './eventi-list.component';
import { EventiCalendarioComponent } from './eventi-calendario.component';
import { EventiMieiListComponent } from './eventi-miei-list.component';

@Component({
  selector: 'app-eventi',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    EventiListComponent,
    EventiCalendarioComponent,
    EventiMieiListComponent,
  ],
  templateUrl: './eventi.component.html',
  styleUrls: ['./eventi.component.scss'],
})
export class EventiComponent {
  private readonly dialog = inject(MatDialog);
  readonly auth = inject(AuthService);

  readonly refreshTrigger = signal(0);

  /** Indice della scheda attiva: serve per portare l'utente allo Storico quando chiede i saldati. */
  readonly tabAttivo = signal(0);

  /** Conteggi delle due schede, scritti nelle etichette: li dichiara ogni lista dopo il caricamento. */
  readonly totaleLista = signal<number | null>(null);
  readonly totaleStorico = signal<number | null>(null);

  /** «Lista» → «Lista (36)». Finché il conteggio non è arrivato, l'etichetta resta secca. */
  etichetta(nome: string, totale: number | null): string {
    return totale == null ? nome : `${nome} (${totale})`;
  }

  vaiAlloStorico(): void {
    this.tabAttivo.set(this.auth.isAdmin() ? 1 : 2);
  }

  openNuovoEvento(): void {
    import('./evento-form-dialog.component').then(m => {
      this.dialog
        .open(m.EventoFormDialogComponent, {
          width: '700px',
          maxHeight: '90vh',
          data: {},
        })
        .afterClosed()
        .subscribe(created => {
          if (created) this.refreshTrigger.update(n => n + 1);
        });
    });
  }
}
