import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MovimentiService } from '../../core/services/movimenti.service';
import {
  ImportKpiDTO,
  RisolviEventoRequest,
  CoppiaSospettaDTO,
  EventoBreveDTO,
  MotivoMatchDTO,
  MatchingDifferitoDTO,
} from '../../core/models/movimenti.models';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ImportCountsService } from '../import/import-counts.service';

/**
 * Quel che resta del vecchio centro di smistamento: «Possibili duplicati» e «Già a libro».
 * Le altre quattro sezioni sono diventate wizard dedicati in features/import/ — spese
 * (§7.1), incassi evento (§7.2), rate (§7.3) — o sono state accorpate (Effetti/RiBa).
 */
@Component({
  selector: 'app-import-triage-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatSlideToggleModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatTooltipModule,
    MatCheckboxModule,
  ],
  templateUrl: './import-triage-dialog.component.html',
  styleUrls: ['./import-triage-dialog.component.scss'],
})
export class ImportTriageDialogComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly counts = inject(ImportCountsService);
  private readonly movimentiService = inject(MovimentiService);
  private readonly snackBar = inject(MatSnackBar);

  /** Sezione attiva (da rotta :sezione) → indice del tab (header nascosti, guida la nav laterale). */
  sezione = signal<string>('duplicati');
  private readonly tabIndex: Record<string, number> = {
    duplicati: 0, 'matching-differiti': 1,
  };
  selectedIndex = computed(() => this.tabIndex[this.sezione()] ?? 0);

  loading = signal(true);
  saving = signal<string | null>(null);
  modificato = false;

  kpi = signal<ImportKpiDTO | null>(null);
  coppie = signal<CoppiaSospettaDTO[]>([]);
  matchingDiff = signal<MatchingDifferitoDTO[]>([]);

  /** Circonferenza del ring punteggio (r=20). */
  readonly ringCirc = 2 * Math.PI * 20;


  /** Sezioni già caricate (lazy): si carica solo la sezione attiva, non tutte e 6. */
  private readonly caricate = new Set<string>();
  /** Sezione attualmente in caricamento (per mostrare lo spinner, non un falso "vuoto"). */
  sezioneLoading = signal<string | null>(null);

  ngOnInit(): void {
    // I lookup (coge/bu/fornitori) sono spariti con le sezioni che li usavano: le due rimaste
    // leggono solo la propria lista. La sezione attiva segue la rotta, in modo lazy.
    this.loading.set(false);
    this.route.paramMap.subscribe(p => {
      this.sezione.set(p.get('sezione') ?? 'duplicati');
      this.caricaSezione(this.sezione());
    });
  }

  /** Carica i dati della SOLA sezione richiesta, una volta (lazy load → niente over-fetch). */
  private caricaSezione(s: string): void {
    if (this.caricate.has(s)) return;
    this.caricate.add(s);
    this.sezioneLoading.set(s);
    const done = () => { if (this.sezioneLoading() === s) this.sezioneLoading.set(null); };
    const fail = (e: unknown) => { this.caricate.delete(s); done(); this.fail(e as { error?: { message?: string } }); };
    switch (s) {
      case 'duplicati':
        this.movimentiService.getAnalisiDuplicati().subscribe({ next: a => { this.coppie.set(a.coppie); this.counts.setDuplicati(a.coppie.length); done(); }, error: fail });
        break;
      case 'matching-differiti':
        this.movimentiService.getMatchingDifferiti('DA_RICONCILIARE', 0, 2000).subscribe({ next: r => { this.matchingDiff.set(r.content); done(); }, error: fail });
        break;
      default: done();
    }
  }

  /** Dopo un'azione: ricarica i badge dello shell (il KPI lo possiede lo shell). */
  private refreshKpi(): void {
    this.counts.reload();
  }

  // ── Matching differiti (Feature 2): import banche ↔ movimenti Da Liquidare ────

  /** COLLEGA: la riga banca È il movimento Da Liquidare già a libro → lo liquida (niente doppione). */
  collegaMatching(m: MatchingDifferitoDTO): void {
    this.saving.set(m.id);
    this.movimentiService.risolviMatchingDifferito(m.id, { azione: 'COLLEGA', metodoPagamentoId: null, nota: null }).subscribe({
      next: () => {
        this.saving.set(null);
        this.matchingDiff.update(rs => rs.filter(x => x.id !== m.id));
        this.modificato = true;
        this.refreshKpi();
        this.snackBar.open('Movimento esistente liquidato (nessun doppione creato)', 'OK', { duration: 3000 });
      },
      error: err => this.fail(err),
    });
  }

  /** IGNORA: falso positivo → la riga banca diventa un nuovo movimento; l'originale resta aperto. */
  ignoraMatching(m: MatchingDifferitoDTO): void {
    this.saving.set(m.id);
    this.movimentiService.risolviMatchingDifferito(m.id, { azione: 'IGNORA', metodoPagamentoId: null, nota: null }).subscribe({
      next: () => {
        this.saving.set(null);
        this.matchingDiff.update(rs => rs.filter(x => x.id !== m.id));
        this.modificato = true;
        this.refreshKpi();
        this.snackBar.open('Riga importata come nuovo movimento separato', 'OK', { duration: 3000 });
      },
      error: err => this.fail(err),
    });
  }

  /**
   * Un rifiuto del percorso-soldi deve arrivare all'operatore come una frase con una via
   * d'uscita, non come un codice. Il messaggio del server resta (contiene gli importi:
   * "supera il residuo da incassare EUR 400,00"), la UI ci aggiunge la mossa successiva.
   */
  private static readonly VIE_DUSCITA: Record<string, string> = {
    // A2: mai suggerire di allargare il preventivo — su un doppione produce preventivo falso
    // E ricavo fantasma. Prima si guarda se l'incasso è già a libro.
    IMPORTO_SUPERA_RESIDUO:
      'Controlla prima i pagamenti già registrati sull\'evento: se questo c\'è già, metti da parte la riga. Se è davvero un incasso in più del pattuito, registra l\'eccedenza come extra a consuntivo sull\'evento; se l\'evento è quello sbagliato, attribuiscila a un contenitore «Da attribuire» spuntando "Evento non ancora inserito".',
    EVENTO_SALDATO:
      'L\'evento risulta già saldato: riaprilo dalla scheda evento, oppure usa un contenitore «Da attribuire».',
    EVENTO_ANNULLATO:
      'Su un evento annullato entra solo una PENALE: cambia il tipo, oppure scegli un altro evento.',
    RIMBORSO_SUPERA_INCASSATO:
      'Il rimborso non può superare quanto già incassato sull\'evento: verifica l\'evento scelto.',
    EVENTO_GIA_RISOLTO:
      'Questa riga è già stata attribuita (magari da un\'altra finestra): ricarica lo smistamento.',
    CONTO_BANCARIO_MANCANTE:
      'Assegna prima la banca alla riga (Movimenti → "Senza banca"), poi riprova.',
    TIPO_EVENTO_NON_VALIDO:
      'Scegli uno dei tipi ammessi: CAPARRA, ACCONTO, SALDO, PENALE, RIMBORSO.',
    EVENTO_NON_CONTABILIZZABILE:
      'Un incasso-evento non diventa un movimento generico: attribuiscilo a un evento (o a un contenitore «Da attribuire»).',
    // ── Ricorrenti (SPEC ricorrenti-match-strutturato): ogni errore con la sua via d'uscita ──
    IMPORTO_SOTTO_QUOTA_CAPITALE:
      'L\'addebito è più basso della quota capitale della rata: gli interessi risulterebbero negativi. Verifica di aver scelto la rata giusta, oppure correggi il piano (debito/tasso) prima di collegare.',
    RATA_NON_COLLEGABILE:
      'Questa rata non è agganciabile (annullata o saltata): scegline un\'altra dal piano, oppure conferma la riga come movimento isolato.',
    FONDI_INSUFFICIENTI:
      'Il conto non ha saldo per pagare la rata: registra prima gli incassi mancanti (o correggi il saldo iniziale), poi ricollega.',
    RICORRENTE_GIA_RISOLTA:
      'Questa riga è già stata risolta (magari da un\'altra finestra): ricarica lo smistamento.',
    PIANO_O_RATA_MANCANTE:
      'Scegli il piano e la rata prima di collegare.',
    COLLEGA_SOLO_USCITE:
      'Un\'entrata (erogazione di un finanziamento) non è una rata: usa Conferma.',
  };

  private fail(err: { error?: { message?: string; code?: string } }): void {
    this.saving.set(null);
    const base = err.error?.message ?? 'Operazione non riuscita';
    const via = err.error?.code ? ImportTriageDialogComponent.VIE_DUSCITA[err.error.code] : undefined;
    this.snackBar.open(via ? `${base} — ${via}` : base, 'OK', { duration: via ? 12000 : 4000 });
  }

  // ── Possibili duplicati ─────────────────────────────────────────────────────

  /** Offset del ring SVG in funzione del punteggio 0-100. */
  ringOffset(punteggio: number): number {
    return this.ringCirc * (1 - Math.max(0, Math.min(100, punteggio)) / 100);
  }

  confLabel(c: CoppiaSospettaDTO): string {
    return c.confidenza === 'CERTA' ? 'Confidenza certa' : 'Da verificare';
  }

  fonteLabel(fonte: string): string {
    return fonte === 'IMPORT_BILLY' ? 'Billy · Cassa' : 'Banca · Estratto conto';
  }

  fonteClass(fonte: string): string {
    return 'triage__dup-src ' + (fonte === 'IMPORT_BILLY' ? 'billy' : 'banca');
  }

  /** Titolo della coppia: il nominativo più informativo tra i due lati. */
  titoloCoppia(c: CoppiaSospettaDTO): string {
    const nomi = [c.eventoA.controparteNome, c.eventoB.controparteNome]
      .filter((n): n is string => !!n)
      .sort((a, b) => b.length - a.length);
    return nomi[0] ?? 'Intestatario non indicato';
  }

  motivoClass(m: MotivoMatchDTO): string {
    return 'triage__dup-reason ' + m.tono.toLowerCase();
  }

  /** Scarta uno dei due eventi come duplicato (riusa la risoluzione evento). */
  scartaDuplicato(ev: EventoBreveDTO): void {
    this.saving.set(ev.id);
    this.movimentiService.risolviEvento(ev.id, {
      azione: 'SCARTA', cogeId: null, businessUnitId: null, eventoId: null,
      nota: 'Duplicato cross-sorgente',
    }).subscribe({
      next: () => {
        this.saving.set(null);
        this.coppie.update(cs => cs.filter(c => c.eventoA.id !== ev.id && c.eventoB.id !== ev.id));
        // La coda degli incassi-evento vive nel wizard «Di chi è questo incasso?»: qui la riga
        // scartata sparisce solo dalle coppie, il wizard la ricarica dal server alla sua apertura.
        this.modificato = true;
        this.refreshKpi();
        this.snackBar.open('Evento scartato come duplicato', 'OK', { duration: 2500 });
      },
      error: err => this.fail(err),
    });
  }


}
