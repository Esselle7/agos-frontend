import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartData, ChartOptions } from 'chart.js';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';

import { ReportingService } from '../../core/services/reporting.service';
import { BuService } from '../../core/services/bu.service';
import { ContiService } from '../../core/services/conti.service';
import { DataRefreshService } from '../../core/services/data-refresh.service';
import { PlComparativoDTO } from '../../core/models/reporting.models';
import { BusinessUnitDTO } from '../../core/models/anagrafica.models';
import { DashboardPeriod } from '../../core/models/dashboard.models';
import {
  DateRangePickerComponent,
  PeriodChangeEvent,
} from '../../shared/components/date-range-picker/date-range-picker.component';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader/skeleton-loader.component';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';
import { EuroPipe } from '../../shared/pipes/euro.pipe';

@Component({
  selector: 'app-pl-comparativo',
  standalone: true,
  imports: [
    BaseChartDirective,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    DateRangePickerComponent,
    SkeletonLoaderComponent,
    HelpNoteComponent,
    EuroPipe,
  ],
  templateUrl: './pl-comparativo.component.html',
  styleUrls: ['./pl-comparativo.component.scss'],
})
export class PlComparativoComponent implements OnInit {
  private readonly reportingSvc = inject(ReportingService);
  private readonly buSvc = inject(BuService);
  private readonly contiSvc = inject(ContiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dataRefresh = inject(DataRefreshService);

  /**
   * Fase 6: la banda compare solo se c'e' davvero qualcosa da dichiarare — un P&L tutto
   * classificato non deve portarsi dietro una riga vuota.
   */
  haQualcosaDaDichiarare(d: PlComparativoDTO): boolean {
    const q = d.qualita;
    return q.nonClassificatoRicavi > 0 || q.nonClassificatoCosti > 0 || q.creditiEventiAperti > 0;
  }

  readonly period = signal<{ from: string; to: string }>(this.ytdRange());
  readonly selectedPeriod = signal<DashboardPeriod>('YTD');
  readonly data = signal<PlComparativoDTO | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly businessUnits = signal<BusinessUnitDTO[]>([]);
  readonly tableColumns = ['bu', 'ricavi', 'costi', 'ebitda', 'marginePct', 'ebit', 'utileNetto'];

  /**
   * Data di apertura del gestionale, letta dai conti (`dataSaldoIniziale`) invece di essere cablata:
   * la scrive la pagina "Situazione iniziale" ed è l'unica fonte di verità. Si prende la PIÙ RECENTE
   * fra i conti valorizzati, perché prima di quella data i dati economici non sono completi.
   */
  readonly dataApertura = signal<string | null>(null);
  /** Vero quando il periodo scelto inizia prima dell'apertura: i mesi precedenti sono vuoti per costruzione. */
  readonly periodoPrimaDellApertura = computed(() => {
    const ap = this.dataApertura();
    return !!ap && this.period().from < ap;
  });
  readonly dataAperturaLabel = computed(() => {
    const ap = this.dataApertura();
    return ap ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ap)) : '';
  });

  readonly sortedRows = computed(() => {
    const d = this.data();
    if (!d) return [];
    return [...d.businessUnits].sort((a, b) => b.ebitda - a.ebitda);
  });

  readonly barChartData = computed<ChartData<'bar'>>(() => {
    const rows = this.sortedRows();
    const busMap = new Map(this.businessUnits().map(b => [b.id, b]));
    return {
      labels: rows.map(r => r.bu.nome),
      datasets: [
        {
          label: 'Ricavi',
          data: rows.map(r => r.ricavi),
          backgroundColor: rows.map(r => (busMap.get(r.bu.id)?.colore ?? '#1F5C43') + 'BB'),
          borderColor: rows.map(r => busMap.get(r.bu.id)?.colore ?? '#1F5C43'),
          borderWidth: 1,
        },
        {
          label: 'Costi',
          data: rows.map(r => r.costi),
          backgroundColor: 'rgba(198,40,40,0.45)',
          borderColor: '#C62828',
          borderWidth: 1,
        },
      ],
    };
  });

  readonly margineChartData = computed<ChartData<'bar'>>(() => {
    const rows = this.sortedRows();
    return {
      labels: rows.map(r => r.bu.nome),
      datasets: [{
        label: 'Margine %',
        data: rows.map(r => r.marginePct),
        backgroundColor: rows.map(r =>
          r.marginePct >= 0 ? 'rgba(46,125,50,0.65)' : 'rgba(198,40,40,0.65)'
        ),
        borderColor: rows.map(r => r.marginePct >= 0 ? '#2E7D32' : '#C62828'),
        borderWidth: 1,
      }],
    };
  });

  readonly barChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: {
          label: ctx => {
            const val = ctx.parsed.y ?? 0;
            return ` ${ctx.dataset.label}: ${new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(val)}`;
          },
        },
      },
    },
    scales: {
      y: {
        ticks: {
          callback: v => {
            const n = Number(v);
            return n >= 1000 ? `€ ${(n / 1000).toFixed(0)}k` : `€ ${n}`;
          },
        },
      },
    },
  };

  readonly margineChartOptions: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => ` Margine: ${(ctx.parsed.x ?? 0).toFixed(1)}%`,
        },
      },
    },
    scales: {
      x: { ticks: { callback: v => `${v}%` } },
    },
  };

  ngOnInit(): void {
    this.buSvc.getAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(units => this.businessUnits.set(units));
    this.contiSvc.getAll()
      .pipe(catchError(() => of([])), takeUntilDestroyed(this.destroyRef))
      .subscribe(conti => {
        const date = conti.map(c => c.dataSaldoIniziale).filter((d): d is string => !!d).sort();
        this.dataApertura.set(date.length ? date[date.length - 1] : null);
      });
    this.load();
    // Auto-refresh dopo mutation backend (movimento creato/aggiornato, pagamento
    // evento, rata ricorrente): l'interceptor invalida la cache FE e notifica qui.
    this.dataRefresh.dashboardRefresh$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load());
  }

  onPeriodChange(evt: PeriodChangeEvent): void {
    this.period.set(this.periodToRange(evt));
    this.selectedPeriod.set(evt.period);
    this.load();
  }

  load(): void {
    const { from, to } = this.period();
    this.loading.set(true);
    this.error.set(null);
    this.data.set(null);
    this.reportingSvc.getPlTutteBu(from, to)
      .pipe(
        catchError(err => {
          const code = err?.error?.code ?? '';
          if (code === 'RANGE_TOO_LARGE') this.error.set('Intervallo troppo ampio (massimo 5 anni)');
          else if (code === 'MISSING_RANGE') this.error.set('Seleziona un intervallo di date valido');
          else this.error.set('Errore nel caricamento del P&L comparativo');
          this.loading.set(false);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(res => {
        if (res) {
          this.data.set(res);
          this.loading.set(false);
        }
      });
  }

  getBuColor(buId: number): string {
    return this.businessUnits().find(b => b.id === buId)?.colore ?? '#6B7280';
  }

  private periodToRange(evt: PeriodChangeEvent): { from: string; to: string } {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    switch (evt.period) {
      case 'MTD':
        return {
          from: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
          to: todayStr,
        };
      case 'QTD': {
        const q = Math.floor(today.getMonth() / 3);
        return { from: new Date(today.getFullYear(), q * 3, 1).toISOString().slice(0, 10), to: todayStr };
      }
      case 'YTD':
        return { from: `${today.getFullYear()}-01-01`, to: todayStr };
      default:
        return { from: evt.from!, to: evt.to! };
    }
  }

  private ytdRange(): { from: string; to: string } {
    const today = new Date();
    return { from: `${today.getFullYear()}-01-01`, to: today.toISOString().slice(0, 10) };
  }
}
