import { ApplicationConfig, provideZoneChangeDetection, LOCALE_ID, DEFAULT_CURRENCY_CODE } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeIt from '@angular/common/locales/it';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideNativeDateAdapter, MAT_DATE_LOCALE } from '@angular/material/core';

// Senza questa registrazione i pipe `date` e `currency` girano in en-US: le date si leggevano
// "1 July 2026" e gli importi "€250.00". L'app è di un'azienda italiana — la locale è una sola,
// dichiarata qui, non ricopiata a mano in ogni componente con Intl.NumberFormat.
registerLocaleData(localeIt);
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { routes } from './app.routes';
import { jwtInterceptor } from './core/auth/jwt.interceptor';
import { dataRefreshInterceptor } from './core/services/data-refresh.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([jwtInterceptor, dataRefreshInterceptor])),
    provideAnimationsAsync(),
    provideNativeDateAdapter(),
    provideCharts(withDefaultRegisterables()),
    { provide: LOCALE_ID, useValue: 'it-IT' },
    { provide: DEFAULT_CURRENCY_CODE, useValue: 'EUR' },
    // Il datepicker Material ha la sua locale: senza, calendario e parsing restano en-US.
    { provide: MAT_DATE_LOCALE, useValue: 'it-IT' },
  ],
};
