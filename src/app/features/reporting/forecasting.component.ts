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
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ReportingService } from '../../core/services/reporting.service';
import { DataRefreshService } from '../../core/services/data-refresh.service';
import {
  ForecastingDettaglioDTO,
  ForecastingHorizon,
  ForecastingRispostaDTO,
  ForecastingTimelineDTO,
} from '../../core/models/reporting.models';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader/skeleton-loader.component';
import { EuroPipe } from '../../shared/pipes/euro.pipe';

const HORIZONS: { value: ForecastingHorizon; label: string }[] = [
  { value: '30',        label: '30 gg' },
  { value: '60',        label: '60 gg' },
  { value: '90',        label: '90 gg' },
  { value: '180',       label: '180 gg' },
  { value: 'FINE_ANNO', label: 'Fine Anno' },
];

const CATEGORIA_LABEL: Record<string, string> = {
  MOVIMENTO:                 'Movimento',
  EVENTO:                    'Evento',
  RATA_RICORRENTE:           'Spesa Ricorrente',
  RATA_RICORRENTE_CAPITALE:  'Rata (capitale)',
  RATA_RICORRENTE_INTERESSI: 'Rata (interessi)',
  STIPENDIO:                 'Stipendio',
  AMMORTAMENTO:              'Ammortamento',
};

const CATEGORIA_COLOR: Record<string, string> = {
  MOVIMENTO:                 '#2C6E8F',
  EVENTO:                    '#E65100',
  RATA_RICORRENTE:           '#6A1B9A',
  RATA_RICORRENTE_CAPITALE:  '#6A1B9A',
  RATA_RICORRENTE_INTERESSI: '#6A1B9A',
  STIPENDIO:                 '#2E7D32',
  AMMORTAMENTO:              '#8D6E63',
};

@Component({
  selector: 'app-forecasting',
  standalone: true,
  imports: [
    BaseChartDirective,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatTableModule,
    MatTooltipModule,
    SkeletonLoaderComponent,
    EuroPipe,
  ],
  templateUrl: './forecasting.component.html',
  styleUrls: ['./forecasting.component.scss'],
})
export class ForecastingComponent implements OnInit {
  private readonly reportingSvc = inject(ReportingService);
  private readonly destroyRef   = inject(DestroyRef);
  private readonly dataRefresh  = inject(DataRefreshService);

  readonly horizons    = HORIZONS;
  readonly horizon     = signal<ForecastingHorizon>('90');
  readonly data        = signal<ForecastingRispostaDTO | null>(null);
  readonly loading     = signal(false);
  readonly error       = signal<string | null>(null);

  // Filtro dettaglio
  readonly categoriaFiltro = signal<string>('TUTTE');

  // Toggle layer STIMATO (ricavi cash): ON di default. Quando OFF mostra solo il certo.
  readonly includiStime = signal(true);

  // Colonne tabelle
  readonly dettaglioColumns  = ['data', 'categoria', 'descrizione', 'importoEntrata', 'importoUscita', 'affidabilita'];
  readonly timelineColumns   = ['bucket', 'entratePreviste', 'uscitePreviste', 'ebitdaPeriodo', 'saldoLiquiditaFine'];

  // Totale ricavi cash stimati nel periodo (somma delle voci STIMATO del dettaglio).
  readonly stimaTotale = computed(() =>
    (this.data()?.economico.dettaglio ?? [])
      .filter(d => d.affidabilita === 'STIMATO')
      .reduce((s, d) => s + d.importoEntrata, 0));

  // Dettaglio filtrato per categoria; le voci STIMATE sono escluse se il toggle è OFF.
  readonly dettaglioFiltrato = computed(() => {
    const d = this.data();
    if (!d) return [];
    let items = d.economico.dettaglio;
    if (!this.includiStime()) items = items.filter(i => i.affidabilita !== 'STIMATO');
    const f = this.categoriaFiltro();
    // startsWith: il chip RATA_RICORRENTE copre anche le righe split _CAPITALE/_INTERESSI
    return f === 'TUTTE' ? items : items.filter(i => i.categoria.startsWith(f));
  });

  // ── Grafico timeline (saldo liquidità proiettato) ─────────────────────────

  readonly timelineChartData = computed<ChartData<'line'>>(() => {
    const d = this.data();
    if (!d) return { labels: [], datasets: [] };
    const tl = d.finanziario.timeline;

    const datasets: ChartData<'line'>['datasets'] = [
      {
        label: 'Saldo Liquidità (certo)',
        data: tl.map(t => t.saldoLiquiditaFine),
        borderColor: '#2C6E8F',
        backgroundColor: 'rgba(21,101,192,0.10)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        yAxisID: 'y',
      },
      {
        label: 'EBITDA Periodo',
        data: tl.map(t => t.ebitdaPeriodo),
        borderColor: '#2E7D32',
        backgroundColor: 'transparent',
        borderDash: [5, 3],
        fill: false,
        tension: 0.3,
        pointRadius: 3,
        yAxisID: 'y2',
      },
    ];

    // Linea "combinato" = saldo certo + ricavi cash stimati cumulati. Sopra il certo, mai sotto.
    if (this.includiStime() && tl.some(t => t.entrateStimate > 0)) {
      let cum = 0;
      const combinato = tl.map(t => { cum += t.entrateStimate ?? 0; return t.saldoLiquiditaFine + cum; });
      datasets.push({
        label: 'Saldo combinato (con stime)',
        data: combinato,
        borderColor: '#E65100',
        backgroundColor: 'transparent',
        borderDash: [2, 2],
        fill: false,
        tension: 0.3,
        pointRadius: 3,
        yAxisID: 'y',
      });
    }
    return { labels: tl.map(t => t.bucket), datasets };
  });

  readonly timelineChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: {
          label: ctx => {
            const v = ctx.parsed.y ?? 0;
            return ` ${ctx.dataset.label}: ${new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v)}`;
          },
        },
      },
    },
    scales: {
      y: {
        position: 'left',
        ticks: { callback: v => `€ ${(Number(v) / 1000).toFixed(0)}k` },
      },
      y2: {
        position: 'right',
        grid: { drawOnChartArea: false },
        ticks: { callback: v => `€ ${(Number(v) / 1000).toFixed(0)}k` },
      },
    },
  };

  ngOnInit(): void {
    this.load();
    // Dopo una mutation (movimento creato/aggiornato, pagamento evento, rata
    // ricorrente) ri-fetcha automaticamente la previsione: senza questo,
    // un movimento con data_liquidita futura veniva nascosto fino al prossimo
    // cambio di orizzonte o F5.
    this.dataRefresh.dashboardRefresh$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load());
  }

  onHorizonChange(h: ForecastingHorizon): void {
    this.horizon.set(h);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.reportingSvc
      .getForecasting(this.horizon())
      .pipe(
        catchError(() => {
          this.error.set('Errore nel caricamento della previsione. Riprova.');
          this.loading.set(false);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(res => {
        if (res) this.data.set(res);
        this.loading.set(false);
      });
  }

  // ── Helpers template ──────────────────────────────────────────────────────

  formatDate(str: string): string {
    if (!str) return '—';
    const p = str.slice(0, 10).split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : str.slice(0, 10);
  }

  categoriaLabel(c: string): string { return CATEGORIA_LABEL[c] ?? c; }
  categoriaColor(c: string): string { return CATEGORIA_COLOR[c] ?? '#757575'; }

  vistaLabel(v: string): string {
    return v === 'ENTRAMBE' ? 'Ec + Fin' : v === 'ECONOMICA' ? 'Economica' : 'Finanziaria';
  }

  vistaColor(v: string): string {
    return v === 'ENTRAMBE' ? '#37474F' : v === 'ECONOMICA' ? '#2C6E8F' : '#BF360C';
  }

  affidabilitaLabel(a: string): string { return a === 'STIMATO' ? 'Stima' : 'Certo'; }
  affidabilitaColor(a: string): string { return a === 'STIMATO' ? '#E65100' : '#2E7D32'; }

  ebitdaClass(v: number): string { return v >= 0 ? 'text-success' : 'text-danger'; }
  saldoClass(v: number): string  { return v >= 0 ? 'text-success' : 'text-danger'; }

  timelineBucketLabel(t: ForecastingTimelineDTO): string {
    const b = t.bucket;
    if (b.includes('-W')) {
      const [year, week] = b.split('-W');
      return `Sett. ${week}/${year}`;
    }
    const months = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
    const [y, m] = b.split('-');
    return `${months[parseInt(m, 10) - 1]} ${y}`;
  }

  get asIs() { return this.data()?.asIs; }
  get economico() { return this.data()?.economico; }
  get finanziario() { return this.data()?.finanziario; }
  get timeline(): ForecastingTimelineDTO[] { return this.data()?.finanziario.timeline ?? []; }
  get dettaglio(): ForecastingDettaglioDTO[] { return this.data()?.economico.dettaglio ?? []; }
  get hasData(): boolean { return this.data() !== null; }
}
