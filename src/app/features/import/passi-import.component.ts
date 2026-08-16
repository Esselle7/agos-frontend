import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { FaseImportDTO } from '../../core/models/movimenti.models';

/** Un passo a schermo: quello che il server sta facendo, o ha fatto e quanto ci ha messo. */
interface Passo {
  numero: number;
  nome: string;
  /** Il numero prodotto dal passo. null finché il server non l'ha detto: non si inventa. */
  dettaglio: string | null;
  millis: number | null;
}

/**
 * «Che cosa sta facendo il sistema» durante e dopo l'import congiunto.
 *
 * <p><b>Il patto con chi guarda: nessun passo finto.</b> I nomi dei passi sono quelli che
 * `MovimentoImportService.importCongiunto` esegue davvero, nell'ordine in cui li esegue; il numero
 * e la durata accanto a ciascuno arrivano dal server (`FaseImportDTO`), <b>misurati</b>. Finché la
 * risposta non c'è, i passi si mostrano tutti come «in corso» — non ce n'è uno acceso a turno,
 * perché da qui non si può sapere quale sia, e fingerlo sarebbe una barra a tempo travestita.
 * L'unica cosa che si muove durante l'attesa è il cronometro, che è vero.
 *
 * <p><b>Perché non SSE.</b> Misurato il 13/08/2026 sull'import reale di luglio: l'elaborazione
 * server dura <b>94 ms</b> su 185 righe (~1,3 s end-to-end in produzione, dominati da upload e
 * commit). Un canale di streaming per 94 ms sarebbe un trasporto nuovo che non ripaga: i passi
 * arrivano con la risposta e si mostrano appena arrivano.
 *
 * <p>Stesso vocabolario visivo della barra di fase (`fasi-bar.component.ts`): dischi numerati,
 * righe bordate, cifre tabellari. Le due cose sono parenti — l'import e lo smistamento — e devono
 * sembrarlo.
 */
@Component({
  selector: 'app-passi-import',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <section class="passi" [class.passi--fatto]="!inCorso()">
      <header class="passi__testa">
        <h3 class="passi__titolo">
          {{ inCorso() ? 'Sto elaborando i tre file' : 'Elaborazione completata' }}
        </h3>
        <span class="passi__tempo" [attr.aria-label]="inCorso() ? 'tempo trascorso' : 'tempo di elaborazione'">
          {{ inCorso() ? secondi(trascorsoMs()) : millisecondi(totaleMs()) }}
        </span>
      </header>

      <ol class="passi__lista" aria-live="polite">
        @for (p of passi(); track p.numero; let i = $index) {
          <li class="passo" [class.passo--fatto]="p.millis !== null"
              [style.--ritardo]="(i * 60) + 'ms'">
            <span class="passo__n" aria-hidden="true">
              @if (p.millis !== null) { <mat-icon>check</mat-icon> } @else { {{ p.numero }} }
            </span>
            <span class="passo__txt">
              <span class="passo__nome">{{ p.nome }}</span>
              <span class="passo__dett">
                {{ p.dettaglio ?? 'in corso…' }}
              </span>
            </span>
            @if (p.millis !== null) {
              <span class="passo__ms">{{ millisecondi(p.millis) }}</span>
            }
          </li>
        }
      </ol>
    </section>
  `,
  styles: [`
    .passi { border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--card); padding: 14px 16px 12px; }

    .passi__testa { display: flex; align-items: baseline; justify-content: space-between;
      gap: 12px; margin-bottom: 10px; }
    .passi__titolo { margin: 0; font-size: .95rem; font-weight: 650; color: var(--text-main); }
    .passi__tempo { font-size: .9rem; font-weight: 650; color: var(--primary);
      font-variant-numeric: tabular-nums; }
    .passi--fatto .passi__tempo { color: var(--success); }

    .passi__lista { margin: 0; padding: 0; list-style: none;
      display: flex; flex-direction: column; gap: 6px; }

    .passo { display: flex; align-items: center; gap: 10px; min-height: 46px;
      padding: 7px 11px; border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--card);
      transition: border-color var(--t-base) var(--ease), background var(--t-base) var(--ease); }
    .passo--fatto { border-color: var(--primary-l); background: var(--tint-primary);
      animation: passo-in var(--t-base) var(--ease) both; animation-delay: var(--ritardo); }

    @keyframes passo-in {
      from { opacity: .45; transform: translateY(4px); }
      to   { opacity: 1;   transform: none; }
    }

    .passo__n { flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
      display: grid; place-items: center; background: var(--surface-2);
      font-size: .78rem; font-weight: 650; color: var(--text-main); }
    .passo--fatto .passo__n { background: var(--primary); color: var(--on-accent); }
    .passo__n mat-icon { font-size: 15px; width: 15px; height: 15px; }

    /* Il "sta lavorando": un respiro sul disco, non una barra che finge di avanzare. */
    .passo:not(.passo--fatto) .passo__n { animation: respiro 1.4s ease-in-out infinite; }
    @keyframes respiro { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }

    .passo__txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
    .passo__nome { font-size: .86rem; font-weight: 600; color: var(--text-main); }
    /* --text-sub è ammesso qui: è testo di dettaglio su fondo card, non testo corrente su
       fondo tinto (PRODUCT.md, accessibilità). */
    .passo__dett { font-size: .78rem; color: var(--text-sub); font-variant-numeric: tabular-nums; }

    .passo__ms { flex-shrink: 0; font-size: .78rem; font-weight: 650; color: var(--primary-d);
      font-variant-numeric: tabular-nums; }

    @media (max-width: 560px) {
      .passo { align-items: flex-start; }
      .passo__ms { align-self: center; }
    }

    @media (prefers-reduced-motion: reduce) {
      .passo, .passo--fatto { transition: none; animation: none; }
      .passo:not(.passo--fatto) .passo__n { animation: none; opacity: .7; }
    }
  `],
})
export class PassiImportComponent {
  private readonly destroyRef = inject(DestroyRef);

  /** true mentre la POST è in volo. */
  readonly inCorso = input.required<boolean>();
  /** I passi misurati dal server. Vuoto finché la risposta non arriva. */
  readonly fasi = input<FaseImportDTO[]>([]);

  /** I nomi noti dei passi, per poterli mostrare PRIMA che il server risponda. Restano
   *  allineati a `importCongiunto`: il test backend fallisce se l'ordine reale cambia. */
  private static readonly ATTESI = [
    'Lettura dei tre file',
    'Riconciliazione degli incassi POS',
    'Classificazione e scrittura',
    'Quadratura dell\'estratto conto',
  ];

  private readonly avvio = signal<number | null>(null);
  private readonly ora = signal(Date.now());

  readonly trascorsoMs = computed(() => {
    const a = this.avvio();
    return a === null ? 0 : Math.max(0, this.ora() - a);
  });

  readonly totaleMs = computed(() => this.fasi().reduce((s, f) => s + f.millis, 0));

  readonly passi = computed<Passo[]>(() => {
    const f = this.fasi();
    if (f.length) {
      return f.map((x, i) => ({ numero: i + 1, nome: x.nome, dettaglio: x.dettaglio, millis: x.millis }));
    }
    return PassiImportComponent.ATTESI.map((nome, i) => ({
      numero: i + 1, nome, dettaglio: null, millis: null,
    }));
  });

  constructor() {
    // Il cronometro parte quando parte l'import e si ferma quando smette: è tempo vero, non
    // un'animazione. Un solo interval, spento alla distruzione del componente.
    let tick: ReturnType<typeof setInterval> | null = null;
    effect(() => {
      const attivo = this.inCorso();
      if (attivo && tick === null) {
        this.avvio.set(Date.now());
        this.ora.set(Date.now());
        tick = setInterval(() => this.ora.set(Date.now()), 100);
      } else if (!attivo && tick !== null) {
        clearInterval(tick);
        tick = null;
      }
    });
    this.destroyRef.onDestroy(() => { if (tick !== null) clearInterval(tick); });
  }

  secondi(ms: number): string {
    return (ms / 1000).toFixed(1).replace('.', ',') + ' s';
  }

  millisecondi(ms: number): string {
    return ms >= 1000 ? this.secondi(ms) : ms + ' ms';
  }
}
