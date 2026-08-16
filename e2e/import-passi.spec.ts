import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { createSign } from 'crypto';
import * as path from 'path';

/**
 * L'import non deve più essere un blocco muto: mentre elabora, i passi si vedono.
 *
 * Questa spec fallirebbe se il pannello sparisse, se i passi non comparissero durante l'attesa,
 * o se il consuntivo mostrasse passi senza la loro durata misurata. La risposta del server è
 * intercettata e ritardata di proposito: così l'attesa è osservabile e il test non dipende dai
 * file reali né scrive nulla a database.
 *
 * ⚠️ Il contratto verificato qui (nomi dei passi, campo `fasi`) è presidiato lato server da
 * `ContatoreImportInvarianteIntegrationTest#iPassiMostratiSonoQuelliDavveroEseguitiEMisurati`:
 * se i due divergono, è il backend a dire la verità.
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

/** La risposta che il server darebbe: i quattro passi con le durate misurate il 13/08/2026. */
const RISPOSTA = {
  importLogId: '3634adad-e4cd-4935-ba78-e9090931eb61',
  importati: 125, duplicati: 0, ambigui: 0, scartati: 0, parcheggiati: 26, ricorrenti: 3,
  errori: [], avvisi: [], matchingDifferiti: 0,
  fasi: [
    { nome: 'Lettura dei tre file', dettaglio: '185 righe lette · Billy 31 · BPM 62 · CA 92', millis: 13 },
    { nome: 'Riconciliazione degli incassi POS', dettaglio: '13 accrediti POS confrontati con gli scontrini Billy · 2 in attesa di accredito', millis: 4 },
    { nome: 'Classificazione e scrittura', dettaglio: '125 righe messe a libro · 29 in coda per te · 0 fuori dai conti', millis: 79 },
    { nome: "Quadratura dell'estratto conto", dettaglio: '154 righe bancarie · entrate 42.359,14 € · uscite 49.336,83 €', millis: 2 },
  ],
};

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

test('durante l\'import i passi si vedono, e alla fine portano la loro durata misurata', async ({ page }) => {
  // Il server risponde dopo 2 s: l'attesa diventa osservabile senza toccare il database.
  await page.route('**/api/movimenti/import/congiunto', async route => {
    await new Promise(r => setTimeout(r, 2000));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RISPOSTA) });
  });

  await page.goto('/import/bulk');
  await page.locator('.bulk__slots').waitFor({ state: 'visible' });

  const csv = { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('a;b\n1;2\n') };
  const inputs = page.locator('.bulk__dropzone input[type=file]');
  await expect(inputs).toHaveCount(3);
  for (let i = 0; i < 3; i++) await inputs.nth(i).setInputFiles(csv);

  await page.getByRole('button', { name: /Importa i 3 file/i }).click();

  // ── mentre elabora: i passi ci sono, e dicono di essere in corso ──
  const pannello = page.locator('app-passi-import');
  await expect(pannello, 'il pannello dei passi non compare durante l\'elaborazione').toBeVisible();
  await expect(pannello.locator('.passi__titolo')).toHaveText(/Sto elaborando i tre file/);
  await expect(pannello.locator('li.passo')).toHaveCount(4);
  await expect(pannello.locator('li.passo .passo__dett').first()).toHaveText(/in corso/);
  // il cronometro è vero: parte da zero e sale
  await expect(pannello.locator('.passi__tempo')).toHaveText(/\d+,\d s/);

  // ── a elaborazione finita: gli stessi passi, col numero e la durata veri ──
  await expect(pannello.locator('.passi__titolo')).toHaveText(/Elaborazione completata/, { timeout: 15_000 });
  const righe = pannello.locator('li.passo');
  await expect(righe).toHaveCount(4);
  for (const f of RISPOSTA.fasi) {
    const riga = pannello.locator('li.passo', { hasText: f.nome });
    await expect(riga, `manca il passo «${f.nome}»`).toBeVisible();
    await expect(riga.locator('.passo__dett'), `il passo «${f.nome}» non porta il suo numero`)
      .toHaveText(f.dettaglio);
    await expect(riga.locator('.passo__ms'), `il passo «${f.nome}» non porta la durata misurata`)
      .toHaveText(`${f.millis} ms`);
  }
  // nessuna riga resta «in corso» dopo la fine
  await expect(pannello.locator('li.passo .passo__dett', { hasText: /in corso/ })).toHaveCount(0);
  // il totale mostrato è la somma delle durate misurate, non il tempo dell'orologio
  await expect(pannello.locator('.passi__tempo')).toHaveText('98 ms');
});
