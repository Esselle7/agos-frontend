import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
} from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { DateMaskDirective } from '../../directives/date-mask.directive';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DashboardPeriod } from '../../../core/models/dashboard.models';

export interface PeriodChangeEvent {
  period: DashboardPeriod;
  from?: string;
  to?: string;
}

@Component({
  selector: 'agos-date-range-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    DateMaskDirective,
    MatTooltipModule,
  ],
  templateUrl: './date-range-picker.component.html',
  styleUrls: ['./date-range-picker.component.scss'],
})
export class DateRangePickerComponent implements OnInit {
  @Input() period: DashboardPeriod = 'MTD';
  @Input() from?: string;
  @Input() to?: string;
  /**
   * Il consumatore aggrega per MESE INTERO (conto economico, Fase 5 / decisione C): l'intervallo
   * mostrato sui bottoni finisce a fine mese, non "a oggi", altrimenti l'etichetta prometterebbe
   * una precisione al giorno che il dato non ha. Default false: la dashboard filtra per giorno
   * esatto e la sua etichetta resta com'e'.
   */
  @Input() mensile = false;
  @Output() periodChange = new EventEmitter<PeriodChangeEvent>();

  private readonly cdr = inject(ChangeDetectorRef);

  private static readonly MESI = [
    'gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic',
  ];

  readonly stdPeriods: Array<{
    value: Exclude<DashboardPeriod, 'CUSTOM'>;
    label: string;
    description: string;
  }> = [
    { value: 'MTD', label: 'MTD', description: 'Mese corrente'     },
    { value: 'QTD', label: 'QTD', description: 'Trimestre'         },
    { value: 'YTD', label: 'YTD', description: "Quest'anno"        },
  ];

  readonly today = new Date();

  readonly fromCtrl = new FormControl<Date | null>(null);
  readonly toCtrl   = new FormControl<Date | null>(null);
  readonly customForm = new FormGroup({ from: this.fromCtrl, to: this.toCtrl });

  ngOnInit(): void {
    if (this.from) this.fromCtrl.setValue(new Date(this.from));
    if (this.to)   this.toCtrl.setValue(new Date(this.to));
  }

  getDateRange(p: Exclude<DashboardPeriod, 'CUSTOM'>): string {
    const t = this.today;
    const fine = this.fmt(this.fineIntervallo(t));
    switch (p) {
      case 'MTD': {
        const d = new Date(t.getFullYear(), t.getMonth(), 1);
        return `${this.fmt(d)} – ${fine}`;
      }
      case 'QTD': {
        const m = Math.floor(t.getMonth() / 3) * 3;
        const d = new Date(t.getFullYear(), m, 1);
        return `${this.fmt(d)} – ${fine}`;
      }
      case 'YTD': {
        const d = new Date(t.getFullYear(), 0, 1);
        return `${this.fmt(d)} – ${fine}`;
      }
    }
  }

  get customRangeLabel(): string {
    const from = this.fromCtrl.value;
    const to   = this.toCtrl.value;
    if (from && to) {
      const a = this.mensile ? new Date(from.getFullYear(), from.getMonth(), 1) : from;
      return `${this.fmt(a)} – ${this.fmt(this.fineIntervallo(to))}`;
    }
    if (from)       return `Dal ${this.fmt(from)}…`;
    return 'Scegli periodo';
  }

  /** Fine dell'intervallo mostrata all'utente: fine mese se `mensile`, altrimenti la data stessa. */
  private fineIntervallo(d: Date): Date {
    return this.mensile ? new Date(d.getFullYear(), d.getMonth() + 1, 0) : d;
  }

  get endMinDate(): Date | null {
    return this.fromCtrl.value;
  }

  onStdPeriodClick(p: Exclude<DashboardPeriod, 'CUSTOM'>): void {
    this.period = p;
    this.periodChange.emit({ period: p });
  }

  onCustomClick(): void {
    this.period = 'CUSTOM';
    this.tryEmitCustom();
  }

  onFromChange(): void {
    // Re-check to validity after start changes
    this.toCtrl.updateValueAndValidity();
    this.cdr.markForCheck();
    if (this.period === 'CUSTOM') this.tryEmitCustom();
  }

  onToChange(): void {
    this.cdr.markForCheck();
    if (this.period === 'CUSTOM') this.tryEmitCustom();
  }

  private tryEmitCustom(): void {
    const from = this.fromCtrl.value;
    const to   = this.toCtrl.value;
    if (from && to && from <= to) {
      this.periodChange.emit({
        period: 'CUSTOM',
        from: this.toIso(from),
        to:   this.toIso(to),
      });
    }
  }

  private fmt(d: Date): string {
    return `${d.getDate()} ${DateRangePickerComponent.MESI[d.getMonth()]}`;
  }

  private toIso(d: Date): string {
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
}
