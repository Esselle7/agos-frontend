import { Routes } from '@angular/router';
import { ImportShellComponent } from './import-shell.component';

export const importRoutes: Routes = [
  {
    path: '',
    component: ImportShellComponent,
    children: [
      { path: '', redirectTo: 'bulk', pathMatch: 'full' },
      {
        path: 'bulk',
        loadComponent: () => import('./import-bulk.component').then(m => m.ImportBulkComponent),
      },
      {
        path: 'storico',
        loadComponent: () => import('./import-storico.component').then(m => m.ImportStoricoComponent),
      },
      {
        // Wizard «Che spesa è questa?» (audit §7.1): sostituisce la griglia di catalogazione,
        // assorbe Effetti/RiBa (§7.7) e la scelta del ramo (§7.5, ex pagina /import/bu).
        path: 'catalogare',
        loadComponent: () => import('./spese-wizard.component').then(m => m.SpeseWizardComponent),
      },
      {
        // Wizard «Di chi è questo incasso?» (audit §7.2): sostituisce la griglia degli incassi
        // parcheggiati. La logica di riconoscimento NON cambia, cambia il modo di lavorarla.
        path: 'incassi-evento',
        loadComponent: () =>
          import('./incassi-evento-wizard.component').then(m => m.IncassiEventoWizardComponent),
      },
      {
        // Wizard «Questa rata di cosa?» (audit §7.3): la proposta di RataMatcher a schermo,
        // col perché in chiaro — evidenziata, mai applicata.
        path: 'rate',
        loadComponent: () => import('./rate-wizard.component').then(m => m.RateWizardComponent),
      },
      {
        // Coda «Righe fuori dai conti»: righe bancarie escluse dalla pipeline (audit §7.4)
        path: 'scartati',
        loadComponent: () =>
          import('./scartati-panel.component').then(m => m.ScartatiPanelComponent),
      },
      { path: 'smistamento', redirectTo: 'catalogare', pathMatch: 'full' },
      // I vecchi link restano vivi: entrambe le code sono confluite nel wizard.
      { path: 'smistamento/catalogare', redirectTo: 'catalogare', pathMatch: 'full' },
      { path: 'smistamento/riba', redirectTo: 'catalogare', pathMatch: 'full' },
      { path: 'smistamento/eventi', redirectTo: 'incassi-evento', pathMatch: 'full' },
      { path: 'smistamento/ricorrenti', redirectTo: 'rate', pathMatch: 'full' },
      // La quadratura POS è passata sotto Report (audit §7.7): il vecchio link ci porta.
      { path: 'quadratura', redirectTo: '/reporting', pathMatch: 'full' },
      { path: 'bu', redirectTo: 'catalogare', pathMatch: 'full' },
      {
        // riusa il motore di smistamento (ex dialog) come componente di pagina, una sezione per rotta
        path: 'smistamento/:sezione',
        loadComponent: () =>
          import('../movimenti/import-triage-dialog.component').then(m => m.ImportTriageDialogComponent),
      },
    ],
  },
];
