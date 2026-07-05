import { Component, Inject, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { toSignal } from '@angular/core/rxjs-interop';
import { CespitiService } from '../../core/services/cespiti.service';
import { ContiService } from '../../core/services/conti.service';
import { ContoBancarioDTO, CespiteLiquidazioneRequest } from '../../core/models/anagrafica.models';
import { EuroPipe } from '../../shared/pipes/euro.pipe';

export interface LiquidazioneDialogData {
  cespiteId: string;
  descrizione: string;
  costoStorico: number;
}

/**
 * Liquidazione differita di un acquisto cespite rimasto DA_LIQUIDARE: sceglie il conto/cassa con
 * cui pagare (saldo visibile, disabilitato se < costo, stessa UX del dialog di acquisto). Il backend
 * ripete la guardia fondi (fail closed).
 */
@Component({
  selector: 'app-cespite-liquidazione-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, EuroPipe,
  ],
  templateUrl: './cespite-liquidazione-dialog.component.html',
  styleUrls: ['./cespite-acquisto-dialog.component.scss'],
})
export class CespiteLiquidazioneDialogComponent {
  private readonly cespitiSvc = inject(CespitiService);
  private readonly contiSvc = inject(ContiService);
  private readonly snack = inject(MatSnackBar);
  private readonly ref = inject<MatDialogRef<CespiteLiquidazioneDialogComponent, boolean>>(MatDialogRef);

  readonly saving = signal(false);
  readonly contoSelezionato = signal<number | null>(null);

  private readonly tuttiConti = toSignal(this.contiSvc.getAllFresh(), { initialValue: [] as ContoBancarioDTO[] });
  readonly contiPagamento = computed(() =>
    this.tuttiConti().filter(c => c.tipo === 'BANCARIO' || c.tipo === 'CASSA'));

  copre(c: ContoBancarioDTO): boolean {
    return c.saldoCalcolato >= this.data.costoStorico;
  }

  selezionaConto(c: ContoBancarioDTO): void {
    if (!this.copre(c)) return;
    this.contoSelezionato.set(c.id);
  }

  salva(): void {
    const id = this.contoSelezionato();
    const conto = this.contiPagamento().find(x => x.id === id);
    if (!conto || !this.copre(conto)) {
      this.snack.open('Scegli un conto o cassa con fondi sufficienti', 'OK', { duration: 3500 });
      return;
    }
    const req: CespiteLiquidazioneRequest = { contoBancarioId: conto.id };
    this.saving.set(true);
    this.cespitiSvc.liquidaAcquisto(this.data.cespiteId, req).subscribe({
      next: () => { this.snack.open('Acquisto liquidato', undefined, { duration: 2500 }); this.ref.close(true); },
      error: err => {
        this.saving.set(false);
        this.snack.open(err?.error?.message ?? 'Errore durante la liquidazione', 'OK', { duration: 4500 });
      },
    });
  }

  annulla(): void { this.ref.close(false); }

  constructor(@Inject(MAT_DIALOG_DATA) public data: LiquidazioneDialogData) {}
}
