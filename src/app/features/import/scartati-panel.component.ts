import { Component, OnInit, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MovimentiService } from '../../core/services/movimenti.service';
import { ScartatoDTO } from '../../core/models/movimenti.models';
import { PianoContiCogeDTO } from '../../core/models/anagrafica.models';
import { CogePickerComponent } from '../../shared/components/coge-picker/coge-picker.component';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';
import { ImportCountsService } from './import-counts.service';

/**
 * Coda «Righe fuori dai conti» (docs/specs/righe-fuori-dai-conti.md, audit import §7.4).
 *
 * <p>Righe bancarie che l'import ha escluso e che fino all'11/08/2026 non comparivano in nessuna
 * schermata: 1.189,55 € di accrediti veri, muti, in sei mesi. Due sole risposte per riga —
 * «Mettila nei conti» (crea il movimento) o «Lasciala fuori» (era già contata) — e l'effetto in
 * euro si legge PRIMA di premere, non dopo.
 */
@Component({
  selector: 'app-scartati-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe, DatePipe,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    CogePickerComponent, HelpNoteComponent,
  ],
  template: `
    <div class="sc">
      @if (loading()) {
        <div class="sc__center"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (caricamentoFallito()) {
        <div class="sc__empty">
          <mat-icon>cloud_off</mat-icon>
          <p>Non è stato possibile caricare la coda. Nessun dato è stato toccato.</p>
          <button mat-stroked-button (click)="ricarica()">Riprova</button>
        </div>
      } @else if (!righe().length) {
        <div class="sc__empty sc__empty--ok">
          <mat-icon>verified</mat-icon>
          <p>Nessuna riga fuori dai conti: ogni riga delle banche è stata registrata o decisa.</p>
        </div>
      } @else {
        <agos-help-note tono="warn" titolo="Perché queste righe sono qui">
          <p>Sono righe <strong>delle banche</strong> che l'import non ha registrato: le ha
            riconosciute come doppioni o come incassi di un altro periodo. Se una di queste è
            denaro tuo davvero, oggi <strong>non compare in nessun saldo</strong>.</p>
          <p>Guardale una per una: <strong>Mettila nei conti</strong> crea il movimento sul conto
            della banca, <strong>Lasciala fuori</strong> la chiude senza toccare niente. In
            entrambi i casi la riga resta tracciata.</p>
        </agos-help-note>

        <header class="sc__head">
          <h2>Righe fuori dai conti</h2>
          <p class="sc__sub">
            <strong>{{ righe().length }}</strong>
            {{ righe().length === 1 ? 'riga' : 'righe' }} ·
            <strong>{{ totale() | currency:'EUR' }}</strong> che oggi non stanno in nessun saldo
          </p>
        </header>

        @for (r of righe(); track r.id) {
          <article class="sc__card">
            <div class="sc__frase">
              La banca ha {{ r.tipo === 'USCITA' ? 'addebitato' : 'accreditato' }}
              <b>{{ r.importo | currency:'EUR' }}</b>
              @if (r.dataMovimento) { il {{ r.dataMovimento | date:'dd/MM/yyyy' }} }
              @if (r.contoNome) { su <b>{{ r.contoNome }}</b> }
            </div>
            @if (r.descrizione) { <p class="sc__descr">«{{ r.descrizione }}»</p> }

            <p class="sc__perche"><span>Non è finita nei conti perché:</span> {{ r.motivoLeggibile }}</p>

            @if (!r.normalizzabile) {
              <p class="sc__blocco">
                <mat-icon>block</mat-icon>
                Di questa riga non si riesce più a leggere conto e importo dal file originale:
                va inserita a mano dalla pagina Movimenti.
              </p>
            } @else {
              <div class="sc__coge">
                <app-coge-picker
                  label="Se la metti nei conti, su quale voce?"
                  [required]="true"
                  [value]="cogeSel()[r.id] ?? null"
                  (cogeChange)="setCoge(r.id, $event)"></app-coge-picker>
              </div>

              <!-- L'effetto in euro si legge PRIMA di confermare (SPEC: mai un click al buio). -->
              <p class="sc__effetto">
                <mat-icon>check_circle</mat-icon>
                Se la metti: il saldo di <b>{{ r.contoNome ?? 'il conto' }}</b>
                {{ r.tipo === 'USCITA' ? 'scende' : 'sale' }} di <b>{{ r.importo | currency:'EUR' }}</b>,
                e il movimento finisce fra quelli da catalogare.
              </p>

              <div class="sc__actions">
                <button mat-flat-button color="primary"
                        [disabled]="!cogeSel()[r.id] || saving() === r.id"
                        (click)="contabilizza(r)">
                  <mat-icon>account_balance</mat-icon> Mettila nei conti
                </button>
                <button mat-stroked-button [disabled]="saving() === r.id" (click)="lasciaFuori(r)">
                  <mat-icon>block</mat-icon> Lasciala fuori (era già contata)
                </button>
                @if (!cogeSel()[r.id]) {
                  <span class="sc__hint">Scegli la voce per poterla mettere nei conti</span>
                }
              </div>
            }
          </article>
        }
      }
    </div>
  `,
  styles: [`
    .sc { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
    .sc__center, .sc__empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px; color: var(--text-sub); }
    .sc__empty mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: .4; }
    .sc__empty--ok mat-icon { color: var(--success); opacity: .7; }
    .sc__head h2 { margin: 0; font-size: 1.25rem; }
    .sc__sub { margin: 4px 0 0; color: var(--text-sub); font-size: .9rem; }
    .sc__card { border: 1px solid var(--danger); border-left-width: 4px; border-radius: var(--radius-md);
      background: var(--card); padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .sc__frase { font-size: 1.05rem; line-height: 1.5; }
    .sc__descr { margin: 0; font-size: .82rem; color: var(--text-sub); font-family: ui-monospace, 'Courier New', monospace; }
    .sc__perche { margin: 0; font-size: .9rem; color: var(--text-main); }
    .sc__perche span { color: var(--text-sub); }
    .sc__coge { max-width: 480px; }
    .sc__effetto { margin: 0; display: flex; align-items: center; gap: 8px; font-size: .9rem; color: var(--success); }
    .sc__effetto mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .sc__blocco { margin: 0; display: flex; align-items: center; gap: 8px; font-size: .9rem; color: var(--warning); }
    .sc__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .sc__hint { font-size: .8rem; color: var(--text-faint); }
  `],
})
export class ScartatiPanelComponent implements OnInit {
  private readonly movimenti = inject(MovimentiService);
  private readonly counts = inject(ImportCountsService);
  private readonly snackBar = inject(MatSnackBar);

  readonly righe = signal<ScartatoDTO[]>([]);
  readonly loading = signal(true);
  readonly caricamentoFallito = signal(false);
  readonly saving = signal<string | null>(null);
  /** Voce scelta per ogni riga (id riga → id conto CoGe). */
  readonly cogeSel = signal<Record<string, number | null>>({});

  readonly totale = computed(() => this.righe().reduce((s, r) => s + r.importo, 0));

  ngOnInit(): void { this.ricarica(); }

  ricarica(): void {
    this.loading.set(true);
    this.caricamentoFallito.set(false);
    this.movimenti.getScartati('DA_VEDERE').subscribe({
      next: p => { this.righe.set(p.content); this.loading.set(false); },
      error: () => { this.righe.set([]); this.loading.set(false); this.caricamentoFallito.set(true); },
    });
  }

  setCoge(id: string, conto: PianoContiCogeDTO | null): void {
    this.cogeSel.update(m => ({ ...m, [id]: conto?.id ?? null }));
  }

  contabilizza(r: ScartatoDTO): void {
    const cogeId = this.cogeSel()[r.id] ?? null;
    if (cogeId == null) return;   // il server rifiuta comunque: qui è solo cortesia
    this.saving.set(r.id);
    this.movimenti.risolviScartato(r.id, { azione: 'CONTABILIZZA', cogeId }).subscribe({
      next: () => this.dopoAzione(r, 'Riga messa nei conti: il movimento è stato creato'),
      error: err => this.fail(err),
    });
  }

  lasciaFuori(r: ScartatoDTO): void {
    this.saving.set(r.id);
    this.movimenti.risolviScartato(r.id, { azione: 'IGNORA', cogeId: null }).subscribe({
      next: () => this.dopoAzione(r, 'Riga lasciata fuori dai conti: nessun saldo è cambiato'),
      error: err => this.fail(err),
    });
  }

  private dopoAzione(r: ScartatoDTO, messaggio: string): void {
    this.saving.set(null);
    this.righe.update(list => list.filter(x => x.id !== r.id));
    this.counts.reload();
    this.snackBar.open(messaggio, 'OK', { duration: 3000 });
  }

  private fail(err: { error?: { message?: string } }): void {
    this.saving.set(null);
    this.snackBar.open(err.error?.message ?? 'Operazione non riuscita', 'OK', { duration: 6000 });
    this.ricarica();   // il server ha l'ultima parola: ripesco lo stato vero
  }
}
