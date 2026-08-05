import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { ContiService } from '../../core/services/conti.service';
import { CespitiService } from '../../core/services/cespiti.service';
import { LookupService } from '../../core/services/lookup.service';
import { ContoBancarioDTO, CespiteDTO, CespiteRequest, PianoContiCogeDTO } from '../../core/models/anagrafica.models';
import { PartiteAperturaComponent } from './partite-apertura.component';

type Sezione = 'liquidita' | 'cespiti' | 'crediti' | 'debiti' | 'finanziamenti' | 'rimanenze';
interface SezioneDef { id: Sezione; label: string; icon: string; }

/**
 * Data di apertura del gestionale: la scegli tu qui, una volta sola, al go-live.
 *
 * Sui SALDI è solo un'etichetta (il saldo è sempre saldo_iniziale + somma movimenti, senza filtro
 * data). Sulle PARTITE di apertura invece è la competenza economica dei movimenti creati, quindi
 * decide in che esercizio finiscono: per questo dev'essere UNA sola, condivisa dalle due sezioni.
 * Se saldi e partite partissero da due date diverse, la vista finanziaria e quella economica
 * partirebbero da due istanti diversi e non quadrerebbero mai.
 */
function oggiIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface SaldoRow {
  id: number;
  nome: string;
  tipo: string;
  saldoCalcolato: number;
  saldoIniziale: number;
  saving: boolean;
  done: boolean;
}
interface CespiteForm {
  id: string | null;
  descrizione: string;
  contoCogeId: number | null;
  costoStorico: number | null;
  aliquotaAmmortamento: number | null;
  dataAcquisto: string;
}

/**
 * Apertura del gestionale: i dati che vengono da PRIMA della data di apertura e servono per
 * partire giusti.
 * 1) Saldi dei conti a quella data (liquidità reale di partenza).
 * 2) Libro cespiti: i beni durevoli ancora in ammortamento, così il P&L ha gli ammortamenti.
 * 3) Partite aperte: crediti e debiti pregressi (→ PartiteAperturaComponent, che li registra con
 *    competenza nell'anno precedente per non gonfiare il conto economico in corso).
 */
@Component({
  selector: 'app-situazione-iniziale',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterModule, MatIconModule, MatProgressSpinnerModule, PartiteAperturaComponent],
  template: `
    <div class="si">
      <header class="si__head">
        <span class="si__eyebrow">Apertura</span>
        <h1>Situazione iniziale</h1>
        <p class="si__sub">La fotografia al {{ dataAperturaLabel() }} da cui parte il gestionale. Ogni sezione è facoltativa:
          compila quello che hai, quando ce l'hai. Il dettaglio dei movimenti passati non serve.</p>
        <label class="si__data">
          <span>Data di apertura</span>
          <input type="date" [max]="oggi" [ngModel]="dataApertura()" (ngModelChange)="dataApertura.set($event)" />
          @if (!dataAperturaValida()) {
            <em class="si__data-err">Non può essere una data futura.</em>
          } @else {
            <em class="si__data-hint">Vale sia per i saldi sia per crediti e debiti: partono dallo stesso giorno.</em>
          }
        </label>
      </header>

      @if (loading()) {
        <div class="si__center"><mat-spinner diameter="34"></mat-spinner></div>
      } @else {
      <div class="si__body">
        <nav class="si__nav">
          @for (s of SEZIONI; track s.id) {
            <button class="si__nav-item" [class.active]="sezione() === s.id" (click)="sezione.set(s.id)">
              <mat-icon>{{ s.icon }}</mat-icon><span>{{ s.label }}</span>
            </button>
          }
        </nav>

        <section class="si__content">
        @switch (sezione()) {

        @case ('liquidita') {
      <section class="card">
        <div class="card__head">
          <div class="card__title"><mat-icon>account_balance</mat-icon><h2>Saldi al {{ dataAperturaLabel() }}</h2></div>
          <span class="card__hint">Il <strong>saldo contabile</strong> dell'estratto conto a quella data; per la cassa, il contante contato.</span>
        </div>
        <div class="rows">
          @for (r of saldi(); track r.id) {
            <div class="row">
              <div class="row__name">
                <span class="dot" [class.dot--cassa]="r.tipo==='CASSA'"></span>
                {{ r.nome }}
              </div>
              <label class="field field--money">
                <span>Saldo al {{ dataAperturaLabel() }}</span>
                <div class="money"><input type="number" step="0.01" [(ngModel)]="r.saldoIniziale" (ngModelChange)="r.done=false" /><i>€</i></div>
              </label>
              <button class="btn-save" [disabled]="r.saving || !dataAperturaValida()" (click)="salvaSaldo(r)">
                @if (r.saving) { <mat-spinner diameter="16"></mat-spinner> }
                @else if (r.done) { <mat-icon>check</mat-icon> Salvato }
                @else { <mat-icon>save</mat-icon> Salva }
              </button>
            </div>
          }
        </div>
      </section>
        }

        @case ('cespiti') {
      <section class="card">
        <div class="card__head">
          <div class="card__title"><mat-icon>inventory_2</mat-icon><h2>Libro cespiti</h2></div>
          <span class="card__hint">Beni durevoli ancora in ammortamento (forno, arredi, macchine, lavori). Generano il costo "ammortamento" nel P&L, senza muovere soldi.</span>
        </div>

        @if (cespiti().length) {
          <div class="cesp-head">
            <span>Bene</span><span>Acquisto</span><span class="num">Costo</span><span class="num">Aliquota</span>
            <span class="num">Amm./anno</span><span class="num">Residuo</span><span></span>
          </div>
          @for (c of cespiti(); track c.id) {
            <div class="cesp" [class.cesp--off]="!c.isActive">
              <div class="cesp__desc">
                <strong>{{ c.descrizione }}</strong>
                <span class="cesp__coge">{{ c.contoCogeCodice }} · {{ c.contoCogeDescrizione }}</span>
              </div>
              <span>{{ meseAnno(c.dataAcquisto) }}</span>
              <span class="num">{{ eur(c.costoStorico) }}</span>
              <span class="num">{{ c.aliquotaAmmortamento }}%</span>
              <span class="num strong">{{ eur(c.ammortamentoAnnuo) }}</span>
              <span class="num">{{ eur(c.valoreResiduo) }}</span>
              <span class="cesp__act">
                <button class="ico" title="Modifica" (click)="apriForm(c)"><mat-icon>edit</mat-icon></button>
                <button class="ico ico--danger" title="Elimina" (click)="elimina(c)"><mat-icon>delete</mat-icon></button>
              </span>
            </div>
          }
          <div class="cesp-foot">
            <span>Totale ammortamento annuo</span>
            <strong>{{ eur(totaleAnnuo()) }}</strong>
            <span class="cesp-foot__mese">≈ {{ eur(totaleAnnuo()/12) }}/mese nel P&L</span>
          </div>
        } @else {
          <div class="empty"><mat-icon>inventory_2</mat-icon><p>Nessun cespite.</p><span>Aggiungi i beni che il commercialista sta ancora ammortizzando.</span></div>
        }

        @if (!form()) {
          <div class="cesp-actions">
            <button class="btn-add" (click)="apriForm(null)"><mat-icon>add</mat-icon> Aggiungi cespite (bene già posseduto)</button>
            <a class="btn-add btn-add--alt" routerLink="/libro-cespiti"><mat-icon>shopping_cart</mat-icon> Nuovi acquisti → Libro cespiti</a>
          </div>
        } @else {
          <div class="cform">
            <div class="cform__title">{{ form()!.id ? 'Modifica cespite' : 'Nuovo cespite' }}</div>
            <div class="cform__grid">
              <label class="field field--wide"><span>Descrizione</span>
                <input type="text" [ngModel]="form()!.descrizione" (ngModelChange)="patch('descrizione', $event)" placeholder="Es. Lavastoviglie professionale" /></label>
              <label class="field field--wide"><span>Conto (categoria investimento)</span>
                <select [ngModel]="form()!.contoCogeId" (ngModelChange)="patch('contoCogeId', $event)">
                  <option [ngValue]="null" disabled>Scegli…</option>
                  @for (p of contiCapex(); track p.id) { <option [ngValue]="p.id">{{ p.codice }} — {{ p.nome }}</option> }
                </select>
                @if (nuovaCategoria() === null) {
                  <button type="button" class="link-add" (click)="nuovaCategoria.set('')">+ Aggiungi categoria</button>
                } @else {
                  <div class="newcat">
                    <input type="text" [ngModel]="nuovaCategoria()" (ngModelChange)="nuovaCategoria.set($event)"
                           placeholder="Nome categoria (es. Impianto fotovoltaico)" (keyup.enter)="creaCategoria()" />
                    <button type="button" class="btn-mini btn-mini--ok" [disabled]="!nuovaCategoria()?.trim() || creandoCategoria()" (click)="creaCategoria()">
                      @if (creandoCategoria()) { <mat-spinner diameter="14"></mat-spinner> } @else { Crea }
                    </button>
                    <button type="button" class="btn-mini" (click)="nuovaCategoria.set(null)" aria-label="Annulla"><mat-icon>close</mat-icon></button>
                  </div>
                }
              </label>
              <label class="field"><span>Costo storico</span>
                <div class="money"><input type="number" step="0.01" [ngModel]="form()!.costoStorico" (ngModelChange)="patch('costoStorico', $event)" /><i>€</i></div></label>
              <label class="field"><span>Aliquota ammortamento</span>
                <div class="money"><input type="number" step="0.01" [ngModel]="form()!.aliquotaAmmortamento" (ngModelChange)="patch('aliquotaAmmortamento', $event)" /><i>%</i></div></label>
              <label class="field"><span>Data acquisto</span>
                <input type="date" [ngModel]="form()!.dataAcquisto" (ngModelChange)="patch('dataAcquisto', $event)" /></label>
            </div>
            <div class="cform__preview">
              <mat-icon>calculate</mat-icon>
              Ammortamento: <strong>{{ eur(previewMensile()) }}/mese</strong> · {{ eur(previewMensile()*12) }}/anno
              @if (previewVita()) { · vita {{ previewVita() }} anni }
            </div>
            <div class="cform__actions">
              <button class="btn-ghost" (click)="form.set(null)">Annulla</button>
              <button class="btn-primary" [disabled]="!formValido() || saving()" (click)="salvaCespite()">
                @if (saving()) { <mat-spinner diameter="16"></mat-spinner> } @else { Salva cespite }
              </button>
            </div>
          </div>
        }
      </section>
        }

        @case ('crediti') {
          <section class="card">
            <div class="card__head"><div class="card__title"><mat-icon>call_received</mat-icon><h2>Crediti da incassare</h2></div></div>
            <app-partite-apertura tipo="ENTRATA" [dataApertura]="dataApertura()" [dataValida]="dataAperturaValida()" />
          </section>
        }

        @case ('debiti') {
          <section class="card">
            <div class="card__head"><div class="card__title"><mat-icon>call_made</mat-icon><h2>Debiti da pagare</h2></div></div>
            <app-partite-apertura tipo="USCITA" [dataApertura]="dataApertura()" [dataValida]="dataAperturaValida()" />
          </section>
        }

        @case ('finanziamenti') {
          <section class="card guide">
            <div class="card__head"><div class="card__title"><mat-icon>account_balance_wallet</mat-icon><h2>Finanziamenti e mutui</h2></div></div>
            <p class="guide__txt">Mutui, leasing e finanziamenti in corso non si inseriscono qui: si gestiscono come
              <strong>spese ricorrenti</strong>, partendo dal <strong>debito residuo al {{ dataAperturaLabel() }}</strong>. Nel conto
              economico entra solo la quota interessi delle rate; il capitale è debito, non costo.
              La <strong>prima rata</strong> va datata dopo la data di apertura, altrimenti lo scheduler rigenera rate già pagate.</p>
            <a class="guide__cta" routerLink="/spese-ricorrenti"><mat-icon>arrow_forward</mat-icon> Vai a Spese ricorrenti</a>
          </section>
        }

        @case ('rimanenze') {
          <section class="card guide">
            <div class="card__head"><div class="card__title"><mat-icon>warehouse</mat-icon><h2>Rimanenze di magazzino</h2></div></div>
            <p class="guide__txt">Il valore delle scorte alla data di apertura (cantina, spaccio, food) è una posta dello stato
              patrimoniale che il gestionale <strong>non traccia</strong>: serve per il bilancio della commercialista, non per i
              KPI di cassa e margine di questo strumento.</p>
            <p class="guide__txt">Chiedi alla commercialista il <strong>valore delle rimanenze al {{ dataAperturaLabel() }}</strong> e
              tienilo come riferimento; non va inserito qui perché non alimenta nessun calcolo del gestionale.</p>
          </section>
        }

        }
        </section>
      </div>
      }
    </div>
  `,
  styleUrls: ['./situazione-iniziale.component.scss'],
})
export class SituazioneInizialeComponent {
  private readonly contiSvc = inject(ContiService);
  private readonly cespitiSvc = inject(CespitiService);
  private readonly lookup = inject(LookupService);
  private readonly snack = inject(MatSnackBar);

  readonly SEZIONI: SezioneDef[] = [
    { id: 'liquidita',     label: 'Liquidità',           icon: 'account_balance' },
    { id: 'cespiti',       label: 'Cespiti',             icon: 'inventory_2' },
    { id: 'crediti',       label: 'Crediti da incassare', icon: 'call_received' },
    { id: 'debiti',        label: 'Debiti da pagare',    icon: 'call_made' },
    { id: 'finanziamenti', label: 'Finanziamenti',       icon: 'account_balance_wallet' },
    { id: 'rimanenze',     label: 'Rimanenze',           icon: 'warehouse' },
  ];
  readonly sezione = signal<Sezione>('liquidita');

  /** Data di apertura condivisa da saldi e partite. Default: oggi. */
  readonly oggi = oggiIso();
  readonly dataApertura = signal(this.oggi);
  readonly dataAperturaValida = computed(() => {
    const d = this.dataApertura();
    return !!d && d <= this.oggi;          // niente date future: non esiste un saldo di domani
  });
  readonly dataAperturaLabel = computed(() => {
    const d = this.dataApertura();
    return d ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d)) : '—';
  });

  readonly loading = signal(true);
  readonly saldi = signal<SaldoRow[]>([]);
  readonly cespiti = signal<CespiteDTO[]>([]);
  readonly contiCapex = signal<PianoContiCogeDTO[]>([]);
  readonly form = signal<CespiteForm | null>(null);
  readonly saving = signal(false);
  readonly nuovaCategoria = signal<string | null>(null);   // null = chiuso, '' = aperto vuoto
  readonly creandoCategoria = signal(false);

  readonly totaleAnnuo = computed(() =>
    this.cespiti().filter(c => c.isActive).reduce((s, c) => s + c.ammortamentoAnnuo, 0));
  readonly previewMensile = computed(() => {
    const f = this.form();
    if (!f?.costoStorico || !f?.aliquotaAmmortamento) return 0;
    return f.costoStorico * f.aliquotaAmmortamento / 1200;
  });
  readonly previewVita = computed(() => {
    const a = this.form()?.aliquotaAmmortamento;
    return a ? Math.round(100 / a) : 0;
  });

  constructor() { this.carica(); }

  private carica(): void {
    this.loading.set(true);
    forkJoin({
      conti: this.contiSvc.getAllFresh(),
      cespiti: this.cespitiSvc.getAll(),
      piano: this.lookup.getPianoConti(),
    }).subscribe({
      next: ({ conti, cespiti, piano }) => {
        this.saldi.set(conti.map(c => this.toRow(c)));
        // Solo il libro iniziale: gli acquisti nuovi (con movimento collegato) vivono in /libro-cespiti
        this.cespiti.set(cespiti.filter(c => c.movimentoAcquistoId == null));
        this.contiCapex.set(piano.filter(p => /^50\.\d+\.\d+/.test(p.codice)).sort((a, b) => a.codice.localeCompare(b.codice)));
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.snack.open('Errore nel caricamento.', 'OK', { duration: 4000 }); },
    });
  }

  private toRow(c: ContoBancarioDTO): SaldoRow {
    return {
      id: c.id, nome: c.nome, tipo: c.tipo, saldoCalcolato: c.saldoCalcolato,
      saldoIniziale: c.saldoIniziale ?? 0,
      saving: false, done: false,
    };
  }

  salvaSaldo(r: SaldoRow): void {
    if (!this.dataAperturaValida()) return;
    r.saving = true; this.saldi.update(a => [...a]);
    this.contiSvc.updateSaldoIniziale(r.id, Number(r.saldoIniziale) || 0, this.dataApertura()).subscribe({
      next: () => { r.saving = false; r.done = true; this.saldi.update(a => [...a]);
        this.snack.open(`Saldo di ${r.nome} salvato`, undefined, { duration: 2000 }); },
      error: () => { r.saving = false; this.saldi.update(a => [...a]);
        this.snack.open('Salvataggio non riuscito.', 'OK', { duration: 4000 }); },
    });
  }

  patch<K extends keyof CespiteForm>(key: K, value: CespiteForm[K]): void {
    this.form.update(f => f ? { ...f, [key]: value } : f);
  }

  creaCategoria(): void {
    const nome = (this.nuovaCategoria() ?? '').trim();
    if (!nome || this.creandoCategoria()) return;
    this.creandoCategoria.set(true);
    this.cespitiSvc.creaCategoria(nome).subscribe({
      next: (c) => {
        this.contiCapex.update(l => [...l, c].sort((a, b) => a.codice.localeCompare(b.codice)));
        this.patch('contoCogeId', c.id);          // seleziona la nuova categoria
        this.nuovaCategoria.set(null);
        this.creandoCategoria.set(false);
        this.snack.open(`Categoria "${c.nome}" creata (${c.codice})`, undefined, { duration: 2200 });
      },
      error: () => { this.creandoCategoria.set(false); this.snack.open('Creazione categoria non riuscita.', 'OK', { duration: 4000 }); },
    });
  }

  apriForm(c: CespiteDTO | null): void {
    this.nuovaCategoria.set(null);
    this.form.set(c
      ? { id: c.id, descrizione: c.descrizione, contoCogeId: c.contoCogeId, costoStorico: c.costoStorico, aliquotaAmmortamento: c.aliquotaAmmortamento, dataAcquisto: c.dataAcquisto }
      : { id: null, descrizione: '', contoCogeId: null, costoStorico: null, aliquotaAmmortamento: null, dataAcquisto: '' });
  }

  formValido(): boolean {
    const f = this.form();
    return !!(f && f.descrizione.trim() && f.contoCogeId && f.costoStorico && f.costoStorico > 0
      && f.aliquotaAmmortamento && f.aliquotaAmmortamento > 0 && f.aliquotaAmmortamento <= 100 && f.dataAcquisto);
  }

  salvaCespite(): void {
    const f = this.form();
    if (!f || !this.formValido()) return;
    const body: CespiteRequest = {
      descrizione: f.descrizione.trim(), contoCogeId: f.contoCogeId!, costoStorico: f.costoStorico!,
      aliquotaAmmortamento: f.aliquotaAmmortamento!, dataAcquisto: f.dataAcquisto, isActive: true,
    };
    this.saving.set(true);
    const req$ = f.id ? this.cespitiSvc.update(f.id, body) : this.cespitiSvc.create(body);
    req$.subscribe({
      next: () => { this.saving.set(false); this.form.set(null); this.snack.open('Cespite salvato', undefined, { duration: 2000 }); this.ricaricaCespiti(); },
      error: () => { this.saving.set(false); this.snack.open('Salvataggio non riuscito.', 'OK', { duration: 4000 }); },
    });
  }

  elimina(c: CespiteDTO): void {
    if (!confirm(`Eliminare il cespite "${c.descrizione}"?`)) return;
    this.cespitiSvc.delete(c.id).subscribe({
      next: () => { this.snack.open('Cespite eliminato', undefined, { duration: 2000 }); this.ricaricaCespiti(); },
      error: err => this.snack.open(err?.error?.message ?? 'Eliminazione non riuscita.', 'OK', { duration: 5000 }),
    });
  }


  private ricaricaCespiti(): void {
    this.cespitiSvc.getAll().subscribe({
      next: l => this.cespiti.set(l.filter(c => c.movimentoAcquistoId == null)),
      error: () => {},
    });
  }

  eur(v: number): string {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v ?? 0);
  }
  meseAnno(iso: string): string {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('it-IT', { month: 'short', year: 'numeric' }).format(new Date(iso));
  }
}
