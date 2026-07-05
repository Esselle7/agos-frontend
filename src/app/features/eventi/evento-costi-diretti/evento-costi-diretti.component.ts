import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EventiService } from '../../../core/services/eventi.service';
import { BuService } from '../../../core/services/bu.service';
import {
  EventoCostoDirettoDTO,
  EventoCostoDirettoRequest,
  EventoDTO,
  TipoCostoEvento,
  VoceCostoEvento,
} from '../../../core/models/eventi.models';
import { BusinessUnitDTO } from '../../../core/models/anagrafica.models';
import { EuroPipe } from '../../../shared/pipes/euro.pipe';
import { CurrencyInputComponent } from '../../../shared/components/currency-input/currency-input.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { HelpNoteComponent } from '../../../shared/components/help-note/help-note.component';

interface CostoCard {
  tipoCosto: TipoCostoEvento;
  voce: VoceCostoEvento;
  label: string;
  icon: string;
  defaultImporto: number | null;
}

const CARD_ICONS: Record<VoceCostoEvento, string> = {
  DJ:     'music_note',
  TORTA:  'cake',
  CUSTOM: 'add_circle_outline',
};

@Component({
  selector: 'app-evento-costi-diretti',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    NgTemplateOutlet,
    EuroPipe,
    CurrencyInputComponent,
    HelpNoteComponent,
  ],
  templateUrl: './evento-costi-diretti.component.html',
  styleUrls: ['./evento-costi-diretti.component.scss'],
})
export class EventoCostiDirettiComponent implements OnInit {
  @Input({ required: true }) evento!: EventoDTO;
  @Output() costiUpdated = new EventEmitter<void>();

  private readonly eventiService = inject(EventiService);
  private readonly buService = inject(BuService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly businessUnits = signal<BusinessUnitDTO[]>([]);

  readonly fissi: CostoCard[] = [
    { tipoCosto: 'FISSO', voce: 'DJ',     label: 'DJ',             icon: 'music_note',         defaultImporto: null },
    { tipoCosto: 'FISSO', voce: 'CUSTOM', label: 'Personalizzato', icon: 'add_circle_outline', defaultImporto: null },
  ];

  readonly variabili: CostoCard[] = [
    { tipoCosto: 'VARIABILE', voce: 'TORTA',  label: 'Torta',          icon: 'cake',               defaultImporto: null },
    { tipoCosto: 'VARIABILE', voce: 'CUSTOM', label: 'Personalizzato', icon: 'add_circle_outline', defaultImporto: null },
  ];

  costi = signal<EventoCostoDirettoDTO[]>([]);
  loading = signal(true);
  saving = signal(false);
  /** Chiave `${tipoCosto}:${voce}` della card con il form aperto, o null. */
  expandedKey = signal<string | null>(null);

  readonly form = new FormGroup({
    etichetta:              new FormControl<string | null>(null),
    importo:                new FormControl<number | null>(null),
    importoAddebitoCliente: new FormControl<number | null>(null),
    businessUnitId:         new FormControl<number | null>(null),
    note:                   new FormControl<string | null>(null),
  });

  readonly costiFissi     = computed(() => this.costi().filter(c => c.tipoCosto === 'FISSO'));
  readonly costiVariabili = computed(() => this.costi().filter(c => c.tipoCosto === 'VARIABILE'));
  readonly totale         = computed(() => this.costi().reduce((s, c) => s + (c.importo ?? 0), 0));
  readonly totaleFissi     = computed(() => this.costiFissi().reduce((s, c) => s + (c.importo ?? 0), 0));
  readonly totaleVariabili = computed(() => this.costiVariabili().reduce((s, c) => s + (c.importo ?? 0), 0));

  ngOnInit(): void {
    this.loadCosti();
    this.buService.getAll().subscribe({
      next: bu => { this.businessUnits.set(bu); this.cdr.markForCheck(); },
      error: () => {/* selettore BU resta vuoto → usa la BU evento lato server */},
    });
  }

  private loadCosti(): void {
    this.loading.set(true);
    this.eventiService.getCostiDiretti(this.evento.id).subscribe({
      next: list => { this.costi.set(list); this.loading.set(false); this.cdr.markForCheck(); },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Errore nel caricamento dei costi diretti', 'OK', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  cardKey(card: CostoCard): string { return `${card.tipoCosto}:${card.voce}`; }
  isOpen(card: CostoCard): boolean { return this.expandedKey() === this.cardKey(card); }
  isCustomOpen(): boolean { return this.expandedKey()?.endsWith(':CUSTOM') ?? false; }

  openCard(card: CostoCard): void {
    if (this.isOpen(card)) { this.cancelForm(); return; }
    this.form.reset();
    // Default BU = quella dell'evento (l'utente può cambiarla)
    this.form.controls.businessUnitId.setValue(this.evento.businessUnitId ?? null);
    if (card.defaultImporto != null) {
      this.form.controls.importo.setValue(card.defaultImporto);
    }
    this.expandedKey.set(this.cardKey(card));
  }

  cancelForm(): void {
    this.expandedKey.set(null);
    this.form.reset();
  }

  private currentCard(): CostoCard | null {
    const key = this.expandedKey();
    if (!key) return null;
    return [...this.fissi, ...this.variabili].find(c => this.cardKey(c) === key) ?? null;
  }

  submit(): void {
    const card = this.currentCard();
    if (!card) return;
    const v = this.form.getRawValue();

    if (card.voce === 'CUSTOM' && (!v.etichetta || !v.etichetta.trim())) {
      this.snackBar.open('Inserisci un\'etichetta per il costo personalizzato', 'OK', { duration: 3000 });
      return;
    }
    if (!v.importo || v.importo <= 0) {
      this.snackBar.open('Inserisci un importo maggiore di zero', 'OK', { duration: 3000 });
      return;
    }

    const req: EventoCostoDirettoRequest = {
      tipoCosto: card.tipoCosto,
      voce: card.voce,
      etichetta: card.voce === 'CUSTOM' ? v.etichetta!.trim() : null,
      importo: v.importo,
      importoAddebitoCliente: (v.importoAddebitoCliente && v.importoAddebitoCliente > 0)
        ? v.importoAddebitoCliente : null,
      businessUnitId: v.businessUnitId ?? null,
      note: v.note ?? null,
    };

    this.saving.set(true);
    this.eventiService.aggiungiCostoDiretto(this.evento.id, req).subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelForm();
        this.snackBar.open('Costo aggiunto', 'OK', { duration: 3000 });
        this.loadCosti();
        this.costiUpdated.emit();
      },
      error: err => {
        this.saving.set(false);
        const msg = err?.error?.message ?? 'Errore durante l\'aggiunta del costo';
        this.snackBar.open(msg, 'OK', { duration: 5000 });
        this.cdr.markForCheck();
      },
    });
  }

  remove(costo: EventoCostoDirettoDTO): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Rimuovi costo',
        message: `Rimuovere il costo "${costo.etichetta}"? Il movimento collegato verrà annullato.`,
        confirmLabel: 'Rimuovi', danger: true,
      },
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.eventiService.rimuoviCostoDiretto(this.evento.id, costo.id).subscribe({
        next: () => {
          this.snackBar.open('Costo rimosso', 'OK', { duration: 3000 });
          this.loadCosti();
          this.costiUpdated.emit();
        },
        error: () => this.snackBar.open('Errore durante la rimozione', 'OK', { duration: 3000 }),
      });
    });
  }

  voceIcon(voce: VoceCostoEvento): string { return CARD_ICONS[voce] ?? 'attach_money'; }
}
