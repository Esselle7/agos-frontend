import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { Location, DatePipe } from '@angular/common';
import {
  ReactiveFormsModule,
  FormControl,
  FormGroup,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { InputFilterDirective } from '../../shared/directives/input-filter.directive';
import { DateMaskDirective } from '../../shared/directives/date-mask.directive';
import { AppValidators } from '../../shared/validators/app-validators';
import { Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import {
  Subject, merge, switchMap, debounceTime,
  distinctUntilChanged, of, takeUntil, forkJoin,
} from 'rxjs';

import { MovimentiService } from '../../core/services/movimenti.service';
import { ContiService } from '../../core/services/conti.service';
import { CategorieService } from '../../core/services/categorie.service';
import { FornitoriService } from '../../core/services/fornitori.service';
import { EventiService } from '../../core/services/eventi.service';
import { LookupService } from '../../core/services/lookup.service';
import { BuSelectorComponent } from '../../shared/components/bu-selector/bu-selector.component';
import { CurrencyInputComponent } from '../../shared/components/currency-input/currency-input.component';
import { EuroPipe } from '../../shared/pipes/euro.pipe';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader/skeleton-loader.component';
import { CogePickerComponent } from '../../shared/components/coge-picker/coge-picker.component';
import { HelpNoteComponent } from '../../shared/components/help-note/help-note.component';
import { MovimentoCreateRequest, MovimentoDTO, TipoMovimento } from '../../core/models/movimenti.models';
import {
  ContoBancarioDTO, CategoriaNode, FornitoreSummaryDTO,
  PianoContiCogeDTO, MetodoPagamentoDTO, AliquotaIvaDTO,
} from '../../core/models/anagrafica.models';
import { EventoDTO } from '../../core/models/eventi.models';

const FONTI = ['MANUALE', 'IMPORT_BILLY', 'IMPORT_BANCA', 'IMPORT_ALVEARE', 'IMPORT_FATTURA'];

const TIPO_COGE_LABEL: Record<string, string> = {
  RICAVO:    'Ricavi',
  COSTO:     'Costi',
  ATTIVITA:  'Attività',
  PASSIVITA: 'Passività',
};

interface GruppoCogeDisplay {
  nomeGruppo: string;
  conti: PianoContiCogeDTO[];
}

export type TipoFlusso = 'immediato' | 'differito' | 'soloFinanziario';
export type StatoFinanziario = 'incassato' | 'nonIncassato';

interface PreviewImpatto {
  economico: number;
  finanziario: number;
  previsto: number;
  giorni: number | null;
}

@Component({
  selector: 'app-movimenti-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSlideToggleModule,
    MatAutocompleteModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDividerModule,
    BuSelectorComponent,
    CurrencyInputComponent,
    EuroPipe,
    DatePipe,
    SkeletonLoaderComponent,
    InputFilterDirective,
    DateMaskDirective,
    CogePickerComponent,
    HelpNoteComponent,
  ],
  templateUrl: './movimenti-form.component.html',
  styleUrls: ['./movimenti-form.component.scss'],
})
export class MovimentiFormComponent implements OnInit, OnDestroy {
  @Input() id?: string;

  private readonly movimentiService = inject(MovimentiService);
  private readonly contiService = inject(ContiService);
  private readonly categorieService = inject(CategorieService);
  private readonly fornitoriService = inject(FornitoriService);
  private readonly eventiService = inject(EventiService);
  private readonly lookupService = inject(LookupService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  readonly fonti = FONTI;

  // ── UI-only state: NOT stored in DTO, drives form behavior ─────────────────
  readonly tipoFlusso = signal<TipoFlusso>('immediato');
  readonly statoFinanziario = signal<StatoFinanziario>('incassato');

  /** True se il movimento era già liquidato al caricamento (edit). Blocca la de-liquidazione. */
  readonly wasLiquidato = signal<boolean>(false);

  // Mirror form values into signals so computed() can react to them
  private readonly _importo = signal<number | null>(null);
  private readonly _dataLiquidita = signal<Date | null>(null);
  private readonly _tipo = signal<TipoMovimento>('ENTRATA');

  // ── Preview impatto (SOLO UI, non tocca backend) ────────────────────────────
  readonly preview = computed<PreviewImpatto>(() => {
    const importo = this._importo() ?? 0;
    const tipo = this._tipo();
    const flusso = this.tipoFlusso();
    const stato = this.statoFinanziario();
    const dataLiq = this._dataLiquidita();
    const segno = tipo === 'ENTRATA' ? 1 : -1;

    const economicoAttivo = flusso !== 'soloFinanziario';
    const finanziarioOggi = flusso === 'soloFinanziario' || (flusso === 'immediato' && stato === 'incassato');
    const previsione = flusso === 'differito' && stato === 'nonIncassato';

    let giorni: number | null = null;
    if (previsione && dataLiq) {
      const oggi = new Date();
      oggi.setHours(0, 0, 0, 0);
      const liq = new Date(dataLiq);
      liq.setHours(0, 0, 0, 0);
      giorni = Math.round((liq.getTime() - oggi.getTime()) / 86_400_000);
    }

    return {
      economico:   economicoAttivo   ? segno * importo : 0,
      finanziario: finanziarioOggi   ? segno * importo : 0,
      previsto:    previsione        ? segno * importo : 0,
      giorni,
    };
  });

  // ── Computed visibility helpers ─────────────────────────────────────────────
  readonly showContoMetodo = computed(() =>
    this.tipoFlusso() === 'soloFinanziario' || this.statoFinanziario() === 'incassato'
  );

  readonly dataLiquiditaRequired = computed(() =>
    this.tipoFlusso() === 'differito' && this.statoFinanziario() === 'nonIncassato'
  );

  readonly labelDataMovimento = computed(() => {
    switch (this.tipoFlusso()) {
      case 'differito':       return 'Data competenza economica *';
      case 'soloFinanziario': return 'Data movimento finanziario *';
      default:                return 'Data operazione *';
    }
  });

  /**
   * Testi delle tre schede del passo 1, in UNA mappa `flusso × tipo`: con i ternari sparsi nel
   * template ci si dimentica sempre metà dei casi. Il resto del form parla già questa lingua
   * («Già incassato / Già pagato», «Scadenza incasso / Scadenza pagamento»): qui la si estende.
   *
   * Legge `_tipo()`, il signal specchio del FormControl: un computed che leggesse
   * `FormControl.value` resterebbe congelato sotto OnPush (trappola già vista nel progetto).
   */
  readonly schedeFlusso = computed(() => {
    const uscita = this._tipo() === 'USCITA';
    return {
      immediato: {
        icon: 'flash_on',
        label: 'Movimento immediato',
        desc: 'Economico e finanziario coincidono',
        esempio: uscita ? 'es. Pagamento effettuato oggi' : 'es. Pagamento ricevuto oggi',
      },
      differito: {
        icon: 'schedule',
        label: uscita ? 'Economico con pagamento differito' : 'Economico con incasso differito',
        desc: uscita ? "Il costo è ora, l'uscita di cassa arriva dopo"
                     : 'Il ricavo è ora, la cassa arriva dopo',
        esempio: uscita ? 'es. Fattura ricevuta, pagamento a 60gg'
                        : 'es. Fattura emessa, incasso tra 90gg',
      },
      soloFinanziario: {
        icon: 'swap_horiz',
        label: 'Solo finanziario',
        desc: 'Nessun impatto EBITDA',
        // Nessuna versione costo/ricavo: un giroconto è lo stesso nei due sensi.
        esempio: 'es. Giroconto, rettifica cassa',
      },
    };
  });

  // Metadati del tipo flusso scelto: badge read-only in edit mode e riga «Tipo» della revisione.
  readonly flussoMeta = computed(() => this.schedeFlusso()[this.tipoFlusso()]);

  // Toggle incassato/nonIncassato: visibile solo per 'differito'.
  // In edit mode, se il movimento era già liquidato, lo stato è bloccato
  // (la de-liquidazione non è consentita).
  readonly statoToggleVisible = computed(() =>
    this.tipoFlusso() === 'differito' && !(this.isEditMode && this.wasLiquidato())
  );

  // ── Lookup signals ──────────────────────────────────────────────────────────
  loading = signal(false);
  submitting = signal(false);
  conti = signal<ContoBancarioDTO[]>([]);
  metodiPagamento = signal<MetodoPagamentoDTO[]>([]);
  aliquoteIva = signal<AliquotaIvaDTO[]>([]);
  categoriePadre = signal<CategoriaNode[]>([]);
  categorieFiglio = signal<CategoriaNode[]>([]);
  filteredFornitori = signal<FornitoreSummaryDTO[]>([]);
  filteredEventi = signal<EventoDTO[]>([]);

  showEventoSection = false;

  filteredGruppiCoge: GruppoCogeDisplay[] = [];
  readonly cogeSearch = new FormControl<string>('', { nonNullable: true });
  private pianoContiAll: PianoContiCogeDTO[] = [];
  private gruppiCoge: GruppoCogeDisplay[] = [];

  readonly fornitoreSearch = new FormControl<string>('', { nonNullable: true });
  readonly eventoSearch = new FormControl<string>('', { nonNullable: true });

  private pendingCategoriaId: number | null = null;

  form = new FormGroup({
    tipo:                new FormControl<TipoMovimento>('ENTRATA', { nonNullable: true }),
    importo:             new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    dataMovimento:       new FormControl<Date | null>(new Date(), Validators.required),
    descrizione:         new FormControl<string>('', { nonNullable: true, validators: [Validators.required, AppValidators.safeText()] }),
    businessUnitId:      new FormControl<number | null>(null, Validators.required),
    // Validators applied dynamically based on tipoFlusso + statoFinanziario
    contoBancarioId:     new FormControl<number | null>(null),
    metodoPagamentoId:   new FormControl<number | null>(null),
    categoriaPadreId:    new FormControl<number | null>({ value: null, disabled: true }),
    categoriaFiglioId:   new FormControl<number | null>(null),
    contoCoge:           new FormControl<string>('', { nonNullable: true, validators: Validators.required }),
    fornitoreId:         new FormControl<string | null>(null),
    eventoId:            new FormControl<string | null>(null),
    tipoEventoMovimento: new FormControl<string | null>(null, [AppValidators.safeText()]),
    /** Data di liquidazione effettiva. Visibile per differito+incassato. */
    dataFinanziaria:     new FormControl<Date | null>(null),
    /** Scadenza finanziaria attesa. Visibile per differito+nonIncassato. */
    dataLiquidita:       new FormControl<Date | null>(null),
    importoLordo:        new FormControl<number | null>(null),
    aliquotaIva:         new FormControl<number | null>(null),
    note:                new FormControl<string | null>(null, [AppValidators.safeText()]),
    riferimentoEsterno:  new FormControl<string | null>(null, [AppValidators.safeText()]),
    fonte:               new FormControl<string>('MANUALE', { nonNullable: true }),
  });

  get isEditMode(): boolean { return !!this.id; }
  get tipoValue(): TipoMovimento { return this.form.controls.tipo.value; }

  get importoIvaCalcolato(): number | null {
    const imp = this.form.controls.importo.value;
    const aliq = this.form.controls.aliquotaIva.value;
    if (imp != null && aliq != null) return Math.round(imp * aliq * 100) / 100;
    return null;
  }

  get hasBu(): boolean { return this.form.controls.businessUnitId.value !== null; }

  ngOnInit(): void {
    forkJoin({
      conti:    this.contiService.getAll(),
      metodi:   this.lookupService.getMetodiPagamento(),
      piano:    this.lookupService.getPianoConti(),
      aliquote: this.lookupService.getAliquoteIva(),
    }).subscribe(({ conti, metodi, piano, aliquote }) => {
      this.conti.set(conti);
      this.metodiPagamento.set(metodi);
      this.aliquoteIva.set(aliquote);
      this.pianoContiAll = piano;
      this.gruppiCoge = this.buildGruppi(piano);
      this.filteredGruppiCoge = this.gruppiCoge;
      this.cdr.markForCheck();
      if (this.isEditMode) this.loadMovimento();
    });

    // Sync mirror signals so computed preview() reacts to form changes
    this.form.controls.importo.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(v => { this._importo.set(v); this.cdr.markForCheck(); });
    this.form.controls.tipo.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(v => {
        this._tipo.set(v);
        if (v === 'ENTRATA' && this.showEventoSection) {
          this.showEventoSection = false;
          this.clearEvento();
        }
        this.cdr.markForCheck();
      });
    this.form.controls.dataLiquidita.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(v => { this._dataLiquidita.set(v); this.cdr.markForCheck(); });

    this.form.controls.businessUnitId.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(buId => {
        buId
          ? this.form.controls.categoriaPadreId.enable()
          : this.form.controls.categoriaPadreId.disable();
      });

    merge(
      this.form.controls.businessUnitId.valueChanges,
      this.form.controls.tipo.valueChanges,
    ).pipe(debounceTime(0), takeUntil(this.destroy$))
      .subscribe(() => this.reloadCategorie());

    this.form.controls.categoriaPadreId.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(parentId => {
        const parent = this.categoriePadre().find(c => c.id === parentId);
        this.categorieFiglio.set(parent?.sottocategorie ?? []);
        this.form.controls.categoriaFiglioId.setValue(null, { emitEvent: false });
        this.cdr.markForCheck();
      });

    this.cogeSearch.valueChanges.pipe(
      debounceTime(150), distinctUntilChanged(), takeUntil(this.destroy$),
    ).subscribe(raw => {
      const q = typeof raw === 'string' ? raw : '';
      if (!q) {
        this.filteredGruppiCoge = this.gruppiCoge;
      } else {
        const lower = q.toLowerCase().trim();
        this.filteredGruppiCoge = this.gruppiCoge
          .map(g => ({
            ...g,
            conti: g.conti.filter(c =>
              c.nome.toLowerCase().includes(lower) || c.codice.toLowerCase().includes(lower)
            ),
          }))
          .filter(g => g.conti.length > 0);
      }
      this.cdr.markForCheck();
    });

    this.fornitoreSearch.valueChanges.pipe(
      debounceTime(300), distinctUntilChanged(),
      switchMap(search => {
        if (!search || search.length < 2)
          return of({ content: [] as FornitoreSummaryDTO[], page: 0, size: 20, totalElements: 0, totalPages: 0 });
        return this.fornitoriService.getList({ search, size: 20 });
      }),
      takeUntil(this.destroy$),
    ).subscribe(res => { this.filteredFornitori.set(res.content); this.cdr.markForCheck(); });

    this.eventoSearch.valueChanges.pipe(
      debounceTime(300), distinctUntilChanged(),
      switchMap(search => {
        if (!search || search.length < 2)
          return of({ content: [] as EventoDTO[], page: 0, size: 20, totalElements: 0, totalPages: 0 });
        return this.eventiService.getList({ search, size: 20 });
      }),
      takeUntil(this.destroy$),
    ).subscribe(res => { this.filteredEventi.set(res.content); this.cdr.markForCheck(); });

    // Set initial validators for default state (immediato + incassato)
    this.updateDynamicValidators();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── UI state change handlers ────────────────────────────────────────────────

  onTipoFlussoChange(value: TipoFlusso): void {
    this.tipoFlusso.set(value);
    if (value === 'differito') {
      this.statoFinanziario.set('nonIncassato');
      this.form.controls.contoBancarioId.setValue(null, { emitEvent: false });
      this.form.controls.metodoPagamentoId.setValue(null, { emitEvent: false });
      this.form.controls.dataFinanziaria.setValue(null, { emitEvent: false });
    } else if (value === 'soloFinanziario') {
      this.statoFinanziario.set('incassato');
      this.form.controls.dataLiquidita.setValue(null, { emitEvent: false });
      this.form.controls.dataFinanziaria.setValue(null, { emitEvent: false });
    } else {
      this.statoFinanziario.set('incassato');
      this.form.controls.dataLiquidita.setValue(null, { emitEvent: false });
      this.form.controls.dataFinanziaria.setValue(null, { emitEvent: false });
    }
    this.updateDynamicValidators();
    this.cdr.markForCheck();
  }

  onStatoFinanziarioChange(value: StatoFinanziario): void {
    this.statoFinanziario.set(value);
    if (value === 'nonIncassato') {
      this.form.controls.contoBancarioId.setValue(null, { emitEvent: false });
      this.form.controls.metodoPagamentoId.setValue(null, { emitEvent: false });
      this.form.controls.dataFinanziaria.setValue(null, { emitEvent: false });
    } else {
      this.form.controls.dataLiquidita.setValue(null, { emitEvent: false });
    }
    this.updateDynamicValidators();
    this.cdr.markForCheck();
  }

  private updateDynamicValidators(): void {
    const flusso = this.tipoFlusso();
    const stato = this.statoFinanziario();
    const contoCtrl   = this.form.controls.contoBancarioId;
    const metodoCtrl  = this.form.controls.metodoPagamentoId;
    const dataLiqCtrl = this.form.controls.dataLiquidita;
    const dataFinCtrl = this.form.controls.dataFinanziaria;

    const bancariaRequired = flusso === 'soloFinanziario' || stato === 'incassato';
    const liqRequired      = flusso === 'differito' && stato === 'nonIncassato';
    const finRequired      = flusso === 'differito' && stato === 'incassato';

    contoCtrl.setValidators(bancariaRequired ? Validators.required : null);
    metodoCtrl.setValidators(bancariaRequired ? Validators.required : null);
    dataLiqCtrl.setValidators(liqRequired ? [Validators.required, futureDateValidator] : null);
    dataFinCtrl.setValidators(finRequired ? Validators.required : null);

    contoCtrl.updateValueAndValidity({ emitEvent: false });
    metodoCtrl.updateValueAndValidity({ emitEvent: false });
    dataLiqCtrl.updateValueAndValidity({ emitEvent: false });
    dataFinCtrl.updateValueAndValidity({ emitEvent: false });
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  private loadMovimento(): void {
    this.loading.set(true);
    this.movimentiService.getById(this.id!).subscribe({
      next: mov => {
        this.populateForm(mov);
        this.loading.set(false);
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Errore nel caricamento del movimento', 'OK', { duration: 3000 });
        this.router.navigate(['/movimenti']);
      },
    });
  }

  private populateForm(mov: MovimentoDTO): void {
    this.pendingCategoriaId = mov.categoriaId ?? null;
    this.wasLiquidato.set(mov.dataFinanziaria != null);
    this.inferUiState(mov);

    const flusso = this.tipoFlusso();
    const stato  = this.statoFinanziario();

    // Per differito+incassato: il campo dataFinanziaria mostra la data di liquidazione effettiva.
    // Per differito+nonIncassato: il campo dataLiquidita mostra la scadenza finanziaria attesa.
    const dataFinanziariaVal = mov.dataFinanziaria ? this.parseDate(mov.dataFinanziaria) : null;
    const dataLiquiditaVal   = (flusso === 'differito' && stato === 'nonIncassato')
      ? (mov.dataLiquidita ? this.parseDate(mov.dataLiquidita) : null)
      : null;

    this.form.patchValue({
      tipo:                mov.tipo,
      importo:             mov.importo,
      dataMovimento:       mov.dataMovimento ? this.parseDate(mov.dataMovimento) : null,
      descrizione:         mov.descrizione,
      businessUnitId:      mov.businessUnitId,
      contoBancarioId:     mov.contoBancarioId ?? null,
      metodoPagamentoId:   mov.metodoPagamentoId ?? null,
      contoCoge:           String(mov.contoCoge),
      fornitoreId:         mov.fornitoreId,
      eventoId:            mov.eventoId,
      tipoEventoMovimento: mov.tipoEventoMovimento,
      dataFinanziaria:     dataFinanziariaVal,
      dataLiquidita:       dataLiquiditaVal,
      importoLordo:        null,
      aliquotaIva:         mov.importoIva && mov.importo
                             ? Math.round((mov.importoIva / mov.importo) * 100) / 100
                             : null,
      note:                mov.note,
      riferimentoEsterno:  mov.riferimentoEsterno,
      fonte:               mov.fonte ?? 'MANUALE',
    });

    // Sync mirror signals for preview
    this._importo.set(mov.importo);
    this._tipo.set(mov.tipo);
    this._dataLiquidita.set(dataLiquiditaVal);

    this.cogeSearch.setValue(this.cogeDisplayLabel(mov.contoCoge), { emitEvent: false });
    if (mov.eventoId) this.showEventoSection = true;

    if (mov.fornitoreId) {
      this.fornitoriService.getById(mov.fornitoreId).subscribe(f => {
        this.fornitoreSearch.setValue(f.ragioneSociale, { emitEvent: false });
        this.cdr.markForCheck();
      });
    }

    this.updateDynamicValidators();
  }

  // Ricostruzione dello stato UI dal DTO salvato.
  // Usa dataFinanziaria come sorgente di verità per lo stato di liquidazione.
  private inferUiState(mov: MovimentoDTO): void {
    // soloFinanziario è determinato dalla natura del conto CoGe (ATTIVITA/PASSIVITA):
    // questi conti non impattano l'EBITDA. Va riconosciuto prima di tutto, altrimenti
    // un giroconto verrebbe mostrato come 'immediato'.
    const coge = this.pianoContiAll.find(c => c.id === Number(mov.contoCoge));
    if (coge && (coge.tipo === 'ATTIVITA' || coge.tipo === 'PASSIVITA')) {
      this.tipoFlusso.set('soloFinanziario');
      this.statoFinanziario.set('incassato');
      return;
    }
    if (mov.dataFinanziaria == null) {
      // Nessuna data di liquidazione → DA_LIQUIDARE
      this.tipoFlusso.set('differito');
      this.statoFinanziario.set('nonIncassato');
      return;
    }
    // Liquidato: se la data economica e quella finanziaria differiscono → differito+incassato
    if (mov.dataMovimento !== mov.dataFinanziaria) {
      this.tipoFlusso.set('differito');
      this.statoFinanziario.set('incassato');
      return;
    }
    // Stessa data → immediato
    this.tipoFlusso.set('immediato');
    this.statoFinanziario.set('incassato');
  }

  private reloadCategorie(): void {
    const buId = this.form.controls.businessUnitId.value;
    const tipo = this.form.controls.tipo.value;
    if (!buId) {
      this.categoriePadre.set([]);
      this.categorieFiglio.set([]);
      this.pendingCategoriaId = null;
      return;
    }
    this.categorieService.getAlbero(buId).subscribe(data => {
      const filtrate = data.filter(c => c.tipo === tipo);
      this.categoriePadre.set(filtrate);
      this.categorieFiglio.set([]);
      if (this.pendingCategoriaId !== null) {
        this.restoreCategoria(filtrate, this.pendingCategoriaId);
        this.pendingCategoriaId = null;
      } else {
        this.form.controls.categoriaPadreId.setValue(null, { emitEvent: false });
        this.form.controls.categoriaFiglioId.setValue(null, { emitEvent: false });
      }
      this.cdr.markForCheck();
    });
  }

  private restoreCategoria(categorie: CategoriaNode[], id: number): void {
    const padre = categorie.find(c => c.id === id);
    if (padre) {
      this.form.controls.categoriaPadreId.setValue(padre.id, { emitEvent: false });
      return;
    }
    for (const p of categorie) {
      const figlio = (p.sottocategorie ?? []).find(s => s.id === id);
      if (figlio) {
        this.form.controls.categoriaPadreId.setValue(p.id, { emitEvent: false });
        this.categorieFiglio.set(p.sottocategorie);
        this.form.controls.categoriaFiglioId.setValue(figlio.id, { emitEvent: false });
        return;
      }
    }
  }

  // ── Autocomplete handlers ───────────────────────────────────────────────────

  onFornitoreSelected(event: MatAutocompleteSelectedEvent): void {
    const nome = event.option.value as string;
    const found = this.filteredFornitori().find(f => f.ragioneSociale === nome);
    if (!found) return;
    this.form.controls.fornitoreId.setValue(found.id);
    if (!this.form.controls.contoCoge.value) {
      this.fornitoriService.getById(found.id).subscribe(f => {
        if (f.cogeDefaultId) {
          this.form.controls.contoCoge.setValue(String(f.cogeDefaultId), { emitEvent: false });
          this.cogeSearch.setValue(this.cogeDisplayLabel(f.cogeDefaultId), { emitEvent: false });
          this.cdr.markForCheck();
        }
      });
    }
  }

  clearFornitore(): void {
    this.fornitoreSearch.setValue('');
    this.form.controls.fornitoreId.setValue(null);
  }

  onEventoSelected(event: MatAutocompleteSelectedEvent): void {
    const nome = event.option.value as string;
    const found = this.filteredEventi().find(e => e.nome === nome);
    this.form.controls.eventoId.setValue(found?.id ?? null);
  }

  clearEvento(): void {
    this.eventoSearch.setValue('');
    this.form.controls.eventoId.setValue(null);
    this.form.controls.tipoEventoMovimento.setValue(null);
  }

  onCogeSelected(event: MatAutocompleteSelectedEvent): void {
    const conto = event.option.value as PianoContiCogeDTO;
    this.form.controls.contoCoge.setValue(conto.id.toString(), { emitEvent: false });
    this.cogeSearch.setValue(`${conto.nome} (${conto.codice})`, { emitEvent: false });
    this.filteredGruppiCoge = this.gruppiCoge;
    this.cdr.markForCheck();
  }

  clearCoge(): void {
    this.form.controls.contoCoge.setValue('', { emitEvent: false });
    this.cogeSearch.setValue('');
    this.filteredGruppiCoge = this.gruppiCoge;
  }

  /** Scelta COGE dal nuovo picker → scrive l'id (string) nel control, come il vecchio autocomplete. */
  setCoge(conto: PianoContiCogeDTO | null): void {
    this.form.controls.contoCoge.setValue(conto ? String(conto.id) : '', { emitEvent: false });
    this.cogeSearch.setValue(conto ? `${conto.nome} (${conto.codice})` : '', { emitEvent: false });
    this.form.controls.contoCoge.markAsTouched();
    this.cdr.markForCheck();
  }

  // ── Wizard di creazione (solo UI: stessa form, stessi validator, stesso submit) ──────
  readonly step = signal(1);
  readonly steps = ['Tipo', 'Dati economici', 'Conto & fornitore', 'Incasso & dettagli', 'Revisione'];

  /** Control da validare per poter avanzare da uno step (gli stessi del form, niente nuovi). */
  private stepControls(s: number): AbstractControl[] {
    const f = this.form.controls;
    switch (s) {
      case 1: return [f.tipo];
      case 2: return [f.importo, f.dataMovimento, f.descrizione, f.businessUnitId];
      case 3: return [f.contoCoge];
      case 4: return [f.contoBancarioId, f.metodoPagamentoId, f.dataLiquidita, f.dataFinanziaria];
      default: return [];
    }
  }
  canAdvance(s: number): boolean { return this.stepControls(s).every(c => c.valid); }
  private markStep(s: number): void { this.stepControls(s).forEach(c => c.markAsTouched()); this.cdr.markForCheck(); }

  next(): void {
    if (!this.canAdvance(this.step())) { this.markStep(this.step()); return; }
    this.step.update(s => Math.min(s + 1, this.steps.length));
    this.cdr.markForCheck();
  }
  prev(): void { this.step.update(s => Math.max(s - 1, 1)); this.cdr.markForCheck(); }
  goToStep(n: number): void {
    if (n <= this.step()) { this.step.set(n); this.cdr.markForCheck(); return; }
    for (let s = this.step(); s < n; s++) {
      if (!this.canAdvance(s)) { this.markStep(s); this.step.set(s); this.cdr.markForCheck(); return; }
    }
    this.step.set(n); this.cdr.markForCheck();
  }

  // ── Etichette per lo step di revisione (risolte dai lookup già caricati) ─────────────
  get reviewCoge(): string { return this.cogeDisplayLabel(this.form.controls.contoCoge.value) || '—'; }
  get reviewFornitore(): string { return this.fornitoreSearch.value || '—'; }
  get reviewConto(): string {
    const id = this.form.controls.contoBancarioId.value;
    return this.conti().find(c => c.id === id)?.nome ?? '—';
  }
  get reviewMetodo(): string {
    const id = this.form.controls.metodoPagamentoId.value;
    return this.metodiPagamento().find(m => m.id === id)?.descrizione ?? '—';
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    const body = this.buildRequest();
    const obs = this.isEditMode
      ? this.movimentiService.update(this.id!, body)
      : this.movimentiService.create(body);

    obs.subscribe({
      next: () => {
        this.submitting.set(false);
        this.snackBar.open('Movimento salvato', 'OK', { duration: 3000 });
        this.router.navigate(['/movimenti']);
      },
      error: err => {
        this.submitting.set(false);
        if (err.status === 400 && err.error?.details) {
          this.applyServerErrors(err.error.details);
        } else {
          this.snackBar.open('Errore durante il salvataggio', 'OK', { duration: 3000 });
        }
        this.cdr.markForCheck();
      },
    });
  }

  goBack(): void { this.location.back(); }

  private buildRequest(): MovimentoCreateRequest {
    const v = this.form.getRawValue();
    const flusso = this.tipoFlusso();
    const stato  = this.statoFinanziario();
    const categoriaId = v.categoriaFiglioId ?? v.categoriaPadreId ?? null;

    // LIQUIDATO = immediato, soloFinanziario, oppure differito+incassato
    const isLiquidato = flusso === 'soloFinanziario' || stato === 'incassato';

    // dataFinanziaria: data di liquidazione effettiva.
    // Per differito+incassato: usa il campo dedicato del form.
    // Per immediato/soloFinanziario: coincide con dataMovimento.
    let dataFinanziaria: string | null = null;
    if (isLiquidato) {
      const raw = (flusso === 'differito') ? v.dataFinanziaria : v.dataMovimento;
      dataFinanziaria = raw ? this.formatDate(raw) : this.formatDate(v.dataMovimento!);
    }

    // dataLiquidita (scadenzaFinanziaria):
    // Se liquidato: auto-uguale a dataFinanziaria.
    // Se DA_LIQUIDARE: data attesa inserita dall'utente.
    const dataLiquidita = isLiquidato
      ? dataFinanziaria
      : (v.dataLiquidita ? this.formatDate(v.dataLiquidita) : null);

    const dataMovimentoStr = this.formatDate(v.dataMovimento!);

    return {
      tipo:              v.tipo,
      importo:           v.importo!,
      importoLordo:      v.importoLordo,
      aliquotaIva:       v.aliquotaIva,
      dataMovimento:     dataMovimentoStr,
      dataCompetenza:    dataMovimentoStr, // garantisce mv_conto_economico_mensile
      dataFinanziaria,
      dataLiquidita,
      contoBancarioId:   isLiquidato ? v.contoBancarioId   : null,
      metodoPagamentoId: isLiquidato ? v.metodoPagamentoId : null,
      businessUnitId:    v.businessUnitId!,
      contoCoge:         parseInt(v.contoCoge, 10),
      categoriaId,
      fornitoreId:         v.fornitoreId,
      eventoId:            v.eventoId,
      tipoEventoMovimento: v.tipoEventoMovimento,
      descrizione:         v.descrizione,
      note:                v.note,
      riferimentoEsterno:  v.riferimentoEsterno,
      fonte:               v.fonte || 'MANUALE',
      allegatoPath:        null,
    };
  }

  private applyServerErrors(details: Record<string, string>): void {
    for (const [campo, msg] of Object.entries(details)) {
      const ctrl = this.form.get(campo);
      if (ctrl) ctrl.setErrors({ server: msg });
    }
  }

  private buildGruppi(conti: PianoContiCogeDTO[]): GruppoCogeDisplay[] {
    const byTipo = new Map<string, PianoContiCogeDTO[]>();
    for (const conto of conti) {
      const lista = byTipo.get(conto.tipo) ?? [];
      lista.push(conto);
      byTipo.set(conto.tipo, lista);
    }
    return ['RICAVO', 'COSTO', 'ATTIVITA', 'PASSIVITA']
      .filter(tipo => byTipo.has(tipo))
      .map(tipo => ({ nomeGruppo: TIPO_COGE_LABEL[tipo] ?? tipo, conti: byTipo.get(tipo)! }));
  }

  private cogeDisplayLabel(id: number | string | null | undefined): string {
    if (id === null || id === undefined || id === '') return '';
    const numId = +id;
    const found = this.pianoContiAll.find(c => c.id === numId);
    return found ? `${found.nome} (${found.codice})` : String(id);
  }

  private parseDate(str: string): Date {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  private formatDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

// Standalone validator: data prevista non può essere nel passato
function futureDateValidator(ctrl: AbstractControl): ValidationErrors | null {
  if (!ctrl.value) return null;
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const d = new Date(ctrl.value); d.setHours(0, 0, 0, 0);
  return d < oggi ? { dataPassata: true } : null;
}
