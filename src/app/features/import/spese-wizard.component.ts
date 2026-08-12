import { Component, OnInit, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';

import { MovimentiService } from '../../core/services/movimenti.service';
import { LookupService } from '../../core/services/lookup.service';
import { BuService } from '../../core/services/bu.service';
import { TransitorioDTO } from '../../core/models/movimenti.models';
import { PianoContiCogeDTO, BusinessUnitDTO } from '../../core/models/anagrafica.models';
import { CogePickerComponent } from '../../shared/components/coge-picker/coge-picker.component';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';
import { ImportCountsService } from './import-counts.service';

/** Le stesse chiavi del picker: i conti già usati sono le scorciatoie del wizard. */
const RECENTS_KEY = 'agos_coge_recents';
/** BU 5 = Overhead, il fallback del motore: non è una risposta, è l'assenza di risposta. */
const BU_FALLBACK = 5;

/** Un esercente = una decisione: la riga in testa più le sue gemelle da sistemare insieme. */
interface Gruppo {
  chiave: string;
  righe: TransitorioDTO[];
}

/**
 * Wizard «Che spesa è questa?» (docs/specs/wizard-spese-da-sistemare.md, audit import §7.1).
 *
 * <p>Sostituisce la griglia `/import/smistamento/catalogare` e assorbe le code «Effetti / RiBa»
 * (§7.7) e «Business Unit» (§7.5). Una spesa per volta, la domanda in italiano, l'effetto in euro
 * PRIMA del click che scrive.
 *
 * <p><b>Si raggruppa solo sullo stesso esercente.</b> Gli incassi POS e le righe effetti/RiBa
 * restano decisioni singole: hanno la stessa forma ma sono giornate, importi e fornitori diversi.
 * Misurato sul corpus di 6 mesi: 187 righe → 142 decisioni (81 gruppi + 61 righe a sé).
 */
@Component({
  selector: 'app-spese-wizard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe, DatePipe,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatCheckboxModule,
    CogePickerComponent, HelpNoteComponent,
  ],
  template: `
    <div class="wz">
      @if (loading()) {
        <div class="wz__center"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (caricamentoFallito()) {
        <div class="wz__stato">
          <mat-icon>cloud_off</mat-icon>
          <p>Non è stato possibile caricare le spese da sistemare. Nessun dato è stato toccato.</p>
          <button mat-stroked-button (click)="ricarica()">Riprova</button>
        </div>
      } @else if (!gruppi().length) {
        <div class="wz__stato wz__stato--ok">
          <mat-icon>task_alt</mat-icon>
          <h2>Non c'è niente da sistemare</h2>
          <p>Ogni movimento importato è finito su una voce di bilancio.
            Quando importerai altri estratti conto, le spese che il sistema non sa riconoscere
            si fermeranno qui e te le chiederò una per volta.</p>
        </div>
      } @else if (corrente(); as g) {
        <header class="wz__head">
          <div class="wz__headline">
            <h2>Spese da sistemare</h2>
            <p class="wz__conta">
              <strong>{{ indice() + 1 }}</strong> di {{ gruppi().length }}
              @if (rimandate() > 0) { · {{ rimandate() }} rimandate a dopo }
            </p>
          </div>
          <div class="wz__barra" role="progressbar" [attr.aria-valuenow]="indice() + 1"
               aria-valuemin="1" [attr.aria-valuemax]="gruppi().length"
               [attr.aria-label]="'Spesa ' + (indice() + 1) + ' di ' + gruppi().length">
            <span [style.width.%]="((indice() + 1) / gruppi().length) * 100"></span>
          </div>
        </header>

        <section class="wz__spesa" [attr.aria-labelledby]="'wz-chi'">
          <p class="wz__frase">
            {{ g.righe[0].tipo === 'USCITA' ? 'Hai pagato' : 'Hai incassato' }}
            <b class="wz__cifra">{{ g.righe[0].importo | currency:'EUR' }}</b>
            {{ g.righe[0].tipo === 'USCITA' ? 'a' : 'da' }}
          </p>
          <p class="wz__chi" id="wz-chi">{{ etichetta(g) }}</p>
          <p class="wz__quando">
            il {{ g.righe[0].dataMovimento | date:'d MMMM yyyy' }}{{ conto(g.righe[0]) }}
          </p>
          <p class="wz__causale">«{{ g.righe[0].descrizione }}»</p>

          @if (g.righe[0].dataOperazione || g.righe[0].circuitoPos) {
            <dl class="wz__banca">
              <div><dt>Accreditato il</dt><dd>{{ g.righe[0].dataMovimento | date:'dd/MM/yyyy' }}</dd></div>
              @if (g.righe[0].dataOperazione) {
                <div><dt>Operazione del</dt><dd>{{ g.righe[0].dataOperazione }}</dd></div>
              }
              @if (g.righe[0].circuitoPos) {
                <div><dt>Circuito</dt><dd>{{ g.righe[0].circuitoPos }}</dd></div>
              }
              <div><dt>Conto</dt><dd>{{ nomeConto(g.righe[0]) }}</dd></div>
            </dl>
          }
        </section>

        @if (g.righe[0].riscontroBilly; as b) {
          <section class="wz__billy">
            <h3>Billy, lo stesso giorno su questo conto</h3>
            <p class="wz__billy-num">
              <b>{{ b.scontrini }}</b> {{ b.scontrini === 1 ? 'riga di ricavo' : 'righe di ricavo' }}
              per <b>{{ b.totale | currency:'EUR' }}</b>, contro
              <b>{{ g.righe[0].importo | currency:'EUR' }}</b> accreditati dalla banca
              (differenza {{ b.scarto | currency:'EUR' }}).
            </p>
            <p class="wz__billy-avviso">
              <mat-icon>info</mat-icon>
              <span><b>Non è un errore da correggere.</b> Billy e la banca non si agganciano
                scontrino per accredito: la riconciliazione POS lavora sui <b>totali di periodo</b>,
                e la banca accredita a giorni di distanza raggruppando più vendite. Questo confronto
                serve a darti l'ordine di grandezza della giornata. La quadratura vera è sotto
                <b>Report → Quadratura POS</b>.</span>
            </p>
          </section>
        }

        <section class="wz__scelta" aria-labelledby="wz-domanda">
          <h3 id="wz-domanda">
            {{ g.righe[0].tipo === 'USCITA' ? 'Che cos\\'è questa spesa?' : 'Che cos\\'è questo incasso?' }}
          </h3>

          @if (suggerito(g); as s) {
            <button type="button" class="wz__voce wz__voce--sugg"
                    [class.wz__voce--on]="cogeScelto()?.id === s.id" (click)="scegli(s)">
              <mat-icon>lightbulb</mat-icon>
              <span class="wz__voce-txt">
                <b>{{ s.nome }}</b>
                <small>{{ g.righe[0].motivoSuggerimento }}</small>
              </span>
            </button>
          }

          <div class="wz__voci">
            @for (c of scorciatoie(); track c.id) {
              <button type="button" class="wz__voce"
                      [class.wz__voce--on]="cogeScelto()?.id === c.id" (click)="scegli(c)">
                <span class="wz__voce-txt"><b>{{ c.nome }}</b><small>{{ c.codice }}</small></span>
              </button>
            }
          </div>

          <app-coge-picker
            [label]="scorciatoie().length ? 'Cerca un\\'altra voce…' : 'Scegli la voce di bilancio'"
            [required]="true" [value]="cogeScelto()?.id ?? null" [allowedIds]="cogeAmmessi()"
            (cogeChange)="scegli($event)"></app-coge-picker>
        </section>

        @if (g.righe.length > 1) {
          <section class="wz__gemelle" aria-labelledby="wz-gemelle">
            <h3 id="wz-gemelle">
              Ce ne {{ g.righe.length === 2 ? 'è un\\'altra' : 'sono altre ' + (g.righe.length - 1) }}
              da {{ etichetta(g) }}: le sistemo insieme?
            </h3>
            @for (r of g.righe.slice(1); track r.id) {
              <label class="wz__gemella">
                <mat-checkbox [checked]="insieme()[r.id] !== false"
                              (change)="insiemeToggle(r.id, $event.checked)"></mat-checkbox>
                <span>{{ r.importo | currency:'EUR' }} del {{ r.dataMovimento | date:'d MMMM' }}</span>
                <small>{{ r.descrizione }}</small>
              </label>
            }
          </section>
        }

        @if (cogeScelto(); as c) {
          @if (chiediRamo()) {
            <section class="wz__ramo" aria-labelledby="wz-ramo">
              <h3 id="wz-ramo">Questa spesa a quale parte dell'azienda?</h3>
              <div class="wz__voci">
                @for (b of bu(); track b.id) {
                  <button type="button" class="wz__voce wz__voce--stretta"
                          [class.wz__voce--on]="buScelta() === b.id" (click)="buScelta.set(b.id)">
                    <span class="wz__voce-txt"><b>{{ b.nome }}</b></span>
                  </button>
                }
              </div>
              <p class="wz__nota">
                <mat-icon>info</mat-icon>
                Cambiare questo <b>non muove nessun saldo</b>: serve solo a leggere quanto rende
                ogni ramo.
              </p>
            </section>
          }

          <!-- L'effetto in euro si legge PRIMA di confermare, sempre (SPEC R8). -->
          <section class="wz__esito" aria-live="polite">
            <p class="wz__effetto">
              <mat-icon>check_circle</mat-icon>
              <span>
                <b>{{ totaleScelto() | currency:'EUR' }}</b>
                @if (righeScelte().length > 1) { ({{ righeScelte().length }} righe) }
                {{ g.righe[0].tipo === 'USCITA' ? 'andranno nei costi' : 'andranno nei ricavi' }}
                di {{ g.righe[0].dataMovimento | date:'MMMM yyyy' }}, voce <b>«{{ c.nome }}»</b>@if (nomeRamo(); as r) {, ramo <b>{{ r }}</b>}.
              </span>
            </p>
            <div class="wz__azioni">
              <button mat-flat-button color="primary" [disabled]="!puoConfermare()" (click)="conferma()">
                @if (salvando()) { <mat-spinner diameter="18"></mat-spinner> } @else { Va bene }
              </button>
              <button mat-button (click)="annullaScelta()">Torna indietro</button>
            </div>
          </section>
        } @else {
          <div class="wz__azioni wz__azioni--vuote">
            <button mat-stroked-button (click)="rimanda()">
              <mat-icon>schedule</mat-icon> Non lo so, lascia in sospeso
            </button>
          </div>
        }

        <agos-help-note tono="tip" titolo="Perché queste spese sono qui" [collapsed]="true">
          <p>Sono movimenti veri, già nei saldi dei conti: quello che manca è <strong>la voce di
            bilancio</strong>, cioè in che costo o ricavo vanno letti. Finché restano qui, il conto
            economico li mostra come «da classificare».</p>
          <p>Se non sai rispondere, <strong>lascia in sospeso</strong>: la spesa resta qui e non
            succede niente. Per correggere una spesa già sistemata si va in <strong>Movimenti</strong>.</p>
        </agos-help-note>
      }
    </div>
  `,
  styles: [`
    .wz { padding: 16px; display: flex; flex-direction: column; gap: 20px; max-width: 720px; }

    .wz__center, .wz__stato { display: flex; flex-direction: column; align-items: center;
      gap: 12px; padding: 56px 24px; color: var(--text-sub); text-align: center; }
    .wz__stato mat-icon { font-size: 44px; width: 44px; height: 44px; opacity: .45; }
    .wz__stato h2 { margin: 0; font-size: 1.15rem; color: var(--text-main); }
    .wz__stato p { margin: 0; max-width: 46ch; line-height: 1.55; }
    .wz__stato--ok mat-icon { color: var(--success); opacity: .8; }

    .wz__head { display: flex; flex-direction: column; gap: 10px; }
    .wz__headline { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .wz__headline h2 { margin: 0; font-size: 1.25rem; }
    .wz__conta { margin: 0; color: var(--text-sub); font-size: .88rem; }
    .wz__barra { height: 4px; border-radius: 2px; background: var(--surface-2); overflow: hidden; }
    .wz__barra span { display: block; height: 100%; background: var(--primary);
      transition: width var(--t-base) var(--ease); }

    .wz__spesa { background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius-md); padding: 20px 22px; display: flex; flex-direction: column; gap: 4px; }
    .wz__frase { margin: 0; font-size: 1rem; color: var(--text-sub); }
    .wz__cifra { font-size: 1.5rem; font-weight: 650; color: var(--text-main); letter-spacing: -.01em; }
    .wz__chi { margin: 6px 0 0; font-size: 1.3rem; font-weight: 600; line-height: 1.25;
      text-wrap: balance; color: var(--text-main); }
    .wz__quando { margin: 2px 0 0; color: var(--text-sub); font-size: .92rem; }
    .wz__causale { margin: 10px 0 0; padding-top: 10px; border-top: 1px solid var(--border-soft);
      font-family: ui-monospace, 'Courier New', monospace; font-size: .78rem; color: var(--text-faint);
      overflow-wrap: anywhere; }

    .wz__banca { margin: 12px 0 0; padding-top: 10px; border-top: 1px solid var(--border-soft);
      display: flex; flex-wrap: wrap; gap: 6px 24px; }
    .wz__banca div { display: flex; flex-direction: column; gap: 1px; }
    .wz__banca dt { font-size: .7rem; color: var(--text-faint); text-transform: none; }
    .wz__banca dd { margin: 0; font-size: .88rem; font-weight: 600; color: var(--text-main); }

    .wz__billy { background: var(--surface-sunken); border-radius: var(--radius-md); padding: 16px 18px; }
    .wz__billy h3 { margin: 0 0 8px; font-size: .95rem; font-weight: 600; }
    .wz__billy-num { margin: 0 0 10px; font-size: .95rem; line-height: 1.5; }
    .wz__billy-avviso { margin: 0; display: flex; align-items: flex-start; gap: 8px;
      font-size: .84rem; line-height: 1.5; color: var(--text-sub); }
    .wz__billy-avviso mat-icon { font-size: 17px; width: 17px; height: 17px; flex-shrink: 0; margin-top: 2px; }

    .wz__scelta h3, .wz__gemelle h3, .wz__ramo h3 { margin: 0 0 12px; font-size: 1.05rem; font-weight: 600; }
    .wz__voci { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }

    .wz__voce { display: flex; align-items: center; gap: 10px; padding: 12px 16px; min-height: 56px;
      border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card);
      cursor: pointer; text-align: left; font: inherit; color: var(--text-main);
      transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease); }
    .wz__voce:hover { border-color: var(--primary-l); background: var(--tint-primary); }
    .wz__voce:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .wz__voce--on { border-color: var(--primary); background: var(--tint-primary-strong); }
    .wz__voce--stretta { flex: 0 1 auto; }
    .wz__voce--sugg { width: 100%; margin-bottom: 12px; }
    .wz__voce--sugg mat-icon { color: var(--accent); flex-shrink: 0; }
    .wz__voce-txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .wz__voce-txt b { font-size: .95rem; font-weight: 600; }
    .wz__voce-txt small { font-size: .76rem; color: var(--text-sub); }

    .wz__gemelle { background: var(--surface-sunken); border-radius: var(--radius-md); padding: 16px 18px; }
    .wz__gemella { display: grid; grid-template-columns: auto 1fr; align-items: center;
      column-gap: 8px; padding: 6px 0; cursor: pointer; }
    .wz__gemella span { font-size: .95rem; }
    .wz__gemella small { grid-column: 2; font-size: .74rem; color: var(--text-faint);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .wz__nota { margin: 4px 0 0; display: flex; align-items: flex-start; gap: 8px;
      font-size: .86rem; color: var(--text-sub); }
    .wz__nota mat-icon { font-size: 17px; width: 17px; height: 17px; flex-shrink: 0; margin-top: 1px; }

    .wz__esito { background: var(--tint-success); border-radius: var(--radius-md); padding: 16px 18px;
      display: flex; flex-direction: column; gap: 14px; }
    .wz__effetto { margin: 0; display: flex; align-items: flex-start; gap: 9px;
      font-size: .95rem; line-height: 1.5; color: var(--text-main); }
    .wz__effetto mat-icon { color: var(--success); font-size: 19px; width: 19px; height: 19px;
      flex-shrink: 0; margin-top: 2px; }

    .wz__azioni { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .wz__azioni--vuote { padding-top: 4px; }
    .wz__azioni mat-spinner { display: inline-block; }

    @media (prefers-reduced-motion: reduce) {
      .wz__barra span, .wz__voce { transition: none; }
    }
  `],
})
export class SpeseWizardComponent implements OnInit {
  private readonly movimenti = inject(MovimentiService);
  private readonly lookup = inject(LookupService);
  private readonly buService = inject(BuService);
  private readonly counts = inject(ImportCountsService);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(true);
  readonly caricamentoFallito = signal(false);
  readonly salvando = signal(false);

  readonly gruppi = signal<Gruppo[]>([]);
  readonly indice = signal(0);
  readonly rimandate = signal(0);

  readonly coge = signal<PianoContiCogeDTO[]>([]);
  readonly bu = signal<BusinessUnitDTO[]>([]);
  /** conto CoGe → rami con cui è già stato usato: se è uno solo, il ramo non si chiede. */
  private readonly buPerCoge = signal<Record<number, number[]>>({});

  readonly cogeScelto = signal<PianoContiCogeDTO | null>(null);
  readonly buScelta = signal<number | null>(null);
  /** Righe gemelle escluse a mano (id → false). Di default il gruppo si sistema intero. */
  readonly insieme = signal<Record<string, boolean>>({});

  readonly corrente = computed(() => this.gruppi()[this.indice()] ?? null);

  /** Il gruppo escluse le gemelle deselezionate: è l'insieme che verrà scritto. */
  readonly righeScelte = computed(() => {
    const g = this.corrente();
    if (!g) return [];
    return g.righe.filter((r, i) => i === 0 || this.insieme()[r.id] !== false);
  });

  readonly totaleScelto = computed(() =>
    this.righeScelte().reduce((s, r) => s + Number(r.importo), 0));

  /** Il mastro dei ricavi-evento non è selezionabile qui: il server lo rifiuta comunque (409). */
  readonly cogeAmmessi = computed(() =>
    this.coge().filter(c => !c.codice.startsWith('30.02.')).map(c => c.id));

  /** Le voci usate di recente (stesso storage del picker): scorciatoia, non catalogo. */
  readonly scorciatoie = computed(() => {
    const escluso = this.corrente()?.righe[0]?.cogeSuggeritoId;
    const conti = this.coge();
    return this.recents()
      .filter(id => id !== escluso)
      .map(id => conti.find(c => c.id === id))
      .filter((c): c is PianoContiCogeDTO => !!c && !c.codice.startsWith('30.02.'))
      .slice(0, 4);
  });

  /** Il ramo si chiede solo se la voce scelta è servita a più rami (o non è mai stata usata). */
  readonly chiediRamo = computed(() => {
    const c = this.cogeScelto();
    if (!c) return false;
    return (this.buPerCoge()[c.id] ?? []).filter(b => b !== BU_FALLBACK).length !== 1;
  });

  readonly nomeRamo = computed(() => {
    const id = this.buScelta();
    return id == null ? null : this.bu().find(b => b.id === id)?.nome ?? null;
  });

  readonly puoConfermare = computed(() =>
    !this.salvando() && !!this.cogeScelto() && this.buScelta() != null);

  ngOnInit(): void { this.ricarica(); }

  ricarica(): void {
    this.loading.set(true);
    this.caricamentoFallito.set(false);
    forkJoin({
      // ponytail: si legge la lista intera (cap 2000 lato server) perché il raggruppamento
      // ha senso solo sul totale. ~190 righe ≈ 250ms, una volta al mese.
      righe: this.movimenti.getTransitori(undefined, 0, 2000),
      coge: this.lookup.getPianoConti(),
      bu: this.buService.getAll(),
      buPerCoge: this.movimenti.getBuPerCoge(),
    }).subscribe({
      next: ({ righe, coge, bu, buPerCoge }) => {
        this.coge.set(coge);
        this.bu.set(bu);
        this.buPerCoge.set(buPerCoge ?? {});
        this.gruppi.set(this.raggruppa(righe.content));
        this.indice.set(0);
        this.rimandate.set(0);
        this.azzeraScelta();
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.caricamentoFallito.set(true); },
    });
  }

  /**
   * Un gruppo per chiave (calcolata dal server), i più numerosi per primi: chiudere prima i
   * gruppi grossi è ciò che fa scendere il contatore in fretta.
   */
  private raggruppa(righe: TransitorioDTO[]): Gruppo[] {
    const per = new Map<string, TransitorioDTO[]>();
    for (const r of righe) {
      // gruppo null = riga da decidere DA SOLA (incassi POS, effetti/RiBa, causali generiche):
      // sono giornate, importi e fornitori diversi, e una risposta sola non andrebbe bene per
      // tutte. La chiave diventa l'id: un gruppo di uno.
      const k = r.gruppo ?? r.id;
      const lista = per.get(k);
      if (lista) lista.push(r); else per.set(k, [r]);
    }
    return [...per.entries()]
      .map(([chiave, righe]) => ({ chiave, righe }))
      .sort((a, b) => b.righe.length - a.righe.length);
  }

  etichetta(g: Gruppo): string {
    const r = g.righe[0];
    if (r.controparteEstratta?.trim()) return r.controparteEstratta.trim();
    if (r.circuitoPos) return `Incasso con carta · ${r.circuitoPos}`;
    return 'Movimento senza intestatario';
  }

  conto(r: TransitorioDTO): string {
    const n = this.nomeConto(r);
    return n === '—' ? '' : `, sul conto ${n}`;
  }

  nomeConto(r: TransitorioDTO): string {
    return r.contoBancarioId === 1 ? 'BPM'
      : r.contoBancarioId === 2 ? 'Crédit Agricole'
      : r.contoBancarioId === 3 ? 'Cassa' : '—';
  }

  suggerito(g: Gruppo): PianoContiCogeDTO | null {
    const id = g.righe[0].cogeSuggeritoId;
    return id == null ? null : this.coge().find(c => c.id === id) ?? null;
  }

  scegli(c: PianoContiCogeDTO | null): void {
    this.cogeScelto.set(c);
    // Ramo pre-scelto quando la storia è univoca: resta un mezzo-passo, non una domanda.
    const rami = c ? (this.buPerCoge()[c.id] ?? []).filter(b => b !== BU_FALLBACK) : [];
    this.buScelta.set(rami.length === 1 ? rami[0] : null);
  }

  insiemeToggle(id: string, checked: boolean): void {
    this.insieme.update(m => ({ ...m, [id]: checked }));
  }

  annullaScelta(): void { this.azzeraScelta(); }

  /** «Non lo so»: la riga resta dov'è, si passa alla prossima. Nessuna chiamata al server. */
  rimanda(): void {
    this.rimandate.update(n => n + 1);
    this.avanti();
  }

  conferma(): void {
    const c = this.cogeScelto();
    const bu = this.buScelta();
    const righe = this.righeScelte();
    if (!c || bu == null || !righe.length) return;

    this.salvando.set(true);
    // ponytail: N chiamate in parallelo, non un endpoint bulk. Una fallita non annulla le altre —
    // la coda si ricarica dal server e mostra quel che resta davvero (SPEC, edge case).
    forkJoin(righe.map(r => this.movimenti.classificaTransitorio(r.id, {
      cogeId: c.id, businessUnitId: bu, fornitoreId: r.fornitoreId,
      // Si impara solo da righe con un intestatario vero: da «EFFETTI RITIRATI» o da una
      // causale POS nascerebbe una firma spuria che dirotta tutte le righe simili future.
      apprendiKeyword: !!r.controparteEstratta,
      nota: null,
    }))).subscribe({
      next: () => {
        this.salvando.set(false);
        this.pushRecent(c.id);
        // Escono SOLO le righe scritte: una gemella deselezionata è ancora da sistemare e deve
        // restare visibile, non sparire con il resto del gruppo.
        const scritte = new Set(righe.map(r => r.id));
        this.gruppi.update(gs => gs
          .map((g, i) => i !== this.indice() ? g
            : { ...g, righe: g.righe.filter(r => !scritte.has(r.id)) })
          .filter(g => g.righe.length > 0));
        if (this.indice() >= this.gruppi().length) this.indice.set(0);
        this.azzeraScelta();
        this.counts.reload();
        this.snackBar.open(
          righe.length === 1 ? 'Spesa sistemata' : righe.length + ' spese sistemate insieme',
          'OK', { duration: 2500 });
      },
      error: err => {
        this.salvando.set(false);
        const msg = err?.error?.message ?? 'Non è stato possibile sistemare questa spesa';
        this.snackBar.open(msg + ' — ricarico la coda per mostrarti cosa resta', 'OK', { duration: 8000 });
        this.ricarica();
      },
    });
  }

  private avanti(): void {
    this.azzeraScelta();
    this.indice.update(i => (i + 1) % Math.max(1, this.gruppi().length));
  }

  private azzeraScelta(): void {
    this.cogeScelto.set(null);
    this.buScelta.set(null);
    this.insieme.set({});
  }

  private recents(): number[] {
    try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch { return []; }
  }

  private pushRecent(id: number): void {
    const next = [id, ...this.recents().filter(x => x !== id)].slice(0, 8);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }
}
