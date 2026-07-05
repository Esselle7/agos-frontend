import { Component, OnInit, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { PianoContiService } from '../../core/services/piano-conti.service';
import { PianoContiCogeDTO, TipoCoge } from '../../core/models/anagrafica.models';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader/skeleton-loader.component';
import {
  PianoContiFormDialogComponent,
  PianoContiFormData,
} from './piano-conti-form-dialog.component';
import { TIPI_COGE } from './piano-conti-tipi';

// Ordine, label (plurale) ed icona delle nature: fonte unica condivisa col dialog.
const GRUPPI = TIPI_COGE.map(t => ({ tipo: t.value, label: t.plurale, icon: t.icon }));

interface RigaConto { conto: PianoContiCogeDTO; depth: number; hasFigli: boolean; }
interface Gruppo { tipo: TipoCoge; label: string; icon: string; totale: number; righe: RigaConto[]; }

@Component({
  selector: 'app-piano-conti',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatInputModule,
    SkeletonLoaderComponent,
  ],
  template: `
    <div class="pc">
      <div class="pc-header">
        <div>
          <span class="page-eyebrow">Gestione</span>
          <h2>Piano dei conti</h2>
          <p class="pc-subtitle">I conti COGE della contabilità, raggruppati per natura e ordinati ad albero</p>
        </div>
        <button mat-flat-button color="primary" (click)="apri()">
          <mat-icon>add</mat-icon>
          Nuovo conto
        </button>
      </div>

      <mat-form-field appearance="outline" class="pc-search">
        <mat-icon matPrefix>search</mat-icon>
        <mat-label>Cerca per nome o codice</mat-label>
        <input matInput [value]="filtro()" (input)="filtro.set($any($event.target).value)" />
        @if (filtro()) {
          <button matSuffix mat-icon-button aria-label="Pulisci" (click)="filtro.set('')">
            <mat-icon>close</mat-icon>
          </button>
        }
      </mat-form-field>

      @if (loading()) {
        <div class="card"><agos-skeleton-loader [rows]="8" /></div>
      } @else if (error()) {
        <div class="card pc-error"><mat-icon>error_outline</mat-icon> {{ error() }}</div>
      } @else if (gruppi().length === 0) {
        <div class="card pc-empty">
          <mat-icon>search_off</mat-icon>
          <p>Nessun conto trovato{{ filtro() ? ' per «' + filtro() + '»' : '' }}</p>
        </div>
      } @else {
        <div class="pc-groups">
          @for (g of gruppi(); track g.tipo) {
            <section class="pc-group" [class]="'pc-group--' + g.tipo">
              <header class="pc-group__head">
                <mat-icon class="pc-group__icon">{{ g.icon }}</mat-icon>
                <h3 class="pc-group__title">{{ g.label }}</h3>
                <span class="pc-group__count" [attr.aria-label]="g.totale + ' conti'">{{ g.totale }}</span>
                <button mat-button class="pc-group__add" (click)="apri(undefined, g.tipo)"
                        [attr.aria-label]="'Aggiungi conto in ' + g.label">
                  <mat-icon>add</mat-icon> Aggiungi
                </button>
              </header>

              <ul class="pc-tree" role="list">
                @for (r of g.righe; track r.conto.id) {
                  <li class="pc-tree__item">
                    <button type="button" class="pc-row"
                            [class.pc-row--parent]="r.hasFigli" [class.pc-row--child]="r.depth > 0"
                            [style.--depth]="r.depth" (click)="apri(r.conto)"
                            [attr.aria-label]="'Modifica ' + r.conto.nome + ' (' + r.conto.codice + ')'">
                      <span class="pc-row__rail" aria-hidden="true"></span>
                      <span class="pc-row__code">{{ r.conto.codice }}</span>
                      <span class="pc-row__name">{{ r.conto.nome }}</span>
                      <mat-icon class="pc-row__edit" aria-hidden="true">edit</mat-icon>
                    </button>
                  </li>
                }
              </ul>
            </section>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .pc { display: flex; flex-direction: column; gap: 18px; padding: 1.5rem; max-width: 1180px; margin: 0 auto; }
    .pc-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .pc-header h2 { margin: 4px 0 2px; }
    .pc-subtitle { margin: 0; color: var(--text-sub); font-size: 0.85rem; }
    .pc-search { width: 100%; max-width: 440px; }

    /* Due colonne su schermi larghi: 6 gruppi diventano leggibili senza scroll infinito. */
    .pc-groups { display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); align-items: start; }

    /* Ogni gruppo porta il colore della sua natura in --accent; il pannello è una regione, non una card ripetuta. */
    .pc-group {
      display: flex; flex-direction: column; overflow: hidden;
      background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg);
    }
    .pc-group--RICAVO            { --accent: var(--success); }
    .pc-group--COSTO             { --accent: var(--danger); }
    .pc-group--ATTIVITA          { --accent: var(--info); }
    .pc-group--PASSIVITA         { --accent: var(--warning); }
    .pc-group--ONERE_FINANZIARIO { --accent: var(--primary); }
    .pc-group--IMPOSTA           { --accent: var(--accent-d); }

    .pc-group__head {
      display: flex; align-items: center; gap: 10px; padding: 12px 14px;
      background: color-mix(in srgb, var(--accent) 8%, var(--card));
      border-bottom: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
    }
    .pc-group__icon { color: var(--accent); }
    .pc-group__title { margin: 0; font-size: 1rem; font-weight: 700; color: var(--text-main); letter-spacing: .01em; }
    .pc-group__count {
      font-size: .72rem; font-weight: 700; color: var(--accent);
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      min-width: 22px; height: 20px; padding: 0 7px; border-radius: 999px;
      display: inline-flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums;
    }
    .pc-group__add { margin-left: auto; color: var(--accent); font-size: .82rem; min-width: 0; }
    .pc-group__add mat-icon { margin-right: 2px; }

    .pc-tree { list-style: none; margin: 0; padding: 6px; display: flex; flex-direction: column; gap: 1px; }

    /* Riga = affordance di modifica. Rientro per livello via --depth; il rail disegna il connettore ad albero. */
    .pc-row {
      position: relative; display: flex; align-items: center; gap: 10px; width: 100%;
      text-align: left; font: inherit; cursor: pointer;
      padding: 8px 10px 8px calc(10px + var(--depth, 0) * 22px);
      background: transparent; border: 0; border-radius: var(--radius-sm);
      transition: background var(--t-fast) var(--ease);
    }
    /* Connettore "└" nella gronda del rientro (1px neutro: guida gerarchica, non un accent stripe). */
    .pc-row__rail { position: absolute; top: 0; bottom: 0; width: 0; pointer-events: none; }
    .pc-row--child .pc-row__rail::before {
      content: ''; position: absolute;
      left: calc(10px + (var(--depth) - 1) * 22px + 7px);
      top: -1px; height: 50%; width: 11px;
      border-left: 1px solid var(--border-strong);
      border-bottom: 1px solid var(--border-strong);
      border-bottom-left-radius: 5px;
    }
    .pc-row__code {
      flex-shrink: 0; font-family: ui-monospace, 'Courier New', monospace; font-size: .72rem; font-weight: 600;
      color: var(--text-sub); background: var(--surface-sunken);
      padding: 2px 7px; border-radius: 6px; font-variant-numeric: tabular-nums;
    }
    .pc-row__name { flex: 1; min-width: 0; font-size: .9rem; color: var(--text-main); line-height: 1.3;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pc-row--parent .pc-row__name { font-weight: 700; }
    .pc-row--parent .pc-row__code { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
    .pc-row__edit { color: var(--text-faint); font-size: 18px; width: 18px; height: 18px; opacity: 0; transition: opacity var(--t-fast) var(--ease); }

    .pc-row:hover { background: color-mix(in srgb, var(--accent) 9%, transparent); }
    .pc-row:hover .pc-row__edit { opacity: 1; color: var(--accent); }
    .pc-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

    .pc-error { display: flex; align-items: center; gap: 10px; padding: 18px; color: var(--danger); }
    .pc-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 36px; color: var(--text-sub); }

    @media (prefers-reduced-motion: reduce) {
      .pc-row, .pc-row__edit { transition: none; }
    }
  `],
})
export class PianoContiComponent implements OnInit {
  private readonly service = inject(PianoContiService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);

  readonly conti = signal<PianoContiCogeDTO[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filtro = signal('');

  // Filtro per label/codice mantenendo gli antenati, così l'albero resta coerente anche cercando.
  private readonly visibili = computed<PianoContiCogeDTO[]>(() => {
    const q = this.filtro().trim().toLowerCase();
    const all = this.conti();
    if (!q) return all;
    const byId = new Map(all.map(c => [c.id, c]));
    const keep = new Set<number>();
    for (const c of all) {
      if (c.codice.toLowerCase().includes(q) || c.nome.toLowerCase().includes(q)) {
        keep.add(c.id);
        let p = c.parentId;
        while (p != null && !keep.has(p)) { keep.add(p); p = byId.get(p)?.parentId ?? null; }
      }
    }
    return all.filter(c => keep.has(c.id));
  });

  readonly gruppi = computed<Gruppo[]>(() => {
    const list = this.visibili();
    const parentIds = new Set(list.map(c => c.parentId).filter((x): x is number => x != null));
    return GRUPPI
      .map(g => {
        const conti = list
          .filter(c => c.tipo === g.tipo)
          .sort((a, b) => (a.codice < b.codice ? -1 : a.codice > b.codice ? 1 : 0));
        const base = conti.length ? Math.min(...conti.map(c => c.livello)) : 1;
        const righe: RigaConto[] = conti.map(c => ({
          conto: c, depth: c.livello - base, hasFigli: parentIds.has(c.id),
        }));
        return { tipo: g.tipo, label: g.label, icon: g.icon, totale: conti.length, righe };
      })
      .filter(g => g.righe.length > 0);
  });

  ngOnInit(): void {
    this.carica();
  }

  carica(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => { this.conti.set(data); this.loading.set(false); },
      error: () => { this.error.set('Errore nel caricamento del piano dei conti.'); this.loading.set(false); },
    });
  }

  apri(conto?: PianoContiCogeDTO, presetTipo?: TipoCoge): void {
    const data: PianoContiFormData = { conto, presetTipo, conti: this.conti() };
    this.dialog
      .open(PianoContiFormDialogComponent, {
        data, width: '460px', panelClass: 'pc-dialog-panel', autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .subscribe((salvato) => { if (salvato) this.carica(); });
  }
}
