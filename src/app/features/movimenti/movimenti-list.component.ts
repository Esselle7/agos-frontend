import {
  Component,
  OnInit,
  OnDestroy,
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
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { DateMaskDirective } from '../../shared/directives/date-mask.directive';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
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
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDatepickerModule,
    MatNativeDateModule,
    DateMaskDirective,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    EuroPipe,
    BadgeComponent,
    EmptyStateComponent,
    SkeletonLoaderComponent,
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

  // Filter controls
  readonly searchControl = new FormControl<string>('', { nonNullable: true });
  readonly tipoControl = new FormControl<string>('', { nonNullable: true });
  readonly buControl = new FormControl<number | null>(null);
  readonly statoControl = new FormControl<string>('', { nonNullable: true });
  readonly fromControl = new FormControl<Date | null>(null);
  readonly toControl = new FormControl<Date | null>(null);

  private currentPage = 0;
  private currentSize = 20;

  ngOnInit(): void {
    this.contiService.getAll().pipe(takeUntil(this.destroy$)).subscribe(list => {
      this.conti.set(list);
    });

    this.buService.getAll().subscribe(units => {
      this.buMap.set(new Map(units.map(u => [u.id, u])));
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
    this.loading.set(true);
    const baseFilter = this.buildFilter();
    const listFilter: MovimentiFilter = { ...baseFilter, page: this.currentPage, size: this.currentSize, sort: 'dataMovimento,desc' };

    this.movimentiService.getList(listFilter).subscribe({
      next: res => {
        this.result.set(res);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Errore nel caricamento dei movimenti', 'OK', { duration: 3000 });
      },
    });

    this.movimentiService.getSommario(baseFilter).subscribe({
      next: s => { this.sommario.set(s); },
      error: () => {},
    });
  }

  private buildFilter(): MovimentiFilter {
    const filter: MovimentiFilter = {};
    const search = this.searchControl.value.trim();
    if (search) filter.search = search;
    const tipo = this.tipoControl.value;
    if (tipo === 'ENTRATA' || tipo === 'USCITA') filter.tipo = tipo;
    const buId = this.buControl.value;
    if (buId != null) filter.buId = buId;
    const stato = this.statoControl.value;
    if (stato) filter.stato = stato;
    const from = this.fromControl.value;
    if (from) filter.from = this.toIso(from);
    const to = this.toControl.value;
    if (to) filter.to = this.toIso(to);
    return filter;
  }

  resetFilters(): void {
    this.searchControl.setValue('');
    this.tipoControl.setValue('');
    this.buControl.setValue(null);
    this.statoControl.setValue('');
    this.fromControl.setValue(null);
    this.toControl.setValue(null);
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

  private toIso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
