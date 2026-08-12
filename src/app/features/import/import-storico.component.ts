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
  // se un giorno la coda si riempie, il contatore «pend.» qui accanto lo mostra.

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
