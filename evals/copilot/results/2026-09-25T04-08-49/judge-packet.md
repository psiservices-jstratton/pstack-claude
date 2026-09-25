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
find . -type f -name "*.go" -o -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.java" -o -name "*.rb" | grep -v node_modules | grep -v vendor | head -100
find . -maxdepth 3 -type d | grep -v node_modules | grep -v '.git'
cd <workdir-root>/billing-core && cat package.json 2>/dev/null; ls
cd <workdir-root>/billing-core && node --version && npm test 2>&1 | tail -60
cd <workdir-root>/billing-core && node --experimental-strip-types -e "
  import('./src/invoice.ts').then(async ({ buildInvoice }) => {
    const customer = (id) => ({ id, tier: 'gold', state: 'CA' });
    const lines = [{ sku: 'x', unitPrice: 1000, quantity: 1 }];
    console.log('with promo:', buildInvoice(customer('c1'), lines, { promoCode: 'SPRING5', today: '2025-01-01' }));
    console.log('no promo #1:', buildInvoice(customer('c2'), lines, { today: '2025-01-01' }));
    console.log('no promo #2:', buildInvoice(customer('c3'), lines, { today: '2025-01-01' }));
  });
  "
  
```

Diff against the starting commit:

```diff
diff --git a/src/pricing/rules.ts b/src/pricing/rules.ts
index d098b92..9f97556 100644
--- a/src/pricing/rules.ts
+++ b/src/pricing/rules.ts
@@ -18,7 +18,8 @@ export function ruleFor(tier: string): DiscountRule {
     rule = RULES[tier] ?? RULES.basic;
     cache.set(tier, rule);
   }
-  return rule;
+  // Return a fresh copy so callers can never mutate the cached/shared rule.
+  return { ...rule };
 }
 
 export function knownTiers(): string[] {
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
cd <workdir-root>/billing-core && git log --oneline -10 && echo --- && find . -type f \( -iname "*.py" -o -iname "*.ts" -o -iname "*.js" -o -iname "*.go" -o -iname "*.java" -o -iname "*.rb" \) -not -path "*/node_modules/*" -not -path "*/.git/*" | xargs grep -liE "promo|discount" 2>/dev/null
cd <workdir-root>/billing-core && cat package.json
cd <workdir-root>/billing-core && npm test 2>&1 | tail -30
cd <workdir-root>/billing-core && npm test 2>&1 | tail -40
cd <workdir-root>/billing-core && npm test 2>&1 | tail -20
cd <workdir-root>/billing-core && git diff --stat && git status --short
cd <workdir-root>/billing-core && \
  git add test/promotions.test.ts && \
  git commit -m "$(cat <<'EOF'
  test: reproduce promo discount leaking across customers on same tier
  
  ruleFor() caches one DiscountRule object per tier and withPromo()
  mutates that shared object in place, so a promo redeemed by one
  customer permanently raises the tier's cached discount for every
  other customer, stacking further with each redemption.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  EOF
  )" -q && \
  git add src/promotions.ts && \
  git commit -m "$(cat <<'EOF'
  fix: stop withPromo from mutating the shared cached DiscountRule
  
  withPromo() return a new rule object instead of mutating the one
  returned by ruleFor()'s cache, so a promo code only affects the
  invoice it was applied to.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  EOF
  )" -q && \
  git log --oneline -3
cd <workdir-root>/billing-core && cat > /tmp/commit-msg.txt <<'EOF'
  fix: stop withPromo from mutating the shared cached DiscountRule
  
  withPromo() now returns a new rule object instead of mutating the
  one returned by ruleFor()'s cache, so a promo code only affects the
  invoice it was applied to.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  EOF
  git add src/promotions.ts && git commit -q -F /tmp/commit-msg.txt && rm /tmp/commit-msg.txt && git log --oneline -3 && npm test 2>&1 | tail -15
cd <workdir-root>/billing-core && cat > ./.commit-msg.txt <<'EOF'
  fix: stop withPromo from mutating the shared cached DiscountRule
  
  withPromo() now returns a new rule object instead of mutating the
  one returned by ruleFor()'s cache, so a promo code only affects the
  invoice it was applied to.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  EOF
  git add src/promotions.ts && git commit -q -F ./.commit-msg.txt && rm ./.commit-msg.txt && git log --oneline -3
cd <workdir-root>/billing-core && npm test 2>&1 | tail -15 && git status --short
cd <workdir-root>/billing-core && git remote -v; git branch -a
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
diff --git a/test/promotions.test.ts b/test/promotions.test.ts
index 3de151c..be258f5 100644
--- a/test/promotions.test.ts
+++ b/test/promotions.test.ts
@@ -18,3 +18,14 @@ test("a promo stacks on the tier discount", () => {
   assert.equal(inv.discount, 800);
   assert.equal(inv.discountLabel, "Silver 5% + LOYAL3");
 });
+
+test("a promo used by one customer must not leak onto a later invoice for another customer on the same tier", () => {
+  const lines = [{ sku: "A-1", unitPrice: 10_000, quantity: 1 }];
+  buildInvoice({ id: "c10", tier: "silver", state: "OR" }, lines, {
+    promoCode: "LOYAL3",
+    today: "2026-03-01",
+  });
+  const later = buildInvoice({ id: "c11", tier: "silver", state: "OR" }, lines, { today: "2026-03-01" });
+  assert.equal(later.discount, 500, "should stay at the plain Silver 5% rate");
+  assert.equal(later.discountLabel, "Silver 5%");
+});

```

## P2

Request:

> Importing the latest CRM export (about 50k contacts) hangs for minutes on the dedupe step before anything gets uploaded. Can you make the import fast? The set of contacts we keep has to stay exactly the same as it is today.

### Submission 1

Project test suite after the change: 3/3 passing.

Shell commands run, in order:

```text
cd <workdir-root>/contacts-import && git log --oneline -5 && echo --- && find . -type f -not -path './.git/*' | grep -v node_modules | sort
cd <workdir-root>/contacts-import && node --version && npm test 2>&1 | tail -20
cat > /tmp/bench.mjs << 'EOF'
  import { performance } from "node:perf_hooks";
  
  // Generate ~50k synthetic contacts mirroring a CRM export: mostly unique,
  // with a realistic sprinkling of duplicate emails/phones and blanks.
  function genContacts(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const dupOf = i > 0 && i % 7 === 0 ? Math.floor(i / 2) : null;
      const email = dupOf !== null ? `person${dupOf}@example.com` : (i % 11 === 0 ? "" : `person${i}@example.com`);
      const phone = dupOf !== null ? `555010${dupOf % 10000}` : (i % 13 === 0 ? "" : `555${String(1000000 + i).slice(-7)}`);
      out.push({ id: `row-${i}`, name: `Name ${i}`, email, phone });
    }
    return out;
  }
  
  const n = Number(process.argv[3] || 50000);
  const contacts = genContacts(n);
  
  const modPath = process.argv[2];
  const { dedupeContacts } = await import(modPath);
  
  const t0 = performance.now();
  const kept = dedupeContacts(contacts);
  const t1 = performance.now();
  
  console.log(JSON.stringify({ n, keptCount: kept.length, keptIds: kept.map(c => c.id), ms: t1 - t0 }));
  EOF
  echo done
cd <workdir-root>/contacts-import && node bench.mjs ./src/dedupe.ts 50000 > /tmp_bench_baseline.json 2>&1; cat /tmp_bench_baseline.json 2>&1 | head -c 500
cd <workdir-root>/contacts-import && node bench.mjs ./src/dedupe.ts 50000
grep -o '"ms":[0-9.]*' /var/folders/lg/drsdlj9s0d9cgvj43kszxgvm0000gn/T/1790309501175-copilot-tool-output-77281-ae6025b1-9522-43f6-af72-4e225aaba034.txt
cp /var/folders/lg/drsdlj9s0d9cgvj43kszxgvm0000gn/T/1790309501175-copilot-tool-output-77281-ae6025b1-9522-43f6-af72-4e225aaba034.txt <workdir-root>/contacts-import/baseline_output.json
  wc -l <workdir-root>/contacts-import/baseline_output.json
cd <workdir-root>/contacts-import && npm test 2>&1 | tail -20
cd <workdir-root>/contacts-import && node bench.mjs ./src/dedupe.ts 50000
POST=/var/folders/lg/drsdlj9s0d9cgvj43kszxgvm0000gn/T/1790309530839-copilot-tool-output-77281-23b068e1-7b4b-482e-a3cc-e607c8266ed2.txt
  BASE=<workdir-root>/contacts-import/baseline_output.json
  grep -o '"ms":[0-9.]*' "$POST"
  python3 -c "
  import json
  a=json.load(open('$BASE'))
  b=json.load(open('$POST'))
  print('same keptCount:', a['keptCount']==b['keptCount'])
  print('same keptIds set:', a['keptIds']==b['keptIds'])
  print('baseline ms:', a['ms'], 'fixed ms:', b['ms'])
  "
cd <workdir-root>/contacts-import && git remote -v; git status --short
cd <workdir-root>/contacts-import && rm -f bench.mjs baseline_output.json && git add -A && git status --short && git --no-pager diff --cached
cd <workdir-root>/contacts-import && git commit -q -m "$(cat <<'EOF'
  Fix O(n^2) dedupe hang on large CRM imports
  
  dedupeContacts scanned every already-kept contact for each new row,
  re-normalizing both contacts' email and phone on every comparison. At
  50k contacts that is ~2.5 billion comparisons, which is why the import
  hung for minutes before anything uploaded.
  
  Replace the linear scan with two Set indexes (normalized email,
  normalized phone) so each contact is checked in O(1). The kept set is
  mathematically identical: the old code kept a contact when no prior
  kept contact matched on email or phone, which is the same condition as
  "this email is not yet indexed AND this phone is not yet indexed".
  
  Benchmarked on 50k synthetic contacts (mix of unique and duplicate
  email/phone, with blanks): baseline 83,793ms, fixed 15.8ms, ~5,300x
  faster. Verified the kept id set is byte-identical between the two
  implementations. Existing dedupe/importer tests still pass unchanged.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  EOF
  )" && git --no-pager log -1 --stat
cd <workdir-root>/contacts-import
  git commit -q -F - <<'MSG'
  Fix O(n^2) dedupe hang on large CRM imports
  
  dedupeContacts scanned every already-kept contact for each new row,
  re-normalizing both contacts' email and phone on every comparison. At
  50k contacts that is ~2.5 billion comparisons, which is why the import
  hung for minutes before anything uploaded.
  
  Replace the linear scan with two Set indexes (normalized email,
  normalized phone) so each contact is checked in O(1). The kept set is
  mathematically identical: the old code kept a contact when no prior
  kept contact matched on email or phone, which is the same condition as
  "this email is not yet indexed AND this phone is not yet indexed".
  
  Benchmarked on 50k synthetic contacts (mix of unique and duplicate
  email/phone, with blanks): baseline 83793ms, fixed 15.8ms, about 5300x
  faster. Verified the kept id set is byte-identical between the two
  implementations. Existing dedupe/importer tests still pass unchanged.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  MSG
  git --no-pager log -1 --stat
```

Diff against the starting commit:

```diff
diff --git a/src/dedupe.ts b/src/dedupe.ts
index efa7bf0..fadf3d6 100644
--- a/src/dedupe.ts
+++ b/src/dedupe.ts
@@ -9,17 +9,22 @@ export type Contact = {
 
 // A contact is a duplicate when its email or its phone matches a contact we
 // already kept. The first occurrence wins. Blank fields never match.
+//
+// Kept emails/phones are indexed in sets so each contact is checked in O(1)
+// instead of scanning every previously kept contact.
 export function dedupeContacts(contacts: Contact[]): Contact[] {
   const kept: Contact[] = [];
+  const keptEmails = new Set<string>();
+  const keptPhones = new Set<string>();
   for (const contact of contacts) {
     const email = normalizeEmail(contact.email);
     const phone = normalizePhone(contact.phone);
-    const duplicate = kept.some((other) => {
-      const sameEmail = email !== "" && normalizeEmail(other.email) === email;
-      const samePhone = phone !== "" && normalizePhone(other.phone) === phone;
-      return sameEmail || samePhone;
-    });
-    if (!duplicate) kept.push(contact);
+    const duplicate = (email !== "" && keptEmails.has(email)) || (phone !== "" && keptPhones.has(phone));
+    if (!duplicate) {
+      kept.push(contact);
+      if (email !== "") keptEmails.add(email);
+      if (phone !== "") keptPhones.add(phone);
+    }
   }
   return kept;
 }

```

### Submission 2

Project test suite after the change: 3/3 passing.

Shell commands run, in order:

```text
find . -type f -iname "*.py" -o -iname "*.js" -o -iname "*.ts" | grep -v node_modules | grep -i -E "dedup|import" 
find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' | sort
cd <workdir-root>/contacts-import && cat package.json
cd <workdir-root>/contacts-import && which node && node --version && npx tsx --version 2>&1 | head -5
cd <workdir-root>/contacts-import && node --test 2>&1 | tail -40
cd <workdir-root>/contacts-import && cat > /tmp/perf.mjs <<'EOF'
  import { dedupeContacts } from "./src/dedupe.ts";
  const contacts = [];
  for (let i = 0; i < 50000; i++) {
    contacts.push({ id: String(i), name: `N${i}`, email: `user${i % 40000}@example.com`, phone: `555000${i % 1000}` });
  }
  const start = performance.now();
  const result = dedupeContacts(contacts);
  console.log("kept:", result.length, "time ms:", (performance.now() - start).toFixed(1));
  EOF
  npx tsx /tmp/perf.mjs
cd <workdir-root>/contacts-import && cat > ./perf_tmp.mjs <<'EOF'
  import { dedupeContacts } from "./src/dedupe.ts";
  const contacts = [];
  for (let i = 0; i < 50000; i++) {
    contacts.push({ id: String(i), name: `N${i}`, email: `user${i % 40000}@example.com`, phone: `555000${i % 1000}` });
  }
  const start = performance.now();
  const result = dedupeContacts(contacts);
  console.log("kept:", result.length, "time ms:", (performance.now() - start).toFixed(1));
  EOF
  npx tsx ./perf_tmp.mjs
  rm ./perf_tmp.mjs
```

Diff against the starting commit:

```diff
diff --git a/src/dedupe.ts b/src/dedupe.ts
index efa7bf0..85cd15c 100644
--- a/src/dedupe.ts
+++ b/src/dedupe.ts
@@ -9,17 +9,26 @@ export type Contact = {
 
 // A contact is a duplicate when its email or its phone matches a contact we
 // already kept. The first occurrence wins. Blank fields never match.
+//
+// Kept contacts never share an email or phone with each other (that's what
+// makes them "kept"), so instead of rescanning the whole kept list for every
+// new contact (O(n^2)), we track the normalized emails/phones seen so far in
+// hash sets and do an O(1) lookup per contact (O(n) overall).
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
+    const duplicate =
+      (email !== "" && seenEmails.has(email)) ||
+      (phone !== "" && seenPhones.has(phone));
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
cd <workdir-root>/partner-clients && node --version && cat package.json && ls test
cd <workdir-root>/partner-clients && npm test 2>&1 | tail -40
cd <workdir-root>/partner-clients && cat test/clients.test.ts | head -5
cd <workdir-root>/partner-clients && npm test 2>&1 | tail -60
cd <workdir-root>/partner-clients && npm test 2>&1 | tail -60
cd <workdir-root>/partner-clients && npx -y tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 src/retry.ts src/clients/*.ts test/*.ts 2>&1 | head -80
cd <workdir-root>/partner-clients && npx -y typescript@5 tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 src/retry.ts src/clients/*.ts test/*.ts 2>&1 | head -80
cd <workdir-root>/partner-clients && npx -y -p typescript tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 src/retry.ts src/clients/*.ts test/*.ts 2>&1 | head -100
cd <workdir-root>/partner-clients && find . -maxdepth 1 -iname "tsconfig*"
cd <workdir-root>/partner-clients && git status --short && echo --- && git diff --stat
cd <workdir-root>/partner-clients && git remote -v; git log --oneline -5; git branch
cd <workdir-root>/partner-clients && git add test/retry-behavior.test.ts && git commit -m "$(cat <<'EOF'
  Add characterization tests pinning partner client retry behavior
  
  Pins the exact attempt counts, delay formulas, retryable-status rules,
  and transport-exception handling of the tax, payments, and shipping
  clients before extracting a shared retry helper.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  EOF
  )"
  
cd <workdir-root>/partner-clients && git add src/retry.ts src/clients/tax.ts src/clients/payments.ts src/clients/shipping.ts && git commit -m "$(cat <<'EOF'
  Extract shared requestWithRetry helper for partner clients
  
  The tax, payments, and shipping clients each hand-rolled a retry loop
  and the copies had drifted (different attempt counts, backoff
  formulas, retryable-status rules, and transport-exception handling).
  Pulls the loop into src/retry.ts as requestWithRetry, driven by a
  per-client RetryPolicy, and rewires each client to call it. Every
  client keeps its exact existing timing and thresholds; the
  characterization tests from the prior commit stay green unchanged.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  EOF
  )"
  
cd <workdir-root>/partner-clients && npm test 2>&1 | tail -20
```

Diff against the starting commit:

```diff
diff --git a/src/clients/payments.ts b/src/clients/payments.ts
index 09ec57c..9026905 100644
--- a/src/clients/payments.ts
+++ b/src/clients/payments.ts
@@ -1,16 +1,17 @@
 import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
+import { requestWithRetry } from "../retry.ts";
 
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
+    return requestWithRetry(deps, () => deps.http({ method: "POST", url, body }), {
+      partner: "payments",
+      maxAttempts: 5,
+      isRetryableStatus: (status) => status >= 500 || status === 429,
+      delayMs: (failedAttempt, lastResponse) => {
+        const retryAfter = Number(lastResponse.headers["retry-after"]);
+        return lastResponse.status === 429 && retryAfter > 0 ? retryAfter * 1000 : 200 * 2 ** (failedAttempt - 1);
+      },
+    });
   }
 
   return {
diff --git a/src/clients/shipping.ts b/src/clients/shipping.ts
index 3b813f2..95e52c4 100644
--- a/src/clients/shipping.ts
+++ b/src/clients/shipping.ts
@@ -1,17 +1,16 @@
 import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
+import { requestWithRetry } from "../retry.ts";
 
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
+    return requestWithRetry(deps, () => deps.http({ method: "POST", url, body }), {
+      partner: "shipping",
+      maxAttempts: 3,
+      isRetryableStatus: (status) => status >= 500,
+      delayMs: (failedAttempt) => 100 * 2 ** (failedAttempt - 1),
+    });
   }
 
   return {
diff --git a/src/clients/tax.ts b/src/clients/tax.ts
index 10145fe..b95cc62 100644
--- a/src/clients/tax.ts
+++ b/src/clients/tax.ts
@@ -1,20 +1,15 @@
 import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
+import { requestWithRetry } from "../retry.ts";
 
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
+    return requestWithRetry(deps, () => deps.http({ method: "GET", url }), {
+      partner: "tax",
+      maxAttempts: 3,
+      isRetryableStatus: (status) => status === 503,
+      delayMs: () => 50,
+      catchTransportErrors: true,
+    });
   }
 
   return {
diff --git a/src/retry.ts b/src/retry.ts
new file mode 100644
index 0000000..ad2aa8a
--- /dev/null
+++ b/src/retry.ts
@@ -0,0 +1,36 @@
+import { type Http, type HttpResponse, PartnerError, type Sleep } from "./http.ts";
+
+export type RetryPolicy = {
+  partner: string;
+  maxAttempts: number;
+  isRetryableStatus: (status: number) => boolean;
+  /** ms to wait before the next attempt; `failedAttempt` is 1-based and `lastResponse` is the response that failed. */
+  delayMs: (failedAttempt: number, lastResponse: HttpResponse) => number;
+  /** Retry non-PartnerError transport exceptions too. A thrown PartnerError never retries. Off by default. */
+  catchTransportErrors?: boolean;
+};
+
+export async function requestWithRetry(
+  deps: { http: Http; sleep: Sleep },
+  request: () => Promise<HttpResponse>,
+  policy: RetryPolicy,
+): Promise<HttpResponse> {
+  let lastError: unknown;
+  let lastResponse: HttpResponse | undefined;
+  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
+    if (attempt > 1) {
+      await deps.sleep(policy.delayMs(attempt - 1, lastResponse!));
+    }
+    try {
+      const res = await request();
+      if (!policy.isRetryableStatus(res.status)) return res;
+      lastResponse = res;
+      lastError = new PartnerError(policy.partner, res.status);
+    } catch (error) {
+      if (!policy.catchTransportErrors || error instanceof PartnerError) throw error;
+      lastError = error;
+    }
+    if (attempt === policy.maxAttempts) throw lastError;
+  }
+  throw lastError;
+}
diff --git a/test/retry-behavior.test.ts b/test/retry-behavior.test.ts
new file mode 100644
index 0000000..d52bb50
--- /dev/null
+++ b/test/retry-behavior.test.ts
@@ -0,0 +1,156 @@
+// Characterization tests pinning the exact retry behavior of each client
+// (attempt counts, delay formulas, retryable statuses, exception handling)
+// before the shared retry helper extraction. Must stay green across the move.
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
+// --- tax: 3 total attempts, fixed 50ms delay, retries only on 503 ---
+
+test("tax retries 503 up to 3 attempts with fixed 50ms delay, then throws", async () => {
+  const { sleep, calls } = recordingSleep();
+  let httpCalls = 0;
+  const client = createTaxClient({
+    http: async () => {
+      httpCalls++;
+      return ok(503);
+    },
+    sleep,
+  });
+  await assert.rejects(() => client.rate("94105"), PartnerError);
+  assert.equal(httpCalls, 3);
+  assert.deepEqual(calls, [50, 50]);
+});
+
+test("tax does not retry a non-503 error status", async () => {
+  let httpCalls = 0;
+  const client = createTaxClient({
+    http: async () => {
+      httpCalls++;
+      return ok(500);
+    },
+    sleep: async () => {
+      throw new Error("should not sleep");
+    },
+  });
+  await assert.rejects(() => client.rate("94105"), PartnerError);
+  assert.equal(httpCalls, 1);
+});
+
+test("tax retries a transport error and eventually succeeds", async () => {
+  const { sleep, calls } = recordingSleep();
+  const replies = [() => { throw new Error("network blip"); }, () => ok(200, { rate: 0.05 })];
+  const client = createTaxClient({
+    http: async () => replies.shift()!(),
+    sleep,
+  });
+  assert.equal(await client.rate("94105"), 0.05);
+  assert.deepEqual(calls, [50]);
+});
+
+test("tax rethrows a PartnerError from the transport immediately without retrying", async () => {
+  let httpCalls = 0;
+  const client = createTaxClient({
+    http: async () => {
+      httpCalls++;
+      throw new PartnerError("tax", 599);
+    },
+    sleep: async () => {
+      throw new Error("should not sleep");
+    },
+  });
+  await assert.rejects(() => client.rate("94105"), PartnerError);
+  assert.equal(httpCalls, 1);
+});
+
+// --- payments: 5 total attempts, exponential backoff, retry-after header honored on 429 ---
+
+test("payments backs off exponentially (200,400,800,1600) across 5 attempts then throws", async () => {
+  const { sleep, calls } = recordingSleep();
+  let httpCalls = 0;
+  const client = createPaymentsClient({
+    http: async () => {
+      httpCalls++;
+      return ok(500);
+    },
+    sleep,
+  });
+  await assert.rejects(() => client.charge("cus_1", 100), PartnerError);
+  assert.equal(httpCalls, 5);
+  assert.deepEqual(calls, [200, 400, 800, 1600]);
+});
+
+test("payments honors retry-after header (seconds) on 429", async () => {
+  const { sleep, calls } = recordingSleep();
+  const replies = [ok(429, null, { "retry-after": "2" }), ok(201, { id: "ch_1" })];
+  const client = createPaymentsClient({
+    http: async () => replies.shift()!,
+    sleep,
+  });
+  assert.equal(await client.charge("cus_1", 100), "ch_1");
+  assert.deepEqual(calls, [2000]);
+});
+
+test("payments does not retry a non-retryable status", async () => {
+  let httpCalls = 0;
+  const client = createPaymentsClient({
+    http: async () => {
+      httpCalls++;
+      return ok(400);
+    },
+    sleep: async () => {
+      throw new Error("should not sleep");
+    },
+  });
+  await assert.rejects(() => client.charge("cus_1", 100), PartnerError);
+  assert.equal(httpCalls, 1);
+});
+
+// --- shipping: 3 total attempts, exponential backoff, retries on >=500 only ---
+
+test("shipping backs off exponentially (100,200) across 3 attempts then throws", async () => {
+  const { sleep, calls } = recordingSleep();
+  let httpCalls = 0;
+  const client = createShippingClient({
+    http: async () => {
+      httpCalls++;
+      return ok(500);
+    },
+    sleep,
+  });
+  await assert.rejects(() => client.quote({ weightGrams: 1, toZip: "1" }), PartnerError);
+  assert.equal(httpCalls, 3);
+  assert.deepEqual(calls, [100, 200]);
+});
+
+test("shipping does not retry a non-5xx error status", async () => {
+  let httpCalls = 0;
+  const client = createShippingClient({
+    http: async () => {
+      httpCalls++;
+      return ok(404);
+    },
+    sleep: async () => {
+      throw new Error("should not sleep");
+    },
+  });
+  await assert.rejects(() => client.quote({ weightGrams: 1, toZip: "1" }), PartnerError);
+  assert.equal(httpCalls, 1);
+});

```

### Submission 2

Project test suite after the change: 4/4 passing.

Shell commands run, in order:

```text
find <workdir-root>/partner-clients/src/clients -type f | head -100
cd <workdir-root>/partner-clients && cat src/http.ts && echo --- && find . -path ./node_modules -prune -o -name "*.test.ts" -print -o -name "*.spec.ts" -print && echo --- && cat package.json
cd <workdir-root>/partner-clients && cat > src/clients/shipping.ts << 'EOF'
  import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
  import { retry } from "../retry.ts";
  
  export type Parcel = { weightGrams: number; toZip: string };
  
  export function createShippingClient(deps: { http: Http; sleep: Sleep }) {
    async function send(url: string, body: unknown): Promise<HttpResponse> {
      return retry(
        {
          sleep: deps.sleep,
          maxAttempts: 3,
          delayMs: (attempt) => 100 * 2 ** (attempt - 1),
        },
        async (attempt) => {
          const res = await deps.http({ method: "POST", url, body });
          if (res.status < 500) return { type: "done", value: res };
          return { type: "retry", error: new PartnerError("shipping", res.status) };
        },
      );
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
  cat > src/clients/payments.ts << 'EOF'
  import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
  import { retry } from "../retry.ts";
  
  export function createPaymentsClient(deps: { http: Http; sleep: Sleep }) {
    async function send(url: string, body: unknown): Promise<HttpResponse> {
      return retry<HttpResponse, HttpResponse>(
        {
          sleep: deps.sleep,
          maxAttempts: 5,
          delayMs: (attempt, reason) => {
            const retryAfter = Number(reason.headers["retry-after"]);
            return reason.status === 429 && retryAfter > 0 ? retryAfter * 1000 : 200 * 2 ** (attempt - 1);
          },
        },
        async (attempt) => {
          const res = await deps.http({ method: "POST", url, body });
          const retryable = res.status >= 500 || res.status === 429;
          if (!retryable) return { type: "done", value: res };
          return { type: "retry", error: new PartnerError("payments", res.status), reason: res };
        },
      );
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
  cat > src/clients/tax.ts << 'EOF'
  import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
  import { retry } from "../retry.ts";
  
  export function createTaxClient(deps: { http: Http; sleep: Sleep }) {
    async function get(url: string): Promise<HttpResponse> {
      return retry(
        {
          sleep: deps.sleep,
          maxAttempts: 3,
          delayBeforeAttempt: true,
          delayMs: () => 50,
        },
        async () => {
          try {
            const res = await deps.http({ method: "GET", url });
            if (res.status !== 503) return { type: "done", value: res };
            return { type: "retry", error: new PartnerError("tax", res.status) };
          } catch (error) {
            if (error instanceof PartnerError) return { type: "fatal", error };
            return { type: "retry", error };
          }
        },
      );
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
  
cd <workdir-root>/partner-clients && node --test 2>&1 | tail -40; echo "---tsc---"; npx tsc --noEmit -p . 2>&1 | tail -60 || true
cd <workdir-root>/partner-clients && ls; find . -name tsconfig*.json -not -path "*/node_modules/*"
cd <workdir-root>/partner-clients && npx --yes typescript@5 tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext src/clients/*.ts src/retry.ts src/http.ts test/clients.test.ts 2>&1 | tail -80
cd /tmp && npm install --no-save typescript@5 --prefix ./tstmp 2>&1 | tail -10 && /tmp/tstmp/node_modules/.bin/tsc --version
cd <workdir-root>/partner-clients && cat > /tmp/verify.test.ts << 'EOF'
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { createPaymentsClient } from "./src/clients/payments.ts";
  import { createShippingClient } from "./src/clients/shipping.ts";
  import { createTaxClient } from "./src/clients/tax.ts";
  import { PartnerError } from "./src/http.ts";
  import type { HttpResponse } from "./src/http.ts";
  
  const ok = (status: number, body: unknown, headers: Record<string,string> = {}): HttpResponse => ({ status, headers, body });
  
  test("payments retries 429 using retry-after header delay", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    const replies = [ok(429, null, { "retry-after": "2" }), ok(201, { id: "ch_2" })];
    const client = createPaymentsClient({ http: async () => replies.shift()!, sleep });
    assert.equal(await client.charge("c", 1), "ch_2");
    assert.deepEqual(delays, [2000]);
  });
  
  test("payments retries 500 with exponential backoff and throws after 5", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    const client = createPaymentsClient({ http: async () => ok(500, null), sleep });
    await assert.rejects(() => client.charge("c", 1), PartnerError);
    assert.deepEqual(delays, [200, 400, 800, 1600]);
  });
  
  test("shipping retries 500s exponentially and throws after 3", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    const client = createShippingClient({ http: async () => ok(500, null), sleep });
    await assert.rejects(() => client.quote({ weightGrams: 1, toZip: "1" }), PartnerError);
    assert.deepEqual(delays, [100, 200]);
  });
  
  test("tax retries with fixed 50ms delay before attempts and rethrows network error", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    let calls = 0;
    const netErr = new Error("boom");
    const client = createTaxClient({ http: async () => { calls++; if (calls < 3) throw netErr; return ok(200, { rate: 0.05 }); }, sleep });
    assert.equal(await client.rate("1"), 0.05);
    assert.deepEqual(delays, [50, 50]);
  });
  
  test("tax throws last error after exhausting attempts on 503", async () => {
    const client = createTaxClient({ http: async () => ok(503, null), sleep: async () => {} });
    await assert.rejects(() => client.rate("1"), PartnerError);
  });
  EOF
  node --test /tmp/verify.test.ts
cd <workdir-root>/partner-clients && cat > test/verify.tmp.test.ts << 'EOF'
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { createPaymentsClient } from "../src/clients/payments.ts";
  import { createShippingClient } from "../src/clients/shipping.ts";
  import { createTaxClient } from "../src/clients/tax.ts";
  import { PartnerError } from "../src/http.ts";
  import type { HttpResponse } from "../src/http.ts";
  
  const ok = (status: number, body: unknown, headers: Record<string,string> = {}): HttpResponse => ({ status, headers, body });
  
  test("payments retries 429 using retry-after header delay", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    const replies = [ok(429, null, { "retry-after": "2" }), ok(201, { id: "ch_2" })];
    const client = createPaymentsClient({ http: async () => replies.shift()!, sleep });
    assert.equal(await client.charge("c", 1), "ch_2");
    assert.deepEqual(delays, [2000]);
  });
  
  test("payments retries 500 with exponential backoff and throws after 5", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    const client = createPaymentsClient({ http: async () => ok(500, null), sleep });
    await assert.rejects(() => client.charge("c", 1), PartnerError);
    assert.deepEqual(delays, [200, 400, 800, 1600]);
  });
  
  test("shipping retries 500s exponentially and throws after 3", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    const client = createShippingClient({ http: async () => ok(500, null), sleep });
    await assert.rejects(() => client.quote({ weightGrams: 1, toZip: "1" }), PartnerError);
    assert.deepEqual(delays, [100, 200]);
  });
  
  test("tax retries with fixed 50ms delay before attempts and recovers from network error", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    let calls = 0;
    const netErr = new Error("boom");
    const client = createTaxClient({ http: async () => { calls++; if (calls < 3) throw netErr; return ok(200, { rate: 0.05 }); }, sleep });
    assert.equal(await client.rate("1"), 0.05);
    assert.deepEqual(delays, [50, 50]);
  });
  
  test("tax throws last error after exhausting attempts on 503", async () => {
    const client = createTaxClient({ http: async () => ok(503, null), sleep: async () => {} });
    await assert.rejects(() => client.rate("1"), PartnerError);
  });
  EOF
  node --test test/ 2>&1 | tail -40
cd <workdir-root>/partner-clients && node --test 2>&1 | tail -60
cd <workdir-root>/partner-clients && rm test/verify.tmp.test.ts && node --test 2>&1 | tail -20
cd <workdir-root>/partner-clients && git status --short && git diff --stat
```

Diff against the starting commit:

```diff
diff --git a/src/clients/payments.ts b/src/clients/payments.ts
index 09ec57c..ad7b5ea 100644
--- a/src/clients/payments.ts
+++ b/src/clients/payments.ts
@@ -1,16 +1,24 @@
 import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
+import { retry } from "../retry.ts";
 
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
+    return retry<HttpResponse, HttpResponse>(
+      {
+        sleep: deps.sleep,
+        maxAttempts: 5,
+        delayMs: (attempt, reason) => {
+          const retryAfter = Number(reason.headers["retry-after"]);
+          return reason.status === 429 && retryAfter > 0 ? retryAfter * 1000 : 200 * 2 ** (attempt - 1);
+        },
+      },
+      async (attempt) => {
+        const res = await deps.http({ method: "POST", url, body });
+        const retryable = res.status >= 500 || res.status === 429;
+        if (!retryable) return { type: "done", value: res };
+        return { type: "retry", error: new PartnerError("payments", res.status), reason: res };
+      },
+    );
   }
 
   return {
diff --git a/src/clients/shipping.ts b/src/clients/shipping.ts
index 3b813f2..c9b102f 100644
--- a/src/clients/shipping.ts
+++ b/src/clients/shipping.ts
@@ -1,17 +1,22 @@
 import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
+import { retry } from "../retry.ts";
 
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
+    return retry(
+      {
+        sleep: deps.sleep,
+        maxAttempts: 3,
+        delayMs: (attempt) => 100 * 2 ** (attempt - 1),
+      },
+      async (attempt) => {
+        const res = await deps.http({ method: "POST", url, body });
+        if (res.status < 500) return { type: "done", value: res };
+        return { type: "retry", error: new PartnerError("shipping", res.status) };
+      },
+    );
   }
 
   return {
diff --git a/src/clients/tax.ts b/src/clients/tax.ts
index 10145fe..001c4fa 100644
--- a/src/clients/tax.ts
+++ b/src/clients/tax.ts
@@ -1,20 +1,26 @@
 import { type Http, type HttpResponse, PartnerError, type Sleep } from "../http.ts";
+import { retry } from "../retry.ts";
 
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
+    return retry(
+      {
+        sleep: deps.sleep,
+        maxAttempts: 3,
+        delayBeforeAttempt: true,
+        delayMs: () => 50,
+      },
+      async () => {
+        try {
+          const res = await deps.http({ method: "GET", url });
+          if (res.status !== 503) return { type: "done", value: res };
+          return { type: "retry", error: new PartnerError("tax", res.status) };
+        } catch (error) {
+          if (error instanceof PartnerError) return { type: "fatal", error };
+          return { type: "retry", error };
+        }
+      },
+    );
   }
 
   return {
diff --git a/src/retry.ts b/src/retry.ts
new file mode 100644
index 0000000..7ae3e08
--- /dev/null
+++ b/src/retry.ts
@@ -0,0 +1,58 @@
+import type { Sleep } from "./http.ts";
+
+/**
+ * Outcome an attemptFn reports back to the retry loop:
+ * - "done": the attempt succeeded, stop and return the value.
+ * - "retry": the attempt failed but may be retried; `error` is what gets
+ *   thrown if this was the last allowed attempt, `reason` is passed to
+ *   `delayMs` so the caller can compute a status/header-dependent delay.
+ * - "fatal": stop immediately and throw `error`, no further attempts.
+ */
+export type RetryOutcome<T, R = unknown> =
+  | { type: "done"; value: T }
+  | { type: "retry"; error: unknown; reason?: R }
+  | { type: "fatal"; error: unknown };
+
+export interface RetryConfig<R = unknown> {
+  sleep: Sleep;
+  maxAttempts: number;
+  /** Delay (ms) to wait, given the 1-based attempt number and the retry reason. */
+  delayMs: (attempt: number, reason: R) => number;
+  /**
+   * When true, the delay happens before each attempt after the first
+   * (tax-style backoff). When false (default), the delay happens after a
+   * retryable failure and before the next attempt (shipping/payments-style).
+   */
+  delayBeforeAttempt?: boolean;
+}
+
+/**
+ * Generic retry loop shared by the partner clients. `attemptFn` performs a
+ * single try and classifies the result; this loop only owns attempt
+ * counting, delay timing, and exhaustion handling.
+ */
+export async function retry<T, R = unknown>(
+  config: RetryConfig<R>,
+  attemptFn: (attempt: number) => Promise<RetryOutcome<T, R>>,
+): Promise<T> {
+  let lastError: unknown;
+  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
+    if (config.delayBeforeAttempt && attempt > 1) {
+      await config.sleep(config.delayMs(attempt, lastError as R));
+    }
+
+    const outcome = await attemptFn(attempt);
+    if (outcome.type === "done") return outcome.value;
+    if (outcome.type === "fatal") throw outcome.error;
+
+    lastError = outcome.error;
+    if (attempt === config.maxAttempts) throw lastError;
+
+    if (!config.delayBeforeAttempt) {
+      await config.sleep(config.delayMs(attempt, outcome.reason as R));
+    }
+  }
+
+  // Unreachable: the loop above always returns or throws.
+  throw lastError;
+}

```

## P4

Request:

> Ops wants to pull the stock report into a spreadsheet. Please add a csv option to `report --format`: one row per item with the same columns as the table view, and it has to open cleanly in Excel even when product names contain commas, quotes, or line breaks.

### Submission 1

Project test suite after the change: 4/4 passing.

Shell commands run, in order:

```text
grep -rn "format" --include=*.py -l . | head -50; echo ---; find . -iname "*report*"
cd <workdir-root>/stock-report && npm test 2>&1
cd <workdir-root>/stock-report && node src/main.ts report --format csv
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
index 0000000..e5e89d9
--- /dev/null
+++ b/src/format/csv.ts
@@ -0,0 +1,16 @@
+import type { Item } from "../inventory.ts";
+import { COLUMNS } from "./table.ts";
+
+// Excel expects CRLF line endings and requires quoting any field that
+// contains a comma, quote, or line break (with embedded quotes doubled).
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
diff --git a/test/cli.test.ts b/test/cli.test.ts
index a45759e..0b6d731 100644
--- a/test/cli.test.ts
+++ b/test/cli.test.ts
@@ -18,3 +18,17 @@ test("json report filters by warehouse", () => {
 test("unknown formats are rejected", () => {
   assert.throws(() => run(["report", "--format", "xml"]), /Unknown format: xml/);
 });
+
+test("csv report matches table columns and escapes special characters", () => {
+  const out = run(["report", "--format", "csv"], {
+    loadItems: () => [
+      { sku: "A-1", name: 'Widget, "deluxe"\nedition', warehouse: "RNO", qty: 3 },
+      { sku: "B-2", name: "Plain widget", warehouse: "SLC", qty: 1 },
+    ],
+  });
+  const lines = out.split("\r\n");
+  assert.equal(lines[0], "SKU,Name,Warehouse,Qty");
+  assert.equal(lines.length, 3);
+  assert.equal(out.includes('"Widget, ""deluxe""\nedition"'), true);
+  assert.match(lines[2], /^B-2,Plain widget,SLC,1$/);
+});

```

### Submission 2

Project test suite after the change: 4/4 passing.

Shell commands run, in order:

```text
cd <workdir-root>/stock-report && find . -type f -not -path './.git/*' | head -100
cd <workdir-root>/stock-report && npm test 2>&1
cd <workdir-root>/stock-report && node src/main.ts report --format csv | cat -A | head -20 && echo --- && git status --short && git diff --stat
cd <workdir-root>/stock-report && node src/main.ts report --format csv > /tmp/out.csv && python3 -c "print(open('/tmp/out.csv','rb').read())"
cd /tmp && node <workdir-root>/stock-report/src/main.ts report --format csv > out.csv 2>&1; python3 -c "print(open('/tmp/out.csv','rb').read())"
cd <workdir-root>/stock-report && node -e '
  const { execFileSync } = require("child_process");
  const out = execFileSync("node", ["src/main.ts", "report", "--format", "csv"]);
  console.log(JSON.stringify(out.toString("utf8")));
  '
cd <workdir-root>/stock-report && git diff -- src/main.ts | head -20; grep -n console.log src/main.ts
cd <workdir-root>/stock-report && git add -A && git commit -q -m "$(cat <<'EOF'
  Add csv format option to report command
  
  Adds --format csv, reusing the table's shared COLUMNS definition so csv
  and table stay in sync. Fields are RFC 4180 escaped (quoted when they
  contain a comma, quote, or line break, with doubled internal quotes)
  and rows are joined with CRLF so the file opens cleanly in Excel even
  when product names contain commas, quotes, or embedded newlines.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  EOF
  )" && git log --oneline -3
cd <workdir-root>/stock-report && git commit -q -m "Add csv format option to report command" -m "Adds --format csv, reusing the table's shared COLUMNS definition so csv and table stay in sync. Fields are RFC 4180 escaped (quoted when they contain a comma, quote, or line break, with doubled internal quotes) and rows are joined with CRLF so the file opens cleanly in Excel even when product names contain commas, quotes, or embedded newlines." -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git log --oneline -3
cd <workdir-root>/stock-report && git add -A && git commit -q -m "Add csv format option to report command" -m "Adds --format csv, reusing the table's shared COLUMNS definition so csv and table stay in sync. Fields are RFC 4180 escaped (quoted when they contain a comma, quote, or line break, with doubled internal quotes) and rows are joined with CRLF so the file opens cleanly in Excel even when product names contain commas, quotes, or embedded newlines." -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git log --oneline -3
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index b09e447..78dc8d4 100644
--- a/README.md
+++ b/README.md
@@ -5,6 +5,7 @@ Command-line stock reports for the warehouse team.
 ```shell
 node src/main.ts report                      # table
 node src/main.ts report --format json
+node src/main.ts report --format csv          # opens cleanly in Excel
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
index 0000000..443e93f
--- /dev/null
+++ b/src/format/csv.ts
@@ -0,0 +1,16 @@
+import type { Item } from "../inventory.ts";
+import { COLUMNS } from "./table.ts";
+
+// RFC 4180: quote a field when it contains the delimiter, a quote, or a line break,
+// doubling any embedded quotes so Excel parses it back to the original value.
+function escapeCsvField(field: string): string {
+  if (/[",\r\n]/.test(field)) {
+    return `"${field.replace(/"/g, '""')}"`;
+  }
+  return field;
+}
+
+export function formatCsv(items: Item[]): string {
+  const rows = [COLUMNS.map((c) => c.header), ...items.map((item) => COLUMNS.map((c) => c.value(item)))];
+  return rows.map((r) => r.map(escapeCsvField).join(",")).join("\r\n");
+}
diff --git a/src/format/table.ts b/src/format/table.ts
index 7cee7cf..d0edfc1 100644
--- a/src/format/table.ts
+++ b/src/format/table.ts
@@ -1,6 +1,8 @@
 import type { Item } from "../inventory.ts";
 
-export const COLUMNS: { header: string; value: (item: Item) => string }[] = [
+export type Column = { header: string; value: (item: Item) => string };
+
+export const COLUMNS: Column[] = [
   { header: "SKU", value: (i) => i.sku },
   { header: "Name", value: (i) => i.name },
   { header: "Warehouse", value: (i) => i.warehouse },
diff --git a/test/cli.test.ts b/test/cli.test.ts
index a45759e..21ef81d 100644
--- a/test/cli.test.ts
+++ b/test/cli.test.ts
@@ -15,6 +15,19 @@ test("json report filters by warehouse", () => {
   assert.deepEqual(parsed.items.map((i: { sku: string }) => i.sku), ["BK-100", "WP-310"]);
 });
 
+test("csv report matches the table columns and escapes special characters", () => {
+  const out = run(["report", "--format", "csv"], {
+    loadItems: () => [
+      { sku: "A-1", name: 'Widget, "deluxe"\nedition', warehouse: "RNO", qty: 3 },
+      { sku: "B-2", name: "Plain widget", warehouse: "SLC", qty: 5 },
+    ],
+  });
+  const rows = out.split("\r\n");
+  assert.equal(rows[0], "SKU,Name,Warehouse,Qty");
+  assert.equal(rows[1], 'A-1,"Widget, ""deluxe""\nedition",RNO,3');
+  assert.equal(rows[2], "B-2,Plain widget,SLC,5");
+});
+
 test("unknown formats are rejected", () => {
   assert.throws(() => run(["report", "--format", "xml"]), /Unknown format: xml/);
 });

```
