import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { readFileSync } from 'fs';
import { createSign } from 'crypto';
import { execSync } from 'child_process';
import * as path from 'path';

// ── Bypass login: stesso pattern di situazione-iniziale.spec.ts ───────────────
const USER_ID = '742bb26e-49f6-44ec-84a4-4fa92517bdd8'; // Simone, ADMIN (seed V4)
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

const API = 'http://localhost:8080';
const MARKER = 'ZZ E2E QA';

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${mintAdminJwt()}`, 'Content-Type': 'application/json' };
}

async function apiCreate(request: APIRequestContext, body: object) {
  return request.post(`${API}/api/piano-dei-conti`, { headers: authHeaders(), data: body });
}

test.describe('Piano dei conti — pagina ad albero + dialog due pannelli', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await page.goto('/piano-conti');
    await page.waitForLoadState('networkidle');
  });

  test.afterAll(() => {
    // Hard-delete dei soli record marcati: la soft-delete lascerebbe i codici occupati (UNIQUE)
    // e lo spec non sarebbe idempotente al secondo run.
    execSync(`docker exec -e PGPASSWORD=agos agos-postgres psql -U agos -d agosdb -c "DELETE FROM piano_dei_conti_coge WHERE descrizione LIKE '${MARKER}%'"`,
      { stdio: 'inherit' });
  });

  test('la pagina raggruppa per natura con conteggi e gerarchia', async ({ page }) => {
    const gruppi = page.locator('section.pc-group');
    await expect(gruppi).toHaveCount(6); // RICAVO/COSTO/ATTIVITA/PASSIVITA/ONERE_FINANZIARIO/IMPOSTA
    await expect(page.locator('.pc-group__title', { hasText: 'Ricavi' })).toBeVisible();
    // Un figlio noto è indentato sotto il suo gruppo
    await expect(page.locator('.pc-row__code', { hasText: '30.02.001' })).toBeVisible();
  });

  test('la ricerca filtra mantenendo visibili gli antenati', async ({ page }) => {
    await page.getByLabel('Cerca per nome o codice').fill('torta');
    // Match: 40.13.004 "Torta eventi" — devono restare visibili anche 40.13 e la radice 40
    await expect(page.locator('.pc-row__code', { hasText: '40.13.004' })).toBeVisible();
    await expect(page.locator('.pc-row__code', { hasText: /^40\.13$/ })).toBeVisible();
    await expect(page.locator('.pc-row__code').filter({ hasText: /^40$/ })).toBeVisible();
    // I gruppi senza match spariscono
    await expect(page.locator('.pc-group__title', { hasText: 'Imposte' })).toHaveCount(0);
  });

  test('dialog creazione: anteprima to-be reattiva su natura/nome/padre', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'warning' || msg.type() === 'error') warnings.push(msg.text()); });

    await page.getByRole('button', { name: 'Nuovo conto' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Stato vuoto finché non scelgo la natura
    await expect(dialog.getByText('Scegli la natura', { exact: false })).toBeVisible();

    // Il select padre deve essere disabilitato prima della natura ([disabled] su reactive control: sospetto)
    await expect.soft(dialog.locator('mat-select')).toHaveAttribute('aria-disabled', 'true');

    // 1. natura → l'anteprima mostra le radici dell'insieme + la voce nuova (radice globale successiva = 91)
    await dialog.getByRole('radio', { name: 'Ricavi' }).click();
    const nuovo = dialog.locator('.pcx-row--new');
    await expect(nuovo).toBeVisible();
    await expect(nuovo.locator('.pcx-row__code')).toHaveText('91');
    await expect(nuovo.locator('.pcx-row__name')).toHaveText('Nuovo conto');

    // 2. nome → la label dell'anteprima si aggiorna in tempo reale
    await dialog.getByLabel('Nome del conto').fill(`${MARKER} torte`);
    await expect(nuovo.locator('.pcx-row__name')).toHaveText(`${MARKER} torte`);

    // 3. padre → la voce si sposta nel ramo col progressivo giusto (30.02 ha .001/.002 → .003)
    await dialog.locator('mat-select').click();
    await page.getByRole('option', { name: 'Ricavi Cerimonie ed Eventi' }).click();
    await expect(nuovo.locator('.pcx-row__code')).toHaveText('30.02.003');
    await expect(dialog.locator('.pcx-row__code', { hasText: '30.02.001' })).toBeVisible(); // fratelli as-is
    await expect(dialog.locator('.pcx-row__code').filter({ hasText: /^30$/ })).toBeVisible(); // antenato

    // Evidenza per il finding [disabled]-su-reactive-control
    console.log('CONSOLE WARNINGS:', JSON.stringify(warnings.filter(w => w.includes('disabled')), null, 2));

    // Crea → il conto compare nella pagina
    await dialog.getByRole('button', { name: 'Crea' }).click();
    await expect(page.getByText('Conto creato')).toBeVisible();
    await expect(page.locator('.pc-row__name', { hasText: `${MARKER} torte` })).toBeVisible();
  });

  test('modifica: codice bloccato dietro toggle avanzato; eliminazione soft', async ({ page }) => {
    // Autosufficiente: crea il proprio conto via API (un worker restart può aver ripulito i marker
    // degli altri test). Codice calcolato dalla lista viva, così il test è idempotente.
    const list = await (await page.request.get(`${API}/api/piano-dei-conti`, { headers: authHeaders() })).json();
    const next = Math.max(...list.filter((c: { parentId: number | null }) => c.parentId === 27)
      .map((c: { codice: string }) => parseInt(c.codice.split('.').pop()!, 10)), 0) + 1;
    const res = await apiCreate(page.request, {
      codice: `30.02.${String(next).padStart(3, '0')}`, descrizione: `${MARKER} mod`, tipo: 'RICAVO', parentId: 27,
    });
    expect(res.ok()).toBeTruthy();
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.locator('.pc-row', { hasText: `${MARKER} mod` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Codice')).toHaveAttribute('readonly', /.*/);
    await dialog.getByRole('button', { name: 'Modifica codice (avanzato)' }).click();
    await expect(dialog.getByText('aggiorna a cascata', { exact: false })).toBeVisible();

    await dialog.getByRole('button', { name: 'Elimina' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Elimina conto' });
    await confirm.getByRole('button', { name: 'Elimina' }).click();
    await expect(page.getByText('Conto eliminato')).toBeVisible();
    await expect(page.locator('.pc-row', { hasText: `${MARKER} mod` })).toHaveCount(0);
  });

  test('API: codice duplicato → 409 CODICE_DUPLICATO', async ({ request }) => {
    const res = await apiCreate(request, {
      codice: '30.02.001', descrizione: `${MARKER} dup`, tipo: 'RICAVO', parentId: 27,
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe('CODICE_DUPLICATO');
  });

  test('API: padre = proprio discendente deve essere rifiutato (guardia anti-ciclo)', async ({ request }) => {
    // Documenta la guardia mancante in validaParent: oggi il server ACCETTA il ciclo.
    const a = await apiCreate(request, { codice: '97', descrizione: `${MARKER} ciclo A`, tipo: 'COSTO', parentId: null });
    expect(a.ok()).toBeTruthy();
    const idA = (await a.json()).id;
    const b = await apiCreate(request, { codice: '97.01', descrizione: `${MARKER} ciclo B`, tipo: 'COSTO', parentId: idA });
    expect(b.ok()).toBeTruthy();
    const idB = (await b.json()).id;

    const res = await request.put(`${API}/api/piano-dei-conti/${idA}`, {
      headers: authHeaders(),
      data: { codice: '97', descrizione: `${MARKER} ciclo A`, tipo: 'COSTO', parentId: idB },
    });
    // Comportamento DESIDERATO: 400 PARENT_NON_VALIDO. Se questo test fallisce con 200,
    // la guardia anti-ciclo manca (bug confermato, fix in PianoContiCogeRepository.validaParent).
    expect(res.status()).toBe(400);
  });
});
