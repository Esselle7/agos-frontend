import {
  Component,
  OnInit,
  OnDestroy,
  computed,
  signal,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { Subject, catchError, debounceTime, distinctUntilChanged, forkJoin, of, switchMap, takeUntil } from 'rxjs';
import { MovimentiService, MovimentiFilter } from '../../core/services/movimenti.service';
import { ContiService } from '../../core/services/conti.service';
import { AuthService } from '../../core/auth/auth.service';
import { BuService } from '../../core/services/bu.service';
import { MovimentoDTO, MovimentiSommarioDTO, TipoMovimento, StatoMovimento } from '../../core/models/movimenti.models';
import { BusinessUnitDTO, ContoBancarioDTO } from '../../core/models/anagrafica.models';
import { PagedResponse } from '../../core/models/shared.models';
import { EuroPipe } from '../../shared/pipes/euro.pipe';
import { BadgeComponent } from '../../shared/components/badge/badge.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader/skeleton-loader.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { FiltriApplicati, MovimentiFiltriPanelComponent } from './movimenti-filtri-panel.component';
import {
  EtichetteFiltri, FiltroChip, MovimentiFiltri,
  chipsDa, contaFiltriAttivi, filtriVuoti, rimuoviChip, toMovimentiFilter,
} from './movimenti-filtri.model';

@Component({
  selector: 'app-movimenti-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    NgTemplateOutlet,
    ReactiveFormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    EuroPipe,
    BadgeComponent,
    EmptyStateComponent,
    SkeletonLoaderComponent,
    MovimentiFiltriPanelComponent,
  ],
  templateUrl: './movimenti-list.component.html',
  styleUrls: ['./movimenti-list.component.scss'],
})
export class MovimentiListComponent implements OnInit, OnDestroy {
  private readonly movimentiService = inject(MovimentiService);
  private readonly buService = inject(BuService);
  private readonly contiService = inject(ContiService);
  readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  /** Sotto 768px la tabella (8 colonne) lascia il posto a una lista di card. */
  readonly isMobile = toSignal(
    inject(BreakpointObserver).observe('(max-width: 768px)').pipe(map(r => r.matches)),
    { initialValue: false },
  );

  readonly displayedColumns = ['dataMovimento', 'tipo', 'descrizione', 'bu', 'fonte', 'importo', 'stato', 'azioni'];
  readonly liquidandoId = signal<string | null>(null);
  readonly conti = signal<ContoBancarioDTO[]>([]);

  result = signal<PagedResponse<MovimentoDTO> | null>(null);
  sommario = signal<MovimentiSommarioDTO | null>(null);
  loading = signal(false);
  buMap = signal<Map<number, BusinessUnitDTO>>(new Map());

  /** La ricerca testuale resta sempre visibile: è il filtro più usato, nasconderla costerebbe un clic ogni volta. */
  readonly searchControl = new FormControl<string>('', { nonNullable: true });

  // ── Filtri avanzati (docs/specs/movimenti-filtri-avanzati.md)
  readonly filtri = signal<MovimentiFiltri>(filtriVuoti());
  readonly etichette = signal<EtichetteFiltri>({});
  readonly panelAperto = signal(false);
  readonly nFiltriAttivi = computed(() => contaFiltriAttivi(this.filtri()));
  readonly chips = computed(() => chipsDa(this.filtri(), this.etichette()));

  private currentPage = 0;
  private currentSize = 20;

  /** Ogni emissione = una richiesta di ricarica. Vedi il switchMap in ngOnInit. */
  private readonly ricarica$ = new Subject<void>();

  ngOnInit(): void {
    this.contiService.getAll().pipe(takeUntil(this.destroy$)).subscribe(list => {
      this.conti.set(list);
    });

    this.buService.getAll().subscribe(units => {
      this.buMap.set(new Map(units.map(u => [u.id, u])));
    });

    // switchMap ANNULLA la richiesta precedente quando ne parte una nuova.
    // Senza, una risposta più vecchia può atterrare dopo quella nuova e sovrascriverla:
    // in pratica la lista mostrava i dati NON filtrati sotto le chip di un filtro attivo.
    this.ricarica$.pipe(
      switchMap(() => {
        this.loading.set(true);
        const base = this.buildFilter();
        return forkJoin({
          lista: this.movimentiService.getList({
            ...base, page: this.currentPage, size: this.currentSize, sort: 'dataMovimento,desc',
          }),
          // Il riepilogo è accessorio: se fallisce non deve far cadere la lista.
          sommario: this.movimentiService.getSommario(base).pipe(catchError(() => of(null))),
        }).pipe(
          // L'errore si ferma qui dentro, altrimenti spegnerebbe lo stream per sempre.
          catchError(() => {
            this.snackBar.open('Errore nel caricamento dei movimenti', 'OK', { duration: 3000 });
            return of(null);
          }),
        );
      }),
      takeUntil(this.destroy$),
    ).subscribe(res => {
      if (res) {
        this.result.set(res.lista);
        this.sommario.set(res.sommario);
      }
      this.loading.set(false);
    });

    this.searchControl.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => {
      this.currentPage = 0;
      this.loadData();
    });

    this.loadData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadData(): void {
    this.ricarica$.next();
  }

  private buildFilter(): MovimentiFilter {
    // La casella di ricerca vive fuori dal pannello: la si innesta qui nello stesso oggetto,
    // così lista e sommario partono da un'unica descrizione del filtro.
    return toMovimentiFilter({ ...this.filtri(), search: this.searchControl.value });
  }

  // ── Pannello filtri ────────────────────────────────────────────────────────

  apriFiltri(): void {
    this.panelAperto.set(true);
  }

  chiudiFiltri(): void {
    this.panelAperto.set(false);
  }

  onFiltriApplicati(evento: FiltriApplicati): void {
    this.filtri.set(evento.filtri);
    this.etichette.set(evento.etichette);
    this.panelAperto.set(false);
    this.currentPage = 0;
    this.loadData();
  }

  rimuoviFiltro(chip: FiltroChip): void {
    this.filtri.update(f => rimuoviChip(f, chip));
    this.currentPage = 0;
    this.loadData();
  }

  resetFilters(): void {
    this.searchControl.setValue('', { emitEvent: false });
    this.filtri.set(filtriVuoti());
    this.etichette.set({});
    this.currentPage = 0;
    this.loadData();
  }

  onPage(event: PageEvent): void {
    this.currentPage = event.pageIndex;
    this.currentSize = event.pageSize;
    this.loadData();
  }

  onRowClick(row: MovimentoDTO): void {
    this.router.navigate(['/movimenti', row.id]);
  }

  liquidaMovimento(mov: MovimentoDTO, contoBancarioId: number, event?: Event): void {
    event?.stopPropagation();
    if (this.liquidandoId()) return;
    this.liquidandoId.set(mov.id);
    this.movimentiService.liquida(mov.id, contoBancarioId).subscribe({
      next: () => {
        this.liquidandoId.set(null);
        this.snackBar.open('Movimento liquidato ✓', 'OK', { duration: 3000 });
        this.loadData();
      },
      error: () => {
        this.liquidandoId.set(null);
        this.snackBar.open('Errore durante la liquidazione', 'OK', { duration: 3000 });
      },
    });
  }


  deleteMovimento(mov: MovimentoDTO, event: Event): void {
    event.stopPropagation();
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Elimina movimento',
        message: `Eliminare il movimento "${mov.descrizione}"?`,
        confirmLabel: 'Elimina',
        danger: true,
      },
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.movimentiService.delete(mov.id).subscribe({
        next: () => {
          this.snackBar.open('Movimento eliminato', 'OK', { duration: 3000 });
          this.loadData();
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

  truncate(str: string | null | undefined, len = 40): string {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '…' : str;
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

  statoLabel(stato: string): string {
    const map: Record<string, string> = {
      REGISTRATO:   'Registrato',
      DA_LIQUIDARE: 'Da liquidare',
      ANNULLATO:    'Annullato',
    };
    return map[stato] ?? stato;
  }

  sommarioCount(s: { countEntrate: number; countUscite: number }): number {
    return s.countEntrate + s.countUscite;
  }

  /** Etichetta compatta del ritardo/scadenza per un movimento Da Liquidare. */
  ritardoLabel(giorni: number): string {
    if (giorni < 0) return `+${-giorni}gg di ritardo`;
    if (giorni === 0) return 'scade oggi';
    return `tra ${giorni}gg`;
  }

  /** Spiegazione estesa: distingue uscita (pago io) da entrata (mi pagano). */
  ritardoTooltip(row: { giorniAllaScadenza: number | null; tipo: string }): string {
    const g = row.giorniAllaScadenza ?? 0;
    if (g < 0) {
      return row.tipo === 'USCITA'
        ? `Sei in ritardo di ${-g} giorni sul pagamento`
        : `Sei in attesa del pagamento da ${-g} giorni`;
    }
    if (g === 0) return 'Scade oggi';
    return `Scade tra ${g} giorni`;
  }

  fonteColor(fonte: string | null): string {
    const map: Record<string, string> = {
      MANUALE:    '#6B7280',
      IMPORT_CSV: '#3182CE',
      STRIPE:     '#6772E5',
      SATISPAY:   '#FF466C',
      SHOPIFY:    '#95BF47',
      BILLY:      '#DD6B20',
      APERTURA:   '#B5894B',
    };
    return fonte ? (map[fonte] ?? '#6B7280') : '#6B7280';
  }

  buNome(buId: number): string {
    return this.buMap().get(buId)?.nome ?? `BU#${buId}`;
  }

  buColore(buId: number): string {
    return this.buMap().get(buId)?.colore ?? '#6B7280';
  }

}
