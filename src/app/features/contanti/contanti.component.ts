import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, forkJoin } from 'rxjs';

import { ContantiService } from '../../core/services/contanti.service';
import { ContiService } from '../../core/services/conti.service';
import { FornitoriService } from '../../core/services/fornitori.service';
import { LookupService } from '../../core/services/lookup.service';
import { EsitoContaDTO, SaldoContantiDTO } from '../../core/models/contanti.models';
import { MovimentoDTO } from '../../core/models/movimenti.models';
import {
  ContoBancarioDTO,
  FornitoreSummaryDTO,
  PianoContiCogeDTO,
} from '../../core/models/anagrafica.models';
import { BuSelectorComponent } from '../../shared/components/bu-selector/bu-selector.component';
import { CogePickerComponent } from '../../shared/components/coge-picker/coge-picker.component';
import { CurrencyInputComponent } from '../../shared/components/currency-input/currency-input.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';

type Op = 'prelievo' | 'deposito' | 'incasso' | 'spesa' | 'conta';

/** Il colore dice il *verso*: entra in cassa (success), esce (accent/danger), verifica (info). */
type Tono = 'success' | 'accent' | 'danger' | 'info';

interface OpMeta {
  id: Op;
  icona: string;
  titolo: string;
  sotto: string;
  tono: Tono;
}

/** Le cinque operazioni di SPEC modulo-contanti §1, nell'ordine in cui capitano davvero. */
const OPS: readonly OpMeta[] = [
  { id: 'prelievo', icona: 'savings',         titolo: 'Prelievo da banca',   tono: 'success',
    sotto: 'Ho preso contanti dalla banca e li ho messi in cassa.' },
  { id: 'deposito', icona: 'account_balance', titolo: 'Deposito in banca',   tono: 'accent',
    sotto: 'Ho preso contanti dalla cassa e li ho versati in banca.' },
  { id: 'incasso',  icona: 'payments',        titolo: 'Incasso in contanti', tono: 'success',
    sotto: 'Qualcuno mi ha pagato in contanti.' },
  { id: 'spesa',    icona: 'shopping_bag',    titolo: 'Spesa in contanti',   tono: 'danger',
    sotto: 'Ho pagato qualcosa coi contanti della cassa.' },
  { id: 'conta',    icona: 'fact_check',      titolo: 'Conta cassa',         tono: 'info',
    sotto: 'Ho contato il cassetto: allineo il saldo a quello che c’è davvero.' },
];

const trova = (id: Op): OpMeta => OPS.find(o => o.id === id)!;

/**
 * Le cinque operazioni raggruppate per natura: due spostano denaro fra i miei contenitori,
 * due sono denaro che entra o esce davvero, una è una verifica. Serve a leggere la pagina in
 * tre secondi — non è decorazione, è la stessa distinzione che regge l'invariante I3 (i
 * giroconti di cassa restano fuori dal P&L, incassi e spese no).
 */
const GRUPPI: readonly { titolo: string; icona: string; ops: readonly OpMeta[] }[] = [
  { titolo: 'Fra cassa e banca',    icona: 'swap_horiz', ops: [trova('prelievo'), trova('deposito')] },
  { titolo: 'Movimenti in contanti', icona: 'payments',  ops: [trova('incasso'), trova('spesa')] },
  { titolo: 'Controllo del cassetto', icona: 'fact_check', ops: [trova('conta')] },
];

/**
 * Gli stessi conti che si possono scegliere nel wizard spese (`spese-wizard.component.ts`):
 * fuori il mastro dei ricavi-evento e i due transitori dell'import. Nasconderli è cortesia —
 * la guardia vera è server-side (R4: `CogeRiservatoEventi` + `CogeTransitorio`).
 */
const SELEZIONABILE = (c: PianoContiCogeDTO): boolean =>
  !c.codice.startsWith('30.02.') && c.codice !== '39.99.999' && c.codice !== '49.99.999';

/** Il denaro si conta al centesimo: i float di JS no. */
const cent = (n: number): number => Math.round(n * 100) / 100;

/**
 * Pagina «Contanti» (docs/specs/modulo-contanti.md, R12/R13).
 *
 * <p>Il cassetto non ha estratto conto: esiste solo se qualcuno lo scrive. Qui si vede il saldo
 * <b>live</b> (non dalla materialized view, che è asincrona) e si registra una delle cinque
 * operazioni chiedendo solo ciò che va deciso — conto, metodo, data finanziaria, stato, fonte
 * ed evento li impone il server.
 *
 * <p><b>Trappola OnPush evitata di proposito</b> (§6, già costata due bug): il saldo proiettato è
 * un `computed()` che legge <i>signal</i> aggiornati da `(ngModelChange)`, mai `FormControl.value`
 * né un campo `ngModel` — un computed che legge quelli resta congelato.
 *
 * <p>Storico e annullamento non sono qui: `/movimenti` filtra già per conto e
 * `DELETE /api/movimenti/{id}` annulla senza cancellare (R9/R10, §5 fuori scopo).
 *
 * <p><b>Pelle</b>: registro visivo della Dashboard (card + striscia d'accento in alto + pastiglia
 * icona tinta, `features/dashboard/dashboard.component.scss`). Solo token di `styles.scss`,
 * nessun colore letterale: il tema scuro si adatta da sé.
 */
@Component({
  selector: 'app-contanti',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe, DatePipe, FormsModule,
    MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatProgressSpinnerModule, MatSelectModule,
    BuSelectorComponent, CogePickerComponent, CurrencyInputComponent,
    EmptyStateComponent, HelpNoteComponent,
  ],
  template: `
    <div class="ct">
      <header class="ct__head">
        <span class="ct__eyebrow">Cassa fisica</span>
        <h1>Contanti</h1>
        <p class="ct__head-sub">Il cassetto non ha estratto conto: quello che non scrivi qui, non lo sa nessuno.</p>
      </header>

      @if (caricamento()) {
        <div class="card ct__centro">
          <mat-spinner diameter="36"></mat-spinner>
          <p>Leggo il saldo di cassa…</p>
        </div>
      } @else if (!saldo()) {
        <div class="card">
          <agos-empty-state
            icon="cloud_off"
            title="Saldo di cassa non disponibile"
            subtitle="Non è stato possibile leggerlo. Nessun dato è stato toccato."
            actionLabel="Riprova"
            (action)="ricarica()" />
        </div>
      } @else if (saldo(); as s) {

        <!-- Il saldo è il protagonista: è l'unico numero che qui nessun estratto conto conferma. -->
        <section class="card ct__hero ct-t--primary" aria-live="polite">
          <div class="ct__hero-txt">
            <span class="ct__hero-lab">In cassa adesso</span>
            <!-- @for con track sul valore: quando il saldo cambia il nodo viene ricreato e la
                 micro-animazione riparte. Nessuna libreria, nessuno stato in più. -->
            @for (v of [s.saldo]; track v) {
              <strong class="ct__hero-cifra">{{ v | currency:'EUR' }}</strong>
            }
            <span class="ct__hero-nota">
              {{ s.nome }}
              @if (s.dataSaldoIniziale) {
                · saldo aperto il {{ s.dataSaldoIniziale | date:'d MMMM yyyy' }}
              }
            </span>
          </div>
          <span class="ct__hero-ic" aria-hidden="true"><mat-icon>account_balance_wallet</mat-icon></span>
        </section>

        @if (!op()) {
          @for (g of gruppi; track g.titolo) {
            <section class="ct__gruppo">
              <div class="ct__gruppo-h">
                <mat-icon aria-hidden="true">{{ g.icona }}</mat-icon>
                <h2>{{ g.titolo }}</h2>
              </div>
              <div class="ct__ops">
                @for (o of g.ops; track o.id) {
                  <button type="button" class="card card--interactive ct__op ct-t--{{ o.tono }}"
                          (click)="apri(o.id)">
                    <span class="ct__op-ic" aria-hidden="true"><mat-icon>{{ o.icona }}</mat-icon></span>
                    <span class="ct__op-t">{{ o.titolo }}</span>
                    <span class="ct__op-s">{{ o.sotto }}</span>
                  </button>
                }
              </div>
            </section>
          }

          <agos-help-note tono="info" [collapsed]="true" titolo="Perché una gamba sola?">
            Ogni operazione qui scrive <b>solo</b> il movimento di cassa. La riga della banca —
            il prelievo al bancomat, il versamento allo sportello — arriva da sola con l'import
            dell'estratto conto: le due si annullano fra loro e la liquidità totale non cambia.
            Per questo il giroconto fra due banche non si registra da qui: l'import porta già
            entrambe le gambe.
          </agos-help-note>

        } @else if (meta(); as m) {

          <section class="card ct__wz ct-t--{{ m.tono }}">
            <header class="ct__wz-head">
              <span class="ct__wz-ic" aria-hidden="true"><mat-icon>{{ m.icona }}</mat-icon></span>
              <div class="ct__wz-tit">
                <h2>{{ m.titolo }}</h2>
                <p>{{ m.sotto }}</p>
              </div>
              <button type="button" class="ct__back" (click)="chiudi()" [disabled]="inviando()">
                <mat-icon aria-hidden="true">arrow_back</mat-icon>
                <span>Tutte le operazioni</span>
              </button>
            </header>

            <div class="ct__campi">
              @if (op() === 'conta') {
                <agos-currency-input label="Quanto c'è davvero nel cassetto"
                                     [ngModel]="contato()" (ngModelChange)="contato.set($event)"
                                     [required]="true" name="contato"></agos-currency-input>
              } @else {
                <agos-currency-input label="Importo"
                                     [ngModel]="importo()" (ngModelChange)="importo.set($event)"
                                     [required]="true" name="importo"></agos-currency-input>
              }

              <!-- Nativo, e con max = oggi: una data futura verrebbe rifiutata dal server con un
                   400 su un campo che l'utente non ha mai visto (edge case §4). -->
              <mat-form-field appearance="outline">
                <mat-label>Data</mat-label>
                <input matInput type="date" [max]="oggi"
                       [ngModel]="data()" (ngModelChange)="data.set($event)" name="data" required>
              </mat-form-field>

              @if (op() === 'prelievo' || op() === 'deposito') {
                <mat-form-field appearance="outline">
                  <mat-label>{{ op() === 'prelievo' ? 'Da quale banca' : 'Su quale banca' }}</mat-label>
                  <mat-select [ngModel]="contoBancarioId()" (ngModelChange)="contoBancarioId.set($event)"
                              name="banca" required>
                    @for (b of banche(); track b.id) {
                      <mat-option [value]="b.id">{{ b.nome }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }

              @if (op() === 'incasso' || op() === 'spesa') {
                <app-coge-picker
                  [label]="op() === 'incasso' ? 'Che incasso è' : 'Che spesa è'"
                  [tipoFilter]="op() === 'incasso' ? ['RICAVO'] : ['COSTO']"
                  [allowedIds]="cogeAmmessi()"
                  [required]="true"
                  [value]="contoCoge()"
                  (cogeChange)="contoCoge.set($event?.id ?? null)"></app-coge-picker>

                <agos-bu-selector label="Su quale ramo" [required]="true"
                                  [ngModel]="businessUnitId()" (ngModelChange)="businessUnitId.set($event)"
                                  name="bu"></agos-bu-selector>

                <!-- Il fornitore sta prima della descrizione: così i campi stretti riempiono le
                     colonne e la descrizione (larga) chiude la griglia senza buchi. -->
                @if (op() === 'spesa') {
                  <mat-form-field appearance="outline">
                    <mat-label>Fornitore (facoltativo)</mat-label>
                    <mat-select [ngModel]="fornitoreId()" (ngModelChange)="fornitoreId.set($event)"
                                name="fornitore">
                      <mat-option [value]="null">— nessuno —</mat-option>
                      @for (f of fornitori(); track f.id) {
                        <mat-option [value]="f.id">{{ f.ragioneSociale }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                }

                <mat-form-field appearance="outline" class="ct__wide">
                  <mat-label>Descrizione</mat-label>
                  <input matInput maxlength="500"
                         [ngModel]="descrizione()" (ngModelChange)="descrizione.set($event)"
                         name="descrizione" required>
                </mat-form-field>
              }

              @if (op() === 'conta') {
                <mat-form-field appearance="outline" class="ct__wide">
                  <mat-label>Perché non torna</mat-label>
                  <input matInput maxlength="400"
                         [ngModel]="motivo()" (ngModelChange)="motivo.set($event)"
                         name="motivo" required placeholder="es. mancia non registrata, resto sbagliato…">
                </mat-form-field>
              }
            </div>

            <!-- L'effetto in euro PRIMA del click che scrive: nessuna conferma alla cieca (R13). -->
            <div class="ct__eff" [class.ct__eff--ko]="fondiInsufficienti()">
              @if (proiezione() === null) {
                <p class="ct__eff-vuoto">
                  Compila i campi: prima di registrare qui vedi come cambia il saldo di cassa.
                </p>
              } @else {
                <div class="ct__eff-c">
                  <span>Saldo oggi</span>
                  <b>{{ saldo()!.saldo | currency:'EUR' }}</b>
                </div>
                <mat-icon class="ct__eff-fr" aria-hidden="true">arrow_forward</mat-icon>
                <div class="ct__eff-c ct__eff-c--dopo">
                  <span>Dopo questa operazione</span>
                  <b>{{ proiezione()! | currency:'EUR' }}</b>
                </div>
                @if (op() === 'conta' && deltaConta() === 0) {
                  <p class="ct__eff-nota">Nessuna differenza: non verrà scritto niente.</p>
                }
              }
            </div>

            @if (fondiInsufficienti()) {
              <p class="ct__avviso ct__avviso--ko">
                <mat-icon aria-hidden="true">block</mat-icon>
                <!-- il testo sta in uno <span>: dentro un flex ogni nodo di testo e ogni <b>
                     diventerebbero flex item separati e la frase si spezzerebbe. -->
                <span>In cassa non ci sono abbastanza contanti: dal cassetto non può uscire
                  denaro che non c'è.</span>
              </p>
            }

            @if (fuoriSaldo()) {
              <p class="ct__avviso">
                <mat-icon aria-hidden="true">warning_amber</mat-icon>
                <span>Questa data è al {{ saldo()!.dataSaldoIniziale | date:'d MMMM yyyy' }} o prima,
                  cioè all'apertura del saldo di cassa: il movimento verrà salvato e resterà nello
                  storico, ma <b>non cambierà il saldo</b>.</span>
              </p>
            }

            @if (op() === 'deposito') {
              <agos-help-note tono="tip" [collapsed]="true" titolo="E la riga della banca?">
                Su Banco BPM il versamento allo sportello (causale 78A) l'import lo riconosce da solo
                e non duplica questa uscita di cassa. Su Crédit Agricole no: quella riga arriverà
                nello smistamento e va sistemata a mano.
              </agos-help-note>
            }

            <footer class="ct__azioni">
              <button mat-stroked-button type="button" (click)="chiudi()" [disabled]="inviando()">
                Annulla
              </button>
              <button mat-flat-button color="primary" type="button"
                      [disabled]="!valido() || fondiInsufficienti() || inviando()"
                      (click)="conferma()">
                @if (inviando()) { Registro… } @else { Registra }
              </button>
            </footer>
          </section>
        }
      }
    </div>
  `,
  styles: [`
    /* Il tono cromatico del verso viaggia in una sola variabile: strisce, pastiglie e bordi
       la leggono. Cambiare colore a un'operazione = cambiare una riga in OPS. */
    .ct-t--primary { --ct-c: var(--primary); }
    .ct-t--success { --ct-c: var(--success); }
    .ct-t--accent  { --ct-c: var(--accent); }
    .ct-t--danger  { --ct-c: var(--danger); }
    .ct-t--info    { --ct-c: var(--info); }

    .ct { padding: 24px; display: flex; flex-direction: column; gap: 20px; max-width: 920px; }

    /* ── Testata ─────────────────────────────────────────────────────────── */
    .ct__head { display: flex; flex-direction: column; gap: 2px; }
    .ct__eyebrow { display: inline-flex; align-items: center; gap: 7px; font-size: 11px;
      font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--primary); }
    .ct__eyebrow::before { content: ''; width: 18px; height: 2px; border-radius: 999px;
      background: var(--accent); }
    .ct__head h1 { font-size: 26px; color: var(--primary-d); }
    /* muted, ma non sotto il 4.5:1 — il grigio dei sottotitoli è tarato sul fondo card,
       qui il fondo è --surface. */
    .ct__head-sub { margin: 2px 0 0; font-size: 0.92rem; line-height: 1.45;
      color: color-mix(in srgb, var(--text-main) 74%, var(--surface)); }

    .ct__centro { display: flex; flex-direction: column; align-items: center; gap: 14px;
      padding: 48px 24px; color: var(--text-sub); text-align: center; }
    .ct__centro p { font-size: 0.9rem; }

    /* ── Saldo hero ──────────────────────────────────────────────────────── */
    .ct__hero { position: relative; overflow: hidden; display: flex; align-items: center;
      gap: 20px; padding: 22px 24px; }
    .ct__hero::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 3px;
      background: var(--ct-c); }
    .ct__hero-txt { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .ct__hero-lab { font-size: 12px; font-weight: 500; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--text-sub); }
    .ct__hero-cifra { font-size: 40px; font-weight: 600; line-height: 1.05; letter-spacing: -0.02em;
      color: var(--text-main); font-variant-numeric: tabular-nums;
      animation: ct-rise var(--t-base) var(--ease); }
    .ct__hero-nota { font-size: 12.5px; color: var(--text-sub); }
    .ct__hero-ic { margin-left: auto; flex-shrink: 0; width: 56px; height: 56px;
      border-radius: var(--radius-md); display: grid; place-items: center;
      background: color-mix(in srgb, var(--ct-c) 14%, transparent); color: var(--ct-c); }
    .ct__hero-ic mat-icon { font-size: 28px; width: 28px; height: 28px; }

    /* ── Gruppi di operazioni ────────────────────────────────────────────── */
    .ct__gruppo { display: flex; flex-direction: column; gap: 12px; }
    .ct__gruppo-h { display: flex; align-items: center; gap: 8px; color: var(--primary); }
    .ct__gruppo-h mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .ct__gruppo-h h2 { font-family: inherit; font-size: 13px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.06em; color: inherit; }

    .ct__ops { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .ct__op { position: relative; overflow: hidden; display: grid;
      grid-template-columns: auto 1fr; grid-template-rows: auto auto; gap: 3px 14px;
      align-items: start; text-align: left; padding: 18px; font: inherit; }
    .ct__op::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 3px;
      background: var(--ct-c); }
    .ct__op-ic { grid-row: 1 / span 2; align-self: center; width: 42px; height: 42px;
      border-radius: var(--radius-md); display: grid; place-items: center;
      background: color-mix(in srgb, var(--ct-c) 14%, transparent); color: var(--ct-c);
      transition: background var(--t-base) var(--ease); }
    .ct__op:hover { border-color: color-mix(in srgb, var(--ct-c) 38%, var(--border)); }
    .ct__op:hover .ct__op-ic { background: color-mix(in srgb, var(--ct-c) 22%, transparent); }
    .ct__op:active { transform: translateY(0); box-shadow: var(--shadow-sm); }
    .ct__op:focus-visible { outline: 2px solid var(--ct-c); outline-offset: 2px; }
    .ct__op-t { font-weight: 650; font-size: 0.95rem; color: var(--text-main); }
    .ct__op-s { font-size: 0.82rem; color: var(--text-sub); line-height: 1.4; }

    /* ── Pannello operazione ─────────────────────────────────────────────── */
    .ct__wz { position: relative; overflow: hidden; padding: 20px 22px; display: flex;
      flex-direction: column; gap: 16px; animation: ct-in var(--t-base) var(--ease); }
    .ct__wz::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 3px;
      background: var(--ct-c); }
    .ct__wz-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .ct__wz-ic { flex-shrink: 0; width: 42px; height: 42px; border-radius: var(--radius-md);
      display: grid; place-items: center;
      background: color-mix(in srgb, var(--ct-c) 14%, transparent); color: var(--ct-c); }
    .ct__wz-tit { min-width: 0; }
    .ct__wz-tit h2 { font-size: 1.15rem; color: var(--text-main); }
    .ct__wz-tit p { margin: 2px 0 0; font-size: 0.86rem; color: var(--text-sub); line-height: 1.4; }
    .ct__back { margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 11px; border: 1px solid var(--border-strong); border-radius: 999px;
      background: var(--card); color: var(--text-sub); font: inherit; font-size: 12px;
      font-weight: 650; cursor: pointer; transition: color var(--t-fast) var(--ease),
      border-color var(--t-fast) var(--ease); }
    .ct__back mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ct__back:hover:not(:disabled) { border-color: var(--primary-l); color: var(--primary); }
    .ct__back:disabled { opacity: 0.5; cursor: not-allowed; }

    .ct__campi { display: grid; gap: 4px 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .ct__campi > * { min-width: 0; }
    .ct__wide { grid-column: 1 / -1; }

    /* ── Effetto sul saldo (R13) ─────────────────────────────────────────── */
    /* Fondo calcolato sulla card invece che con --tint-*: la tinta piena porterebbe il rosso
       della cifra proiettata a 4,42:1 in tema scuro (misurato). Al 7-8% resta ≥ 4,95:1 ovunque. */
    .ct__eff { display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
      padding: 14px 16px; border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--primary) 7%, var(--card)); }
    .ct__eff--ko { background: color-mix(in srgb, var(--danger) 8%, var(--card)); }
    .ct__eff-c { display: flex; flex-direction: column; gap: 2px; }
    .ct__eff-c span { font-size: 11.5px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--text-main); }
    .ct__eff-c b { font-size: 20px; font-weight: 700; letter-spacing: -0.01em;
      color: var(--text-main); font-variant-numeric: tabular-nums; }
    .ct__eff-c--dopo b { color: var(--primary); }
    .ct__eff--ko .ct__eff-c--dopo b { color: var(--danger); }
    .ct__eff-fr { color: var(--text-main); font-size: 20px; width: 20px; height: 20px; }
    .ct__eff-vuoto { font-size: 0.9rem; line-height: 1.45; color: var(--text-main); }
    .ct__eff-nota { flex-basis: 100%; font-size: 0.82rem; color: var(--text-main); }

    /* ── Avvisi ──────────────────────────────────────────────────────────── */
    .ct__avviso { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px;
      border-radius: var(--radius-md); background: var(--tint-warning); color: var(--text-main);
      font-size: 0.88rem; line-height: 1.45; }
    .ct__avviso mat-icon { flex-shrink: 0; font-size: 20px; width: 20px; height: 20px;
      color: var(--warning); }
    .ct__avviso--ko { background: var(--tint-danger); }
    .ct__avviso--ko mat-icon { color: var(--danger); }

    .ct__azioni { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; margin-top: 4px; }

    /* ── Micro-interazioni ───────────────────────────────────────────────── */
    @keyframes ct-in   { from { opacity: 0; transform: translateY(6px); } }
    @keyframes ct-rise { from { opacity: 0; transform: translateY(4px); } }

    @media (prefers-reduced-motion: reduce) {
      .ct__wz, .ct__hero-cifra { animation: none; }
      .ct__op-ic, .ct__back { transition: none; }
    }

    /* ── Responsive ──────────────────────────────────────────────────────── */
    @media (max-width: 640px) {
      .ct { padding: 16px; gap: 16px; }
      .ct__hero { padding: 18px; gap: 14px; }
      .ct__hero-cifra { font-size: 32px; }
      .ct__hero-ic { width: 46px; height: 46px; }
      .ct__hero-ic mat-icon { font-size: 24px; width: 24px; height: 24px; }
      .ct__ops { grid-template-columns: 1fr; }
      .ct__wz { padding: 18px 16px; }
      .ct__back { margin-left: 0; }
      .ct__azioni { flex-direction: column-reverse; }
      .ct__azioni button { width: 100%; }
    }
  `],
})
export class ContantiComponent implements OnInit {

  private readonly contanti = inject(ContantiService);
  private readonly conti = inject(ContiService);
  private readonly fornitoriSvc = inject(FornitoriService);
  private readonly lookup = inject(LookupService);
  private readonly snackBar = inject(MatSnackBar);

  readonly gruppi = GRUPPI;
  readonly oggi = new Date().toISOString().slice(0, 10);

  readonly caricamento = signal(true);
  readonly inviando = signal(false);
  readonly saldo = signal<SaldoContantiDTO | null>(null);
  readonly banche = signal<ContoBancarioDTO[]>([]);
  readonly fornitori = signal<FornitoreSummaryDTO[]>([]);
  readonly cogeAmmessi = signal<number[]>([]);

  readonly op = signal<Op | null>(null);

  // Campi del wizard. Sono signal e non FormControl proprio perché `proiezione` li legge da un
  // computed: un computed che legge FormControl.value sotto OnPush resta congelato (§6).
  readonly importo = signal<number | null>(null);
  readonly contato = signal<number | null>(null);
  readonly data = signal<string>(this.oggi);
  readonly contoBancarioId = signal<number | null>(null);
  readonly contoCoge = signal<number | null>(null);
  readonly businessUnitId = signal<number | null>(null);
  readonly descrizione = signal('');
  readonly fornitoreId = signal<string | null>(null);
  readonly motivo = signal('');

  readonly meta = computed(() => OPS.find(o => o.id === this.op()) ?? null);

  /** Differenza fra il contato e il teorico: zero = nessun movimento (R6). */
  readonly deltaConta = computed(() => {
    const s = this.saldo(), c = this.contato();
    return s && c != null ? cent(c - s.saldo) : null;
  });

  /** Il saldo di cassa dopo l'operazione, o null finché non c'è un importo da proiettare. */
  readonly proiezione = computed<number | null>(() => {
    const s = this.saldo(), op = this.op();
    if (!s || !op) return null;
    if (op === 'conta') return this.contato();
    const i = this.importo();
    if (i == null) return null;
    return cent(op === 'prelievo' || op === 'incasso' ? s.saldo + i : s.saldo - i);
  });

  /** Invariante I1 lato UI. La guardia vera è il 409 FONDI_INSUFFICIENTI del server. */
  readonly fondiInsufficienti = computed(() => {
    const p = this.proiezione();
    return (this.op() === 'deposito' || this.op() === 'spesa') && p != null && p < 0;
  });

  /** Data ≤ apertura del saldo: il movimento si salva ma resta fuori dal saldo (edge case §4). */
  readonly fuoriSaldo = computed(() => {
    const apertura = this.saldo()?.dataSaldoIniziale;
    return !!apertura && !!this.data() && this.data() <= apertura;
  });

  readonly valido = computed(() => {
    if (!this.data()) return false;
    switch (this.op()) {
      case 'prelievo':
      case 'deposito':
        return !!this.importo() && this.importo()! > 0 && this.contoBancarioId() != null;
      case 'incasso':
      case 'spesa':
        return !!this.importo() && this.importo()! > 0
            && this.contoCoge() != null && this.businessUnitId() != null
            && this.descrizione().trim().length > 0;
      case 'conta':
        return this.contato() != null && this.contato()! >= 0 && this.motivo().trim().length > 0;
      default:
        return false;
    }
  });

  ngOnInit(): void { this.ricarica(); }

  ricarica(): void {
    this.caricamento.set(true);
    forkJoin({
      saldo: this.contanti.saldo(),
      conti: this.conti.getAll(),
      fornitori: this.fornitoriSvc.getList({ size: 200 }),
      coge: this.lookup.getPianoConti(),
    }).subscribe({
      next: r => {
        this.saldo.set(r.saldo);
        // conti_bancari è dato di runtime: si legge, non si hardcodano «i due conti».
        this.banche.set(r.conti.filter(c => c.tipo !== 'CASSA'));
        this.fornitori.set(r.fornitori.content);
        this.cogeAmmessi.set(r.coge.filter(SELEZIONABILE).map(c => c.id));
        this.caricamento.set(false);
      },
      error: () => { this.saldo.set(null); this.caricamento.set(false); },
    });
  }

  apri(op: Op): void {
    this.reset();
    this.op.set(op);
  }

  chiudi(): void {
    this.op.set(null);
    this.reset();
  }

  conferma(): void {
    const op = this.op();
    if (!op || !this.valido() || this.inviando()) return;
    this.inviando.set(true);

    const data = this.data();
    const importo = this.importo() ?? 0;
    // Union esplicita: le cinque chiamate hanno risposte diverse (movimento creato vs esito conta)
    // e TypeScript non sa chiamare `subscribe` su una union di Observable.
    const chiamata: Observable<MovimentoDTO | EsitoContaDTO> =
      op === 'prelievo' ? this.contanti.prelievo({ importo, data, contoBancarioId: this.contoBancarioId()! })
    : op === 'deposito' ? this.contanti.deposito({ importo, data, contoBancarioId: this.contoBancarioId()! })
    : op === 'incasso'  ? this.contanti.incasso({ importo, data, contoCoge: this.contoCoge()!,
                                                  businessUnitId: this.businessUnitId()!,
                                                  descrizione: this.descrizione().trim() })
    : op === 'spesa'    ? this.contanti.spesa({ importo, data, contoCoge: this.contoCoge()!,
                                                businessUnitId: this.businessUnitId()!,
                                                descrizione: this.descrizione().trim(),
                                                fornitoreId: this.fornitoreId() })
    :                     this.contanti.conta({ contato: this.contato()!, data,
                                                motivo: this.motivo().trim() });

    chiamata.subscribe({
      next: esito => {
        const nulla = op === 'conta' && (esito as { creato?: boolean }).creato === false;
        this.snackBar.open(
          nulla ? 'Il contato coincide col saldo: non c’era niente da correggere.' : 'Registrato.',
          'OK', { duration: 4000 });
        this.chiudi();
        this.ricarica();   // il saldo si rilegge dal server: qui non si fa aritmetica di fiducia
      },
      error: err => {
        this.inviando.set(false);
        this.snackBar.open(err.error?.message ?? 'Operazione non riuscita', 'OK', { duration: 6000 });
      },
    });
  }

  private reset(): void {
    this.inviando.set(false);
    this.importo.set(null);
    this.contato.set(null);
    this.data.set(this.oggi);
    this.contoBancarioId.set(null);
    this.contoCoge.set(null);
    this.businessUnitId.set(null);
    this.descrizione.set('');
    this.fornitoreId.set(null);
    this.motivo.set('');
  }
}
