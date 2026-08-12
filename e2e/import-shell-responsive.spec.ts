import { test, expect, Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'fs';
import { createSign } from 'crypto';
import * as path from 'path';

// Regressione responsive dello shell Import (import-shell.component.scss).
// Difetto storico: `&__nav { width: 220px }` senza media query → a 393px il contenuto
// resta con ~172px e le 10 destinazioni della nav rendono le pagine illeggibili.
// Qui si MISURA, non si guarda: larghezza reale del contenuto, overflow di pagina,
// altezza dei target toccabili, e stato della container query del pannello BU.
//
// Bypass login: stesso pattern di bu-panel.spec.ts / mobile.spec.ts.
const USER_ID = '742bb26e-49f6-44ec-84a4-4fa92517bdd8';
const EMAIL = 'simone.leone300900@gmail.com';
const PRIVATE_KEY = path.resolve(__dirname, '../../agos-backend/src/main/resources/privateKey.pem');

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}
function mintAdminJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: 'https://agostinelli.gestionale',
    sub: USER_ID, upn: EMAIL, email: EMAIL, role: 'ADMIN', groups: ['ADMIN'],
    iat: now, exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createSign('RSA-SHA256').update(signingInput).sign(readFileSync(PRIVATE_KEY));
  return `${signingInput}.${b64url(sig)}`;
}
async function loginAs(page: Page): Promise<void> {
  const token = mintAdminJwt();
  const user = JSON.stringify({ id: USER_ID, email: EMAIL, nome: 'Simone', ruolo: 'ADMIN', personaleId: null });
  const exp = String(Date.now() + 3600_000);
  await page.addInitScript(([t, u, e]) => {
    sessionStorage.setItem('auth_access_token', t);
    sessionStorage.setItem('auth_refresh_token', t);
    sessionStorage.setItem('auth_user', u);
    sessionStorage.setItem('auth_expires_at', e);
  }, [token, user, exp] as [string, string, string]);
}

/** Le destinazioni della nav Import, una per voce di menu (import.routes.ts + import-shell.component.ts). */
const PAGINE: { slug: string; route: string; voce: string }[] = [
  { slug: '01-bulk',                 route: '/import/bulk',                            voce: 'Importa' },
  { slug: '02-storico',              route: '/import/storico',                         voce: 'Storico' },
  { slug: '03-catalogare',           route: '/import/catalogare',                      voce: 'Spese da sistemare' },
  { slug: '04-eventi',               route: '/import/incassi-evento',                  voce: 'Incassi evento' },
  { slug: '06-rate',                 route: '/import/rate',                            voce: 'Rate' },
  { slug: '08-matching-differiti',   route: '/import/smistamento/matching-differiti',  voce: 'Già a libro' },
  { slug: '09-duplicati',            route: '/import/smistamento/duplicati',           voce: 'Duplicati' },
];

/** Pagine di cui si salva la prova visiva (le altre sono coperte dalle misure). */
const CON_SCREENSHOT = new Set(['01-bulk', '03-catalogare']);

const FASE = process.env['SHOT_PHASE'] ?? 'dopo';
const DIR_SHOT = path.resolve(__dirname, '../../docs/screenshots/import-shell', FASE);

interface Misura {
  viewport: number; navW: number; navH: number; contentW: number;
  overflow: number; navItemH: number; navItemVisibile: boolean;
}

async function misura(page: Page): Promise<Misura> {
  return page.evaluate(() => {
    const nav = document.querySelector('.imp__nav') as HTMLElement | null;
    const content = document.querySelector('.imp__content') as HTMLElement | null;
    const item = document.querySelector('.imp__nav-item') as HTMLElement | null;
    const r = (el: HTMLElement | null) => (el ? el.getBoundingClientRect() : null);
    const ri = r(item);
    return {
      viewport: window.innerWidth,
      navW: Math.round(r(nav)?.width ?? -1),
      navH: Math.round(r(nav)?.height ?? -1),
      contentW: Math.round(r(content)?.width ?? -1),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      navItemH: Math.round(ri?.height ?? -1),
      navItemVisibile: !!ri && ri.top < window.innerHeight && ri.bottom > 0 && ri.left < window.innerWidth && ri.right > 0,
    };
  });
}

/**
 * Il pannello BU serve con dati veri: se il backend inciampa la pagina mostra l'empty state
 * e la container query non ha righe su cui misurarsi. Ritenta.
 *
 * ⚠️ Causa misurata il 2026-08-11 dei rossi intermittenti di QUESTI due test (mai degli altri):
 * non è il dev-reload, è il **rate limiter**. `RateLimitFilter` concede 100 richieste/minuto
 * per utente (`app.rate-limit.max-requests-per-minute`), lo shell Import ne emette ~7 a ogni
 * navigazione per i badge, e questa spec naviga 20 volte con un solo utente ⇒ oltre 140/minuto.
 * Quando la 429 tocca `GET /import/history` il pannello non ottiene l'id dell'ultimo import e
 * rende «Nessun import da rifinire» pur avendo 127 movimenti a DB (verificato con curl).
 * Il rosso si spostava fra il caso a 393px e quello a 1440px a seconda di quale richiesta perdeva.
 * ✅ Risolto: `%dev.app.rate-limit.max-requests-per-minute=10000` in `application.properties`,
 * come già valeva per `%test`. Da lì la spec passa 22/22 in ~37s (prima: retry da 27s e un rosso
 * a caso). In PRODUZIONE il limite resta 100/min: se un giorno lo shell tornasse a fare 429 con
 * un utente vero, il problema non è il limite ma le ~7 chiamate-badge per navigazione.
 */
async function vai(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await page.locator('.imp__nav').waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle').catch(() => { /* polling backend: non blocca la misura */ });
  await page.waitForTimeout(300);
}

test.beforeAll(() => { mkdirSync(DIR_SHOT, { recursive: true }); });
test.beforeEach(({ page }) => loginAs(page));

test.describe('Import shell @ 393px (Pixel 5 portrait)', () => {
  test.use({ viewport: { width: 393, height: 851 } });

  for (const p of PAGINE) {
    test(`${p.slug} — «${p.voce}»: contenuto leggibile e nav raggiungibile`, async ({ page }) => {
      await vai(page, p.route);
      const m = await misura(page);
      console.log(`[393] ${p.slug.padEnd(22)} nav=${m.navW}x${m.navH} content=${m.contentW} ` +
        `overflow=${m.overflow} navItemH=${m.navItemH} navItemVisibile=${m.navItemVisibile}`);

      if (CON_SCREENSHOT.has(p.slug)) {
        await page.screenshot({ path: path.join(DIR_SHOT, `${p.slug}-393.png`), fullPage: false });
      }

      // 1. il contenuto ha quasi tutta la viewport (prima del fix: 172px su 393)
      expect(m.contentW, `larghezza del contenuto a 393px su ${p.route}`).toBeGreaterThanOrEqual(340);
      // 2. niente scroll orizzontale di pagina
      expect(m.overflow, `scrollWidth oltre la viewport su ${p.route}`).toBeLessThanOrEqual(1);
      // 3. la nav è ancora lì e i suoi target sono toccabili (≥44px)
      expect(m.navItemVisibile, `prima voce di nav dentro la viewport su ${p.route}`).toBe(true);
      expect(m.navItemH, `altezza target nav su ${p.route}`).toBeGreaterThanOrEqual(44);
    });
  }

});

test.describe('Import shell @ 1440px (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const p of PAGINE) {
    test(`${p.slug} — «${p.voce}»: rail verticale 220px intatto`, async ({ page }) => {
      await vai(page, p.route);
      const m = await misura(page);
      console.log(`[1440] ${p.slug.padEnd(22)} nav=${m.navW}x${m.navH} content=${m.contentW} overflow=${m.overflow} navItemH=${m.navItemH}`);

      if (CON_SCREENSHOT.has(p.slug)) {
        await page.screenshot({ path: path.join(DIR_SHOT, `${p.slug}-1440.png`), fullPage: false });
      }

      expect(m.navW, `il rail resta 220px su ${p.route}`).toBe(220);
      expect(m.contentW, `il contenuto resta ampio su ${p.route}`).toBeGreaterThan(900);
      expect(m.overflow).toBeLessThanOrEqual(1);
    });
  }

});
