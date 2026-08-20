import {
  Component,
  Input,
  OnInit,
  signal,
  inject,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { Location } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MovimentiService } from '../../core/services/movimenti.service';
import { ContiService } from '../../core/services/conti.service';
import { BuService } from '../../core/services/bu.service';
import { FornitoriService } from '../../core/services/fornitori.service';
import { LookupService } from '../../core/services/lookup.service';
import { AuthService } from '../../core/auth/auth.service';
import { MovimentoDTO, TipoMovimento, StatoMovimento } from '../../core/models/movimenti.models';
import { BusinessUnitDTO, ContoBancarioDTO, MetodoPagamentoDTO, PianoContiCogeDTO } from '../../core/models/anagrafica.models';

import { EuroPipe } from '../../shared/pipes/euro.pipe';
import { BadgeComponent } from '../../shared/components/badge/badge.component';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader/skeleton-loader.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-movimento-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatDividerModule,
    MatChipsModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    EuroPipe,
    BadgeComponent,
    SkeletonLoaderComponent,
  ],
  templateUrl: './movimento-detail.component.html',
  styleUrls: ['./movimento-detail.component.scss'],
})
export class MovimentoDetailComponent implements OnInit {
  @Input() id!: string;

  private readonly movimentiService = inject(MovimentiService);
  private readonly contiService = inject(ContiService);
  private readonly buService = inject(BuService);
  private readonly fornitoriService = inject(FornitoriService);
  private readonly lookupService = inject(LookupService);
  readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly cdr = inject(ChangeDetectorRef);

  movimento = signal<MovimentoDTO | null>(null);
  loading = signal(true);
  liquidando = signal(false);
  buMap = signal<Map<number, BusinessUnitDTO>>(new Map());
  contiMap = signal<Map<number, ContoBancarioDTO>>(new Map());
  contiList = signal<ContoBancarioDTO[]>([]);
  fornitoreNome = signal<string | null>(null);

  metodiPagamento: MetodoPagamentoDTO[] = [];
  private pianoConti: PianoContiCogeDTO[] = [];

  ngOnInit(): void {
    this.lookupService.getMetodiPagamento().subscribe(metodi => {
      this.metodiPagamento = metodi;
      this.cdr.markForCheck();
    });

    this.lookupService.getPianoConti().subscribe(piano => {
      this.pianoConti = piano;
      this.cdr.markForCheck();
    });

    this.buService.getAll().subscribe(units => {
      this.buMap.set(new Map(units.map(u => [u.id, u])));
      this.cdr.markForCheck();
    });
    this.contiService.getAll().subscribe(conti => {
      this.contiMap.set(new Map(conti.map(c => [c.id, c])));
      this.contiList.set(conti);
      this.cdr.markForCheck();
    });

    this.movimentiService.getById(this.id).subscribe({
      next: mov => {
        this.movimento.set(mov);
        this.loading.set(false);
        if (mov.fornitoreId) {
          this.fornitoriService.getById(mov.fornitoreId).subscribe(f => {
            this.fornitoreNome.set(f.ragioneSociale);
            this.cdr.markForCheck();
          });
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Movimento non trovato', 'OK', { duration: 3000 });
        this.router.navigate(['/movimenti']);
      },
    });
  }

  goBack(): void {
    this.location.back();
  }

  liquidaMovimento(contoBancarioId: number): void {
    const mov = this.movimento();
    if (!mov || this.liquidando()) return;
    this.liquidando.set(true);
    this.movimentiService.liquida(mov.id, contoBancarioId).subscribe({
      next: updated => {
        this.movimento.set(updated);
        this.liquidando.set(false);
        this.cdr.markForCheck();
        this.snackBar.open('Movimento liquidato ✓', 'OK', { duration: 3000 });
      },
      error: () => {
        this.liquidando.set(false);
        this.cdr.markForCheck();
        this.snackBar.open('Errore durante la liquidazione', 'OK', { duration: 3000 });
      },
    });
  }

  /**
   * Divide un movimento cumulativo (RiBa/effetti) in N quote — spec riba-split-importo.
   * Il dialog è caricato a richiesta: è una funzione rara, non deve pesare sul bundle di ogni
   * apertura di dettaglio.
   */
  dividiMovimento(): void {
    const mov = this.movimento();
    if (!mov) return;
    import('./dividi-movimento-dialog.component').then(m => {
      this.dialog.open(m.DividiMovimentoDialogComponent, {
        data: { movimento: mov }, autoFocus: false, maxHeight: '90vh',
      }).afterClosed().subscribe(figli => {
        if (figli) this.router.navigate(['/movimenti']);
      });
    });
  }

  /**
   * La divisione ha senso solo su un movimento vivo e non legato a un evento: il server rifiuta
   * comunque (R6/R10), ma un bottone che promette e poi nega è peggio di un bottone assente.
   */
  divisibile(mov: MovimentoDTO): boolean {
    return mov.stato !== 'ANNULLATO' && !mov.eventoId;
  }

  deleteMovimento(): void {
    const mov = this.movimento();
    if (!mov) return;
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Elimina movimento',
        message: `Eliminare il movimento "${mov.descrizione}"? L'operazione non può essere annullata.`,
        confirmLabel: 'Elimina',
        danger: true,
      },
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.movimentiService.delete(mov.id).subscribe({
        next: () => {
          this.snackBar.open('Movimento eliminato', 'OK', { duration: 3000 });
          this.router.navigate(['/movimenti']);
        },
        error: () => this.snackBar.open('Errore durante l\'eliminazione', 'OK', { duration: 3000 }),
      });
    });
  }

  formatDate(str: string | null): string {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }

  /** Testo leggibile dello stato di scadenza per un movimento Da Liquidare (Feature 1). */
  scadenzaTesto(mov: { giorniAllaScadenza: number | null; tipo: string }): string {
    const g = mov.giorniAllaScadenza;
    if (g == null) return '—';
    if (g < 0) {
      return mov.tipo === 'USCITA'
        ? `In ritardo di ${-g} giorni sul pagamento`
        : `In attesa del pagamento da ${-g} giorni`;
    }
    if (g === 0) return 'Scade oggi';
    return `Scade tra ${g} giorni`;
  }

  formatDateTime(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('it-IT');
  }

  tipoColor(tipo: TipoMovimento): string {
    return tipo === 'ENTRATA' ? '#2E7D32' : '#C62828';
  }

  statoColor(stato: StatoMovimento): string {
    const map: Record<StatoMovimento, string> = {
      REGISTRATO:   '#2C6E8F',
      DA_LIQUIDARE: '#F57C00',
      ANNULLATO:    '#C62828',
    };
    return map[stato] ?? '#6B7280';
  }

  fonteColor(fonte: string | null): string {
    const map: Record<string, string> = {
      MANUALE:    '#6B7280',
      IMPORT_CSV: '#3182CE',
      STRIPE:     '#6772E5',
      SATISPAY:   '#FF466C',
      SHOPIFY:    '#95BF47',
      BILLY:      '#DD6B20',
    };
    return fonte ? (map[fonte] ?? '#6B7280') : '#6B7280';
  }

  buNome(buId: number): string {
    return this.buMap().get(buId)?.nome ?? `BU#${buId}`;
  }

  buColore(buId: number): string {
    return this.buMap().get(buId)?.colore ?? '#6B7280';
  }

  contoNome(contoId: number): string {
    return this.contiMap().get(contoId)?.nome ?? `Conto#${contoId}`;
  }

  metodoPagamentoNome(id: number): string {
    return this.metodiPagamento.find(m => m.id === id)?.descrizione ?? `Metodo#${id}`;
  }

  cogeNome(id: number): string {
    const found = this.pianoConti.find(c => c.id === id);
    return found ? `${found.nome} (${found.codice})` : `CoGe#${id}`;
  }
}
