import { Component, OnInit, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { CogePickerComponent } from '../../shared/components/coge-picker/coge-picker.component';

import { MovimentiService } from '../../core/services/movimenti.service';
import { LookupService } from '../../core/services/lookup.service';
import { BuService } from '../../core/services/bu.service';
import { FornitoriService } from '../../core/services/fornitori.service';
import { KeywordFirmaDTO, KeywordConflittoDTO } from '../../core/models/movimenti.models';
import { PianoContiCogeDTO, BusinessUnitDTO, FornitoreSummaryDTO } from '../../core/models/anagrafica.models';
import { KeywordVisual, keywordVisual, tipoMovLabel } from './keyword-visual';
import { KeywordCreateWizardComponent } from './keyword-create-wizard.component';

@Component({
  selector: 'app-keyword-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet, FormsModule, MatCardModule, MatTabsModule, MatButtonModule, MatIconModule,
    MatChipsModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatTooltipModule,
    MatDialogModule, MatSelectModule, CogePickerComponent,
  ],
  templateUrl: './keyword-page.component.html',
  styleUrls: ['./keyword-page.component.scss'],
})
export class KeywordPageComponent implements OnInit {
  private readonly movimentiService = inject(MovimentiService);
  private readonly lookupService = inject(LookupService);
  private readonly buService = inject(BuService);
  private readonly fornitoriService = inject(FornitoriService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  loading = signal(true);
  firme = signal<KeywordFirmaDTO[]>([]);
  conflitti = signal<KeywordConflittoDTO[]>([]);
  filtro = signal('');

  coge = signal<PianoContiCogeDTO[]>([]);
  bu = signal<BusinessUnitDTO[]>([]);
  fornitori = signal<FornitoreSummaryDTO[]>([]);

  // Conflitti MATCH ("In import"): firme colpevoli caricate on-demand + pannello "come funziona".
  comeFunziona = signal(false);
  espanso = signal<string | null>(null);                       // id conflitto espanso
  firmeMatch = signal<Record<string, KeywordFirmaDTO[]>>({});  // id conflitto → firme in conflitto
  // Edit inline del target di una firma colpevole (una alla volta).
  editId = signal<string | null>(null);
  editBu = signal<number | null>(null);
  editCoge = signal<string | null>(null);

  private filtra(list: KeywordFirmaDTO[]): KeywordFirmaDTO[] {
    const q = this.filtro().trim().toUpperCase();
    if (!q) return list;
    return list.filter(f => f.token.some(t => t.includes(q)) || (f.cogeCodice ?? '').includes(q));
  }

  identita = computed(() => this.filtra(this.firme().filter(f => f.natura === 'IDENTITA')));
  dominio = computed(() => this.filtra(this.firme().filter(f => f.natura === 'DOMINIO')));

  ngOnInit(): void {
    this.carica();
  }

  private carica(): void {
    forkJoin({
      firme: this.movimentiService.getKeyword(),
      conflitti: this.movimentiService.getKeywordConflitti('APERTO'),
      coge: this.lookupService.getPianoConti(),
      bu: this.buService.getAll(),
      fornitori: this.fornitoriService.getList({ size: 300 }),
    }).subscribe({
      next: ({ firme, conflitti, coge, bu, fornitori }) => {
        this.firme.set(firme);
        this.conflitti.set(conflitti);
        this.coge.set(coge);
        this.bu.set(bu);
        this.fornitori.set(fornitori.content);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.snackBar.open('Errore nel caricamento keyword', 'OK', { duration: 4000 }); },
    });
  }

  visual(f: KeywordFirmaDTO): KeywordVisual {
    return keywordVisual(f.natura, f.azione);
  }

  /** Frase in italiano: cosa fa concretamente la keyword (per la card). */
  frase(f: KeywordFirmaDTO): string {
    const tk = f.token.join(' + ');
    const quando = `Quando una riga ${tipoMovLabel(f.tipoMovimento)} contiene «${tk}»`;
    if (f.azione === 'PARK_EVENTO') {
      return `${quando} → la metto in attesa di riconciliazione (evento, nessun movimento).`;
    }
    const cogeTxt = this.cogeNome(f.cogeCodice);
    const buTxt = this.buNome(f.buId);
    if (f.natura === 'IDENTITA') {
      const forn = f.fornitoreId ? `, fornitore ${this.fornitoreNome(f.fornitoreId)}` : '';
      return `${quando} → la registro su ${cogeTxt} (${buTxt})${forn}.`;
    }
    return `${quando} → la registro su ${cogeTxt} (${buTxt}), senza fornitore.`;
  }

  buNome(id: number | null): string {
    return id == null ? '—' : (this.bu().find(b => b.id === id)?.nome ?? `BU${id}`);
  }
  cogeNome(codice: string | null): string {
    if (!codice) return '—';
    const c = this.coge().find(x => x.codice === codice);
    return c ? `${c.codice} ${c.nome}` : codice;
  }
  fornitoreNome(id: string | null): string {
    return id ? (this.fornitori().find(f => f.id === id)?.ragioneSociale ?? '—') : '—';
  }

  apriWizard(): void {
    this.dialog.open(KeywordCreateWizardComponent, {
      data: { coge: this.coge(), bu: this.bu(), fornitori: this.fornitori() },
      width: '720px', maxWidth: '95vw', autoFocus: false,
    }).afterClosed().subscribe(creato => { if (creato) this.carica(); });
  }

  eliminaFirma(f: KeywordFirmaDTO): void {
    if (!f.id) return;
    this.movimentiService.deleteKeyword(f.id).subscribe({
      next: () => { this.firme.update(rs => rs.filter(r => r.id !== f.id)); this.snackBar.open('Keyword eliminata', 'OK', { duration: 2000 }); },
      error: err => this.snackBar.open(err.error?.message ?? 'Eliminazione non riuscita', 'OK', { duration: 4000 }),
    });
  }

  toggleStato(f: KeywordFirmaDTO): void {
    if (!f.id) return;
    const nuovo = f.stato === 'DISATTIVATA' ? 'ATTIVA' : 'DISATTIVATA';
    this.movimentiService.updateKeyword(f.id, { ...f, stato: nuovo }).subscribe({
      next: () => this.firme.update(rs => rs.map(r => r.id === f.id ? { ...r, stato: nuovo } : r)),
      error: err => this.snackBar.open(err.error?.message ?? 'Aggiornamento non riuscito', 'OK', { duration: 4000 }),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ⛔ TEMPORANEO — GO-LIVE 2026-08-05. DA CANCELLARE dopo il reset.
  // Rimuovere: questo blocco + il blocco `.golive` in .html e .scss.
  // Non tocca le keyword (firme, token, regole): archivia solo gli AVVISI di conflitto
  // rimasti aperti, che dopo il rollback puntano a movimenti non più esistenti.
  // Riusa l'endpoint per-conflitto già esistente: nessuna API nuova.
  // ═══════════════════════════════════════════════════════════════════════════
  readonly goliveBusy = signal(false);
  readonly goliveEsito = signal<string | null>(null);

  goliveSistemaConflitti(): void {
    const aperti = this.conflitti();
    if (!aperti.length) { this.goliveEsito.set('Nessun conflitto aperto: non c\'è niente da sistemare.'); return; }
    if (!confirm(`Archiviare ${aperti.length} conflitti keyword aperti?\n\nLe keyword NON vengono toccate: si chiudono solo gli avvisi.`)) return;

    this.goliveBusy.set(true);
    this.goliveEsito.set(null);
    let ok = 0; let ko = 0;
    const next = (i: number): void => {
      if (i >= aperti.length) {
        this.goliveBusy.set(false);
        this.goliveEsito.set(`Archiviati ${ok} conflitti${ko ? `, ${ko} falliti` : ''}.`);
        this.carica();
        return;
      }
      this.movimentiService.risolviKeywordConflitto(aperti[i].id, { azione: 'SCARTA', note: 'Go-live 2026-08-05' })
        .subscribe({
          next: () => { ok++; next(i + 1); },
          error: () => { ko++; next(i + 1); },   // si prosegue: un fallimento non blocca gli altri
        });
    };
    next(0);
  }
  // ═══════════════════ fine blocco temporaneo ═══════════════════

  risolvi(c: KeywordConflittoDTO, azione: 'TIENI_ESISTENTE' | 'USA_NUOVO' | 'SCARTA'): void {
    this.movimentiService.risolviKeywordConflitto(c.id, { azione, note: null }).subscribe({
      next: () => { this.conflitti.update(cs => cs.filter(x => x.id !== c.id)); this.carica(); this.snackBar.open('Conflitto risolto', 'OK', { duration: 2000 }); },
      error: err => this.snackBar.open(err.error?.message ?? 'Risoluzione non riuscita', 'OK', { duration: 4000 }),
    });
  }

  // ── Conflitti MATCH: mostra e sistema le firme colpevoli ────────────────────────────

  /** Firme colpevoli del conflitto espanso (o []). */
  firmeDi(c: KeywordConflittoDTO): KeywordFirmaDTO[] {
    return this.firmeMatch()[c.id] ?? [];
  }

  espandi(c: KeywordConflittoDTO): void {
    if (this.espanso() === c.id) { this.espanso.set(null); return; }
    this.espanso.set(c.id);
    if (this.firmeMatch()[c.id]) return; // già caricate
    this.ricaricaFirme(c.id);
  }

  private ricaricaFirme(cId: string): void {
    this.movimentiService.getKeywordConflittoFirme(cId).subscribe({
      next: fs => this.firmeMatch.update(m => ({ ...m, [cId]: fs })),
      error: () => this.snackBar.open('Errore nel caricamento delle keyword in conflitto', 'OK', { duration: 4000 }),
    });
  }

  iniziaModifica(f: KeywordFirmaDTO): void {
    this.editId.set(f.id); this.editBu.set(f.buId); this.editCoge.set(f.cogeCodice);
  }
  annullaModifica(): void { this.editId.set(null); }
  setEditCoge(c: PianoContiCogeDTO | null): void { this.editCoge.set(c?.codice ?? null); }

  salvaModifica(cId: string, f: KeywordFirmaDTO): void {
    if (!f.id || this.editBu() == null || !this.editCoge()) {
      this.snackBar.open('Scegli BU e conto prima di salvare', 'OK', { duration: 3000 }); return;
    }
    const upd = { ...f, buId: this.editBu(), cogeCodice: this.editCoge() };
    this.movimentiService.updateKeyword(f.id, upd).subscribe({
      next: () => { this.editId.set(null); this.rivalutaEricarica(cId, 'Target aggiornato'); },
      error: err => this.snackBar.open(err.error?.message ?? 'Aggiornamento non riuscito', 'OK', { duration: 4000 }),
    });
  }

  disattivaFirma(cId: string, f: KeywordFirmaDTO): void {
    if (!f.id) return;
    this.movimentiService.updateKeyword(f.id, { ...f, stato: 'DISATTIVATA' }).subscribe({
      next: () => this.rivalutaEricarica(cId, 'Keyword disattivata'),
      error: err => this.snackBar.open(err.error?.message ?? 'Operazione non riuscita', 'OK', { duration: 4000 }),
    });
  }

  eliminaFirmaConflitto(cId: string, f: KeywordFirmaDTO): void {
    if (!f.id) return;
    this.movimentiService.deleteKeyword(f.id).subscribe({
      next: () => this.rivalutaEricarica(cId, 'Keyword eliminata'),
      error: err => this.snackBar.open(err.error?.message ?? 'Eliminazione non riuscita', 'OK', { duration: 4000 }),
    });
  }

  /** Dopo un'azione sulle firme colpevoli: il server auto-chiude i conflitti risolti e cataloga i
   *  movimenti incastrati; poi ricarico lista e contatore. */
  private rivalutaEricarica(cId: string, msg: string): void {
    this.movimentiService.rivalutaKeywordConflitti().subscribe({
      next: es => {
        this.ricaricaFirme(cId); this.carica();
        const parti = [msg];
        if (es.chiusi > 0) parti.push('conflitto risolto');
        if (es.catalogati > 0) parti.push(`${es.catalogati} movimento/i catalogato/i`);
        this.snackBar.open(parti.join(' · '), 'OK', { duration: 3000 });
      },
      error: () => { this.ricaricaFirme(cId); this.carica(); },
    });
  }
}
