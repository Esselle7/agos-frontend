import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ContatoreImportDTO } from '../../core/models/movimenti.models';

/**
 * Il contatore dell'import (SPEC import-v2 §6.1, R20): la fascia che non sparisce mai.
 *
 * <p>È il messaggio principale della pagina, non un KPI decorativo: è l'oracolo contro cui il
 * titolare verifica l'estratto conto. Numeri grandi, etichette piccole, <b>due colonne
 * entrata/uscita</b> — perché un totale netto nasconde esattamente la cosa che si sta controllando.
 *
 * <p>Fuori scopo dichiarato (§8): saldi conti e P&L non si toccano da qui.
 */
@Component({
  selector: 'app-contatore-import',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, MatIconModule],
  template: `
    @if (dati(); as c) {
      <section class="cnt" aria-labelledby="cnt-titolo">
        <div class="cnt__riga">
          <div class="cnt__lette">
            <h2 id="cnt-titolo">Estratto dalle banche</h2>
            @if (c.universoMisurato) {
              <p>
                <span class="cnt__e">+{{ c.lette.entrate | currency:'EUR' }}</span>
                <span class="cnt__u">−{{ c.lette.uscite | currency:'EUR' }}</span>
                <span class="cnt__righe">{{ c.lette.righe }} righe</span>
              </p>
            } @else {
              <p class="cnt__righe">totale non misurato per questo import</p>
            }
          </div>

          <dl class="cnt__buckets">
            @for (b of buckets(); track b.chiave) {
              @if (b.righe > 0 || !b.nascondiSeVuoto) {
                <div class="cnt__b" [class]="'cnt__b--' + b.chiave">
                  <dt>{{ b.etichetta }}</dt>
                  <dd>
                    <b>{{ b.righe }}</b>
                    <span class="cnt__b-euro">{{ b.entrate + b.uscite | currency:'EUR' }}</span>
                  </dd>
                </div>
              }
            }
          </dl>

          @if (c.universoMisurato) {
            <p class="cnt__pct" [attr.aria-label]="pct() + ' per cento delle righe collocate'">
              <b>{{ pct() }}%</b><span>collocate</span>
            </p>
          }
        </div>

        @if (c.universoMisurato) {
          <div class="cnt__barra" role="presentation">
            <span class="cnt__barra-fill" [style.width.%]="pct()"></span>
          </div>
        }

        @if (!c.universoMisurato) {
          <p class="cnt__nota">
            <mat-icon aria-hidden="true">info</mat-icon>
            <span>Import caricato prima che il totale delle righe di banca venisse misurato: qui
              vedi dove sono finite le righe, ma non il confronto con l'estratto conto.</span>
          </p>
        } @else if (!c.quadra) {
          <p class="cnt__buco" role="alert">
            <mat-icon aria-hidden="true">error</mat-icon>
            <span>Non torna: {{ c.scartoEntrate | currency:'EUR' }} in entrata e
              {{ c.scartoUscite | currency:'EUR' }} in uscita non hanno una casa.</span>
          </p>
        }
      </section>
    }
  `,
  styles: [`
    /* La banda che non sparisce mai (§6.1). Deve stare in una riga sola su desktop: è l'oracolo
       che si consulta di sfuggita mentre si lavora, non una dashboard da leggere. Tutto ciò che
       non serve a colpo d'occhio — il dettaglio entrate/uscite per bucket, le voci fuori
       universo — è nella schermata «Fatto», dove c'è il tempo di leggerlo. */
    .cnt { background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius-md); padding: 10px 16px; display: flex;
      flex-direction: column; gap: 8px; }

    .cnt__riga { display: flex; align-items: center; gap: 12px 28px; flex-wrap: wrap; }

    .cnt__lette h2 { margin: 0; font-size: .66rem; font-weight: 700; letter-spacing: .07em;
      text-transform: uppercase; color: var(--text-sub); }
    .cnt__lette p { margin: 1px 0 0; display: flex; align-items: baseline; gap: 10px;
      flex-wrap: wrap; font-size: 1.05rem; font-weight: 700; letter-spacing: -.01em;
      font-variant-numeric: tabular-nums; }
    .cnt__righe { font-size: .76rem; font-weight: 500; color: var(--text-sub); }

    .cnt__e { color: var(--success); }
    .cnt__u { color: var(--text-main); }

    .cnt__buckets { margin: 0 0 0 auto; display: flex; align-items: stretch; gap: 8px 18px;
      flex-wrap: wrap; }
    .cnt__b { display: flex; flex-direction: column; gap: 0; padding-left: 9px;
      border-left: 3px solid var(--border); }
    .cnt__b--aLibro        { border-left-color: var(--success); }
    .cnt__b--daCatalogare  { border-left-color: var(--warning); }
    .cnt__b--fuoriDaiConti { border-left-color: var(--danger); }
    .cnt__b--esclusi, .cnt__b--duplicate { border-left-color: var(--text-faint); }
    .cnt__b--partiteDiGiro { border-left-color: var(--info); }

    .cnt__b dt { font-size: .68rem; color: var(--text-sub); white-space: nowrap; }
    .cnt__b dd { margin: 0; display: flex; align-items: baseline; gap: 7px; white-space: nowrap; }
    .cnt__b dd b { font-size: 1.05rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .cnt__b-euro { font-size: .72rem; color: var(--text-sub); font-variant-numeric: tabular-nums; }

    .cnt__pct { margin: 0; display: flex; flex-direction: column; align-items: flex-end;
      line-height: 1.05; }
    .cnt__pct b { font-size: 1.15rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .cnt__pct span { font-size: .66rem; text-transform: uppercase; letter-spacing: .05em;
      color: var(--text-sub); }

    .cnt__barra { height: 3px; border-radius: 2px; background: var(--surface-2); overflow: hidden; }
    .cnt__barra-fill { display: block; height: 100%; background: var(--success);
      transition: width var(--t-base) var(--ease); }

    .cnt__buco, .cnt__nota { margin: 0; display: flex; align-items: flex-start; gap: 7px;
      padding: 7px 10px; border-radius: var(--radius-sm); color: var(--text-main);
      font-size: .82rem; line-height: 1.45; }
    .cnt__buco { background: var(--tint-danger); }
    .cnt__nota { background: var(--surface-sunken); }
    .cnt__buco mat-icon, .cnt__nota mat-icon { font-size: 17px; width: 17px; height: 17px;
      flex-shrink: 0; margin-top: 1px; }
    .cnt__buco mat-icon { color: var(--danger); }
    .cnt__nota mat-icon { color: var(--info); }

    @media (max-width: 900px) {
      .cnt__buckets { margin-left: 0; }
    }
    @media (prefers-reduced-motion: reduce) { .cnt__barra-fill { transition: none; } }
  `],
})
export class ContatoreImportComponent {
  readonly dati = input<ContatoreImportDTO | null>(null);

  /** Quanto è collocato: a libro + escluso di proposito + duplicate + partite di giro. */
  readonly pct = computed(() => {
    const c = this.dati();
    if (!c || !c.lette.righe) return 0;
    const chiuse = c.aLibro.righe + c.esclusi.righe + c.duplicate.righe + c.partiteDiGiro.righe;
    return Math.round((chiuse * 100) / c.lette.righe);
  });

  readonly buckets = computed(() => {
    const c = this.dati();
    if (!c) return [];
    return [
      { chiave: 'aLibro',        etichetta: 'già a libro',          ...c.aLibro,        nascondiSeVuoto: false },
      { chiave: 'daCatalogare',  etichetta: 'da catalogare',        ...c.daCatalogare,  nascondiSeVuoto: false },
      { chiave: 'fuoriDaiConti', etichetta: 'fuori dai conti',      ...c.fuoriDaiConti, nascondiSeVuoto: true },
      { chiave: 'esclusi',       etichetta: 'escluso di proposito', ...c.esclusi,       nascondiSeVuoto: true },
      { chiave: 'duplicate',     etichetta: 'duplicate',            ...c.duplicate,     nascondiSeVuoto: true },
      { chiave: 'partiteDiGiro', etichetta: 'partite di giro',      ...c.partiteDiGiro, nascondiSeVuoto: true },
    ];
  });
}
