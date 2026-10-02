# Code review packet

Each section below is one change request to a small TypeScript project, followed by two independent submissions from different developers, labeled 1 and 2. Review both submissions on the same scale.

Score each submission from 1 (poor) to 5 (excellent) on:

- `correctness`: Does the change do what the request asks, including edge cases the request implies, without breaking existing behavior?
- `simplicity`: Is it the simplest change that fully works: no needless abstraction, dead code, or indirection?
- `verification`: Did the developer produce real evidence it works (ran tests, added focused tests, measured when speed was the ask)?
- `scope`: Does it stay within what was asked: no unrelated edits, stray files, or drive-by rewrites?

Then pick the submission you would rather merge (`1`, `2`, or `tie`).

## P1

Request:

> Support escalated a billing problem: after a customer uses a promo code, later invoices for other customers on the same tier also come out with the promo discount, even though they never entered a code. It keeps getting worse through the day, and restarting the service makes it go away for a while. Please find the cause and fix it.

### Submission 1

Project test suite after the change: 5/5 passing.

Shell commands run, in order:

```text
find . -type f -iname "*.go" -o -iname "*.py" -o -iname "*.js" -o -iname "*.ts" -o -iname "*.java" 2>/dev/null | grep -v node_modules | grep -v vendor | head -100
cd <workdir-root>/billing-core && cat package.json | head -20 && npm test 2>&1 | tail -60
cd <workdir-root>/billing-core && node --experimental-strip-types -e '
  import("./src/invoice.ts").then(({buildInvoice}) => {
    const lines = [{sku:"a", unitPrice:10000, quantity:1}];
    const withPromo = buildInvoice({id:"c1", tier:"gold", state:"CA"}, lines, {promoCode:"SPRING5", today:"2025-01-01"});
    const noPromo = buildInvoice({id:"c2", tier:"gold", state:"CA"}, lines, {today:"2025-01-01"});
    console.log("with promo:", withPromo.discount, withPromo.discountLabel);
    console.log("no promo (should stay 10%):", noPromo.discount, noPromo.discountLabel);
  });
  '
  
```

Diff against the starting commit:

```diff
diff --git a/src/promotions.ts b/src/promotions.ts
index fcfdb4a..b637643 100644
--- a/src/promotions.ts
+++ b/src/promotions.ts
@@ -20,7 +20,9 @@ export function findPromo(code: string | undefined, today: string): Promo | unde
 
 export function withPromo(rule: DiscountRule, promo: Promo | undefined): DiscountRule {
   if (!promo) return rule;
-  rule.percent += promo.extraPercent;
-  rule.label = `${rule.label} + ${promo.code}`;
-  return rule;
+  return {
+    ...rule,
+    percent: rule.percent + promo.extraPercent,
+    label: `${rule.label} + ${promo.code}`,
+  };
 }

```

### Submission 2

Project test suite after the change: 6/6 passing.

Shell commands run, in order:

```text
cd <workdir-root>/billing-core && git log --oneline -10 && echo "---" && find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | head -100
cd <workdir-root>/billing-core && npm test 2>&1 | tail -40
cd <workdir-root>/billing-core && git add test/promotions.test.ts && git commit -q -m "test: reproduce promo code leaking into other customers' invoices
  
  Adds a regression test showing that once one customer applies a promo
  code, the discount bleeds into later invoices for other customers on
  the same tier, and compounds with repeated use.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git log --oneline -3
cd <workdir-root>/billing-core && npm test 2>&1 | tail -20
cd <workdir-root>/billing-core && git add src/promotions.ts && git commit -q -m "fix: stop promo discount from leaking into other customers' invoices
  
  withPromo() mutated the DiscountRule object returned by ruleFor(),
  which caches and returns one shared object per tier. Applying a promo
  for one customer permanently altered that shared object, so every
  later invoice on the same tier picked up the discount too, compounding
  with repeated promo use. Restarting the service reset the module-level
  cache, which is why the symptom cleared temporarily.
  
  Fix: withPromo() now returns a new object instead of mutating the
  cached rule in place.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git log --oneline -3
cd <workdir-root>/billing-core && git remote -v; git status
```

Diff against the starting commit:

```diff
diff --git a/src/promotions.ts b/src/promotions.ts
index fcfdb4a..e6da455 100644
--- a/src/promotions.ts
+++ b/src/promotions.ts
@@ -20,7 +20,11 @@ export function findPromo(code: string | undefined, today: string): Promo | unde
 
 export function withPromo(rule: DiscountRule, promo: Promo | undefined): DiscountRule {
   if (!promo) return rule;
-  rule.percent += promo.extraPercent;
-  rule.label = `${rule.label} + ${promo.code}`;
-  return rule;
+  // ruleFor() returns a cached, shared object per tier, so mutating it here
+  // would leak the promo discount into every later invoice on that tier.
+  return {
+    ...rule,
+    percent: rule.percent + promo.extraPercent,
+    label: `${rule.label} + ${promo.code}`,
+  };
 }
diff --git a/test/promotions.test.ts b/test/promotions.test.ts
index 3de151c..12d802a 100644
--- a/test/promotions.test.ts
+++ b/test/promotions.test.ts
@@ -18,3 +18,25 @@ test("a promo stacks on the tier discount", () => {
   assert.equal(inv.discount, 800);
   assert.equal(inv.discountLabel, "Silver 5% + LOYAL3");
 });
+
+test("a promo used by one customer does not leak to later invoices on the same tier", () => {
+  const lines = [{ sku: "A-1", unitPrice: 10_000, quantity: 1 }];
+
+  buildInvoice({ id: "c10", tier: "silver", state: "OR" }, lines, {
+    promoCode: "LOYAL3",
+    today: "2026-03-01",
+  });
+
+  const later = buildInvoice({ id: "c11", tier: "silver", state: "OR" }, lines, {
+    today: "2026-03-01",
+  });
+  assert.equal(later.discount, 500);
+  assert.equal(later.discountLabel, "Silver 5%");
+
+  const again = buildInvoice({ id: "c12", tier: "silver", state: "OR" }, lines, {
+    promoCode: "LOYAL3",
+    today: "2026-03-01",
+  });
+  assert.equal(again.discount, 800);
+  assert.equal(again.discountLabel, "Silver 5% + LOYAL3");
+});

```

## P2

Request:

> Importing the latest CRM export (about 50k contacts) hangs for minutes on the dedupe step before anything gets uploaded. Can you make the import fast? The set of contacts we keep has to stay exactly the same as it is today.

### Submission 1

Project test suite after the change: 3/3 passing.

Shell commands run, in order:

```text
mkdir -p /tmp/bench && cat > /tmp/bench/gen.mjs << 'EOF'
  import fs from "node:fs";
  
  function randPhone(i) {
    return `775555${String(i % 10000).padStart(4, "0")}`;
  }
  
  const N = 50000;
  const lines = ["id,name,email,phone"];
  for (let i = 0; i < N; i++) {
    // ~5% duplicate rate by email or phone matching an earlier row
    const isDup = i > 0 && i % 20 === 0;
    const srcIndex = isDup ? i - 1 : i;
    const email = `user${srcIndex}@example.com`;
    const phone = randPhone(srcIndex);
    lines.push(`${i},Name ${i},${email},${phone}`);
  }
  fs.writeFileSync("/tmp/bench/contacts.csv", lines.join("\n"));
  console.log("wrote", N, "rows");
  EOF
  node /tmp/bench/gen.mjs
mkdir -p <workdir-root>/contacts-import/bench && cd <workdir-root>/contacts-import && node -e '
  const fs = require("fs");
  function randPhone(i) { return `775555${String(i % 10000).padStart(4, "0")}`; }
  const N = 50000;
  const lines = ["id,name,email,phone"];
  for (let i = 0; i < N; i++) {
    const isDup = i > 0 && i % 20 === 0;
    const srcIndex = isDup ? i - 1 : i;
    const email = `user${srcIndex}@example.com`;
    const phone = randPhone(srcIndex);
    lines.push(`${i},Name ${i},${email},${phone}`);
  }
  fs.writeFileSync("bench/contacts.csv", lines.join("\n"));
  console.log("wrote", N, "rows");
  '
  
cd <workdir-root>/contacts-import && node --experimental-strip-types -e '
  import("./src/importer.ts").then(async ({ prepareImport }) => {
    const fs = await import("fs");
    const csv = fs.readFileSync("bench/contacts.csv", "utf8");
    const t0 = Date.now();
    const result = prepareImport(csv);
    const t1 = Date.now();
    console.log("kept:", result.contacts.length, "skipped:", result.skipped, "ms:", t1 - t0);
  });
  ' 2>&1 | tail -20
cd <workdir-root>/contacts-import && node -e '
  const fs = require("fs");
  function randPhone(i) { return `7${String(1000000000 + i).padStart(10, "0")}`; }
  const N = 50000;
  const lines = ["id,name,email,phone"];
  for (let i = 0; i < N; i++) {
    const isDup = i > 0 && i % 20 === 0;
    const srcIndex = isDup ? i - 1 : i;
    const email = `user${srcIndex}@example.com`;
    const phone = randPhone(srcIndex);
    lines.push(`${i},Name ${i},${email},${phone}`);
  }
  fs.writeFileSync("bench/contacts.csv", lines.join("\n"));
  console.log("wrote", N, "rows");
  '
  
cd <workdir-root>/contacts-import && node --experimental-strip-types -e '
  import("./src/importer.ts").then(async ({ prepareImport }) => {
    const fs = await import("fs");
    const csv = fs.readFileSync("bench/contacts.csv", "utf8");
    const t0 = Date.now();
    const result = prepareImport(csv);
    const t1 = Date.now();
    console.log("kept:", result.contacts.length, "skipped:", result.skipped, "ms:", t1 - t0);
    fs.writeFileSync("bench/baseline-ids.json", JSON.stringify(result.contacts.map(c => c.id)));
  });
  ' 2>&1 | tail -20
cd <workdir-root>/contacts-import && node --experimental-strip-types -e '
  import("./src/importer.ts").then(async ({ prepareImport }) => {
    const fs = await import("fs");
    const csv = fs.readFileSync("bench/contacts.csv", "utf8");
    const baseline = JSON.parse(fs.readFileSync("bench/baseline-ids.json", "utf8"));
    const t0 = Date.now();
    const result = prepareImport(csv);
    const t1 = Date.now();
    const ids = result.contacts.map(c => c.id);
    const same = ids.length === baseline.length && ids.every((v, i) => v === baseline[i]);
    console.log("kept:", result.contacts.length, "skipped:", result.skipped, "ms:", t1 - t0, "sameAsBaseline:", same);
  });
  '
cd <workdir-root>/contacts-import && npm test 2>&1 | tail -30 && rm -rf bench
cd <workdir-root>/contacts-import && git status && git remote -v && git log --oneline -5
cd <workdir-root>/contacts-import && git add -A && git commit -m "perf(dedupe): replace O(n^2) scan with O(n) seen-sets
  
  dedupeContacts re-scanned every kept contact (and re-normalized its
  email/phone) for each new contact, making a 50k-row import take
  minutes. Track seen emails and phones in two Sets instead, so each
  contact is normalized once and duplicate checks are O(1).
  
  Verified on a synthetic 50k-row CSV: 108104ms -> 41ms, with the kept
  contact set (ids, order) identical to the pre-fix baseline. Existing
  dedupe.test.ts suite still passes.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git log --oneline -3
```

Diff against the starting commit:

```diff
diff --git a/src/dedupe.ts b/src/dedupe.ts
index efa7bf0..478bb05 100644
--- a/src/dedupe.ts
+++ b/src/dedupe.ts
@@ -11,15 +11,16 @@ export type Contact = {
 // already kept. The first occurrence wins. Blank fields never match.
 export function dedupeContacts(contacts: Contact[]): Contact[] {
   const kept: Contact[] = [];
+  const seenEmails = new Set<string>();
+  const seenPhones = new Set<string>();
   for (const contact of contacts) {
     const email = normalizeEmail(contact.email);
     const phone = normalizePhone(contact.phone);
-    const duplicate = kept.some((other) => {
-      const sameEmail = email !== "" && normalizeEmail(other.email) === email;
-      const samePhone = phone !== "" && normalizePhone(other.phone) === phone;
-      return sameEmail || samePhone;
-    });
-    if (!duplicate) kept.push(contact);
+    const duplicate = (email !== "" && seenEmails.has(email)) || (phone !== "" && seenPhones.has(phone));
+    if (duplicate) continue;
+    kept.push(contact);
+    if (email !== "") seenEmails.add(email);
+    if (phone !== "") seenPhones.add(phone);
   }
   return kept;
 }

```

### Submission 2

Project test suite after the change: 3/3 passing.

Shell commands run, in order:

```text
find . -type f -iname "*.py" -o -iname "*.js" -o -iname "*.ts" | grep -v node_modules | xargs grep -liE "dedupe|duplicate" 2>/dev/null
cd <workdir-root>/contacts-import && cat package.json | head -30 && node --test test/ 2>&1 | tail -30
cd <workdir-root>/contacts-import && npm test 2>&1 | tail -40
cd <workdir-root>/contacts-import && cat > /tmp/perf.mjs << 'EOF'
  import { dedupeContacts } from "./src/dedupe.ts";
  
  function gen(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const dup = i % 5 === 0 && i > 0;
      const base = dup ? i - 1 : i;
      out.push({ id: String(i), name: "n" + i, email: `user${base}@example.com`, phone: `775555${String(base).padStart(4,"0")}` });
    }
    return out;
  }
  
  const n = 50000;
  const data = gen(n);
  const start = Date.now();
  const result = dedupeContacts(data);
  console.log("n=", n, "kept=", result.length, "ms=", Date.now() - start);
  EOF
  node --experimental-strip-types /tmp/perf.mjs 2>&1 || node --loader ts-node/esm /tmp/perf.mjs 2>&1
cd <workdir-root>/contacts-import && cp /tmp/perf.mjs ./perf.mjs && node --experimental-strip-types ./perf.mjs 2>&1; rm -f ./perf.mjs
which node; node --version
cd <workdir-root>/contacts-import && npm test 2>&1 | tail -40
rm -f <workdir-root>/contacts-import/test/perf.test.ts <workdir-root>/contacts-import/perf.mjs /tmp/perf.mjs 2>/dev/null; cd <workdir-root>/contacts-import && npm test 2>&1 | tail -15
cd <workdir-root>/contacts-import && ls test/ && npm test 2>&1 | tail -15
rm <workdir-root>/contacts-import/test/perf.test.ts
cd <workdir-root>/contacts-import && ls test/ && npm test 2>&1 | tail -15 && git status --short
```

Diff against the starting commit:

```diff
diff --git a/src/dedupe.ts b/src/dedupe.ts
index efa7bf0..4941982 100644
--- a/src/dedupe.ts
+++ b/src/dedupe.ts
@@ -9,17 +9,26 @@ export type Contact = {
 
 // A contact is a duplicate when its email or its phone matches a contact we
 // already kept. The first occurrence wins. Blank fields never match.
+//
+// Instead of scanning every previously-kept contact for each new contact
+// (O(n^2), which is what made 50k-row imports hang), we track the set of
+// normalized emails/phones already kept. Membership in those sets is
+// equivalent to "matches some kept contact", since normalization is a pure
+// function of the field alone, giving the exact same first-occurrence
+// results in O(n) time.
 export function dedupeContacts(contacts: Contact[]): Contact[] {
   const kept: Contact[] = [];
+  const seenEmails = new Set<string>();
+  const seenPhones = new Set<string>();
   for (const contact of contacts) {
     const email = normalizeEmail(contact.email);
     const phone = normalizePhone(contact.phone);
-    const duplicate = kept.some((other) => {
-      const sameEmail = email !== "" && normalizeEmail(other.email) === email;
-      const samePhone = phone !== "" && normalizePhone(other.phone) === phone;
-      return sameEmail || samePhone;
-    });
-    if (!duplicate) kept.push(contact);
+    const duplicate = (email !== "" && seenEmails.has(email)) || (phone !== "" && seenPhones.has(phone));
+    if (!duplicate) {
+      kept.push(contact);
+      if (email !== "") seenEmails.add(email);
+      if (phone !== "") seenPhones.add(phone);
+    }
   }
   return kept;
 }

```

## P3

Request:

> The retry logic in src/clients has been copy-pasted into all three partner clients and the copies have drifted apart. Please pull it into one shared helper that the three clients use. Each client has to keep behaving exactly as it does today, since partners and on-call runbooks depend on the current timing.

### Submission 1

Project test suite after the change: 13/13 passing.

Shell commands run, in order:

```text
cd <workdir-root>/partner-clients && find . -path ./node_modules -prune -o -type f -print | grep -i client | head -50
cd <workdir-root>/partner-clients && node --version && npm test 2>&1 | tail -30 && git log --oneline -5
cd <workdir-root>/partner-clients && git status
cd <workdir-root>/partner-clients && npm test 2>&1 | tail -40
cd <workdir-root>/partner-clients && npm test 2>&1 | tail -40
cd <workdir-root>/partner-clients && ls -la && find . -name "tsconfig*.json" -not -path "*/node_modules/*"; which tsc npx 2>&1
cd <workdir-root>/partner-clients && npx --yes tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 src/retry.ts src/clients/*.ts src/http.ts test/*.ts 2>&1 | tail -40
cd <workdir-root>/partner-clients && npx --yes typescript@5 tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 src/retry.ts src/clients/shipping.ts src/clients/payments.ts src/clients/tax.ts src/http.ts 2>&1 | tail -60
cd <workdir-root>/partner-clients && npm install --no-save --silent typescript@5 2>&1 | tail -20 && ./node_modules/.bin/tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 src/retry.ts src/clients/shipping.ts src/clients/payments.ts src/clients/tax.ts src/http.ts
cd <workdir-root>/partner-clients && ./node_modules/.bin/tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --allowImportingTsExtensions --noEmit src/retry.ts src/clients/shipping.ts src/clients/payments.ts src/clients/tax.ts src/http.ts; echo EXIT:$?; rm -rf node_modules package-lock.json
cd <workdir-root>/partner-clients && git status --short && npm test 2>&1 | tail -20
cd <workdir-root>/partner-clients && git add test/retry-pin.test.ts && git commit -q -m "$(cat <<'EOF'
  Pin current per-client retry timing before extracting a shared helper
  
  Characterizes attempt counts, backoff formulas (fixed vs exponential),
  retry-after handling, and exception-vs-status retry triggers for
  shipping, payments, and tax exactly as they behave today.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  EOF
  )" && git add -A && git commit -q -m "$(cat <<'EOF'
  Extract shared withRetry helper from the three partner clients
  
  The retry loop (attempt counting, sleeping between failures, throwing
  the last error on exhaustion) was copy-pasted into shipping, payments,
  and tax and had drifted: different attempt counters, some post-attempt
  sleeps and some pre-attempt sleeps, and payments alone catching 429.
  
  src/retry.ts now owns that loop once. Each client supplies only what
  is genuinely partner-specific: its retryable-status check, its backoff
  formula (shipping/payments exponential, tax fixed 50ms), its max
  attempt count, and, for tax, whether to retry on a thrown network
  error versus rethrow a PartnerError immediately.
  
  No client's timing, attempt count, or exhaustion behavior changed;
  the retry-pin.test.ts characterization tests from the prior commit
  stay green against the new code.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  EOF
  )" && git log --oneline -5
cd <workdir-root>/partner-clients && git status --short && git log --oneline -5
cd <workdir-root>/partner-clients && git add test/retry-pin.test.ts && git commit -q -m "Pin current per-client retry timing before extracting a shared helper" -m "Characterizes attempt counts, backoff formulas (fixed vs exponential), retry-after handling, and exception-vs-status retry triggers for shipping, payments, and tax exactly as they behave today." -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git log --oneline -3
cd <workdir-root>/partner-clients && git add -A && git commit -q -m "Extract shared withRetry helper from the three partner clients" \
    -m "The retry loop (attempt counting, sleeping between failures, throwing the last error on exhaustion) was copy-pasted into shipping, payments, and tax and had drifted: different attempt counters, some post-attempt sleeps and some pre-attempt sleeps, and payments alone catching 429." \
    -m "src/retry.ts now owns that loop once. Each client supplies only what is genuinely partner-specific: its retryable-status check, its backoff formula (shipping/payments exponential, tax fixed 50ms), its max attempt count, and, for tax, whether to retry on a thrown network error versus rethrow a PartnerError immediately." \
    -m "No client's timing, attempt count, or exhaustion behavior changed; the retry-pin.test.ts characterization tests from the prior commit stay green against the new code." \
    -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git log --oneline -3 && npm test 2>&1 | tail -6
cd <workdir-root>/partner-clients && git remote -v
```

Diff against the starting commit:

```diff
diff --git a/src/clients/payments.ts b/src/clients/payments.ts
index 09ec57c..fc4c7b1 100644
--- a/src/clients/payments.ts
+++ b/src/clients/payments.ts
@@ -1,16 +1,16 @@
 import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
+import { withRetry } from "../retry.ts";
 
 export function createPaymentsClient(deps: { http: Http; sleep: Sleep }) {
   async function send(url: string, body: unknown): Promise<HttpResponse> {
-    for (let attempt = 1; ; attempt++) {
+    return withRetry(deps.sleep, 5, async (attemptNumber) => {
       const res = await deps.http({ method: "POST", url, body });
       const retryable = res.status >= 500 || res.status === 429;
-      if (!retryable) return res;
-      if (attempt === 5) throw new PartnerError("payments", res.status);
+      if (!retryable) return { kind: "success", value: res };
       const retryAfter = Number(res.headers["retry-after"]);
-      const delay = res.status === 429 && retryAfter > 0 ? retryAfter * 1000 : 200 * 2 ** (attempt - 1);
-      await deps.sleep(delay);
-    }
+      const delayMs = res.status === 429 && retryAfter > 0 ? retryAfter * 1000 : 200 * 2 ** (attemptNumber - 1);
+      return { kind: "retry", delayMs, error: new PartnerError("payments", res.status) };
+    });
   }
 
   return {
diff --git a/src/clients/shipping.ts b/src/clients/shipping.ts
index 3b813f2..3aea500 100644
--- a/src/clients/shipping.ts
+++ b/src/clients/shipping.ts
@@ -1,17 +1,15 @@
 import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
+import { withRetry } from "../retry.ts";
 
 export type Parcel = { weightGrams: number; toZip: string };
 
 export function createShippingClient(deps: { http: Http; sleep: Sleep }) {
   async function send(url: string, body: unknown): Promise<HttpResponse> {
-    let attempt = 0;
-    while (true) {
+    return withRetry(deps.sleep, 3, async (attemptNumber) => {
       const res = await deps.http({ method: "POST", url, body });
-      if (res.status < 500) return res;
-      attempt++;
-      if (attempt >= 3) throw new PartnerError("shipping", res.status);
-      await deps.sleep(100 * 2 ** (attempt - 1));
-    }
+      if (res.status < 500) return { kind: "success", value: res };
+      return { kind: "retry", delayMs: 100 * 2 ** (attemptNumber - 1), error: new PartnerError("shipping", res.status) };
+    });
   }
 
   return {
diff --git a/src/clients/tax.ts b/src/clients/tax.ts
index 10145fe..6e1aa0c 100644
--- a/src/clients/tax.ts
+++ b/src/clients/tax.ts
@@ -1,20 +1,18 @@
 import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
+import { withRetry } from "../retry.ts";
 
 export function createTaxClient(deps: { http: Http; sleep: Sleep }) {
   async function get(url: string): Promise<HttpResponse> {
-    let lastError: unknown;
-    for (let attempt = 0; attempt < 3; attempt++) {
-      if (attempt > 0) await deps.sleep(50);
+    return withRetry(deps.sleep, 3, async () => {
       try {
         const res = await deps.http({ method: "GET", url });
-        if (res.status !== 503) return res;
-        lastError = new PartnerError("tax", res.status);
+        if (res.status !== 503) return { kind: "success", value: res };
+        return { kind: "retry", delayMs: 50, error: new PartnerError("tax", res.status) };
       } catch (error) {
         if (error instanceof PartnerError) throw error;
-        lastError = error;
+        return { kind: "retry", delayMs: 50, error };
       }
-    }
-    throw lastError;
+    });
   }
 
   return {
diff --git a/src/retry.ts b/src/retry.ts
new file mode 100644
index 0000000..cda5473
--- /dev/null
+++ b/src/retry.ts
@@ -0,0 +1,29 @@
+import type { Sleep } from "./http.ts";
+
+/**
+ * The result of one attempt inside `withRetry`. `retry` carries the delay to wait
+ * before the next attempt and the error to raise if this was the last one.
+ */
+export type AttemptOutcome<T> = { kind: "success"; value: T } | { kind: "retry"; delayMs: number; error: unknown };
+
+/**
+ * Runs `attempt` up to `maxAttempts` times, sleeping between failures for the
+ * duration each attempt reports. Each partner client supplies its own retryability
+ * check and backoff formula through `attempt`; this helper only owns the loop,
+ * attempt counting, and final-error propagation shared by all of them.
+ */
+export async function withRetry<T>(
+  sleep: Sleep,
+  maxAttempts: number,
+  attempt: (attemptNumber: number) => Promise<AttemptOutcome<T>>,
+): Promise<T> {
+  let lastError: unknown;
+  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
+    const outcome = await attempt(attemptNumber);
+    if (outcome.kind === "success") return outcome.value;
+    lastError = outcome.error;
+    if (attemptNumber === maxAttempts) break;
+    await sleep(outcome.delayMs);
+  }
+  throw lastError;
+}
diff --git a/test/retry-pin.test.ts b/test/retry-pin.test.ts
new file mode 100644
index 0000000..86070bf
--- /dev/null
+++ b/test/retry-pin.test.ts
@@ -0,0 +1,147 @@
+// Characterization tests pinning today's retry timing/count/backoff behavior for each
+// partner client, before extracting a shared retry helper. Any refactor must keep these green.
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { createPaymentsClient } from "../src/clients/payments.ts";
+import { createShippingClient } from "../src/clients/shipping.ts";
+import { createTaxClient } from "../src/clients/tax.ts";
+import { PartnerError, type HttpResponse } from "../src/http.ts";
+
+const ok = (status: number, body: unknown = null, headers: Record<string, string> = {}): HttpResponse => ({
+  status,
+  headers,
+  body,
+});
+
+function recordingSleep() {
+  const calls: number[] = [];
+  const sleep = async (ms: number) => {
+    calls.push(ms);
+  };
+  return { sleep, calls };
+}
+
+test("shipping retries up to 3 attempts total with 100ms exponential backoff, then throws", async () => {
+  let calls = 0;
+  const { sleep, calls: delays } = recordingSleep();
+  const client = createShippingClient({
+    http: async () => {
+      calls++;
+      return ok(502);
+    },
+    sleep,
+  });
+  await assert.rejects(
+    () => client.quote({ weightGrams: 500, toZip: "89501" }),
+    (error: unknown) => error instanceof PartnerError && error.status === 502,
+  );
+  assert.equal(calls, 3, "shipping makes exactly 3 http calls before giving up");
+  assert.deepEqual(delays, [100, 200], "shipping backs off 100ms then 200ms between the 3 calls");
+});
+
+test("shipping does not retry on 4xx", async () => {
+  let calls = 0;
+  const client = createShippingClient({
+    http: async () => {
+      calls++;
+      return ok(404);
+    },
+    sleep: async () => assert.fail("should not sleep on non-retryable status"),
+  });
+  await assert.rejects(() => client.quote({ weightGrams: 500, toZip: "89501" }), PartnerError);
+  assert.equal(calls, 1);
+});
+
+test("payments retries up to 5 attempts with 200ms exponential backoff on 5xx, then throws", async () => {
+  let calls = 0;
+  const { sleep, calls: delays } = recordingSleep();
+  const client = createPaymentsClient({
+    http: async () => {
+      calls++;
+      return ok(500);
+    },
+    sleep,
+  });
+  await assert.rejects(
+    () => client.charge("cus_1", 100),
+    (error: unknown) => error instanceof PartnerError && error.status === 500,
+  );
+  assert.equal(calls, 5, "payments makes exactly 5 http calls before giving up");
+  assert.deepEqual(delays, [200, 400, 800, 1600], "payments backs off 200ms doubling between the 5 calls");
+});
+
+test("payments honors retry-after header (seconds) on 429 instead of exponential backoff", async () => {
+  const { sleep, calls: delays } = recordingSleep();
+  const replies = [ok(429, null, { "retry-after": "2" }), ok(201, { id: "ch_1" })];
+  const client = createPaymentsClient({ http: async () => replies.shift()!, sleep });
+  const id = await client.charge("cus_1", 100);
+  assert.equal(id, "ch_1");
+  assert.deepEqual(delays, [2000], "429 with retry-after: 2 waits 2000ms, not the exponential formula");
+});
+
+test("payments falls back to exponential backoff when retry-after is absent on 429", async () => {
+  const { sleep, calls: delays } = recordingSleep();
+  const replies = [ok(429), ok(201, { id: "ch_1" })];
+  const client = createPaymentsClient({ http: async () => replies.shift()!, sleep });
+  await client.charge("cus_1", 100);
+  assert.deepEqual(delays, [200]);
+});
+
+test("tax retries up to 3 attempts total with a fixed 50ms delay on 503, then throws", async () => {
+  let calls = 0;
+  const { sleep, calls: delays } = recordingSleep();
+  const client = createTaxClient({
+    http: async () => {
+      calls++;
+      return ok(503);
+    },
+    sleep,
+  });
+  await assert.rejects(
+    () => client.rate("94105"),
+    (error: unknown) => error instanceof PartnerError && error.status === 503,
+  );
+  assert.equal(calls, 3, "tax makes exactly 3 http calls before giving up");
+  assert.deepEqual(delays, [50, 50], "tax waits a fixed 50ms between the 3 calls, not exponential");
+});
+
+test("tax retries thrown network errors (not just 503 responses) and rethrows the last one", async () => {
+  let calls = 0;
+  const networkError = new Error("ECONNRESET");
+  const client = createTaxClient({
+    http: async () => {
+      calls++;
+      throw networkError;
+    },
+    sleep: async () => {},
+  });
+  await assert.rejects(() => client.rate("94105"), (error: unknown) => error === networkError);
+  assert.equal(calls, 3);
+});
+
+test("tax rethrows a PartnerError thrown by http immediately, without retrying", async () => {
+  let calls = 0;
+  const thrown = new PartnerError("tax", 400);
+  const client = createTaxClient({
+    http: async () => {
+      calls++;
+      throw thrown;
+    },
+    sleep: async () => assert.fail("should not sleep when rethrowing a PartnerError immediately"),
+  });
+  await assert.rejects(() => client.rate("94105"), (error: unknown) => error === thrown);
+  assert.equal(calls, 1, "a thrown PartnerError bypasses retrying entirely");
+});
+
+test("tax does not retry on a non-503 status", async () => {
+  let calls = 0;
+  const client = createTaxClient({
+    http: async () => {
+      calls++;
+      return ok(404);
+    },
+    sleep: async () => assert.fail("should not sleep on non-retryable status"),
+  });
+  await assert.rejects(() => client.rate("94105"), PartnerError);
+  assert.equal(calls, 1);
+});

```

### Submission 2

Project test suite after the change: 9/9 passing.

Shell commands run, in order:

```text
find <workdir-root>/partner-clients -type f -name "*.py" -o -type f -name "*.js" -o -type f -name "*.ts" -o -type f -name "*.go" | head -50
cat > <workdir-root>/partner-clients/src/clients/shipping.ts << 'EOF'
  import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
  import { retryLoop } from "../retry.ts";
  
  export type Parcel = { weightGrams: number; toZip: string };
  
  export function createShippingClient(deps: { http: Http; sleep: Sleep }) {
    async function send(url: string, body: unknown): Promise<HttpResponse> {
      return retryLoop<HttpResponse>({
        maxAttempts: 3,
        sleep: deps.sleep,
        delayMs: (attempt) => 100 * 2 ** (attempt - 1),
        step: async () => {
          const res = await deps.http({ method: "POST", url, body });
          if (res.status < 500) return { done: true, value: res };
          return { done: false, error: res };
        },
        onExhausted: (lastError) => {
          throw new PartnerError("shipping", (lastError as HttpResponse).status);
        },
      });
    }
  
    return {
      async quote(parcel: Parcel): Promise<number> {
        const res = await send("https://ship.example/quote", parcel);
        if (res.status !== 200) throw new PartnerError("shipping", res.status);
        return (res.body as { cents: number }).cents;
      },
    };
  }
  EOF
cat > <workdir-root>/partner-clients/src/clients/payments.ts << 'EOF'
  import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
  import { retryLoop } from "../retry.ts";
  
  export function createPaymentsClient(deps: { http: Http; sleep: Sleep }) {
    async function send(url: string, body: unknown): Promise<HttpResponse> {
      return retryLoop<HttpResponse>({
        maxAttempts: 5,
        sleep: deps.sleep,
        delayMs: (attempt, lastError) => {
          const res = lastError as HttpResponse;
          const retryAfter = Number(res.headers["retry-after"]);
          return res.status === 429 && retryAfter > 0 ? retryAfter * 1000 : 200 * 2 ** (attempt - 1);
        },
        step: async () => {
          const res = await deps.http({ method: "POST", url, body });
          const retryable = res.status >= 500 || res.status === 429;
          if (!retryable) return { done: true, value: res };
          return { done: false, error: res };
        },
        onExhausted: (lastError) => {
          throw new PartnerError("payments", (lastError as HttpResponse).status);
        },
      });
    }
  
    return {
      async charge(customerId: string, cents: number): Promise<string> {
        const res = await send("https://pay.example/charges", { customerId, cents });
        if (res.status !== 201) throw new PartnerError("payments", res.status);
        return (res.body as { id: string }).id;
      },
    };
  }
  EOF
cat > <workdir-root>/partner-clients/src/clients/tax.ts << 'EOF'
  import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
  import { retryLoop } from "../retry.ts";
  
  export function createTaxClient(deps: { http: Http; sleep: Sleep }) {
    async function get(url: string): Promise<HttpResponse> {
      return retryLoop<HttpResponse>({
        maxAttempts: 3,
        sleep: deps.sleep,
        delayBeforeEachAttempt: true,
        delayMs: () => 50,
        step: async () => {
          try {
            const res = await deps.http({ method: "GET", url });
            if (res.status !== 503) return { done: true, value: res };
            return { done: false, error: new PartnerError("tax", res.status) };
          } catch (error) {
            if (error instanceof PartnerError) throw error;
            return { done: false, error };
          }
        },
        onExhausted: (lastError) => {
          throw lastError;
        },
      });
    }
  
    return {
      async rate(zip: string): Promise<number> {
        const res = await get(`https://tax.example/rates/${zip}`);
        if (res.status !== 200) throw new PartnerError("tax", res.status);
        return (res.body as { rate: number }).rate;
      },
    };
  }
  EOF
cd <workdir-root>/partner-clients && cat package.json
cd <workdir-root>/partner-clients && node --version && npx tsc --version 2>&1 | head -5
cd <workdir-root>/partner-clients && npm test 2>&1
cd <workdir-root>/partner-clients && cat > /tmp/parity.test.ts << 'EOF'
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { createPaymentsClient } from "./src/clients/payments.ts";
  import { createShippingClient } from "./src/clients/shipping.ts";
  import { createTaxClient } from "./src/clients/tax.ts";
  import { PartnerError, type HttpResponse } from "./src/http.ts";
  
  const ok = (status: number, body: unknown, headers: Record<string,string> = {}): HttpResponse => ({ status, headers, body });
  
  function recordingSleep() {
    const delays: number[] = [];
    return { sleep: async (ms: number) => { delays.push(ms); }, delays };
  }
  
  test("shipping: 3 max attempts, exp backoff 100/200, throws PartnerError after 3rd 500", async () => {
    const { sleep, delays } = recordingSleep();
    const replies = [ok(500, null), ok(500, null), ok(503, null)];
    const client = createShippingClient({ http: async () => replies.shift()!, sleep });
    await assert.rejects(() => client.quote({ weightGrams: 1, toZip: "1" }), (e: any) => {
      assert.ok(e instanceof PartnerError);
      assert.equal(e.status, 503);
      return true;
    });
    assert.deepEqual(delays, [100, 200]);
  });
  
  test("payments: 5 max attempts, retries on 429 with retry-after header in seconds, else exp backoff 200*2^n", async () => {
    const { sleep, delays } = recordingSleep();
    const replies = [
      ok(500, null),
      ok(429, null, { "retry-after": "3" }),
      ok(500, null),
      ok(502, null),
      ok(500, null),
    ];
    const client = createPaymentsClient({ http: async () => replies.shift()!, sleep });
    await assert.rejects(() => client.charge("c", 1), (e: any) => {
      assert.ok(e instanceof PartnerError);
      assert.equal(e.status, 500);
      return true;
    });
    // attempt1(500)->200, attempt2(429,retryAfter3)->3000, attempt3(500)->800, attempt4(502)->1600
    assert.deepEqual(delays, [200, 3000, 800, 1600]);
  });
  
  test("tax: 3 max attempts, fixed 50ms pre-delay, retries only on 503, rethrows other errors as-is", async () => {
    const { sleep, delays } = recordingSleep();
    const replies = [ok(503, null), ok(503, null), ok(503, null)];
    const client = createTaxClient({ http: async () => replies.shift()!, sleep });
    await assert.rejects(() => client.rate("1"), (e: any) => {
      assert.ok(e instanceof PartnerError);
      assert.equal(e.status, 503);
      return true;
    });
    assert.deepEqual(delays, [50, 50]);
  });
  
  test("tax: non-PartnerError thrown by http propagates after retries exhausted", async () => {
    const { sleep } = recordingSleep();
    const boom = new Error("network down");
    const client = createTaxClient({ http: async () => { throw boom; }, sleep });
    await assert.rejects(() => client.rate("1"), (e: any) => e === boom);
  });
  
  test("tax: succeeds on 2nd attempt after a 503", async () => {
    const { sleep, delays } = recordingSleep();
    const replies = [ok(503, null), ok(200, { rate: 0.05 })];
    const client = createTaxClient({ http: async () => replies.shift()!, sleep });
    assert.equal(await client.rate("1"), 0.05);
    assert.deepEqual(delays, [50]);
  });
  EOF
  cp /tmp/parity.test.ts test/parity.test.ts
  npx --yes node --test test/parity.test.ts 2>&1
cd <workdir-root>/partner-clients && node --test test/parity.test.ts 2>&1
ls <workdir-root>/partner-clients/test/ ; ls /tmp/parity.test.ts
cd <workdir-root>/partner-clients && node --test test/ 2>&1
cd <workdir-root>/partner-clients && npm test 2>&1
cd <workdir-root>/partner-clients && git status --short
```

Diff against the starting commit:

```diff
diff --git a/src/clients/payments.ts b/src/clients/payments.ts
index 09ec57c..092d0ae 100644
--- a/src/clients/payments.ts
+++ b/src/clients/payments.ts
@@ -1,16 +1,26 @@
 import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
+import { retryLoop } from "../retry.ts";
 
 export function createPaymentsClient(deps: { http: Http; sleep: Sleep }) {
   async function send(url: string, body: unknown): Promise<HttpResponse> {
-    for (let attempt = 1; ; attempt++) {
-      const res = await deps.http({ method: "POST", url, body });
-      const retryable = res.status >= 500 || res.status === 429;
-      if (!retryable) return res;
-      if (attempt === 5) throw new PartnerError("payments", res.status);
-      const retryAfter = Number(res.headers["retry-after"]);
-      const delay = res.status === 429 && retryAfter > 0 ? retryAfter * 1000 : 200 * 2 ** (attempt - 1);
-      await deps.sleep(delay);
-    }
+    return retryLoop<HttpResponse>({
+      maxAttempts: 5,
+      sleep: deps.sleep,
+      delayMs: (attempt, lastError) => {
+        const res = lastError as HttpResponse;
+        const retryAfter = Number(res.headers["retry-after"]);
+        return res.status === 429 && retryAfter > 0 ? retryAfter * 1000 : 200 * 2 ** (attempt - 1);
+      },
+      step: async () => {
+        const res = await deps.http({ method: "POST", url, body });
+        const retryable = res.status >= 500 || res.status === 429;
+        if (!retryable) return { done: true, value: res };
+        return { done: false, error: res };
+      },
+      onExhausted: (lastError) => {
+        throw new PartnerError("payments", (lastError as HttpResponse).status);
+      },
+    });
   }
 
   return {
diff --git a/src/clients/shipping.ts b/src/clients/shipping.ts
index 3b813f2..876ae3a 100644
--- a/src/clients/shipping.ts
+++ b/src/clients/shipping.ts
@@ -1,17 +1,23 @@
 import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
+import { retryLoop } from "../retry.ts";
 
 export type Parcel = { weightGrams: number; toZip: string };
 
 export function createShippingClient(deps: { http: Http; sleep: Sleep }) {
   async function send(url: string, body: unknown): Promise<HttpResponse> {
-    let attempt = 0;
-    while (true) {
-      const res = await deps.http({ method: "POST", url, body });
-      if (res.status < 500) return res;
-      attempt++;
-      if (attempt >= 3) throw new PartnerError("shipping", res.status);
-      await deps.sleep(100 * 2 ** (attempt - 1));
-    }
+    return retryLoop<HttpResponse>({
+      maxAttempts: 3,
+      sleep: deps.sleep,
+      delayMs: (attempt) => 100 * 2 ** (attempt - 1),
+      step: async () => {
+        const res = await deps.http({ method: "POST", url, body });
+        if (res.status < 500) return { done: true, value: res };
+        return { done: false, error: res };
+      },
+      onExhausted: (lastError) => {
+        throw new PartnerError("shipping", (lastError as HttpResponse).status);
+      },
+    });
   }
 
   return {
diff --git a/src/clients/tax.ts b/src/clients/tax.ts
index 10145fe..b1d729e 100644
--- a/src/clients/tax.ts
+++ b/src/clients/tax.ts
@@ -1,20 +1,27 @@
 import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
+import { retryLoop } from "../retry.ts";
 
 export function createTaxClient(deps: { http: Http; sleep: Sleep }) {
   async function get(url: string): Promise<HttpResponse> {
-    let lastError: unknown;
-    for (let attempt = 0; attempt < 3; attempt++) {
-      if (attempt > 0) await deps.sleep(50);
-      try {
-        const res = await deps.http({ method: "GET", url });
-        if (res.status !== 503) return res;
-        lastError = new PartnerError("tax", res.status);
-      } catch (error) {
-        if (error instanceof PartnerError) throw error;
-        lastError = error;
-      }
-    }
-    throw lastError;
+    return retryLoop<HttpResponse>({
+      maxAttempts: 3,
+      sleep: deps.sleep,
+      delayBeforeEachAttempt: true,
+      delayMs: () => 50,
+      step: async () => {
+        try {
+          const res = await deps.http({ method: "GET", url });
+          if (res.status !== 503) return { done: true, value: res };
+          return { done: false, error: new PartnerError("tax", res.status) };
+        } catch (error) {
+          if (error instanceof PartnerError) throw error;
+          return { done: false, error };
+        }
+      },
+      onExhausted: (lastError) => {
+        throw lastError;
+      },
+    });
   }
 
   return {
diff --git a/src/retry.ts b/src/retry.ts
new file mode 100644
index 0000000..6bb66e2
--- /dev/null
+++ b/src/retry.ts
@@ -0,0 +1,42 @@
+import type { Sleep } from "./http.ts";
+
+export type StepOutcome<T> = { done: true; value: T } | { done: false; error: unknown };
+
+export type RetryOptions<T> = {
+  /** Total number of attempts allowed before giving up. */
+  maxAttempts: number;
+  sleep: Sleep;
+  /**
+   * When true, the delay happens before attempts 2..maxAttempts (tax-style
+   * polling). When false/omitted, the delay happens after a retryable
+   * attempt, before the next one (shipping/payments-style backoff).
+   */
+  delayBeforeEachAttempt?: boolean;
+  /** Delay (ms) to wait, given the number of attempts made so far and the error/response from the most recent attempt. */
+  delayMs: (attemptsSoFar: number, lastError: unknown) => number;
+  /** Perform one attempt. Return `done: true` to stop, or `done: false` with the error/response to retry on. */
+  step: (attempt: number) => Promise<StepOutcome<T>>;
+  /** Called once attempts are exhausted; must throw. */
+  onExhausted: (lastError: unknown, attempts: number) => never;
+};
+
+export async function retryLoop<T>(opts: RetryOptions<T>): Promise<T> {
+  let lastError: unknown;
+  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
+    if (opts.delayBeforeEachAttempt && attempt > 1) {
+      await opts.sleep(opts.delayMs(attempt - 1, lastError));
+    }
+
+    const outcome = await opts.step(attempt);
+    if (outcome.done) return outcome.value;
+    lastError = outcome.error;
+
+    if (!opts.delayBeforeEachAttempt) {
+      if (attempt >= opts.maxAttempts) {
+        opts.onExhausted(lastError, attempt);
+      }
+      await opts.sleep(opts.delayMs(attempt, lastError));
+    }
+  }
+  opts.onExhausted(lastError, opts.maxAttempts);
+}
diff --git a/test/parity.test.ts b/test/parity.test.ts
new file mode 100644
index 0000000..7eaeb17
--- /dev/null
+++ b/test/parity.test.ts
@@ -0,0 +1,75 @@
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { createPaymentsClient } from "../src/clients/payments.ts";
+import { createShippingClient } from "../src/clients/shipping.ts";
+import { createTaxClient } from "../src/clients/tax.ts";
+import { PartnerError, type HttpResponse } from "../src/http.ts";
+
+const ok = (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse => ({
+  status,
+  headers,
+  body,
+});
+
+function recordingSleep() {
+  const delays: number[] = [];
+  return { sleep: async (ms: number) => { delays.push(ms); }, delays };
+}
+
+test("shipping: 3 max attempts, exp backoff 100/200, throws PartnerError after 3rd 500", async () => {
+  const { sleep, delays } = recordingSleep();
+  const replies = [ok(500, null), ok(500, null), ok(503, null)];
+  const client = createShippingClient({ http: async () => replies.shift()!, sleep });
+  await assert.rejects(() => client.quote({ weightGrams: 1, toZip: "1" }), (e: any) => {
+    assert.ok(e instanceof PartnerError);
+    assert.equal(e.status, 503);
+    return true;
+  });
+  assert.deepEqual(delays, [100, 200]);
+});
+
+test("payments: 5 max attempts, retries on 429 with retry-after header in seconds, else exp backoff 200*2^n", async () => {
+  const { sleep, delays } = recordingSleep();
+  const replies = [
+    ok(500, null),
+    ok(429, null, { "retry-after": "3" }),
+    ok(500, null),
+    ok(502, null),
+    ok(500, null),
+  ];
+  const client = createPaymentsClient({ http: async () => replies.shift()!, sleep });
+  await assert.rejects(() => client.charge("c", 1), (e: any) => {
+    assert.ok(e instanceof PartnerError);
+    assert.equal(e.status, 500);
+    return true;
+  });
+  // attempt1(500)->200, attempt2(429,retryAfter3)->3000, attempt3(500)->800, attempt4(502)->1600
+  assert.deepEqual(delays, [200, 3000, 800, 1600]);
+});
+
+test("tax: 3 max attempts, fixed 50ms pre-delay, retries only on 503, rethrows other errors as-is", async () => {
+  const { sleep, delays } = recordingSleep();
+  const replies = [ok(503, null), ok(503, null), ok(503, null)];
+  const client = createTaxClient({ http: async () => replies.shift()!, sleep });
+  await assert.rejects(() => client.rate("1"), (e: any) => {
+    assert.ok(e instanceof PartnerError);
+    assert.equal(e.status, 503);
+    return true;
+  });
+  assert.deepEqual(delays, [50, 50]);
+});
+
+test("tax: non-PartnerError thrown by http propagates after retries exhausted", async () => {
+  const { sleep } = recordingSleep();
+  const boom = new Error("network down");
+  const client = createTaxClient({ http: async () => { throw boom; }, sleep });
+  await assert.rejects(() => client.rate("1"), (e: any) => e === boom);
+});
+
+test("tax: succeeds on 2nd attempt after a 503", async () => {
+  const { sleep, delays } = recordingSleep();
+  const replies = [ok(503, null), ok(200, { rate: 0.05 })];
+  const client = createTaxClient({ http: async () => replies.shift()!, sleep });
+  assert.equal(await client.rate("1"), 0.05);
+  assert.deepEqual(delays, [50]);
+});

```

## P4

Request:

> Ops wants to pull the stock report into a spreadsheet. Please add a csv option to `report --format`: one row per item with the same columns as the table view, and it has to open cleanly in Excel even when product names contain commas, quotes, or line breaks.

### Submission 1

Project test suite after the change: 3/3 passing.

Shell commands run, in order:

```text
grep -rn "format" --include=*.* -l <workdir-root>/stock-report -i 2>/dev/null | grep -v node_modules | grep -v .git
cd <workdir-root>/stock-report && cat README.md | grep -n -i format -A3 -B3; cat package.json
cd <workdir-root>/stock-report && npm test 2>&1 | tail -40
cd <workdir-root>/stock-report && node src/main.ts report --format csv | cat -A | head -10
cd <workdir-root>/stock-report && node src/main.ts report --format csv > /tmp/out.csv && xxd /tmp/out.csv | head -20 && echo "---" && cat /tmp/out.csv
cd <workdir-root>/stock-report && node src/main.ts report --format csv > out.csv && od -c out.csv | head -20 && echo "---" && cat out.csv; rm out.csv
cd <workdir-root>/stock-report && npm test 2>&1 | tail -15
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index b09e447..5e8d9ca 100644
--- a/README.md
+++ b/README.md
@@ -5,6 +5,7 @@ Command-line stock reports for the warehouse team.
 ```shell
 node src/main.ts report                      # table
 node src/main.ts report --format json
+node src/main.ts report --format csv
 node src/main.ts report --warehouse RNO
 ```
 
diff --git a/src/args.ts b/src/args.ts
index 5bca167..f418dde 100644
--- a/src/args.ts
+++ b/src/args.ts
@@ -1,9 +1,9 @@
 export type ReportOptions = {
-  format: "table" | "json";
+  format: "table" | "json" | "csv";
   warehouse?: string;
 };
 
-const FORMATS = ["table", "json"] as const;
+const FORMATS = ["table", "json", "csv"] as const;
 
 export function parseReportArgs(args: string[]): ReportOptions {
   const options: ReportOptions = { format: "table" };
diff --git a/src/cli.ts b/src/cli.ts
index 2cdbc5a..dc62fef 100644
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -1,4 +1,5 @@
 import { parseReportArgs } from "./args.ts";
+import { formatCsv } from "./format/csv.ts";
 import { formatJson } from "./format/json.ts";
 import { formatTable } from "./format/table.ts";
 import { type Item, SAMPLE_ITEMS, selectItems } from "./inventory.ts";
@@ -17,6 +18,8 @@ export function run(argv: string[], deps: Deps = defaultDeps): string {
   switch (options.format) {
     case "json":
       return formatJson(items);
+    case "csv":
+      return formatCsv(items);
     case "table":
       return formatTable(items);
   }
diff --git a/src/format/csv.ts b/src/format/csv.ts
new file mode 100644
index 0000000..02d91dc
--- /dev/null
+++ b/src/format/csv.ts
@@ -0,0 +1,14 @@
+import type { Item } from "../inventory.ts";
+import { COLUMNS } from "./table.ts";
+
+function escapeCsvField(value: string): string {
+  if (/[",\r\n]/.test(value)) {
+    return `"${value.replace(/"/g, '""')}"`;
+  }
+  return value;
+}
+
+export function formatCsv(items: Item[]): string {
+  const rows = [COLUMNS.map((c) => c.header), ...items.map((item) => COLUMNS.map((c) => c.value(item)))];
+  return rows.map((r) => r.map(escapeCsvField).join(",")).join("\r\n");
+}

```

### Submission 2

Project test suite after the change: 6/6 passing.

Shell commands run, in order:

```text
cd <workdir-root>/stock-report && find . -not -path './.git/*' -type f | head -100
cd <workdir-root>/stock-report && git remote -v && git status && cat package.json
cd <workdir-root>/stock-report && cat src/inventory.ts src/format/table.ts src/format/json.ts src/args.ts src/cli.ts
cd <workdir-root>/stock-report && cat test/cli.test.ts
cd <workdir-root>/stock-report && node --test 2>&1
cd <workdir-root>/stock-report && git status --short && echo --- && git diff --stat
cd <workdir-root>/stock-report && git --no-pager diff
cd <workdir-root>/stock-report && cat src/format/csv.ts
cd <workdir-root>/stock-report && node --test 2>&1 | tail -30 && echo "---manual csv output---" && node src/main.ts report --format csv | cat -A | head -8
cd <workdir-root>/stock-report && node src/main.ts report --format csv > /tmp/out.csv; hexdump -C /tmp/out.csv | head -20 && echo "---" && cat /tmp/out.csv
cd <workdir-root>/stock-report && node src/main.ts report --format csv > out.csv 2>/dev/null; od -c out.csv | head -20; echo "---content---"; sed -n '1,10p' out.csv; rm out.csv
cd <workdir-root>/stock-report && git add -A && git commit -m "$(cat <<'EOF'
  Add csv format to report --format
  
  One row per item with the same columns as the table view (SKU, Name,
  Warehouse, Qty), reusing table.ts's COLUMNS as the single source of
  truth. Fields are RFC4180-quoted (wrapped in double quotes, embedded
  quotes doubled) when they contain a comma, quote, or line break, and
  rows are CRLF-terminated so the file opens cleanly in Excel.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  EOF
  )" && git --no-pager log -1 --stat
cd <workdir-root>/stock-report && git commit -m "Add csv format to report --format" -m "One row per item with the same columns as the table view (SKU, Name, Warehouse, Qty), reusing table.ts COLUMNS as the single source of truth. Fields are RFC4180-quoted (wrapped in double quotes, embedded quotes doubled) when they contain a comma, quote, or line break, and rows are CRLF-terminated so the file opens cleanly in Excel." -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git --no-pager log -1 --stat
cd <workdir-root>/stock-report && git add -A && git commit -m "Add csv format to report --format" -m "One row per item with the same columns as the table view (SKU, Name, Warehouse, Qty), reusing table.ts COLUMNS as the single source of truth. Fields are RFC4180-quoted (wrapped in double quotes, embedded quotes doubled) when they contain a comma, quote, or line break, and rows are CRLF-terminated so the file opens cleanly in Excel." -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git --no-pager log -1 --stat
```

Diff against the starting commit:

```diff
diff --git a/src/args.ts b/src/args.ts
index 5bca167..f418dde 100644
--- a/src/args.ts
+++ b/src/args.ts
@@ -1,9 +1,9 @@
 export type ReportOptions = {
-  format: "table" | "json";
+  format: "table" | "json" | "csv";
   warehouse?: string;
 };
 
-const FORMATS = ["table", "json"] as const;
+const FORMATS = ["table", "json", "csv"] as const;
 
 export function parseReportArgs(args: string[]): ReportOptions {
   const options: ReportOptions = { format: "table" };
diff --git a/src/cli.ts b/src/cli.ts
index 2cdbc5a..a640026 100644
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -1,4 +1,5 @@
 import { parseReportArgs } from "./args.ts";
+import { formatCsv } from "./format/csv.ts";
 import { formatJson } from "./format/json.ts";
 import { formatTable } from "./format/table.ts";
 import { type Item, SAMPLE_ITEMS, selectItems } from "./inventory.ts";
@@ -19,5 +20,7 @@ export function run(argv: string[], deps: Deps = defaultDeps): string {
       return formatJson(items);
     case "table":
       return formatTable(items);
+    case "csv":
+      return formatCsv(items);
   }
 }
diff --git a/src/format/csv.ts b/src/format/csv.ts
new file mode 100644
index 0000000..b1c012c
--- /dev/null
+++ b/src/format/csv.ts
@@ -0,0 +1,14 @@
+import type { Item } from "../inventory.ts";
+import { COLUMNS } from "./table.ts";
+
+function escapeField(field: string): string {
+  if (/[",\r\n]/.test(field)) {
+    return `"${field.replace(/"/g, '""')}"`;
+  }
+  return field;
+}
+
+export function formatCsv(items: Item[]): string {
+  const rows = [COLUMNS.map((c) => c.header), ...items.map((item) => COLUMNS.map((c) => c.value(item)))];
+  return rows.map((r) => r.map(escapeField).join(",")).join("\r\n") + "\r\n";
+}
diff --git a/test/cli.test.ts b/test/cli.test.ts
index a45759e..703cd81 100644
--- a/test/cli.test.ts
+++ b/test/cli.test.ts
@@ -18,3 +18,22 @@ test("json report filters by warehouse", () => {
 test("unknown formats are rejected", () => {
   assert.throws(() => run(["report", "--format", "xml"]), /Unknown format: xml/);
 });
+
+test("csv report has a header row and one row per item", () => {
+  const rows = run(["report", "--format", "csv"]).split("\r\n").filter((r) => r.length > 0);
+  assert.equal(rows[0], "SKU,Name,Warehouse,Qty");
+  assert.equal(rows.length, 5);
+  assert.match(rows[1], /^BK-100,/);
+});
+
+test("csv report quotes and escapes names containing commas or double quotes", () => {
+  const out = run(["report", "--format", "csv"]);
+  assert.match(out, /"Oil filter 3\/4"" thread"/);
+});
+
+test("csv report rows are separated by CRLF", () => {
+  const out = run(["report", "--format", "csv"]);
+  assert.match(out, /\r\n/);
+  const withoutCrlf = out.replace(/\r\n/g, "");
+  assert.equal(withoutCrlf.includes("\n"), false);
+});

```
