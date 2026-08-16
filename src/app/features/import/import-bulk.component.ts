import { Component, signal, computed, inject, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MovimentiService } from '../../core/services/movimenti.service';
import { EtlImportResponse, FonteImport } from '../../core/models/movimenti.models';
import { ImportCountsService } from './import-counts.service';
import { PassiImportComponent } from './passi-import.component';

interface SlotDef { key: FonteImport; label: string; hint: string; accept: string; }

/**
 * Sezione "Importa": import congiunto dei 3 file (Billy + BPM + CA). Versione di pagina del
 * vecchio dialog. Al termine mostra il riepilogo e indirizza allo smistamento.
 */
@Component({
  selector: 'app-import-bulk',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatDividerModule,
            MatExpansionModule, PassiImportComponent],
  templateUrl: './import-bulk.component.html',
  styleUrls: ['./import-bulk.component.scss'],
})
export class ImportBulkComponent {
  private readonly movimentiService = inject(MovimentiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly counts = inject(ImportCountsService);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly slots: SlotDef[] = [
    { key: 'billy', label: 'Billy (Registratore Cassa)', hint: 'corrispettivi (.csv / .xlsx)', accept: '.csv,.xlsx,.txt' },
    { key: 'bpm',   label: 'Banco BPM',                  hint: 'MovimentiCC (.csv)',          accept: '.csv,.txt' },
    { key: 'ca',    label: 'Crédit Agricole',            hint: 'Movimenti (.csv)',            accept: '.csv,.txt' },
  ];

  files = signal<Record<FonteImport, File | null>>({ billy: null, bpm: null, ca: null });
  importing = signal(false);
  importResult = signal<EtlImportResponse | null>(null);

  readonly allSelected = computed(() => { const f = this.files(); return !!f.billy && !!f.bpm && !!f.ca; });
  readonly avvisi = computed(() => this.importResult()?.avvisi ?? []);
  // Scontrini Billy esclusi dalla contabilità import: agriturismo (→ modulo Eventi) e coda fondo
  // (venduto dopo l'ultima DEL banca, in attesa di accredito → contabilizzato al prossimo import).
  readonly avvisiAgriturismo = computed(() => this.avvisi().filter(a => a.messaggio.startsWith('EVENTO_AGRITURISMO')).length);
  readonly avvisiInAttesa = computed(() => this.avvisi().filter(a => a.messaggio.startsWith('IN_ATTESA_ACCREDITO')).length);

  fileFor(key: FonteImport): File | null { return this.files()[key]; }

  onFileSelected(key: FonteImport, event: Event): void {
    const input = event.target as HTMLInputElement;
    this.files.update(f => ({ ...f, [key]: input.files && input.files.length ? input.files[0] : null }));
  }

  onImport(): void {
    const f = this.files();
    if (!f.billy || !f.bpm || !f.ca) return;
    this.importing.set(true);
    this.movimentiService.importCongiunto(f.billy, f.bpm, f.ca).subscribe({
      next: res => { this.importResult.set(res); this.importing.set(false); this.counts.reload(); this.cdr.markForCheck(); },
      error: err => {
        this.importing.set(false);
        this.snackBar.open(err.error?.message ?? 'Errore durante l\'import congiunto', 'OK', { duration: 5000 });
        this.cdr.markForCheck();
      },
    });
  }

  ricomincia(): void {
    this.files.set({ billy: null, bpm: null, ca: null });
    this.importResult.set(null);
  }
}
