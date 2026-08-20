import { Component, EventEmitter, Input, Output, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { LookupService } from '../../../core/services/lookup.service';
import { PianoContiCogeDTO } from '../../../core/models/anagrafica.models';
import { CogePickerDialogComponent, CogePickerData } from './coge-picker-dialog.component';

const RECENTS_KEY = 'agos_coge_recents';
const TIPO_COLOR: Record<string, string> = {
  RICAVO: '#1F5C43', COSTO: '#B23B2E', ATTIVITA: '#2C6E8F',
  PASSIVITA: '#92400E', ONERE_FINANZIARIO: '#7C3AED', IMPOSTA: '#6B7280',
};

/**
 * Campo-trigger riusabile per la scelta del Conto COGE: mostra il conto selezionato e apre il
 * dialog a due pannelli ({@link CogePickerDialogComponent}). Emette il conto scelto (o null per
 * "rimuovi"); è il form chiamante a scrivere l'id nel proprio control, nel proprio tipo
 * (string/number) → nessun cambiamento del contratto dati esistente.
 */
@Component({
  selector: 'app-coge-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <button type="button" class="cpk" [class.cpk--invalid]="invalid" [class.cpk--empty]="!selezionato()"
            [disabled]="disabled" (click)="apri()">
      <span class="cpk__lead" [style.background]="selezionato() ? color(selezionato()!.tipo) : 'var(--text-sub)'"></span>
      <span class="cpk__body">
        <span class="cpk__label">{{ label }}{{ required ? ' *' : '' }}</span>
        @if (selezionato(); as c) {
          <span class="cpk__value"><b>{{ c.nome }}</b><span class="cpk__code">{{ c.codice }}</span></span>
        } @else {
          <span class="cpk__placeholder">Scegli un conto…</span>
        }
      </span>
      <mat-icon class="cpk__chev">unfold_more</mat-icon>
    </button>
  `,
  styles: [`
    :host { display: block; }
    .cpk { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; min-height: 56px;
      border: 1px solid var(--border); border-radius: 12px; background: var(--card); cursor: pointer;
      text-align: left; font: inherit; transition: border-color .15s, background .15s; }
    .cpk:hover:not(:disabled) { border-color: color-mix(in srgb, var(--primary) 45%, var(--border)); }
    .cpk:disabled { opacity: .6; cursor: default; }
    .cpk--invalid { border-color: #d14b3e; }
    .cpk__lead { width: 4px; align-self: stretch; border-radius: 4px; flex-shrink: 0; opacity: .85; }
    .cpk--empty .cpk__lead { opacity: .3; }
    .cpk__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .cpk__label { font-size: .72rem; color: var(--text-sub); }
    .cpk--invalid .cpk__label { color: #d14b3e; }
    .cpk__value { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .cpk__value b { font-size: .92rem; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cpk__placeholder { font-size: .92rem; color: var(--text-sub); }
    .cpk__code { font-family: ui-monospace, 'Courier New', monospace; font-size: .72rem; color: var(--text-sub);
      background: var(--surface); padding: 1px 6px; border-radius: 6px; flex-shrink: 0; }
    .cpk__chev { color: var(--text-sub); flex-shrink: 0; }
  `],
})
export class CogePickerComponent implements OnInit {
  @Input() tipoFilter?: string[];
  @Input() allowedIds?: number[];
  @Input() label = 'Conto COGE';
  @Input() required = false;
  @Input() invalid = false;
  @Input() disabled = false;
  @Input() set value(v: number | string | null | undefined) {
    this._valueId = v == null || v === '' ? null : Number(v);
    this.sync();
  }

  @Output() readonly cogeChange = new EventEmitter<PianoContiCogeDTO | null>();

  private readonly lookup = inject(LookupService);
  private readonly dialog = inject(MatDialog);

  private conti: PianoContiCogeDTO[] = [];
  private _valueId: number | null = null;
  readonly selezionato = signal<PianoContiCogeDTO | undefined>(undefined);

  ngOnInit(): void {
    this.lookup.getPianoConti().subscribe(conti => { this.conti = conti; this.sync(); });
  }

  private sync(): void {
    this.selezionato.set(this._valueId == null ? undefined : this.conti.find(c => c.id === this._valueId));
  }

  color(tipo: string): string { return TIPO_COLOR[tipo] ?? '#6B7280'; }

  apri(): void {
    if (this.disabled || !this.conti.length) return;
    const data: CogePickerData = {
      conti: this.conti,
      tipoFilter: this.tipoFilter,
      allowedIds: this.allowedIds,
      selectedId: this._valueId,
      title: this.label,
      recents: this.loadRecents(),
    };
    this.dialog
      .open(CogePickerDialogComponent, { data, autoFocus: false, panelClass: 'coge-picker-panel' })
      .afterClosed()
      .subscribe((res: PianoContiCogeDTO | null | undefined) => {
        if (res === undefined) return;              // annullato → nessun cambiamento
        if (res === null) { this.cogeChange.emit(null); return; }  // rimuovi
        // Il conto può essere appena stato creato dentro il dialog: senza aggiungerlo qui, sync()
        // non lo troverebbe nella lista caricata all'init e il campo resterebbe sul placeholder.
        if (!this.conti.some(c => c.id === res.id)) this.conti = [...this.conti, res];
        this.pushRecent(res.id);
        this.cogeChange.emit(res);
      });
  }

  private loadRecents(): number[] {
    try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch { return []; }
  }
  private pushRecent(id: number): void {
    const next = [id, ...this.loadRecents().filter(x => x !== id)].slice(0, 8);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }
}
