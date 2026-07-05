import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  ReactiveFormsModule,
  FormControl,
  FormGroup,
  Validators,
} from '@angular/forms';
import { InputFilterDirective } from '../../shared/directives/input-filter.directive';
import { DateMaskDirective } from '../../shared/directives/date-mask.directive';
import { AppValidators } from '../../shared/validators/app-validators';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { EventiService } from '../../core/services/eventi.service';
import { PersonaleService } from '../../core/services/personale.service';
import { BuService } from '../../core/services/bu.service';
import { LookupService } from '../../core/services/lookup.service';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader/skeleton-loader.component';
import { EventoCreateRequest, EventoDTO } from '../../core/models/eventi.models';
import { PersonaleSummaryDTO } from '../../core/models/personale.models';
import { BusinessUnitDTO, TipoEventoDTO } from '../../core/models/anagrafica.models';

export interface EventoFormDialogData {
  eventoId?: string;
  dataPrecompilata?: string;
}

const ALLERGIE_COMUNI = [
  'Glutine', 'Lattosio', 'Uova', 'Pesce', 'Crostacei',
  'Arachidi', 'Soia', 'Frutta a guscio', 'Sedano',
  'Senape', 'Sesamo', 'Solfiti', 'Lupini', 'Molluschi',
];

/** Gruppo di personale per mansione, usato nel wizard step 2. */
interface PersonaleGruppo {
  mansione: string;
  persone: PersonaleSummaryDTO[];
}

@Component({
  selector: 'app-evento-form-dialog',
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
    MatProgressSpinnerModule,
    MatDividerModule,
    MatTooltipModule,
    MatCheckboxModule,
    MatChipsModule,
    SkeletonLoaderComponent,
    InputFilterDirective,
    DateMaskDirective,
  ],
  templateUrl: './evento-form-dialog.component.html',
  styles: [`
    /* ── Ritmo del form evento ─────────────────────────────────
       Più aria fra i campi e intestazioni di sezione con identità. */
    .evento-form { padding-bottom: 6px; }
    .evento-form .dform__row { margin-bottom: 18px; }
    .evento-form .dform__row:last-child { margin-bottom: 0; }

    .evento-form .dform__section {
      margin: 30px 0 18px; gap: 11px; font-size: .8rem; letter-spacing: .08em;
    }
    .evento-form .dform__section:first-child { margin-top: 6px; }
    .evento-form .dform__section mat-icon {
      box-sizing: content-box; padding: 6px; border-radius: 9px;
      font-size: 17px; width: 17px; height: 17px; opacity: 1;
      color: var(--primary-d);
      background: color-mix(in srgb, var(--primary) 13%, transparent);
    }

    .evento-form .dform__note { margin: 4px 0 20px; padding: 12px 14px; line-height: 1.5; }

    /* La textarea Note: niente icona prefix (si disallinea), più presenza. */
    .evento-form__note textarea { line-height: 1.55; }

    /* Amber semantico SOLO per gli allergeni (caution), il resto segue l'identità verde. */
    .allergie-section { width: 100%; }
    .allergie-label { font-size: .78rem; color: var(--text-sub); margin: 0 0 8px; font-weight: 600; }
    .allergie-comuni-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .allergia-toggle {
      padding: 4px 12px; border-radius: 16px; border: 1.5px solid var(--border);
      background: var(--surface); font-size: .8rem; cursor: pointer; font-family: inherit;
      color: var(--text-sub); transition: all .15s ease; line-height: 1.4;
    }
    .allergia-toggle:hover { border-color: #d97706; color: #b45309; }
    .allergia-toggle.active { background: #fff7ed; border-color: #d97706; color: #b45309; font-weight: 600; }
    .allergie-custom-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .allergia-custom-chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 10px; border-radius: 14px;
      background: #fff7ed; border: 1px solid #fcd9a8; color: #b45309;
      font-size: .74rem; font-weight: 600;
    }
    .allergia-custom-chip button {
      background: none; border: none; cursor: pointer; padding: 0; line-height: 1;
      color: #b45309; font-size: 16px; display: flex; align-items: center;
    }
    .allergie-input-row { display: flex; align-items: center; gap: 8px; }
    .bu-display {
      display: flex; align-items: center; gap: 10px; padding: 8px 14px;
      border-radius: 12px; background: color-mix(in srgb, var(--primary) 6%, transparent);
      border: 1px solid color-mix(in srgb, var(--primary) 16%, transparent);
      color: var(--text-main); min-height: 52px;
    }
    .bu-display mat-icon { font-size: 20px; width: 20px; height: 20px; color: var(--primary); flex-shrink: 0; }
    .bu-display__txt { display: flex; flex-direction: column; min-width: 0; }
    .bu-display__k { font-size: .66rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-sub); }
    .bu-name { font-weight: 600; font-size: .9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* ── Personale ─────────────────────────────────────────── */
    .personale-step { display: flex; flex-direction: column; gap: 12px; }
    .personale-count-chip {
      display: inline-flex; align-items: center; gap: 4px; margin-left: auto;
      padding: 2px 10px; border-radius: 12px; text-transform: none; letter-spacing: 0;
      background: color-mix(in srgb, var(--primary) 12%, transparent); color: var(--primary-d);
      font-size: .72rem; font-weight: 700;
    }
    .personale-count-chip mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .mansione-gruppo { margin-bottom: 4px; }
    .mansione-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px; border-radius: 10px 10px 0 0;
      background: var(--surface); border: 1px solid var(--border); border-bottom: none;
      cursor: pointer; user-select: none;
    }
    .mansione-header:hover { background: color-mix(in srgb, var(--primary) 5%, transparent); }
    .mansione-label { font-size: .82rem; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 6px; }
    .mansione-label mat-icon { color: var(--text-sub); }
    .mansione-badge { font-size: .68rem; background: var(--border); color: var(--text-sub); padding: 1px 7px; border-radius: 10px; }
    .mansione-badge.selected { background: color-mix(in srgb, var(--primary) 20%, transparent); color: var(--primary-d); }
    .mansione-toggle { color: var(--text-sub); font-size: 18px; }
    .persone-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px;
      padding: 10px 12px; border: 1px solid var(--border); border-radius: 0 0 10px 10px; background: var(--card);
    }
    .persona-card {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: 10px; border: 1.5px solid var(--border);
      background: var(--surface); cursor: pointer; transition: all .15s ease;
    }
    .persona-card:hover { border-color: color-mix(in srgb, var(--primary) 45%, var(--border)); }
    .persona-card.selected { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 9%, transparent); }
    .persona-avatar {
      width: 32px; height: 32px; border-radius: 50%;
      background: var(--primary); color: #fff; font-size: .74rem; font-weight: 700;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .persona-avatar.selected { background: var(--primary-d); }
    .persona-info { min-width: 0; }
    .persona-nome { font-size: .82rem; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .persona-check { margin-left: auto; flex-shrink: 0; }
    .empty-personale { text-align: center; padding: 32px 16px; color: var(--text-sub); font-size: .88rem; }
    .selezionati-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 0; }
    .selezionato-chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 10px; border-radius: 14px;
      background: color-mix(in srgb, var(--primary) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--primary) 25%, transparent); color: var(--primary-d);
      font-size: .74rem; font-weight: 600;
    }
    .selezionato-chip button { background: none; border: none; cursor: pointer; padding: 0; color: var(--primary-d); font-size: 14px; display: flex; align-items: center; }

    /* ── Step 3: Menu ──────────────────────────────────────── */
    .menu-step { display: flex; flex-direction: column; gap: 16px; }
    .menu-dropzone {
      border: 2px dashed var(--border); border-radius: 14px;
      padding: 32px 24px; text-align: center; cursor: pointer;
      background: var(--surface); transition: all .15s ease; color: var(--text-sub);
    }
    .menu-dropzone:hover, .menu-dropzone.dragover {
      border-color: var(--primary); background: color-mix(in srgb, var(--primary) 6%, transparent); color: var(--primary-d);
    }
    .menu-dropzone mat-icon { font-size: 44px; width: 44px; height: 44px; color: var(--primary); margin-bottom: 4px; }
    .menu-dropzone-title { font-size: .94rem; font-weight: 600; color: var(--text-main); margin: 8px 0 4px; }
    .menu-dropzone-sub { font-size: .78rem; color: var(--text-sub); margin: 0; }
    .menu-file-card {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px; border-radius: 12px;
      background: color-mix(in srgb, var(--primary) 6%, transparent); border: 1px solid color-mix(in srgb, var(--primary) 18%, transparent);
    }
    .menu-file-card mat-icon.pdf-ico { color: #c0392b; font-size: 28px; width: 28px; height: 28px; }
    .menu-file-meta { min-width: 0; flex: 1; }
    .menu-file-name { font-size: .88rem; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .menu-file-size { font-size: .74rem; color: var(--text-sub); }
    .menu-preview { width: 100%; height: 280px; border: 1px solid var(--border); border-radius: 10px; }
    .menu-word-note {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 24px 16px; border: 1.5px dashed var(--border); border-radius: 12px;
      background: var(--surface); color: var(--text-sub); text-align: center;
    }
    .menu-word-note mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--primary); }
    .menu-word-note p { margin: 0; font-size: .78rem; }
    .menu-word-note__tt { font-size: .88rem !important; font-weight: 600; color: var(--text-main); }
  `],
})
export class EventoFormDialogComponent implements OnInit, OnDestroy {
  private readonly dialogRef = inject(MatDialogRef<EventoFormDialogComponent>);
  private readonly data: EventoFormDialogData = inject(MAT_DIALOG_DATA);
  private readonly eventiService = inject(EventiService);
  private readonly personaleService = inject(PersonaleService);
  private readonly buService = inject(BuService);
  private readonly lookupService = inject(LookupService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly sanitizer = inject(DomSanitizer);

  // ── Step 3: Menu (PDF / Word) ───────────────────────────────────────────────
  static readonly MENU_MAX_BYTES = 10 * 1024 * 1024;
  static readonly MENU_ACCEPTED_MIMES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ] as const;

  readonly menuFile    = signal<File | null>(null);
  readonly menuPreviewUrl = signal<SafeResourceUrl | null>(null);
  readonly menuDragOver   = signal(false);
  private menuObjectUrl: string | null = null;

  readonly menuFileIsWord = computed(() => {
    const f = this.menuFile();
    return f !== null && f.type !== 'application/pdf';
  });

  readonly allergieComuni = ALLERGIE_COMUNI;
  tipiEvento = signal<TipoEventoDTO[]>([]);

  readonly isEdit = signal(false);
  readonly loadingForm = signal(false);
  /** Minimo selezionabile per la data evento in creazione: oggi (no eventi nel passato). */
  readonly today = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; })();
  readonly saving = signal(false);
  readonly selectedBu = signal<BusinessUnitDTO | null>(null);

  allergie = signal<string[]>([]);
  readonly allergieCustom = computed(() =>
    this.allergie().filter(a => !ALLERGIE_COMUNI.includes(a))
  );

  readonly allergiaInputControl = new FormControl<string>('', { nonNullable: true });

  // ── Step 1: Dati evento ────────────────────────────────────────────────────
  readonly form = new FormGroup({
    nome:                         new FormControl<string>('', { nonNullable: true, validators: [Validators.required, AppValidators.safeText()] }),
    tipo:                         new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    dataEvento:                   new FormControl<Date | null>(null, [Validators.required]),
    dataPreventivo:               new FormControl<Date | null>(null),
    businessUnitId:               new FormControl<number | null>(null, [Validators.required]),
    contattoNome:                 new FormControl<string>('', { nonNullable: true, validators: [Validators.required, AppValidators.onlyLetters()] }),
    contattoTelefono:             new FormControl<string | null>(null, [AppValidators.phone()]),
    contattoEmail:                new FormControl<string | null>(null, [Validators.email]),
    numeroTotalePartecipanti:     new FormControl<number | null>(null, [Validators.required, Validators.min(1)]),
    numeroBambini:                new FormControl<number | null>(null, [Validators.min(0)]),
    note:                         new FormControl<string | null>(null, [AppValidators.safeText()]),
  });

  // ── Step 2: Personale ──────────────────────────────────────────────────────
  personaleAttivi = signal<PersonaleSummaryDTO[]>([]);
  personaleSelezionati = signal<Set<string>>(new Set());
  gruppiExpanded = signal<Set<string>>(new Set());

  /** Personale attivo raggruppato per mansione, ordinato alfabeticamente. */
  readonly personalePerMansione = computed<PersonaleGruppo[]>(() => {
    const map = new Map<string, PersonaleSummaryDTO[]>();
    for (const p of this.personaleAttivi()) {
      const key = p.mansione ?? 'Senza mansione';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'it'))
      .map(([mansione, persone]) => ({ mansione, persone }));
  });

  /** Persone selezionate con i loro dati per il riepilogo. */
  readonly personaleSelezionatiList = computed(() =>
    this.personaleAttivi().filter(p => this.personaleSelezionati().has(p.id))
  );

  readonly contaSelezionati = computed(() => this.personaleSelezionati().size);

  ngOnInit(): void {
    if (this.data.eventoId) {
      this.isEdit.set(true);
      this.loadingForm.set(true);
      forkJoin({
        bu:           this.buService.getAll(),
        tipi:         this.lookupService.getTipiEvento(),
        evento:       this.eventiService.getById(this.data.eventoId),
        personale:    this.personaleService.getAllAttivi(),
        partecipanti: this.eventiService.getPartecipanti(this.data.eventoId),
      }).subscribe({
        next: ({ bu, tipi, evento, personale, partecipanti }) => {
          this.tipiEvento.set(tipi);
          this.applyBu(bu, evento.businessUnitId);
          this.patchForm(evento);
          this.personaleAttivi.set(personale.content);
          // Pre-seleziona i partecipanti già assegnati
          const ids = new Set(partecipanti.map(p => p.personaleId));
          this.personaleSelezionati.set(ids);
          this.initGruppiExpanded();
          this.loadingForm.set(false);
          this.cdr.markForCheck();
        },
        error: () => {
          this.loadingForm.set(false);
          this.snackBar.open('Errore nel caricamento dell\'evento', 'OK', { duration: 3000 });
          this.cdr.markForCheck();
        },
      });
    } else {
      forkJoin({
        bu:        this.buService.getAll(),
        tipi:      this.lookupService.getTipiEvento(),
        personale: this.personaleService.getAllAttivi(),
      }).subscribe({
        next: ({ bu, tipi, personale }) => {
          this.tipiEvento.set(tipi);
          this.applyBu(bu, null);
          this.form.controls.dataPreventivo.setValue(new Date());
          if (this.data.dataPrecompilata) {
            const [y, m, d] = this.data.dataPrecompilata.split('-').map(Number);
            this.form.controls.dataEvento.setValue(new Date(y, m - 1, d));
          }
          this.personaleAttivi.set(personale.content);
          this.initGruppiExpanded();
          this.cdr.markForCheck();
        },
        error: () => {
          this.snackBar.open('Errore nel caricamento dei dati', 'OK', { duration: 3000 });
          this.cdr.markForCheck();
        },
      });
    }
  }

  // ── BU ─────────────────────────────────────────────────────────────────────

  private applyBu(buList: BusinessUnitDTO[], existingId: number | null): void {
    const target = existingId != null
      ? buList.find(b => b.id === existingId)
      : buList.find(b => b.nome.toLowerCase().includes('cerimoni'));
    if (target) {
      this.selectedBu.set(target);
      this.form.controls.businessUnitId.setValue(target.id);
    }
  }

  private patchForm(ev: EventoDTO): void {
    const parseDate = (s: string | null): Date | null => {
      if (!s) return null;
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    };
    this.form.patchValue({
      nome:                        ev.nome,
      tipo:                        ev.tipo,
      dataEvento:                  parseDate(ev.dataEvento),
      dataPreventivo:              parseDate(ev.dataPreventivo),
      contattoNome:                ev.contattoNome,
      contattoTelefono:            ev.contattoTelefono,
      contattoEmail:               ev.contattoEmail,
      numeroTotalePartecipanti:    ev.numeroTotalePartecipanti,
      numeroBambini:               ev.numeroBambini,
      note:                        ev.note,
    });
    this.allergie.set([...(ev.allergie ?? [])]);
  }

  private initGruppiExpanded(): void {
    const tutti = new Set(this.personalePerMansione().map(g => g.mansione));
    this.gruppiExpanded.set(tutti);
  }

  // ── Allergie ────────────────────────────────────────────────────────────────

  hasAllergia(a: string): boolean {
    return this.allergie().includes(a);
  }

  toggleAllergia(a: string): void {
    if (this.hasAllergia(a)) {
      this.allergie.set(this.allergie().filter(x => x !== a));
    } else {
      this.allergie.set([...this.allergie(), a]);
    }
  }

  addAllergia(): void {
    const val = this.allergiaInputControl.value.trim();
    if (!val || this.hasAllergia(val)) return;
    this.allergie.set([...this.allergie(), val]);
    this.allergiaInputControl.setValue('');
  }

  removeAllergia(allergia: string): void {
    this.allergie.set(this.allergie().filter(a => a !== allergia));
  }

  onAllergiaKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addAllergia();
    }
  }

  // ── Personale selezione ────────────────────────────────────────────────────

  isSelected(id: string): boolean {
    return this.personaleSelezionati().has(id);
  }

  togglePersona(id: string): void {
    const set = new Set(this.personaleSelezionati());
    if (set.has(id)) {
      set.delete(id);
    } else {
      set.add(id);
    }
    this.personaleSelezionati.set(set);
    this.cdr.markForCheck();
  }

  toggleGruppo(mansione: string, persone: PersonaleSummaryDTO[]): void {
    const set = new Set(this.personaleSelezionati());
    const allSelected = persone.every(p => set.has(p.id));
    persone.forEach(p => allSelected ? set.delete(p.id) : set.add(p.id));
    this.personaleSelezionati.set(set);
    this.cdr.markForCheck();
  }

  isGruppoTuttoSelezionato(persone: PersonaleSummaryDTO[]): boolean {
    return persone.length > 0 && persone.every(p => this.personaleSelezionati().has(p.id));
  }

  contaSelezionatiGruppo(persone: PersonaleSummaryDTO[]): number {
    return persone.filter(p => this.personaleSelezionati().has(p.id)).length;
  }

  isGruppoExpanded(mansione: string): boolean {
    return this.gruppiExpanded().has(mansione);
  }

  toggleGruppoExpanded(mansione: string): void {
    const set = new Set(this.gruppiExpanded());
    if (set.has(mansione)) {
      set.delete(mansione);
    } else {
      set.add(mansione);
    }
    this.gruppiExpanded.set(set);
    this.cdr.markForCheck();
  }

  rimuoviSelezionato(id: string): void {
    const set = new Set(this.personaleSelezionati());
    set.delete(id);
    this.personaleSelezionati.set(set);
    this.cdr.markForCheck();
  }

  iniziali(nome: string, cognome: string): string {
    return `${nome.charAt(0)}${cognome.charAt(0)}`.toUpperCase();
  }

  // ── Menu PDF (step 3, solo creazione) ──────────────────────────────────────

  onMenuFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.setMenuFile(file);
    // consente di riselezionare lo stesso file dopo una rimozione
    input.value = '';
  }

  onMenuDrop(event: DragEvent): void {
    event.preventDefault();
    this.menuDragOver.set(false);
    const file = event.dataTransfer?.files?.[0] ?? null;
    this.setMenuFile(file);
  }

  onMenuDragOver(event: DragEvent): void {
    event.preventDefault();
    this.menuDragOver.set(true);
  }

  onMenuDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.menuDragOver.set(false);
  }

  removeMenuFile(): void {
    this.setMenuFile(null);
  }

  private setMenuFile(file: File | null): void {
    if (file) {
      if (!EventoFormDialogComponent.MENU_ACCEPTED_MIMES.includes(file.type as typeof EventoFormDialogComponent.MENU_ACCEPTED_MIMES[number])) {
        this.snackBar.open('Formato non supportato. Usa PDF o Word (.doc/.docx)', 'OK', { duration: 4000 });
        return;
      }
      if (file.size > EventoFormDialogComponent.MENU_MAX_BYTES) {
        this.snackBar.open('Il file supera i 10 MB', 'OK', { duration: 3000 });
        return;
      }
    }
    this.revokeMenuUrl();
    this.menuFile.set(file);
    // Anteprima inline solo per PDF; i Word non sono visualizzabili in iframe
    if (file && file.type === 'application/pdf') {
      this.menuObjectUrl = URL.createObjectURL(file);
      this.menuPreviewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.menuObjectUrl));
    } else {
      this.menuPreviewUrl.set(null);
    }
    this.cdr.markForCheck();
  }

  private revokeMenuUrl(): void {
    if (this.menuObjectUrl) {
      URL.revokeObjectURL(this.menuObjectUrl);
      this.menuObjectUrl = null;
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  ngOnDestroy(): void {
    this.revokeMenuUrl();
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const v = this.form.getRawValue();
    const body: EventoCreateRequest = {
      nome:                        v.nome,
      tipo:                        v.tipo,
      dataEvento:                  this.dateToIso(v.dataEvento!),
      dataPreventivo:              v.dataPreventivo ? this.dateToIso(v.dataPreventivo) : null,
      contattoNome:                v.contattoNome,
      contattoTelefono:            v.contattoTelefono ?? null,
      contattoEmail:               v.contattoEmail ?? null,
      numeroTotalePartecipanti:    v.numeroTotalePartecipanti!,
      numeroBambini:               v.numeroBambini ?? null,
      allergie:                    this.allergie(),
      note:                        v.note ?? null,
      businessUnitId:              v.businessUnitId,
      personaleIds:                [...this.personaleSelezionati()],
    };

    if (this.isEdit()) {
      this.eventiService
        .update(this.data.eventoId!, { ...body, personaleIds: [...this.personaleSelezionati()] })
        .subscribe({
          next: () => {
            this.saving.set(false);
            this.snackBar.open('Evento aggiornato', 'OK', { duration: 3000 });
            this.dialogRef.close(true);
          },
          error: () => {
            this.saving.set(false);
            this.snackBar.open('Errore durante il salvataggio', 'OK', { duration: 3000 });
            this.cdr.markForCheck();
          },
        });
      return;
    }

    this.eventiService.create(body).subscribe({
      next: evento => {
        const file = this.menuFile();
        if (!file) {
          this.saving.set(false);
          this.snackBar.open('Evento creato', 'OK', { duration: 3000 });
          this.dialogRef.close(true);
          return;
        }
        // Upload non bloccante: l'evento è già stato creato con successo.
        this.eventiService.uploadMenuPdf(evento.id, file).subscribe({
          next: () => {
            this.saving.set(false);
            this.snackBar.open('Evento creato con menu', 'OK', { duration: 3000 });
            this.dialogRef.close(true);
          },
          error: () => {
            this.saving.set(false);
            this.snackBar.open('Evento creato, ma il caricamento del menu è fallito', 'OK', { duration: 4000 });
            this.dialogRef.close(true);
          },
        });
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Errore durante il salvataggio', 'OK', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  private dateToIso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
