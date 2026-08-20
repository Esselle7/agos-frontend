import { ChangeDetectionStrategy, Component, OnInit, inject, signal, computed } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MovimentiService, QuotaDivisione } from '../../core/services/movimenti.service';
import { BuService } from '../../core/services/bu.service';
import { MovimentoDTO } from '../../core/models/movimenti.models';
import { BusinessUnitDTO } from '../../core/models/anagrafica.models';
import { EuroPipe } from '../../shared/pipes/euro.pipe';
import { CogePickerComponent } from '../../shared/components/coge-picker/coge-picker.component';

export interface DividiMovimentoData { movimento: MovimentoDTO; }

interface RigaQuota {
  importo: number | null;
  contoCogeId: number | null;
  businessUnitId: number | null;
  descrizione: string;
}

/**
 * Importi in forma «E. 1.098,00» dentro la causale di una RiBa cumulativa.
 * Il formato è stretto di proposito (`\d{1,3}(.\d{3})*,\d{2}`): senza, un «E. SRL» o un
 * «RIF. E. 2026» diventerebbe una quota. Esportata per il test.
 */
export function importiInCausale(descrizione: string | null | undefined): number[] {
  if (!descrizione) return [];
  const out: number[] = [];
  const re = /\bE\.\s*(\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(descrizione)) !== null) {
    out.push(Number(m[1].replace(/\./g, '').replace(',', '.')));
  }
  return out;
}

/** Confronto in centesimi: 0.1 + 0.2 in virgola mobile non fa 0.3, e qui si parla di euro veri. */
const cent = (n: number) => Math.round(n * 100);

@Component({
  selector: 'app-dividi-movimento-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatTooltipModule, EuroPipe, CogePickerComponent,
  ],
  template: `
    <h2 mat-dialog-title>Dividi movimento</h2>

    <mat-dialog-content class="dvd">
      <p class="dvd__testata">
        <span>{{ data.movimento.descrizione }}</span>
        <b class="euro">{{ data.movimento.importo | euro }}</b>
      </p>

      @if (messaggioCausale(); as msg) {
        <p class="dvd__causale" [class.dvd__causale--ko]="!precompilato()">
          <mat-icon>{{ precompilato() ? 'auto_awesome' : 'info_outline' }}</mat-icon> {{ msg }}
        </p>
      }

      @for (r of righe(); track $index) {
        <div class="dvd__riga">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="dvd__importo">
            <mat-label>Importo</mat-label>
            <input matInput type="number" step="0.01" [value]="r.importo"
                   (input)="setImporto($index, $any($event.target).value)">
          </mat-form-field>

          <app-coge-picker class="dvd__coge" label="Conto" [required]="true"
                           [value]="r.contoCogeId"
                           (cogeChange)="setCoge($index, $event?.id ?? null)" />

          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="dvd__bu">
            <mat-label>Business unit</mat-label>
            <mat-select [value]="r.businessUnitId" (valueChange)="setBu($index, $event)">
              @for (b of bus(); track b.id) { <mat-option [value]="b.id">{{ b.nome }}</mat-option> }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="dvd__descr">
            <mat-label>Descrizione</mat-label>
            <input matInput [value]="r.descrizione"
                   (input)="setDescrizione($index, $any($event.target).value)"
                   placeholder="facoltativa">
          </mat-form-field>

          <button mat-icon-button [disabled]="righe().length <= 2" (click)="rimuovi($index)"
                  matTooltip="Togli questa quota">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      }

      <button mat-stroked-button class="dvd__add" (click)="aggiungi()">
        <mat-icon>add</mat-icon> Aggiungi quota
      </button>

      <p class="dvd__totale" [class.dvd__totale--ko]="!quadra()">
        <span>Totale quote <b class="euro">{{ totale() | euro }}</b></span>
        @if (quadra()) {
          <span class="dvd__ok"><mat-icon>check_circle</mat-icon> quadra al centesimo</span>
        } @else {
          <span>{{ residuo() > 0 ? 'Mancano' : 'Eccedono' }}
            <b class="euro">{{ (residuo() < 0 ? -residuo() : residuo()) | euro }}</b></span>
        }
      </p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="chiudi()">Annulla</button>
      <button mat-flat-button color="primary" [disabled]="!valido() || salvando()" (click)="dividi()">
        {{ salvando() ? 'Divido…' : 'Dividi in ' + righe().length + ' movimenti' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dvd { display: flex; flex-direction: column; gap: 12px; min-width: min(880px, 86vw); padding-top: 8px; }
    .dvd__testata { display: flex; justify-content: space-between; gap: 16px; margin: 0;
      color: var(--text-sub); font-size: .9rem; }
    .dvd__testata b { color: var(--text-main); font-size: 1.05rem; }
    .dvd__causale { display: flex; align-items: center; gap: 8px; margin: 0; font-size: .85rem;
      color: var(--text-sub); background: var(--surface); border-radius: 10px; padding: 8px 12px; }
    .dvd__causale mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .dvd__causale--ko { color: var(--warning); }
    .dvd__riga { display: grid; grid-template-columns: 130px 1.2fr 150px 1.4fr 40px; gap: 8px; align-items: center; }
    .dvd__add { align-self: flex-start; }
    .dvd__totale { display: flex; justify-content: space-between; align-items: center; margin: 0;
      padding: 10px 12px; border-radius: 10px; background: var(--surface); font-size: .92rem; }
    .dvd__totale--ko { color: var(--warning); }
    .dvd__ok { display: flex; align-items: center; gap: 6px; color: var(--success, #1F5C43); }
    .dvd__ok mat-icon { font-size: 18px; width: 18px; height: 18px; }
    @media (max-width: 700px) {
      .dvd { min-width: 0; }
      .dvd__riga { grid-template-columns: 1fr 1fr; }
    }
  `],
})
export class DividiMovimentoDialogComponent implements OnInit {
  readonly data: DividiMovimentoData = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<DividiMovimentoDialogComponent>);
  private readonly movimentiService = inject(MovimentiService);
  private readonly buService = inject(BuService);
  private readonly snackBar = inject(MatSnackBar);

  readonly bus = signal<BusinessUnitDTO[]>([]);
  readonly righe = signal<RigaQuota[]>([]);
  readonly salvando = signal(false);
  readonly precompilato = signal(false);
  readonly messaggioCausale = signal<string | null>(null);

  readonly totale = computed(() =>
    this.righe().reduce((s, r) => s + cent(r.importo ?? 0), 0) / 100);

  readonly residuo = computed(() => this.data.movimento.importo - this.totale());

  readonly quadra = computed(() => cent(this.residuo()) === 0);

  readonly valido = computed(() =>
    this.quadra()
    && this.righe().length >= 2
    && this.righe().every(r => (r.importo ?? 0) > 0 && r.contoCogeId != null && r.businessUnitId != null));

  ngOnInit(): void {
    this.buService.getAll().subscribe(v => this.bus.set(v));
    this.precompila();
  }

  /**
   * R2 — il dettaglio in causale si accetta SOLO se la somma fa esattamente l'importo: una
   * proposta che non quadra non è una scorciatoia, è un errore già scritto nei campi. Lo scarto
   * si mostra e si riparte a mano.
   */
  private precompila(): void {
    const m = this.data.movimento;
    const importi = importiInCausale(m.descrizione);
    const base: RigaQuota = {
      importo: null, contoCogeId: m.contoCoge ?? null,
      businessUnitId: m.businessUnitId ?? null, descrizione: '',
    };

    if (importi.length >= 2) {
      const somma = importi.reduce((s, n) => s + cent(n), 0);
      if (somma === cent(m.importo)) {
        this.precompilato.set(true);
        this.messaggioCausale.set(
          `Trovati ${importi.length} importi nella causale: la somma quadra con l'importo del movimento.`);
        this.righe.set(importi.map(i => ({ ...base, importo: i })));
        return;
      }
      const scarto = Math.abs(somma - cent(m.importo)) / 100;
      this.messaggioCausale.set(
        `Nella causale ci sono ${importi.length} importi, ma sommano ${(somma / 100).toFixed(2)} €: `
        + `${scarto.toFixed(2)} € di scarto sull'importo del movimento. Si parte a mano.`);
    }
    this.righe.set([{ ...base }, { ...base }]);
  }

  setImporto(i: number, raw: string): void {
    const n = raw.trim() === '' ? null : Number(raw.replace(',', '.'));
    this.aggiorna(i, { importo: n != null && Number.isFinite(n) ? n : null });
  }
  setCoge(i: number, id: number | null): void { this.aggiorna(i, { contoCogeId: id }); }
  setBu(i: number, id: number): void { this.aggiorna(i, { businessUnitId: id }); }
  setDescrizione(i: number, v: string): void { this.aggiorna(i, { descrizione: v }); }

  private aggiorna(i: number, patch: Partial<RigaQuota>): void {
    this.righe.update(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  aggiungi(): void {
    const m = this.data.movimento;
    this.righe.update(rs => [...rs, {
      importo: null, contoCogeId: m.contoCoge ?? null,
      businessUnitId: m.businessUnitId ?? null, descrizione: '',
    }]);
  }

  rimuovi(i: number): void {
    this.righe.update(rs => rs.filter((_, idx) => idx !== i));
  }

  dividi(): void {
    if (!this.valido()) return;
    this.salvando.set(true);
    const quote: QuotaDivisione[] = this.righe().map(r => ({
      importo: r.importo!,
      contoCogeId: r.contoCogeId!,
      businessUnitId: r.businessUnitId!,
      descrizione: r.descrizione?.trim() || null,
    }));
    this.movimentiService.dividi(this.data.movimento.id, quote).subscribe({
      next: figli => {
        this.snackBar.open(`Movimento diviso in ${figli.length} quote`, 'OK', { duration: 3000 });
        this.dialogRef.close(figli);
      },
      error: err => {
        this.salvando.set(false);
        // Il messaggio del server è scritto per essere letto (scarto in euro, motivo del rifiuto).
        this.snackBar.open(err?.error?.message ?? 'Divisione non riuscita', 'OK', { duration: 8000 });
      },
    });
  }

  chiudi(): void { this.dialogRef.close(); }
}
