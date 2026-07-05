import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { EventiService } from '../../../core/services/eventi.service';
import {
  EventoDTO,
  EventoVoceDTO,
  EventoVoceCatalogoDTO,
  EventoVoceRequest,
} from '../../../core/models/eventi.models';
import { EuroPipe } from '../../../shared/pipes/euro.pipe';
import { HelpNoteComponent } from '../../../shared/components/help-note/help-note.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';

/**
 * Sezione voci di preventivo/consuntivo di un evento. Ogni riga è
 * quantità × prezzo unitario. Le voci NON generano movimenti: compongono il
 * preventivato (Σ preventivo) e, dalla data evento, il consuntivato. Si sceglie
 * la voce dal listino (prezzo precompilato) e si inserisce la quantità.
 */
@Component({
  selector: 'app-evento-voci',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatButtonToggleModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    EuroPipe,
    HelpNoteComponent,
  ],
  templateUrl: './evento-voci.component.html',
  styleUrls: ['./evento-voci.component.scss'],
})
export class EventoVociComponent implements OnInit, OnChanges {
  @Input({ required: true }) evento!: EventoDTO;
  @Output() updated = new EventEmitter<void>();

  private readonly eventiService = inject(EventiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly voci = signal<EventoVoceDTO[]>([]);
  readonly catalogo = signal<EventoVoceCatalogoDTO[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly adding = signal(false);
  /** true se today >= dataEvento: il consuntivo è compilabile. */
  readonly consuntivabile = signal(false);

  /** Modalità di aggiunta: voce preventivata vs voce comparsa solo a consuntivo. */
  readonly addMode = signal<'PREV' | 'CONS'>('PREV');

  /** Form di aggiunta. catalogoId può valere 'NEW' per una voce fuori listino. */
  readonly addForm = new FormGroup({
    catalogoId:         new FormControl<number | 'NEW' | null>(null),
    label:              new FormControl<string>('', { nonNullable: true }),
    prezzoUnitario:     new FormControl<number | null>(null),
    quantitaPreventivo: new FormControl<number | null>(1),
    quantitaConsuntivo: new FormControl<number | null>(null),
    omaggio:            new FormControl<boolean>(false, { nonNullable: true }),
  });

  readonly editForm = new FormGroup({
    prezzoUnitario:     new FormControl<number | null>(null),
    quantitaPreventivo: new FormControl<number | null>(null),
    quantitaConsuntivo: new FormControl<number | null>(null),
  });

  /** Bridge reattivo (evita computed congelato su FormControl.value). */
  private readonly addValues = toSignal(this.addForm.valueChanges, {
    initialValue: this.addForm.getRawValue(),
  });
  private readonly editValues = toSignal(this.editForm.valueChanges, {
    initialValue: this.editForm.getRawValue(),
  });

  readonly addPreview = computed(() => {
    const v = this.addValues();
    return (v.prezzoUnitario ?? 0) * (v.quantitaPreventivo ?? 0);
  });
  readonly addPreviewCons = computed(() => {
    const v = this.addValues();
    return v.quantitaConsuntivo != null ? (v.prezzoUnitario ?? 0) * v.quantitaConsuntivo : null;
  });
  readonly editPreviewPrev = computed(() => {
    const v = this.editValues();
    return (v.prezzoUnitario ?? 0) * (v.quantitaPreventivo ?? 0);
  });
  readonly editPreviewCons = computed(() => {
    const v = this.editValues();
    return v.quantitaConsuntivo != null ? (v.prezzoUnitario ?? 0) * v.quantitaConsuntivo : null;
  });
  readonly isNewVoce = computed(() => this.addValues().catalogoId === 'NEW');
  readonly isOmaggio = computed(() => this.addValues().omaggio === true);

  readonly totalePreventivo = computed(() =>
    this.voci().reduce((s, v) => s + (v.importoPreventivo ?? 0), 0));
  readonly totaleConsuntivo = computed(() =>
    this.voci().reduce((s, v) => s + (v.importoConsuntivo ?? v.importoPreventivo ?? 0), 0));
  readonly scostamento = computed(() => this.totaleConsuntivo() - this.totalePreventivo());

  /** Default guidati non ancora presenti come voci → chip di aggiunta rapida. */
  readonly suggeriti = computed(() => {
    const presenti = new Set(this.voci().map(v => v.label.toLowerCase()));
    return this.catalogo().filter(c => c.isDefault && !presenti.has(c.label.toLowerCase()));
  });

  ngOnInit(): void {
    this.recomputeGate();
    this.voci.set(this.evento.voci ?? []);
    this.eventiService.getVociCatalogo().subscribe({
      next: c => { this.catalogo.set(c); this.loading.set(false); this.cdr.markForCheck(); },
      error: () => { this.loading.set(false); this.cdr.markForCheck(); },
    });
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (ch['evento'] && !ch['evento'].firstChange) {
      this.recomputeGate();
      this.voci.set(this.evento.voci ?? []);
    }
  }

  get isLocked(): boolean {
    return this.evento.stato === 'SALDATO' || this.evento.stato === 'ANNULLATO';
  }

  private recomputeGate(): void {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [y, m, d] = this.evento.dataEvento.split('-').map(Number);
    const de = new Date(y, m - 1, d);
    this.consuntivabile.set(de.getTime() <= today.getTime());
  }

  // ── Aggiunta ─────────────────────────────────────────────────────────────
  startAdd(catalogoId: number | 'NEW' | null = null, prezzo: number | null = null): void {
    this.addMode.set('PREV');
    this.addForm.reset({
      catalogoId, label: '', prezzoUnitario: prezzo,
      quantitaPreventivo: 1, quantitaConsuntivo: null, omaggio: false,
    });
    this.adding.set(true);
  }

  /** Quando si sceglie una voce di listino: precompila il prezzo di default (se non omaggio). */
  onListinoChange(catId: number | 'NEW' | null): void {
    if (catId === 'NEW' || catId == null) {
      if (!this.isOmaggio()) this.addForm.controls.prezzoUnitario.setValue(null);
      return;
    }
    const cat = this.catalogo().find(c => c.id === catId);
    this.addForm.patchValue({ label: '' });
    if (!this.isOmaggio()) this.addForm.controls.prezzoUnitario.setValue(cat?.prezzoDefault ?? null);
  }

  /** Flag omaggio: azzera il prezzo e lo rende non inseribile; togliendolo torna editabile. */
  onOmaggioChange(checked: boolean): void {
    if (checked) this.addForm.controls.prezzoUnitario.setValue(0);
  }

  /** Modalità aggiunta. In "solo consuntivo" il preventivo è azzerato in automatico. */
  setMode(mode: 'PREV' | 'CONS'): void {
    this.addMode.set(mode);
    if (mode === 'CONS') {
      this.addForm.controls.quantitaPreventivo.setValue(0);
      if (this.addForm.controls.quantitaConsuntivo.value == null) {
        this.addForm.controls.quantitaConsuntivo.setValue(1);
      }
    } else {
      this.addForm.controls.quantitaConsuntivo.setValue(null);
      this.addForm.controls.quantitaPreventivo.setValue(1);
    }
  }

  cancelAdd(): void { this.adding.set(false); }

  submitAdd(): void {
    const v = this.addForm.getRawValue();
    const isNew = v.catalogoId === 'NEW';
    const cons = this.addMode() === 'CONS';
    const label = (v.label ?? '').trim();
    const prezzo = v.omaggio ? 0 : v.prezzoUnitario;

    if (isNew && !label) { this.snackBar.open('Inserisci il nome della voce', 'OK', { duration: 3000 }); return; }
    if (!isNew && v.catalogoId == null) { this.snackBar.open('Scegli una voce dal listino', 'OK', { duration: 3000 }); return; }
    if (prezzo == null || prezzo < 0) { this.snackBar.open('Inserisci il prezzo unitario', 'OK', { duration: 3000 }); return; }
    if (cons) {
      if (v.quantitaConsuntivo == null || v.quantitaConsuntivo < 0) {
        this.snackBar.open('Inserisci la quantità consuntivo', 'OK', { duration: 3000 }); return;
      }
    } else if (v.quantitaPreventivo == null || v.quantitaPreventivo < 0) {
      this.snackBar.open('Inserisci la quantità', 'OK', { duration: 3000 }); return;
    }

    // Solo consuntivo → preventivo azzerato in automatico (non mostrato in inserimento).
    const base = {
      prezzoUnitario:     prezzo,
      quantitaPreventivo: cons ? 0 : v.quantitaPreventivo,
      quantitaConsuntivo: cons ? v.quantitaConsuntivo : null,
    };
    const req: EventoVoceRequest = isNew
      ? { label, ...base }
      : { catalogoId: v.catalogoId as number, ...base };

    this.saving.set(true);
    this.eventiService.aggiungiVoce(this.evento.id, req).subscribe({
      next: () => {
        this.saving.set(false); this.adding.set(false);
        this.snackBar.open('Voce aggiunta', 'OK', { duration: 2000 });
        this.updated.emit();
      },
      error: err => {
        this.saving.set(false);
        this.snackBar.open(err?.error?.message ?? 'Errore durante l\'aggiunta', 'OK', { duration: 4000 });
        this.cdr.markForCheck();
      },
    });
  }

  // ── Modifica ─────────────────────────────────────────────────────────────
  startEdit(voce: EventoVoceDTO): void {
    this.editForm.reset({
      prezzoUnitario:     voce.prezzoUnitario,
      quantitaPreventivo: voce.quantitaPreventivo,
      quantitaConsuntivo: voce.quantitaConsuntivo,
    });
    this.editingId.set(voce.id);
  }

  cancelEdit(): void { this.editingId.set(null); }

  submitEdit(voce: EventoVoceDTO): void {
    const v = this.editForm.getRawValue();
    const req: EventoVoceRequest = {
      prezzoUnitario:     v.prezzoUnitario,
      quantitaPreventivo: v.quantitaPreventivo,
      quantitaConsuntivo: this.consuntivabile() ? v.quantitaConsuntivo : null,
    };
    this.saving.set(true);
    this.eventiService.updateVoce(voce.id, req).subscribe({
      next: () => {
        this.saving.set(false); this.editingId.set(null);
        this.snackBar.open('Voce aggiornata', 'OK', { duration: 2000 });
        this.updated.emit();
      },
      error: err => {
        this.saving.set(false);
        this.snackBar.open(err?.error?.message ?? 'Errore durante il salvataggio', 'OK', { duration: 4000 });
        this.cdr.markForCheck();
      },
    });
  }

  // ── Rimozione ────────────────────────────────────────────────────────────
  remove(voce: EventoVoceDTO): void {
    if (voce.origine === 'COSTO_DIRETTO') return;
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Rimuovi voce',
        message: `Rimuovere la voce "${voce.label}"?`,
        confirmLabel: 'Rimuovi', danger: true,
      },
    }).afterClosed().subscribe(ok => {
      if (!ok) return;
      this.eventiService.rimuoviVoce(voce.id).subscribe({
        next: () => { this.snackBar.open('Voce rimossa', 'OK', { duration: 2000 }); this.updated.emit(); },
        error: () => this.snackBar.open('Errore durante la rimozione', 'OK', { duration: 3000 }),
      });
    });
  }
}
