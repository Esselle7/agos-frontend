import { Component, OnInit, signal, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';

import { MovimentiService } from '../../core/services/movimenti.service';
import { QuadraturaPeriodoDTO } from '../../core/models/movimenti.models';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';

/**
 * Pannello di quadratura di periodo POS (PROMPT-RICONCILIAZIONE-PERIODO §5). Sostituisce la
 * vecchia vista "Incassi POS da ripartire" a scontrino: i ricavi POS nascono da Billy (verità),
 * qui si mostra SOLO il controllo di quadratura Σ Billy ↔ Σ POS banca scomposto per causa
 * (coda testa esclusa, coda fondo in attesa). È informativo: nessuna azione di
 * catalogazione — i ricavi sono già contabilizzati.
 */
@Component({
  selector: 'app-quadratura-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe, DatePipe,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTableModule, MatTooltipModule,
    HelpNoteComponent,
  ],
  template: `
    <div class="q">
      @if (loading()) {
        <div class="q__center"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (caricamentoFallito()) {
        <div class="q__empty">
          <mat-icon>cloud_off</mat-icon>
          <p>Non è stato possibile caricare la quadratura. I dati non sono stati toccati.</p>
          <button mat-stroked-button (click)="ricarica()">Riprova</button>
        </div>
      } @else if (!q()) {
        <div class="q__empty">
          <mat-icon>balance</mat-icon>
          <p>Nessuna quadratura disponibile. Esegui un import congiunto (Billy + BPM + CA).</p>
        </div>
      } @else {
        <agos-help-note tono="info" [collapsed]="true" titolo="A cosa serve questa pagina">
          <p>Gli incassi con carta (POS) arrivano in banca <strong>a gruppi e con qualche
            giorno di ritardo</strong>, mentre Billy registra ogni singola vendita. Qui si
            controlla solo che, nel periodo, il totale delle vendite Billy e il totale dei POS
            accreditati in banca <strong>tornino</strong>.</p>
          <p>È una verifica informativa: i ricavi sono già contabilizzati da Billy, qui non c'è
            nulla da catalogare. Piccole differenze fra Billy e banca sono normali e sono
            spiegate per causa più sotto.</p>
        </agos-help-note>

        <header class="q__head">
          <div>
            <h2>Quadratura di periodo {{ q()!.anno }}</h2>
            <p class="q__sub">
              Controllo informativo Σ Billy ↔ Σ POS banca. I ricavi sono già contabilizzati da Billy.
              @if (q()!.importDataOra) { · ultimo import {{ q()!.importDataOra | date:'dd/MM/yyyy' }} }
            </p>
          </div>
        </header>

        <!-- Scomposizione: Billy → contabilizzato; POS banca → core -->
        <div class="q__cols">
          <section class="q__card">
            <h3>Billy (verità ricavi)</h3>
            <div class="q__row"><span>Elettronico no-agriturismo</span><b>{{ q()!.billyElettronicoNonAgri | currency:'EUR' }}</b></div>
            <div class="q__row q__row--minus"><span>− coda fondo (in attesa accredito)</span><b>{{ q()!.codaFondo | currency:'EUR' }}</b></div>
            <div class="q__row q__row--tot"><span>= Contabilizzato</span><b>{{ q()!.billyContabilizzato | currency:'EUR' }}</b></div>
          </section>

          <section class="q__card">
            <h3>POS banca</h3>
            <div class="q__row"><span>Totale POS (BPM + CA)</span><b>{{ q()!.posBancaTotale | currency:'EUR' }}</b></div>
            <div class="q__row q__row--minus"><span>− coda testa (anno precedente)</span><b>{{ q()!.codaTesta | currency:'EUR' }}</b></div>
            <div class="q__row q__row--tot"><span>= Core periodo</span><b>{{ q()!.posBancaCore | currency:'EUR' }}</b></div>
          </section>
        </div>

        <!-- Ripartizione per conto: target Σ banca vs assegnato ai ricavi Billy -->
        <section class="q__card">
          <h3>Ripartizione ricavi sui conti <span class="q__hint">(proporzionale · attribuzione convenzionale)</span></h3>
          <table class="q__tbl">
            <thead><tr><th>Conto</th><th>Σ POS banca (target)</th><th>Assegnato</th><th>Δ</th></tr></thead>
            <tbody>
              <tr>
                <td>Banco BPM</td>
                <td>{{ q()!.sigmaBpm | currency:'EUR' }}</td>
                <td>{{ q()!.assegnatoBpm | currency:'EUR' }}</td>
                <td [class.q__delta]="true">{{ q()!.assegnatoBpm - q()!.sigmaBpm | currency:'EUR' }}</td>
              </tr>
              <tr>
                <td>Crédit Agricole</td>
                <td>{{ q()!.sigmaCa | currency:'EUR' }}</td>
                <td>{{ q()!.assegnatoCa | currency:'EUR' }}</td>
                <td [class.q__delta]="true">{{ q()!.assegnatoCa - q()!.sigmaCa | currency:'EUR' }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- Approssimazioni dichiarate del metodo (sempre mostrate, esplicite) -->
        @if (q()!.approssimazioni.length) {
          <section class="q__card q__card--appr">
            <h3><mat-icon class="q__appr-ico">info</mat-icon> Approssimazioni del metodo (da sapere)</h3>
            <ul>@for (a of q()!.approssimazioni; track a) { <li>{{ a }}</li> }</ul>
          </section>
        }

        <!-- Cause dello scarto Billy ↔ banca -->
        @if (q()!.note.length) {
          <section class="q__card q__card--note">
            <h3>Scomposizione del Δ — cause note</h3>
            <ul>@for (n of q()!.note; track n) { <li>{{ n }}</li> }</ul>
          </section>
        }

        <!-- Coda fondo: scontrini in attesa di accredito (non contabilizzati) -->
        @if (q()!.inAttesa.length) {
          <section class="q__card">
            <h3>In attesa di accredito <span class="q__hint">({{ q()!.inAttesa.length }}, contabilizzati al prossimo import)</span></h3>
            <table class="q__tbl">
              <thead><tr><th>Data vendita</th><th>Importo</th><th>Scontrino</th></tr></thead>
              <tbody>
                @for (a of q()!.inAttesa; track a.rif) {
                  <tr>
                    <td>{{ a.data | date:'dd/MM/yyyy' }}</td>
                    <td>{{ a.importo | currency:'EUR' }}</td>
                    <td class="q__rif">{{ a.rif }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }
      }
    </div>
  `,
  styles: [`
    .q { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
    .q__center, .q__empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px; color: var(--text-sub); }
    .q__empty mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: .4; }
    .q__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
    .q__head h2 { margin: 0; font-size: 1.25rem; }
    .q__sub { margin: 4px 0 0; color: var(--text-sub); font-size: .85rem; max-width: 60ch; }
    .q__cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .q__card { border: 1px solid var(--border-soft); border-radius: var(--radius-md); padding: 14px 16px; background: var(--card); }
    .q__card h3 { margin: 0 0 10px; font-size: .95rem; }
    .q__hint { font-weight: 400; color: var(--text-faint); font-size: .8rem; }
    .q__row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: .9rem; }
    .q__row--minus { color: var(--warning); }
    .q__row--tot { border-top: 1px solid var(--border-soft); margin-top: 4px; padding-top: 8px; font-size: 1rem; }
    .q__tbl { width: 100%; border-collapse: collapse; font-size: .88rem; }
    .q__tbl th { text-align: left; color: var(--text-sub); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--border-soft); }
    .q__tbl td { padding: 6px 8px; border-bottom: 1px solid var(--border-soft); }
    .q__delta { color: var(--text-sub); }
    .q__rif { font-family: monospace; font-size: .8rem; color: var(--text-sub); }
    .q__card--note ul { margin: 0; padding-left: 18px; color: var(--text-sub); font-size: .86rem; display: flex; flex-direction: column; gap: 4px; }
    .q__card--appr { background: var(--tint-warning); border-color: var(--warning); }
    .q__card--appr h3 { display: flex; align-items: center; gap: 6px; color: var(--warning); }
    .q__appr-ico { font-size: 18px; width: 18px; height: 18px; }
    .q__card--appr ul { margin: 0; padding-left: 18px; color: var(--text-sub); font-size: .86rem; display: flex; flex-direction: column; gap: 6px; }
  `],
})
export class QuadraturaPanelComponent implements OnInit {
  private readonly movimenti = inject(MovimentiService);

  readonly q = signal<QuadraturaPeriodoDTO | null>(null);
  readonly loading = signal(true);
  /**
   * Caricamento fallito, distinto da «quadratura assente». Senza questo terzo stato una
   * richiesta andata male diceva «Esegui un import congiunto», cioè mandava l'utente a rifare
   * un import per un errore di rete — e senza nemmeno un messaggio d'errore.
   */
  readonly caricamentoFallito = signal(false);

  ngOnInit(): void { this.ricarica(); }

  /** Ricarica da zero. È anche l'azione del bottone «Riprova» dello stato di errore. */
  ricarica(): void {
    this.loading.set(true);
    this.caricamentoFallito.set(false);
    this.movimenti.getQuadratura().subscribe({
      next: q => { this.q.set(q); this.loading.set(false); },
      error: () => { this.q.set(null); this.loading.set(false); this.caricamentoFallito.set(true); },
    });
  }

}
