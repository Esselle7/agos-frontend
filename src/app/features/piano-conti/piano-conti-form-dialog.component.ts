import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { ReactiveFormsModule, FormControl, FormGroup, Validators } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PianoContiService } from '../../core/services/piano-conti.service';
import {
  PianoContiCogeDTO,
  PianoContiCogeUpsertRequest,
  TipoCoge,
} from '../../core/models/anagrafica.models';
import { TIPI_COGE } from './piano-conti-tipi';

export interface PianoContiFormData {
  conto?: PianoContiCogeDTO;          // assente → creazione
  presetTipo?: TipoCoge;              // tipo preselezionato (aggiunta dentro un gruppo)
  conti: PianoContiCogeDTO[];         // per il selettore "conto padre", il calcolo codice e l'anteprima
}

interface PreviewRow { codice: string; nome: string; depth: number; isNew: boolean; }

@Component({
  selector: 'app-piano-conti-form-dialog',
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
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ isEdit ? 'Modifica conto' : 'Nuovo conto' }}</h2>

    @if (isEdit) {
      <!-- ── MODIFICA: form lineare (il codice esiste già, niente anteprima to-be) ────────────── -->
      <mat-dialog-content [formGroup]="form" class="pc-form">
        <mat-form-field appearance="outline">
          <mat-label>Nome del conto</mat-label>
          <input matInput formControlName="descrizione" maxlength="255" autocomplete="off" />
          @if (form.controls.descrizione.hasError('required') && form.controls.descrizione.touched) {
            <mat-error>Il nome è obbligatorio</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Natura (tipo)</mat-label>
          <mat-select formControlName="tipo">
            @for (t of tipi; track t.value) {
              <mat-option [value]="t.value">{{ t.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Conto padre (opzionale)</mat-label>
          <mat-select formControlName="parentId">
            <mat-option [value]="null">— Conto di primo livello —</mat-option>
            @for (c of parentOptions(); track c.id) {
              <mat-option [value]="c.id">{{ c.indent }}{{ c.nome }} <span class="pc-code-muted">{{ c.codice }}</span></mat-option>
            }
          </mat-select>
        </mat-form-field>

        <div class="pc-form__codice">
          <mat-form-field appearance="outline" class="pc-form__codice-field">
            <mat-label>Codice</mat-label>
            <input matInput formControlName="codice" maxlength="20"
                   [readonly]="!codiceEditabile()"
                   [class.pc-form__codice-locked]="!codiceEditabile()" />
            @if (form.controls.codice.hasError('required') && form.controls.codice.touched) {
              <mat-error>Il codice è obbligatorio</mat-error>
            }
          </mat-form-field>
          @if (!codiceEditabile()) {
            <button mat-button type="button" class="pc-form__codice-toggle" (click)="codiceEditabile.set(true)">
              <mat-icon>tune</mat-icon> Modifica codice (avanzato)
            </button>
          } @else {
            <p class="pc-form__codice-warn">
              <mat-icon>warning_amber</mat-icon>
              Cambiare il codice aggiorna a cascata le regole e le keyword collegate.
            </p>
          }
        </div>

        @if (errore()) {
          <p class="pc-form__error"><mat-icon>error_outline</mat-icon> {{ errore() }}</p>
        }
      </mat-dialog-content>
    } @else {
      <!-- ── CREAZIONE: due pannelli — inserimento guidato a sinistra, anteprima to-be a destra ── -->
      <mat-dialog-content class="pcx" [class]="'pcx--' + (tipoSig() ?? 'none')">
        <div class="pcx__form" [formGroup]="form">
          <div class="pcx__step">
            <span class="pcx__step-label"><b>1.</b> Che natura ha il conto?</span>
            <div class="pcx__chips" role="radiogroup" aria-label="Natura del conto">
              @for (t of tipi; track t.value) {
                <button type="button" class="pcx-chip" [class]="'pcx-chip--' + t.value"
                        [class.pcx-chip--on]="tipoSig() === t.value" role="radio"
                        [attr.aria-checked]="tipoSig() === t.value" (click)="scegliTipo(t.value)">
                  <mat-icon>{{ t.icon }}</mat-icon>
                  <span>{{ t.plurale }}</span>
                </button>
              }
            </div>
          </div>

          <div class="pcx__step">
            <span class="pcx__step-label"><b>2.</b> Come si chiama?</span>
            <mat-form-field appearance="outline" class="pcx__name">
              <mat-label>Nome del conto</mat-label>
              <input matInput formControlName="descrizione" maxlength="255" autocomplete="off"
                     placeholder="es. Vendita torte da asporto" />
              @if (form.controls.descrizione.hasError('required') && form.controls.descrizione.touched) {
                <mat-error>Il nome è obbligatorio</mat-error>
              }
            </mat-form-field>
          </div>

          <div class="pcx__step">
            <span class="pcx__step-label"><b>3.</b> In quale gruppo? <span class="pcx__opt">facoltativo</span></span>
            <mat-form-field appearance="outline">
              <mat-label>Conto padre</mat-label>
              <mat-select formControlName="parentId">
                <mat-option [value]="null">— Conto di primo livello —</mat-option>
                @for (c of parentOptions(); track c.id) {
                  <mat-option [value]="c.id">{{ c.indent }}{{ c.nome }} <span class="pc-code-muted">{{ c.codice }}</span></mat-option>
                }
              </mat-select>
              <mat-hint>{{ tipoSig() ? 'Il codice si genera da solo, lo vedi qui accanto' : 'Scegli prima la natura' }}</mat-hint>
            </mat-form-field>
          </div>

          @if (errore()) {
            <p class="pc-form__error"><mat-icon>error_outline</mat-icon> {{ errore() }}</p>
          }
        </div>

        <aside class="pcx__preview">
          @if (!tipoSig()) {
            <div class="pcx__empty">
              <mat-icon>account_tree</mat-icon>
              <p>Scegli la <b>natura</b> per vedere dove finirà il conto.</p>
            </div>
          } @else {
            <div class="pcx__preview-head">
              <mat-icon>{{ tipoMetaCorrente()?.icon }}</mat-icon>
              <span class="pcx__preview-title">{{ tipoMetaCorrente()?.plurale }}</span>
              <span class="pcx__preview-tag">anteprima</span>
            </div>
            <ul class="pcx-tree" role="list">
              @for (r of previewRows(); track $index) {
                <li>
                  <div class="pcx-row" [class.pcx-row--new]="r.isNew" [class.pcx-row--child]="r.depth > 0"
                       [style.--depth]="r.depth">
                    <span class="pcx-row__rail" aria-hidden="true"></span>
                    <span class="pcx-row__code">{{ r.codice }}</span>
                    <span class="pcx-row__name">{{ r.nome }}</span>
                    @if (r.isNew) { <span class="pcx-row__badge">nuovo</span> }
                  </div>
                </li>
              }
            </ul>
          }
        </aside>
      </mat-dialog-content>
    }

    <mat-dialog-actions>
      @if (isEdit) {
        <button mat-button class="pc-form__delete" [disabled]="saving()" (click)="elimina()">
          <mat-icon>delete_outline</mat-icon> Elimina
        </button>
      }
      <span class="pc-form__spacer"></span>
      <button mat-button [disabled]="saving()" (click)="close()">Annulla</button>
      <button mat-flat-button color="primary" [disabled]="saving() || form.invalid" (click)="salva()">
        @if (saving()) { <mat-spinner diameter="18" /> } @else { {{ isEdit ? 'Salva' : 'Crea' }} }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    /* ── comuni ─────────────────────────────────────────────────────────────── */
    .pc-code-muted { font-family: ui-monospace, 'Courier New', monospace; font-size: .74rem; color: var(--text-faint); margin-left: 8px; }
    .pc-form__error { display: flex; align-items: center; gap: 6px; margin: 4px 0 0; color: var(--danger); font-size: .85rem; }
    .pc-form__error mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pc-form__spacer { flex: 1 1 auto; }
    .pc-form__delete { color: var(--danger); }
    .pc-form__delete mat-icon { margin-right: 4px; }

    /* ── modifica (form lineare) ────────────────────────────────────────────── */
    .pc-form { display: flex; flex-direction: column; gap: 4px; min-width: 360px; padding-top: 8px; }
    .pc-form mat-form-field { width: 100%; }
    .pc-form__codice { display: flex; flex-direction: column; gap: 2px; }
    .pc-form__codice-field .pc-form__codice-locked { color: var(--text-sub); cursor: default; }
    .pc-form__codice-toggle { align-self: flex-start; color: var(--text-sub); font-size: .82rem; }
    .pc-form__codice-toggle mat-icon { font-size: 18px; width: 18px; height: 18px; margin-right: 4px; }
    .pc-form__codice-warn { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; color: var(--warning); font-size: .8rem; }
    .pc-form__codice-warn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* ── creazione (due pannelli) ───────────────────────────────────────────── */
    /* --accent: colore della natura scelta (ereditato dai figli del pannello destro). */
    .pcx--RICAVO            { --accent: var(--success); }
    .pcx--COSTO             { --accent: var(--danger); }
    .pcx--ATTIVITA          { --accent: var(--info); }
    .pcx--PASSIVITA         { --accent: var(--warning); }
    .pcx--ONERE_FINANZIARIO { --accent: var(--primary); }
    .pcx--IMPOSTA           { --accent: var(--accent-d); }
    .pcx--none              { --accent: var(--text-sub); }

    .pcx {
      display: grid; grid-template-columns: minmax(300px, 1fr) minmax(300px, 1.05fr);
      gap: 22px; padding-top: 6px; align-items: start;
    }
    .pcx__form { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .pcx__form mat-form-field { width: 100%; }
    .pcx__step { display: flex; flex-direction: column; gap: 8px; }
    .pcx__step-label { font-size: .88rem; color: var(--text-main); }
    .pcx__step-label b { color: var(--accent); margin-right: 2px; }
    .pcx__opt { font-size: .74rem; color: var(--text-faint); font-weight: 500; }

    /* Natura come griglia di chip: icona + colore token; ognuna porta il proprio --accent. */
    .pcx__chips { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .pcx-chip--RICAVO            { --accent: var(--success); }
    .pcx-chip--COSTO             { --accent: var(--danger); }
    .pcx-chip--ATTIVITA          { --accent: var(--info); }
    .pcx-chip--PASSIVITA         { --accent: var(--warning); }
    .pcx-chip--ONERE_FINANZIARIO { --accent: var(--primary); }
    .pcx-chip--IMPOSTA           { --accent: var(--accent-d); }
    .pcx-chip {
      display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 12px 6px;
      font: inherit; cursor: pointer; text-align: center; color: var(--text-sub);
      background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-md);
      transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
    }
    .pcx-chip mat-icon { color: var(--accent); }
    .pcx-chip span { font-size: .76rem; font-weight: 600; line-height: 1.15; }
    .pcx-chip:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); background: color-mix(in srgb, var(--accent) 6%, var(--card)); }
    .pcx-chip--on {
      color: var(--text-main); border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 12%, var(--card));
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    .pcx-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    /* Pannello destro: anteprima to-be. */
    .pcx__preview {
      position: sticky; top: 0; display: flex; flex-direction: column; min-width: 0;
      background: var(--surface-sunken); border: 1px solid var(--border); border-radius: var(--radius-lg);
      max-height: 62vh; overflow: auto;
    }
    .pcx__empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
      text-align: center; color: var(--text-sub); padding: 40px 24px; min-height: 200px;
    }
    .pcx__empty mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--text-faint); }
    .pcx__empty p { margin: 0; font-size: .86rem; max-width: 22ch; }

    .pcx__preview-head {
      display: flex; align-items: center; gap: 8px; padding: 11px 14px; position: sticky; top: 0; z-index: 1;
      background: color-mix(in srgb, var(--accent) 10%, var(--card));
      border-bottom: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
    }
    .pcx__preview-head mat-icon { color: var(--accent); font-size: 20px; width: 20px; height: 20px; }
    .pcx__preview-title { font-weight: 700; font-size: .92rem; color: var(--text-main); }
    .pcx__preview-tag {
      margin-left: auto; font-size: .66rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
      color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent);
      padding: 2px 7px; border-radius: 999px;
    }

    .pcx-tree { list-style: none; margin: 0; padding: 6px; display: flex; flex-direction: column; gap: 1px; }
    .pcx-row {
      position: relative; display: flex; align-items: center; gap: 9px;
      padding: 7px 10px 7px calc(10px + var(--depth, 0) * 20px); border-radius: var(--radius-sm);
    }
    .pcx-row__rail { position: absolute; top: 0; bottom: 0; width: 0; pointer-events: none; }
    .pcx-row--child .pcx-row__rail::before {
      content: ''; position: absolute; left: calc(10px + (var(--depth) - 1) * 20px + 6px);
      top: -1px; height: 50%; width: 10px;
      border-left: 1px solid var(--border-strong); border-bottom: 1px solid var(--border-strong);
      border-bottom-left-radius: 5px;
    }
    .pcx-row__code {
      flex-shrink: 0; font-family: ui-monospace, 'Courier New', monospace; font-size: .7rem; font-weight: 600;
      color: var(--text-sub); background: var(--card); padding: 2px 6px; border-radius: 6px; font-variant-numeric: tabular-nums;
    }
    .pcx-row__name { flex: 1; min-width: 0; font-size: .86rem; color: var(--text-main); line-height: 1.3;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* La voce nuova: tinta accento, codice pieno, badge "nuovo". */
    .pcx-row--new {
      background: color-mix(in srgb, var(--accent) 16%, var(--card));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent);
      animation: pcx-pop var(--t-base) var(--ease);
    }
    .pcx-row--new .pcx-row__code { color: var(--on-accent); background: var(--accent); }
    .pcx-row--new .pcx-row__name { font-weight: 700; }
    .pcx-row__badge {
      flex-shrink: 0; font-size: .62rem; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
      color: var(--on-accent); background: var(--accent); padding: 2px 6px; border-radius: 999px;
    }
    @keyframes pcx-pop { from { transform: translateY(-2px); opacity: 0; } to { transform: none; opacity: 1; } }

    @media (max-width: 720px) {
      .pcx { grid-template-columns: 1fr; gap: 16px; }
      .pcx__preview { position: static; max-height: 40vh; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pcx-chip { transition: none; }
      .pcx-row--new { animation: none; }
    }
  `],
})
export class PianoContiFormDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<PianoContiFormDialogComponent>);
  private readonly data: PianoContiFormData = inject(MAT_DIALOG_DATA);
  private readonly service = inject(PianoContiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  readonly tipi = TIPI_COGE;
  readonly isEdit = !!this.data.conto;
  readonly saving = signal(false);
  readonly errore = signal<string | null>(null);
  readonly codiceEditabile = signal(false);

  readonly form = new FormGroup({
    descrizione: new FormControl(this.data.conto?.nome ?? '', { nonNullable: true, validators: [Validators.required, Validators.maxLength(255)] }),
    // Nullable: in creazione parte "vuoto" (nessuna natura scelta) per un percorso davvero guidato.
    tipo: new FormControl<TipoCoge | null>(this.data.conto?.tipo ?? this.data.presetTipo ?? null, { validators: [Validators.required] }),
    parentId: new FormControl<number | null>(this.data.conto?.parentId ?? null),
    // In creazione il codice è calcolato (nessun validator): in modifica resta obbligatorio ed editabile.
    codice: new FormControl(this.data.conto?.codice ?? '', {
      nonNullable: true,
      validators: this.isEdit ? [Validators.required, Validators.maxLength(20)] : [],
    }),
  });

  // Reattività via toSignal(valueChanges), NON computed su FormControl.value (trappola OnPush del progetto).
  readonly tipoSig = toSignal(this.form.controls.tipo.valueChanges, { initialValue: this.form.controls.tipo.value });
  private readonly parentIdSig = toSignal(this.form.controls.parentId.valueChanges, { initialValue: this.form.controls.parentId.value });
  private readonly nomeSig = toSignal(this.form.controls.descrizione.valueChanges, { initialValue: this.form.controls.descrizione.value });
  // Se il server rifiuta con CODICE_DUPLICATO (lista client stale), avanzo di 1 il progressivo.
  private readonly bump = signal(0);

  readonly tipoMetaCorrente = computed(() => this.tipi.find(t => t.value === this.tipoSig()));

  // Il codice dipende dal ramo scelto (padre), non dalla natura. Convenienza client; la UNIQUE server è la guardia.
  readonly codiceGenerato = computed(() => this.generaCodice(this.parentIdSig(), this.bump()));

  // Opzioni "conto padre" filtrate sulla natura scelta e ordinate ad albero (label in primo piano).
  readonly parentOptions = computed(() => {
    const tipo = this.tipoSig();
    if (!tipo && !this.isEdit) return [];
    const self = this.data.conto;
    // In modifica escludo sé stesso E i discendenti (codice con prefisso self.codice + '.'): sarebbero
    // la porta d'ingresso a una gerarchia ciclica (il server la rifiuta, ma non gliela offro nemmeno).
    return this.data.conti
      .filter(c => c.id !== self?.id
        && (this.isEdit || c.tipo === tipo)
        && !(this.isEdit && self != null && c.codice.startsWith(self.codice + '.')))
      .slice()
      .sort((a, b) => (a.codice < b.codice ? -1 : a.codice > b.codice ? 1 : 0))
      // nbsp: gli spazi normali collassano dentro <mat-option>, il rientro ad albero sparirebbe.
      .map(c => ({ ...c, indent: '\u00A0\u00A0'.repeat(Math.max(0, c.livello - 1)) }));
  });

  // Anteprima "to-be": ramo/insieme selezionato + la voce nuova nel punto giusto, evidenziata.
  readonly previewRows = computed<PreviewRow[]>(() => {
    const tipo = this.tipoSig();
    if (!tipo) return [];
    const conti = this.data.conti;
    const parentId = this.parentIdSig();
    const nuovoNome = (this.nomeSig() ?? '').trim() || 'Nuovo conto';
    const nuovoCodice = this.codiceGenerato();

    let branch: { codice: string; nome: string }[];
    if (parentId != null) {
      const parent = conti.find(c => c.id === parentId);
      if (!parent) {
        branch = [];
      } else {
        const chain: PianoContiCogeDTO[] = [];
        let cur: PianoContiCogeDTO | undefined = parent;
        while (cur) {
          chain.unshift(cur);
          cur = cur.parentId != null ? conti.find(c => c.id === cur!.parentId) : undefined;
        }
        const figli = conti.filter(c => c.parentId === parentId);
        branch = [...chain, ...figli].map(c => ({ codice: c.codice, nome: c.nome }));
      }
    } else {
      branch = conti.filter(c => c.tipo === tipo && c.parentId == null).map(c => ({ codice: c.codice, nome: c.nome }));
    }

    const all = [...branch.map(r => ({ ...r, isNew: false })), { codice: nuovoCodice, nome: nuovoNome, isNew: true }];
    all.sort((a, b) => (a.codice < b.codice ? -1 : a.codice > b.codice ? 1 : 0));
    const base = Math.min(...all.map(r => r.codice.split('.').length));
    return all.map(r => ({ codice: r.codice, nome: r.nome, isNew: r.isNew, depth: r.codice.split('.').length - base }));
  });

  constructor() {
    // Dialog largo su desktop per i due pannelli; il maxWidth (80vw di default) lo cappa su schermi stretti.
    if (!this.isEdit) this.dialogRef.updateSize('880px');
    // In creazione il padre è disabilitato finché non c'è una natura: [disabled] via template non regge
    // sui Reactive Forms (viene ignorato + warning in console), lo stato va guidato dal control stesso.
    if (!this.isEdit && !this.form.controls.tipo.value) {
      this.form.controls.parentId.disable({ emitEvent: false });
    }
    const parent = this.form.controls.parentId;
    this.form.controls.tipo.valueChanges.pipe(takeUntilDestroyed()).subscribe((tipo) => {
      if (!this.isEdit) tipo ? parent.enable({ emitEvent: false }) : parent.disable({ emitEvent: false });
      // Cambiando natura il padre precedente appartiene a un altro insieme: azzerarlo tiene coerente l'anteprima.
      if (parent.value != null) parent.setValue(null);
      this.bump.set(0); // nuova natura ⇒ ramo diverso: il progressivo avanzato dal 409 non vale più
    });
    // Cambiando ramo (padre) il progressivo bumpato dal 409 resterebbe sfalsato di +1: azzeralo.
    parent.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.bump.set(0));
  }

  scegliTipo(value: TipoCoge): void {
    this.form.controls.tipo.setValue(value);
    this.form.controls.tipo.markAsTouched();
  }

  /**
   * Prossimo codice libero nel ramo scelto. Con padre: parent.codice + progressivo (larghezza segmento
   * ereditata dai fratelli, 2 cifre al livello 2, 3 dal livello 3). Senza padre: prossima radice a 2 cifre.
   */
  private generaCodice(parentId: number | null, bump: number): string {
    const conti = this.data.conti;
    if (parentId != null) {
      const parent = conti.find(c => c.id === parentId);
      if (!parent) return '';
      const figli = conti.filter(c => c.parentId === parentId);
      const width = figli.length
        ? (figli[0].codice.split('.').pop()?.length ?? 3)
        : (parent.livello + 1 <= 2 ? 2 : 3);
      const max = figli.reduce((m, c) => {
        const seg = parseInt(c.codice.split('.').pop() ?? '', 10);
        return Number.isNaN(seg) ? m : Math.max(m, seg);
      }, 0);
      return parent.codice + '.' + String(max + 1 + bump).padStart(width, '0');
    }
    const roots = conti.filter(c => c.parentId == null);
    const max = roots.reduce((m, c) => {
      const n = parseInt(c.codice, 10);
      return Number.isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return String(max + 1 + bump);
  }

  close(): void {
    this.dialogRef.close(false);
  }

  elimina(): void {
    const conto = this.data.conto!;
    this.dialog
      .open(ConfirmDialogComponent, {
        data: {
          title: 'Elimina conto',
          message: `Eliminare il conto ${conto.codice} · ${conto.nome}? Non comparirà più nei selettori. ` +
            `Lo storico dei movimenti resta invariato.`,
          confirmLabel: 'Elimina',
          danger: true,
        },
      })
      .afterClosed()
      .pipe(switchMap((ok) => {
        if (!ok) throw new Error('cancelled');
        this.saving.set(true);
        this.errore.set(null);
        return this.service.delete(conto.id);
      }))
      .subscribe({
        next: () => {
          this.snackBar.open('Conto eliminato', 'OK', { duration: 2500 });
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.saving.set(false);
          if (err?.message === 'cancelled') return;
          this.errore.set(err?.error?.message ?? 'Eliminazione non riuscita.');
        },
      });
  }

  salva(): void {
    if (this.form.invalid) return;
    const codice = (this.isEdit ? this.form.controls.codice.value : this.codiceGenerato()).trim();
    if (!codice) {
      this.errore.set('Non riesco a generare un codice: scegli un gruppo padre valido.');
      return;
    }
    this.saving.set(true);
    this.errore.set(null);
    const req: PianoContiCogeUpsertRequest = {
      codice,
      descrizione: this.form.controls.descrizione.value.trim(),
      tipo: this.form.controls.tipo.value as TipoCoge, // form valido ⇒ natura scelta
      parentId: this.form.controls.parentId.value,
    };
    const call$ = this.isEdit
      ? this.service.update(this.data.conto!.id, req)
      : this.service.create(req);

    call$.subscribe({
      next: () => {
        this.snackBar.open(this.isEdit ? 'Conto aggiornato' : 'Conto creato', 'OK', { duration: 2500 });
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.saving.set(false);
        // Collisione sul codice generato (lista client non aggiornata): avanzo il progressivo e invito a ritentare.
        if (!this.isEdit && err?.error?.code === 'CODICE_DUPLICATO') {
          this.bump.update(b => b + 1);
          this.errore.set(`Il codice era già in uso: ne ho preparato uno nuovo (${this.codiceGenerato()}). Premi di nuovo Crea.`);
          return;
        }
        this.errore.set(err?.error?.message ?? 'Errore nel salvataggio. Riprova.');
      },
    });
  }
}
