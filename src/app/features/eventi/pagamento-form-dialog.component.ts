import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormControl, FormGroup, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { DateMaskDirective } from '../../shared/directives/date-mask.directive';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { EventiService } from '../../core/services/eventi.service';
import { ContiService } from '../../core/services/conti.service';
import { LookupService } from '../../core/services/lookup.service';
import { CurrencyInputComponent } from '../../shared/components/currency-input/currency-input.component';
import { EuroPipe } from '../../shared/pipes/euro.pipe';
import {
  PagamentoRequest,
  StatoEvento,
  TipoPagamentoEvento,
  TipoPagamentoForm,
} from '../../core/models/eventi.models';
import { ContoBancarioDTO, MetodoPagamentoDTO } from '../../core/models/anagrafica.models';

export interface PagamentoFormDialogData {
  eventoId: string;
  nomeEvento: string;
  stato: StatoEvento;
  importoTotalePreviventivato: number | null;
  importoResiduo: number | null;
  tipiGiaPresenti: TipoPagamentoEvento[];
}

interface TipoConfig {
  value: TipoPagamentoForm;
  label: string;
  desc: string;
  icon: string;
  color: string;
}

/**
 * Tipi creabili dall'utente. RIMBORSO è ammesso lato backend ma generato
 * in altri flussi (importo negativo); qui esponiamo solo i 4 tipi positivi.
 */
const TIPI: TipoConfig[] = [
  { value: 'CAPARRA',  label: 'Caparra',  desc: 'Prima conferma',       icon: 'lock',        color: '#f57c00' },
  { value: 'ACCONTO',  label: 'Acconto',  desc: 'Pagamento intermedio', icon: 'savings',     color: '#2C6E8F' },
  { value: 'SALDO',    label: 'Saldo',    desc: 'Chiusura totale',      icon: 'done_all',    color: '#388e3c' },
  { value: 'PENALE',   label: 'Penale',   desc: 'Da inadempienza',      icon: 'gavel',       color: '#c62828' },
];

@Component({
  selector: 'app-pagamento-form-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
    DateMaskDirective,
    MatProgressSpinnerModule,
    CurrencyInputComponent,
    EuroPipe,
  ],
  templateUrl: './pagamento-form-dialog.component.html',
  styles: [`
    .dialog-head {
      display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
    }
    .dialog-title-text { font-size:18px; font-weight:700; margin:0 0 2px; }
    .dialog-subtitle { font-size:13px; color:#6b7280; margin:0; }
    .field-group-label { font-size:12px; font-weight:600; color:#6b7280; text-transform:uppercase; letter-spacing:.5px; margin:0; }
    .residuo-pill {
      display:inline-flex; align-items:center; gap:4px;
      padding:2px 10px; border-radius:12px;
      background:#fff3e0; color:#e65100;
      font-size:13px; font-weight:700; border:1px solid #ffcc80;
    }
    .residuo-pill.zero { background:#e8f5e9; color:#2e7d32; border-color:#a5d6a7; }
    .tipo-grid {
      display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:16px 0;
    }
    .tipo-card {
      display:flex; flex-direction:column; align-items:center; gap:4px;
      padding:12px 8px; border-radius:10px; border:2px solid #e5e7eb;
      background:#f9fafb; cursor:pointer; transition:all .15s ease;
      font-family:inherit;
    }
    .tipo-card mat-icon { font-size:24px; width:24px; height:24px; }
    .tipo-card .tc-label { font-size:13px; font-weight:700; }
    .tipo-card .tc-desc  { font-size:11px; color:#9ca3af; text-align:center; line-height:1.2; }
    .tc-badge { font-size:10px; color:#9ca3af; background:#f3f4f6; border-radius:6px; padding:1px 6px; margin-top:2px; }
    .tipo-card.selected  { border-color:currentColor; background:color-mix(in srgb, currentColor 8%, white); }
    .tipo-card:disabled,
    .tipo-card.disabled  { opacity:.35; cursor:not-allowed; pointer-events:none; }
    .tipo-card:not(:disabled):not(.disabled):hover { border-color:currentColor; }
    .row-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .full { width:100%; }
    .avviso-saldo {
      display:flex; align-items:center; gap:8px;
      padding:8px 12px; border-radius:8px; margin:4px 0 8px;
      background:#e8f5e9; border:1px solid #a5d6a7;
      font-size:13px; color:#2e7d32;
    }
    .avviso-saldo mat-icon { font-size:18px; width:18px; height:18px; flex-shrink:0; }
    .today-btn { font-size:12px; margin-top:-4px; }
  `],
})
export class PagamentoFormDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<PagamentoFormDialogComponent>);
  readonly data: PagamentoFormDialogData = inject(MAT_DIALOG_DATA);
  private readonly eventiService = inject(EventiService);
  private readonly contiService = inject(ContiService);
  private readonly lookupService = inject(LookupService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly tipiConfig = TIPI;

  conti = signal<ContoBancarioDTO[]>([]);
  metodiPagamento = signal<MetodoPagamentoDTO[]>([]);
  loadingLookup = signal(true);
  saving = signal(false);

  tipo = signal<TipoPagamentoForm>(this.initialTipo());

  readonly form = new FormGroup({
    importo:           new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    data:              new FormControl<Date | null>(new Date(), [Validators.required]),
    metodoPagamentoId: new FormControl<number | null>(null, [Validators.required]),
    contoBancarioId:   new FormControl<number | null>(null, [Validators.required]),
    note:              new FormControl<string | null>(null),
  });

  // Rende i valori del form reattivi come signal, necessario per computed()
  private readonly formValues = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  readonly mostraAvvisoSaldo = computed(() => {
    const t = this.tipo();
    if (t === 'PENALE') return false;
    if (this.data.stato !== 'CONFERMATO') return false;
    const importo = this.formValues().importo;
    const residuo = this.data.importoResiduo;
    if (importo == null || residuo == null) return false;
    return importo >= residuo - 0.01;
  });

  constructor() {
    // Reagisce al signal tipo(): se SALDO → auto-compila il residuo, altrimenti svuota
    effect(() => {
      const t = this.tipo();
      if (t === 'SALDO' && this.data.importoResiduo != null) {
        this.form.controls.importo.setValue(this.data.importoResiduo);
      } else {
        this.form.controls.importo.setValue(null);
      }
      this.cdr.markForCheck();
    });
  }

  ngOnInit(): void {
    forkJoin({
      conti:  this.contiService.getAll(),
      metodi: this.lookupService.getMetodiPagamento(),
    }).subscribe({
      next: ({ conti, metodi }) => {
        this.conti.set(conti);
        this.metodiPagamento.set(metodi);
        this.loadingLookup.set(false);
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingLookup.set(false);
        this.snackBar.open('Errore nel caricamento dei dati', 'OK', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  selectTipo(t: TipoPagamentoForm): void {
    if (!this.tipoDisponibile(t)) return;
    this.tipo.set(t); // l'effect reagisce e aggiorna form.controls.importo
  }

  tipoDisponibile(t: TipoPagamentoForm): boolean {
    if (this.data.stato === 'ANNULLATO') return t === 'PENALE';
    if (t === 'PENALE') return true;
    return !this.data.tipiGiaPresenti.includes(t);
  }

  setOggi(): void {
    this.form.controls.data.setValue(new Date());
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const v = this.form.getRawValue();
    const body: PagamentoRequest = {
      tipo:              this.tipo(),
      importo:           v.importo!,
      data:              this.dateToIso(v.data!),
      note:              v.note ?? null,
      metodoPagamentoId: v.metodoPagamentoId!,
      contoBancarioId:   v.contoBancarioId!,
      contoCoge:         null,
    };

    this.eventiService.addPagamento(this.data.eventoId, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.snackBar.open('Pagamento registrato', 'OK', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: err => {
        this.saving.set(false);
        const msg = err?.error?.message ?? 'Errore durante la registrazione del pagamento';
        this.snackBar.open(msg, 'OK', { duration: 5000 });
        this.cdr.markForCheck();
      },
    });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  private initialTipo(): TipoPagamentoForm {
    if (this.data.stato === 'ANNULLATO') return 'PENALE';
    const order: TipoPagamentoForm[] = ['CAPARRA', 'ACCONTO', 'SALDO', 'PENALE'];
    return order.find(t => !this.data.tipiGiaPresenti.includes(t)) ?? 'PENALE';
  }

  private dateToIso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
