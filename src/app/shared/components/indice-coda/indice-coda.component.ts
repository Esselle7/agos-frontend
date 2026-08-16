import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** Dove sta una voce nel lavoro: da fare, messa in sospeso, oppure già chiusa. */
export type StatoVoce = 'da-fare' | 'rimandata' | 'fatta';

/**
 * Una riga dell'indice, già pronta da mostrare.
 *
 * <p>È di proposito un <b>view-model</b>, non un DTO: le tre code di smistamento hanno forme di
 * dato diverse (una riga bancaria parcheggiata, una rata, un gruppo di spese dello stesso
 * esercente), ma la navigazione è la stessa. Ogni wizard traduce i suoi dati in queste quattro
 * proprietà, così l'indice non deve sapere niente di nessuna delle tre.
 */
export interface VoceCoda {
  id: string;
  titolo: string;
  /** La riga sotto il titolo: importo, data, e ciò che serve a riconoscere la voce. */
  dettaglio: string;
  stato: StatoVoce;
}

/**
 * Indice scorribile di una coda di smistamento: si vede sempre, e si salta a qualsiasi voce.
 *
 * <p>Nasce il 14/08/2026 su richiesta del titolare, con parole sue: senza la lista «non riesco a
 * passare da uno all'altro in modo dinamico, devo ogni volta ripartire dall'inizio e scorrerli
 * tutti». I wizard restano uno-alla-volta nel <b>decidere</b>; cambia solo il <b>navigare</b>.
 *
 * <p>Il contratto è volutamente stretto — tre input, tutti obbligatori, e un output — perché
 * un indice con mezza dozzina di input opzionali sarebbe più difficile da leggere dei tre
 * pannelli che sostituisce.
 *
 * <p>Si identifica la voce per <b>id</b> e non per posizione: le voci già chiuse restano in lista
 * in fondo, quindi la posizione nell'indice non coincide con quella nella coda del wizard.
 */
@Component({
  selector: 'agos-indice-coda',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <nav class="idx" [attr.aria-label]="'Elenco: ' + titolo()">
      <p class="idx__tit">{{ titolo() }}</p>
      <ol class="idx__lista">
        @for (v of voci(); track v.id; let i = $index) {
          <li>
            @if (v.stato === 'fatta') {
              <span class="idx__voce idx__voce--fatta">
                <mat-icon class="idx__fatta">check</mat-icon>
                <span class="idx__txt">
                  <b>{{ v.titolo }}</b>
                  <small>{{ v.dettaglio }} · fatta</small>
                </span>
              </span>
            } @else {
              <button type="button" class="idx__voce"
                      [class.idx__voce--ora]="v.id === correnteId()"
                      [class.idx__voce--sosp]="v.stato === 'rimandata'"
                      [attr.aria-current]="v.id === correnteId() ? 'true' : null"
                      (click)="vai.emit(v.id)">
                <span class="idx__num">{{ i + 1 }}</span>
                <span class="idx__txt">
                  <b>{{ v.titolo }}</b>
                  <small>
                    {{ v.dettaglio }}@if (v.stato === 'rimandata') { · in sospeso }
                  </small>
                </span>
              </button>
            }
          </li>
        }
      </ol>
    </nav>
  `,
  styles: [`
    /* L'indice non cresce mai oltre mezzo schermo: con una coda lunga una lista intera
       spingerebbe fuori vista la riga su cui si sta lavorando. */
    .idx { min-width: 0; }
    .idx__tit { margin: 0 0 8px; font-size: .8rem; font-weight: 650;
      text-transform: uppercase; letter-spacing: .04em; color: var(--text-sub); }
    .idx__lista { list-style: none; margin: 0; padding: 6px; display: flex;
      flex-direction: column; gap: 4px; max-height: min(52vh, 440px); overflow-y: auto;
      border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--card); }

    .idx__voce { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
      padding: 8px 10px; min-height: 44px; border: 1px solid transparent;
      border-radius: var(--radius-sm); background: transparent; font: inherit;
      color: var(--text-main); cursor: pointer;
      transition: background var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease); }
    .idx__voce:hover { background: var(--tint-primary); }
    .idx__voce:focus-visible { outline: 2px solid var(--primary); outline-offset: -1px; }
    .idx__voce--ora { border-color: var(--primary); background: var(--tint-primary-strong); }
    /* Lo stato non è affidato al solo colore: «in sospeso» e «fatta» sono scritti in chiaro. */
    .idx__voce--sosp .idx__num { background: var(--warning); color: var(--on-accent); }
    .idx__voce--fatta { cursor: default; opacity: .55; }
    .idx__voce--fatta:hover { background: transparent; }
    .idx__fatta { color: var(--success); font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }

    .idx__num { flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
      display: grid; place-items: center; background: var(--surface-2);
      font-size: .74rem; font-weight: 650; font-variant-numeric: tabular-nums; }
    .idx__voce--ora .idx__num { background: var(--primary); color: var(--on-accent); }
    .idx__txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .idx__txt b { font-size: .84rem; font-weight: 600; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; }
    .idx__txt small { font-size: .74rem; color: var(--text-sub); }

    @media (prefers-reduced-motion: reduce) { .idx__voce { transition: none; } }
  `],
})
export class IndiceCodaComponent {
  readonly voci = input.required<VoceCoda[]>();
  /** Id della voce in lavorazione, o `null` quando la coda è finita. */
  readonly correnteId = input.required<string | null>();
  readonly titolo = input.required<string>();

  /** Id della voce su cui saltare. Il wizard decide cosa farne. */
  readonly vai = output<string>();
}
