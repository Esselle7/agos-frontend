import { Component, OnInit, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';

import { MovimentiService } from '../../core/services/movimenti.service';
import { EventiService } from '../../core/services/eventi.service';
import { EventoParcheggiatoDTO } from '../../core/models/movimenti.models';
import { EventoDTO, TipoPagamentoEvento, TIPI_PAGAMENTO_EVENTO } from '../../core/models/eventi.models';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';
import { ImportCountsService } from './import-counts.service';

/** Un evento già chiuso o annullato rifiuterebbe il pagamento: non si propone (SPEC R5). */
const STATI_NON_ATTRIBUIBILI = ['SALDATO', 'ANNULLATO'];

/** Le parole del titolare, non i codici di `lk_tipi_evento_mov`. */
const PAROLE_TIPO: Record<TipoPagamentoEvento, string> = {
  CAPARRA: 'Una caparra', ACCONTO: 'Un acconto', SALDO: 'Il saldo',
  PENALE: 'Una penale', RIMBORSO: 'Un rimborso',
};

/**
 * Wizard «Di chi è questo incasso?» (docs/specs/wizard-incassi-evento.md, audit import §7.2).
 *
 * <p>Sostituisce la sezione `/import/smistamento/eventi`. La logica NON cambia (Gate B: 75
 * riconosciuti, 0 falsi positivi): cambia il modo di lavorarla. Gli eventi della data letta dalla
 * causale salgono in cima con una stella ma <b>nessuno è pre-selezionato</b> — sul solo nome il
 * match ha precisione 20 %, e qui si sposta denaro nel bilancio di un cliente.
 */
@Component({
  selector: 'app-incassi-evento-wizard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe, DatePipe, FormsModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    MatFormFieldModule, MatInputModule, HelpNoteComponent,
  ],
  template: `
    <div class="wz">
      @if (loading()) {
        <div class="wz__center"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (caricamentoFallito()) {
        <div class="wz__stato">
          <mat-icon>cloud_off</mat-icon>
          <p>Non è stato possibile caricare gli incassi da attribuire. Nessun dato è stato toccato.</p>
          <button mat-stroked-button (click)="ricarica()">Riprova</button>
        </div>
      } @else if (!righe().length) {
        <div class="wz__stato wz__stato--ok">
          <mat-icon>celebration</mat-icon>
          <h2>Nessun incasso da attribuire</h2>
          <p>Ogni bonifico che sembrava il pagamento di un evento è stato assegnato al suo evento,
            oppure messo da parte.</p>
        </div>
      } @else if (corrente(); as r) {
        <header class="wz__head">
          <div class="wz__headline">
            <h2>Incassi da attribuire</h2>
            <p class="wz__conta">
              <strong>{{ indice() + 1 }}</strong> di {{ righe().length }}
              @if (rimandati() > 0) { · {{ rimandati() }} rimandati a dopo }
            </p>
          </div>
          <div class="wz__barra" role="progressbar" [attr.aria-valuenow]="indice() + 1"
               aria-valuemin="1" [attr.aria-valuemax]="righe().length"
               [attr.aria-label]="'Incasso ' + (indice() + 1) + ' di ' + righe().length">
            <span [style.width.%]="((indice() + 1) / righe().length) * 100"></span>
          </div>
        </header>

        <section class="wz__spesa">
          <p class="wz__frase">Sono arrivati <b class="wz__cifra">{{ r.importo | currency:'EUR' }}</b> da</p>
          <p class="wz__chi">{{ r.controparteNome || 'Intestatario non indicato' }}</p>
          <p class="wz__quando">
            @if (r.dataMovimento) { il {{ r.dataMovimento | date:'d MMMM yyyy' }} }
            {{ conto(r) }}
          </p>
          @if (r.descrizioneNorm) {
            <p class="wz__causale">Dalla causale ho letto: «{{ r.descrizioneNorm }}»</p>
          }
          @if (!r.contoBancarioId) {
            <p class="wz__blocco">
              <mat-icon>block</mat-icon>
              Questa riga non ha una banca: assegnala da <b>Movimenti → Senza banca</b>, poi torna qui.
            </p>
          }
        </section>

        @if (r.contoBancarioId) {
          <section class="wz__scelta" aria-labelledby="wz-quale">
            <h3 id="wz-quale">Di quale evento è?</h3>

            @if (inData().length) {
              <p class="wz__gruppo-tit">
                <mat-icon>star</mat-icon>
                Eventi del {{ r.dataEventoEstratta | date:'d MMMM yyyy' }}
              </p>
              @for (e of inData(); track e.id) {
                <button type="button" class="wz__voce"
                        [class.wz__voce--on]="eventoScelto()?.id === e.id" (click)="scegliEvento(e)">
                  <span class="wz__voce-txt">
                    <b>{{ e.nome }}</b>
                    <small>{{ e.dataEvento | date:'d MMM yyyy' }}{{ residuoLabel(e) }}</small>
                  </span>
                </button>
              }
            }

            <mat-form-field appearance="outline" class="wz__cerca">
              <mat-label>Cerca un altro evento…</mat-label>
              <input matInput [ngModel]="filtro()" (ngModelChange)="filtro.set($event)"
                     placeholder="nome dell'evento o del cliente">
              <mat-icon matSuffix>search</mat-icon>
            </mat-form-field>

            @if (filtro().trim().length > 1) {
              @for (e of trovati(); track e.id) {
                <button type="button" class="wz__voce"
                        [class.wz__voce--on]="eventoScelto()?.id === e.id" (click)="scegliEvento(e)">
                  <span class="wz__voce-txt">
                    <b>{{ e.nome }}</b>
                    <small>{{ e.dataEvento | date:'d MMM yyyy' }}{{ residuoLabel(e) }}</small>
                  </span>
                </button>
              } @empty {
                <p class="wz__vuoto">Nessun evento trovato con questo nome.</p>
              }
            }

            <button type="button" class="wz__voce wz__voce--segna"
                    [class.wz__voce--on]="segnaposto()" (click)="scegliSegnaposto()">
              <mat-icon>add_box</mat-icon>
              <span class="wz__voce-txt">
                <b>L'evento non è ancora inserito</b>
                <small>l'incasso resta in un contenitore «Da attribuire», lo sposterai poi</small>
              </span>
            </button>
          </section>

          @if (eventoScelto() || segnaposto()) {
            <section class="wz__ramo" aria-labelledby="wz-tipo">
              <h3 id="wz-tipo">È una caparra, un acconto o il saldo?</h3>
              @if (presuntoNonValido(r); as letto) {
                <p class="wz__nota">
                  <mat-icon>info</mat-icon>
                  Dalla causale ho letto «{{ letto }}», che non è un tipo di pagamento: scegli tu.
                </p>
              }
              <div class="wz__voci">
                @for (t of tipi; track t) {
                  <button type="button" class="wz__voce wz__voce--stretta"
                          [class.wz__voce--on]="tipoScelto() === t"
                          [class.wz__voce--sugg]="t === presuntoValido(r) && tipoScelto() !== t"
                          (click)="tipoScelto.set(t)">
                    <span class="wz__voce-txt"><b>{{ parola(t) }}</b></span>
                  </button>
                }
              </div>
            </section>

            <!-- L'effetto in euro si legge PRIMA di confermare, sempre (SPEC R4). -->
            @if (tipoScelto(); as t) {
              <section class="wz__esito" aria-live="polite">
                <p class="wz__effetto">
                  <mat-icon>check_circle</mat-icon>
                  <span>
                    <b>{{ r.importo | currency:'EUR' }}</b> entrano nel bilancio dell'evento
                    <b>«{{ eventoScelto()?.nome ?? 'Da attribuire — ' + (r.controparteNome || 'senza intestatario') }}»</b>
                    come {{ parola(t).toLowerCase() }}@if (competenza(r); as c) {, con competenza {{ c | date:'MMMM yyyy' }}}.
                    <br>
                    Il saldo del conto <b>non cambia</b>: il denaro è già arrivato.
                  </span>
                </p>
                <div class="wz__azioni">
                  <button mat-flat-button color="primary" [disabled]="salvando()" (click)="conferma()">
                    @if (salvando()) { <mat-spinner diameter="18"></mat-spinner> } @else { Va bene }
                  </button>
                  <button mat-button (click)="azzeraScelta()">Torna indietro</button>
                </div>
              </section>
            }
          }
        }

        <div class="wz__azioni wz__azioni--vuote">
          <button mat-stroked-button [disabled]="salvando()" (click)="nonEUnEvento(r)">
            <mat-icon>block</mat-icon> Non è un incasso evento
          </button>
          <button mat-stroked-button [disabled]="salvando()" (click)="rimanda()">
            <mat-icon>schedule</mat-icon> Non lo so, lascia in sospeso
          </button>
        </div>

        <agos-help-note tono="tip" titolo="Perché questi incassi sono qui" [collapsed]="true">
          <p>Sono bonifici che la causale fa sembrare il pagamento di un evento. Il denaro è
            <strong>già sul conto</strong>: quello che manca è <strong>a quale evento appartiene</strong>,
            senza cui non compare nel bilancio di nessuna festa.</p>
          <p><strong>L'evento lo scegli tu</strong>: quelli della data letta dalla causale sono in cima
            con una stella, ma nessuno è già spuntato — sul solo nome il sistema indovina 1 volta su 5,
            e sbagliare qui significa mettere i soldi nella festa di un altro cliente.</p>
          <p>Per correggere un'attribuzione già fatta si va sulla <strong>scheda dell'evento</strong>.</p>
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
      font-size: .82rem; color: var(--text-sub); overflow-wrap: anywhere; }
    .wz__blocco { margin: 10px 0 0; display: flex; align-items: center; gap: 8px;
      font-size: .9rem; color: var(--warning); }

    .wz__scelta h3, .wz__ramo h3 { margin: 0 0 12px; font-size: 1.05rem; font-weight: 600; }
    .wz__gruppo-tit { display: flex; align-items: center; gap: 6px; margin: 0 0 8px;
      font-size: .85rem; font-weight: 600; color: var(--accent-d); }
    .wz__gruppo-tit mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .wz__voci { display: flex; flex-wrap: wrap; gap: 10px; }
    .wz__cerca { width: 100%; margin: 12px 0 4px; }
    .wz__vuoto { margin: 0 0 10px; font-size: .88rem; color: var(--text-faint); }

    .wz__voce { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 16px;
      min-height: 56px; margin-bottom: 8px;
      border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card);
      cursor: pointer; text-align: left; font: inherit; color: var(--text-main);
      transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease); }
    .wz__voce:hover { border-color: var(--primary-l); background: var(--tint-primary); }
    .wz__voce:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .wz__voce--on { border-color: var(--primary); background: var(--tint-primary-strong); }
    .wz__voce--stretta { width: auto; margin-bottom: 0; }
    .wz__voce--sugg { border-color: var(--accent); }
    .wz__voce--segna mat-icon { color: var(--text-sub); flex-shrink: 0; }
    .wz__voce-txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .wz__voce-txt b { font-size: .95rem; font-weight: 600; }
    .wz__voce-txt small { font-size: .76rem; color: var(--text-sub); }

    .wz__nota { margin: 0 0 12px; display: flex; align-items: flex-start; gap: 8px;
      font-size: .86rem; color: var(--text-sub); }
    .wz__nota mat-icon { font-size: 17px; width: 17px; height: 17px; flex-shrink: 0; margin-top: 1px; }

    .wz__esito { background: var(--tint-success); border-radius: var(--radius-md); padding: 16px 18px;
      display: flex; flex-direction: column; gap: 14px; }
    .wz__effetto { margin: 0; display: flex; align-items: flex-start; gap: 9px;
      font-size: .95rem; line-height: 1.55; color: var(--text-main); }
    .wz__effetto mat-icon { color: var(--success); font-size: 19px; width: 19px; height: 19px;
      flex-shrink: 0; margin-top: 2px; }

    .wz__azioni { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .wz__azioni--vuote { padding-top: 4px; }

    @media (prefers-reduced-motion: reduce) {
      .wz__barra span, .wz__voce { transition: none; }
    }
  `],
})
export class IncassiEventoWizardComponent implements OnInit {
  private readonly movimenti = inject(MovimentiService);
  private readonly eventi = inject(EventiService);
  private readonly counts = inject(ImportCountsService);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(true);
  readonly caricamentoFallito = signal(false);
  readonly salvando = signal(false);

  readonly righe = signal<EventoParcheggiatoDTO[]>([]);
  readonly anagrafica = signal<EventoDTO[]>([]);
  readonly indice = signal(0);
  readonly rimandati = signal(0);

  readonly eventoScelto = signal<EventoDTO | null>(null);
  readonly segnaposto = signal(false);
  readonly tipoScelto = signal<TipoPagamentoEvento | null>(null);
  readonly filtro = signal('');

  readonly tipi = TIPI_PAGAMENTO_EVENTO;

  readonly corrente = computed(() => this.righe()[this.indice()] ?? null);

  /** Attribuibili: un evento SALDATO o ANNULLATO rifiuterebbe il pagamento (SPEC R5). */
  private readonly attribuibili = computed(() =>
    this.anagrafica().filter(e => !STATI_NON_ATTRIBUIBILI.includes(e.stato)));

  /**
   * Gli eventi della data letta dalla causale: salgono in cima con una stella, MAI selezionati.
   * È l'unico aiuto che le misure del 07–08/08 autorizzano — pre-compilare sul nome dà 20 %.
   */
  readonly inData = computed(() => {
    const d = this.corrente()?.dataEventoEstratta;
    return d ? this.attribuibili().filter(e => e.dataEvento === d) : [];
  });

  readonly trovati = computed(() => {
    const q = this.filtro().trim().toLowerCase();
    if (q.length < 2) return [];
    const inData = new Set(this.inData().map(e => e.id));
    return this.attribuibili()
      .filter(e => !inData.has(e.id))
      .filter(e => e.nome.toLowerCase().includes(q) || (e.contattoNome ?? '').toLowerCase().includes(q))
      .slice(0, 12);
  });

  ngOnInit(): void { this.ricarica(); }

  ricarica(): void {
    this.loading.set(true);
    this.caricamentoFallito.set(false);
    forkJoin({
      coda: this.movimenti.getEventiParcheggiati('DA_RICONCILIARE', 0, 2000),
      eventi: this.eventi.getList({ page: 0, size: 500 }),
    }).subscribe({
      next: ({ coda, eventi }) => {
        this.righe.set(coda.content);
        this.anagrafica.set(eventi.content);
        this.indice.set(0);
        this.rimandati.set(0);
        this.azzeraScelta();
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.caricamentoFallito.set(true); },
    });
  }

  conto(r: EventoParcheggiatoDTO): string {
    return r.contoBancarioId === 1 ? 'sul conto BPM'
      : r.contoBancarioId === 2 ? 'sul conto Crédit Agricole' : '';
  }

  parola(t: TipoPagamentoEvento): string { return PAROLE_TIPO[t]; }

  /** Il tipo letto dall'ETL, solo se è davvero un tipo di pagamento (AFFITTO_SALA non lo è). */
  presuntoValido(r: EventoParcheggiatoDTO): TipoPagamentoEvento | null {
    const p = r.tipoEventoPresunto as TipoPagamentoEvento | null;
    return p && (TIPI_PAGAMENTO_EVENTO as readonly string[]).includes(p) ? p : null;
  }

  /** Ciò che l'ETL ha letto ma non è un tipo valido: si dice, non si nasconde (SPEC R2). */
  presuntoNonValido(r: EventoParcheggiatoDTO): string | null {
    const p = r.tipoEventoPresunto;
    return p && !(TIPI_PAGAMENTO_EVENTO as readonly string[]).includes(p) ? p : null;
  }

  /** Quanto resta da incassare, quando l'anagrafica lo espone (campi ADMIN-only). */
  residuoLabel(e: EventoDTO): string {
    const prev = e.importoTotalePreviventivato, inc = e.importoIncassato;
    if (prev == null || inc == null) return '';
    const residuo = Number(prev) - Number(inc);
    return ` · resta ${residuo.toFixed(2)} €`;
  }

  /** La competenza economica del ricavo è la data dell'evento, non quella del bonifico. */
  competenza(r: EventoParcheggiatoDTO): string | null {
    return this.eventoScelto()?.dataEvento ?? r.dataEventoEstratta ?? r.dataMovimento;
  }

  scegliEvento(e: EventoDTO): void {
    this.eventoScelto.set(e);
    this.segnaposto.set(false);
    this.preselezionaTipo();
  }

  scegliSegnaposto(): void {
    this.eventoScelto.set(null);
    this.segnaposto.set(true);
    this.preselezionaTipo();
  }

  /**
   * Il TIPO sì, l'evento no: sul tipo l'ETL ha misurato 25 letture giuste su 26 e sbagliarlo non
   * sposta denaro su un altro cliente — resta comunque modificabile con un click (R4 SPEC madre).
   */
  private preselezionaTipo(): void {
    const r = this.corrente();
    if (r && this.tipoScelto() == null) this.tipoScelto.set(this.presuntoValido(r));
  }

  azzeraScelta(): void {
    this.eventoScelto.set(null);
    this.segnaposto.set(false);
    this.tipoScelto.set(null);
    this.filtro.set('');
  }

  /** «Non lo so»: la riga resta in coda, si passa alla prossima. Nessuna chiamata al server. */
  rimanda(): void {
    this.rimandati.update(n => n + 1);
    this.azzeraScelta();
    this.indice.update(i => (i + 1) % Math.max(1, this.righe().length));
  }

  /** «Non è un incasso evento»: SCARTA — la riga esce dalla coda senza creare nulla. */
  nonEUnEvento(r: EventoParcheggiatoDTO): void {
    this.salvando.set(true);
    this.movimenti.risolviEvento(r.id, {
      azione: 'SCARTA', cogeId: null, businessUnitId: null, eventoId: null,
      nota: 'Non è un incasso evento',
    }).subscribe({
      next: () => this.dopoAzione(r, 'Incasso messo da parte: non entra nel bilancio di nessun evento'),
      error: err => this.fallito(err),
    });
  }

  conferma(): void {
    const r = this.corrente();
    const tipo = this.tipoScelto();
    const evento = this.eventoScelto();
    if (!r || !tipo || (!evento && !this.segnaposto())) return;

    this.salvando.set(true);
    this.movimenti.risolviEvento(r.id, {
      // RICONCILIA è l'unica azione che contabilizza, e lo fa dal modulo Eventi (invariante
      // DACLASS): il wizard attribuisce, non crea movimenti. CLASSIFICA resta vietata dal server.
      azione: 'RICONCILIA', cogeId: null, businessUnitId: null,
      eventoId: evento?.id ?? null, creaSegnaposto: !evento,
      tipo, nota: null,
    }).subscribe({
      next: () => this.dopoAzione(r, evento
        ? `Incasso attribuito a «${evento.nome}»`
        : 'Incasso messo in un contenitore «Da attribuire»: potrai spostarlo sull\'evento vero'),
      error: err => this.fallito(err),
    });
  }

  private dopoAzione(r: EventoParcheggiatoDTO, messaggio: string): void {
    this.salvando.set(false);
    this.righe.update(list => list.filter(x => x.id !== r.id));
    if (this.indice() >= this.righe().length) this.indice.set(0);
    this.azzeraScelta();
    this.counts.reload();
    this.snackBar.open(messaggio, 'OK', { duration: 3000 });
  }

  /**
   * Un rifiuto del percorso-soldi arriva come frase con una via d'uscita, non come codice: il
   * messaggio del server contiene gli importi, la UI ci aggiunge la mossa successiva (SPEC R6).
   */
  private static readonly VIE_DUSCITA: Record<string, string> = {
    IMPORTO_SUPERA_RESIDUO:
      'Correggi il preventivo dell\'evento (Eventi → voci), oppure metti l\'incasso in un contenitore «Da attribuire».',
    EVENTO_SALDATO:
      'L\'evento risulta già saldato: riaprilo dalla sua scheda, oppure usa un contenitore «Da attribuire».',
    EVENTO_ANNULLATO:
      'Su un evento annullato entra solo una penale: cambia il tipo, oppure scegli un altro evento.',
    RIMBORSO_SUPERA_INCASSATO:
      'Il rimborso non può superare quanto già incassato sull\'evento: verifica l\'evento scelto.',
    EVENTO_GIA_RISOLTO:
      'Questo incasso è già stato attribuito (magari da un\'altra finestra): ricarico la coda.',
    CONTO_BANCARIO_MANCANTE:
      'Assegna prima la banca alla riga (Movimenti → «Senza banca»), poi riprova.',
    TIPO_EVENTO_NON_VALIDO:
      'Scegli uno dei tipi ammessi: caparra, acconto, saldo, penale, rimborso.',
    EVENTO_NON_CONTABILIZZABILE:
      'Un incasso-evento non diventa un movimento generico: attribuiscilo a un evento (o a un contenitore «Da attribuire»).',
  };

  private fallito(err: { error?: { message?: string; code?: string } }): void {
    this.salvando.set(false);
    const base = err.error?.message ?? 'Operazione non riuscita';
    const via = err.error?.code ? IncassiEventoWizardComponent.VIE_DUSCITA[err.error.code] : undefined;
    this.snackBar.open(via ? `${base} — ${via}` : base, 'OK', { duration: via ? 12000 : 5000 });
    if (err.error?.code === 'EVENTO_GIA_RISOLTO') this.ricarica();
  }
}
