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
import { EventoDTO, PagamentoEventoDTO, TipoPagamentoEvento, TIPI_PAGAMENTO_EVENTO } from '../../core/models/eventi.models';
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

        <!-- Indice sempre visibile: si salta a QUALSIASI riga, non solo alla prossima. Senza,
             per tornare su una riga già vista bisognava ricominciare da capo e scorrerle tutte. -->
        <nav class="wz__indice" aria-label="Elenco degli incassi da attribuire">
          <p class="wz__indice-tit">Tutti gli incassi</p>
          <ol class="wz__indice-lista">
            @for (x of righe(); track x.id; let i = $index) {
              <li>
                <button type="button" class="wz__ivoce"
                        [class.wz__ivoce--ora]="i === indice()"
                        [class.wz__ivoce--sosp]="rimandate().has(x.id)"
                        [attr.aria-current]="i === indice() ? 'true' : null"
                        (click)="vaA(i)">
                  <span class="wz__inum">{{ i + 1 }}</span>
                  <span class="wz__itxt">
                    <b>{{ x.controparteNome || 'Senza intestatario' }}</b>
                    <small>
                      {{ x.importo | currency:'EUR' }}
                      @if (x.dataMovimento) { · {{ x.dataMovimento | date:'d MMM' }} }
                      @if (rimandate().has(x.id)) { · in sospeso }
                      @if (x.gemelloInseritoIl) { · <span class="wz__idup">già a libro</span> }
                    </small>
                  </span>
                </button>
              </li>
            }
            @for (f of svolte(); track f.id) {
              <li>
                <span class="wz__ivoce wz__ivoce--fatta">
                  <mat-icon class="wz__ifatta">check</mat-icon>
                  <span class="wz__itxt">
                    <b>{{ f.nome }}</b>
                    <small>{{ f.importo | currency:'EUR' }} · fatta</small>
                  </span>
                </span>
              </li>
            }
          </ol>
        </nav>

        <div class="wz__col wz__col--ctx">
        <section class="wz__spesa">
          <p class="wz__frase">Sono arrivati <b class="wz__cifra">{{ r.importo | currency:'EUR' }}</b> da</p>
          <p class="wz__chi">{{ r.controparteNome || 'Intestatario non indicato' }}</p>
          <p class="wz__quando">
            @if (r.dataMovimento) { il {{ r.dataMovimento | date:'d MMMM yyyy' }} }
            {{ conto(r) }}
          </p>
          @if (r.gemelloInseritoIl) {
            <!-- C2: si dice PRIMA di scegliere l'evento, non dopo il rifiuto del server.
                 C3: è un avviso, non un blocco — la conferma resta possibile. -->
            <p class="wz__gia-libro">
              <mat-icon>content_copy</mat-icon>
              <span>Un incasso uguale — stesso importo, stesso giorno, stessa banca — è già a libro
                @if (r.gemelloEventoNome) { su <b>{{ r.gemelloEventoNome }}</b> }
                (inserito il {{ r.gemelloInseritoIl | date:'d MMMM' }}).
                Se è una seconda tranche vera puoi confermarlo lo stesso; se è lo stesso bonifico,
                mettilo da parte.</span>
            </p>
          }
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
        </div>

        <div class="wz__col wz__col--dec">

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

          <!-- Cosa è GIÀ a libro su questo evento. Il doppione del 14/08/2026 è passato anche
               perché qui non si vedeva nulla: la guardia del server lo blocca dopo, questa
               lista lo evita prima. I dati arrivano già dentro EventoDTO.pagamenti — nessuna
               chiamata in più, nessuna somma rifatta qui. -->
          @if (pagamentiEsistenti(); as pgs) {
            <section class="wz__gia" aria-labelledby="wz-gia">
              <h3 id="wz-gia">Su questo evento risulta già incassato</h3>
              <ul class="wz__gia-lista">
                @for (p of pgs; track p.movimentoId) {
                  <li [class.wz__gia--uguale]="sospettoDoppione(p)">
                    <span class="wz__gia-tipo">{{ parolaBreve(p.tipo) }}</span>
                    <span class="wz__gia-imp">{{ p.importo | currency:'EUR' }}</span>
                    <span class="wz__gia-data">{{ p.dataFinanziaria | date:'d MMM yyyy' }}</span>
                    @if (sospettoDoppione(p)) {
                      <span class="wz__gia-tag">
                        <mat-icon>warning</mat-icon> stesso importo e stessa data di questo
                      </span>
                    }
                  </li>
                }
              </ul>
            </section>
          }

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
                    {{ effetto(r, t) }}
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

        <!-- R9: escludere una riga bancaria richiede un motivo SCRITTO. Un motivo precompilato
             ("Non è un incasso evento") non dice niente a chi rileggerà fra sei mesi. -->
        <label class="wz__motivo">
          <span>Se non è un incasso evento, perché?</span>
          <input type="text" [value]="motivo()" (input)="motivo.set($any($event.target).value)"
                 placeholder="es. è il rimborso di un fornitore" aria-describedby="wz-motivo-aiuto">
          <small id="wz-motivo-aiuto">Resta scritto sulla riga: serve per poterla mettere da parte.</small>
        </label>

        <div class="wz__azioni wz__azioni--vuote">
          <button mat-stroked-button [disabled]="salvando() || !motivoValido()" (click)="nonEUnEvento(r)">
            <mat-icon>block</mat-icon> Non è un incasso evento
          </button>
          <button mat-stroked-button [disabled]="salvando()" (click)="rimanda()">
            <mat-icon>schedule</mat-icon> Non lo so, lascia in sospeso
          </button>
        </div>
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
    .wz { padding: 16px; display: flex; flex-direction: column; gap: 20px; max-width: 860px; }

    /* Due colonne quando lo schermo le regge: a sinistra COSA sto guardando, a destra COSA
       decido. È la stessa riga di prima, ma senza doverla scorrere per arrivare alla risposta —
       e il contesto resta sotto gli occhi mentre si sceglie (sticky). Sotto la soglia tornano
       impilate nello stesso ordine di lettura. */
    .wz__col { display: flex; flex-direction: column; gap: 20px; min-width: 0; }

    /* 1280 e non 1080: il rail di nav toglie 220px, quindi a 1080 di viewport il
       contenuto sarebbe 620 e due colonne verrebbero strette come un telefono.
       L'indice entra come TERZA colonna solo da 1500 in su: sotto quella soglia
       resterebbe in piedi togliendo spazio alla colonna che decide, quindi si impila
       sopra al contesto — sempre visibile, ma senza rubare larghezza. */
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

    /* L'indice non cresce mai oltre mezzo schermo: con 26 righe in coda una lista intera
       spingerebbe fuori vista la riga su cui si sta lavorando. */
    .wz__indice { min-width: 0; }
    .wz__indice-tit { margin: 0 0 8px; font-size: .8rem; font-weight: 650;
      text-transform: uppercase; letter-spacing: .04em; color: var(--text-sub); }
    .wz__indice-lista { list-style: none; margin: 0; padding: 0; display: flex;
      flex-direction: column; gap: 4px; max-height: min(52vh, 440px); overflow-y: auto;
      border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--card); padding: 6px; }

    .wz__ivoce { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
      padding: 8px 10px; min-height: 44px; border: 1px solid transparent;
      border-radius: var(--radius-sm); background: transparent; font: inherit;
      color: var(--text-main); cursor: pointer;
      transition: background var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease); }
    .wz__ivoce:hover { background: var(--tint-primary); }
    .wz__ivoce:focus-visible { outline: 2px solid var(--primary); outline-offset: -1px; }
    .wz__ivoce--ora { border-color: var(--primary); background: var(--tint-primary-strong); }
    /* Lo stato non è affidato al solo colore: «in sospeso» e «fatta» sono scritti in chiaro. */
    .wz__ivoce--sosp .wz__inum { background: var(--warning); color: var(--on-accent); }
    .wz__ivoce--fatta { cursor: default; opacity: .55; }
    .wz__ivoce--fatta:hover { background: transparent; }
    .wz__ifatta { color: var(--success); font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }

    .wz__inum { flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
      display: grid; place-items: center; background: var(--surface-2);
      font-size: .74rem; font-weight: 650; font-variant-numeric: tabular-nums; }
    .wz__ivoce--ora .wz__inum { background: var(--primary); color: var(--on-accent); }
    .wz__itxt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .wz__itxt b { font-size: .84rem; font-weight: 600; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; }
    .wz__itxt small { font-size: .74rem; color: var(--text-sub); }

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
    /* Il segnale «già a libro» si vede, ma la ragione è SCRITTA: mai solo il colore. */
    .wz__gia-libro { margin: 10px 0 0; padding: 9px 11px; display: flex; align-items: flex-start;
      gap: 8px; font-size: .86rem; line-height: 1.45; color: var(--text-main);
      background: var(--tint-warning); border: 1px solid var(--warning);
      border-radius: var(--radius-sm); }
    .wz__gia-libro mat-icon { font-size: 17px; width: 17px; height: 17px; flex-shrink: 0;
      margin-top: 2px; color: var(--warning); }
    .wz__idup { color: var(--warning); font-weight: 600; }

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

    /* Ciò che è già a libro sull'evento: si legge PRIMA di confermare. */
    .wz__gia h3 { margin: 0 0 8px; font-size: .95rem; font-weight: 600; }
    .wz__gia-lista { list-style: none; margin: 0 0 4px; padding: 0;
      display: flex; flex-direction: column; gap: 4px; }
    .wz__gia-lista li { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 7px 11px; border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--card); font-size: .86rem; }
    .wz__gia-tipo { font-weight: 600; }
    .wz__gia-imp { font-variant-numeric: tabular-nums; }
    .wz__gia-data { color: var(--text-sub); }
    /* Il sospetto doppione si vede, ma la ragione è SCRITTA nel tag: mai solo il colore. */
    .wz__gia--uguale { border-color: var(--warning); background: var(--tint-warning); }
    .wz__gia-tag { display: inline-flex; align-items: center; gap: 4px;
      font-size: .76rem; font-weight: 600; color: var(--warning); }
    .wz__gia-tag mat-icon { font-size: 15px; width: 15px; height: 15px; }

    .wz__nota { margin: 0 0 12px; display: flex; align-items: flex-start; gap: 8px;
      font-size: .86rem; color: var(--text-sub); }
    .wz__nota mat-icon { font-size: 17px; width: 17px; height: 17px; flex-shrink: 0; margin-top: 1px; }

    .wz__esito { background: var(--tint-success); border-radius: var(--radius-md); padding: 16px 18px;
      display: flex; flex-direction: column; gap: 14px; }
    .wz__effetto { margin: 0; display: flex; align-items: flex-start; gap: 9px;
      font-size: .95rem; line-height: 1.55; color: var(--text-main); }
    .wz__effetto mat-icon { color: var(--success); font-size: 19px; width: 19px; height: 19px;
      flex-shrink: 0; margin-top: 2px; }

    .wz__motivo { display: flex; flex-direction: column; gap: 3px; max-width: 460px; margin-bottom: 12px; }
    .wz__motivo > span { font-size: .84rem; font-weight: 600; color: var(--text-main); }
    .wz__motivo input { padding: 8px 10px; border: 1px solid var(--border);
      border-radius: var(--radius-sm); background: var(--card); font: inherit;
      font-size: .9rem; color: var(--text-main); }
    .wz__motivo input:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
    .wz__motivo small { font-size: .76rem; color: var(--text-sub); }
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

  /**
   * Id delle righe messe in sospeso con «Non lo so». Prima era un contatore: serve l'insieme
   * perché l'indice deve poter dire QUALI righe sono in sospeso, non solo quante.
   */
  readonly rimandate = signal<ReadonlySet<string>>(new Set<string>());
  readonly rimandati = computed(() => this.rimandate().size);

  /**
   * Righe chiuse in questa sessione: escono dalla coda ma restano nell'indice, spente.
   * Solo per leggerle — riaprirle significherebbe stornare un movimento già nel bilancio
   * dell'evento, che è del modulo Eventi (SPEC «Fuori scopo»).
   */
  readonly svolte = signal<{ id: string; nome: string; importo: number }[]>([]);

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
        this.rimandate.set(new Set<string>());
        this.svolte.set([]);
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

  /**
   * I pagamenti già a libro sull'evento scelto, così si vede PRIMA di confermare se questo
   * incasso è già dentro. Arrivano dentro `EventoDTO` (campo `pagamenti`), popolato dal
   * backend in `buildEventoDTO`: niente chiamata in più. `null` quando non c'è nulla da dire.
   */
  readonly pagamentiEsistenti = computed(() => {
    const p = this.eventoScelto()?.pagamenti?.filter(x => x.stato !== 'ANNULLATO') ?? [];
    return p.length ? p : null;
  });

  /**
   * La riga in lavorazione ha lo stesso importo e la stessa data di un pagamento già a libro:
   * è esattamente la coppia che il server rifiuta con `PAGAMENTO_DUPLICATO`. Qui si dice prima,
   * per non far sbattere il titolare contro un rifiuto.
   */
  sospettoDoppione(p: PagamentoEventoDTO): boolean {
    const r = this.corrente();
    return !!r && p.importo === r.importo && p.dataFinanziaria === r.dataMovimento;
  }

  /** «Un acconto» → «acconto»: nella lista dei già incassati l'articolo è rumore. */
  parolaBreve(t: TipoPagamentoEvento): string {
    return PAROLE_TIPO[t].replace(/^(Una |Un |Il )/, '');
  }

  /**
   * Cosa succede all'EVENTO quando si conferma — non al saldo del conto.
   *
   * <p>Fino al 14/08/2026 qui c'era «Il saldo del conto non cambia: il denaro è già arrivato».
   * Era falsa: la conferma <b>crea</b> un movimento (`EventiService.registraPagamento`) e quel
   * movimento entra nel saldo quando la sua data supera `data_saldo_iniziale` del conto — in
   * produzione oggi succede. Misura in docs/specs/misure/incassi-evento-verifica-2026-08-14.md.
   *
   * <p>Il residuo NON si ricalcola qui: si legge `importoResiduo`, che il backend tiene
   * aggiornato con `ricalcolaIncassi` sommando TUTTI i pagamenti (più acconti e più caparre
   * sono legittimi, ADR 003). Rifarne la somma nel componente sarebbe una seconda fonte di
   * verità che può divergere da quella del server.
   */
  effetto(r: EventoParcheggiatoDTO, t: TipoPagamentoEvento): string {
    const e = this.eventoScelto();

    if (t === 'RIMBORSO') {
      return 'È denaro che esce: l\'incassato dell\'evento cala di questo importo.';
    }
    if (t === 'PENALE') {
      return 'La penale non copre il preventivo dell\'evento: entra nel suo bilancio, ma non riduce quanto resta da incassare.';
    }

    // Segnaposto: preventivato = importo, quindi il residuo si azzera per costruzione.
    if (!e) {
      return 'L\'incasso resta in un contenitore «Da attribuire» finché non lo sposti sull\'evento vero.';
    }

    const residuo = e.importoResiduo;
    if (residuo == null) {
      return t === 'SALDO'
        ? 'Con il saldo l\'evento risulterà pagato per intero.'
        : 'L\'evento risulterà confermato e parzialmente incassato.';
    }

    const dopo = residuo - r.importo;

    // Chiude il residuo → l'evento si salda da solo (EventiService: CONFERMATO → SALDATO
    // quando il residuo scende sotto il centesimo). Vale per SALDO come per l'ultimo acconto.
    if (Math.abs(dopo) < 0.01) {
      return 'Copre tutto quello che restava: l\'evento risulterà saldato e non accetterà altri pagamenti.';
    }
    // Il server rifiuta con IMPORTO_SUPERA_RESIDUO: dirlo prima del click, non dopo.
    if (dopo < 0) {
      return `Attenzione: su questo evento restano da incassare ${this.euro(residuo)}, meno di questo pagamento — così com'è verrà rifiutato.`;
    }
    // NB: un pagamento marcato «saldo» che non copre il residuo NON chiude l'evento. Il tipo è
    // un'etichetta, a decidere è la cifra: dirlo qui evita di crederlo chiuso quando non lo è.
    return t === 'SALDO'
      ? `Non copre tutto: dopo questo pagamento resteranno da incassare ${this.euro(dopo)}, e l'evento resterà aperto.`
      : `Dopo questo pagamento resteranno da incassare ${this.euro(dopo)}.`;
  }

  private euro(n: number): string {
    return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
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
    const r = this.corrente();
    if (r) this.rimandate.update(s => new Set(s).add(r.id));
    this.azzeraScelta();
    this.indice.update(i => (i + 1) % Math.max(1, this.righe().length));
  }

  /** Salto diretto a una riga qualsiasi dall'indice. Cambia SOLO la navigazione: le scelte
   *  in corso si azzerano, così non si porta su un'altra riga un evento scelto per questa. */
  vaA(i: number): void {
    if (i === this.indice()) return;
    this.indice.set(i);
    this.azzeraScelta();
  }

  /** «Non è un incasso evento»: SCARTA — la riga esce dalla coda senza creare nulla. */
  /** Motivo dell'esclusione (R9): obbligatorio anche lato server, qui è solo cortesia. */
  readonly motivo = signal('');
  readonly motivoValido = computed(() => this.motivo().trim().length >= 3);

  nonEUnEvento(r: EventoParcheggiatoDTO): void {
    if (!this.motivoValido()) return;
    this.salvando.set(true);
    this.movimenti.risolviEvento(r.id, {
      azione: 'SCARTA', cogeId: null, businessUnitId: null, eventoId: null,
      nota: this.motivo().trim(),
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
    this.svolte.update(l => [...l, {
      id: r.id, nome: r.controparteNome || 'Senza intestatario', importo: r.importo,
    }]);
    this.rimandate.update(s => {
      if (!s.has(r.id)) return s;
      const n = new Set(s); n.delete(r.id); return n;
    });
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
    // A2: mai suggerire di allargare il preventivo — su un doppione produce preventivo falso
    // E ricavo fantasma. Prima si guarda se l'incasso è già a libro.
    IMPORTO_SUPERA_RESIDUO:
      'Controlla prima i pagamenti già registrati sull\'evento: se questo c\'è già, metti da parte la riga. Se è davvero un incasso in più del pattuito, registra l\'eccedenza come extra a consuntivo sull\'evento; se l\'evento è quello sbagliato, metti l\'incasso in un contenitore «Da attribuire».',
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
    PAGAMENTO_DUPLICATO:
      'Se è davvero un secondo incasso, controlla data e importo: due pagamenti veri differiscono almeno in uno dei due. Altrimenti metti da parte questa riga.',
  };

  private fallito(err: { error?: { message?: string; code?: string } }): void {
    this.salvando.set(false);
    const base = err.error?.message ?? 'Operazione non riuscita';
    const via = err.error?.code ? IncassiEventoWizardComponent.VIE_DUSCITA[err.error.code] : undefined;
    this.snackBar.open(via ? `${base} — ${via}` : base, 'OK', { duration: via ? 12000 : 5000 });
    if (err.error?.code === 'EVENTO_GIA_RISOLTO') this.ricarica();
  }
}
