import { Component, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MovimentiService } from '../../core/services/movimenti.service';
import { ImportLogDTO } from '../../core/models/movimenti.models';
import { TipoPagamentoEvento } from '../../core/models/eventi.models';
import { PagedResponse } from '../../core/models/shared.models';
import { ImportCountsService } from './import-counts.service';

/** Sezione "Storico": elenco import passati con contatori e rollback. */
@Component({
  selector: 'app-import-storico',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule, MatTableModule,
    MatPaginatorModule, MatProgressSpinnerModule, MatTooltipModule,
  ],
  templateUrl: './import-storico.component.html',
  styleUrls: ['./import-storico.component.scss'],
})
export class ImportStoricoComponent implements OnInit {
  private readonly movimentiService = inject(MovimentiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly counts = inject(ImportCountsService);

  readonly displayedColumns = ['dataImport', 'fonte', 'righe', 'stato', 'azioni'];
  result = signal<PagedResponse<ImportLogDTO> | null>(null);
  loading = signal(true);
  rollingBack = signal<string | null>(null);
  /** ponytail: TEMPORANEO (SPEC bpm-luglio-2026-recupero.md R8), si cancella con il bottone. */
  riprocessando = signal<string | null>(null);
  /**
   * Caricamento fallito, distinto da «nessun import effettuato»: senza, una richiesta andata
   * male mostrava «Nessun import effettuato» a chi gli import li ha fatti. Lo snackbar dura
   * 3 secondi, la frase falsa resta a schermo.
   */
  caricamentoFallito = signal(false);

  private page = 0;
  private size = 15;

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.caricamentoFallito.set(false);
    this.movimentiService.getImportHistory(undefined, this.page, this.size).subscribe({
      next: res => { this.result.set(res); this.loading.set(false); },
      error: () => {
        this.loading.set(false);
        this.caricamentoFallito.set(true);
        this.snackBar.open('Errore nel caricamento dello storico', 'OK', { duration: 3000 });
      },
    });
  }

  onPage(e: PageEvent): void { this.page = e.pageIndex; this.size = e.pageSize; this.load(); }

  pendenti(log: ImportLogDTO): number {
    return Math.max(0, (log.righeAmbigue ?? 0) - (log.righeAmbigueClassificate ?? 0));
  }

  // La revisione delle ambiguità non ha più una UI (audit §7.7): 0 righe su 2 import, non
  // meritava una schermata. La tabella `import_ambiguita` e i suoi endpoint restano intatti —
  // il contatore «pend.» qui accanto e il badge «Da rileggere» nella barra di fase la mostrano.

  /**
   * ponytail: BOTTONE TEMPORANEO — SPEC docs/specs/bpm-luglio-2026-recupero.md R8.
   *
   * Ri-manda nel motore di mapping le righe rimaste in coda per questo import. Serve a smaltire
   * UN arretrato: le 49 righe BPM di luglio 2026 ferme perché l'estratto conto era passato da un
   * foglio di calcolo (date senza secolo → nessuna data → nessun movimento). Brutto è ammesso,
   * nascosto no. DA RIMUOVERE — con l'endpoint e il metodo del service — quando la coda è vuota.
   */
  // ── ponytail: PANNELLO TEMPORANEO (SPEC bpm-luglio-2026-recupero.md) ────────────────
  // Due bottoni brutti di proposito per lo smaltimento dell'arretrato BPM di luglio 2026.
  // Si cancellano insieme al pannello nell'HTML, al metodo del service e all'endpoint.

  /** Esito dell'ultima azione temporanea, mostrato grezzo: serve a leggere i numeri, non a piacere. */
  esitoTemp = signal<string>('');
  lavoroTemp = signal(false);

  /** Rilettura della coda dell'ULTIMO import, senza dover cercare la riga in tabella. */
  riprocessaUltimo(): void {
    const id = this.counts.importCorrente();
    if (!id) { this.esitoTemp.set('Nessun import da rileggere.'); return; }
    this.lavoroTemp.set(true);
    this.esitoTemp.set('Rilettura in corso…');
    this.movimentiService.riprocessaCodaImport(id).subscribe({
      next: r => {
        this.lavoroTemp.set(false);
        this.esitoTemp.set(JSON.stringify(
          { righeAperte: r['righeAperte'], movimentiCreati: r['movimentiCreati'],
            esiti: r['esiti'], sigmaBpm: r['sigmaBpm'] }, null, 1));
        this.load(); this.counts.reload();
      },
      error: err => { this.lavoroTemp.set(false); this.esitoTemp.set('ERRORE: ' + (err.error?.message ?? err.message)); },
    });
  }

  /**
   * Le due caparre CELLA ERIKA di luglio 2026 (20,00 + 320,00) attribuite all'evento
   * «Festa ospedale Erika cella» del 18/09/2026. Sono due incassi distinti, non un doppione:
   * il modulo Eventi ammette un solo pagamento per tipo, quindi il primo entra come CAPARRA
   * e il secondo come ACCONTO. Se il server rifiuta, qui sotto compare il suo messaggio.
   */
  cellaErika(): void {
    const evento = '21198f44-8607-4e61-832d-8cbef721dc3b';
    const righe: [string, TipoPagamentoEvento, string][] = [
      ['6035559a-8c57-454d-ae40-acfa3e947dec', 'CAPARRA', '320,00'],
      ['edd6d354-4e4a-41b8-b639-4a5436956913', 'ACCONTO', '20,00'],
    ];
    this.lavoroTemp.set(true);
    this.esitoTemp.set('Attribuzione in corso…');
    const esiti: string[] = [];
    const passo = (i: number): void => {
      if (i >= righe.length) {
        this.lavoroTemp.set(false);
        this.esitoTemp.set(esiti.join('\n'));
        this.load(); this.counts.reload();
        return;
      }
      const [id, tipo, importo] = righe[i];
      this.movimentiService.risolviEvento(id, {
        azione: 'RICONCILIA', eventoId: evento, tipo, creaSegnaposto: false,
        cogeId: null, businessUnitId: null,
        nota: 'Caparra evento 18/09/2026 recuperata dopo il fix della data a 2 cifre',
      }).subscribe({
        next: () => { esiti.push(`OK  ${importo} come ${tipo}`); passo(i + 1); },
        error: err => { esiti.push(`KO  ${importo} come ${tipo}: ${err.error?.message ?? err.message}`); passo(i + 1); },
      });
    };
    passo(0);
  }

  riprocessa(log: ImportLogDTO): void {
    const ok = window.confirm(
      `Rileggere le ${this.pendenti(log)} righe rimaste in coda per l'import del ${this.formatDate(log.dataImport)}?\n` +
      `Ogni riga verrà rimandata nel motore di classificazione: finirà a libro o nella coda giusta. ` +
      `Le righe già decise non vengono toccate.`);
    if (!ok) return;
    this.riprocessando.set(log.id);
    this.movimentiService.riprocessaCodaImport(log.id).subscribe({
      next: r => {
        this.riprocessando.set(null);
        this.load();
        this.counts.reload();
        this.snackBar.open(
          `${r['movimentiCreati'] ?? 0} righe messe a libro su ${r['righeAperte'] ?? 0} rilette`, 'OK', { duration: 5000 });
      },
      error: err => {
        this.riprocessando.set(null);
        this.snackBar.open(err.error?.message ?? 'Rilettura non riuscita', 'OK', { duration: 4000 });
      },
    });
  }

  rollback(log: ImportLogDTO): void {
    const ok = window.confirm(
      `Annullare l'import del ${this.formatDate(log.dataImport)}?\n` +
      `Verranno eliminati tutti i movimenti, scartati, eventi e ricorrenti generati. Operazione reversibile solo ri-importando.`);
    if (!ok) return;
    this.rollingBack.set(log.id);
    this.movimentiService.rollbackImport(log.id).subscribe({
      next: () => { this.rollingBack.set(null); this.load(); this.counts.reload(); this.snackBar.open('Import annullato', 'OK', { duration: 2500 }); },
      error: err => { this.rollingBack.set(null); this.snackBar.open(err.error?.message ?? 'Rollback non riuscito', 'OK', { duration: 4000 }); },
    });
  }

  statoColor(s: string): string {
    return ({ COMPLETATO: '#2E7D32', COMPLETATO_CON_AMBIGUITA: '#E65100', ERRORE: '#C62828', IN_CORSO: '#2C6E8F' } as Record<string, string>)[s] ?? '#6B7280';
  }
  statoLabel(s: string): string {
    // "Da verificare" e non "Con ambiguità": lo stato ora copre anche le righe fuori dai conti (§7.4 n.3).
    return ({ COMPLETATO: 'Completato', COMPLETATO_CON_AMBIGUITA: 'Da verificare', ERRORE: 'Errore', IN_CORSO: 'In corso' } as Record<string, string>)[s] ?? s;
  }
  fonteLabel(f: string): string {
    return ({ IMPORT_BILLY: 'Billy', IMPORT_BANCA: 'Banca', IMPORT_CONGIUNTO: 'Congiunto' } as Record<string, string>)[f] ?? f;
  }
  formatDate(str: string): string {
    if (!str) return '—';
    return new Date(str).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
