import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { noAuthGuard } from './core/auth/no-auth.guard';
import { roleGuard } from './core/auth/role.guard';
import { AuthCallbackComponent } from './core/auth/auth-callback.component';
import { AppShellComponent } from './layout/shell/app-shell.component';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login.component').then(m => m.LoginComponent),
    canActivate: [noAuthGuard],
  },
  {
    path: 'oauth/callback',
    component: AuthCallbackComponent,
  },
  {
    // Guida a tutto schermo: fuori dall'AppShell (niente sidebar dell'app), solo autenticato.
    path: 'guida',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/guida/guida.component').then(m => m.GuidaComponent),
  },
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard-router.component').then(
            m => m.DashboardRouterComponent
          ),
      },
      {
        path: 'movimenti',
        loadChildren: () =>
          import('./features/movimenti/movimenti.routes').then(
            m => m.movimentiRoutes
          ),
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
      },
      // Cassa temporaneamente disabilitata: rotta rimossa così /cassa ricade nel
      // redirect wildcard verso /dashboard. Codice del componente mantenuto.
      // {
      //   path: 'cassa',
      //   loadComponent: () =>
      //     import('./features/cassa/cassa.component').then(
      //       m => m.CassaComponent
      //     ),
      //   canActivate: [roleGuard],
      //   data: { roles: ['ADMIN'] },
      // },
      {
        path: 'spese-ricorrenti',
        loadChildren: () =>
          import('./features/spese-ricorrenti/spese-ricorrenti.routes').then(
            m => m.speseRicorrentiRoutes
          ),
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
      },
      {
        path: 'libro-cespiti',
        loadComponent: () =>
          import('./features/libro-cespiti/libro-cespiti.component').then(
            m => m.LibroCespitiComponent
          ),
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
      },
      {
        path: 'import',
        loadChildren: () =>
          import('./features/import/import.routes').then(m => m.importRoutes),
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
      },
      {
        path: 'keyword',
        loadComponent: () =>
          import('./features/keyword/keyword-page.component').then(
            m => m.KeywordPageComponent
          ),
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
      },
      {
        path: 'piano-conti',
        loadComponent: () =>
          import('./features/piano-conti/piano-conti.component').then(
            m => m.PianoContiComponent
          ),
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
      },
      {
        path: 'situazione-iniziale',
        loadComponent: () =>
          import('./features/situazione-iniziale/situazione-iniziale.component').then(
            m => m.SituazioneInizialeComponent
          ),
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
      },
      {
        path: 'forecasting',
        loadComponent: () =>
          import('./features/reporting/forecasting.component').then(
            m => m.ForecastingComponent
          ),
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
      },
      {
        path: 'scadenzario',
        loadComponent: () =>
          import('./features/scadenzario/scadenzario.component').then(
            m => m.ScadenzarioComponent
          ),
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
      },
      {
        path: 'export',
        loadComponent: () =>
          import('./features/export/export.component').then(
            m => m.ExportComponent
          ),
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
      },
      {
        path: 'eventi',
        loadChildren: () =>
          import('./features/eventi/eventi.routes').then(
            m => m.eventiRoutes
          ),
      },
      {
        path: 'bu/:buId',
        loadComponent: () =>
          import('./features/bu/bu.component').then(m => m.BuComponent),
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
      },
      {
        path: 'reporting',
        loadComponent: () =>
          import('./features/reporting/reporting.component').then(
            m => m.ReportingComponent
          ),
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
      },
      {
        path: 'anagrafica',
        loadChildren: () =>
          import('./features/anagrafica/anagrafica.routes').then(
            m => m.anagraficaRoutes
          ),
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
      },
      { path: '**', redirectTo: 'dashboard' },
    ],
  },
];
