import { Component, OnInit, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { InputFilterDirective } from '../../shared/directives/input-filter.directive';
import { AppValidators } from '../../shared/validators/app-validators';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SpeseRicorrentiService } from '../../core/services/spese-ricorrenti.service';
import { CogeOption, TipoPiano } from './spese-ricorrenti.models';
import { ContoBancarioDTO, PianoContiCogeDTO } from '../../core/models/anagrafica.models';
import { CogePickerComponent } from '../../shared/components/coge-picker/coge-picker.component';

export interface RataPreview {
  numero: number;
  data: Date;
  importo: number;
  quotaCapitale: number | null;
  quotaInteressi: number | null;
  debitoResiduo: number | null;
  pctInteressi: number | null;
}

export interface PianoStats {
  primaRata: Date;
  ultimaRata: Date;
  totaleImporti: number;
  totaleInteressi: number | null;
  totaleCapitale: number | null;
  costoPct: number | null;
}

export interface FinComputato {
  /** valore derivato dalla formula */
  valore: number;
  /** tasso periodo (per mostrare la prima split) */
  primaInteresse: number;
  primaCapitale: number;
  /** durata in testo leggibile (solo mode=DURATA) */
  durataLabel: string | null;
  /** stima data estinzione */
  dataEstinzione: Date | null;
}

@Component({
  selector: 'app-spese-ricorrenti-create-dialog',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatProgressSpinnerModule, MatTooltipModule,
    InputFilterDirective,
    CogePickerComponent,
  ],
  templateUrl: './spese-ricorrenti-create-dialog.component.html',
  styleUrls: ['./spese-ricorrenti-create-dialog.component.scss'],
})
export class SpeseRicorrentiCreateDialogComponent implements OnInit {
  private readonly service    = inject(SpeseRicorrentiService);
  private readonly fb         = inject(FormBuilder);
  private readonly dialogRef  = inject(MatDialogRef<SpeseRicorrentiCreateDialogComponent>);
  private readonly destroyRef = inject(DestroyRef);

  readonly contiCoge          = signal<CogeOption[]>([]);
  readonly contiCogeInteressi = signal<CogeOption[]>([]);
  // Id ammessi per il picker: stesso identico subset curato dal server (nessuna voce in più).
  readonly cogeIds          = computed(() => this.contiCoge().map(c => c.id));
  readonly cogeInteressiIds = computed(() => this.contiCogeInteressi().map(c => c.id));
  readonly contiBancari       = signal<ContoBancarioDTO[]>([]);
  readonly saving             = signal(false);
  readonly loadingLookup      = signal(true);
  readonly step               = signal<1 | 2>(1);
  readonly showAllRates       = signal(false);
  readonly step1Error         = signal<string | null>(null);

  // FIX BUG: tipoPianoSig aggiornato via valueChanges (computed() non traccia RxJS)
  readonly tipoPianoSig    = signal<TipoPiano>('FLAT');
  readonly isFinanziamento = computed(() => this.tipoPianoSig() === 'FINANZIAMENTO');

  // Modalità calcolo FINANZIAMENTO: RATA = "ho n_rate, dimmi PMT" | DURATA = "ho PMT, dimmi n"
  readonly finCalcolaMode = signal<'RATA' | 'DURATA'>('RATA');

  // Valori derivati aggiornati via subscription (signals, quindi reattivi nel template)
  readonly computedFin = signal<FinComputato | null>(null);

  readonly ratePreview  = signal<RataPreview[]>([]);

  readonly pianoStats = computed<PianoStats | null>(() => {
    const rate = this.ratePreview();
    if (rate.length === 0) return null;
    const nonZero         = rate.filter(r => r.importo > 0);
    const totaleImporti   = nonZero.reduce((s, r) => s + r.importo, 0);
    const totaleInteressi = rate[0].quotaInteressi !== null
      ? rate.reduce((s, r) => s + (r.quotaInteressi ?? 0), 0) : null;
    const totaleCapitale  = rate[0].quotaCapitale  !== null
      ? rate.reduce((s, r) => s + (r.quotaCapitale  ?? 0), 0) : null;
    return {
      primaRata:      rate[0].data,
      ultimaRata:     nonZero[nonZero.length - 1]?.data ?? rate[rate.length - 1].data,
      totaleImporti,
      totaleInteressi,
      totaleCapitale,
      costoPct: totaleInteressi != null && totaleCapitale != null && totaleCapitale > 0
        ? (totaleInteressi / totaleCapitale * 100) : null,
    };
  });

  readonly visibleRates = computed(() => {
    const rate = this.ratePreview();
    if (this.showAllRates() || rate.length <= 24) return rate;
    return rate.slice(0, 12);
  });

  readonly hasMoreRates = computed(() =>
    !this.showAllRates() && this.ratePreview().length > 24
  );

  form!: FormGroup;

  readonly mesi = [
    { v: '01', l: 'Gennaio'   }, { v: '02', l: 'Febbraio'  },
    { v: '03', l: 'Marzo'     }, { v: '04', l: 'Aprile'    },
    { v: '05', l: 'Maggio'    }, { v: '06', l: 'Giugno'    },
    { v: '07', l: 'Luglio'    }, { v: '08', l: 'Agosto'    },
    { v: '09', l: 'Settembre' }, { v: '10', l: 'Ottobre'   },
    { v: '11', l: 'Novembre'  }, { v: '12', l: 'Dicembre'  },
  ];

  readonly anni: number[] = (() => {
    const y = new Date().getFullYear();
    return [y - 1, y, y + 1, y + 2, y + 3];
  })();

  readonly frequenzaOptions = [
    { value: 'MENSILE',     label: 'Mensile',     sub: 'ogni mese'   },
    { value: 'BIMESTRALE',  label: 'Bimestrale',  sub: 'ogni 2 mesi' },
    { value: 'TRIMESTRALE', label: 'Trimestrale', sub: 'ogni 3 mesi' },
    { value: 'ANNUALE',     label: 'Annuale',     sub: 'ogni 12 mesi' },
  ];

  /** Scelta COGE dal picker → scrive l'id nel control (identico al vecchio select). */
  setContoCoge(conto: PianoContiCogeDTO | null): void {
    const c = this.form.get('contoCoge')!;
    c.setValue(conto?.id ?? null); c.markAsTouched();
  }
  setCogeInteressi(conto: PianoContiCogeDTO | null): void {
    const c = this.form.get('contoCogeInteressiId')!;
    c.setValue(conto?.id ?? null); c.markAsTouched();
  }

  ngOnInit(): void {
    const now         = new Date();
    const nextMonth   = now.getMonth() + 1;
    const meseDefault = String((nextMonth % 12) + 1).padStart(2, '0');
    const annoDefault = nextMonth >= 12 ? now.getFullYear() + 1 : now.getFullYear();

    this.form = this.fb.group({
      descrizione:           ['', [Validators.required, Validators.maxLength(255), AppValidators.safeText()]],
      contoBancarioId:       [null, Validators.required],
      contoCoge:             [null, Validators.required],
      tipoPiano:             ['FLAT', Validators.required],
      // Importo rata: input per FLAT e DURATA mode, derivato per RATA mode
      importoRata:           [null, [Validators.required, Validators.min(0.01)]],
      variazionePct:         [0, [Validators.min(-100), Validators.max(100)]],
      giornoDelMese:         [null, [Validators.required, Validators.min(1), Validators.max(28)]],
      frequenza:             ['MENSILE', Validators.required],
      // Numero rate: input per FLAT e RATA mode, derivato per DURATA mode
      numeroRate:            [null, [Validators.required, Validators.min(1)]],
      meseInizio:            [meseDefault, Validators.required],
      annoInizio:            [annoDefault, Validators.required],
      note:                  ['', [AppValidators.safeText()]],
      importoDebitoIniziale: [null],
      tassoInteresseAnnuo:   [null],
      contoCogeInteressiId:  [null],
    });

    // FIX: aggiorna tipoPianoSig via RxJS valueChanges
    this.form.get('tipoPiano')!.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((tipo: TipoPiano) => {
        this.tipoPianoSig.set(tipo);
        this.updateFinanziamentoValidators(tipo);
        this.step1Error.set(null);
        this.recalcFin();
      });

    // Ricalcola quando cambiano i valori rilevanti per il finanziamento
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.recalcFin());

    this.service.getContiCoge().subscribe({ next: d => { this.contiCoge.set(d); this.checkLoaded(); } });
    this.service.getContiCogeInteressi().subscribe({ next: d => { this.contiCogeInteressi.set(d); this.checkLoaded(); } });
    this.service.getContiBancari().subscribe({ next: d => { this.contiBancari.set(d); this.checkLoaded(); } });
  }

  private loaded = 0;
  private checkLoaded(): void { if (++this.loaded >= 3) this.loadingLookup.set(false); }

  private updateFinanziamentoValidators(tipo: TipoPiano): void {
    const debito  = this.form.get('importoDebitoIniziale')!;
    const tasso   = this.form.get('tassoInteresseAnnuo')!;
    const cogeInt = this.form.get('contoCogeInteressiId')!;
    if (tipo === 'FINANZIAMENTO') {
      debito.setValidators([Validators.required, Validators.min(0.01)]);
      tasso.setValidators([Validators.required, Validators.min(0.001)]);
      cogeInt.setValidators([Validators.required]);
      // In RATA mode, importoRata è derivato → non richiesto dall'utente
      this.updateImportoRataValidators();
    } else {
      debito.clearValidators();
      tasso.clearValidators();
      cogeInt.clearValidators();
      this.form.get('importoRata')!.setValidators([Validators.required, Validators.min(0.01)]);
      this.form.get('numeroRate')!.setValidators([Validators.required, Validators.min(1)]);
    }
    debito.updateValueAndValidity({ emitEvent: false });
    tasso.updateValueAndValidity({ emitEvent: false });
    cogeInt.updateValueAndValidity({ emitEvent: false });
  }

  private updateImportoRataValidators(): void {
    const importoCtrl  = this.form.get('importoRata')!;
    const numeroCtrl   = this.form.get('numeroRate')!;
    if (this.finCalcolaMode() === 'RATA') {
      importoCtrl.clearValidators();   // derivato dalla formula
      numeroCtrl.setValidators([Validators.required, Validators.min(1)]);
    } else {
      importoCtrl.setValidators([Validators.required, Validators.min(0.01)]);
      numeroCtrl.clearValidators();    // derivato dalla formula
    }
    importoCtrl.updateValueAndValidity({ emitEvent: false });
    numeroCtrl.updateValueAndValidity({ emitEvent: false });
  }

  setCalcolaMode(mode: 'RATA' | 'DURATA'): void {
    this.finCalcolaMode.set(mode);
    this.updateImportoRataValidators();
    this.step1Error.set(null);
    this.recalcFin();
  }

  // ── Calcolo formula ammortamento alla francese ────────────────────────────

  private recalcFin(): void {
    if (!this.isFinanziamento()) { this.computedFin.set(null); return; }
    const v = this.form.value;
    const P = Number(v.importoDebitoIniziale) || 0;
    const rAnn = Number(v.tassoInteresseAnnuo) || 0;
    const freq = v.frequenza as string || 'MENSILE';
    const mesiPerRata = freq === 'BIMESTRALE' ? 2 : freq === 'TRIMESTRALE' ? 3 : freq === 'ANNUALE' ? 12 : 1;
    const r = rAnn > 0 ? (rAnn / 100) * mesiPerRata / 12 : 0;

    if (P <= 0 || rAnn <= 0) { this.computedFin.set(null); return; }

    const annoInizio  = Number(v.annoInizio)  || new Date().getFullYear();
    const meseInizio  = Number(v.meseInizio)  || 1;
    const giorno      = Number(v.giornoDelMese) || 1;

    if (this.finCalcolaMode() === 'RATA') {
      const n = Number(v.numeroRate) || 0;
      if (n <= 0) { this.computedFin.set(null); return; }
      // PMT = P * r / (1 - (1+r)^-n)
      const pmt = r === 0 ? P / n : P * r / (1 - Math.pow(1 + r, -n));
      if (!isFinite(pmt) || pmt <= 0) { this.computedFin.set(null); return; }
      const pmtArrotondato = Math.ceil(pmt * 100) / 100;
      const primaInteresse = Math.round(P * r * 100) / 100;
      const primaCapitale  = Math.round((pmtArrotondato - primaInteresse) * 100) / 100;
      const estinzione = new Date(annoInizio, meseInizio - 1 + (n - 1) * mesiPerRata, giorno);
      this.computedFin.set({
        valore: pmtArrotondato,
        primaInteresse,
        primaCapitale,
        durataLabel: null,
        dataEstinzione: estinzione,
      });
    } else {
      // DURATA mode
      const PMT = Number(v.importoRata) || 0;
      if (PMT <= 0) { this.computedFin.set(null); return; }
      const primaInteresse = Math.round(P * r * 100) / 100;
      if (PMT <= primaInteresse) { this.computedFin.set(null); return; }
      // n = -log(1 - P*r/PMT) / log(1+r)
      const n = r === 0
        ? Math.ceil(P / PMT)
        : Math.ceil(-Math.log(1 - P * r / PMT) / Math.log(1 + r));
      if (!isFinite(n) || n <= 0) { this.computedFin.set(null); return; }
      const primaCapitale  = Math.round((PMT - primaInteresse) * 100) / 100;
      const durataLabel    = this.formatDurata(n, mesiPerRata);
      const estinzione     = new Date(annoInizio, meseInizio - 1 + (n - 1) * mesiPerRata, giorno);
      this.computedFin.set({
        valore: n,
        primaInteresse,
        primaCapitale,
        durataLabel,
        dataEstinzione: estinzione,
      });
    }
  }

  private formatDurata(nRate: number, mesiPerRata: number): string {
    const mesiTotali = nRate * mesiPerRata;
    const anni = Math.floor(mesiTotali / 12);
    const mesiRim = mesiTotali % 12;
    if (anni === 0) return `${mesiRim} ${mesiRim === 1 ? 'mese' : 'mesi'}`;
    if (mesiRim === 0) return `${anni} ${anni === 1 ? 'anno' : 'anni'}`;
    return `${anni} ${anni === 1 ? 'anno' : 'anni'} e ${mesiRim} ${mesiRim === 1 ? 'mese' : 'mesi'}`;
  }

  // ── Risolve i valori finali importoRata / numeroRate ──────────────────────

  private resolveImportoAndNRate(): { importoRata: number; numeroRate: number } | null {
    if (!this.isFinanziamento()) {
      const importoRata = Number(this.form.value.importoRata);
      const numeroRate  = Number(this.form.value.numeroRate);
      if (!importoRata || !numeroRate) return null;
      return { importoRata, numeroRate };
    }
    const fin = this.computedFin();
    if (!fin) return null;
    if (this.finCalcolaMode() === 'RATA') {
      const numeroRate = Number(this.form.value.numeroRate);
      if (!numeroRate) return null;
      return { importoRata: fin.valore, numeroRate };
    } else {
      const importoRata = Number(this.form.value.importoRata);
      if (!importoRata) return null;
      return { importoRata, numeroRate: fin.valore };
    }
  }

  // ── Navigazione step ──────────────────────────────────────────────────────

  goToStep2(): void {
    this.step1Error.set(null);

    const step1Fields = [
      'descrizione', 'contoBancarioId', 'contoCoge', 'giornoDelMese',
      'frequenza', 'meseInizio', 'annoInizio',
    ];
    if (this.isFinanziamento()) {
      step1Fields.push('importoDebitoIniziale', 'tassoInteresseAnnuo', 'contoCogeInteressiId');
      if (this.finCalcolaMode() === 'RATA') step1Fields.push('numeroRate');
      else step1Fields.push('importoRata');
    } else {
      step1Fields.push('importoRata', 'numeroRate');
    }

    step1Fields.forEach(f => this.form.get(f)?.markAsTouched());
    if (step1Fields.some(f => this.form.get(f)?.invalid)) return;

    if (this.isFinanziamento() && !this.computedFin()) {
      this.step1Error.set(
        this.finCalcolaMode() === 'RATA'
          ? 'Inserisci debito, tasso e numero di rate per calcolare la rata.'
          : 'L\'importo rata deve essere maggiore degli interessi del primo periodo.'
      );
      return;
    }

    const resolved = this.resolveImportoAndNRate();
    if (!resolved) return;

    const rate = this.buildPreview(resolved.importoRata, resolved.numeroRate);
    this.ratePreview.set(rate);
    this.showAllRates.set(false);
    this.step.set(2);
  }

  goToStep1(): void { this.step.set(1); this.step1Error.set(null); }

  // ── Calcolo preview piano (mirror del backend) ────────────────────────────

  private buildPreview(importoRata: number, numeroRate: number): RataPreview[] {
    const v = this.form.value;
    const { annoInizio, meseInizio, giornoDelMese, frequenza, variazionePct } = v;
    const mesiPerRata = frequenza === 'BIMESTRALE' ? 2 : frequenza === 'TRIMESTRALE' ? 3 : frequenza === 'ANNUALE' ? 12 : 1;
    const result: RataPreview[] = [];
    let importo = importoRata;
    let data = new Date(annoInizio, Number(meseInizio) - 1, giornoDelMese);

    if (this.isFinanziamento()) {
      const P   = Number(v.importoDebitoIniziale);
      const rAnn = Number(v.tassoInteresseAnnuo);
      const tassoPeriodo = (rAnn / 100) * mesiPerRata / 12;
      let debitoResiduo  = P;

      for (let i = 1; i <= numeroRate; i++) {
        let interessi = Math.round(debitoResiduo * tassoPeriodo * 100) / 100;
        let capitale  = Math.round((importo - interessi) * 100) / 100;

        if (i === numeroRate || debitoResiduo - capitale <= 0) {
          // Ultima rata effettiva: chiude esattamente il residuo
          capitale  = Math.round(debitoResiduo * 100) / 100;
          interessi = Math.max(0, Math.round((importo - capitale) * 100) / 100);
          // Rate successive (se il debito si chiude prima dell'ultima schedulata)
          if (i < numeroRate && debitoResiduo - Math.round((importo - Math.round(debitoResiduo * tassoPeriodo * 100) / 100) * 100) / 100 <= 0) {
            debitoResiduo = 0;
          }
        }

        const residuoDopoRata = Math.max(0, Math.round((debitoResiduo - capitale) * 100) / 100);

        result.push({
          numero: i, data: new Date(data),
          importo: Math.round(importo * 100) / 100,
          quotaCapitale: capitale,
          quotaInteressi: interessi,
          debitoResiduo: residuoDopoRata,
          pctInteressi: Math.round((interessi / importo) * 100),
        });

        debitoResiduo = residuoDopoRata;
        data = new Date(data.getFullYear(), data.getMonth() + mesiPerRata, giornoDelMese);

        // Se il debito è già estinto, le rate rimanenti sono a zero
        if (debitoResiduo <= 0 && i < numeroRate) {
          for (let j = i + 1; j <= numeroRate; j++) {
            result.push({
              numero: j, data: new Date(data),
              importo: 0, quotaCapitale: 0, quotaInteressi: 0, debitoResiduo: 0, pctInteressi: 0,
            });
            data = new Date(data.getFullYear(), data.getMonth() + mesiPerRata, giornoDelMese);
          }
          break;
        }

        if (variazionePct) importo = Math.round(importo * (1 + variazionePct / 100) * 100) / 100;
      }
    } else {
      for (let i = 1; i <= numeroRate; i++) {
        result.push({
          numero: i, data: new Date(data),
          importo: Math.round(importo * 100) / 100,
          quotaCapitale: null, quotaInteressi: null, debitoResiduo: null, pctInteressi: null,
        });
        data = new Date(data.getFullYear(), data.getMonth() + mesiPerRata, giornoDelMese);
        if (variazionePct) importo = Math.round(importo * (1 + variazionePct / 100) * 100) / 100;
      }
    }
    return result;
  }

  // ── Helpers template ──────────────────────────────────────────────────────

  fmtEur(n: number): string {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
  }

  fmtData(d: Date): string {
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  submit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const resolved = this.resolveImportoAndNRate();
    if (!resolved) return;
    this.saving.set(true);
    const v  = this.form.value;
    const mm = String(v.meseInizio).padStart(2, '0');
    const isFinanziamento = v.tipoPiano === 'FINANZIAMENTO';
    this.service.createPlan({
      descrizione:           v.descrizione,
      contoBancarioId:       v.contoBancarioId,
      contoCoge:             v.contoCoge,
      importoRata:           resolved.importoRata,
      variazionePct:         v.variazionePct ?? 0,
      giornoDelMese:         v.giornoDelMese,
      frequenza:             v.frequenza,
      numeroRate:            resolved.numeroRate,
      dataInizio:            `${v.annoInizio}-${mm}-01`,
      note:                  v.note || undefined,
      tipoPiano:             isFinanziamento ? 'FINANZIAMENTO' : undefined,
      importoDebitoIniziale: isFinanziamento ? v.importoDebitoIniziale : undefined,
      tassoInteresseAnnuo:   isFinanziamento ? v.tassoInteresseAnnuo : undefined,
      contoCogeInteressiId:  isFinanziamento ? v.contoCogeInteressiId : undefined,
    }).subscribe({
      next: created => this.dialogRef.close(created),
      error: ()      => this.saving.set(false),
    });
  }

  close(): void { this.dialogRef.close(null); }
}
