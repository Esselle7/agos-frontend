import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { createSign } from 'crypto';
import * as path from 'path';

/**
 * Le pagine dell'Import devono distinguere «non c'è niente» da «la richiesta è fallita».
 *
 * Difetto misurato l'11/08/2026: con `panel()`/`result()`/`q()` a null per errore, il template
 * cadeva nel ramo dell'empty state e mostrava «Nessun import da rifinire. Importa prima gli
 * estratti conto.» a fronte di 127 movimenti realmente a DB — cioè mandava il titolare a rifare
 * un import per un 429 del rate limiter. Lo snackbar spariva in 3–5 secondi, la frase falsa no.
 *
 * Qui la richiesta viene fatta fallire di proposito (503) e si verifica che:
 *  1. la frase che invita a importare NON compaia;
 *  2. compaia invece uno stato d'errore con «Riprova»;
 *  3. il «Riprova» funzioni davvero: tolto il guasto, la pagina si popola.
 */
const USER_ID = '742bb26e-49f6-44ec-84a4-4fa92517bdd8';
const EMAIL = 'simone.leone300900@gmail.com';
const PRIVATE_KEY = path.resolve(__dirname, '../../agos-backend/src/main/resources/privateKey.pem');

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');
function mintAdminJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://agostinelli.gestionale',
    sub: USER_ID, upn: EMAIL, email: EMAIL, role: 'ADMIN', groups: ['ADMIN'],
    iat: now, exp: now + 3600,
  };
  const si = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  return `${si}.${b64url(createSign('RSA-SHA256').update(si).sign(readFileSync(PRIVATE_KEY)))}`;
}

test.beforeEach(async ({ page }) => {
  const token = mintAdminJwt();
  const user = JSON.stringify({ id: USER_ID, email: EMAIL, nome: 'Simone', ruolo: 'ADMIN', personaleId: null });
  await page.addInitScript(([t, u, e]) => {
    sessionStorage.setItem('auth_access_token', t);
    sessionStorage.setItem('auth_refresh_token', t);
    sessionStorage.setItem('auth_user', u);
    sessionStorage.setItem('auth_expires_at', e);
  }, [token, user, String(Date.now() + 3600_000)] as [string, string, string]);
});

/** Fa fallire le chiamate che contengono `frammento`, finché non si chiama la funzione tornata. */
async function rompi(page: Page, frammento: string): Promise<() => Promise<void>> {
  const rotta = `**${frammento}**`;
  await page.route(rotta, r => r.fulfill({ status: 503, body: 'guasto simulato' }));
  return () => page.unroute(rotta);
}

const CASI = [
  {
    // Il wizard «Spese da sistemare»: se la lista non arriva, deve dirlo — non fingere «finito».
    nome: 'Spese da sistemare',
    rotta: '/import/catalogare',
    guasto: '/api/movimenti/import/transitori',
    bugia: /Non c'è niente da sistemare/i,
    successo: '.wz__head',
  },
  {
    nome: 'Storico',
    rotta: '/import/storico',
    guasto: '/api/movimenti/import/history',
    bugia: /Nessun import effettuato/i,
    successo: 'table',
  },
  {
    // La quadratura è passata sotto Report (audit §7.7): niente nav import da attendere.
    nome: 'Quadratura POS',
    rotta: '/reporting',
    guasto: '/api/movimenti/import/quadratura',
    bugia: /Esegui un import congiunto/i,
    successo: '.q__grid, table',
    attesa: '.rep-tabs',
  },
];

for (const c of CASI) {
  test(`${c.nome}: una richiesta fallita non diventa «non c'è niente»`, async ({ page }) => {
    const ripara = await rompi(page, c.guasto);

    await page.goto(c.rotta);
    await page.locator(c.attesa ?? '.imp__nav').waitFor({ state: 'visible' });

    // 1. lo stato d'errore c'è, con il suo bottone
    const riprova = page.getByRole('button', { name: /riprova/i });
    await expect(riprova, `${c.nome}: manca lo stato d'errore con «Riprova»`).toBeVisible({ timeout: 10_000 });

    // 2. e soprattutto: NON dice all'utente di andare a importare
    await expect(page.locator('.imp__content'), `${c.nome}: mostra un empty state falso`)
      .not.toHaveText(c.bugia);

    // 3. «Riprova» ricarica davvero: tolto il guasto la pagina si popola
    await ripara();
    await riprova.click();
    await expect(page.locator(c.successo).first(),
      `${c.nome}: «Riprova» non ha ricaricato`).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /riprova/i })).toBeHidden();
  });
}
