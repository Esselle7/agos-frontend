import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, Output,
  computed, inject, signal, OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ContiService } from '../../core/services/conti.service';
import { BuService } from '../../core/services/bu.service';
import { LookupService } from '../../core/services/lookup.service';
import { PianoContiService } from '../../core/services/piano-conti.service';
import { FornitoriService } from '../../core/services/fornitori.service';
import { EventiService } from '../../core/services/eventi.service';
import { CategorieService } from '../../core/services/categorie.service';
import {
  BusinessUnitDTO, ContoBancarioDTO, MetodoPagamentoDTO,
  PianoContiCogeDTO, FornitoreSummaryDTO, CategoriaNode,
} from '../../core/models/anagrafica.models';
import { DateField } from '../../core/services/movimenti.service';
import {
  CONTO_SENZA_BANCA, DATE_FIELD_HINT, DATE_FIELD_LABEL, FONTI, STATI,
  EtichetteFiltri, MovimentiFiltri, chiaveEtichetta,
  cloneFiltri, contaFiltriAttivi, filtriVuoti,
} from './movimenti-filtri.model';

interface EventoOpzione { id: string; label: string; }

/** Cosa esce dal pannello: i filtri scelti + le etichette leggibili dei valori selezionati. */
export interface FiltriApplicati {
  filtri: MovimentiFiltri;
  etichette: EtichetteFiltri;
}

/**
 * Pannello laterale dei filtri avanzati (docs/specs/movimenti-filtri-avanzati.md).
 *
 * Drawer e non modale: filtrare è un'attività di confronto, e un dialog che oscura la tabella
 * nasconde proprio ciò che stai cercando di restringere. Su desktop resta a fianco della lista
 * senza scrim; sotto i 768px diventa a tutta larghezza con scrim, perché lì lo spazio non c'è.
 *
 * Lavora su una BOZZA (`draft`): finché non premi «Applica» la lista non si muove. Così puoi
 * comporre un filtro complesso in pace senza far ripartire una query a ogni spunta.
 */
@Component({
  selector: 'app-movimenti-filtri-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatDatepickerModule, MatNativeDateModule, MatTooltipModule,
  ],
  templateUrl: './movimenti-filtri-panel.component.html',
  styleUrls: ['./movimenti-filtri-panel.component.scss'],
})
export class MovimentiFiltriPanelComponent implements OnInit {

  private readonly contiService = inject(ContiService);
  private readonly buService = inject(BuService);
  private readonly lookupService = inject(LookupService);
  private readonly pianoContiService = inject(PianoContiService);
  private readonly fornitoriService = inject(FornitoriService);
  private readonly eventiService = inject(EventiService);
  private readonly categorieService = inject(CategorieService);

  /** Filtri applicati: entrando nel pannello diventano la bozza da modificare. */
  @Input() set filtri(value: MovimentiFiltri) {
    this.draft.set(cloneFiltri(value));
  }
  @Output() applica = new EventEmitter<FiltriApplicati>();
  @Output() chiudi = new EventEmitter<void>();

  readonly draft = signal<MovimentiFiltri>(filtriVuoti());
  readonly conteggio = computed(() => contaFiltriAttivi(this.draft()));

  // ── Dati di lookup ────────────────────────────────────────────────────────
  readonly conti = signal<ContoBancarioDTO[]>([]);
  readonly bus = signal<BusinessUnitDTO[]>([]);
  readonly coge = signal<PianoContiCogeDTO[]>([]);
  readonly metodi = signal<MetodoPagamentoDTO[]>([]);
  readonly fornitori = signal<FornitoreSummaryDTO[]>([]);
  readonly eventi = signal<EventoOpzione[]>([]);
  readonly categorie = signal<CategoriaNode[]>([]);

  readonly fonti = FONTI;
  readonly stati = STATI;
  readonly dateFields: DateField[] = ['MOVIMENTO', 'FINANZIARIA', 'LIQUIDITA'];
  readonly dateFieldLabel = DATE_FIELD_LABEL;
  readonly dateFieldHint = DATE_FIELD_HINT;
  readonly SENZA_BANCA = CONTO_SENZA_BANCA;

  /**
   * Testo di ricerca dentro il piano dei conti: 164 voci sono troppe da scorrere a mano.
   * È un signal e non un FormControl di proposito — un computed che legge FormControl.value
   * non si aggiorna e il filtro resterebbe congelato (trappola già vista nel progetto).
   */
  readonly cogeQuery = signal('');

  readonly cogeFiltrati = computed(() => {
    const q = this.cogeQuery().trim().toLowerCase();
    const tutti = this.coge();
    if (!q) return tutti;
    return tutti.filter(c =>
      c.codice.toLowerCase().includes(q) || c.nome.toLowerCase().includes(q));
  });

  /**
   * Le categorie esistono per business unit: senza una BU scelta l'elenco non è definito.
   * Invece di mostrare un controllo che non può funzionare, lo si spiega (Least Astonishment).
   */
  readonly buSingolaSelezionata = computed(() => {
    const ids = this.draft().buId;
    return ids.length === 1 ? ids[0] : null;
  });

  ngOnInit(): void {
    this.contiService.getAll().subscribe(v => this.conti.set(v));
    this.buService.getAll().subscribe(v => this.bus.set(v));
    this.pianoContiService.list().subscribe(v => this.coge.set(v));
    this.lookupService.getMetodiPagamento().subscribe(v => this.metodi.set(v));
    // Elenchi interi in una tendina: oggi sono 21 fornitori e 58 eventi, quindi ci stanno.
    // ponytail: se un giorno superano il centinaio serve una ricerca server-side, non una tendina più lunga.
    this.fornitoriService.getList({ size: 200 }).subscribe(p => this.fornitori.set(p.content));
    this.eventiService.getList({ size: 200 }).subscribe(p => this.eventi.set(
      p.content.map(e => ({ id: e.id, label: this.etichettaEvento(e) })),
    ));
  }

  private etichettaEvento(e: { nome: string | null; dataEvento: string | null; id: string }): string {
    const nome = e.nome?.trim() || 'Evento senza nome';
    return e.dataEvento ? `${nome} — ${this.formatDate(e.dataEvento)}` : nome;
  }

  // ── Mutazioni della bozza ─────────────────────────────────────────────────

  /** Aggiunge/rimuove un valore da una dimensione multi-valore. */
  toggle<K extends keyof MovimentiFiltri>(dim: K, value: MovimentiFiltri[K] extends (infer T)[] ? T : never): void {
    this.draft.update(f => {
      const arr = f[dim] as unknown[];
      const next = arr.includes(value)
        ? arr.filter(v => v !== value)
        : [...arr, value];
      return { ...f, [dim]: next } as MovimentiFiltri;
    });
    if (dim === 'buId') this.onBuCambiata();
  }

  isSelected<K extends keyof MovimentiFiltri>(dim: K, value: unknown): boolean {
    return (this.draft()[dim] as unknown[]).includes(value);
  }

  /** Le categorie dipendono dalla BU: cambiata la BU, quelle scelte non sono più valide. */
  private onBuCambiata(): void {
    const buId = this.buSingolaSelezionata();
    this.draft.update(f => ({ ...f, categoriaId: [] }));
    this.categorie.set([]);
    if (buId != null) {
      this.categorieService.getAlbero(buId).subscribe(nodes => this.categorie.set(this.appiattisci(nodes)));
    }
  }

  private appiattisci(nodes: CategoriaNode[]): CategoriaNode[] {
    return nodes.flatMap(n => [n, ...this.appiattisci(n.sottocategorie ?? [])]);
  }

  setMulti(dim: keyof MovimentiFiltri, values: unknown[]): void {
    this.draft.update(f => ({ ...f, [dim]: values } as MovimentiFiltri));
  }

  setDateField(v: DateField): void {
    this.draft.update(f => ({ ...f, dateField: v }));
  }

  setImporto(campo: 'importoMin' | 'importoMax', raw: string): void {
    const n = raw.trim() === '' ? null : Number(raw.replace(',', '.'));
    this.draft.update(f => ({ ...f, [campo]: n != null && Number.isFinite(n) ? n : null }));
  }

  setData(campo: 'from' | 'to', d: Date | null): void {
    this.draft.update(f => ({ ...f, [campo]: d ? this.toIso(d) : null }));
  }

  dataAsDate(campo: 'from' | 'to'): Date | null {
    const v = this.draft()[campo];
    return v ? new Date(v) : null;
  }

  setSearch(v: string): void {
    this.draft.update(f => ({ ...f, search: v }));
  }

  azzera(): void {
    this.draft.set(filtriVuoti());
    this.categorie.set([]);
    this.cogeQuery.set('');
  }

  conferma(): void {
    this.applica.emit({ filtri: cloneFiltri(this.draft()), etichette: this.etichette() });
  }

  /**
   * Etichette leggibili dei soli valori selezionati. Gli elenchi completi sono già qui per le
   * tendine: passarne un estratto alla lista le evita di ricaricarli solo per scrivere le chip.
   */
  private etichette(): EtichetteFiltri {
    const f = this.draft();
    const out: EtichetteFiltri = {};
    const put = (dim: Parameters<typeof chiaveEtichetta>[0], v: string | number, label: string) => {
      out[chiaveEtichetta(dim, v)] = label;
    };

    for (const id of f.contoId) put('contoId', id, this.nomeConto(id));
    for (const t of f.tipo) put('tipo', t, t === 'ENTRATA' ? 'Entrate' : 'Uscite');
    for (const s of f.stato) put('stato', s, this.stati.find(x => x.value === s)?.label ?? s);
    for (const s of f.fonte) put('fonte', s, this.fonti.find(x => x.value === s)?.label ?? s);
    for (const id of f.buId) put('buId', id, this.bus().find(b => b.id === id)?.nome ?? `BU#${id}`);
    for (const id of f.cogeId) {
      const c = this.coge().find(x => x.id === id);
      put('cogeId', id, c ? `${c.codice} ${c.nome}` : `Conto #${id}`);
    }
    for (const id of f.metodoPagamentoId) {
      put('metodoPagamentoId', id, this.metodi().find(m => m.id === id)?.descrizione ?? `Metodo #${id}`);
    }
    for (const id of f.fornitoreId) {
      put('fornitoreId', id, this.fornitori().find(x => x.id === id)?.ragioneSociale ?? 'Fornitore');
    }
    for (const id of f.eventoId) {
      put('eventoId', id, this.eventi().find(x => x.id === id)?.label ?? 'Evento');
    }
    for (const id of f.categoriaId) {
      put('categoriaId', id, this.categorie().find(c => c.id === id)?.nome ?? `Categoria #${id}`);
    }
    return out;
  }

  // ── Etichette ─────────────────────────────────────────────────────────────

  nomeConto(id: number): string {
    if (id === CONTO_SENZA_BANCA) return 'Senza banca';
    return this.conti().find(c => c.id === id)?.nome ?? `Conto #${id}`;
  }

  formatDate(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  private toIso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
