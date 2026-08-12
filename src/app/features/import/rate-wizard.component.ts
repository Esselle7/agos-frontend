import { Component, OnInit, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';

import { MovimentiService } from '../../core/services/movimenti.service';
import { SpeseRicorrentiService } from '../../core/services/spese-ricorrenti.service';
import { RicorrenteParcheggiataDTO, CandidatoRataDTO } from '../../core/models/movimenti.models';
import { PianoContiCogeDTO } from '../../core/models/anagrafica.models';
import { CogePickerComponent } from '../../shared/components/coge-picker/coge-picker.component';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';
import { ImportCountsService } from './import-counts.service';

/**
 * Wizard «Questa rata di cosa?» (docs/specs/wizard-rate-ricorrenti.md, audit import §7.3).
 *
 * <p>Poche voci (~2/mese) ma 51.790,09 € in sei mesi. Il backend non cambia: `listRicorrenti`
 * calcola già proposta e candidati col «perché», qui si portano a schermo. La proposta è
 * <b>evidenziata, mai applicata</b> — e quando il matcher si rifiuta di scegliere fra due
 * candidati plausibili, quel rifiuto si mostra invece di nasconderlo.
 */
@Component({
  selector: 'app-rate-wizard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe, DatePipe, RouterLink,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    CogePickerComponent, HelpNoteComponent,
  ],
  template: `
    <div class="wz">
      @if (loading()) {
        <div class="wz__center"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (caricamentoFallito()) {
        <div class="wz__stato">
          <mat-icon>cloud_off</mat-icon>
          <p>Non è stato possibile caricare le rate. Nessun dato è stato toccato.</p>
          <button mat-stroked-button (click)="ricarica()">Riprova</button>
        </div>
      } @else if (!righe().length) {
        <div class="wz__stato wz__stato--ok">
          <mat-icon>event_available</mat-icon>
          <h2>Nessuna rata in attesa</h2>
          <p>Ogni addebito che sembrava la rata di un finanziamento è stato collegato al suo piano,
            registrato, o messo da parte.</p>
        </div>
      } @else if (corrente(); as r) {
        <header class="wz__head">
          <div class="wz__headline">
            <h2>Rate da sistemare</h2>
            <p class="wz__conta">
              <strong>{{ indice() + 1 }}</strong> di {{ righe().length }}
              @if (rimandate() > 0) { · {{ rimandate() }} rimandate a dopo }
            </p>
          </div>
          <div class="wz__barra" role="progressbar" [attr.aria-valuenow]="indice() + 1"
               aria-valuemin="1" [attr.aria-valuemax]="righe().length"
               [attr.aria-label]="'Rata ' + (indice() + 1) + ' di ' + righe().length">
            <span [style.width.%]="((indice() + 1) / righe().length) * 100"></span>
          </div>
        </header>

        <section class="wz__spesa">
          <p class="wz__frase">
            {{ r.tipo === 'USCITA' ? 'È uscita una rata di' : 'È entrata un\\'erogazione di' }}
            <b class="wz__cifra">{{ r.importo | currency:'EUR' }}</b>
          </p>
          <p class="wz__quando">
            @if (r.dataMovimento) { il {{ r.dataMovimento | date:'d MMMM yyyy' }} }
            {{ conto(r) }}
          </p>
          <p class="wz__causale">«{{ r.descrizione }}»</p>
        </section>

        @if (r.tipo === 'USCITA') {
          <section class="wz__scelta" aria-labelledby="wz-quale">
            <h3 id="wz-quale">Di quale finanziamento è?</h3>

            @if (!piani().length) {
              <p class="wz__nota">
                <mat-icon>info</mat-icon>
                Non hai ancora nessun piano di finanziamento in archivio: non c'è niente con cui
                confrontare questa rata.
              </p>
              <a mat-stroked-button routerLink="/spese-ricorrenti" class="wz__link">
                <mat-icon>add</mat-icon> Creo il piano adesso
              </a>
            } @else if (proposta(r); as p) {
              <p class="wz__gruppo-tit"><mat-icon>star</mat-icon> Il piano che corrisponde</p>
              <button type="button" class="wz__voce wz__voce--sugg"
                      [class.wz__voce--on]="candidatoScelto()?.rataId === p.rataId"
                      (click)="scegliCandidato(p)">
                <span class="wz__voce-txt">
                  <b>{{ p.pianoDescrizione }}</b>
                  <small>Rata {{ p.numeroRata }} · scadenza {{ p.dataScadenza | date:'d MMM yyyy' }}
                    · {{ p.importoRata | currency:'EUR' }}</small>
                  <small class="wz__perche">perché: {{ perche(p) }}</small>
                </span>
              </button>
            } @else if (r.candidati?.length) {
              <!-- Il matcher si è rifiutato di scegliere fra candidati ugualmente plausibili:
                   quel rifiuto è informazione, si mostra (SPEC R1). -->
              <p class="wz__nota">
                <mat-icon>help</mat-icon>
                Ci sono {{ r.candidati.length }} rate che corrispondono altrettanto bene: scegli tu,
                non voglio indovinare.
              </p>
              @for (c of r.candidati; track c.rataId) {
                <button type="button" class="wz__voce"
                        [class.wz__voce--on]="candidatoScelto()?.rataId === c.rataId"
                        (click)="scegliCandidato(c)">
                  <span class="wz__voce-txt">
                    <b>{{ c.pianoDescrizione }}</b>
                    <small>Rata {{ c.numeroRata }} · scadenza {{ c.dataScadenza | date:'d MMM yyyy' }}
                      · {{ c.importoRata | currency:'EUR' }}</small>
                    <small class="wz__perche">perché: {{ perche(c) }}</small>
                  </span>
                </button>
              }
            } @else {
              <p class="wz__nota">
                <mat-icon>info</mat-icon>
                Nessuno dei tuoi {{ piani().length }} piani attivi corrisponde a questa riga: può
                essere su un altro conto, oppure il nome del piano non compare nella causale.
              </p>
            }

            <button type="button" class="wz__voce wz__voce--altro"
                    [class.wz__voce--on]="registraSenzaPiano()" (click)="scegliRegistra()">
              <mat-icon>receipt_long</mat-icon>
              <span class="wz__voce-txt">
                <b>Registrala e basta, il piano lo faccio poi</b>
                <small>crea il movimento del costo, senza agganciarlo a nessun piano</small>
              </span>
            </button>
          </section>
        } @else {
          <section class="wz__scelta">
            <p class="wz__nota">
              <mat-icon>info</mat-icon>
              Un'entrata è l'<b>erogazione</b> di un finanziamento, non una rata: si registra e
              basta, sul conto «Finanziamenti ricevuti».
            </p>
            <button type="button" class="wz__voce wz__voce--altro"
                    [class.wz__voce--on]="registraSenzaPiano()" (click)="scegliRegistra()">
              <mat-icon>receipt_long</mat-icon>
              <span class="wz__voce-txt"><b>Registra l'erogazione</b></span>
            </button>
          </section>
        }

        @if (registraSenzaPiano() && r.tipo === 'USCITA') {
          <section class="wz__scelta">
            <h3>Che costo è?</h3>
            <app-coge-picker label="Voce di bilancio della rata" [required]="true"
                             [value]="cogeScelto()" (cogeChange)="setCoge($event)"></app-coge-picker>
          </section>
        }

        <!-- L'effetto in euro si legge PRIMA di confermare, sempre. -->
        @if (candidatoScelto(); as c) {
          <section class="wz__esito" aria-live="polite">
            <p class="wz__effetto">
              <mat-icon>check_circle</mat-icon>
              <span>
                La rata {{ c.numeroRata }} di <b>«{{ c.pianoDescrizione }}»</b> risulterà pagata
                il {{ r.dataMovimento | date:'d MMMM yyyy' }}.
                @if (scarto(r, c); as s) {
                  <br>
                  <b>Attenzione:</b> l'addebito vero è {{ r.importo | currency:'EUR' }}, la rata del
                  piano {{ c.importoRata | currency:'EUR' }}: il piano viene
                  <b>riscritto sull'importo vero</b> ({{ s > 0 ? '+' : '−' }}{{ abs(s) | currency:'EUR' }}).
                  Su un finanziamento lo scarto va tutto <b>sugli interessi</b>, la quota capitale
                  non cambia.
                }
              </span>
            </p>
            <div class="wz__azioni">
              <button mat-flat-button color="primary" [disabled]="salvando()" (click)="collega(r, c)">
                @if (salvando()) { <mat-spinner diameter="18"></mat-spinner> } @else { Va bene }
              </button>
              <button mat-button (click)="azzeraScelta()">Torna indietro</button>
            </div>
          </section>
        } @else if (registraSenzaPiano()) {
          <section class="wz__esito" aria-live="polite">
            <p class="wz__effetto">
              <mat-icon>check_circle</mat-icon>
              <span>
                <b>{{ r.importo | currency:'EUR' }}</b>
                {{ r.tipo === 'USCITA' ? 'andranno nei costi' : 'entreranno come finanziamento ricevuto' }}
                di {{ r.dataMovimento | date:'MMMM yyyy' }}, senza agganciarsi a nessun piano.
                Il saldo del conto <b>{{ r.tipo === 'USCITA' ? 'scende' : 'sale' }}</b> di questo importo.
              </span>
            </p>
            <div class="wz__azioni">
              <button mat-flat-button color="primary" [disabled]="!puoRegistrare(r) || salvando()"
                      (click)="registra(r)">
                @if (salvando()) { <mat-spinner diameter="18"></mat-spinner> } @else { Va bene }
              </button>
              <button mat-button (click)="azzeraScelta()">Torna indietro</button>
              @if (!puoRegistrare(r)) {
                <span class="wz__hint">Scegli la voce di bilancio per registrarla</span>
              }
            </div>
          </section>
        }

        <div class="wz__azioni wz__azioni--vuote">
          <button mat-stroked-button [disabled]="salvando()" (click)="ignora(r)">
            <mat-icon>block</mat-icon> Non è una rata, mettila da parte
          </button>
          <button mat-stroked-button [disabled]="salvando()" (click)="rimanda()">
            <mat-icon>schedule</mat-icon> Non lo so, lascia in sospeso
          </button>
        </div>

        <agos-help-note tono="tip" titolo="Perché queste rate sono qui" [collapsed]="true">
          <p>L'import <strong>non contabilizza mai una rata da solo</strong>: una rata si divide in
            quota capitale e interessi, e sbagliare la divisione sposta denaro fra il debito e i
            costi. Perciò si ferma qui e lo chiede.</p>
          <p>Se colleghi la riga a una rata del piano, <strong>l'importo vero della banca vince</strong>
            su quello previsto: è l'estratto conto ad avere ragione. Lo scarto finisce sugli interessi.</p>
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
    .wz__quando { margin: 4px 0 0; color: var(--text-sub); font-size: .92rem; }
    .wz__causale { margin: 10px 0 0; padding-top: 10px; border-top: 1px solid var(--border-soft);
      font-family: ui-monospace, 'Courier New', monospace; font-size: .78rem; color: var(--text-faint);
      overflow-wrap: anywhere; }

    .wz__scelta h3 { margin: 0 0 12px; font-size: 1.05rem; font-weight: 600; }
    .wz__gruppo-tit { display: flex; align-items: center; gap: 6px; margin: 0 0 8px;
      font-size: .85rem; font-weight: 600; color: var(--accent-d); }
    .wz__gruppo-tit mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .wz__link { margin-bottom: 10px; }

    .wz__voce { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 16px;
      min-height: 56px; margin-bottom: 8px;
      border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card);
      cursor: pointer; text-align: left; font: inherit; color: var(--text-main);
      transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease); }
    .wz__voce:hover { border-color: var(--primary-l); background: var(--tint-primary); }
    .wz__voce:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .wz__voce--on { border-color: var(--primary); background: var(--tint-primary-strong); }
    .wz__voce--sugg { border-color: var(--accent); }
    .wz__voce--altro mat-icon { color: var(--text-sub); flex-shrink: 0; }
    .wz__voce-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .wz__voce-txt b { font-size: .95rem; font-weight: 600; }
    .wz__voce-txt small { font-size: .78rem; color: var(--text-sub); }
    .wz__perche { color: var(--text-faint); font-style: italic; }

    .wz__nota { margin: 0 0 12px; display: flex; align-items: flex-start; gap: 8px;
      font-size: .9rem; line-height: 1.5; color: var(--text-sub); }
    .wz__nota mat-icon { font-size: 17px; width: 17px; height: 17px; flex-shrink: 0; margin-top: 2px; }

    .wz__esito { background: var(--tint-success); border-radius: var(--radius-md); padding: 16px 18px;
      display: flex; flex-direction: column; gap: 14px; }
    .wz__effetto { margin: 0; display: flex; align-items: flex-start; gap: 9px;
      font-size: .95rem; line-height: 1.55; color: var(--text-main); }
    .wz__effetto mat-icon { color: var(--success); font-size: 19px; width: 19px; height: 19px;
      flex-shrink: 0; margin-top: 2px; }

    .wz__azioni { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .wz__azioni--vuote { padding-top: 4px; }
    .wz__hint { font-size: .8rem; color: var(--text-faint); }

    @media (prefers-reduced-motion: reduce) {
      .wz__barra span, .wz__voce { transition: none; }
    }
  `],
})
export class RateWizardComponent implements OnInit {
  private readonly movimenti = inject(MovimentiService);
  private readonly spese = inject(SpeseRicorrentiService);
  private readonly counts = inject(ImportCountsService);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(true);
  readonly caricamentoFallito = signal(false);
  readonly salvando = signal(false);

  readonly righe = signal<RicorrenteParcheggiataDTO[]>([]);
  readonly piani = signal<{ id: string; stato: string }[]>([]);
  readonly indice = signal(0);
  readonly rimandate = signal(0);

  readonly candidatoScelto = signal<CandidatoRataDTO | null>(null);
  readonly registraSenzaPiano = signal(false);
  readonly cogeScelto = signal<number | null>(null);

  readonly corrente = computed(() => this.righe()[this.indice()] ?? null);

  ngOnInit(): void { this.ricarica(); }

  ricarica(): void {
    this.loading.set(true);
    this.caricamentoFallito.set(false);
    forkJoin({
      coda: this.movimenti.getRicorrenti('DA_RICONCILIARE', 0, 2000),
      piani: this.spese.listPlans(),
    }).subscribe({
      next: ({ coda, piani }) => {
        this.righe.set(coda.content);
        this.piani.set(piani.filter(p => p.stato === 'ATTIVO'));
        this.indice.set(0);
        this.rimandate.set(0);
        this.azzeraScelta();
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.caricamentoFallito.set(true); },
    });
  }

  conto(r: RicorrenteParcheggiataDTO): string {
    return r.contoBancarioId === 1 ? 'dal conto BPM'
      : r.contoBancarioId === 2 ? 'dal conto Crédit Agricole' : '';
  }

  /** La rata che il matcher propone, o null quando si è rifiutato di scegliere. */
  proposta(r: RicorrenteParcheggiataDTO): CandidatoRataDTO | null {
    return r.candidati?.find(c => c.rataId === r.propostaRataId) ?? null;
  }

  /** Il «perché» in chiaro: motivo del match + distanza dalla scadenza (SPEC R2). */
  perche(c: CandidatoRataDTO): string {
    const q = c.scartoGiorni === 0 ? 'la scadenza cade lo stesso giorno dell\'addebito'
      : `la scadenza è a ${c.scartoGiorni} giorn${c.scartoGiorni === 1 ? 'o' : 'i'} dall'addebito`;
    return `${c.motivo}, e ${q}`;
  }

  /**
   * Scarto fra l'addebito reale e la rata prevista: collegare RISCRIVE la rata sull'importo vero
   * (server-side), quindi il numero va mostrato prima del click. null = importi uguali.
   */
  scarto(r: RicorrenteParcheggiataDTO, c: CandidatoRataDTO): number | null {
    const delta = Number(r.importo) - Number(c.importoRata);
    return Math.abs(delta) < 0.005 ? null : delta;
  }

  abs(n: number): number { return Math.abs(n); }

  scegliCandidato(c: CandidatoRataDTO): void {
    this.candidatoScelto.set(c);
    this.registraSenzaPiano.set(false);
  }

  scegliRegistra(): void {
    this.candidatoScelto.set(null);
    this.registraSenzaPiano.set(true);
    const r = this.corrente();
    if (r && this.cogeScelto() == null) this.cogeScelto.set(r.cogeSuggeritoId);
  }

  setCoge(c: PianoContiCogeDTO | null): void { this.cogeScelto.set(c?.id ?? null); }

  /** Su ENTRATA il conto lo forza il server (90.01.001): non si chiede, non si valida qui. */
  puoRegistrare(r: RicorrenteParcheggiataDTO): boolean {
    return r.tipo === 'ENTRATA' || this.cogeScelto() != null;
  }

  azzeraScelta(): void {
    this.candidatoScelto.set(null);
    this.registraSenzaPiano.set(false);
    this.cogeScelto.set(null);
  }

  rimanda(): void {
    this.rimandate.update(n => n + 1);
    this.azzeraScelta();
    this.indice.update(i => (i + 1) % Math.max(1, this.righe().length));
  }

  collega(r: RicorrenteParcheggiataDTO, c: CandidatoRataDTO): void {
    this.salvando.set(true);
    this.movimenti.risolviRicorrente(r.id, {
      azione: 'COLLEGA', cogeId: null, pianoId: c.pianoId, rataId: c.rataId, nota: null,
    }).subscribe({
      next: () => this.dopoAzione(r, `Rata ${c.numeroRata} di «${c.pianoDescrizione}» collegata`),
      error: err => this.fallito(err),
    });
  }

  registra(r: RicorrenteParcheggiataDTO): void {
    const cogeId = r.tipo === 'ENTRATA' ? null : this.cogeScelto();
    if (r.tipo === 'USCITA' && cogeId == null) return;
    this.salvando.set(true);
    this.movimenti.risolviRicorrente(r.id, { azione: 'CONFERMA', cogeId, nota: null }).subscribe({
      next: () => this.dopoAzione(r, 'Movimento creato dalla riga: nessun piano agganciato'),
      error: err => this.fallito(err),
    });
  }

  ignora(r: RicorrenteParcheggiataDTO): void {
    this.salvando.set(true);
    this.movimenti.risolviRicorrente(r.id, { azione: 'IGNORA', cogeId: null, nota: null }).subscribe({
      next: () => this.dopoAzione(r, 'Riga messa da parte: nessun saldo è cambiato'),
      error: err => this.fallito(err),
    });
  }

  private dopoAzione(r: RicorrenteParcheggiataDTO, messaggio: string): void {
    this.salvando.set(false);
    this.righe.update(list => list.filter(x => x.id !== r.id));
    if (this.indice() >= this.righe().length) this.indice.set(0);
    this.azzeraScelta();
    this.counts.reload();
    this.snackBar.open(messaggio, 'OK', { duration: 3000 });
  }

  /** Ogni rifiuto del percorso-soldi arriva con la mossa successiva, non col codice. */
  private static readonly VIE_DUSCITA: Record<string, string> = {
    IMPORTO_SOTTO_QUOTA_CAPITALE:
      'L\'addebito è più basso della quota capitale della rata: gli interessi risulterebbero negativi. Verifica di aver scelto la rata giusta, oppure correggi il piano (debito/tasso).',
    RATA_NON_COLLEGABILE:
      'Questa rata non è agganciabile (annullata o saltata): scegline un\'altra, oppure registra la riga senza piano.',
    FONDI_INSUFFICIENTI:
      'Il conto non ha saldo per pagare la rata: registra prima gli incassi mancanti (o correggi il saldo iniziale), poi ricollega.',
    RICORRENTE_GIA_RISOLTA:
      'Questa riga è già stata risolta (magari da un\'altra finestra): ricarico la coda.',
    COLLEGA_SOLO_USCITE:
      'Un\'entrata è l\'erogazione di un finanziamento, non una rata: usa «Registra l\'erogazione».',
    COGE_OBBLIGATORIO:
      'Scegli la voce di bilancio prima di registrare la rata.',
  };

  private fallito(err: { error?: { message?: string; code?: string } }): void {
    this.salvando.set(false);
    const base = err.error?.message ?? 'Operazione non riuscita';
    const via = err.error?.code ? RateWizardComponent.VIE_DUSCITA[err.error.code] : undefined;
    this.snackBar.open(via ? `${base} — ${via}` : base, 'OK', { duration: via ? 12000 : 5000 });
    if (err.error?.code === 'RICORRENTE_GIA_RISOLTA') this.ricarica();
  }
}
