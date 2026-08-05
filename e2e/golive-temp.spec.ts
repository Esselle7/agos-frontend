import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { createSign } from 'crypto';
import { execSync } from 'child_process';
import * as path from 'path';

/**
 * ⛔ TEMPORANEO — GO-LIVE 2026-08-05. Da cancellare insieme ai due bottoni.
 *
 * Copre i due strumenti di go-live e, soprattutto, la NON-regressione: il bottone
 * "annulla movimenti evento" deve toccare SOLO i movimenti con eventoId, lasciando
 * intatti tutti gli altri (nel dump di prod sono 737 su 799).
 *
 * Richiede il DB caricato col dump di produzione (799 movimenti, 62 evento, 3 conflitti aperti).
 */

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

/** Conta sul DB: è la verità, non quello che mostra la pagina. */
function q(sql: string): number {
  const out = execSync(
    `docker exec -e PGPASSWORD=agos agos-postgres psql -U agos -d agosdb -X -qAt -c "${sql}"`,
    { encoding: 'utf8' });
  return Number(out.trim());
}

/**
 * Ripristina il dump di produzione. Si chiama UNA SOLA VOLTA per run (beforeAll), non per test.
 *
 * Perché una sola: il DROP DATABASE avviene sotto un backend vivo e gli lascia nel pool Agroal
 * connessioni morte. L'health check risponde comunque 200 (apre una connessione nuova) mentre le
 * prime richieste reali falliscono a caso — misurato: 1 conflitto archiviato su 3, gli altri 2 in
 * errore, e il fallimento cambiava a ogni giro. Ogni ripristino in più è un'altra finestra di
 * instabilità: farlo una volta, all'inizio, e poi lasciare in pace il DB è più solido di qualunque
 * attesa furba.
 *
 * I due test sono quindi ORDINATI di proposito: prima i conflitti keyword (non tocca i movimenti),
 * poi l'annullamento dei movimenti evento, che non ha bisogno di dati vergini.
 */
function ripristinaDump(): void {
  const dump = path.resolve(__dirname, '../../agos_prod_2026-07-27.sql');
  execSync(
    `docker exec -e PGPASSWORD=agos agos-postgres psql -U agos -d postgres -q ` +
    `-c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='agosdb' AND pid <> pg_backend_pid();" ` +
    `-c "DROP DATABASE agosdb;" -c "CREATE DATABASE agosdb OWNER agos;"`, { stdio: 'ignore' });
  execSync(`docker exec -i -e PGPASSWORD=agos agos-postgres psql -U agos -d agosdb -q < "${dump}"`,
    { stdio: 'ignore', shell: '/bin/bash' });
  // Il DROP DATABASE lascia nel pool Agroal connessioni morte. L'health check da solo NON basta:
  // apre una connessione nuova e risponde 200 mentre nel pool restano quelle rotte, e le prime
  // richieste reali falliscono a caso (misurato: 1 conflitto archiviato su 3, gli altri 2 in errore).
  // Si martella un endpoint VERO finché non risponde bene N volte di fila: così le connessioni
  // guaste vengono scartate prima che i test le incontrino.
  const token = mintAdminJwt();
  let consecutive = 0;
  for (let i = 0; i < 60 && consecutive < 5; i++) {
    try {
      const code = execSync(
        `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${token}" ` +
        `"http://localhost:8080/api/movimenti/keyword/conflitti?stato=APERTO"`, { encoding: 'utf8' }).trim();
      consecutive = code === '200' ? consecutive + 1 : 0;
    } catch { consecutive = 0; }
    if (consecutive < 5) {
      execSync('docker exec agos-postgres psql -U agos -d postgres -X -q -c "SELECT pg_sleep(1)"', { stdio: 'ignore' });
    }
  }
  if (consecutive < 5) throw new Error('backend non stabile dopo il ripristino del dump');
}

test.describe('⛔ Strumenti temporanei go-live', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test.beforeAll(() => { ripristinaDump(); });

  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    page.on('dialog', d => d.accept());   // i bottoni usano confirm()
  });

  test('sistema i conflitti keyword senza cancellare keyword', async ({ page }) => {
    const firmePrima     = q('SELECT count(*) FROM keyword_firma');
    const tokenPrima     = q('SELECT count(*) FROM keyword_token');
    const regolePrima    = q('SELECT count(*) FROM regole_classificazione');
    const apertiPrima    = q("SELECT count(*) FROM keyword_conflitto WHERE stato='APERTO'");
    expect(apertiPrima, 'servono conflitti aperti per il test').toBeGreaterThan(0);

    await page.goto('/keyword');
    await page.waitForLoadState('networkidle');

    await page.locator('.golive__btn').click();
    await expect(page.locator('.golive__esito')).toContainText('Archiviati', { timeout: 60_000 });
    // idem: nessun conflitto deve fallire, altrimenti l'asserzione sotto mascherebbe il problema
    await expect(page.locator('.golive__esito')).not.toContainText('falliti');

    expect(q("SELECT count(*) FROM keyword_conflitto WHERE stato='APERTO'"), 'conflitti chiusi').toBe(0);
    // NON-REGRESSIONE: il lavoro di catalogazione del cliente resta intatto
    expect(q('SELECT count(*) FROM keyword_firma'), 'firme intatte').toBe(firmePrima);
    expect(q('SELECT count(*) FROM keyword_token'), 'token intatti').toBe(tokenPrima);
    expect(q('SELECT count(*) FROM regole_classificazione'), 'regole intatte').toBe(regolePrima);
  });
  test('annulla SOLO i movimenti evento e lascia intatti gli altri', async ({ page }) => {
    const eventoAttiviPrima = q("SELECT count(*) FROM movimenti WHERE evento_id IS NOT NULL AND stato<>'ANNULLATO'");
    const nonEventoPrima     = q("SELECT count(*) FROM movimenti WHERE evento_id IS NULL");
    const nonEventoAttiviPrima = q("SELECT count(*) FROM movimenti WHERE evento_id IS NULL AND stato<>'ANNULLATO'");
    const righeTotaliPrima   = q('SELECT count(*) FROM movimenti');
    expect(eventoAttiviPrima, 'servono movimenti evento attivi per il test').toBeGreaterThan(0);

    await page.goto('/movimenti');
    await page.waitForLoadState('networkidle');

    await page.locator('.golive__btn').click();
    await expect(page.locator('.golive__esito')).toContainText('Fatto:', { timeout: 120_000 });
    // l'esito NON deve contenere fallimenti: "Fatto: N annullati" e basta
    await expect(page.locator('.golive__esito')).not.toContainText('FALLITI');

    // 1) tutti i movimenti evento sono annullati
    expect(q("SELECT count(*) FROM movimenti WHERE evento_id IS NOT NULL AND stato<>'ANNULLATO'"))
      .toBe(0);
    // 2) NON-REGRESSIONE: i movimenti senza evento non sono stati toccati
    expect(q("SELECT count(*) FROM movimenti WHERE evento_id IS NULL"), 'righe non-evento')
      .toBe(nonEventoPrima);
    expect(q("SELECT count(*) FROM movimenti WHERE evento_id IS NULL AND stato<>'ANNULLATO'"),
      'nessun movimento non-evento è stato annullato').toBe(nonEventoAttiviPrima);
    // 3) annullamento LOGICO: nessuna riga cancellata
    expect(q('SELECT count(*) FROM movimenti'), 'nessuna riga cancellata').toBe(righeTotaliPrima);
    // 4) lo storico degli eventi sopravvive
    expect(q('SELECT count(*) FROM eventi')).toBe(58);
    expect(q('SELECT round(sum(importo_incassato)) FROM eventi')).toBeGreaterThan(0);

    // 5) idempotente: rilanciarlo non fa danni e lo dichiara
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.locator('.golive__btn').click();
    // timeout generoso: al secondo giro il tetto di 100 richieste/minuto è spesso già consumato dal
    // primo, e il bottone attende ~10s per volta prima di ritentare. Non è lentezza: è la guardia
    // che impedisce un annullamento parziale.
    await expect(page.locator('.golive__esito')).toContainText('Nessun movimento evento attivo', { timeout: 120_000 });
    expect(q("SELECT count(*) FROM movimenti WHERE evento_id IS NULL AND stato<>'ANNULLATO'"))
      .toBe(nonEventoAttiviPrima);
  });

});
