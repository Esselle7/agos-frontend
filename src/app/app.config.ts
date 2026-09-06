import { ApplicationConfig, provideZoneChangeDetection, LOCALE_ID, DEFAULT_CURRENCY_CODE } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeIt from '@angular/common/locales/it';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DATE_LOCALE, DateAdapter, MAT_DATE_FORMATS, MAT_NATIVE_DATE_FORMATS } from '@angular/material/core';
import { ItDateAdapter } from './shared/it-date-adapter';

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
    provideCharts(withDefaultRegisterables()),
    { provide: LOCALE_ID, useValue: 'it-IT' },
    { provide: DEFAULT_CURRENCY_CODE, useValue: 'EUR' },
    // Il datepicker Material ha la sua locale: senza, il calendario resta en-US.
    { provide: MAT_DATE_LOCALE, useValue: 'it-IT' },
    // MAT_DATE_LOCALE però NON tocca il parsing di una data DIGITATA: `parse()` del
    // NativeDateAdapter usa Date.parse(), cioè MM/DD/YYYY. Vedi ItDateAdapter.
    { provide: DateAdapter, useClass: ItDateAdapter, deps: [MAT_DATE_LOCALE] },
    { provide: MAT_DATE_FORMATS, useValue: MAT_NATIVE_DATE_FORMATS },
  ],
};
