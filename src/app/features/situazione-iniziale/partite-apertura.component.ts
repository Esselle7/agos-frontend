import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MovimentiService } from '../../core/services/movimenti.service';
import { MovimentoDTOShared } from '../../core/models/shared.models';
import { PianoContiCogeDTO } from '../../core/models/anagrafica.models';
import { CogePickerComponent } from '../../shared/components/coge-picker/coge-picker.component';

interface PartitaForm {
  descrizione: string;
  importo: number | null;
  scadenza: string;
  contoCoge: number | null;
}

/**
 * Crediti da incassare (ENTRATA) o debiti da pagare (USCITA) già aperti alla data di apertura.
 * Sono movimenti DA_LIQUIDARE: quando li incassi/paghi muovono la cassa e si liquidano normalmente.
 *
 * **La competenza economica NON è la data di apertura, è il 31/12 dell'anno precedente.**
 * Motivo misurato (2026-08-05): il conto economico aggrega per MESE
 * (`mv_conto_economico_mensile`), quindi qualunque competenza dentro il mese di apertura finisce
 * nel P&L di quel mese — un credito pregresso di 1.000 € comparirebbe come ricavo di agosto.
 * Spostandola all'anno precedente le poste di apertura restano fuori dal conto economico
 * dell'esercizio in corso, che è la promessa fatta all'utente nel manuale: *"non gonfiano il P&L"*.
 * Non basta il giorno prima (04/08 finisce comunque in agosto): serve cambiare anno.
 *
 * La data di apertura arriva dal padre e serve a sapere QUALE anno è il pregresso.
 */
@Component({
  selector: 'app-partite-apertura',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatProgressSpinnerModule, CogePickerComponent],
  template: `
    <p class="intro">{{ intro }}</p>

    @if (loading()) {
      <div class="center"><mat-spinner diameter="28"></mat-spinner></div>
    } @else {
      @if (righe().length) {
        <ul class="list">
          @for (m of righe(); track m.id) {
            <li class="row" [class.row--busy]="busyId() === m.id">
              <div class="amount" [class.is-in]="entrata" [class.is-out]="!entrata">{{ eur(m.importo) }}</div>
              <div class="meta">
                <p class="desc">{{ m.descrizione || 'Senza descrizione' }} <span class="tag-2025">Apertura {{ annoApertura }}</span></p>
                <span class="sub">{{ controparteLabel }} · scadenza {{ data(m.dataLiquidita) }}</span>
              </div>
              <button class="ico ico--danger" [disabled]="busyId() === m.id" (click)="elimina(m)" title="Rimuovi"><mat-icon>delete</mat-icon></button>
            </li>
          }
        </ul>
        <div class="foot"><span>Totale {{ totaleLabel }}</span><strong>{{ eur(totale()) }}</strong></div>
      } @else {
        <div class="empty"><mat-icon>{{ entrata ? 'call_received' : 'call_made' }}</mat-icon><p>Niente da inserire.</p><span>{{ emptyHint }}</span></div>
      }

      @if (!form()) {
        <button class="btn-add" (click)="apri()"><mat-icon>add</mat-icon> {{ addLabel }}</button>
      } @else {
        <div class="cform">
          <div class="cform__grid">
            <label class="field field--wide"><span>{{ controparteLabel }} e causale</span>
              <input type="text" [ngModel]="form()!.descrizione" (ngModelChange)="patch('descrizione', $event)" [placeholder]="placeholder" /></label>
            <label class="field"><span>Importo</span>
              <div class="money"><input type="number" step="0.01" [ngModel]="form()!.importo" (ngModelChange)="patch('importo', $event)" /><i>€</i></div></label>
            <label class="field"><span>Scadenza prevista</span>
              <input type="date" [ngModel]="form()!.scadenza" (ngModelChange)="patch('scadenza', $event)" /></label>
            <div class="field field--wide">
              <app-coge-picker [tipoFilter]="cogeTipo" [value]="form()!.contoCoge" [required]="true"
                               [label]="entrata ? 'Categoria ricavo' : 'Categoria costo'"
                               (cogeChange)="patch('contoCoge', $event?.id ?? null)" />
            </div>
          </div>
          <div class="cform__actions">
            <button class="btn-ghost" (click)="form.set(null)">Annulla</button>
            <button class="btn-primary" [disabled]="!valido() || saving()" (click)="salva()">
              @if (saving()) { <mat-spinner diameter="14"></mat-spinner> } @else { Aggiungi }
            </button>
          </div>
        </div>
      }
    }
  `,
  styleUrls: ['./partite-apertura.component.scss'],
})
export class PartiteAperturaComponent implements OnInit {
  @Input({ required: true }) tipo!: 'ENTRATA' | 'USCITA';
  /** Data di apertura scelta nel padre. NON è la competenza: da qui si ricava l'anno del pregresso. */
  @Input({ required: true }) dataApertura!: string;
  /** Falsa se la data scelta nel padre non è valida: blocca il salvataggio. */
  @Input() dataValida = true;

  private readonly svc = inject(MovimentiService);
  private readonly snack = inject(MatSnackBar);

  readonly righe = signal<MovimentoDTOShared[]>([]);
  readonly loading = signal(true);
  readonly busyId = signal<string | null>(null);
  readonly form = signal<PartitaForm | null>(null);
  readonly saving = signal(false);
  readonly totale = computed(() => this.righe().reduce((s, m) => s + (m.importo ?? 0), 0));

  get entrata(): boolean { return this.tipo === 'ENTRATA'; }
  get cogeTipo(): string[] { return [this.entrata ? 'RICAVO' : 'COSTO']; }
  get controparteLabel(): string { return this.entrata ? 'Cliente' : 'Fornitore'; }
  get totaleLabel(): string { return this.entrata ? 'crediti da incassare' : 'debiti da pagare'; }
  get addLabel(): string { return this.entrata ? 'Aggiungi credito' : 'Aggiungi debito'; }
  /** Anno del pregresso: quello PRIMA dell'apertura. È l'anno di competenza delle poste. */
  get annoApertura(): number {
    return (Number(this.dataApertura?.slice(0, 4)) || new Date().getFullYear()) - 1;
  }
  /** Competenza economica delle poste di apertura: 31/12 dell'anno precedente (vedi doc di classe). */
  get dataPregressa(): string { return `${this.annoApertura}-12-31`; }
  get dataAperturaLabel(): string {
    return this.dataApertura
      ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(this.dataApertura))
      : '—';
  }
  get intro(): string {
    return this.entrata
      ? `Soldi che i clienti ti devono al ${this.dataAperturaLabel} (eventi o fatture non ancora incassati). Quando li incassi muovono la cassa, ma NON contano come ricavo dell'esercizio in corso: sono pregressi, registrati con competenza ${this.annoApertura}.`
      : `Fatture fornitori da pagare al ${this.dataAperturaLabel} (es. un saldo fornitore aperto). Quando le paghi escono dalla cassa, ma NON contano come costo dell'esercizio in corso: sono pregresse, registrate con competenza ${this.annoApertura}.`;
  }
  get emptyHint(): string {
    return this.entrata ? 'Aggiungi i crediti aperti che ti ha indicato la commercialista.'
                        : 'Aggiungi i debiti verso fornitori ancora aperti a quella data.';
  }
  get placeholder(): string {
    return this.entrata ? 'Es. Evento Rossi – saldo da incassare' : 'Es. Fornitore X – fatture da saldare';
  }

  ngOnInit(): void { this.carica(); }

  private carica(): void {
    this.loading.set(true);
    this.svc.getPartiteApertura(this.tipo).subscribe({
      next: l => { this.righe.set(l); this.loading.set(false); },
      error: () => { this.loading.set(false); this.snack.open('Errore nel caricamento.', 'OK', { duration: 4000 }); },
    });
  }

  apri(): void {
    // Scadenza proposta: 3 mesi dopo l'apertura. È solo un default, si cambia a mano.
    const d = new Date(this.dataApertura);
    d.setMonth(d.getMonth() + 3);
    const scadenza = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    this.form.set({ descrizione: '', importo: null, scadenza, contoCoge: null });
  }
  patch<K extends keyof PartitaForm>(k: K, v: PartitaForm[K]): void {
    this.form.update(f => f ? { ...f, [k]: v } : f);
  }
  valido(): boolean {
    const f = this.form();
    return !!(f && this.dataValida && f.descrizione.trim() && f.importo && f.importo > 0 && f.scadenza && f.contoCoge);
  }

  salva(): void {
    const f = this.form();
    if (!f || !this.valido()) return;
    this.saving.set(true);
    this.svc.create({
      tipo: this.tipo, importo: f.importo!, importoLordo: f.importo!, aliquotaIva: null,
      dataMovimento: this.dataPregressa, dataCompetenza: this.dataPregressa, dataFinanziaria: null,
      dataLiquidita: f.scadenza, contoBancarioId: null, metodoPagamentoId: null,
      businessUnitId: this.entrata ? 2 : 1, contoCoge: f.contoCoge!, categoriaId: null,
      fornitoreId: null, eventoId: null, tipoEventoMovimento: null,
      descrizione: f.descrizione.trim(), note: null, riferimentoEsterno: null, fonte: 'APERTURA', allegatoPath: null,
    }).subscribe({
      next: () => { this.saving.set(false); this.form.set(null); this.snack.open('Aggiunto', undefined, { duration: 1800 }); this.carica(); },
      error: () => { this.saving.set(false); this.snack.open('Salvataggio non riuscito.', 'OK', { duration: 4000 }); },
    });
  }

  elimina(m: MovimentoDTOShared): void {
    this.busyId.set(m.id);
    this.svc.delete(m.id).subscribe({
      next: () => { this.righe.update(l => l.filter(x => x.id !== m.id)); this.busyId.set(null); },
      error: () => { this.busyId.set(null); this.snack.open('Rimozione non riuscita.', 'OK', { duration: 4000 }); },
    });
  }

  eur(v: number): string { return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v ?? 0); }
  data(iso: string | null): string { return iso ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—'; }
}
