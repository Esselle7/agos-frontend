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

const MESI_BREVI  = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
const MESI_ESTESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                     'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

/**
 * Etichetta del periodo mostrata in tabella E sull'asse X del grafico (P1 della spec
 * docs/specs/previsionale-correzioni.md): le settimane ISO ("2026-W38") non dicono in che
 * mese siamo.
 *
 * Le DATE vengono da `bucketStart`/`bucketEnd`, che il backend gia' tronca all'orizzonte
 * (ForecastingService.buildTimeline): il primo e l'ultimo bucket possono durare meno di
 * una settimana, e l'etichetta lo dice. `bucket` resta l'identificatore tecnico e serve
 * qui solo a distinguere la granularita' (settimanale vs mensile), che dalle sole date
 * non e' deducibile — un bucket mensile troncato puo' essere piu' corto di una settimana.
 *
 *   settimanale, stesso mese      ->  7–13 set
 *   settimanale, a cavallo        ->  28 set – 4 ott
 *   settimanale, un giorno solo   ->  5 dic
 *   mensile                       ->  Settembre 2026
 */
export function bucketLabel(t: { bucket: string; bucketStart?: string; bucketEnd?: string }): string {
  const s = (t.bucketStart ?? '').slice(0, 10).split('-').map(Number);
  const e = (t.bucketEnd   ?? '').slice(0, 10).split('-').map(Number);
  // Fail fast leggibile: senza le date non si inventa un'etichetta, si mostra la chiave grezza.
  if (s.length !== 3 || s.some(isNaN)) return t.bucket;

  const [ys, ms, ds] = s;
  if (!t.bucket.includes('-W')) return `${MESI_ESTESI[ms - 1]} ${ys}`;

  if (e.length !== 3 || e.some(isNaN)) return `${ds} ${MESI_BREVI[ms - 1]}`;
  const [ye, me, de] = e;
  if (ys === ye && ms === me) {
    return ds === de ? `${ds} ${MESI_BREVI[ms - 1]}` : `${ds}–${de} ${MESI_BREVI[ms - 1]}`;
  }
  return `${ds} ${MESI_BREVI[ms - 1]} – ${de} ${MESI_BREVI[me - 1]}`;
}

/** Una riga del riepilogo economico: o un totale, o una voce sottratta dal totale che la segue. */
export interface RigaCascata {
  label: string;
  valore: number;
  /** true = riga di sottrazione; il totale IMMEDIATAMENTE successivo la sottrae davvero. */
  sottrazione: boolean;
}

/**
 * Cascata EBITDA → EBIT → EBT del pannello economico (P3 della spec
 * docs/specs/previsionale-correzioni.md).
 *
 * Il pannello mostrava «EBITDA 25.760,00 → − Oneri finanziari 2.201,82 → EBIT 25.760,00»: la riga
 * di sottrazione era a video ma il totale la ignorava (il backend calcola ebit = ebitda −
 * ammortamenti e gli oneri non li tocca). Aritmetica falsa sullo schermo.
 *
 * Costruire le righe qui invece che a mano nel template rende il requisito STRUTTURALE: la catena
 * si verifica una volta sull'array e il template non può disallinearsi, perché rende esattamente
 * questo.
 *
 * Un livello si mostra solo se qualcosa lo separa da quello sopra: senza ammortamenti EBIT
 * varrebbe l'EBITDA e ripeterlo sarebbe rumore, non informazione. Ferma a EBT: niente imposte,
 * niente utile netto — non esiste una previsione fiscale da mostrare.
 */
export function cascataEconomica(e: {
  ebitdaPrevisto: number;
  ammortamentiPrevisti: number;
  oneriFinanziariPrevisti: number;
  ebitPrevisto: number;
  ebtPrevisto: number;
}): RigaCascata[] {
  const righe: RigaCascata[] = [{ label: 'EBITDA previsto (certo)', valore: e.ebitdaPrevisto, sottrazione: false }];
  if (e.ammortamentiPrevisti > 0) {
    righe.push({ label: '− Ammortamenti (cespiti)', valore: e.ammortamentiPrevisti, sottrazione: true });
    righe.push({ label: 'EBIT previsto', valore: e.ebitPrevisto, sottrazione: false });
  }
  if (e.oneriFinanziariPrevisti > 0) {
    righe.push({ label: '− Oneri finanziari previsti', valore: e.oneriFinanziariPrevisti, sottrazione: true });
    righe.push({ label: 'EBT previsto', valore: e.ebtPrevisto, sottrazione: false });
  }
  return righe;
}

/** Una riga del riepilogo finanziario. `fuori` = informazione accanto ai totali, mai dentro. */
export interface RigaFin {
  label: string;
  valore: number;
  kind: 'base' | 'entrata' | 'uscita' | 'stima' | 'totale' | 'fuori';
}

/**
 * Righe del pannello «Finanziaria». Costruite qui e non a mano nel template per lo stesso motivo
 * di cascataEconomica(): il requisito diventa strutturale invece che una convenzione da rispettare.
 *
 * P4 (docs/specs/previsionale-correzioni.md): il credito da eventi già celebrati è un blocco a sé,
 * `kind: 'fuori'`. Non esiste — e non deve esistere — nessuna riga che lo sommi a un saldo: quel
 * credito non ha una data attesa di incasso, e parte di esso è con ogni probabilità denaro già in
 * banca mai importato (misura del 06/09/2026 nella baseline). Un «saldo potenziale» che lo
 * addizionasse sarebbe due volte sbagliato.
 */
export function riepilogoFinanziario(
  f: { saldoPartenza: number; incassiPrevisti: number; uscitePreviste: number; saldoFinale: number },
  creditoEventiCelebrati: number,
  stimaTotale: number,
  stimaCosti = 0,
): RigaFin[] {
  const righe: RigaFin[] = [
    { label: 'Saldo oggi', valore: f.saldoPartenza, kind: 'base' },
    { label: '+ Incassi attesi (certo)', valore: f.incassiPrevisti, kind: 'entrata' },
  ];
  // «+ Stima», non «+ di cui stimato»: la stima non è dentro il certo — il backend tiene le righe
  // STIMATO fuori dai subtotali — quindi «di cui» affermerebbe un contenimento che non esiste.
  if (stimaTotale > 0) {
    righe.push({ label: '+ Stima ricavi cash', valore: stimaTotale, kind: 'stima' });
  }
  righe.push({ label: '− Uscite attese', valore: f.uscitePreviste, kind: 'uscita' });
  if (stimaCosti > 0) {
    righe.push({ label: '− Stima costi ricorrenti', valore: stimaCosti, kind: 'stima' });
  }
  righe.push({ label: 'Saldo finale previsto (certo)', valore: f.saldoFinale, kind: 'totale' });
  // P7: il combinato somma i ricavi stimati E sottrae i costi stimati. Sommare solo i primi
  // darebbe un saldo «con le stime» sistematicamente ottimistico — è il difetto che P7 chiude.
  if (stimaTotale > 0 || stimaCosti > 0) {
    righe.push({ label: 'Saldo finale + stime',
                 valore: f.saldoFinale + stimaTotale - stimaCosti, kind: 'totale' });
  }
  if (creditoEventiCelebrati > 0) {
    righe.push({ label: 'Credito da eventi già celebrati', valore: creditoEventiCelebrati, kind: 'fuori' });
  }
  return righe;
}

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

  // Righe del pannello finanziario (P4): il credito evento è 'fuori', mai dentro un saldo.
  readonly riepilogoFin = computed<RigaFin[]>(() => {
    const d = this.data();
    if (!d) return [];
    return riepilogoFinanziario(
      d.finanziario,
      d.asIs.creditoEventiCelebrati,
      this.includiStime() ? this.stimaTotale() : 0,
      this.includiStime() ? this.stimaCostiTotale() : 0);
  });

  // Righe del riepilogo economico da EBITDA a EBT (P3): la catena la costruisce cascataEconomica().
  readonly cascata = computed<RigaCascata[]>(() => {
    const e = this.data()?.economico;
    return e ? cascataEconomica(e) : [];
  });

  // Totale ricavi cash stimati nel periodo (somma delle voci STIMATO del dettaglio).
  readonly stimaTotale = computed(() =>
    (this.data()?.economico.dettaglio ?? [])
      .filter(d => d.affidabilita === 'STIMATO')
      .reduce((s, d) => s + d.importoEntrata, 0));

  // P7: totale costi ricorrenti stimati, simmetrico a stimaTotale.
  readonly stimaCostiTotale = computed(() =>
    (this.data()?.economico.dettaglio ?? [])
      .filter(d => d.affidabilita === 'STIMATO')
      .reduce((s, d) => s + d.importoUscita, 0));

  // Il toggle «Includi stime» ha senso solo se c'è qualcosa da includere: finché il gate di
  // sufficienza dati non passa, non è una preferenza da esprimere ma un bottone che non fa niente.
  readonly stimeDisponibili = computed(() =>
    this.stimaTotale() > 0 || this.stimaCostiTotale() > 0);

  // Perché la stima non c'è. Il silenzio farebbe leggere «costi previsti 0,00» come «non spendiamo».
  readonly notaStime = computed(() =>
    this.stimeDisponibili() ? null : (this.data()?.economico.notaStimaCosti ?? null));

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

    // Linea "combinato" = saldo certo + ricavi stimati − costi stimati, cumulati (P7).
    // Prima sommava i soli ricavi: la linea stava sempre SOPRA il certo per costruzione, cioè
    // era ottimistica per come era scritta, non per quello che i dati dicevano.
    if (this.includiStime() && tl.some(t => t.entrateStimate > 0 || t.usciteStimate > 0)) {
      let cum = 0;
      const combinato = tl.map(t => {
        cum += (t.entrateStimate ?? 0) - (t.usciteStimate ?? 0);
        return t.saldoLiquiditaFine + cum;
      });
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
    return { labels: tl.map(t => bucketLabel(t)), datasets };
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

  readonly timelineBucketLabel = bucketLabel;

  get asIs() { return this.data()?.asIs; }
  get economico() { return this.data()?.economico; }
  get finanziario() { return this.data()?.finanziario; }
  get timeline(): ForecastingTimelineDTO[] { return this.data()?.finanziario.timeline ?? []; }
  get dettaglio(): ForecastingDettaglioDTO[] { return this.data()?.economico.dettaglio ?? []; }
  get hasData(): boolean { return this.data() !== null; }
}
