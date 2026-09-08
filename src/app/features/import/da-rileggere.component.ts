import { Component, OnInit, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MovimentiService } from '../../core/services/movimenti.service';
import { BuService } from '../../core/services/bu.service';
import { AmbiguitaDTO } from '../../core/models/movimenti.models';
import { BusinessUnitDTO, PianoContiCogeDTO } from '../../core/models/anagrafica.models';
import { CogePickerComponent } from '../../shared/components/coge-picker/coge-picker.component';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';
import { ImportCountsService } from './import-counts.service';

/**
 * Coda «Da rileggere»: le righe che l'import non è riuscito a interpretare
 * ({@code import_ambiguita} DA_CLASSIFICARE).
 *
 * <p>La schermata era stata tolta il 20/08/2026 («0 righe su 2 import, non meritava una
 * schermata»), lasciando solo il contatore. La premessa è caduta l'08/09/2026: il canone mensile
 * del Crédit Agricole — 13,50 € — si è fermato qui, e il titolare vedeva «pend. 1» senza avere
 * <b>nessun posto</b> dove risolverlo. Un contatore senza la sua schermata non è un avviso, è un
 * vicolo cieco.
 *
 * <p>Perché conta più dei 13,50 €: una riga ferma qui <b>non è un movimento</b>, quindi non sta
 * in nessun saldo. È la stessa famiglia delle «Righe fuori dai conti» — denaro che l'import ha
 * visto e i saldi non mostrano — e per questo la pagina dichiara l'effetto in euro PRIMA del
 * click, come fa {@code ScartatiPanelComponent}.
 *
 * <p>Legge da {@code /api/movimenti/import/ambiguita} (tutti gli import, non solo l'ultimo):
 * il badge conta su tutta la tabella, e badge e schermata devono contare la stessa cosa.
 */
@Component({
  selector: 'app-da-rileggere',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    CogePickerComponent, HelpNoteComponent,
  ],
  template: `
    <div class="dr">
      @if (loading()) {
        <div class="dr__center"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (caricamentoFallito()) {
        <div class="dr__empty">
          <mat-icon>cloud_off</mat-icon>
          <p>Non è stato possibile caricare la coda. Nessun dato è stato toccato.</p>
          <button mat-stroked-button (click)="ricarica()">Riprova</button>
        </div>
      } @else if (!righe().length) {
        <div class="dr__empty dr__empty--ok">
          <mat-icon>verified</mat-icon>
          <p>Niente da rileggere: l'import ha capito tutte le righe.</p>
        </div>
      } @else {
        <agos-help-note tono="warn" titolo="Perché queste righe sono qui">
          <p>Sono righe delle banche che l'import <strong>non ha saputo interpretare</strong>: non
            è riuscito a dedurre come si è mosso il denaro, quindi si è fermato invece di
            inventare. Finché restano qui <strong>non sono movimenti</strong>, e quindi
            <strong>non compaiono in nessun saldo</strong>.</p>
          <p>Dille tu che voce sono e a quale ramo appartengono, e diventano movimenti veri. Se
            invece è l'incasso di un evento, mandala alla coda degli incassi-evento; se non deve
            entrare nei conti, lasciala fuori scrivendo perché.</p>
        </agos-help-note>

        <header class="dr__head">
          <h2>Da rileggere</h2>
          <p class="dr__sub">
            <strong>{{ righe().length }}</strong>
            {{ righe().length === 1 ? 'riga che oggi non sta' : 'righe che oggi non stanno' }}
            in nessun saldo
          </p>
        </header>

        @for (r of righe(); track r.id) {
          <article class="dr__card">
            <div class="dr__frase">
              {{ fonteLeggibile(r) }}
              @if (data(r); as d) { · {{ d }} }
              @if (importo(r); as i) { · <b>{{ i }}</b> }
            </div>
            @if (descrizione(r); as d) { <p class="dr__descr">«{{ d }}»</p> }

            <p class="dr__perche">
              <span>L'import si è fermato perché:</span> {{ motivoLeggibile(r.motivo) }}
            </p>

            <!-- Nessun campo nascosto: la riga grezza del file, così com'è arrivata. Se la frase
                 qui sopra non basta a decidere, la verità è qui sotto e non altrove. -->
            <details class="dr__raw">
              <summary>Vedi la riga com'è nel file</summary>
              <dl>
                @for (c of campi(r); track c.k) {
                  <div><dt>{{ c.k }}</dt><dd>{{ c.v }}</dd></div>
                }
              </dl>
            </details>

            <div class="dr__coge">
              <app-coge-picker
                label="Che voce è?"
                [required]="true"
                [value]="cogeSel()[r.id] ?? null"
                (cogeChange)="setCoge(r.id, $event)"></app-coge-picker>
            </div>

            <div class="dr__rami">
              <span class="dr__rami-lab">A quale parte dell'azienda?</span>
              <div class="dr__rami-voci">
                @for (b of bu(); track b.id) {
                  <button type="button" class="dr__ramo"
                          [class.dr__ramo--on]="buSel()[r.id] === b.id"
                          (click)="setBu(r.id, b.id)">{{ b.nome }}</button>
                }
              </div>
            </div>

            <p class="dr__effetto">
              <mat-icon>check_circle</mat-icon>
              Se la registri: nasce il movimento e il saldo del conto
              @if (importo(r); as i) { si muove di <b>{{ i }}</b> }
              @else { si aggiorna }.
            </p>

            <div class="dr__actions">
              <button mat-flat-button color="primary"
                      [disabled]="!pronta(r.id) || saving() === r.id"
                      (click)="registra(r)">
                <mat-icon>account_balance</mat-icon> Registrala nei conti
              </button>
              <button mat-stroked-button [disabled]="saving() === r.id" (click)="eUnEvento(r)">
                <mat-icon>celebration</mat-icon> È l'incasso di un evento
              </button>
              <button mat-stroked-button
                      [disabled]="saving() === r.id || !motivoValido(r.id)"
                      (click)="lasciaFuori(r)">
                <mat-icon>block</mat-icon> Lasciala fuori
              </button>
              @if (!pronta(r.id)) {
                <span class="dr__hint">Scegli voce e ramo per poterla registrare</span>
              }
            </div>

            <label class="dr__motivo">
              <span>Perché la lasci fuori?</span>
              <input type="text" [value]="motivo()[r.id] ?? ''"
                     (input)="setMotivo(r.id, $any($event.target).value)"
                     placeholder="es. già registrata a mano il 31/08"
                     [attr.aria-describedby]="'dr-mot-' + r.id">
              <small [id]="'dr-mot-' + r.id">Serve per poterla lasciare fuori: resta scritto sulla riga.</small>
            </label>
          </article>
        }
      }
    </div>
  `,
  styles: [`
    .dr { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
    .dr__center, .dr__empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px; color: var(--text-sub); }
    .dr__empty mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: .4; }
    .dr__empty--ok mat-icon { color: var(--success); opacity: .7; }
    .dr__head h2 { margin: 0; font-size: 1.25rem; }
    .dr__sub { margin: 4px 0 0; color: var(--text-sub); font-size: .9rem; }
    .dr__card { border: 1px solid var(--danger); border-left-width: 4px; border-radius: var(--radius-md);
      background: var(--card); padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .dr__frase { font-size: 1.05rem; line-height: 1.5; }
    .dr__descr { margin: 0; font-size: .82rem; color: var(--text-sub); font-family: ui-monospace, 'Courier New', monospace; }
    .dr__perche { margin: 0; font-size: .9rem; }
    .dr__perche span { font-weight: 600; }
    .dr__raw summary { cursor: pointer; font-size: .84rem; color: var(--text-sub); }
    .dr__raw dl { margin: 8px 0 0; display: grid; gap: 2px; }
    .dr__raw dl > div { display: grid; grid-template-columns: minmax(120px, 180px) 1fr; gap: 8px;
      font-size: .8rem; font-family: ui-monospace, 'Courier New', monospace; }
    .dr__raw dt { color: var(--text-sub); }
    .dr__raw dd { margin: 0; overflow-wrap: anywhere; }
    .dr__rami { display: flex; flex-direction: column; gap: 6px; }
    .dr__rami-lab { font-size: .84rem; font-weight: 600; }
    .dr__rami-voci { display: flex; flex-wrap: wrap; gap: 8px; }
    .dr__ramo { padding: 7px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--card); font: inherit; font-size: .86rem; color: var(--text-main); cursor: pointer; }
    .dr__ramo--on { border-color: var(--primary); background: var(--primary); color: #fff; }
    .dr__ramo:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
    .dr__effetto { margin: 0; display: flex; align-items: center; gap: 6px; font-size: .9rem; color: var(--text-sub); }
    .dr__effetto mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--success); }
    .dr__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .dr__hint { font-size: .8rem; color: var(--text-sub); }
    .dr__motivo { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; max-width: 460px; }
    .dr__motivo > span { font-size: .84rem; font-weight: 600; }
    .dr__motivo input { padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--card); font: inherit; font-size: .9rem; color: var(--text-main); }
    .dr__motivo input:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
    .dr__motivo small { font-size: .76rem; color: var(--text-sub); }
  `],
})
export class DaRileggereComponent implements OnInit {
  private readonly movimenti = inject(MovimentiService);
  private readonly buService = inject(BuService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly counts = inject(ImportCountsService);

  readonly righe = signal<AmbiguitaDTO[]>([]);
  readonly bu = signal<BusinessUnitDTO[]>([]);
  readonly loading = signal(true);
  readonly caricamentoFallito = signal(false);
  readonly saving = signal<string | null>(null);

  readonly cogeSel = signal<Record<string, number | null>>({});
  readonly buSel = signal<Record<string, number | null>>({});
  readonly motivo = signal<Record<string, string>>({});

  ngOnInit(): void {
    this.buService.getAll().subscribe({ next: b => this.bu.set(b), error: () => this.bu.set([]) });
    this.ricarica();
  }

  ricarica(): void {
    this.loading.set(true);
    this.caricamentoFallito.set(false);
    this.movimenti.getAmbiguitaTutte('DA_CLASSIFICARE').subscribe({
      next: p => { this.righe.set(p.content); this.loading.set(false); },
      error: () => { this.righe.set([]); this.loading.set(false); this.caricamentoFallito.set(true); },
    });
  }

  // ── Lettura della riga grezza ───────────────────────────────────────────────
  // I file delle due banche non hanno le stesse colonne (BPM: IMPORTO/DATA_CONTABILE,
  // CA: ENTRATE+USCITE/DATA_OPERAZIONE). Si prende il primo campo presente e, se non c'è,
  // non si mostra nulla: meglio un dato in meno che un dato inventato. Il pannello
  // «Vedi la riga com'è nel file» mostra comunque tutto.

  private primo(r: AmbiguitaDTO, chiavi: string[]): string | null {
    for (const k of chiavi) {
      const v = r.rawData?.[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  }

  data(r: AmbiguitaDTO): string | null {
    return this.primo(r, ['DATA_OPERAZIONE', 'DATA_CONTABILE', 'DATA', 'DATA_VALUTA']);
  }

  importo(r: AmbiguitaDTO): string | null {
    const v = this.primo(r, ['IMPORTO', 'USCITE', 'ENTRATE', 'TOTALE']);
    return v == null ? null : v + ' €';
  }

  descrizione(r: AmbiguitaDTO): string | null {
    const d = this.primo(r, ['DESCRIZIONE', 'CAUSALE_ABI', 'NOTE']);
    const c = this.primo(r, ['CAUSALE']);
    // Il template avvolge già la frase in «…»: qui niente virgolette, o si raddoppiano.
    if (d && c) return `${d} · causale ${c}`;
    return d ?? (c ? `causale ${c}` : null);
  }

  fonteLeggibile(r: AmbiguitaDTO): string {
    const s = this.primo(r, ['_SORGENTE']) ?? r.fonte;
    if (s === 'CA') return 'Crédit Agricole';
    if (s === 'BPM') return 'Banco BPM';
    return s ?? 'Riga importata';
  }

  /** Tutti i campi del file, chiavi tecniche escluse: è la prova, non un riassunto. */
  campi(r: AmbiguitaDTO): { k: string; v: string }[] {
    return Object.entries(r.rawData ?? {})
      .filter(([k, v]) => k !== '_SORGENTE' && v != null && String(v).trim() !== '')
      .map(([k, v]) => ({ k, v: String(v) }));
  }

  /** I motivi che il motore può scrivere ({@code MovimentoMappingEngineImpl.validate}). */
  motivoLeggibile(motivo: string): string {
    switch (motivo) {
      case 'CAUSALE_NON_MAPPATA':
        return 'la causale della banca non è fra quelle conosciute, quindi non si sa con quale ' +
               'strumento il denaro si è mosso (bonifico, addebito, carta…).';
      case 'METODO_NON_IDENTIFICATO':
        return 'non si è riusciti a stabilire il metodo di pagamento della riga.';
      case 'COGE_NON_DETERMINABILE':
        return 'non si è capito a quale voce di bilancio appartiene.';
      case 'BU_AMBIGUA':
        return 'non si è capito a quale parte dell\'azienda appartiene.';
      case 'BANCA_NON_IDENTIFICATA':
        return 'non si è capito su quale conto è avvenuta.';
      case 'DATA_MANCANTE':
        return 'la riga non ha una data leggibile.';
      case 'DATA_FUTURA':
        return 'la data è nel futuro.';
      case 'DATA_TROPPO_VECCHIA':
        return 'la data è anteriore al 2023.';
      case 'IMPORTO_NON_POSITIVO':
        return 'l\'importo letto non è un numero positivo.';
      default:
        return motivo;
    }
  }

  // ── Scelte e azioni ─────────────────────────────────────────────────────────
  setCoge(id: string, conto: PianoContiCogeDTO | null): void {
    this.cogeSel.update(m => ({ ...m, [id]: conto?.id ?? null }));
  }

  setBu(id: string, buId: number): void {
    this.buSel.update(m => ({ ...m, [id]: buId }));
  }

  setMotivo(id: string, testo: string): void {
    this.motivo.update(m => ({ ...m, [id]: testo }));
  }

  /** Il server esige voce E ramo (CLASSIFICAZIONE_INCOMPLETA): qui è solo cortesia. */
  pronta(id: string): boolean {
    return this.cogeSel()[id] != null && this.buSel()[id] != null;
  }

  motivoValido(id: string): boolean {
    return (this.motivo()[id] ?? '').trim().length >= 3;
  }

  registra(r: AmbiguitaDTO): void {
    if (!this.pronta(r.id)) return;
    this.saving.set(r.id);
    this.movimenti.classificaAmbiguita(r.id, {
      cogeId: this.cogeSel()[r.id]!, businessUnitId: this.buSel()[r.id]!,
      metodoPagamentoId: null, contoBancarioId: null, fornitoreId: null,
      eventoId: null, tipoEventoMovimento: null, nota: null,
      apprendiKeyword: false, scarta: false,
    }).subscribe({
      next: () => this.dopoAzione(r, 'Riga registrata: il movimento è stato creato'),
      error: err => this.fail(err),
    });
  }

  eUnEvento(r: AmbiguitaDTO): void {
    this.saving.set(r.id);
    this.movimenti.ambiguitaEUnEvento(r.id).subscribe({
      next: () => this.dopoAzione(r, 'Spostata negli incassi-evento: attribuiscila da lì'),
      error: err => this.fail(err),
    });
  }

  lasciaFuori(r: AmbiguitaDTO): void {
    if (!this.motivoValido(r.id)) return;
    this.saving.set(r.id);
    this.movimenti.classificaAmbiguita(r.id, {
      cogeId: null, businessUnitId: null, metodoPagamentoId: null, contoBancarioId: null,
      fornitoreId: null, eventoId: null, tipoEventoMovimento: null,
      nota: this.motivo()[r.id].trim(), apprendiKeyword: false, scarta: true,
    }).subscribe({
      next: () => this.dopoAzione(r, 'Riga lasciata fuori: nessun saldo è cambiato'),
      error: err => this.fail(err),
    });
  }

  private dopoAzione(r: AmbiguitaDTO, messaggio: string): void {
    this.saving.set(null);
    this.righe.update(l => l.filter(x => x.id !== r.id));
    this.counts.reload();
    this.snackBar.open(messaggio, 'OK', { duration: 3000 });
  }

  private fail(err: { error?: { message?: string } }): void {
    this.saving.set(null);
    this.snackBar.open(err.error?.message ?? 'Operazione non riuscita', 'OK', { duration: 6000 });
    this.ricarica();   // il server ha l'ultima parola: ripesco lo stato vero
  }
}
