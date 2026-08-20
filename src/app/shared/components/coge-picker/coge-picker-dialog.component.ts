import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { PianoContiCogeDTO, TipoCoge } from '../../../core/models/anagrafica.models';
import { AuthService } from '../../../core/auth/auth.service';
// Il dialog di creazione conto vive nella pagina /piano-conti: qui viene RIUSATO, non duplicato
// (unica fonte di verità per codice auto-generato, anteprima e retry su CODICE_DUPLICATO).
import {
  PianoContiFormDialogComponent,
  PianoContiFormData,
} from '../../../features/piano-conti/piano-conti-form-dialog.component';

export interface CogePickerData {
  conti: PianoContiCogeDTO[];
  tipoFilter?: string[];          // restringe ai tipi indicati (es. ['COSTO'])
  allowedIds?: number[];          // restringe agli id ammessi (i chiamanti la calcolano per esclusione)
  selectedId?: number | null;
  title?: string;
  recents?: number[];             // id usati di recente (mostrati come scorciatoie)
}

const TIPO_LABEL: Record<string, string> = {
  RICAVO: 'Ricavi', COSTO: 'Costi', ATTIVITA: 'Attività',
  PASSIVITA: 'Passività', ONERE_FINANZIARIO: 'Oneri finanziari', IMPOSTA: 'Imposte',
};
const TIPO_COLOR: Record<string, string> = {
  RICAVO: '#1F5C43', COSTO: '#B23B2E', ATTIVITA: '#2C6E8F',
  PASSIVITA: '#92400E', ONERE_FINANZIARIO: '#7C3AED', IMPOSTA: '#6B7280',
};

/**
 * Primo livello della maschera (spec coge-02). È un raggruppamento di sola PRESENTAZIONE:
 * «Altro» non è un tipo del dominio, e chi apre il picker continua a filtrare per `tipo`.
 */
const GRUPPI = [
  { key: 'COSTI', label: 'Costi', color: TIPO_COLOR['COSTO'] },
  { key: 'RICAVI', label: 'Ricavi', color: TIPO_COLOR['RICAVO'] },
  { key: 'ALTRO', label: 'Altro', color: '#6B7280' },
];
/** Un tipo non mappato (o nuovo in `lk_tipi_coge`) finisce in «Altro», mai fuori dalla lista. */
function gruppoDi(tipo: string): string {
  return tipo === 'COSTO' ? 'COSTI' : tipo === 'RICAVO' ? 'RICAVI' : 'ALTRO';
}
function labelGruppo(key: string): string {
  return GRUPPI.find(g => g.key === key)?.label ?? key;
}

/**
 * Id dei conti creati dal picker in questa sessione dell'app. Serve perché i chiamanti passano
 * `allowedIds` calcolato sul piano che avevano in mano PRIMA (spese-wizard: tutto tranne 30.02.* e i
 * due transitori): senza questo, il conto appena creato sparirebbe alla riapertura del picker, fino
 * al reload. Al reload il piano si ricarica e la lista del chiamante lo contiene già → si svuota da sé.
 * Non allarga i permessi: le guardie vere (CogeRiservatoEventi, CogeTransitorio) sono lato server.
 */
const CREATI_QUI = new Set<number>();

interface Categoria {
  id: number;
  codice: string;
  descrizione: string;
  /** Nome del mastro di livello 1 (es. «INVESTIMENTI (CAPEX)»): distingue 50.* dai costi di P&L. */
  padre: string;
  tipo: string;
  conti: PianoContiCogeDTO[];
}

/**
 * Selettore Conto COGE a tre livelli (gruppo Costi|Ricavi|Altro → categoria → conto). Stessa scelta
 * finale di prima (un conto del piano) e stesso valore emesso: il {@link PianoContiCogeDTO} scelto,
 * {@code null} per "rimuovi", {@code undefined} se annulla. Nessun chiamante cambia.
 */
@Component({
  selector: 'app-coge-picker-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatDialogModule, MatIconModule, MatButtonModule],
  template: `
    <div class="cp">
      <header class="cp__head">
        <h2>{{ data.title || 'Scegli il conto' }}</h2>
        @if (puoCreare()) {
          <button mat-button class="cp__new" type="button" (click)="creaConto()">
            <mat-icon>add</mat-icon> Nuovo conto
          </button>
        }
        <button mat-icon-button (click)="annulla()" aria-label="Chiudi"><mat-icon>close</mat-icon></button>
      </header>

      <div class="cp__search">
        <mat-icon>search</mat-icon>
        <input #q type="text" placeholder="Cerca per nome o codice…"
               [ngModel]="query()" (ngModelChange)="query.set($event)" autocomplete="off" />
        @if (query()) {
          <button mat-icon-button (click)="query.set(''); q.focus()" aria-label="Pulisci"><mat-icon>close</mat-icon></button>
        }
      </div>

      <!-- Recenti: sopra i gruppi e NON filtrati dal gruppo attivo (R5) -->
      @if (!query() && recentiConti().length) {
        <div class="cp__recents">
          <span class="cp__recents-lbl">Recenti</span>
          @for (c of recentiConti(); track c.id) {
            <button class="cp__chip" type="button"
                    [class.cp__chip--on]="c.id === scelto()?.id"
                    (click)="scegli(c)" [title]="c.codice">
              <span class="cp__chip-dot" [style.background]="color(c.tipo)"></span>{{ c.nome }}
            </button>
          }
        </div>
      }

      <!-- Primo livello: la scelta grossa. Con un solo gruppo vivo (es. tipoFilter=['RICAVO']) sparisce (R2) -->
      @if (!query() && gruppi().length > 1) {
        <div class="cp__groups" role="group" aria-label="Gruppo di conti">
          @for (g of gruppi(); track g.key) {
            <button class="cp__group" type="button" [class.cp__group--on]="g.key === gruppoSel()"
                    [attr.aria-pressed]="g.key === gruppoSel()" (click)="selGruppo(g.key)">
              <span class="cp__group-dot" [style.background]="g.color"></span>{{ g.label }}
              <span class="cp__group-count">{{ g.n }}</span>
            </button>
          }
        </div>
      }

      <div class="cp__body">
        @if (query()) {
          <!-- Ricerca: GLOBALE su tutti i gruppi, con il gruppo nel percorso (R4) -->
          <div class="cp__results">
            @if (!risultati().length) {
              <p class="cp__empty">Nessun conto per «{{ query() }}».</p>
            }
            @for (c of risultati(); track c.id) {
              <button class="cp__leaf" type="button"
                      [class.cp__leaf--on]="c.id === scelto()?.id"
                      (click)="scegli(c)" (dblclick)="conferma()">
                <span class="cp__radio" [class.cp__radio--on]="c.id === scelto()?.id"></span>
                <span class="cp__leaf-main">
                  <span class="cp__leaf-path">{{ pathOf(c) }}</span>
                  <span class="cp__leaf-name">{{ c.nome }}</span>
                </span>
                <span class="cp__code">{{ c.codice }}</span>
              </button>
            }
          </div>
        } @else if (!gruppi().length) {
          <p class="cp__empty">Nessun conto disponibile.</p>
        } @else {
          <!-- Due pannelli: categorie del gruppo | conti della categoria -->
          <div class="cp__panes" [class.cp__panes--drill]="drill()">
            <div class="cp__cats">
              @for (cat of categorie(); track cat.id) {
                @if (cat.conti.length > 1) {
                  <button class="cp__cat" type="button"
                          [class.cp__cat--on]="cat.id === catSelId()"
                          [title]="cat.descrizione + ' (' + cat.codice + ')'"
                          (click)="apriCat(cat)">
                    <span class="cp__cat-dot" [style.background]="color(cat.tipo)"></span>
                    <span class="cp__cat-main">
                      <span class="cp__cat-name">{{ cat.descrizione }}</span>
                      <span class="cp__cat-meta">{{ cat.padre || tipoLabel(cat.tipo) }} · {{ cat.codice }}</span>
                    </span>
                    <span class="cp__cat-count">{{ cat.conti.length }}</span>
                  </button>
                } @else {
                  <!-- Categoria con una sola foglia (o conto radice): voce diretta, non un click sprecato (R3/R1b) -->
                  <button class="cp__leaf" type="button"
                          [class.cp__leaf--on]="cat.conti[0].id === scelto()?.id"
                          (click)="scegli(cat.conti[0])" (dblclick)="conferma()">
                    <span class="cp__radio" [class.cp__radio--on]="cat.conti[0].id === scelto()?.id"></span>
                    <span class="cp__leaf-name">{{ cat.conti[0].nome }}</span>
                    <span class="cp__code">{{ cat.conti[0].codice }}</span>
                  </button>
                }
              }
            </div>
            <div class="cp__leaves">
              <button class="cp__back" type="button" (click)="drill.set(false)">
                <mat-icon>chevron_left</mat-icon>{{ catSel()?.descrizione || 'Indietro' }}
              </button>
              @if (!catSel()) {
                <p class="cp__empty">Scegli una categoria a sinistra.</p>
              }
              @for (c of catSel()?.conti ?? []; track c.id) {
                <button class="cp__leaf" type="button"
                        [class.cp__leaf--on]="c.id === scelto()?.id"
                        (click)="scegli(c)" (dblclick)="conferma()">
                  <span class="cp__radio" [class.cp__radio--on]="c.id === scelto()?.id"></span>
                  <span class="cp__leaf-name">{{ c.nome }}</span>
                  <span class="cp__code">{{ c.codice }}</span>
                </button>
              }
            </div>
          </div>
        }
      </div>

      <footer class="cp__foot">
        @if (data.selectedId != null) {
          <button mat-button class="cp__remove" (click)="rimuovi()">Rimuovi</button>
        }
        <span class="cp__sel" aria-live="polite">
          @if (scelto()) { <b>{{ scelto()!.nome }}</b> <span class="cp__code">{{ scelto()!.codice }}</span> }
          @else { Nessun conto selezionato }
        </span>
        <button mat-button (click)="annulla()">Annulla</button>
        <button mat-flat-button color="primary" [disabled]="!scelto()" (click)="conferma()">Conferma</button>
      </footer>
    </div>
  `,
  styles: [`
    /* Altezza DEFINITA (non solo max-height): senza, i pannelli interni con height:100% non hanno
       un'altezza concreta su cui calcolare lo scroll → la lista sinistra cresceva e veniva tagliata. */
    .cp { width: min(760px, 92vw); display: flex; flex-direction: column; height: min(80vh, 560px); }
    .cp__head { display: flex; align-items: center; justify-content: space-between; padding: 4px 4px 4px 8px; }
    .cp__head h2 { flex: 1; min-width: 0; margin: 0; font-size: 1.1rem; }
    .cp__new { flex-shrink: 0; color: var(--primary); }
    .cp__search { display: flex; align-items: center; gap: 8px; margin: 4px 10px 10px; padding: 9px 14px;
      border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
    .cp__search mat-icon { color: var(--text-sub); }
    .cp__search input { flex: 1; border: none; background: transparent; outline: none; font: inherit; color: var(--text-main); }
    .cp__recents { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 0 8px 10px; }
    .cp__recents-lbl { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text-sub); margin-right: 2px; }
    .cp__chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border: 1px solid var(--border);
      border-radius: 999px; background: var(--card); cursor: pointer; font: inherit; font-size: .82rem; color: var(--text-main);
      transition: background .14s, border-color .14s; }
    .cp__chip:hover { background: color-mix(in srgb, var(--primary) 7%, transparent); }
    .cp__chip--on { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, transparent); }
    .cp__chip-dot { width: 8px; height: 8px; border-radius: 50%; }
    /* wrap: su schermo stretto il terzo gruppo va a capo invece di essere tagliato fuori dal dialog */
    .cp__groups { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 10px 10px; }
    .cp__group { flex: 1 1 auto; min-width: 0; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 9px 12px;
      border: 1px solid var(--border); border-radius: 12px; background: var(--card); cursor: pointer; font: inherit;
      font-size: .9rem; font-weight: 600; color: var(--text-main); transition: background .14s, border-color .14s; }
    .cp__group:hover { background: color-mix(in srgb, var(--primary) 7%, transparent); }
    .cp__group--on { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, transparent); }
    .cp__group-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
    .cp__group-count { font-size: .75rem; font-weight: 700; color: var(--text-sub); background: var(--surface);
      padding: 1px 7px; border-radius: 999px; }
    .cp__body { flex: 1 1 auto; min-height: 0; overflow: hidden; border-top: 1px solid var(--border); }
    /* minmax(0,1fr): le colonne possono restringersi → l'ellissi dei nomi lunghi funziona e il layout non spancia */
    .cp__panes { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); height: 100%; min-height: 0; }
    /* min-height:0 sui contenitori scrollabili: senza, crescono col contenuto invece di scorrere */
    .cp__cats { overflow-y: auto; min-height: 0; border-right: 1px solid var(--border); padding: 6px; }
    .cp__leaves, .cp__results { overflow-y: auto; min-height: 0; padding: 6px; }
    .cp__results { max-height: 56vh; }
    .cp__back { display: none; align-items: center; gap: 2px; width: 100%; padding: 8px 6px; margin-bottom: 4px;
      border: none; border-bottom: 1px solid var(--border); background: transparent; cursor: pointer; font: inherit;
      font-size: .82rem; font-weight: 600; color: var(--primary); text-align: left; }
    .cp__cat { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border: none;
      background: transparent; border-radius: 12px; cursor: pointer; text-align: left; font: inherit; transition: background .12s; }
    .cp__cat:hover { background: color-mix(in srgb, var(--primary) 6%, transparent); }
    .cp__cat--on { background: color-mix(in srgb, var(--primary) 12%, transparent); }
    .cp__cat-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
    .cp__cat-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .cp__cat-name { font-size: .9rem; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cp__cat-meta { font-size: .72rem; color: var(--text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cp__cat-count { flex-shrink: 0; font-size: .75rem; font-weight: 700; color: var(--text-sub); background: var(--surface);
      min-width: 22px; height: 20px; padding: 0 6px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; }
    .cp__leaf { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border: none;
      background: transparent; border-radius: 12px; cursor: pointer; text-align: left; font: inherit; transition: background .12s; }
    .cp__leaf:hover { background: color-mix(in srgb, var(--primary) 6%, transparent); }
    .cp__leaf--on { background: color-mix(in srgb, var(--primary) 14%, transparent); }
    .cp__radio { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--border); flex-shrink: 0; transition: border-color .12s; }
    .cp__radio--on { border-color: var(--primary); box-shadow: inset 0 0 0 3px var(--primary); }
    .cp__leaf-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .cp__leaf-path { font-size: .68rem; color: var(--text-sub); text-transform: uppercase; letter-spacing: .03em; }
    .cp__leaf-name { flex: 1; font-size: .9rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cp__code { font-family: ui-monospace, 'Courier New', monospace; font-size: .76rem; color: var(--text-sub);
      background: var(--surface); padding: 2px 6px; border-radius: 6px; flex-shrink: 0; }
    .cp__empty { color: var(--text-sub); font-size: .88rem; padding: 24px 12px; text-align: center; }
    .cp__foot { display: flex; align-items: center; gap: 10px; padding: 10px 8px 4px; border-top: 1px solid var(--border); }
    .cp__sel { flex: 1; min-width: 0; font-size: .82rem; color: var(--text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cp__sel b { color: var(--text-main); }
    .cp__remove { color: #b23b2e !important; }
    /* Stretto: un pannello per volta (prima le categorie sparivano del tutto → navigazione impossibile). */
    @media (max-width: 560px) {
      .cp__panes { grid-template-columns: 1fr; }
      .cp__cats { border-right: none; }
      .cp__panes--drill .cp__cats { display: none; }
      .cp__panes:not(.cp__panes--drill) .cp__leaves { display: none; }
      .cp__back { display: flex; }
      .cp__groups { gap: 6px; padding: 0 8px 8px; }
      .cp__group { padding: 8px 10px; gap: 6px; font-size: .84rem; }
    }
  `],
})
export class CogePickerDialogComponent {
  readonly data = inject<CogePickerData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<CogePickerDialogComponent>);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);

  /** Copia locale del piano: un conto creato dal picker entra qui senza ricaricare la pagina. */
  readonly conti = signal<PianoContiCogeDTO[]>(this.data.conti ?? []);

  readonly query = signal('');
  readonly gruppoSel = signal<string | null>(null);
  readonly catSelId = signal<number | null>(null);
  /** Solo ≤560px: true = pannello conti a schermo, false = pannello categorie. */
  readonly drill = signal(false);
  readonly scelto = signal<PianoContiCogeDTO | undefined>(undefined);

  /** Conti foglia (senza figli) ammessi dal filtro tipo. */
  private readonly foglie = computed<PianoContiCogeDTO[]>(() => {
    const conti = this.conti();
    const parents = new Set(conti.map(c => c.parentId).filter((x): x is number => x != null));
    const tf = this.data.tipoFilter;
    const allowed = this.data.allowedIds ? new Set(this.data.allowedIds) : null;
    return conti.filter(c =>
      !parents.has(c.id) && (!tf || tf.includes(c.tipo))
      && (!allowed || allowed.has(c.id) || CREATI_QUI.has(c.id)));
  });

  /** Gruppi VIVI (un gruppo senza conti non si mostra: con allowedIds vuoto non ne resta nessuno). */
  readonly gruppi = computed(() => {
    const n = new Map<string, number>();
    for (const f of this.foglie()) {
      const k = gruppoDi(f.tipo);
      n.set(k, (n.get(k) ?? 0) + 1);
    }
    return GRUPPI.filter(g => n.has(g.key)).map(g => ({ ...g, n: n.get(g.key)! }));
  });

  /**
   * Categorie del gruppo attivo. Un conto radice (senza parent) non finisce in una pseudo-categoria
   * «Altri» condivisa — che ordinata per codice vuoto compariva PRIMA di tutto — ma diventa una voce
   * a sé, ordinata per il proprio codice.
   */
  readonly categorie = computed<Categoria[]>(() => {
    const g = this.gruppoSel();
    const byId = new Map(this.conti().map(c => [c.id, c]));
    const map = new Map<number, Categoria>();
    for (const f of this.foglie()) {
      if (g && gruppoDi(f.tipo) !== g) continue;
      const parent = f.parentId != null ? byId.get(f.parentId) : undefined;
      const key = parent ? parent.id : -f.id;
      let cat = map.get(key);
      if (!cat) {
        const nonno = parent?.parentId != null ? byId.get(parent.parentId) : undefined;
        cat = parent
          ? { id: parent.id, codice: parent.codice, descrizione: parent.nome, padre: nonno?.nome ?? '', tipo: f.tipo, conti: [] }
          : { id: -f.id, codice: f.codice, descrizione: f.nome, padre: '', tipo: f.tipo, conti: [] };
        map.set(key, cat);
      }
      cat.conti.push(f);
    }
    return [...map.values()].sort((a, b) => a.codice.localeCompare(b.codice));
  });

  readonly catSel = computed<Categoria | undefined>(() =>
    this.categorie().find(c => c.id === this.catSelId()));

  /** Ricerca GLOBALE: non guarda il gruppo attivo. */
  readonly risultati = computed<PianoContiCogeDTO[]>(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return [];
    return this.foglie()
      .filter(c => c.nome.toLowerCase().includes(q) || c.codice.toLowerCase().includes(q))
      .slice(0, 60);
  });

  readonly recentiConti = computed<PianoContiCogeDTO[]>(() => {
    const ids = this.data.recents ?? [];
    const ammessi = new Set(this.foglie().map(c => c.id));
    const byId = new Map(this.foglie().map(c => [c.id, c]));
    return ids.filter(id => ammessi.has(id)).map(id => byId.get(id)!).slice(0, 6);
  });

  constructor() {
    // Preseleziona gruppo/categoria/conto correnti.
    const sel = this.data.selectedId;
    const conto = sel != null ? this.foglie().find(c => c.id === sel) : undefined;
    if (conto) this.scelto.set(conto);
    this.gruppoSel.set(conto ? gruppoDi(conto.tipo) : (this.gruppi()[0]?.key ?? null));
    this.catSelId.set(this.categoriaDiPartenza(conto)?.id ?? null);
  }

  /** Prima categoria apribile del gruppo: quella del conto selezionato, altrimenti la prima. */
  private categoriaDiPartenza(conto?: PianoContiCogeDTO): Categoria | undefined {
    const apribili = this.categorie().filter(c => c.conti.length > 1);
    return (conto && apribili.find(c => c.conti.some(x => x.id === conto.id))) ?? apribili[0];
  }

  selGruppo(key: string): void {
    this.gruppoSel.set(key);
    this.drill.set(false);
    this.catSelId.set(this.categoriaDiPartenza()?.id ?? null);
  }

  apriCat(cat: Categoria): void { this.catSelId.set(cat.id); this.drill.set(true); }

  color(tipo: string): string { return TIPO_COLOR[tipo] ?? '#6B7280'; }
  tipoLabel(tipo: string): string { return TIPO_LABEL[tipo] ?? tipo; }

  pathOf(c: PianoContiCogeDTO): string {
    const byId = new Map(this.conti().map(x => [x.id, x]));
    const parent = c.parentId != null ? byId.get(c.parentId) : undefined;
    const gruppo = labelGruppo(gruppoDi(c.tipo));
    return parent ? `${gruppo} › ${parent.nome}` : gruppo;
  }

  /** Solo ADMIN: la POST /api/piano-dei-conti è ADMIN-only (PianoContiCogeResource). */
  readonly puoCreare = computed(() => this.auth.isAdmin());

  creaConto(): void {
    const tf = this.data.tipoFilter;
    const unicoTipo = tf?.length === 1 ? (tf[0] as TipoCoge) : undefined;
    const dati: PianoContiFormData = {
      conti: this.conti(),
      presetTipo: unicoTipo,
      bloccaTipo: unicoTipo != null,   // fuori dal filtro il conto nuovo non sarebbe selezionabile qui
    };
    this.dialog
      .open(PianoContiFormDialogComponent, { data: dati, width: '460px', panelClass: 'pc-dialog-panel', autoFocus: 'first-tabbable' })
      .afterClosed()
      .subscribe((creato: PianoContiCogeDTO | boolean | undefined) => {
        if (!creato || typeof creato === 'boolean') return;   // annullato
        this.conti.update(list => [...list, creato]);
        CREATI_QUI.add(creato.id);
        // Porta l'utente sul conto appena creato, già selezionato: manca solo Conferma.
        this.query.set('');
        this.gruppoSel.set(gruppoDi(creato.tipo));
        this.catSelId.set(this.categorie().find(c => c.conti.some(x => x.id === creato.id))?.id ?? null);
        this.drill.set(true);
        this.scelto.set(creato);
      });
  }

  scegli(c: PianoContiCogeDTO): void { this.scelto.set(c); }
  conferma(): void { if (this.scelto()) this.ref.close(this.scelto()); }
  annulla(): void { this.ref.close(undefined); }
  rimuovi(): void { this.ref.close(null); }
}
