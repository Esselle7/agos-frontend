import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { MovimentiService } from '../../core/services/movimenti.service';
import { RigaImportDTO, StatoRigaImport } from '../../core/models/movimenti.models';
import { ImportCountsService } from './import-counts.service';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';

/** Dove il wizard si apre per lavorare una riga di quello stato. */
const FASE_DI: Record<string, string> = {
  MOVIMENTO: 'catalogare',
  AMBIGUITA: 'catalogare',
  EVENTO: 'incassi-evento',
  RICORRENTE: 'rate',
  DIFFERITO: 'smistamento/matching-differiti',
  SCARTATO: 'scartati',
};

/**
 * Registro di TUTTE le righe dell'import (SPEC import-v2 R21/R22): ogni riga bancaria dell'export
 * con data, conto, direzione, importo, causale e <b>stato con badge</b>.
 *
 * <p><b>Nessuna azione inline</b>: il denaro si muove da una strada sola, il wizard (principio 6 di
 * PRODUCT.md). Cliccare una riga porta alla fase che la lavora — leggere è una cosa, decidere
 * un'altra, e mescolarle è come si firmano le cose per sbaglio.
 */
@Component({
  selector: 'app-registro-import',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe, DatePipe, ReactiveFormsModule,
    MatIconModule, MatButtonModule, MatProgressSpinnerModule, HelpNoteComponent,
  ],
  template: `
    <div class="reg">
      <header class="reg__head">
        <div>
          <h2>Registro dell'import</h2>
          <p class="reg__sub">Tutte le righe lette dai due estratti conto, com'è messa ognuna adesso.</p>
        </div>
      </header>

      <div class="reg__filtri" role="search">
        <label class="reg__cerca">
          <mat-icon aria-hidden="true">search</mat-icon>
          <input type="search" [formControl]="cerca" placeholder="Cerca nella causale o nell'importo"
                 aria-label="Cerca nel registro">
        </label>
        <div class="reg__chip-riga" role="group" aria-label="Filtra per stato">
          @for (s of statiFiltro; track s.k) {
            <button type="button" class="reg__chip" [class.reg__chip--on]="stato() === s.k"
                    [attr.aria-pressed]="stato() === s.k" (click)="filtraStato(s.k)">{{ s.label }}</button>
          }
        </div>
        <div class="reg__chip-riga" role="group" aria-label="Filtra per conto">
          @for (c of contiFiltro; track c.k) {
            <button type="button" class="reg__chip" [class.reg__chip--on]="conto() === c.k"
                    [attr.aria-pressed]="conto() === c.k" (click)="filtraConto(c.k)">{{ c.label }}</button>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="reg__center"><mat-spinner diameter="36"></mat-spinner></div>
      } @else if (errore()) {
        <div class="reg__center">
          <p>Non è stato possibile leggere il registro. Nessun dato è stato toccato.</p>
          <button mat-stroked-button (click)="carica()">Riprova</button>
        </div>
      } @else if (!righe().length) {
        <p class="reg__vuoto">Nessuna riga con questi filtri.</p>
      } @else {
        <div class="reg__tab-wrap">
          <table class="reg__tab">
            <caption class="sr-only">Righe bancarie dell'import, con lo stato di ciascuna</caption>
            <thead>
              <!-- I totali stanno in CIMA e incolonnati sotto le loro colonne: si leggono con lo
                   stesso movimento d'occhio delle righe, senza doverli cercare altrove. -->
              <tr class="reg__tot">
                <th scope="row" colspan="2">
                  <span class="reg__tot-et">{{ filtroAttivo() ? 'Totale filtrato' : 'Totale' }}</span>
                  <small>{{ totale() }} {{ totale() === 1 ? 'riga' : 'righe' }}</small>
                </th>
                <td class="num">
                  <span class="reg__tot-e">{{ totali().entrate | currency:'EUR' }}</span>
                  <small>{{ totali().righeE }}</small>
                </td>
                <td class="num">
                  <span class="reg__tot-u">{{ totali().uscite | currency:'EUR' }}</span>
                  <small>{{ totali().righeU }}</small>
                </td>
                <td colspan="2" class="reg__tot-nota">
                  @if (filtroAttivo()) { somma delle righe che passano i filtri, non solo di quelle a schermo }
                  @else { tutte le righe lette dai due estratti conto }
                </td>
              </tr>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Conto</th>
                <th scope="col" class="num">Entrata</th>
                <th scope="col" class="num">Uscita</th>
                <th scope="col">Causale</th>
                <th scope="col">Stato</th>
              </tr>
            </thead>
            <tbody>
              @for (r of righe(); track r.origine + r.id) {
                <tr class="reg__riga" tabindex="0" role="link"
                    [attr.aria-label]="ariaRiga(r)"
                    (click)="apri(r)" (keydown.enter)="apri(r)" (keydown.space)="apri(r); $event.preventDefault()">
                  <td>{{ r.data | date:'dd/MM/yy' }}</td>
                  <td class="reg__conto" [attr.title]="r.conto">{{ contoBreve(r.conto) }}</td>
                  <td class="num num--e">{{ r.tipo === 'ENTRATA' ? (r.importo | currency:'EUR') : '' }}</td>
                  <td class="num">{{ r.tipo === 'USCITA' ? (r.importo | currency:'EUR') : '' }}</td>
                  <td class="reg__causale">
                    <span class="reg__causale-txt">{{ r.causale }}</span>
                    @if (r.dettaglio) { <small>{{ r.dettaglio }}</small> }
                  </td>
                  <td>
                    <!-- R22: la parola, sempre. Il colore da solo non è uno stato. -->
                    <span class="reg__badge" [class]="'reg__badge--' + r.stato">{{ r.statoParola }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (totale() > righe().length) {
          <div class="reg__piu">
            <button mat-stroked-button (click)="ancora()">
              Mostra altre righe ({{ righe().length }} di {{ totale() }})
            </button>
          </div>
        }
      }

      <agos-help-note tono="tip" titolo="Perché qui non si può fare niente" [collapsed]="true">
        <p>Questo è un <strong>registro</strong>: serve a vedere dov'è finita ogni riga
          dell'estratto conto. Le decisioni si prendono dalle fasi qui sopra, una riga per volta,
          con l'effetto in euro davanti agli occhi — così il denaro si muove da una strada sola.</p>
        <p>Cliccando una riga si apre la fase che la lavora.</p>
      </agos-help-note>
    </div>
  `,
  styles: [`
    .reg { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
    .reg__head h2 { margin: 0; font-size: 1.15rem; }
    .reg__sub { margin: 2px 0 0; color: var(--text-sub); font-size: .88rem; }

    .reg__filtri { display: flex; flex-direction: column; gap: 8px; }
    .reg__cerca { display: flex; align-items: center; gap: 8px; padding: 8px 12px;
      border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card);
      max-width: 420px; }
    .reg__cerca mat-icon { color: var(--text-sub); font-size: 19px; width: 19px; height: 19px; }
    .reg__cerca input { flex: 1; border: 0; background: none; font: inherit; color: var(--text-main);
      min-width: 0; }
    .reg__cerca input:focus { outline: none; }
    .reg__cerca:focus-within { border-color: var(--primary); }

    .reg__chip-riga { display: flex; flex-wrap: wrap; gap: 6px; }
    .reg__chip { padding: 5px 12px; border: 1px solid var(--border); border-radius: 999px;
      background: var(--card); font: inherit; font-size: .82rem; color: var(--text-main);
      cursor: pointer; }
    .reg__chip:hover { border-color: var(--primary-l); }
    .reg__chip:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .reg__chip--on { border-color: var(--primary); background: var(--tint-primary-strong);
      font-weight: 600; }

    .reg__center, .reg__vuoto { display: flex; flex-direction: column; align-items: center;
      gap: 12px; padding: 40px 16px; color: var(--text-sub); }


    .reg__tab-wrap { overflow-x: auto; border: 1px solid var(--border);
      border-radius: var(--radius-md); }
    /* Sticky SOLO la riga dei totali: serve soprattutto dopo aver guardato venti righe, non
       prima. Le intestazioni sotto restano ferme — renderle sticky pretenderebbe di sapere
       l'altezza della riga totali (un numero magico che si rompe al primo ritocco). La barra si
       spiega da sé: etichetta a sinistra, entrate in verde, uscite accanto. */
    .reg__tot th, .reg__tot td { position: sticky; top: 0; z-index: 1; }
    .reg__tab { width: 100%; border-collapse: collapse; font-size: .88rem; }
    .reg__tab th { text-align: left; padding: 9px 12px; background: var(--surface-2);
      font-size: .74rem; letter-spacing: .05em; text-transform: uppercase; color: var(--text-sub);
      font-weight: 600; white-space: nowrap; }
    .reg__tab td { padding: 9px 12px; border-top: 1px solid var(--border-soft);
      vertical-align: top; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .num--e { color: var(--success); }

    .reg__tot th, .reg__tot td { background: var(--surface-sunken); padding: 10px 12px;
      border-bottom: 1px solid var(--border); vertical-align: baseline; }
    .reg__tot th { text-align: left; }
    .reg__tot small { display: block; font-size: .72rem; font-weight: 500;
      color: var(--text-sub); margin-top: 1px; }
    .reg__tot-et { font-size: .8rem; font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; color: var(--text-main); }
    .reg__tot-e, .reg__tot-u { font-size: 1.12rem; font-weight: 700;
      font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
    .reg__tot-e { color: var(--success); }
    .reg__tot-u { color: var(--text-main); }
    .reg__tot-nota { font-size: .76rem; color: var(--text-sub); line-height: 1.4;
      max-width: 34ch; font-weight: 400; }

    .reg__riga { cursor: pointer; }
    .reg__riga:hover { background: var(--tint-primary); }
    .reg__riga:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }

    .reg__conto { white-space: nowrap; }
    .reg__causale { max-width: 42ch; }
    .reg__causale-txt { display: block; overflow-wrap: anywhere; }
    .reg__causale small { display: block; margin-top: 2px; color: var(--text-sub);
      font-size: .76rem; line-height: 1.4; }

    .reg__badge { display: inline-block; padding: 2px 9px; border-radius: 999px;
      font-size: .74rem; font-weight: 650; white-space: nowrap;
      border: 1px solid currentColor; }
    .reg__badge--A_LIBRO         { color: var(--success); }
    .reg__badge--DA_CATALOGARE   { color: var(--warning); }
    .reg__badge--FUORI_DAI_CONTI { color: var(--danger); }
    .reg__badge--PARTITA_DI_GIRO { color: var(--info); }
    /* Escluso e duplicata sono decisi e chiusi: testo attenuato SU FONDO NEUTRO, mai su tinta
       (R24: --text-sub/--text-faint non si usano per testo corrente su fondo tinto). */
    .reg__badge--ESCLUSO, .reg__badge--DUPLICATA { color: var(--text-sub);
      background: var(--surface-2); }

    .reg__piu { display: flex; justify-content: center; padding-top: 4px; }

    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  `],
})
export class RegistroImportComponent implements OnInit {
  private readonly movimenti = inject(MovimentiService);
  private readonly counts = inject(ImportCountsService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly errore = signal(false);
  readonly righe = signal<RigaImportDTO[]>([]);
  readonly totale = signal(0);
  /** Totali di TUTTO l'insieme filtrato, non della pagina caricata (li calcola il server). */
  readonly totali = signal<{ righeE: number; entrate: number; righeU: number; uscite: number }>(
    { righeE: 0, entrate: 0, righeU: 0, uscite: 0 });

  readonly stato = signal<StatoRigaImport | null>(null);
  readonly conto = signal<number | null>(null);
  private readonly size = signal(50);

  readonly cerca = new FormControl('', { nonNullable: true });
  /**
   * Trappola nota di questo progetto (R26): un `computed()` che legge `FormControl.value` resta
   * congelato — il valore cambia ma il segnale non se ne accorge. Si passa da valueChanges.
   */
  private readonly cercaSig = toSignal(this.cerca.valueChanges.pipe(debounceTime(250)),
    { initialValue: '' });

  readonly statiFiltro = [
    { k: null,                label: 'Tutte' },
    { k: 'DA_CATALOGARE',     label: 'Da catalogare' },
    { k: 'A_LIBRO',           label: 'A libro' },
    { k: 'FUORI_DAI_CONTI',   label: 'Fuori dai conti' },
    { k: 'ESCLUSO',           label: 'Escluse' },
    { k: 'PARTITA_DI_GIRO',   label: 'Partite di giro' },
    { k: 'DUPLICATA',         label: 'Duplicate' },
  ] as { k: StatoRigaImport | null; label: string }[];

  readonly contiFiltro = [
    { k: null, label: 'Tutti i conti' },
    { k: 1,    label: 'BPM' },
    { k: 2,    label: 'Crédit Agricole' },
  ];

  readonly importLogId = computed(() => this.counts.importCorrente());

  constructor() {
    // Ricarica quando cambia un filtro, la ricerca o l'import selezionato.
    effect(() => {
      this.cercaSig(); this.stato(); this.conto(); this.size(); this.importLogId();
      this.carica();
    });
  }

  ngOnInit(): void { this.counts.reload(); }

  carica(): void {
    const id = this.importLogId();
    if (!id) { this.loading.set(false); this.righe.set([]); this.totale.set(0); return; }
    this.loading.set(true);
    this.errore.set(false);
    this.movimenti.getRigheImport(id, {
      stato: this.stato() ?? undefined,
      conto: this.conto() ?? undefined,
      q: this.cercaSig() || undefined,
    }, 0, this.size()).subscribe({
      next: r => {
        this.righe.set(r.pagina.content);
        this.totale.set(r.pagina.totalElements);
        this.totali.set({
          righeE: r.righeEntrate, entrate: r.totaleEntrate,
          righeU: r.righeUscite,  uscite: r.totaleUscite,
        });
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.errore.set(true); },
    });
  }

  readonly filtroAttivo = computed(() =>
    this.stato() !== null || this.conto() !== null || !!this.cercaSig());

  filtraStato(k: StatoRigaImport | null): void { this.size.set(50); this.stato.set(k); }
  filtraConto(k: number | null): void { this.size.set(50); this.conto.set(k); }
  ancora(): void { this.size.update(n => n + 100); }

  /** Cliccare una riga porta alla fase che la lavora: leggere qui, decidere là. */
  apri(r: RigaImportDTO): void {
    this.router.navigate(['/import', FASE_DI[r.origine] ?? 'catalogare']);
  }

  /**
   * «Crédit Agricole – c/c operativo» → «Crédit Agricole». Il suffisso è identico su ogni riga:
   * occupa due righe di tabella per non dire niente. Il nome intero resta nel `title`.
   */
  contoBreve(conto: string | null): string {
    if (!conto) return '—';
    return conto.split(/\s[–-]\s/)[0].trim();
  }

  ariaRiga(r: RigaImportDTO): string {
    const verso = r.tipo === 'ENTRATA' ? 'entrata' : 'uscita';
    return `${verso} di ${r.importo} euro, ${r.statoParola}. ${r.causale ?? ''}`;
  }
}
