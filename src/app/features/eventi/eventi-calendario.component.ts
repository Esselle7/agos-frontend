import {
  Component,
  Input,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Subject, takeUntil } from 'rxjs';
import { SlicePipe } from '@angular/common';
import { EventiService } from '../../core/services/eventi.service';
import { AuthService } from '../../core/auth/auth.service';
import { EventoCalendarioDTO, StatoEvento } from '../../core/models/eventi.models';

export interface CalDay {
  date: Date;
  dayNum: number;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  events: EventoCalendarioDTO[];
}

const MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];
const DOW = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

@Component({
  selector: 'app-eventi-calendario',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    SlicePipe,
  ],
  templateUrl: './eventi-calendario.component.html',
  styleUrls: ['./eventi-calendario.component.scss'],
})
export class EventiCalendarioComponent implements OnInit, OnChanges, OnDestroy {
  @Input() refresh = 0;

  private readonly eventiService = inject(EventiService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  readonly dowLabels = DOW;
  readonly mesiLabels = MESI;

  viewYear = signal(new Date().getFullYear());
  viewMonth = signal(new Date().getMonth()); // 0-based
  loading = signal(false);

  private eventiMap = signal<Map<string, EventoCalendarioDTO[]>>(new Map());

  readonly titleMese = computed(
    () => `${MESI[this.viewMonth()]} ${this.viewYear()}`
  );

  readonly grid = computed<CalDay[][]>(() => {
    return this.buildGrid(this.viewYear(), this.viewMonth(), this.eventiMap());
  });

  ngOnInit(): void {
    this.loadCalendario();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['refresh'] && !changes['refresh'].firstChange) {
      this.loadCalendario();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  prevMese(): void {
    const m = this.viewMonth();
    if (m === 0) {
      this.viewMonth.set(11);
      this.viewYear.update(y => y - 1);
    } else {
      this.viewMonth.update(m => m - 1);
    }
    this.loadCalendario();
  }

  nextMese(): void {
    const m = this.viewMonth();
    if (m === 11) {
      this.viewMonth.set(0);
      this.viewYear.update(y => y + 1);
    } else {
      this.viewMonth.update(m => m + 1);
    }
    this.loadCalendario();
  }

  oggi(): void {
    const now = new Date();
    this.viewYear.set(now.getFullYear());
    this.viewMonth.set(now.getMonth());
    this.loadCalendario();
  }

  loadCalendario(): void {
    const year = this.viewYear();
    const month = this.viewMonth();
    const from = this.toIso(new Date(year, month, 1));
    const to = this.toIso(new Date(year, month + 1, 0));

    this.loading.set(true);
    this.eventiService.getCalendario(from, to).subscribe({
      next: items => {
        const map = new Map<string, EventoCalendarioDTO[]>();
        for (const ev of items) {
          const key = ev.dataEvento;
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(ev);
        }
        this.eventiMap.set(map);
        this.loading.set(false);
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Errore nel caricamento del calendario', 'OK', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  onClickEvento(ev: EventoCalendarioDTO, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/eventi', ev.id]);
  }

  onClickGiornoVuoto(day: CalDay): void {
    if (!day.inMonth || !this.authService.isAdmin()) return;
    if (day.isPast && !day.isToday) return; // no eventi nel passato
    import('./evento-form-dialog.component').then(m => {
      this.dialog.open(m.EventoFormDialogComponent, {
        width: '700px',
        maxHeight: '90vh',
        data: { dataPrecompilata: this.toIso(day.date) },
      }).afterClosed().subscribe(created => {
        if (created) this.loadCalendario();
      });
    });
  }

  tooltipText(ev: EventoCalendarioDTO): string {
    const residuo = ev.importoResiduo != null && ev.importoResiduo > 0
      ? ` · Residuo: €${ev.importoResiduo.toFixed(2)}`
      : '';
    return `${ev.nome} · ${ev.stato}${residuo}`;
  }

  private buildGrid(year: number, month: number, eventiMap: Map<string, EventoCalendarioDTO[]>): CalDay[][] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let startDow = firstDay.getDay(); // 0=Sun
    startDow = startDow === 0 ? 6 : startDow - 1; // Mon=0, Sun=6

    const cells: CalDay[] = [];

    // Padding before
    for (let i = 0; i < startDow; i++) {
      const d = new Date(year, month, -(startDow - i - 1));
      cells.push({ date: d, dayNum: d.getDate(), inMonth: false, isToday: false, isPast: true, events: [] });
    }

    // Days of month
    for (let dn = 1; dn <= lastDay.getDate(); dn++) {
      const date = new Date(year, month, dn);
      const key = this.toIso(date);
      cells.push({
        date,
        dayNum: dn,
        inMonth: true,
        isToday: date.getTime() === today.getTime(),
        isPast: date < today,
        events: eventiMap.get(key) ?? [],
      });
    }

    // Padding after (fill to multiple of 7)
    let extra = 1;
    while (cells.length % 7 !== 0) {
      const d = new Date(year, month + 1, extra++);
      cells.push({ date: d, dayNum: d.getDate(), inMonth: false, isToday: false, isPast: false, events: [] });
    }

    // Split into rows of 7
    const rows: CalDay[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7));
    }
    return rows;
  }

  private toIso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
