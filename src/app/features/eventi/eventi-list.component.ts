import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  signal,
  inject,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatChipsModule } from '@angular/material/chips';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Subject, debounceTime, distinctUntilChanged, takeUntil, forkJoin } from 'rxjs';
import { EventiService, EventiFilter } from '../../core/services/eventi.service';
import { BuService } from '../../core/services/bu.service';
import { AuthService } from '../../core/auth/auth.service';
import { EventoDTO, StatoEvento } from '../../core/models/eventi.models';
import { BusinessUnitDTO } from '../../core/models/anagrafica.models';
import { PagedResponse } from '../../core/models/shared.models';
import { EuroPipe } from '../../shared/pipes/euro.pipe';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader/skeleton-loader.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

const STATO_COLORS: Record<StatoEvento, string> = {
  PREVENTIVATO: '#FFA500',
  CONFERMATO:   '#2196F3',
  SALDATO:      '#4CAF50',
  ANNULLATO:    '#9E9E9E',
};

const STATI: { value: StatoEvento | ''; label: string }[] = [
  { value: '',             label: 'Tutti' },
  { value: 'PREVENTIVATO', label: 'Preventivato' },
  { value: 'CONFERMATO',   label: 'Confermato' },
  { value: 'SALDATO',      label: 'Saldato' },
  { value: 'ANNULLATO',    label: 'Annullato' },
];

@Component({
  selector: 'app-eventi-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatChipsModule,
    MatDatepickerModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatTooltipModule,
    EuroPipe,
    EmptyStateComponent,
    SkeletonLoaderComponent,
  ],
  templateUrl: './eventi-list.component.html',
  styleUrls: ['./eventi-list.component.scss'],
})
export class EventiListComponent implements OnInit, OnChanges, OnDestroy {
  @Input() refresh = 0;

  /**
   * Quale metà del modulo mostra questa istanza. La partizione è decisa dal server
   * (`vista` sull'endpoint): la pagina è di 20 righe, riordinare o filtrare qui darebbe
   * un ordine e un conteggio falsi.
   */
  @Input() vista: 'LISTA' | 'STORICO' = 'LISTA';

  /** Totale della scheda, per scriverlo nell'etichetta del tab. */
  @Output() totaleCambiato = new EventEmitter<number>();

  /** L'utente ha chiesto i saldati stando nella Lista: si va nella scheda giusta. */
  @Output() vaiAlloStorico = new EventEmitter<void>();

  private readonly eventiService = inject(EventiService);
  private readonly buService = inject(BuService);
  readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  readonly statoColors = STATO_COLORS;

  /**
   * Nello Storico ogni riga è SALDATO: un filtro per stato lì non filtra niente, quindi
   * la barra dei chip sparisce del tutto invece di restare a fare da decorazione.
   */
  get stati() { return this.vista === 'STORICO' ? [] : STATI; }

  result = signal<PagedResponse<EventoDTO> | null>(null);
  loading = signal(false);
  buMap = signal<Map<number, BusinessUnitDTO>>(new Map());

  selectedStato = signal<StatoEvento | ''>('');

  readonly searchControl = new FormControl<string>('', { nonNullable: true });
  readonly fromControl = new FormControl<Date | null>(null);
  readonly toControl = new FormControl<Date | null>(null);
  readonly buControl = new FormControl<number | null>(null);

  currentPage = 0;
  readonly pageSize = 20;

  ngOnInit(): void {
    this.buService.getAll().subscribe(units => {
      this.buMap.set(new Map(units.map(u => [u.id, u])));
      this.cdr.markForCheck();
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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['refresh'] && !changes['refresh'].firstChange) {
      this.loadData();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadData(): void {
    this.loading.set(true);
    this.result.set(null); // reset per mostrare lo skeleton anche su filter/page change
    const filter: EventiFilter = {
      page: this.currentPage,
      size: this.pageSize,
      vista: this.vista,
    };
    const search = this.searchControl.value.trim();
    if (search) filter.search = search;
    const stato = this.selectedStato();
    if (stato) filter.stato = stato;
    const buId = this.buControl.value;
    if (buId != null) filter.buId = buId;
    const from = this.fromControl.value;
    if (from) filter.from = this.toIso(from);
    const to = this.toControl.value;
    if (to) filter.to = this.toIso(to);

    this.eventiService.getList(filter).subscribe({
      next: res => {
        this.result.set(res);
        this.loading.set(false);
        this.totaleCambiato.emit(res.totalElements);
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Errore nel caricamento degli eventi', 'OK', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  selectStato(stato: StatoEvento | ''): void {
    // I saldati non abitano qui: invece di una lista vuota senza spiegazione, si cambia scheda.
    if (this.vista === 'LISTA' && stato === 'SALDATO') {
      this.vaiAlloStorico.emit();
      return;
    }
    this.selectedStato.set(stato);
    this.currentPage = 0;
    this.loadData();
  }

  onPage(event: PageEvent): void {
    this.currentPage = event.pageIndex;
    this.loadData();
  }

  onFilterChange(): void {
    this.currentPage = 0;
    this.loadData();
  }

  resetFilters(): void {
    this.searchControl.setValue('');
    this.fromControl.setValue(null);
    this.toControl.setValue(null);
    this.buControl.setValue(null);
    this.selectedStato.set('');
    this.currentPage = 0;
    this.loadData();
  }

  goToDetail(evento: EventoDTO): void {
    this.router.navigate(['/eventi', evento.id]);
  }

  openModifica(evento: EventoDTO, event: Event): void {
    event.stopPropagation();
    import('./evento-form-dialog.component').then(m => {
      this.dialog
        .open(m.EventoFormDialogComponent, {
          width: '700px',
          maxHeight: '90vh',
          data: { eventoId: evento.id },
        })
        .afterClosed()
        .subscribe(updated => {
          if (updated) this.loadData();
        });
    });
  }

  deleteEvento(evento: EventoDTO, event: Event): void {
    event.stopPropagation();
    this.dialog
      .open(ConfirmDialogComponent, {
        data: {
          title: 'Elimina evento',
          message: `Eliminare l'evento "${evento.nome}"? L'operazione non è reversibile.`,
          confirmLabel: 'Elimina',
          danger: true,
        },
      })
      .afterClosed()
      .subscribe(confirmed => {
        if (!confirmed) return;
        this.eventiService.delete(evento.id).subscribe({
          next: () => {
            this.snackBar.open('Evento eliminato', 'OK', { duration: 3000 });
            this.loadData();
          },
          error: () =>
            this.snackBar.open('Errore durante l\'eliminazione', 'OK', { duration: 3000 }),
        });
      });
  }

  /**
   * Evento già passato e non ancora saldato: è l'unica riga che chiede un'azione, per questo
   * sta in cima alla Lista. Il confronto è su stringhe ISO (`aaaa-mm-gg`), che si ordinano
   * come le date senza costruire un Date e senza portarsi dietro il fuso del browser.
   */
  daChiudere(evento: EventoDTO): boolean {
    return this.vista === 'LISTA'
        && !!evento.dataEvento
        && evento.dataEvento < this.oggiIso
        && evento.stato !== 'SALDATO';
  }

  /** ponytail: calcolato all'apertura della pagina, non a ogni riga. Chi la lascia aperta oltre
   *  la mezzanotte vede il badge di ieri fino al refresh — non vale un timer. */
  private readonly oggiIso = this.toIso(new Date());

  statoColor(stato: StatoEvento): string {
    return STATO_COLORS[stato] ?? '#9E9E9E';
  }

  buNome(buId: number): string {
    return this.buMap().get(buId)?.nome ?? `BU#${buId}`;
  }

  buColore(buId: number): string {
    return this.buMap().get(buId)?.colore ?? '#6B7280';
  }

  formatDate(str: string | null): string {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }

  progressColor(pct: number): string {
    return pct >= 100 ? '#4CAF50' : '#FFA500';
  }

  private toIso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
