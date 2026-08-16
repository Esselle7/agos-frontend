import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ImportCountsService } from './import-counts.service';

/**
 * Schermata di chiusura (SPEC import-v2 R23): quando non resta nulla, «N righe lette, N collocate»,
 * la somma per bucket e il confronto con l'estratto conto.
 *
 * <p>È il momento in cui il mese si dichiara chiuso <b>con un numero</b>. Se invece resta lavoro,
 * questa pagina non finge: dice quanto manca e dove, senza spuntare nulla.
 */
@Component({
  selector: 'app-chiusura-import',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, RouterLink, MatIconModule, MatButtonModule],
  template: `
    <div class="fin">
      @if (contatore(); as c) {
        @if (resta() === 0) {
          <header class="fin__ok">
            <mat-icon aria-hidden="true">verified</mat-icon>
            <h2>{{ c.lette.righe }} righe lette, {{ c.lette.righe }} collocate</h2>
            <p>Ogni riga dei due estratti conto ha una casa. Il mese si può dichiarare chiuso.</p>
          </header>
        } @else {
          <header class="fin__manca">
            <mat-icon aria-hidden="true">pending_actions</mat-icon>
            <h2>{{ c.lette.righe }} righe lette, {{ collocate(c) }} collocate</h2>
            <p>Mancano <b>{{ resta() }}</b> decisioni. Finché restano, il mese non è chiuso:
              quel denaro è in banca ma non si sa ancora che cos'è.</p>
            <div class="fin__vai">
              @if (c.daCatalogare.righe) { <a mat-stroked-button routerLink="../catalogare">Spese e ricavi</a> }
              @if (c.fuoriDaiConti.righe) { <a mat-stroked-button routerLink="../scartati">Fuori dai conti</a> }
            </div>
          </header>
        }

        <section class="fin__quadro" aria-labelledby="fin-q">
          <h3 id="fin-q">Il confronto con l'estratto conto</h3>
          <table class="fin__tab">
            <caption class="sr-only">Righe lette dalle banche e loro collocazione, per direzione</caption>
            <thead>
              <tr><th scope="col">Bucket</th><th scope="col" class="num">Righe</th>
                  <th scope="col" class="num">Entrate</th><th scope="col" class="num">Uscite</th></tr>
            </thead>
            <tbody>
              <tr class="fin__tot">
                <th scope="row">Estratto dalle banche</th>
                <td class="num">{{ c.lette.righe }}</td>
                <td class="num">{{ c.lette.entrate | currency:'EUR' }}</td>
                <td class="num">{{ c.lette.uscite | currency:'EUR' }}</td>
              </tr>
              @for (b of dettaglio(c); track b.label) {
                @if (b.righe > 0) {
                  <tr>
                    <th scope="row">{{ b.label }}</th>
                    <td class="num">{{ b.righe }}</td>
                    <td class="num">{{ b.entrate | currency:'EUR' }}</td>
                    <td class="num">{{ b.uscite | currency:'EUR' }}</td>
                  </tr>
                }
              }
            </tbody>
          </table>

          @if (!c.universoMisurato) {
            <p class="fin__quadra">
              <mat-icon aria-hidden="true">info</mat-icon>
              Il confronto con l'estratto conto non c'è per questo import: è stato caricato prima
              che il totale delle righe di banca venisse misurato. Ricaricando gli stessi due file
              compare (i duplicati vengono riconosciuti).
            </p>
          } @else if (c.quadra) {
            <p class="fin__quadra">
              <mat-icon aria-hidden="true">check_circle</mat-icon>
              Le righe collocate tornano <b>al centesimo</b> con quelle lette, in entrata e in uscita.
            </p>
          } @else {
            <p class="fin__buco" role="alert">
              <mat-icon aria-hidden="true">error</mat-icon>
              Il conto non torna: {{ c.scartoEntrate | currency:'EUR' }} in entrata e
              {{ c.scartoUscite | currency:'EUR' }} in uscita non hanno una casa.
            </p>
          }

          @if (c.fuoriUniverso.length) {
            <div class="fin__fuori">
              <h4>Fuori da questo conteggio, dichiarati</h4>
              <ul>
                @for (v of c.fuoriUniverso; track v.etichetta) {
                  <li><b>{{ v.etichetta }}</b> — {{ v.righe }} righe, {{ v.importo | currency:'EUR' }}:
                    {{ v.perche }}</li>
                }
              </ul>
            </div>
          }
        </section>
      } @else {
        <p class="fin__nodata">Nessun import da chiudere: carica prima gli estratti conto.</p>
      }
    </div>
  `,
  styles: [`
    .fin { padding: 16px; display: flex; flex-direction: column; gap: 20px; max-width: 780px; }

    .fin__ok, .fin__manca { display: flex; flex-direction: column; align-items: center; gap: 8px;
      text-align: center; padding: 28px 20px; border-radius: var(--radius-md); }
    .fin__ok { background: var(--tint-success); }
    .fin__manca { background: var(--surface-sunken); }
    .fin__ok mat-icon, .fin__manca mat-icon { font-size: 42px; width: 42px; height: 42px; }
    .fin__ok mat-icon { color: var(--success); }
    .fin__manca mat-icon { color: var(--warning); }
    .fin__ok h2, .fin__manca h2 { margin: 0; font-size: 1.35rem; letter-spacing: -.01em; }
    .fin__ok p, .fin__manca p { margin: 0; max-width: 52ch; line-height: 1.55; color: var(--text-main); }
    .fin__vai { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }

    .fin__quadro h3 { margin: 0 0 10px; font-size: 1.02rem; }
    .fin__tab { width: 100%; border-collapse: collapse; font-size: .9rem; }
    .fin__tab th[scope="col"] { text-align: left; padding: 8px 10px; background: var(--surface-2);
      font-size: .72rem; letter-spacing: .05em; text-transform: uppercase; color: var(--text-sub); }
    .fin__tab th[scope="row"] { text-align: left; font-weight: 500; }
    .fin__tab td, .fin__tab th[scope="row"] { padding: 8px 10px;
      border-top: 1px solid var(--border-soft); }
    .fin__tot th, .fin__tot td { font-weight: 700; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

    .fin__quadra, .fin__buco { margin: 12px 0 0; display: flex; align-items: flex-start; gap: 8px;
      font-size: .9rem; line-height: 1.5; }
    .fin__quadra mat-icon { color: var(--success); }
    .fin__buco mat-icon { color: var(--danger); }
    .fin__quadra mat-icon, .fin__buco mat-icon { font-size: 19px; width: 19px; height: 19px;
      flex-shrink: 0; margin-top: 2px; }

    .fin__fuori { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-soft); }
    .fin__fuori h4 { margin: 0 0 6px; font-size: .84rem; color: var(--text-sub);
      text-transform: uppercase; letter-spacing: .05em; }
    .fin__fuori ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px;
      font-size: .85rem; line-height: 1.5; color: var(--text-main); }

    .fin__nodata { padding: 40px 16px; text-align: center; color: var(--text-sub); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  `],
})
export class ChiusuraImportComponent implements OnInit {
  private readonly counts = inject(ImportCountsService);

  readonly contatore = this.counts.contatore;

  readonly resta = computed(() => {
    const c = this.counts.counts();
    return c.catalogare + c.eventi + c.ricorrenti + c.scartati;
  });

  ngOnInit(): void { this.counts.reload(); }

  collocate(c: { lette: { righe: number } }): number {
    return c.lette.righe - this.resta();
  }

  dettaglio(c: NonNullable<ReturnType<ChiusuraImportComponent['contatore']>>) {
    return [
      { label: 'già a libro',          ...c.aLibro },
      { label: 'da catalogare',        ...c.daCatalogare },
      { label: 'fuori dai conti',      ...c.fuoriDaiConti },
      { label: 'escluso di proposito', ...c.esclusi },
      { label: 'partite di giro',      ...c.partiteDiGiro },
      { label: 'duplicate',            ...c.duplicate },
    ];
  }
}
