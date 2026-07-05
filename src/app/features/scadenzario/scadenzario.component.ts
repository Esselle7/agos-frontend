import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { DashboardService } from '../../core/services/dashboard.service';
import {
  DashboardPeriod,
  ScadenzaDTO,
  ScadenzeImminentiDTO,
  UscitaDaLiquidareDTO,
} from '../../core/models/dashboard.models';
import { EuroPipe } from '../../shared/pipes/euro.pipe';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';

/** Le quattro nature di scadenza tracciate dallo Scadenzario. */
type ScadTipo = 'EVENTO' | 'RICORRENTE' | 'USCITA' | 'ENTRATA';

/** Riga unificata usata da liste e calendario (normalizza le 4 sorgenti). */
interface Voce {
  tipo: ScadTipo;
  id: string;
  descrizione: string;
  importo: number;
  data: string;          // ISO yyyy-mm-dd della scadenza
  gg: number;            // giorni da oggi alla scadenza (negativo = scaduto)
  scaduto: boolean;
  saldato: boolean;      // eventi/rate già pagati nel periodo (mostrati spenti)
}

interface CalDay {
  data: string;
  giorno: number;
  nelMese: boolean;
  oggi: boolean;
  voci: Voce[];
}

const MS_DAY = 86_400_000;

@Component({
  selector: 'app-scadenzario',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    MatIconModule, MatButtonModule, MatButtonToggleModule, MatTooltipModule,
    MatProgressSpinnerModule, EuroPipe, HelpNoteComponent,
  ],
  templateUrl: './scadenzario.component.html',
  styleUrl: './scadenzario.component.scss',
})
export class ScadenzarioComponent implements OnInit {
  private readonly dashboardSvc = inject(DashboardService);
  private readonly router = inject(Router);

  // ── Stato ─────────────────────────────────────────────────────────────────
  readonly periodo = signal<DashboardPeriod>('YTD');
  readonly loading = signal(true);
  readonly errore = signal(false);
  readonly vista = signal<'liste' | 'calendario'>('liste');

  private readonly dati = signal<ScadenzeImminentiDTO>(
    { eventi: [], rateRicorrenti: [], usciteDaLiquidare: [], entrateDaRicevere: [] }
  );

  /** Filtri attivi del calendario (per natura). */
  readonly filtri = signal<Record<ScadTipo, boolean>>(
    { EVENTO: true, RICORRENTE: true, USCITA: true, ENTRATA: true }
  );
  readonly meseCal = signal<Date>(this.primoDelMese(new Date()));

  private readonly oggiIso = this.toIso(new Date());

  // ── Configurazione visiva per natura (icona, etichetta, classe colore) ──────
  readonly meta: Record<ScadTipo, { label: string; icon: string; cls: string }> = {
    EVENTO:     { label: 'Eventi',              icon: 'celebration',   cls: 'is-evento' },
    RICORRENTE: { label: 'Spese ricorrenti',    icon: 'event_repeat',  cls: 'is-ricorrente' },
    USCITA:     { label: 'Fatture da pagare',   icon: 'trending_down', cls: 'is-uscita' },
    ENTRATA:    { label: 'Incassi da ricevere', icon: 'trending_up',   cls: 'is-entrata' },
  };

  // ── Voci normalizzate per natura ────────────────────────────────────────────
  readonly eventi = computed(() => this.daScadenze(this.dati().eventi, 'EVENTO'));
  readonly ricorrenti = computed(() => this.daScadenze(this.dati().rateRicorrenti, 'RICORRENTE'));
  readonly uscite = computed(() =>
    this.daMovimenti(this.dati().usciteDaLiquidare, 'USCITA').filter(v => this.entroOrizzonte(v)));
  readonly entrate = computed(() =>
    this.daMovimenti(this.dati().entrateDaRicevere ?? [], 'ENTRATA').filter(v => this.entroOrizzonte(v)));

  /** Tutte le voci non saldate, ordinate per scadenza (scaduti prima). */
  readonly tutte = computed<Voce[]>(() =>
    [...this.eventi(), ...this.ricorrenti(), ...this.uscite(), ...this.entrate()]
      .sort((a, b) => a.data.localeCompare(b.data)));

  /** Voci già scadute e non chiuse: alimentano banner e KPI. */
  readonly scaduti = computed<Voce[]>(() =>
    this.tutte().filter(v => v.scaduto && !v.saldato).sort((a, b) => a.gg - b.gg));

  // ── KPI ──────────────────────────────────────────────────────────────────
  readonly totaleDaPagare = computed(() =>
    this.uscite().filter(v => !v.saldato).reduce((s, v) => s + v.importo, 0));
  readonly totaleDaRicevere = computed(() =>
    this.entrate().filter(v => !v.saldato).reduce((s, v) => s + v.importo, 0));
  readonly nEventi = computed(() => this.eventi().filter(v => !v.saldato).length);
  readonly nRicorrenti = computed(() => this.ricorrenti().filter(v => !v.saldato).length);

  /** Spaccato degli scaduti per natura, per il testo del banner. */
  readonly scadutiPerTipo = computed(() => {
    const r: Record<ScadTipo, number> = { EVENTO: 0, RICORRENTE: 0, USCITA: 0, ENTRATA: 0 };
    for (const v of this.scaduti()) r[v.tipo]++;
    return (Object.keys(r) as ScadTipo[]).filter(t => r[t] > 0).map(t => ({ tipo: t, n: r[t] }));
  });

  // ── Calendario ─────────────────────────────────────────────────────────────
  readonly etichettaMese = computed(() =>
    this.meseCal().toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }));

  readonly settimane = computed<CalDay[][]>(() => {
    const base = this.meseCal();
    const anno = base.getFullYear();
    const mese = base.getMonth();
    const attivi = this.tutte().filter(v => this.filtri()[v.tipo]);
    const perGiorno = new Map<string, Voce[]>();
    for (const v of attivi) (perGiorno.get(v.data) ?? perGiorno.set(v.data, []).get(v.data)!).push(v);

    const primo = new Date(anno, mese, 1);
    const startDow = (primo.getDay() + 6) % 7; // lunedì = 0
    const griglia: CalDay[][] = [];
    let cursore = new Date(anno, mese, 1 - startDow);
    for (let w = 0; w < 6; w++) {
      const riga: CalDay[] = [];
      for (let d = 0; d < 7; d++) {
        const iso = this.toIso(cursore);
        riga.push({
          data: iso,
          giorno: cursore.getDate(),
          nelMese: cursore.getMonth() === mese,
          oggi: iso === this.oggiIso,
          voci: (perGiorno.get(iso) ?? []).slice().sort((a, b) => this.ordineTipo(a.tipo) - this.ordineTipo(b.tipo)),
        });
        cursore = new Date(cursore.getTime() + MS_DAY);
      }
      griglia.push(riga);
    }
    return griglia;
  });

  readonly tipiCal: ScadTipo[] = ['EVENTO', 'RICORRENTE', 'USCITA', 'ENTRATA'];

  readonly periodi: { val: DashboardPeriod; label: string }[] = [
    { val: 'MTD', label: 'Questo mese' },
    { val: 'QTD', label: 'Trimestre' },
    { val: 'YTD', label: "Anno" },
  ];

  /** Le quattro colonne-lista (ordine: prima i soldi, poi agenda), scaduti in cima. */
  readonly colonne = computed(() => {
    const def: { tipo: ScadTipo; voci: Voce[] }[] = [
      { tipo: 'USCITA', voci: this.uscite() },
      { tipo: 'ENTRATA', voci: this.entrate() },
      { tipo: 'RICORRENTE', voci: this.ricorrenti() },
      { tipo: 'EVENTO', voci: this.eventi() },
    ];
    return def.map(c => ({
      tipo: c.tipo,
      voci: c.voci.slice().sort((a, b) => Number(b.scaduto) - Number(a.scaduto) || a.data.localeCompare(b.data)),
      totale: c.voci.filter(v => !v.saldato).reduce((s, v) => s + v.importo, 0),
      scaduti: c.voci.filter(v => v.scaduto && !v.saldato).length,
    }));
  });

  ngOnInit(): void { this.carica(); }

  // ── Azioni ─────────────────────────────────────────────────────────────────
  cambiaPeriodo(p: DashboardPeriod): void {
    if (p === this.periodo()) return;
    this.periodo.set(p);
    this.carica();
  }

  toggleFiltro(t: ScadTipo): void {
    this.filtri.update(f => ({ ...f, [t]: !f[t] }));
  }

  /** Apre il dettaglio della voce nella pagina di competenza (v.id = id navigabile della sorgente:
   *  evento, piano ricorrente, movimento). Vedi DashboardService.getScadenzeImminenti per gli id. */
  apri(v: Voce): void {
    switch (v.tipo) {
      case 'EVENTO':     this.router.navigate(['/eventi', v.id]); break;
      case 'RICORRENTE': this.router.navigate(['/spese-ricorrenti', v.id]); break;
      case 'USCITA':
      case 'ENTRATA':    this.router.navigate(['/movimenti', v.id]); break;
    }
  }

  mesePrec(): void { this.meseCal.update(m => new Date(m.getFullYear(), m.getMonth() - 1, 1)); }
  meseSucc(): void { this.meseCal.update(m => new Date(m.getFullYear(), m.getMonth() + 1, 1)); }
  meseOggi(): void { this.meseCal.set(this.primoDelMese(new Date())); }

  private carica(): void {
    this.loading.set(true);
    this.errore.set(false);
    this.dashboardSvc.getScadenzeImminenti(this.periodo()).subscribe({
      next: d => { this.dati.set({ ...d, entrateDaRicevere: d.entrateDaRicevere ?? [] }); this.loading.set(false); },
      error: () => { this.errore.set(true); this.loading.set(false); },
    });
  }

  // ── Normalizzazione sorgenti → Voce ─────────────────────────────────────────
  private daScadenze(rows: ScadenzaDTO[], tipo: ScadTipo): Voce[] {
    return rows.map(r => {
      const gg = this.ggDaOggi(r.dataScadenza);
      const saldato = r.stato === 'PAID';
      return {
        tipo, id: r.referenceId, descrizione: r.descrizione,
        importo: r.importoAtteso, data: r.dataScadenza, gg,
        scaduto: !saldato && gg < 0, saldato,
      };
    });
  }

  private daMovimenti(rows: UscitaDaLiquidareDTO[], tipo: ScadTipo): Voce[] {
    return rows.map(r => ({
      tipo, id: r.id, descrizione: r.descrizione ?? r.fornitoreNome ?? r.categoriaNome ?? 'Movimento',
      importo: r.importo, data: r.dataLiquidita, gg: r.ggAllaScadenza,
      scaduto: r.ggAllaScadenza < 0, saldato: false,
    }));
  }

  // ── Stato/etichette di una voce ─────────────────────────────────────────────
  statoCls(v: Voce): string {
    if (v.saldato) return 'st-paid';
    if (v.scaduto) return 'st-late';
    if (v.gg <= 7) return 'st-soon';
    return 'st-ok';
  }

  statoLabel(v: Voce): string {
    if (v.saldato) return 'Saldato';
    if (v.scaduto) return `Scaduto da ${-v.gg} gg`;
    if (v.gg === 0) return 'Scade oggi';
    if (v.gg <= 7) return `Tra ${v.gg} gg`;
    return this.formatGiorno(v.data);
  }

  /** Verso del denaro: incassi/eventi = +, fatture/ricorrenti = −. Per il segno dell'importo. */
  segno(t: ScadTipo): '+' | '−' {
    return t === 'USCITA' || t === 'RICORRENTE' ? '−' : '+';
  }

  formatGiorno(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  private ggDaOggi(iso: string): number {
    const [y, m, d] = iso.split('-').map(Number);
    const target = new Date(y, m - 1, d).getTime();
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    return Math.round((target - oggi.getTime()) / MS_DAY);
  }

  /** Fatture/incassi: mostra solo ciò che scade entro l'orizzonte del periodo, ma sempre gli scaduti. */
  private entroOrizzonte(v: Voce): boolean {
    if (v.scaduto) return true;
    return v.data <= this.orizzonteTo();
  }

  private orizzonteTo(): string {
    const oggi = new Date();
    switch (this.periodo()) {
      case 'MTD': return this.toIso(new Date(oggi.getFullYear(), oggi.getMonth() + 1, 0));
      case 'QTD': {
        const q = Math.floor(oggi.getMonth() / 3);
        return this.toIso(new Date(oggi.getFullYear(), q * 3 + 3, 0));
      }
      case 'YTD':
      default:    return this.toIso(new Date(oggi.getFullYear(), 11, 31));
    }
  }

  private ordineTipo(t: ScadTipo): number {
    return { USCITA: 0, ENTRATA: 1, RICORRENTE: 2, EVENTO: 3 }[t];
  }

  private primoDelMese(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }

  private toIso(d: Date): string {
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const g = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${m}-${g}`;
  }
}
