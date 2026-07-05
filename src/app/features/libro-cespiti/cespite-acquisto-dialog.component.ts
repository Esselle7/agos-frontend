import { Component, Inject, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { toSignal } from '@angular/core/rxjs-interop';
import { CespitiService } from '../../core/services/cespiti.service';
import { BuService } from '../../core/services/bu.service';
import { ContiService } from '../../core/services/conti.service';
import {
  BusinessUnitDTO, ContoBancarioDTO, PianoContiCogeDTO, CespiteAcquistoRequest,
} from '../../core/models/anagrafica.models';
import { EuroPipe } from '../../shared/pipes/euro.pipe';

interface DialogData { contiCapex: PianoContiCogeDTO[]; }

/**
 * Acquisto operativo di un cespite: crea il bene + il movimento di spesa CAPEX collegato.
 * Il pagamento si sceglie tra i conti reali (banche/cassa) col saldo visibile: un conto
 * senza fondi sufficienti non è selezionabile. Il backend ripete la verifica (fail closed).
 */
@Component({
  selector: 'app-cespite-acquisto-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonToggleModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, EuroPipe,
  ],
  templateUrl: './cespite-acquisto-dialog.component.html',
  styleUrls: ['./cespite-acquisto-dialog.component.scss'],
})
export class CespiteAcquistoDialogComponent {
  private readonly cespitiSvc = inject(CespitiService);
  private readonly buSvc = inject(BuService);
  private readonly contiSvc = inject(ContiService);
  private readonly snack = inject(MatSnackBar);
  private readonly ref = inject<MatDialogRef<CespiteAcquistoDialogComponent, boolean>>(MatDialogRef);

  readonly saving = signal(false);
  readonly businessUnits = toSignal(this.buSvc.getAll(), { initialValue: [] as BusinessUnitDTO[] });

  /** Conti pagabili: banche + cassa contanti, col saldo calcolato aggiornato. */
  private readonly tuttiConti = toSignal(this.contiSvc.getAllFresh(), { initialValue: [] as ContoBancarioDTO[] });
  readonly contiPagamento = computed(() =>
    this.tuttiConti().filter(c => c.tipo === 'BANCARIO' || c.tipo === 'CASSA'));

  /** PAGATO = uscita di cassa subito · DA_LIQUIDARE = debito verso fornitore. */
  readonly modalita = signal<'PAGATO' | 'DA_LIQUIDARE'>('PAGATO');
  readonly contoSelezionato = signal<number | null>(null);

  readonly form = new FormGroup({
    descrizione:    new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    contoCogeId:    new FormControl<number | null>(null, [Validators.required]),
    costoStorico:   new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    vitaAnni:       new FormControl<number>(5, { nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(50)] }),
    dataAcquisto:   new FormControl<string>(new Date().toISOString().slice(0, 10), { nonNullable: true, validators: [Validators.required] }),
    businessUnitId: new FormControl<number | null>(null, [Validators.required]),
  });

  private readonly v = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  readonly costo = computed(() => this.v().costoStorico ?? 0);

  /** Anteprima quota mensile = costo × (100/anni) / 1200. */
  readonly previewMensile = computed(() => {
    const anni = this.v().vitaAnni || 1;
    return this.costo() * (100 / anni) / 1200;
  });

  /** true se il conto copre il costo attuale. */
  copre(c: ContoBancarioDTO): boolean {
    return c.saldoCalcolato >= this.costo() && this.costo() > 0;
  }

  selezionaConto(c: ContoBancarioDTO): void {
    if (!this.copre(c)) return;
    this.contoSelezionato.set(c.id);
  }

  /** Il conto selezionato resta valido? (il costo può cambiare dopo la scelta) */
  private contoValido(): boolean {
    const id = this.contoSelezionato();
    const c = this.contiPagamento().find(x => x.id === id);
    return !!c && this.copre(c);
  }

  salva(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const pagato = this.modalita() === 'PAGATO';
    if (pagato && !this.contoValido()) {
      this.snack.open('Scegli con quale conto o cassa è stato pagato (con fondi sufficienti)', 'OK', { duration: 3500 });
      return;
    }
    const f = this.form.getRawValue();
    const req: CespiteAcquistoRequest = {
      descrizione: f.descrizione.trim(),
      contoCogeId: f.contoCogeId!,
      costoStorico: f.costoStorico!,
      vitaAnni: f.vitaAnni,
      dataAcquisto: f.dataAcquisto,
      businessUnitId: f.businessUnitId!,
      dataPagamento: pagato ? f.dataAcquisto : null,
      contoBancarioId: pagato ? this.contoSelezionato() : null,
    };
    this.saving.set(true);
    this.cespitiSvc.registraAcquisto(req).subscribe({
      next: () => { this.snack.open('Acquisto registrato', undefined, { duration: 2500 }); this.ref.close(true); },
      error: err => {
        this.saving.set(false);
        this.snack.open(err?.error?.message ?? 'Errore durante la registrazione', 'OK', { duration: 4500 });
      },
    });
  }

  annulla(): void { this.ref.close(false); }

  constructor(@Inject(MAT_DIALOG_DATA) public data: DialogData) {}
}
