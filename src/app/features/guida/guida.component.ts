import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { marked } from 'marked';

interface GuideItem {
  title: string;
  icon: string;
  file: string;
}
interface GuideSection {
  label: string;
  items: GuideItem[];
}

/**
 * Ordine e raggruppamento rispecchiano l'indice del README del manuale e le aree del menu
 * del gestionale (i nomi-file non sono in ordine di lettura, l'ordine è qui).
 */
const SECTIONS: GuideSection[] = [
  {
    label: 'Introduzione',
    items: [
      { title: 'Benvenuto / Indice', icon: 'menu_book', file: 'README.md' },
      { title: 'Capire il gestionale', icon: 'school', file: '01-capire-il-gestionale.md' },
    ],
  },
  {
    label: 'Panoramica',
    items: [
      { title: 'Dashboard', icon: 'dashboard', file: '02-dashboard.md' },
      { title: 'Scadenzario', icon: 'event_upcoming', file: '13-scadenzario.md' },
    ],
  },
  {
    label: 'Contabilità',
    items: [
      { title: 'Movimenti', icon: 'receipt_long', file: '03-movimenti.md' },
      { title: 'Import & smistamento', icon: 'move_to_inbox', file: '06-import-e-smistamento.md' },
      { title: 'Spese ricorrenti', icon: 'event_repeat', file: '05-spese-ricorrenti.md' },
      { title: 'Libro cespiti', icon: 'inventory_2', file: '16-libro-cespiti.md' },
    ],
  },
  {
    label: 'Gestione',
    items: [
      { title: 'Eventi', icon: 'celebration', file: '04-eventi.md' },
      { title: 'Situazione iniziale', icon: 'savings', file: '12-situazione-iniziale.md' },
      { title: 'Anagrafica', icon: 'groups', file: '08-anagrafica.md' },
      { title: 'Keyword', icon: 'label', file: '07-keyword.md' },
      { title: 'Piano dei conti', icon: 'account_tree', file: '14-piano-conti.md' },
    ],
  },
  {
    label: 'Analisi',
    items: [
      { title: 'Reporting e Previsioni', icon: 'assessment', file: '09-reporting-e-previsioni.md' },
    ],
  },
  {
    label: 'Export',
    items: [
      { title: 'Export', icon: 'ios_share', file: '15-export.md' },
    ],
  },
  {
    label: 'Riferimento',
    items: [
      { title: 'Appendice — Cassa', icon: 'account_balance_wallet', file: '10-appendice-cassa.md' },
      { title: 'Glossario', icon: 'spellcheck', file: '11-glossario.md' },
    ],
  },
];

const HOME = 'README.md';

/** Slug stile GitHub: minuscolo, via la punteggiatura, spazi → trattini. */
function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // toglie gli accenti (è → e) per combaciare con le ancore ASCII
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

@Component({
  selector: 'app-guida',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule],
  templateUrl: './guida.component.html',
  styleUrl: './guida.component.scss',
})
export class GuidaComponent {
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);

  readonly sections = SECTIONS;
  readonly currentFile = signal<string>(HOME);
  readonly html = signal<SafeHtml | string>('');
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly menuOpen = signal(false); // sidebar mobile

  private readonly scrollEl = viewChild<ElementRef<HTMLElement>>('scroll');

  constructor() {
    this.load(HOME);
  }

  isActive(file: string): boolean {
    return this.currentFile() === file;
  }

  select(file: string): void {
    this.menuOpen.set(false);
    if (file === this.currentFile()) {
      this.scrollTo(null);
      return;
    }
    this.load(file);
  }

  private load(file: string, anchor: string | null = null): void {
    this.currentFile.set(file);
    this.loading.set(true);
    this.error.set(false);
    this.http.get(`assets/manuale/${file}`, { responseType: 'text' }).subscribe({
      next: md => {
        this.html.set(this.render(md));
        this.loading.set(false);
        // attende il render del [innerHTML] prima di scrollare all'ancora/cima
        setTimeout(() => this.scrollTo(anchor), 0);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(true);
      },
    });
  }

  /** Markdown → HTML con id sui titoli (per le ancore) e sanitizzato. */
  private render(md: string): SafeHtml {
    const raw = marked.parse(md, { async: false }) as string;
    const withIds = raw.replace(
      /<h([1-6])>([\s\S]*?)<\/h\1>/g,
      (_m, lvl, inner) => `<h${lvl} id="${slugify(inner.replace(/<[^>]+>/g, ''))}">${inner}</h${lvl}>`
    );
    return this.sanitizer.bypassSecurityTrustHtml(withIds);
  }

  /**
   * Intercetta i click sui link del manuale renderizzato: i link a `*.md` e le ancore `#…`
   * restano dentro la guida (niente ricaricamento di pagina / 404). I link esterni passano.
   */
  onContentClick(ev: MouseEvent): void {
    const a = (ev.target as HTMLElement).closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;

    if (href.startsWith('#')) {
      ev.preventDefault();
      this.scrollTo(href.slice(1));
      return;
    }
    if (/^https?:\/\//.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      return; // naviga normalmente in una nuova scheda
    }
    const match = href.match(/^([^#]+\.md)(?:#(.*))?$/);
    if (match) {
      ev.preventDefault();
      const [, file, anchor] = match;
      if (file === this.currentFile()) {
        this.scrollTo(anchor ?? null);
      } else {
        this.load(file, anchor ?? null);
      }
    }
  }

  private scrollTo(anchor: string | null): void {
    const host = this.scrollEl()?.nativeElement;
    if (!host) return;
    if (anchor) {
      const target = host.querySelector(`#${CSS.escape(anchor)}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    host.scrollTo({ top: 0, behavior: 'auto' });
  }
}
