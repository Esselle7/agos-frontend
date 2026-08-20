import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ImportCountsService } from './import-counts.service';

/** Una fase del lavoro: ordine FISSO, così si sa sempre cosa viene dopo. */
interface Fase {
  label: string;
  link: string;
  /** Quante righe restano. `null` = non ancora misurato: si dice, non si finge «fatta». */
  restanti: () => number | null;
  /** Voce nascosta finché la coda è vuota (audit §7.7): la logica resta, sparisce solo il link. */
  soloSePiena?: boolean;
  /** Denaro FUORI dai conti, non lavoro d'ufficio: si segnala in rosso (audit §7.4 regola 2). */
  rosso?: boolean;
}

/**
 * Barra di fase (SPEC import-v2 §6.2, R19): dove sei e cosa ti aspetta.
 *
 * <p>Le fasi sono in ordine fisso e le successive restano <b>leggibili</b>, non sbiadite: sapere
 * cosa arriva dopo è metà del controllo. Ogni fase porta il proprio conteggio; il «riga N di M»
 * sta dentro la fase, non qui — due livelli di progresso, gerarchia netta.
 *
 * <p><b>Qui c'è TUTTO lo smistamento</b> (13/08/2026). Fino a questa data «Duplicati» e «Già a
 * libro» vivevano solo nel rail di sinistra, che è stato tolto: due menu per lo stesso lavoro
 * significavano due elenchi da tenere allineati a mano, e infatti erano diversi. Il rail resta
 * per gli strumenti (Importa · Registro · Storico), questa barra è il lavoro.
 *
 * <p><b>Il numero si scrive solo se è stato misurato.</b> «Duplicati» non entra nel badge — la sua
 * analisi è O(n²) e costa ~700ms — quindi qui compare come «da controllare» finché non si apre la
 * sezione: una spunta verde su un conteggio mai calcolato sarebbe una bugia con l'aria di una
 * conferma.
 */
@Component({
  selector: 'app-fasi-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, MatIconModule],
  template: `
    <nav class="fasi" aria-label="Fasi dello smistamento">
      <ol>
        @for (f of fasiVisibili(); track f.link; let i = $index) {
          <li>
            <a class="fasi__f" [routerLink]="f.link" routerLinkActive="fasi__f--ora"
               #rla="routerLinkActive" [attr.aria-current]="rla.isActive ? 'step' : null">
              <span class="fasi__n" aria-hidden="true">{{ i + 1 }}</span>
              <span class="fasi__txt">
                <span class="fasi__label">{{ f.label }}</span>
                <span class="fasi__conta" [class.fasi__conta--rosso]="f.rosso && (f.restanti() ?? 0) > 0">
                  @if (f.restanti(); as n) {
                    {{ n }} {{ n === 1 ? 'riga' : 'righe' }}
                  } @else if (f.restanti() === null) {
                    da controllare
                  } @else {
                    <mat-icon aria-hidden="true">check</mat-icon> fatta
                  }
                </span>
              </span>
            </a>
          </li>
        }
      </ol>
    </nav>
  `,
  styles: [`
    .fasi ol { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px; }
    .fasi li { flex: 1 1 150px; min-width: 0; }

    .fasi__f { display: flex; align-items: center; gap: 9px; padding: 7px 11px;
      border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card);
      text-decoration: none; color: var(--text-main); min-height: 46px;
      transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease); }
    .fasi__f:hover { border-color: var(--primary-l); background: var(--tint-primary); }
    .fasi__f:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .fasi__f--ora { border-color: var(--primary); background: var(--tint-primary-strong);
      box-shadow: inset 0 0 0 1px var(--primary); }

    .fasi__n { flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
      display: grid; place-items: center; background: var(--surface-2);
      font-size: .78rem; font-weight: 650; color: var(--text-main); }
    .fasi__f--ora .fasi__n { background: var(--primary); color: var(--on-accent); }

    .fasi__txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .fasi__label { font-size: .86rem; font-weight: 600; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; }
    .fasi__conta { display: flex; align-items: center; gap: 3px; font-size: .76rem;
      color: var(--text-sub); font-variant-numeric: tabular-nums; }
    .fasi__conta mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--success); }
    /* Il colore è il secondo segnale, mai il primo: la parola «fuori dai conti» sta nell'etichetta
       e resta leggibile anche senza percepire il rosso (R22). */
    .fasi__conta--rosso { color: var(--danger); font-weight: 650; }

    @media (prefers-reduced-motion: reduce) { .fasi__f { transition: none; } }
  `],
})
export class FasiBarComponent {
  private readonly counts = inject(ImportCountsService);

  private readonly c = this.counts.counts;

  private readonly fasi: Fase[] = [
    { label: 'Spese e ricavi',  link: 'catalogare',     restanti: () => this.c().catalogare },
    { label: 'Incassi evento',  link: 'incassi-evento', restanti: () => this.c().eventi },
    { label: 'Rate',            link: 'rate',           restanti: () => this.c().ricorrenti },
    // «Già a libro»: la coda è quasi sempre vuota (0 DA_LIQUIDARE nel corpus) — la voce compare
    // solo quando ha davvero del lavoro dentro, così le fasi fisse restano cinque.
    { label: 'Già a libro',     link: 'smistamento/matching-differiti',
      restanti: () => this.c().matchingDifferiti, soloSePiena: true },
    { label: 'Fuori dai conti', link: 'scartati',       restanti: () => this.c().scartati, rosso: true },
    // «Da rileggere»: righe che l'import non ha saputo interpretare. Compare solo quando ce n'è
    // davvero (di norma è vuota) e porta allo Storico import, dove si ri-processano in blocco.
    { label: 'Da rileggere',    link: 'storico',        restanti: () => this.c().daRileggere,
      soloSePiena: true, rosso: true },
    { label: 'Duplicati',       link: 'smistamento/duplicati', restanti: () => this.c().duplicati },
    { label: 'Fatto',           link: 'fatto',          restanti: () => this.restaLavoro() },
  ];

  readonly fasiVisibili = computed(() =>
    this.fasi.filter(f => !f.soloSePiena || (f.restanti() ?? 0) > 0));

  /**
   * Quanto lavoro resta in tutto. I duplicati non ancora misurati NON contano come zero: se non
   * sai quanti sono, «Fatto» non può dichiarare che non ne resta nessuno.
   */
  readonly restaLavoro = computed(() => {
    const c = this.c();
    const somma = c.catalogare + c.daRileggere + c.eventi + c.ricorrenti + c.matchingDifferiti + c.scartati;
    return c.duplicati === null ? (somma > 0 ? somma : null) : somma + c.duplicati;
  });
}
