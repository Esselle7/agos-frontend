import { Component, OnInit, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { forkJoin } from 'rxjs';

import { MovimentiService } from '../../core/services/movimenti.service';
import { LookupService } from '../../core/services/lookup.service';
import { BuService } from '../../core/services/bu.service';
import { TransitorioDTO, FirmaSceltaDTO } from '../../core/models/movimenti.models';
import { PianoContiCogeDTO, BusinessUnitDTO } from '../../core/models/anagrafica.models';
import { CogePickerComponent } from '../../shared/components/coge-picker/coge-picker.component';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';
import { IndiceCodaComponent, VoceCoda } from '../../shared/components/indice-coda/indice-coda.component';
import { ImportCountsService } from './import-counts.service';

/** Le stesse chiavi del picker: i conti già usati sono le scorciatoie del wizard. */
const RECENTS_KEY = 'agos_coge_recents';
/** BU 5 = Overhead, il fallback del motore: non è una risposta, è l'assenza di risposta. */
const BU_FALLBACK = 5;

/**
 * I conti che si possono scegliere qui. Fuori restano quelli che il server rifiuta comunque con un
 * 409: il mastro dei ricavi-evento (`30.02.*`, → `CogeRiservatoEventi`) e i due conti d'attesa
 * dell'import (→ `CogeTransitorio`) — catalogare una riga sul conto «da classificare» vorrebbe dire
 * dichiararla non classificata. Nasconderli è cortesia; la guardia è lato server.
 */
const SELEZIONABILE = (c: PianoContiCogeDTO): boolean =>
  !c.codice.startsWith('30.02.') && c.codice !== '39.99.999' && c.codice !== '49.99.999';

/** Un esercente = una decisione: la riga in testa più le sue gemelle da sistemare insieme. */
interface Gruppo {
  chiave: string;
  righe: TransitorioDTO[];
}

/**
 * Wizard «Che spesa è questa?» (docs/specs/wizard-spese-da-sistemare.md, audit import §7.1).
 *
 * <p>Sostituisce la griglia `/import/smistamento/catalogare` e assorbe le code «Effetti / RiBa»
 * (§7.7) e «Business Unit» (§7.5). Una spesa per volta, la domanda in italiano, l'effetto in euro
 * PRIMA del click che scrive.
 *
 * <p><b>Si raggruppa solo sullo stesso esercente.</b> Gli incassi POS e le righe effetti/RiBa
 * restano decisioni singole: hanno la stessa forma ma sono giornate, importi e fornitori diversi.
 * Misurato sul corpus di 6 mesi: 187 righe → 142 decisioni (81 gruppi + 61 righe a sé).
 */
@Component({
  selector: 'app-spese-wizard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe, DatePipe,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatCheckboxModule,
    CogePickerComponent, HelpNoteComponent, IndiceCodaComponent,
  ],
  template: `
    <div class="wz">
      @if (loading()) {
        <div class="wz__center"><mat-spinner diameter="40"></mat-spinner></div>
      } @else if (caricamentoFallito()) {
        <div class="wz__stato">
          <mat-icon>cloud_off</mat-icon>
          <p>Non è stato possibile caricare le spese da sistemare. Nessun dato è stato toccato.</p>
          <button mat-stroked-button (click)="ricarica()">Riprova</button>
        </div>
      } @else if (!gruppi().length) {
        <div class="wz__stato wz__stato--ok">
          <mat-icon>task_alt</mat-icon>
          <h2>Non c'è niente da sistemare</h2>
          <p>Ogni movimento importato è finito su una voce di bilancio.
            Quando importerai altri estratti conto, le spese che il sistema non sa riconoscere
            si fermeranno qui e te le chiederò una per volta.</p>
        </div>
      } @else if (corrente(); as g) {
        <header class="wz__head">
          <div class="wz__headline">
            <h2>Spese da sistemare</h2>
            <p class="wz__conta">
              <strong>{{ indice() + 1 }}</strong> di {{ gruppi().length }}
              @if (rimandate() > 0) { · {{ rimandate() }} rimandate a dopo }
            </p>
          </div>
          <div class="wz__barra" role="progressbar" [attr.aria-valuenow]="indice() + 1"
               aria-valuemin="1" [attr.aria-valuemax]="gruppi().length"
               [attr.aria-label]="'Spesa ' + (indice() + 1) + ' di ' + gruppi().length">
            <span [style.width.%]="((indice() + 1) / gruppi().length) * 100"></span>
          </div>
        </header>

        <!-- Indice sempre visibile: si salta a QUALSIASI spesa, non solo alla prossima. -->
        <agos-indice-coda class="wz__indice" titolo="Tutte le spese"
                          [voci]="vociIndice()" [correnteId]="g.chiave"
                          (vai)="vaA($event)"></agos-indice-coda>

        <div class="wz__col wz__col--ctx">
        <section class="wz__spesa" [attr.aria-labelledby]="'wz-chi'">
          <p class="wz__frase">
            {{ g.righe[0].tipo === 'USCITA' ? 'Hai pagato' : 'Hai incassato' }}
            <b class="wz__cifra">{{ g.righe[0].importo | currency:'EUR' }}</b>
            {{ g.righe[0].tipo === 'USCITA' ? 'a' : 'da' }}
          </p>
          <p class="wz__chi" id="wz-chi">{{ etichetta(g) }}</p>
          @if (g.righe[0].fornitoreNome; as f) {
            <p class="wz__forn">
              <mat-icon aria-hidden="true">badge</mat-icon>
              Riconosciuto in anagrafica: <b>{{ f }}</b>
            </p>
          }
          <p class="wz__quando">
            il {{ g.righe[0].dataMovimento | date:'d MMMM yyyy' }}{{ conto(g.righe[0]) }}
          </p>
          <p class="wz__causale">«{{ g.righe[0].descrizione }}»</p>

          <!-- Tutto quello che la banca dice di questa riga, sempre — non solo sulle POS. Prima
               del 13/08/2026 questa scheda compariva solo se la causale portava una data operazione
               o un circuito: su un bonifico normale l'operatore vedeva la causale e basta, mentre
               IBAN e riferimento erano già stati estratti e stavano lì, non mostrati. -->
          <dl class="wz__banca">
            <div><dt>{{ g.righe[0].tipo === 'USCITA' ? 'Addebitato il' : 'Accreditato il' }}</dt>
                 <dd>{{ g.righe[0].dataMovimento | date:'dd/MM/yyyy' }}</dd></div>
            @if (g.righe[0].dataOperazione) {
              <div><dt>Operazione del</dt><dd>{{ g.righe[0].dataOperazione }}</dd></div>
            }
            <div><dt>Conto</dt><dd>{{ nomeConto(g.righe[0]) }}</dd></div>
            @if (g.righe[0].metodoPagamento) {
              <div><dt>Come</dt><dd>{{ g.righe[0].metodoPagamento }}</dd></div>
            }
            @if (g.righe[0].circuitoPos) {
              <div><dt>Circuito</dt><dd>{{ g.righe[0].circuitoPos }}</dd></div>
            }
            @if (g.righe[0].ibanEstratto) {
              <div><dt>IBAN controparte</dt><dd class="wz__mono">{{ g.righe[0].ibanEstratto }}</dd></div>
            }
            @if (g.righe[0].riferimentoEsterno) {
              <div><dt>Riferimento banca</dt>
                   <dd class="wz__mono">{{ g.righe[0].riferimentoEsterno }}</dd></div>
            }
          </dl>
        </section>

        @if (g.righe[0].riscontroBilly; as b) {
          <section class="wz__billy">
            <h3>Billy, lo stesso giorno su questo conto</h3>
            <p class="wz__billy-num">
              <b>{{ b.scontrini }}</b> {{ b.scontrini === 1 ? 'riga di ricavo' : 'righe di ricavo' }}
              per <b>{{ b.totale | currency:'EUR' }}</b>, contro
              <b>{{ g.righe[0].importo | currency:'EUR' }}</b> accreditati dalla banca
              (differenza {{ b.scarto | currency:'EUR' }}).
            </p>
            <!-- DI CHE COSA era fatta la giornata: il totale da solo dice che i conti non tornano,
                 la ripartizione dice che giornata è stata — ed è ciò che serve a scegliere la voce. -->
            @if (b.categorie.length) {
              <ul class="wz__billy-voci">
                @for (v of b.categorie; track v.voce) {
                  <li><span>{{ v.voce }}</span><b>{{ v.totale | currency:'EUR' }}</b></li>
                }
              </ul>
            }
            <p class="wz__billy-avviso">
              <mat-icon>info</mat-icon>
              <span><b>Non è un errore da correggere.</b> Billy e la banca non si agganciano
                scontrino per accredito: la riconciliazione POS lavora sui <b>totali di periodo</b>,
                e la banca accredita a giorni di distanza raggruppando più vendite. Questo confronto
                serve a darti l'ordine di grandezza della giornata. La quadratura vera è sotto
                <b>Report → Quadratura POS</b>.</span>
            </p>
          </section>
        }

        </div>

        <div class="wz__col wz__col--dec">
        <section class="wz__scelta" aria-labelledby="wz-domanda">
          <h3 id="wz-domanda">
            {{ g.righe[0].tipo === 'USCITA' ? 'Che cos\\'è questa spesa?' : 'Che cos\\'è questo incasso?' }}
          </h3>

          @if (suggerito(g); as s) {
            <button type="button" class="wz__voce wz__voce--sugg"
                    [class.wz__voce--on]="cogeScelto()?.id === s.id" (click)="scegli(s)">
              <mat-icon>lightbulb</mat-icon>
              <span class="wz__voce-txt">
                <b>{{ s.nome }}</b>
                <small>{{ g.righe[0].motivoSuggerimento }}</small>
              </span>
            </button>
          }

          <div class="wz__voci">
            @for (c of scorciatoie(); track c.id) {
              <button type="button" class="wz__voce"
                      [class.wz__voce--on]="cogeScelto()?.id === c.id" (click)="scegli(c)">
                <span class="wz__voce-txt"><b>{{ c.nome }}</b><small>{{ c.codice }}</small></span>
              </button>
            }
          </div>

          <app-coge-picker
            [label]="scorciatoie().length ? 'Cerca un\\'altra voce…' : 'Scegli la voce di bilancio'"
            [required]="true" [value]="cogeScelto()?.id ?? null" [allowedIds]="cogeAmmessi()"
            (cogeChange)="scegli($event)"></app-coge-picker>
        </section>

        @if (g.righe.length > 1) {
          <section class="wz__gemelle" aria-labelledby="wz-gemelle">
            <h3 id="wz-gemelle">
              Ce ne {{ g.righe.length === 2 ? 'è un\\'altra' : 'sono altre ' + (g.righe.length - 1) }}
              da {{ etichetta(g) }}: le sistemo insieme?
            </h3>
            @for (r of g.righe.slice(1); track r.id) {
              <label class="wz__gemella">
                <mat-checkbox [checked]="insieme()[r.id] !== false"
                              (change)="insiemeToggle(r.id, $event.checked)"></mat-checkbox>
                <span>{{ r.importo | currency:'EUR' }} del {{ r.dataMovimento | date:'d MMMM' }}</span>
                <small>{{ r.descrizione }}</small>
              </label>
            }
          </section>
        }

        <!-- La via d'uscita. Il motore riconosce gli incassi-evento da una keyword nella causale:
             una come «8RIST 14/06/26» non ne ha, e la riga finisce qui — dove però la risposta
             giusta NON esiste, perché un ricavo-evento non si sceglie da un elenco di conti, nasce
             dal modulo Eventi. Invece di far forzare un conto sbagliato, la riga torna in coda. -->
        <section class="wz__altrove" aria-labelledby="wz-altrove">
          <h3 id="wz-altrove">Non è una spesa né un ricavo di gestione?</h3>
          <div class="wz__voci">
            <button type="button" class="wz__voce wz__voce--stretta"
                    [class.wz__voce--on]="spostaVerso() === 'EVENTO'"
                    [disabled]="salvando()" (click)="chiediSposta('EVENTO')">
              <mat-icon>celebration</mat-icon>
              <span class="wz__voce-txt"><b>È un incasso evento</b><small>lo attribuirai a un evento</small></span>
            </button>
            <button type="button" class="wz__voce wz__voce--stretta"
                    [class.wz__voce--on]="spostaVerso() === 'RICORRENTE'"
                    [disabled]="salvando()" (click)="chiediSposta('RICORRENTE')">
              <mat-icon>event_repeat</mat-icon>
              <span class="wz__voce-txt"><b>È una rata</b><small>lo collegherai a un piano</small></span>
            </button>
            <!-- R8 della spec riba-split-importo: una RiBa cumulativa non è UNA spesa, sono N.
                 La riga è già un movimento (sta sul transitorio), quindi si divide con lo stesso
                 motore del dettaglio movimento — nessuna seconda strada che scrive denaro. -->
            @if (righeScelte().length === 1 && candidataDivisione(righeScelte()[0])) {
              <button type="button" class="wz__voce wz__voce--stretta"
                      [disabled]="salvando()" (click)="apriDivisione(righeScelte()[0])">
                <mat-icon>call_split</mat-icon>
                <span class="wz__voce-txt"><b>È una RiBa cumulativa</b><small>la dividi in più movimenti</small></span>
              </button>
            }
          </div>

          @if (spostaVerso(); as dest) {
            <!-- L'effetto in euro PRIMA del click che scrive, come per ogni altra conferma. -->
            <div class="wz__esito wz__esito--sposta" aria-live="polite">
              <p class="wz__effetto">
                <mat-icon>swap_horiz</mat-icon>
                <span>
                  <b>{{ totaleScelto() | currency:'EUR' }}</b>
                  @if (righeScelte().length > 1) { ({{ righeScelte().length }} righe) }
                  {{ dest === 'EVENTO' ? 'passano in «Incassi evento»' : 'passano in «Rate»' }}.
                  Fino a quando non {{ dest === 'EVENTO' ? 'li attribuisci a un evento' : 'la colleghi a un piano' }},
                  quell'importo <b>esce dal saldo di {{ nomeConto(g.righe[0]) }}</b> — è lo stesso
                  trattamento delle righe che l'import riconosce da solo. Il totale dell'import non cambia.
                </span>
              </p>
              <label class="wz__motivo">
                <span>Perché la sposti? (facoltativo)</span>
                <input type="text" [value]="motivoSposta()"
                       (input)="motivoSposta.set($any($event.target).value)"
                       placeholder="es. cena aziendale, la causale non lo dice">
              </label>
              <div class="wz__azioni">
                <button mat-flat-button color="primary" [disabled]="salvando()" (click)="sposta()">
                  @if (salvando()) { <mat-spinner diameter="18"></mat-spinner> } @else { Spostala }
                </button>
                <button mat-button (click)="spostaVerso.set(null)">Annulla</button>
              </div>
            </div>
          }
        </section>

        @if (cogeScelto(); as c) {
          @if (chiediRamo()) {
            <section class="wz__ramo" aria-labelledby="wz-ramo">
              <h3 id="wz-ramo">Questa spesa a quale parte dell'azienda?</h3>
              <div class="wz__voci">
                @for (b of bu(); track b.id) {
                  <button type="button" class="wz__voce wz__voce--stretta"
                          [class.wz__voce--on]="buScelta() === b.id" (click)="buScelta.set(b.id)">
                    <span class="wz__voce-txt"><b>{{ b.nome }}</b></span>
                  </button>
                }
              </div>
              <p class="wz__nota">
                <mat-icon>info</mat-icon>
                Cambiare questo <b>non muove nessun saldo</b>: serve solo a leggere quanto rende
                ogni ramo.
              </p>
            </section>
          }

          <!-- L'effetto in euro si legge PRIMA di confermare, sempre (SPEC R8). -->
          <section class="wz__esito" aria-live="polite">
            <p class="wz__effetto">
              <mat-icon>check_circle</mat-icon>
              <span>
                <b>{{ totaleScelto() | currency:'EUR' }}</b>
                @if (righeScelte().length > 1) { ({{ righeScelte().length }} righe) }
                {{ g.righe[0].tipo === 'USCITA' ? 'andranno nei costi' : 'andranno nei ricavi' }}
                di {{ g.righe[0].dataMovimento | date:'MMMM yyyy' }}, voce <b>«{{ c.nome }}»</b>@if (nomeRamo(); as r) {, ramo <b>{{ r }}</b>}.
              </span>
            </p>

            <!-- Che cosa il sistema imparerà da questa conferma. Fino al 13/08/2026 lo decideva il
                 client in silenzio (apprendiKeyword dedotto dalla controparte) e non lo diceva a
                 nessuno: la prossima volta il motore catalogava da solo e non si sapeva perché.
                 I token sono quelli veri — stessa estrazione che poi scrive le firme. -->
            <div class="wz__impara" aria-live="polite">
              @if (g.righe[0].firmeDaImparare.length) {
                <p class="wz__impara-riga">
                  <mat-icon aria-hidden="true">bolt</mat-icon>
                  <span>
                    @if (imparo()) { Imparerò: } @else { <s>Imparerei:</s> }
                    <!-- fi esplicito: dentro il @for interno lo $index è quello del TOKEN e
                         ombreggia quello della firma. Con la chiave sbagliata i chip si spengono a
                         schermo ma la firma inviata resta intera — il placebo che questa feature
                         doveva impedire (preso dall'e2e il 19/08/2026). -->
                    @for (f of g.righe[0].firmeDaImparare; track $index; let fi = $index) {
                      <span class="wz__firma">
                        @for (t of f.token; track t) {
                          <button type="button" class="wz__kw"
                                  [class.wz__kw--off]="!imparo() || !acceso(fi, t)"
                                  [class.wz__kw--dom]="f.natura === 'DOMINIO'"
                                  [disabled]="!imparo()"
                                  [attr.aria-pressed]="acceso(fi, t)"
                                  (click)="togliMetti(fi, t)">{{ t }}</button>
                        }
                      </span>
                    }
                    <small>{{ imparo()
                      ? 'clicca una parola per toglierla; così la prossima riga simile la catalogo da solo'
                      : 'questa volta non imparo niente: la catalogo e basta' }}</small>
                  </span>
                </p>
                @if (imparo() && keywordModificate()) {
                  <p class="wz__impara-avviso">
                    <mat-icon aria-hidden="true">expand</mat-icon>
                    <span>Togliendo parole la firma diventa <b>più larga</b>: prenderà anche righe
                      che oggi non prende (il riconoscimento chiede che ci siano <i>tutte</i> le
                      parole rimaste).
                      @if (firmeMonoToken().length) {
                        <b> Con la sola parola «{{ firmeMonoToken().join('», «') }}» prenderà
                        qualunque riga che la contenga</b> — assicurati che basti a riconoscere
                        questo fornitore e nessun altro.
                      }
                      @if (righeScelte().length > 1) {
                        Le altre {{ righeScelte().length - 1 }} righe del gruppo hanno causali
                        diverse: le sistemo, ma <b>da loro non imparo niente</b> — imparerei
                        qualcosa che non hai visto.
                      }
                    </span>
                  </p>
                }
                @if (imparo() && !firmeScelte().length) {
                  <p class="wz__impara-avviso">
                    <mat-icon aria-hidden="true">block</mat-icon>
                    <span>Hai spento tutto: <b>questa volta non imparo niente</b>, la catalogo e
                      basta.</span>
                  </p>
                }
                <label class="wz__impara-no">
                  <mat-checkbox [checked]="!imparo()"
                                (change)="imparo.set(!$event.checked)"></mat-checkbox>
                  <span>non imparare da questa riga</span>
                </label>
              } @else {
                <p class="wz__impara-riga wz__impara-riga--vuota">
                  <mat-icon aria-hidden="true">bolt</mat-icon>
                  <span>Da questa causale non si impara nulla — non c'è un intestatario vero
                    (incassi POS, effetti/RiBa). La catalogo solo questa volta: <b>va benissimo</b>,
                    una firma nata da qui dirotterebbe tutte le righe simili.</span>
                </p>
              }
            </div>
            <div class="wz__azioni">
              <button mat-flat-button color="primary" [disabled]="!puoConfermare()" (click)="conferma()">
                @if (salvando()) { <mat-spinner diameter="18"></mat-spinner> } @else { Va bene }
              </button>
              <button mat-button (click)="annullaScelta()">Torna indietro</button>
            </div>
          </section>
        } @else {
          <div class="wz__azioni wz__azioni--vuote">
            <button mat-stroked-button (click)="rimanda()">
              <mat-icon>schedule</mat-icon> Non lo so, lascia in sospeso
            </button>
          </div>
        }

        </div>

        <agos-help-note tono="tip" titolo="Perché queste spese sono qui" [collapsed]="true">
          <p>Sono movimenti veri, già nei saldi dei conti: quello che manca è <strong>la voce di
            bilancio</strong>, cioè in che costo o ricavo vanno letti. Finché restano qui, il conto
            economico li mostra come «da classificare».</p>
          <p>Se non sai rispondere, <strong>lascia in sospeso</strong>: la spesa resta qui e non
            succede niente. Per correggere una spesa già sistemata si va in <strong>Movimenti</strong>.</p>
        </agos-help-note>
      }
    </div>
  `,
  styles: [`
    .wz { padding: 16px; display: flex; flex-direction: column; gap: 20px; max-width: 860px; }

    /* Due colonne quando lo schermo le regge: a sinistra COSA sto guardando, a destra COSA
       decido. È la stessa riga di prima, ma senza doverla scorrere per arrivare alla risposta —
       e il contesto resta sotto gli occhi mentre si sceglie (sticky). Sotto la soglia tornano
       impilate nello stesso ordine di lettura. */
    .wz__col { display: flex; flex-direction: column; gap: 20px; min-width: 0; }

    /* 1280 e non 1080: il rail di nav toglie 220px, quindi a 1080 di viewport il
       contenuto sarebbe 620 e due colonne verrebbero strette come un telefono. */
    /* L'indice entra come TERZA colonna solo da 1500 in su: sotto quella soglia toglierebbe
       spazio alla colonna che decide, quindi si impila sopra al contesto — sempre visibile,
       ma senza rubare larghezza. */
    @media (min-width: 1280px) {
      .wz { max-width: 1320px; display: grid; align-items: start; column-gap: 28px;
        grid-template-columns: minmax(300px, .85fr) minmax(380px, 1fr); }
      .wz__head, .wz__indice, .wz > agos-help-note { grid-column: 1 / -1; }
      .wz__col--ctx { position: sticky; top: 0; }
    }
    @media (min-width: 1500px) {
      .wz { max-width: 1560px; column-gap: 24px;
        grid-template-columns: minmax(220px, .5fr) minmax(300px, .8fr) minmax(380px, 1fr); }
      .wz__head, .wz > agos-help-note { grid-column: 1 / -1; }
      .wz__indice { grid-column: auto; position: sticky; top: 0; }
    }

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
    .wz__forn { margin: 4px 0 0; display: flex; align-items: center; gap: 5px;
      font-size: .84rem; color: var(--text-sub); }
    .wz__forn mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--success); }
    .wz__causale { margin: 10px 0 0; padding-top: 10px; border-top: 1px solid var(--border-soft);
      font-family: ui-monospace, 'Courier New', monospace; font-size: .78rem; color: var(--text-faint);
      overflow-wrap: anywhere; }

    .wz__banca { margin: 12px 0 0; padding-top: 10px; border-top: 1px solid var(--border-soft);
      display: flex; flex-wrap: wrap; gap: 6px 24px; }
    .wz__banca div { display: flex; flex-direction: column; gap: 1px; }
    .wz__banca dt { font-size: .7rem; color: var(--text-faint); text-transform: none; }
    .wz__banca dd { margin: 0; font-size: .88rem; font-weight: 600; color: var(--text-main); }
    /* IBAN e riferimento: si leggono a caratteri, non a parole — il monospazio evita di scambiare
       uno 0 per una O quando si confronta con l'estratto conto. */
    .wz__banca dd.wz__mono { font-family: ui-monospace, 'Courier New', monospace;
      font-size: .8rem; font-weight: 500; overflow-wrap: anywhere; }

    .wz__billy { background: var(--surface-sunken); border-radius: var(--radius-md); padding: 16px 18px; }
    .wz__billy h3 { margin: 0 0 8px; font-size: .95rem; font-weight: 600; }
    .wz__billy-num { margin: 0 0 10px; font-size: .95rem; line-height: 1.5; }
    .wz__billy-voci { margin: 0 0 10px; padding: 0; list-style: none;
      display: flex; flex-direction: column; gap: 2px; }
    .wz__billy-voci li { display: flex; justify-content: space-between; gap: 12px;
      font-size: .86rem; color: var(--text-sub); padding: 3px 0;
      border-bottom: 1px solid var(--border-soft); }
    .wz__billy-voci li:last-child { border-bottom: 0; }
    .wz__billy-voci b { color: var(--text-main); font-variant-numeric: tabular-nums; }
    .wz__billy-avviso { margin: 0; display: flex; align-items: flex-start; gap: 8px;
      font-size: .84rem; line-height: 1.5; color: var(--text-sub); }
    .wz__billy-avviso mat-icon { font-size: 17px; width: 17px; height: 17px; flex-shrink: 0; margin-top: 2px; }

    .wz__scelta h3, .wz__gemelle h3, .wz__ramo h3 { margin: 0 0 12px; font-size: 1.05rem; font-weight: 600; }
    .wz__voci { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }

    .wz__voce { display: flex; align-items: center; gap: 10px; padding: 12px 16px; min-height: 56px;
      border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--card);
      cursor: pointer; text-align: left; font: inherit; color: var(--text-main);
      transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease); }
    .wz__voce:hover { border-color: var(--primary-l); background: var(--tint-primary); }
    .wz__voce:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .wz__voce--on { border-color: var(--primary); background: var(--tint-primary-strong); }
    .wz__voce--stretta { flex: 0 1 auto; }
    .wz__voce--sugg { width: 100%; margin-bottom: 12px; }
    .wz__voce--sugg mat-icon { color: var(--accent); flex-shrink: 0; }
    .wz__voce-txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .wz__voce-txt b { font-size: .95rem; font-weight: 600; }
    .wz__voce-txt small { font-size: .76rem; color: var(--text-sub); }

    /* L'apprendimento è una conseguenza della conferma, non una decisione a sé: sta dentro il
       riquadro dell'effetto, staccato da una riga, e si legge dopo «cosa succede in euro». */
    .wz__impara { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-soft); }
    .wz__impara-riga { margin: 0; display: flex; align-items: flex-start; gap: 8px;
      font-size: .86rem; line-height: 1.5; color: var(--text-sub); }
    .wz__impara-riga mat-icon { font-size: 17px; width: 17px; height: 17px; flex-shrink: 0;
      margin-top: 2px; color: var(--accent); }
    .wz__impara-riga--vuota mat-icon { color: var(--text-faint); }
    .wz__impara-riga small { display: block; margin-top: 2px; font-size: .78rem; color: var(--text-faint); }
    .wz__kw { display: inline-block; margin: 0 4px 3px 0; padding: 1px 8px; border-radius: 999px;
      background: var(--tint-primary-strong); color: var(--text-main);
      font-size: .78rem; font-weight: 600; font-family: ui-monospace, 'Courier New', monospace; }
    .wz__kw--dom { background: var(--tint-info); }
    .wz__kw--off { background: var(--surface-2); color: var(--text-faint); text-decoration: line-through; }
    .wz__kw { border: 1px solid transparent; font: inherit; cursor: pointer; }
    .wz__kw:hover:not(:disabled) { border-color: var(--text-faint); }
    .wz__kw:disabled { cursor: default; }
    .wz__firma { display: inline-block; margin-right: 10px; }
    .wz__firma + .wz__firma::before { content: '·'; margin-right: 8px; color: var(--text-faint); }
    .wz__impara-avviso { display: flex; gap: 6px; align-items: flex-start; margin: 4px 0 0;
      font-size: .82rem; color: var(--text-muted); }
    .wz__impara-avviso mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .wz__impara-no { display: flex; align-items: center; gap: 4px; margin-top: 4px;
      font-size: .8rem; color: var(--text-faint); cursor: pointer; }

    .wz__gemelle { background: var(--surface-sunken); border-radius: var(--radius-md); padding: 16px 18px; }
    .wz__gemella { display: grid; grid-template-columns: auto 1fr; align-items: center;
      column-gap: 8px; padding: 6px 0; cursor: pointer; }
    .wz__gemella span { font-size: .95rem; }
    .wz__gemella small { grid-column: 2; font-size: .74rem; color: var(--text-faint);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .wz__nota { margin: 4px 0 0; display: flex; align-items: flex-start; gap: 8px;
      font-size: .86rem; color: var(--text-sub); }
    .wz__nota mat-icon { font-size: 17px; width: 17px; height: 17px; flex-shrink: 0; margin-top: 1px; }

    .wz__altrove { padding-top: 4px; border-top: 1px solid var(--border-soft); }
    .wz__altrove h3 { margin: 0 0 12px; font-size: 1.05rem; font-weight: 600; }
    .wz__altrove .wz__voce mat-icon { color: var(--info); flex-shrink: 0; }
    .wz__altrove .wz__voce[disabled] { opacity: .5; cursor: default; }

    .wz__esito--sposta { background: var(--tint-info); }
    .wz__esito--sposta .wz__effetto mat-icon { color: var(--info); }

    .wz__motivo { display: flex; flex-direction: column; gap: 3px; max-width: 460px; }
    .wz__motivo > span { font-size: .84rem; font-weight: 600; color: var(--text-main); }
    .wz__motivo input { padding: 8px 10px; border: 1px solid var(--border);
      border-radius: var(--radius-sm); background: var(--card); font: inherit;
      font-size: .9rem; color: var(--text-main); }
    .wz__motivo input:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }

    .wz__esito { background: var(--tint-success); border-radius: var(--radius-md); padding: 16px 18px;
      display: flex; flex-direction: column; gap: 14px; }
    .wz__effetto { margin: 0; display: flex; align-items: flex-start; gap: 9px;
      font-size: .95rem; line-height: 1.5; color: var(--text-main); }
    .wz__effetto mat-icon { color: var(--success); font-size: 19px; width: 19px; height: 19px;
      flex-shrink: 0; margin-top: 2px; }

    .wz__azioni { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .wz__azioni--vuote { padding-top: 4px; }
    .wz__azioni mat-spinner { display: inline-block; }

    @media (prefers-reduced-motion: reduce) {
      .wz__barra span, .wz__voce { transition: none; }
    }
  `],
})
export class SpeseWizardComponent implements OnInit {
  private readonly movimenti = inject(MovimentiService);
  private readonly lookup = inject(LookupService);
  private readonly buService = inject(BuService);
  private readonly counts = inject(ImportCountsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  readonly loading = signal(true);
  readonly caricamentoFallito = signal(false);
  readonly salvando = signal(false);

  readonly gruppi = signal<Gruppo[]>([]);
  readonly indice = signal(0);

  /** Chiavi dei gruppi messi in sospeso: l'indice deve dire QUALI, non solo quanti. */
  private readonly chiaviRimandate = signal<ReadonlySet<string>>(new Set<string>());
  readonly rimandate = computed(() => this.chiaviRimandate().size);

  /**
   * Gruppi chiusi in questa sessione. Un gruppo può svuotarsi <b>in parte</b> — si sistemano
   * solo le righe spuntate e le gemelle restano da fare — quindi qui entra soltanto quando
   * l'ultima delle sue righe è uscita, cioè quando il gruppo sparisce davvero dalla coda.
   */
  private readonly svolte = signal<{ id: string; titolo: string; dettaglio: string }[]>([]);

  readonly coge = signal<PianoContiCogeDTO[]>([]);
  readonly bu = signal<BusinessUnitDTO[]>([]);
  /** conto CoGe → rami con cui è già stato usato: se è uno solo, il ramo non si chiede. */
  private readonly buPerCoge = signal<Record<number, number[]>>({});

  /** Coda di destinazione scelta con «non è una spesa», in attesa di conferma. */
  readonly spostaVerso = signal<'EVENTO' | 'RICORRENTE' | null>(null);
  readonly motivoSposta = signal('');

  readonly cogeScelto = signal<PianoContiCogeDTO | null>(null);
  readonly buScelta = signal<number | null>(null);
  /** Se imparare le firme da questa riga. Default sì — è il comportamento che c'era già. */
  readonly imparo = signal(true);
  /**
   * I token spenti a mano, come `indiceFirma|TOKEN`. Vuoto = firme intatte, e allora al server non
   * si manda `firme` affatto: il percorso automatico resta quello di sempre, byte per byte.
   */
  private readonly spenti = signal<ReadonlySet<string>>(new Set());
  /** Righe gemelle escluse a mano (id → false). Di default il gruppo si sistema intero. */
  readonly insieme = signal<Record<string, boolean>>({});

  readonly corrente = computed(() => this.gruppi()[this.indice()] ?? null);

  /**
   * I gruppi tradotti per l'indice condiviso: quelli da fare in coda, poi i già chiusi.
   * Signal veri in ingresso — niente letture di `ngModel`, che resterebbero congelate (OnPush).
   */
  readonly vociIndice = computed<VoceCoda[]>(() => {
    const sosp = this.chiaviRimandate();
    const daFare: VoceCoda[] = this.gruppi().map(g => ({
      id: g.chiave,
      titolo: this.etichetta(g),
      dettaglio: this.dettaglioGruppo(g),
      stato: sosp.has(g.chiave) ? 'rimandata' : 'da-fare',
    }));
    return [...daFare, ...this.svolte().map(s => ({ ...s, stato: 'fatta' as const }))];
  });

  /** «1.234,00 € · 3 righe» — il totale del gruppo, non solo della prima riga. */
  private dettaglioGruppo(g: Gruppo): string {
    const tot = g.righe.reduce((s, r) => s + r.importo, 0)
      .toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
    return g.righe.length === 1 ? tot : `${tot} · ${g.righe.length} righe`;
  }

  /** Salto diretto dall'indice. Cambia SOLO la navigazione: le scelte in corso si azzerano. */
  vaA(chiave: string): void {
    const i = this.gruppi().findIndex(g => g.chiave === chiave);
    if (i < 0 || i === this.indice()) return;
    this.indice.set(i);
    this.azzeraScelta();
  }

  /**
   * Toglie dalla coda le righe appena scritte e, se un gruppo si è svuotato del tutto, lo
   * archivia nell'indice come «fatta». Sostituisce le due copie identiche che stavano in
   * `conferma()` e `sposta()`.
   */
  private rimuoviRighe(scritte: Set<string>): void {
    const iCorr = this.indice();
    const prima = this.gruppi()[iCorr];
    const restanti = prima ? prima.righe.filter(r => !scritte.has(r.id)).length : 0;
    if (prima && restanti === 0) {
      this.svolte.update(l => [...l, {
        id: prima.chiave, titolo: this.etichetta(prima), dettaglio: this.dettaglioGruppo(prima),
      }]);
      this.chiaviRimandate.update(s => {
        if (!s.has(prima.chiave)) return s;
        const n = new Set(s); n.delete(prima.chiave); return n;
      });
    }
    this.gruppi.update(gs => gs
      .map((g, i) => i !== iCorr ? g : { ...g, righe: g.righe.filter(r => !scritte.has(r.id)) })
      .filter(g => g.righe.length > 0));
    if (this.indice() >= this.gruppi().length) this.indice.set(0);
  }

  /** Il gruppo escluse le gemelle deselezionate: è l'insieme che verrà scritto. */
  readonly righeScelte = computed(() => {
    const g = this.corrente();
    if (!g) return [];
    return g.righe.filter((r, i) => i === 0 || this.insieme()[r.id] !== false);
  });

  readonly totaleScelto = computed(() =>
    this.righeScelte().reduce((s, r) => s + Number(r.importo), 0));

  /**
   * Fuori dal picker ciò che il server rifiuta comunque con un 409: il mastro dei ricavi-evento
   * (`30.02.*`) e i due conti d'attesa dell'import — catalogare una riga sul conto «da
   * classificare» significa dichiararla non classificata. È cortesia, non guardia: la guardia sta
   * in `CogeRiservatoEventi` e `CogeTransitorio`, lato server.
   */
  readonly cogeAmmessi = computed(() => this.coge().filter(SELEZIONABILE).map(c => c.id));

  /** Le voci usate di recente (stesso storage del picker): scorciatoia, non catalogo. */
  readonly scorciatoie = computed(() => {
    const escluso = this.corrente()?.righe[0]?.cogeSuggeritoId;
    const conti = this.coge();
    return this.recents()
      .filter(id => id !== escluso)
      .map(id => conti.find(c => c.id === id))
      .filter((c): c is PianoContiCogeDTO => !!c && SELEZIONABILE(c))
      .slice(0, 4);
  });

  /** Il ramo si chiede solo se la voce scelta è servita a più rami (o non è mai stata usata). */
  readonly chiediRamo = computed(() => {
    const c = this.cogeScelto();
    if (!c) return false;
    return (this.buPerCoge()[c.id] ?? []).filter(b => b !== BU_FALLBACK).length !== 1;
  });

  readonly nomeRamo = computed(() => {
    const id = this.buScelta();
    return id == null ? null : this.bu().find(b => b.id === id)?.nome ?? null;
  });

  readonly puoConfermare = computed(() =>
    !this.salvando() && !!this.cogeScelto() && this.buScelta() != null);

  ngOnInit(): void { this.ricarica(); }

  ricarica(): void {
    this.loading.set(true);
    this.caricamentoFallito.set(false);
    forkJoin({
      // ponytail: si legge la lista intera (cap 2000 lato server) perché il raggruppamento
      // ha senso solo sul totale. ~190 righe ≈ 250ms, una volta al mese.
      righe: this.movimenti.getTransitori(undefined, 0, 2000),
      coge: this.lookup.getPianoConti(),
      bu: this.buService.getAll(),
      buPerCoge: this.movimenti.getBuPerCoge(),
    }).subscribe({
      next: ({ righe, coge, bu, buPerCoge }) => {
        this.coge.set(coge);
        this.bu.set(bu);
        this.buPerCoge.set(buPerCoge ?? {});
        this.gruppi.set(this.raggruppa(righe.content));
        this.indice.set(0);
        this.chiaviRimandate.set(new Set<string>());
        this.svolte.set([]);
        this.azzeraScelta();
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.caricamentoFallito.set(true); },
    });
  }

  /**
   * Un gruppo per chiave (calcolata dal server), i più numerosi per primi: chiudere prima i
   * gruppi grossi è ciò che fa scendere il contatore in fretta.
   */
  private raggruppa(righe: TransitorioDTO[]): Gruppo[] {
    const per = new Map<string, TransitorioDTO[]>();
    for (const r of righe) {
      // gruppo null = riga da decidere DA SOLA (incassi POS, effetti/RiBa, causali generiche):
      // sono giornate, importi e fornitori diversi, e una risposta sola non andrebbe bene per
      // tutte. La chiave diventa l'id: un gruppo di uno.
      const k = r.gruppo ?? r.id;
      const lista = per.get(k);
      if (lista) lista.push(r); else per.set(k, [r]);
    }
    return [...per.entries()]
      .map(([chiave, righe]) => ({ chiave, righe }))
      .sort((a, b) => b.righe.length - a.righe.length);
  }

  etichetta(g: Gruppo): string {
    const r = g.righe[0];
    if (r.controparteEstratta?.trim()) return r.controparteEstratta.trim();
    if (r.circuitoPos) return `Incasso con carta · ${r.circuitoPos}`;
    return 'Movimento senza intestatario';
  }

  conto(r: TransitorioDTO): string {
    const n = this.nomeConto(r);
    return n === '—' ? '' : `, sul conto ${n}`;
  }

  nomeConto(r: TransitorioDTO): string {
    return r.contoBancarioId === 1 ? 'BPM'
      : r.contoBancarioId === 2 ? 'Crédit Agricole'
      : r.contoBancarioId === 3 ? 'Cassa' : '—';
  }

  suggerito(g: Gruppo): PianoContiCogeDTO | null {
    const id = g.righe[0].cogeSuggeritoId;
    return id == null ? null : this.coge().find(c => c.id === id) ?? null;
  }

  scegli(c: PianoContiCogeDTO | null): void {
    this.spostaVerso.set(null);
    this.cogeScelto.set(c);
    // Ramo pre-scelto quando qualcuno lo sa già. Prima il motore: se ha calcolato un ramo per
    // QUESTA riga (o il fornitore riconosciuto ne ha uno di default), è la risposta più informata
    // che esista e chiederla di nuovo sarebbe farsi ripetere una cosa già detta. Poi la storia
    // della voce, quando è univoca. Resta sempre un mezzo-passo modificabile, mai una scrittura.
    const proposto = this.corrente()?.righe[0]?.buSuggerita ?? null;
    if (proposto != null && proposto !== BU_FALLBACK) { this.buScelta.set(proposto); return; }
    const rami = c ? (this.buPerCoge()[c.id] ?? []).filter(b => b !== BU_FALLBACK) : [];
    this.buScelta.set(rami.length === 1 ? rami[0] : null);
  }

  insiemeToggle(id: string, checked: boolean): void {
    this.insieme.update(m => ({ ...m, [id]: checked }));
  }

  annullaScelta(): void { this.azzeraScelta(); }

  /** «Non lo so»: la riga resta dov'è, si passa alla prossima. Nessuna chiamata al server. */
  rimanda(): void {
    const g = this.corrente();
    if (g) this.chiaviRimandate.update(s => new Set(s).add(g.chiave));
    this.avanti();
  }

  acceso(firma: number, token: string): boolean {
    return !this.spenti().has(firma + '|' + token);
  }

  /**
   * Un click spegne/riaccende una parola della firma. Solo togliere: aggiungere parole che non
   * stanno nella causale darebbe una firma che non scatta mai (il match è in AND).
   */
  togliMetti(firma: number, token: string): void {
    const k = firma + '|' + token;
    this.spenti.update(s => {
      const next = new Set(s);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  }

  /** Le firme come restano dopo le sforbiciate: quelle svuotate del tutto non si imparano. */
  readonly firmeScelte = computed<FirmaSceltaDTO[]>(() => {
    const g = this.corrente();
    if (!g) return [];
    const off = this.spenti();
    return g.righe[0].firmeDaImparare
      .map((f, i) => ({ token: f.token.filter(t => !off.has(i + '|' + t)) }))
      .filter(f => f.token.length > 0);
  });

  readonly keywordModificate = computed(() => this.spenti().size > 0);

  /**
   * Riga che vale la pena proporre di dividere: effetti/RiBa. Qui si ha la causale già normalizzata
   * in `descrizione` (il DTO del transitorio non porta il codice causale della banca), quindi il
   * riconoscimento è lessicale — ed è un SUGGERIMENTO: si può dividere qualunque movimento dal suo
   * dettaglio, e si può lasciare intera una RiBa.
   */
  candidataDivisione(r: TransitorioDTO): boolean {
    const d = (r.descrizione ?? '').toUpperCase();
    return d.includes('RIBA') || d.includes('RI.BA') || d.includes('EFFETT');
  }

  /** Apre lo stesso dialog del dettaglio movimento: un motore solo, una guardia sola. */
  apriDivisione(r: TransitorioDTO): void {
    this.movimenti.getById(r.id).subscribe(mov => {
      import('../movimenti/dividi-movimento-dialog.component').then(m => {
        this.dialog.open(m.DividiMovimentoDialogComponent, {
          data: { movimento: mov }, autoFocus: false, maxHeight: '90vh',
        }).afterClosed().subscribe(figli => {
          // I figli nascono sul conto scelto: la riga esce dalla coda del transitorio da sola.
          if (figli) this.ricarica();
        });
      });
    });
  }

  /** Firme ridotte a una parola sola: valide, ma catalogano da sole molto più largo (SPEC p.5). */
  readonly firmeMonoToken = computed(() =>
    this.firmeScelte().filter(f => f.token.length === 1).map(f => f.token[0]));

  conferma(): void {
    const c = this.cogeScelto();
    const bu = this.buScelta();
    const righe = this.righeScelte();
    if (!c || bu == null || !righe.length) return;

    this.salvando.set(true);
    // ponytail: N chiamate in parallelo, non un endpoint bulk. Una fallita non annulla le altre —
    // la coda si ricarica dal server e mostra quel che resta davvero (SPEC, edge case).
    // Le firme si mandano SOLO se l'operatore ha toccato i chip, e solo per la riga di cui ha visto
    // l'anteprima (la testa del gruppo). Le gemelle hanno causali diverse, quindi firme diverse: se
    // qui si è modificato, loro NON imparano — è la sola scelta che non scrive in silenzio qualcosa
    // di diverso da ciò che stava a schermo (SPEC, punto aperto 4).
    const modificate = this.imparo() && this.keywordModificate();
    const scelte = this.firmeScelte();
    const testa = righe[0].id;
    forkJoin(righe.map(r => this.movimenti.classificaTransitorio(r.id, {
      cogeId: c.id, businessUnitId: bu, fornitoreId: r.fornitoreId,
      // Si impara se c'è qualcosa da imparare (lo dice il server, riga per riga: `firmeDaImparare`
      // vuota = nessun intestatario vero, da «EFFETTI RITIRATI» o da una causale POS nascerebbe una
      // firma spuria) E se l'operatore non ha detto di no. Il default resta sì.
      apprendiKeyword: this.imparo() && r.firmeDaImparare.length > 0 && !modificate,
      firme: modificate && r.id === testa ? scelte : null,
      nota: null,
    }))).subscribe({
      next: () => {
        this.salvando.set(false);
        this.pushRecent(c.id);
        // Escono SOLO le righe scritte: una gemella deselezionata è ancora da sistemare e deve
        // restare visibile, non sparire con il resto del gruppo.
        this.rimuoviRighe(new Set(righe.map(r => r.id)));
        this.azzeraScelta();
        this.counts.reload();
        this.snackBar.open(
          righe.length === 1 ? 'Spesa sistemata' : righe.length + ' spese sistemate insieme',
          'OK', { duration: 2500 });
      },
      error: err => {
        this.salvando.set(false);
        const msg = err?.error?.message ?? 'Non è stato possibile sistemare questa spesa';
        this.snackBar.open(msg + ' — ricarico la coda per mostrarti cosa resta', 'OK', { duration: 8000 });
        this.ricarica();
      },
    });
  }

  chiediSposta(dest: 'EVENTO' | 'RICORRENTE'): void {
    // Scegliere la coda e scegliere il conto sono risposte alternative: non si tengono insieme.
    this.cogeScelto.set(null);
    this.buScelta.set(null);
    this.spostaVerso.set(this.spostaVerso() === dest ? null : dest);
  }

  /** Rimanda le righe scelte alla coda giusta. Il totale dell'import non si muove (SPEC R10). */
  sposta(): void {
    const dest = this.spostaVerso();
    const righe = this.righeScelte();
    if (!dest || !righe.length) return;

    this.salvando.set(true);
    const nota = this.motivoSposta().trim() || null;
    forkJoin(righe.map(r => this.movimenti.spostaInCoda(r.id, { destinazione: dest, nota })))
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.rimuoviRighe(new Set(righe.map(r => r.id)));
          this.azzeraScelta();
          this.counts.reload();
          this.snackBar.open(
            dest === 'EVENTO' ? 'Spostata in «Incassi evento»' : 'Spostata in «Rate»',
            'OK', { duration: 3000 });
        },
        error: err => {
          this.salvando.set(false);
          this.snackBar.open(err?.error?.message ?? 'Non è stato possibile spostare questa riga',
            'OK', { duration: 8000 });
          this.ricarica();
        },
      });
  }

  private avanti(): void {
    this.azzeraScelta();
    this.indice.update(i => (i + 1) % Math.max(1, this.gruppi().length));
  }

  private azzeraScelta(): void {
    this.cogeScelto.set(null);
    this.buScelta.set(null);
    this.insieme.set({});
    this.spostaVerso.set(null);
    this.motivoSposta.set('');
    // Il «non imparare» vale per la riga che si sta decidendo, non per tutta la sessione.
    this.imparo.set(true);
    this.spenti.set(new Set());
  }

  private recents(): number[] {
    try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch { return []; }
  }

  private pushRecent(id: number): void {
    const next = [id, ...this.recents().filter(x => x !== id)].slice(0, 8);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }
}
