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

> During a cold start the upstream catalog service got hammered with identical item lookups, and after a brief upstream outage our service kept returning errors for those same items until we restarted it. Please fix the catalog cache so it coalesces work without changing the time-to-live behavior.

### Submission 1

Project test suite after the change: 5/5 passing.

Shell commands run, in order:

```text
cd . && git log --oneline -10 && echo --- && find . -path ./node_modules -prune -o -type f -print | grep -v '\.git/' | head -100
cd . && node --version && npm test 2>&1 | tail -30
cd . && npm test 2>&1 | tail -60
cd . && git add -A && git commit -q -m "test: reproduce missing request coalescing in CatalogCache
  
  Concurrent lookups for a cold key each independently call fetchItem
  instead of sharing one in-flight request. This reproduces the
  upstream-hammering stampede on cold start and the mechanism by which
  duplicate uncoalesced writers can re-latch a negative cache entry.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git log --oneline -3
cat -n ./src/catalog-cache.ts
cd . && npm test 2>&1
cat -n ./test/catalog-cache.test.ts
cd . && md5 test/catalog-cache.test.ts 2>/dev/null || shasum test/catalog-cache.test.ts; wc -l test/catalog-cache.test.ts; git log --oneline -- test/catalog-cache.test.ts; git diff HEAD -- test/catalog-cache.test.ts
cd . && git show 264ee03 -- test/catalog-cache.test.ts | head -100
cd . && node --experimental-strip-types -e '
  import("./src/catalog-cache.ts").then(async ({ CatalogCache }) => {
    let now = 0;
    let calls = 0;
    const cache = new CatalogCache({
      ttlMs: 50,
      now: () => now,
      fetchItem: async () => {
        calls++;
        await Promise.resolve();
        throw new Error("upstream unavailable");
      },
    });
    const stampede = [cache.getItem("mug"), cache.getItem("mug"), cache.getItem("mug")];
    for (const p of stampede) p.catch(() => {});
    try { await Promise.all(stampede); } catch {}
    console.log("after stampede calls =", calls); // expect 1
  
    now = 49;
    try { await cache.getItem("mug"); } catch {}
    console.log("at now=49 calls =", calls); // expect still 1
  
    now = 50;
    try {
      const result = await cache.getItem("mug");
      console.log("unexpected success", result);
    } catch (e) {
      console.log("at now=50 getItem rejected as expected since mock always throws; calls =", calls, "error:", e.message);
    }
  });
  ' 2>&1
cd . && npm test 2>&1; echo "---diff---"; git --no-pager diff -- src/catalog-cache.ts
cd . && git diff -- src/catalog-cache.ts
cd . && npm test 2>&1 | tail -40
cd . && git stash push -- src/catalog-cache.ts && npm test 2>&1 | tail -20; git stash pop
cd . && git add -A && git commit -q -m "fix: coalesce concurrent catalog lookups per key
  
  getItem() previously let every concurrent caller for an uncached id
  start its own fetchItem() call. On cold start this hammered the
  upstream service with duplicate lookups, and under a stampede of
  failing duplicates each straggler independently overwrote the cache
  entry's expiresAt on completion, letting a brief outage's negative
  cache window drift forward indefinitely.
  
  Track one in-flight promise per id; concurrent callers now await the
  single shared fetch instead of issuing their own. The settled fetch
  writes the cache entry exactly once, so ttl expiry (success or
  failure) is anchored to one well-defined completion time, unchanged
  from before. forget() also clears any in-flight marker for the id so
  a forgotten key doesn't leave later callers awaiting a discarded
  fetch.
  
  Also fixes the second repro test's fixture, which only had a failure
  branch and so could never observe its own asserted successful retry.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git log --oneline -5
cd . && git remote -v; git branch -a
```

Diff against the starting commit:

```diff
diff --git a/src/catalog-cache.ts b/src/catalog-cache.ts
index 78a06a1..e1a9292 100644
--- a/src/catalog-cache.ts
+++ b/src/catalog-cache.ts
@@ -16,6 +16,7 @@ export class CatalogCache {
   private readonly fetchItem: FetchCatalogItem;
   private readonly now: () => number;
   private readonly entries = new Map<string, CacheEntry>();
+  private readonly inFlight = new Map<string, Promise<CatalogItem>>();
 
   constructor(options: CatalogCacheOptions) {
     if (options.ttlMs <= 0) throw new RangeError("ttlMs must be positive");
@@ -30,7 +31,14 @@ export class CatalogCache {
       return cached.promise;
     }
 
+    const existing = this.inFlight.get(id);
+    if (existing) {
+      return existing;
+    }
+
     const promise = this.fetchItem(id);
+    this.inFlight.set(id, promise);
+
     try {
       const item = await promise;
       this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
@@ -38,6 +46,8 @@ export class CatalogCache {
     } catch (error) {
       this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
       throw error;
+    } finally {
+      this.inFlight.delete(id);
     }
   }
 
@@ -46,6 +56,7 @@ export class CatalogCache {
   }
 
   forget(id: string): boolean {
+    this.inFlight.delete(id);
     return this.entries.delete(id);
   }
 
diff --git a/test/catalog-cache.test.ts b/test/catalog-cache.test.ts
index 92421b7..e594696 100644
--- a/test/catalog-cache.test.ts
+++ b/test/catalog-cache.test.ts
@@ -41,6 +41,66 @@ test("expired entries are loaded again", async () => {
   assert.equal((await cache.getItem("tote")).title, "version-2");
 });
 
+test("concurrent cold lookups for the same id coalesce into one upstream call", async () => {
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      await new Promise((resolve) => setTimeout(resolve, 10));
+      return item(id, `title-${calls}`);
+    },
+  });
+
+  const results = await Promise.all([
+    cache.getItem("mug"),
+    cache.getItem("mug"),
+    cache.getItem("mug"),
+  ]);
+
+  assert.equal(calls, 1, "expected a single coalesced upstream call, not one per caller");
+  assert.deepEqual(results.map((r) => r.title), ["title-1", "title-1", "title-1"]);
+});
+
+test("concurrent failing lookups coalesce instead of each latching their own error entry", async () => {
+  // Without coalescing, N concurrent misses during an outage each
+  // independently call fetchItem and then independently overwrite the cache
+  // entry on completion. Because each straggler's own completion time sets
+  // expiresAt = completionTime + ttlMs, a slow-to-settle duplicate can keep
+  // pushing the negative-cache window forward well past when upstream
+  // actually recovered. Coalescing collapses the stampede to one writer, so
+  // the entry's ttl is anchored to a single, well-defined settlement time.
+  let now = 0;
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 50,
+    now: () => now,
+    fetchItem: async () => {
+      calls++;
+      await Promise.resolve();
+      if (calls === 1) throw new Error("upstream unavailable");
+      return item("mug");
+    },
+  });
+
+  const stampede = [cache.getItem("mug"), cache.getItem("mug"), cache.getItem("mug")];
+  for (const p of stampede) p.catch(() => {});
+  await assert.rejects(Promise.all(stampede));
+  assert.equal(calls, 1, "expected the failing stampede to share one upstream call, not one per caller");
+
+  // The single shared failure settled at now=0, so the negative-cache entry
+  // should expire exactly ttlMs later, not be extended by phantom duplicate
+  // writers.
+  now = 49;
+  await assert.rejects(cache.getItem("mug"));
+  assert.equal(calls, 1, "entry should still be cached just before its ttl elapses");
+
+  now = 50;
+  const result = await cache.getItem("mug");
+  assert.equal(result.title, "mug");
+  assert.equal(calls, 2, "upstream should be retried exactly once the ttl has elapsed");
+});
+
 test("getMany keeps input order and ids separate", async () => {
   const cache = new CatalogCache({ ttlMs: 1000, fetchItem: async (id) => item(id) });
   const results = await cache.getMany(["pin", "mug", "pin"]);

```

### Submission 2

Project test suite after the change: 7/7 passing.

Shell commands run, in order:

```text
find . -type f -iname "*cache*" -not -path "*/node_modules/*" -not -path "*/.git/*" | head -50
cd . && cat package.json | grep -A3 '"scripts"'
cd . && npm test 2>&1 | tail -60
```

Diff against the starting commit:

```diff
diff --git a/src/catalog-cache.ts b/src/catalog-cache.ts
index 78a06a1..ff7164a 100644
--- a/src/catalog-cache.ts
+++ b/src/catalog-cache.ts
@@ -31,12 +31,25 @@ export class CatalogCache {
     }
 
     const promise = this.fetchItem(id);
+    // Publish the in-flight promise synchronously (before awaiting) so any
+    // concurrent lookups for the same id reuse this single upstream request
+    // instead of each triggering their own fetch (the "thundering herd" bug).
+    const entry: CacheEntry = { expiresAt: Infinity, promise };
+    this.entries.set(id, entry);
+
     try {
       const item = await promise;
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
+      // Only a successful result is cached for ttlMs; the TTL behavior for
+      // hits is unchanged from before.
+      entry.expiresAt = this.now() + this.ttlMs;
       return item;
     } catch (error) {
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
+      // Don't remember failures: remove the entry (unless something newer
+      // already replaced it) so the very next lookup retries the upstream
+      // instead of replaying the same error until the TTL elapses.
+      if (this.entries.get(id) === entry) {
+        this.entries.delete(id);
+      }
       throw error;
     }
   }
diff --git a/test/catalog-cache.test.ts b/test/catalog-cache.test.ts
index 92421b7..750431d 100644
--- a/test/catalog-cache.test.ts
+++ b/test/catalog-cache.test.ts
@@ -47,3 +47,79 @@ test("getMany keeps input order and ids separate", async () => {
   assert.deepEqual(results.map((r) => r.id), ["pin", "mug", "pin"]);
   assert.equal(cache.size, 2);
 });
+
+test("coalesces concurrent lookups for the same id into a single upstream call", async () => {
+  let calls = 0;
+  let resolveFetch!: (item: CatalogItem) => void;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      return new Promise<CatalogItem>((resolve) => {
+        resolveFetch = resolve;
+      });
+    },
+  });
+
+  const first = cache.getItem("mug");
+  const second = cache.getItem("mug");
+  resolveFetch(item("mug"));
+
+  const [a, b] = await Promise.all([first, second]);
+  assert.equal(calls, 1);
+  assert.equal(a.id, "mug");
+  assert.equal(b.id, "mug");
+});
+
+test("getMany coalesces duplicate ids within the same batch", async () => {
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      return item(id);
+    },
+  });
+
+  await cache.getMany(["pin", "pin", "pin"]);
+  assert.equal(calls, 1);
+});
+
+test("does not cache failures, so the next lookup retries immediately", async () => {
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 100_000,
+    fetchItem: async (id) => {
+      calls++;
+      if (calls === 1) throw new Error("upstream outage");
+      return item(id, "recovered");
+    },
+  });
+
+  await assert.rejects(cache.getItem("mug"));
+  const result = await cache.getItem("mug");
+  assert.equal(result.title, "recovered");
+  assert.equal(calls, 2);
+});
+
+test("concurrent lookups during an outage all reject without extra upstream calls", async () => {
+  let calls = 0;
+  let rejectFetch!: (err: Error) => void;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      return new Promise<CatalogItem>((_, reject) => {
+        rejectFetch = reject;
+      });
+    },
+  });
+
+  const first = cache.getItem("mug");
+  const second = cache.getItem("mug");
+  rejectFetch(new Error("upstream outage"));
+
+  await assert.rejects(first);
+  await assert.rejects(second);
+  assert.equal(calls, 1);
+});

```

## P2

Request:

> During a cold start the upstream catalog service got hammered with identical item lookups, and after a brief upstream outage our service kept returning errors for those same items until we restarted it. Please fix the catalog cache so it coalesces work without changing the time-to-live behavior.

### Submission 1

Project test suite after the change: 5/5 passing.

Shell commands run, in order:

```text
cd . && git log --oneline -5 && echo --- && find . -type f -not -path './.git/*' | grep -v node_modules | head -100
cd . && cat package.json
cd . && npm test 2>&1 | tail -60
cd . && npm test 2>&1 | tail -60
cd . && git diff --stat && git add -A && git commit -m "test: reproduce cache-stampede and lingering-outage bugs" --quiet -- test/ 2>&1; git status --short
cd . && git log --oneline -3 && git diff --stat HEAD
cd . && git add -A && git commit -m "fix: coalesce concurrent catalog lookups per id
  
  Register the in-flight fetch promise in the cache before awaiting it,
  not after it settles. Concurrent getItem calls for the same id during
  that gap previously each dispatched their own upstream fetch (the
  cold-start stampede), and overlapping failures kept re-arming the
  negative-cache window past the actual outage, so errors outlived it
  until a restart. TTL behavior for both hits and cached errors is
  unchanged." --quiet && git log --oneline -3 && npm test 2>&1 | tail -15
cd . && git remote -v
```

Diff against the starting commit:

```diff
diff --git a/src/catalog-cache.ts b/src/catalog-cache.ts
index 78a06a1..d81fba7 100644
--- a/src/catalog-cache.ts
+++ b/src/catalog-cache.ts
@@ -31,6 +31,10 @@ export class CatalogCache {
     }
 
     const promise = this.fetchItem(id);
+    // Register the in-flight promise before awaiting it, so concurrent callers
+    // for the same id reuse this attempt instead of each starting their own
+    // upstream fetch (the cache-stampede bug this guards against).
+    this.entries.set(id, { expiresAt: Infinity, promise });
     try {
       const item = await promise;
       this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
diff --git a/test/catalog-cache.test.ts b/test/catalog-cache.test.ts
index 92421b7..b9698aa 100644
--- a/test/catalog-cache.test.ts
+++ b/test/catalog-cache.test.ts
@@ -41,6 +41,57 @@ test("expired entries are loaded again", async () => {
   assert.equal((await cache.getItem("tote")).title, "version-2");
 });
 
+test("coalesces concurrent lookups for an uncached id into one upstream call", async () => {
+  let calls = 0;
+  let resolveFetch!: (item: CatalogItem) => void;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      return new Promise<CatalogItem>((resolve) => {
+        resolveFetch = resolve;
+      });
+    },
+  });
+
+  const first = cache.getItem("mug");
+  const second = cache.getItem("mug");
+  resolveFetch(item("mug"));
+
+  await Promise.all([first, second]);
+  assert.equal(calls, 1);
+});
+
+test("a failed in-flight lookup is shared, and recovers on the next attempt after it expires", async () => {
+  let now = 0;
+  let calls = 0;
+  let rejectFetch!: (error: Error) => void;
+  const cache = new CatalogCache({
+    ttlMs: 5,
+    now: () => now,
+    fetchItem: async (id) => {
+      calls++;
+      if (calls === 1) {
+        return new Promise<CatalogItem>((_, reject) => {
+          rejectFetch = reject;
+        });
+      }
+      return item(id, "recovered");
+    },
+  });
+
+  const first = cache.getItem("mug").catch((e: Error) => e.message);
+  const second = cache.getItem("mug").catch((e: Error) => e.message);
+  rejectFetch(new Error("upstream down"));
+
+  assert.deepEqual(await Promise.all([first, second]), ["upstream down", "upstream down"]);
+  assert.equal(calls, 1, "concurrent lookups during the outage should not each hit upstream");
+
+  now = 10;
+  assert.equal((await cache.getItem("mug")).title, "recovered");
+  assert.equal(calls, 2);
+});
+
 test("getMany keeps input order and ids separate", async () => {
   const cache = new CatalogCache({ ttlMs: 1000, fetchItem: async (id) => item(id) });
   const results = await cache.getMany(["pin", "mug", "pin"]);

```

### Submission 2

Project test suite after the change: 5/5 passing.

Shell commands run, in order:

```text
cd . && npm test 2>&1
cd . && npm test 2>&1
```

Diff against the starting commit:

```diff
diff --git a/src/catalog-cache.ts b/src/catalog-cache.ts
index 78a06a1..dfee68d 100644
--- a/src/catalog-cache.ts
+++ b/src/catalog-cache.ts
@@ -16,6 +16,8 @@ export class CatalogCache {
   private readonly fetchItem: FetchCatalogItem;
   private readonly now: () => number;
   private readonly entries = new Map<string, CacheEntry>();
+  // Tracks in-flight fetches so concurrent lookups for the same id share one upstream call.
+  private readonly pending = new Map<string, Promise<CatalogItem>>();
 
   constructor(options: CatalogCacheOptions) {
     if (options.ttlMs <= 0) throw new RangeError("ttlMs must be positive");
@@ -24,21 +26,35 @@ export class CatalogCache {
     this.now = options.now ?? Date.now;
   }
 
-  async getItem(id: string): Promise<CatalogItem> {
+  getItem(id: string): Promise<CatalogItem> {
     const cached = this.entries.get(id);
     if (cached && cached.expiresAt > this.now()) {
       return cached.promise;
     }
 
-    const promise = this.fetchItem(id);
-    try {
-      const item = await promise;
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
-      return item;
-    } catch (error) {
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
-      throw error;
+    const inFlight = this.pending.get(id);
+    if (inFlight) {
+      return inFlight;
     }
+
+    let promise: Promise<CatalogItem>;
+    const settle = () => {
+      if (this.pending.get(id) === promise) this.pending.delete(id);
+    };
+    promise = this.fetchItem(id).then(
+      (item) => {
+        this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
+        settle();
+        return item;
+      },
+      (error) => {
+        this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
+        settle();
+        throw error;
+      },
+    );
+    this.pending.set(id, promise);
+    return promise;
   }
 
   async getMany(ids: string[]): Promise<CatalogItem[]> {
diff --git a/test/catalog-cache.test.ts b/test/catalog-cache.test.ts
index 92421b7..7463cb2 100644
--- a/test/catalog-cache.test.ts
+++ b/test/catalog-cache.test.ts
@@ -41,6 +41,62 @@ test("expired entries are loaded again", async () => {
   assert.equal((await cache.getItem("tote")).title, "version-2");
 });
 
+test("coalesces concurrent lookups for the same id into one upstream call", async () => {
+  let calls = 0;
+  let resolveFetch: (value: CatalogItem) => void = () => {};
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      return new Promise<CatalogItem>((resolve) => {
+        resolveFetch = () => resolve(item(id));
+      });
+    },
+  });
+
+  const first = cache.getItem("mug");
+  const second = cache.getItem("mug");
+  assert.equal(calls, 1);
+  resolveFetch();
+  const [a, b] = await Promise.all([first, second]);
+  assert.equal(a.id, "mug");
+  assert.equal(b.id, "mug");
+});
+
+test("coalesces concurrent lookups that fail, and retries after ttl expires", async () => {
+  let now = 0;
+  let calls = 0;
+  let rejectFetch: (error: Error) => void = () => {};
+  const cache = new CatalogCache({
+    ttlMs: 5,
+    now: () => now,
+    fetchItem: async () => {
+      calls++;
+      return new Promise<CatalogItem>((_resolve, reject) => {
+        rejectFetch = () => reject(new Error("upstream down"));
+      });
+    },
+  });
+
+  const first = cache.getItem("mug").catch((e: Error) => e.message);
+  const second = cache.getItem("mug").catch((e: Error) => e.message);
+  assert.equal(calls, 1);
+  rejectFetch();
+  assert.deepEqual(await Promise.all([first, second]), ["upstream down", "upstream down"]);
+
+  // Still within ttl: cached failure is reused, no new upstream call.
+  now = 3;
+  assert.equal(await cache.getItem("mug").catch((e: Error) => e.message), "upstream down");
+  assert.equal(calls, 1);
+
+  // After ttl expires, it retries upstream.
+  now = 10;
+  const retry = cache.getItem("mug").catch((e: Error) => e.message);
+  assert.equal(calls, 2);
+  rejectFetch();
+  assert.equal(await retry, "upstream down");
+});
+
 test("getMany keeps input order and ids separate", async () => {
   const cache = new CatalogCache({ ttlMs: 1000, fetchItem: async (id) => item(id) });
   const results = await cache.getMany(["pin", "mug", "pin"]);

```

## P3

Request:

> During a cold start the upstream catalog service got hammered with identical item lookups, and after a brief upstream outage our service kept returning errors for those same items until we restarted it. Please fix the catalog cache so it coalesces work without changing the time-to-live behavior.

### Submission 1

Project test suite after the change: 5/5 passing.

Shell commands run, in order:

```text
cd . && git log --oneline -5 && find . -type f -not -path './.git/*' | head -100
cd . && cat package.json
cd . && npm test 2>&1 | tail -60
```

Diff against the starting commit:

```diff
diff --git a/src/catalog-cache.ts b/src/catalog-cache.ts
index 78a06a1..9b969df 100644
--- a/src/catalog-cache.ts
+++ b/src/catalog-cache.ts
@@ -16,6 +16,7 @@ export class CatalogCache {
   private readonly fetchItem: FetchCatalogItem;
   private readonly now: () => number;
   private readonly entries = new Map<string, CacheEntry>();
+  private readonly inFlight = new Map<string, Promise<CatalogItem>>();
 
   constructor(options: CatalogCacheOptions) {
     if (options.ttlMs <= 0) throw new RangeError("ttlMs must be positive");
@@ -30,7 +31,14 @@ export class CatalogCache {
       return cached.promise;
     }
 
+    // Coalesce concurrent lookups for the same id into a single upstream call.
+    const pending = this.inFlight.get(id);
+    if (pending) {
+      return pending;
+    }
+
     const promise = this.fetchItem(id);
+    this.inFlight.set(id, promise);
     try {
       const item = await promise;
       this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
@@ -38,6 +46,8 @@ export class CatalogCache {
     } catch (error) {
       this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
       throw error;
+    } finally {
+      this.inFlight.delete(id);
     }
   }
 
diff --git a/test/catalog-cache.test.ts b/test/catalog-cache.test.ts
index 92421b7..1efe35d 100644
--- a/test/catalog-cache.test.ts
+++ b/test/catalog-cache.test.ts
@@ -41,6 +41,64 @@ test("expired entries are loaded again", async () => {
   assert.equal((await cache.getItem("tote")).title, "version-2");
 });
 
+test("coalesces concurrent lookups for the same id into one upstream call", async () => {
+  let calls = 0;
+  let resolveFetch!: (value: CatalogItem) => void;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      return new Promise((resolve) => {
+        resolveFetch = resolve;
+      });
+    },
+  });
+
+  const requests = [cache.getItem("mug"), cache.getItem("mug"), cache.getItem("mug")];
+  resolveFetch(item("mug"));
+  const results = await Promise.all(requests);
+
+  assert.equal(calls, 1);
+  assert.equal(results.length, 3);
+  for (const result of results) assert.equal(result.title, "mug");
+});
+
+test("coalesces concurrent lookups that fail, and still retries once the TTL expires", async () => {
+  let now = 0;
+  let calls = 0;
+  let rejectFetch!: (error: Error) => void;
+  const cache = new CatalogCache({
+    ttlMs: 5,
+    now: () => now,
+    fetchItem: async (id) => {
+      calls++;
+      if (calls === 1) {
+        return new Promise((_resolve, reject) => {
+          rejectFetch = reject;
+        });
+      }
+      return item(id, "recovered");
+    },
+  });
+
+  const requests = [cache.getItem("mug"), cache.getItem("mug")].map((p) => p.catch((e: Error) => e));
+  rejectFetch(new Error("upstream down"));
+  const [first, second] = await Promise.all(requests);
+
+  assert.equal(calls, 1);
+  assert.ok(first instanceof Error);
+  assert.ok(second instanceof Error);
+
+  // Still within the TTL window: the cached failure is reused, no new call.
+  await assert.rejects(() => cache.getItem("mug"));
+  assert.equal(calls, 1);
+
+  // TTL behavior is unchanged: past expiry, a fresh lookup is made.
+  now = 10;
+  assert.equal((await cache.getItem("mug")).title, "recovered");
+  assert.equal(calls, 2);
+});
+
 test("getMany keeps input order and ids separate", async () => {
   const cache = new CatalogCache({ ttlMs: 1000, fetchItem: async (id) => item(id) });
   const results = await cache.getMany(["pin", "mug", "pin"]);

```

### Submission 2

Project test suite after the change: 5/5 passing.

Shell commands run, in order:

```text
find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | head -100
cd . && npm test 2>&1 | tail -60
```

Diff against the starting commit:

```diff
diff --git a/src/catalog-cache.ts b/src/catalog-cache.ts
index 78a06a1..3e8d900 100644
--- a/src/catalog-cache.ts
+++ b/src/catalog-cache.ts
@@ -16,6 +16,7 @@ export class CatalogCache {
   private readonly fetchItem: FetchCatalogItem;
   private readonly now: () => number;
   private readonly entries = new Map<string, CacheEntry>();
+  private readonly inFlight = new Map<string, Promise<CatalogItem>>();
 
   constructor(options: CatalogCacheOptions) {
     if (options.ttlMs <= 0) throw new RangeError("ttlMs must be positive");
@@ -30,14 +31,26 @@ export class CatalogCache {
       return cached.promise;
     }
 
+    // Coalesce concurrent lookups for the same id into a single upstream call
+    // instead of letting each caller start its own fetch (thundering herd).
+    const pending = this.inFlight.get(id);
+    if (pending) {
+      return pending;
+    }
+
     const promise = this.fetchItem(id);
+    this.inFlight.set(id, promise);
     try {
       const item = await promise;
       this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
       return item;
     } catch (error) {
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
+      // Don't cache failures: a transient upstream error shouldn't keep
+      // poisoning lookups for the full TTL once upstream recovers.
+      this.entries.delete(id);
       throw error;
+    } finally {
+      this.inFlight.delete(id);
     }
   }
 
diff --git a/test/catalog-cache.test.ts b/test/catalog-cache.test.ts
index 92421b7..99fd809 100644
--- a/test/catalog-cache.test.ts
+++ b/test/catalog-cache.test.ts
@@ -41,6 +41,45 @@ test("expired entries are loaded again", async () => {
   assert.equal((await cache.getItem("tote")).title, "version-2");
 });
 
+test("coalesces concurrent lookups for the same id into one upstream call", async () => {
+  let calls = 0;
+  let resolveFetch!: (item: CatalogItem) => void;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      return new Promise((resolve) => {
+        resolveFetch = () => resolve(item(id, "shared"));
+      });
+    },
+  });
+
+  const first = cache.getItem("mug");
+  const second = cache.getItem("mug");
+  resolveFetch();
+
+  const [a, b] = await Promise.all([first, second]);
+  assert.equal(a.title, "shared");
+  assert.equal(b.title, "shared");
+  assert.equal(calls, 1);
+});
+
+test("failed lookups are not cached and retry once upstream recovers", async () => {
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      if (calls === 1) throw new Error("upstream unavailable");
+      return item(id, `title-${calls}`);
+    },
+  });
+
+  await assert.rejects(cache.getItem("mug"), /upstream unavailable/);
+  assert.equal((await cache.getItem("mug")).title, "title-2");
+  assert.equal(calls, 2);
+});
+
 test("getMany keeps input order and ids separate", async () => {
   const cache = new CatalogCache({ ttlMs: 1000, fetchItem: async (id) => item(id) });
   const results = await cache.getMany(["pin", "mug", "pin"]);

```

## P4

Request:

> During a cold start the upstream catalog service got hammered with identical item lookups, and after a brief upstream outage our service kept returning errors for those same items until we restarted it. Please fix the catalog cache so it coalesces work without changing the time-to-live behavior.

### Submission 1

Project test suite after the change: 7/7 passing.

Shell commands run, in order:

```text
git status --short && rg --files -g '!node_modules' | head -80
git status --short && git remote -v && ls -la
git --no-pager log -5 --oneline --decorate && git status --short && node --version && npm --version
for f in src/catalog-cache.ts src/types.ts src/upstream.ts src/index.ts test/catalog-cache.test.ts; do printf '\n%s\n' "$f"; nl -ba "$f"; done
npm test
cd . && cat src/types.ts 2>/dev/null; echo ---; cat package.json
git status --short && ls -a
git --no-pager diff -- test/catalog-cache.test.ts && nl -ba src/catalog-cache.ts
node --input-type=module -e 'import { CatalogCache } from "./src/catalog-cache.ts"; let resolve; let now=10; const upstream=new Promise(r=>resolve=r); const cache=new CatalogCache({ttlMs:5,now:()=>now,fetchItem:()=>upstream}); const read=cache.getItem("mug"); if(cache.size!==0 || cache.forget("mug")!==false) throw Error("pending contract differs"); now=20; resolve({id:"mug",title:"mug",priceCents:1000,active:true}); await read; if(cache.size!==1) throw Error("settled count differs"); now=24; if((await cache.getItem("mug")).id!=="mug") throw Error("TTL not settlement based"); console.log("verified: pending size=0, forget=false; success size=1, TTL begins at settlement")'
npm test 2>&1 | grep -E '^(✔|✖|ℹ|  [0-9]+ !== [0-9]+|  Error:)' ; test ${PIPESTATUS[0]} -eq 0
npm test
git --no-pager status --short; git --no-pager diff -- src/catalog-cache.ts
npm test
git --no-pager diff --check; git --no-pager diff -- src/catalog-cache.ts; git --no-pager status --short
nl -ba src/catalog-cache.ts | sed -n '15,67p'
git --no-pager diff --check && git --no-pager diff -- src/catalog-cache.ts test/catalog-cache.test.ts
npm test
npm test && git --no-pager diff --check
git status --short && git --no-pager diff --stat && git remote -v
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index 46f1335..19a643d 100644
--- a/README.md
+++ b/README.md
@@ -4,4 +4,6 @@ A small read-through cache for product catalog lookups. `CatalogCache` wraps an
 
 Repeated reads for a fresh item should use the cached result. Once an entry expires, the next read should ask upstream again. Different item ids are independent, and `getMany` returns results in the same order as the input ids.
 
+Concurrent reads of the same id share one upstream lookup. A successful lookup stays cached for the configured TTL starting when the lookup completes. Failed lookups are not cached, so a later read retries upstream. `forget(id)` clears both completed and pending lookups without cancelling requests already in progress.
+
 Run `npm test` with Node 24.
diff --git a/src/catalog-cache.ts b/src/catalog-cache.ts
index 78a06a1..7601883 100644
--- a/src/catalog-cache.ts
+++ b/src/catalog-cache.ts
@@ -16,6 +16,7 @@ export class CatalogCache {
   private readonly fetchItem: FetchCatalogItem;
   private readonly now: () => number;
   private readonly entries = new Map<string, CacheEntry>();
+  private readonly inFlight = new Map<string, Promise<CatalogItem>>();
 
   constructor(options: CatalogCacheOptions) {
     if (options.ttlMs <= 0) throw new RangeError("ttlMs must be positive");
@@ -30,15 +31,25 @@ export class CatalogCache {
       return cached.promise;
     }
 
+    const existing = this.inFlight.get(id);
+    if (existing) return existing;
+
     const promise = this.fetchItem(id);
-    try {
-      const item = await promise;
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
-      return item;
-    } catch (error) {
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
-      throw error;
-    }
+    const pending = promise.then(
+      (item) => {
+        if (this.inFlight.get(id) === pending) {
+          this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise: pending });
+          this.inFlight.delete(id);
+        }
+        return item;
+      },
+      (error) => {
+        if (this.inFlight.get(id) === pending) this.inFlight.delete(id);
+        throw error;
+      },
+    );
+    this.inFlight.set(id, pending);
+    return pending;
   }
 
   async getMany(ids: string[]): Promise<CatalogItem[]> {
@@ -46,6 +57,7 @@ export class CatalogCache {
   }
 
   forget(id: string): boolean {
+    this.inFlight.delete(id);
     return this.entries.delete(id);
   }
 
diff --git a/test/catalog-cache.test.ts b/test/catalog-cache.test.ts
index 92421b7..d92c8cb 100644
--- a/test/catalog-cache.test.ts
+++ b/test/catalog-cache.test.ts
@@ -47,3 +47,104 @@ test("getMany keeps input order and ids separate", async () => {
   assert.deepEqual(results.map((r) => r.id), ["pin", "mug", "pin"]);
   assert.equal(cache.size, 2);
 });
+
+test("concurrent reads share a pending lookup for the same id", async () => {
+  let calls = 0;
+  let complete!: (value: CatalogItem) => void;
+  const upstream = new Promise<CatalogItem>((resolve) => {
+    complete = resolve;
+  });
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async () => {
+      calls++;
+      return upstream;
+    },
+  });
+
+  const reads = [cache.getItem("mug"), cache.getItem("mug"), cache.getMany(["mug", "mug"])];
+  assert.equal(calls, 1);
+  complete(item("mug"));
+  const [first, second, batch] = await Promise.all(reads);
+  assert.deepEqual([first.id, second.id, ...batch.map((entry) => entry.id)], ["mug", "mug", "mug", "mug"]);
+  assert.equal(calls, 1);
+});
+
+test("a failed lookup can retry and cache a later success", async () => {
+  let calls = 0;
+  let fail!: (error: Error) => void;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: (id) => {
+      calls++;
+      if (calls > 1) return Promise.resolve(item(id));
+      return new Promise<CatalogItem>((_, reject) => {
+        fail = reject;
+      });
+    },
+  });
+
+  const first = cache.getItem("mug");
+  const second = cache.getItem("mug");
+  assert.equal(calls, 1);
+  fail(new Error("upstream unavailable"));
+  await assert.rejects(first, /upstream unavailable/);
+  await assert.rejects(second, /upstream unavailable/);
+  assert.equal((await cache.getItem("mug")).id, "mug");
+  assert.equal((await cache.getItem("mug")).id, "mug");
+  assert.equal(calls, 2);
+});
+
+test("TTL begins when a shared lookup completes", async () => {
+  let now = 10;
+  let calls = 0;
+  let complete!: (value: CatalogItem) => void;
+  const cache = new CatalogCache({
+    ttlMs: 5,
+    now: () => now,
+    fetchItem: (id) => {
+      calls++;
+      if (calls > 1) return Promise.resolve(item(id, "refreshed"));
+      return new Promise<CatalogItem>((resolve) => {
+        complete = resolve;
+      });
+    },
+  });
+
+  const first = cache.getItem("mug");
+  now = 20;
+  const second = cache.getItem("mug");
+  assert.equal(calls, 1);
+  complete(item("mug", "original"));
+  assert.equal((await first).title, "original");
+  assert.equal((await second).title, "original");
+  now = 24;
+  assert.equal((await cache.getItem("mug")).title, "original");
+  now = 25;
+  assert.equal((await cache.getItem("mug")).title, "refreshed");
+  assert.equal(calls, 2);
+});
+
+test("forget prevents an old in-flight lookup from repopulating the cache", async () => {
+  let calls = 0;
+  let complete!: (value: CatalogItem) => void;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: (id) => {
+      calls++;
+      if (calls > 1) return Promise.resolve(item(id, "new"));
+      return new Promise<CatalogItem>((resolve) => {
+        complete = resolve;
+      });
+    },
+  });
+
+  const old = cache.getItem("mug");
+  assert.equal(cache.size, 0);
+  assert.equal(cache.forget("mug"), false);
+  assert.equal((await cache.getItem("mug")).title, "new");
+  complete(item("mug", "old"));
+  assert.equal((await old).title, "old");
+  assert.equal((await cache.getItem("mug")).title, "new");
+  assert.equal(calls, 2);
+});

```

### Submission 2

Project test suite after the change: 8/8 passing.

Shell commands run, in order:

```text
git status --short && ls -la
node --version && npm --version
npm test
git diff --check && git --no-pager diff --stat && git status --short
npm test && git diff --check
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index 46f1335..51f2c72 100644
--- a/README.md
+++ b/README.md
@@ -2,6 +2,6 @@
 
 A small read-through cache for product catalog lookups. `CatalogCache` wraps an upstream fetch function and stores item data for a configured number of milliseconds.
 
-Repeated reads for a fresh item should use the cached result. Once an entry expires, the next read should ask upstream again. Different item ids are independent, and `getMany` returns results in the same order as the input ids.
+Repeated reads for a fresh item use the cached result. Concurrent lookups for the same id share one upstream request, both on a cold start and during refresh. The TTL starts when a successful lookup completes; once it expires, the next read asks upstream again. Failed lookups are not cached, so a later read can retry. Different item ids are independent, and `getMany` returns results in the same order as the input ids.
 
 Run `npm test` with Node 24.
diff --git a/src/catalog-cache.ts b/src/catalog-cache.ts
index 78a06a1..da35b64 100644
--- a/src/catalog-cache.ts
+++ b/src/catalog-cache.ts
@@ -11,11 +11,16 @@ type CacheEntry = {
   promise: Promise<CatalogItem>;
 };
 
+type PendingEntry = {
+  promise: Promise<CatalogItem>;
+};
+
 export class CatalogCache {
   private readonly ttlMs: number;
   private readonly fetchItem: FetchCatalogItem;
   private readonly now: () => number;
   private readonly entries = new Map<string, CacheEntry>();
+  private readonly inFlight = new Map<string, PendingEntry>();
 
   constructor(options: CatalogCacheOptions) {
     if (options.ttlMs <= 0) throw new RangeError("ttlMs must be positive");
@@ -25,19 +30,25 @@ export class CatalogCache {
   }
 
   async getItem(id: string): Promise<CatalogItem> {
+    const pending = this.inFlight.get(id);
+    if (pending) return pending.promise;
+
     const cached = this.entries.get(id);
     if (cached && cached.expiresAt > this.now()) {
       return cached.promise;
     }
 
     const promise = this.fetchItem(id);
+    const request = { promise };
+    this.inFlight.set(id, request);
     try {
       const item = await promise;
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
+      if (this.inFlight.get(id) === request) {
+        this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
+      }
       return item;
-    } catch (error) {
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
-      throw error;
+    } finally {
+      if (this.inFlight.get(id) === request) this.inFlight.delete(id);
     }
   }
 
@@ -46,7 +57,8 @@ export class CatalogCache {
   }
 
   forget(id: string): boolean {
-    return this.entries.delete(id);
+    const removed = this.entries.delete(id);
+    return this.inFlight.delete(id) || removed;
   }
 
   get size(): number {
diff --git a/test/catalog-cache.test.ts b/test/catalog-cache.test.ts
index 92421b7..d453f72 100644
--- a/test/catalog-cache.test.ts
+++ b/test/catalog-cache.test.ts
@@ -47,3 +47,118 @@ test("getMany keeps input order and ids separate", async () => {
   assert.deepEqual(results.map((r) => r.id), ["pin", "mug", "pin"]);
   assert.equal(cache.size, 2);
 });
+
+test("concurrent cold lookups share work per id, including getMany duplicates", async () => {
+  const mug = Promise.withResolvers<CatalogItem>();
+  const pin = Promise.withResolvers<CatalogItem>();
+  const calls: string[] = [];
+  const cache = new CatalogCache({
+    ttlMs: 5,
+    fetchItem: (id) => {
+      calls.push(id);
+      return id === "mug" ? mug.promise : pin.promise;
+    },
+  });
+
+  const first = cache.getItem("mug");
+  const batch = cache.getMany(["pin", "mug", "pin"]);
+  assert.deepEqual(calls, ["mug", "pin"]);
+  assert.equal(cache.size, 0);
+
+  mug.resolve(item("mug"));
+  pin.resolve(item("pin"));
+  assert.equal((await first).id, "mug");
+  assert.deepEqual((await batch).map((result) => result.id), ["pin", "mug", "pin"]);
+  assert.equal(cache.size, 2);
+});
+
+test("pending refresh stays shared even after the old TTL passes; new TTL starts on completion", async () => {
+  let now = 10;
+  let calls = 0;
+  const refresh = Promise.withResolvers<CatalogItem>();
+  const cache = new CatalogCache({
+    ttlMs: 5,
+    now: () => now,
+    fetchItem: async (id) => {
+      calls++;
+      return calls === 2 ? refresh.promise : item(id, `version-${calls}`);
+    },
+  });
+
+  assert.equal((await cache.getItem("mug")).title, "version-1");
+  now = 15;
+  const first = cache.getItem("mug");
+  now = 100;
+  const second = cache.getItem("mug");
+  assert.equal(calls, 2);
+  refresh.resolve(item("mug", "version-2"));
+  assert.equal((await first).title, "version-2");
+  assert.equal((await second).title, "version-2");
+  now = 104;
+  assert.equal((await cache.getItem("mug")).title, "version-2");
+  now = 105;
+  assert.equal((await cache.getItem("mug")).title, "version-3");
+  assert.equal(calls, 3);
+});
+
+test("failed concurrent lookups reject together but a later lookup retries", async () => {
+  const failure = Promise.withResolvers<CatalogItem>();
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      return calls === 1 ? failure.promise : item(id);
+    },
+  });
+
+  const first = cache.getItem("mug");
+  const second = cache.getItem("mug");
+  assert.equal(calls, 1);
+  failure.reject(new Error("upstream unavailable"));
+  const results = await Promise.allSettled([first, second]);
+  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
+  assert.equal(cache.size, 0);
+  assert.equal((await cache.getItem("mug")).id, "mug");
+  assert.equal(calls, 2);
+});
+
+test("failed refresh retries without extending the expired entry's TTL", async () => {
+  let now = 10;
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 5,
+    now: () => now,
+    fetchItem: async (id) => {
+      calls++;
+      if (calls === 2) throw new Error("upstream unavailable");
+      return item(id, `version-${calls}`);
+    },
+  });
+
+  assert.equal((await cache.getItem("mug")).title, "version-1");
+  now = 15;
+  await assert.rejects(cache.getItem("mug"), /upstream unavailable/);
+  assert.equal((await cache.getItem("mug")).title, "version-3");
+  assert.equal(calls, 3);
+});
+
+test("forget prevents a pending lookup from replacing a newer one", async () => {
+  const old = Promise.withResolvers<CatalogItem>();
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      return calls === 1 ? old.promise : item(id, "new");
+    },
+  });
+
+  const first = cache.getItem("mug");
+  assert.equal(cache.forget("mug"), true);
+  assert.equal((await cache.getItem("mug")).title, "new");
+  old.resolve(item("mug", "old"));
+  assert.equal((await first).title, "old");
+  assert.equal((await cache.getItem("mug")).title, "new");
+  assert.equal(calls, 2);
+});

```

## P5

Request:

> During a cold start the upstream catalog service got hammered with identical item lookups, and after a brief upstream outage our service kept returning errors for those same items until we restarted it. Please fix the catalog cache so it coalesces work without changing the time-to-live behavior.

### Submission 1

Project test suite after the change: 7/7 passing.

Shell commands run, in order:

```text
git status --short && ls -la
npm test
git --no-pager diff --check && git --no-pager diff --stat && node --version
npm test && git --no-pager diff --check && git status --short
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index 46f1335..7f0cffe 100644
--- a/README.md
+++ b/README.md
@@ -3,5 +3,6 @@
 A small read-through cache for product catalog lookups. `CatalogCache` wraps an upstream fetch function and stores item data for a configured number of milliseconds.
 
 Repeated reads for a fresh item should use the cached result. Once an entry expires, the next read should ask upstream again. Different item ids are independent, and `getMany` returns results in the same order as the input ids.
+Concurrent reads for the same item share one upstream lookup, including when refreshing an expired entry. Only successful lookups are cached; their TTL starts when the lookup completes. Failed lookups can be retried immediately, and `forget` invalidates a pending lookup as well as a completed entry.
 
 Run `npm test` with Node 24.
diff --git a/src/catalog-cache.ts b/src/catalog-cache.ts
index 78a06a1..45bfef4 100644
--- a/src/catalog-cache.ts
+++ b/src/catalog-cache.ts
@@ -16,6 +16,7 @@ export class CatalogCache {
   private readonly fetchItem: FetchCatalogItem;
   private readonly now: () => number;
   private readonly entries = new Map<string, CacheEntry>();
+  private readonly inFlight = new Map<string, Promise<CatalogItem>>();
 
   constructor(options: CatalogCacheOptions) {
     if (options.ttlMs <= 0) throw new RangeError("ttlMs must be positive");
@@ -30,14 +31,19 @@ export class CatalogCache {
       return cached.promise;
     }
 
+    const pending = this.inFlight.get(id);
+    if (pending) return pending;
+
     const promise = this.fetchItem(id);
+    this.inFlight.set(id, promise);
     try {
       const item = await promise;
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
+      if (this.inFlight.get(id) === promise) {
+        this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
+      }
       return item;
-    } catch (error) {
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
-      throw error;
+    } finally {
+      if (this.inFlight.get(id) === promise) this.inFlight.delete(id);
     }
   }
 
@@ -46,7 +52,9 @@ export class CatalogCache {
   }
 
   forget(id: string): boolean {
-    return this.entries.delete(id);
+    const hadEntry = this.entries.delete(id);
+    const hadPending = this.inFlight.delete(id);
+    return hadEntry || hadPending;
   }
 
   get size(): number {
diff --git a/test/catalog-cache.test.ts b/test/catalog-cache.test.ts
index 92421b7..874055f 100644
--- a/test/catalog-cache.test.ts
+++ b/test/catalog-cache.test.ts
@@ -7,6 +7,16 @@ function item(id: string, title = id): CatalogItem {
   return { id, title, priceCents: 1000, active: true };
 }
 
+function deferred<T>() {
+  let resolve!: (value: T) => void;
+  let reject!: (reason: Error) => void;
+  const promise = new Promise<T>((accept, decline) => {
+    resolve = accept;
+    reject = decline;
+  });
+  return { promise, resolve, reject };
+}
+
 test("reuses a completed lookup while it is fresh", async () => {
   let calls = 0;
   const cache = new CatalogCache({
@@ -47,3 +57,116 @@ test("getMany keeps input order and ids separate", async () => {
   assert.deepEqual(results.map((r) => r.id), ["pin", "mug", "pin"]);
   assert.equal(cache.size, 2);
 });
+
+test("concurrent misses share a lookup and TTL starts when it completes", async () => {
+  let now = 0;
+  const firstLookup = deferred<CatalogItem>();
+  let mugCalls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 5,
+    now: () => now,
+    fetchItem: async (id) => {
+      if (id === "pin") return item(id);
+      mugCalls++;
+      return mugCalls === 1 ? firstLookup.promise : item(id, "refreshed");
+    },
+  });
+
+  const batch = cache.getMany(["mug", "pin", "mug"]);
+  const concurrent = cache.getItem("mug");
+  assert.equal(mugCalls, 1);
+  assert.equal(cache.size, 0);
+  now = 50;
+  firstLookup.resolve(item("mug", "original"));
+  assert.deepEqual((await batch).map((result) => result.title), ["original", "pin", "original"]);
+  assert.equal((await concurrent).title, "original");
+  assert.equal(cache.size, 2);
+  now = 54;
+  assert.equal((await cache.getItem("mug")).title, "original");
+  now = 55;
+  assert.equal((await cache.getItem("mug")).title, "refreshed");
+  assert.equal(mugCalls, 2);
+});
+
+test("a failed cold lookup is shared but not cached", async () => {
+  const failedLookup = deferred<CatalogItem>();
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      return calls === 1 ? failedLookup.promise : item(id);
+    },
+  });
+
+  const first = cache.getItem("mug");
+  const second = cache.getItem("mug");
+  assert.equal(calls, 1);
+  const outage = new Error("upstream unavailable");
+  failedLookup.reject(outage);
+  const results = await Promise.allSettled([first, second]);
+  assert.deepEqual(results, [
+    { status: "rejected", reason: outage },
+    { status: "rejected", reason: outage },
+  ]);
+  assert.equal(cache.size, 0);
+  assert.equal((await cache.getItem("mug")).id, "mug");
+  assert.equal(calls, 2);
+});
+
+test("expired entries coalesce refreshes and failed lookups can be retried", async () => {
+  let now = 0;
+  const refresh = deferred<CatalogItem>();
+  const retry = deferred<CatalogItem>();
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 5,
+    now: () => now,
+    fetchItem: (id) => {
+      calls++;
+      if (calls === 1) return Promise.resolve(item(id, "original"));
+      return calls === 2 ? refresh.promise : retry.promise;
+    },
+  });
+
+  assert.equal((await cache.getItem("mug")).title, "original");
+  now = 5;
+  const first = cache.getItem("mug");
+  const second = cache.getItem("mug");
+  assert.equal(calls, 2);
+  refresh.reject(new Error("upstream unavailable"));
+  const results = await Promise.allSettled([first, second]);
+  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
+  assert.equal(cache.size, 1);
+
+  const recovered = cache.getItem("mug");
+  const shared = cache.getItem("mug");
+  assert.equal(calls, 3);
+  retry.resolve(item("mug", "recovered"));
+  assert.equal((await recovered).title, "recovered");
+  assert.equal((await shared).title, "recovered");
+  assert.equal((await cache.getItem("mug")).title, "recovered");
+  assert.equal(calls, 3);
+});
+
+test("forget invalidates a pending lookup without allowing it to replace a newer result", async () => {
+  const oldLookup = deferred<CatalogItem>();
+  const newLookup = deferred<CatalogItem>();
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: () => (++calls === 1 ? oldLookup.promise : newLookup.promise),
+  });
+
+  const oldRead = cache.getItem("mug");
+  assert.equal(cache.size, 0);
+  assert.equal(cache.forget("mug"), true);
+  const newRead = cache.getItem("mug");
+  assert.equal(calls, 2);
+  newLookup.resolve(item("mug", "new"));
+  assert.equal((await newRead).title, "new");
+  oldLookup.resolve(item("mug", "old"));
+  assert.equal((await oldRead).title, "old");
+  assert.equal((await cache.getItem("mug")).title, "new");
+  assert.equal(calls, 2);
+});

```

### Submission 2

Project test suite after the change: 6/6 passing.

Shell commands run, in order:

```text
git status --short && ls -la
npm test
npm test && git diff --check && git --no-pager diff --stat
npm test && git diff --check && git --no-pager diff
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index 46f1335..c5ed2f6 100644
--- a/README.md
+++ b/README.md
@@ -4,4 +4,6 @@ A small read-through cache for product catalog lookups. `CatalogCache` wraps an
 
 Repeated reads for a fresh item should use the cached result. Once an entry expires, the next read should ask upstream again. Different item ids are independent, and `getMany` returns results in the same order as the input ids.
 
+Concurrent reads for the same item share one upstream request, including after expiry. The TTL starts when that request succeeds. A failed request rejects its waiting reads but is not cached, so the next read retries upstream.
+
 Run `npm test` with Node 24.
diff --git a/src/catalog-cache.ts b/src/catalog-cache.ts
index 78a06a1..3b2ff48 100644
--- a/src/catalog-cache.ts
+++ b/src/catalog-cache.ts
@@ -16,6 +16,7 @@ export class CatalogCache {
   private readonly fetchItem: FetchCatalogItem;
   private readonly now: () => number;
   private readonly entries = new Map<string, CacheEntry>();
+  private readonly pending = new Map<string, Promise<CatalogItem>>();
 
   constructor(options: CatalogCacheOptions) {
     if (options.ttlMs <= 0) throw new RangeError("ttlMs must be positive");
@@ -30,14 +31,17 @@ export class CatalogCache {
       return cached.promise;
     }
 
+    const pending = this.pending.get(id);
+    if (pending) return pending;
+
     const promise = this.fetchItem(id);
+    this.pending.set(id, promise);
     try {
       const item = await promise;
       this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
       return item;
-    } catch (error) {
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
-      throw error;
+    } finally {
+      this.pending.delete(id);
     }
   }
 
diff --git a/test/catalog-cache.test.ts b/test/catalog-cache.test.ts
index 92421b7..e132c8b 100644
--- a/test/catalog-cache.test.ts
+++ b/test/catalog-cache.test.ts
@@ -47,3 +47,81 @@ test("getMany keeps input order and ids separate", async () => {
   assert.deepEqual(results.map((r) => r.id), ["pin", "mug", "pin"]);
   assert.equal(cache.size, 2);
 });
+
+test("concurrent reads share one lookup per item", async () => {
+  const requests = new Map<string, ReturnType<typeof Promise.withResolvers<CatalogItem>>>();
+  const calls: string[] = [];
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: (id) => {
+      calls.push(id);
+      const request = Promise.withResolvers<CatalogItem>();
+      requests.set(id, request);
+      return request.promise;
+    },
+  });
+
+  const first = cache.getItem("mug");
+  const batch = cache.getMany(["mug", "tote", "mug"]);
+  assert.deepEqual(calls, ["mug", "tote"]);
+  requests.get("mug")!.resolve(item("mug"));
+  requests.get("tote")!.resolve(item("tote"));
+  assert.equal((await first).id, "mug");
+  assert.deepEqual((await batch).map((result) => result.id), ["mug", "tote", "mug"]);
+  assert.equal(cache.size, 2);
+});
+
+test("failed lookups are shared while pending but retried after rejection", async () => {
+  const failure = Promise.withResolvers<CatalogItem>();
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      if (calls === 1) return failure.promise;
+      return item(id);
+    },
+  });
+
+  const first = cache.getItem("mug");
+  const second = cache.getItem("mug");
+  assert.equal(calls, 1);
+  const outage = new Error("upstream unavailable");
+  failure.reject(outage);
+  const results = await Promise.allSettled([first, second]);
+  assert.deepEqual(results, [
+    { status: "rejected", reason: outage },
+    { status: "rejected", reason: outage },
+  ]);
+  assert.equal(cache.size, 0);
+  assert.equal((await cache.getItem("mug")).id, "mug");
+  assert.equal(calls, 2);
+});
+
+test("a shared lookup starts its TTL when it resolves", async () => {
+  let now = 10;
+  let calls = 0;
+  const request = Promise.withResolvers<CatalogItem>();
+  const cache = new CatalogCache({
+    ttlMs: 5,
+    now: () => now,
+    fetchItem: async (id) => {
+      calls++;
+      if (calls === 1) return request.promise;
+      return item(id, `version-${calls}`);
+    },
+  });
+
+  const first = cache.getItem("mug");
+  now = 20;
+  const second = cache.getItem("mug");
+  assert.equal(calls, 1);
+  request.resolve(item("mug", "version-1"));
+  await Promise.all([first, second]);
+  now = 24;
+  assert.equal((await cache.getItem("mug")).title, "version-1");
+  now = 25;
+  const refreshed = await Promise.all([cache.getItem("mug"), cache.getItem("mug")]);
+  assert.deepEqual(refreshed.map((result) => result.title), ["version-2", "version-2"]);
+  assert.equal(calls, 2);
+});

```

## P6

Request:

> During a cold start the upstream catalog service got hammered with identical item lookups, and after a brief upstream outage our service kept returning errors for those same items until we restarted it. Please fix the catalog cache so it coalesces work without changing the time-to-live behavior.

### Submission 1

Project test suite after the change: 7/7 passing.

Shell commands run, in order:

```text
git status --short && ls -la
node --version && npm test
npm test
git --no-pager diff --check && git --no-pager diff --stat && git --no-pager diff
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index 46f1335..2b1b313 100644
--- a/README.md
+++ b/README.md
@@ -2,6 +2,6 @@
 
 A small read-through cache for product catalog lookups. `CatalogCache` wraps an upstream fetch function and stores item data for a configured number of milliseconds.
 
-Repeated reads for a fresh item should use the cached result. Once an entry expires, the next read should ask upstream again. Different item ids are independent, and `getMany` returns results in the same order as the input ids.
+Concurrent reads for the same item share one upstream lookup, including after an entry expires. Successful results remain cached for the configured TTL starting when the lookup completes; failed lookups are not cached and can be retried. Different item ids are independent, and `getMany` returns results in the same order as the input ids.
 
 Run `npm test` with Node 24.
diff --git a/src/catalog-cache.ts b/src/catalog-cache.ts
index 78a06a1..485f95e 100644
--- a/src/catalog-cache.ts
+++ b/src/catalog-cache.ts
@@ -6,10 +6,9 @@ export type CatalogCacheOptions = {
   now?: () => number;
 };
 
-type CacheEntry = {
-  expiresAt: number;
-  promise: Promise<CatalogItem>;
-};
+type CacheEntry =
+  | { status: "pending"; promise: Promise<CatalogItem> }
+  | { status: "fresh"; expiresAt: number; promise: Promise<CatalogItem> };
 
 export class CatalogCache {
   private readonly ttlMs: number;
@@ -26,17 +25,21 @@ export class CatalogCache {
 
   async getItem(id: string): Promise<CatalogItem> {
     const cached = this.entries.get(id);
-    if (cached && cached.expiresAt > this.now()) {
+    if (cached && (cached.status === "pending" || cached.expiresAt > this.now())) {
       return cached.promise;
     }
 
     const promise = this.fetchItem(id);
+    const pending: CacheEntry = { status: "pending", promise };
+    this.entries.set(id, pending);
     try {
       const item = await promise;
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
+      if (this.entries.get(id) === pending) {
+        this.entries.set(id, { status: "fresh", expiresAt: this.now() + this.ttlMs, promise });
+      }
       return item;
     } catch (error) {
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
+      if (this.entries.get(id) === pending) this.entries.delete(id);
       throw error;
     }
   }
diff --git a/test/catalog-cache.test.ts b/test/catalog-cache.test.ts
index 92421b7..82707a5 100644
--- a/test/catalog-cache.test.ts
+++ b/test/catalog-cache.test.ts
@@ -47,3 +47,112 @@ test("getMany keeps input order and ids separate", async () => {
   assert.deepEqual(results.map((r) => r.id), ["pin", "mug", "pin"]);
   assert.equal(cache.size, 2);
 });
+
+test("coalesces concurrent lookups for each id, including getMany duplicates", async () => {
+  const pin = Promise.withResolvers<CatalogItem>();
+  const mug = Promise.withResolvers<CatalogItem>();
+  const calls: string[] = [];
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: (id) => {
+      calls.push(id);
+      return id === "pin" ? pin.promise : mug.promise;
+    },
+  });
+
+  const many = cache.getMany(["pin", "mug", "pin"]);
+  const single = cache.getItem("pin");
+  assert.deepEqual(calls, ["pin", "mug"]);
+  assert.equal(cache.size, 2);
+
+  mug.resolve(item("mug"));
+  pin.resolve(item("pin"));
+  assert.deepEqual((await many).map((result) => result.id), ["pin", "mug", "pin"]);
+  assert.deepEqual(await single, item("pin"));
+});
+
+test("starts TTL when a lookup completes and coalesces expired refreshes", async () => {
+  let now = 10;
+  let calls = 0;
+  const first = Promise.withResolvers<CatalogItem>();
+  const refresh = Promise.withResolvers<CatalogItem>();
+  const cache = new CatalogCache({
+    ttlMs: 5,
+    now: () => now,
+    fetchItem: (id) => {
+      calls++;
+      return calls === 1 ? first.promise : calls === 2 ? refresh.promise : Promise.resolve(item(id, "third"));
+    },
+  });
+
+  const initial = cache.getItem("tote");
+  now = 100;
+  const alsoInitial = cache.getItem("tote");
+  assert.equal(calls, 1);
+  first.resolve(item("tote", "first"));
+  assert.equal((await initial).title, "first");
+  assert.equal((await alsoInitial).title, "first");
+
+  now = 104;
+  assert.equal((await cache.getItem("tote")).title, "first");
+  now = 105;
+  const updated = cache.getItem("tote");
+  const alsoUpdated = cache.getItem("tote");
+  assert.equal(calls, 2);
+  now = 200;
+  refresh.resolve(item("tote", "second"));
+  assert.equal((await updated).title, "second");
+  assert.equal((await alsoUpdated).title, "second");
+  now = 204;
+  assert.equal((await cache.getItem("tote")).title, "second");
+  now = 205;
+  assert.equal((await cache.getItem("tote")).title, "third");
+  assert.equal(calls, 3);
+});
+
+test("shares in-flight failures but retries after rejection", async () => {
+  const first = Promise.withResolvers<CatalogItem>();
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      return calls === 1 ? first.promise : item(id, "recovered");
+    },
+  });
+
+  const one = cache.getItem("mug");
+  const two = cache.getItem("mug");
+  assert.equal(calls, 1);
+  const outage = new Error("upstream unavailable");
+  first.reject(outage);
+  assert.deepEqual(await Promise.allSettled([one, two]), [
+    { status: "rejected", reason: outage },
+    { status: "rejected", reason: outage },
+  ]);
+  assert.equal(cache.size, 0);
+  assert.equal((await cache.getItem("mug")).title, "recovered");
+  assert.equal(calls, 2);
+});
+
+test("forgetting an in-flight lookup does not replace a newer lookup", async () => {
+  const first = Promise.withResolvers<CatalogItem>();
+  const second = Promise.withResolvers<CatalogItem>();
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: () => (++calls === 1 ? first.promise : second.promise),
+  });
+
+  const forgotten = cache.getItem("pin");
+  assert.equal(cache.forget("pin"), true);
+  const current = cache.getItem("pin");
+  first.resolve(item("pin", "forgotten"));
+  assert.equal((await forgotten).title, "forgotten");
+  const shared = cache.getItem("pin");
+  assert.equal(calls, 2);
+  second.resolve(item("pin", "current"));
+  assert.equal((await current).title, "current");
+  assert.equal((await shared).title, "current");
+  assert.equal((await cache.getItem("pin")).title, "current");
+});

```

### Submission 2

Project test suite after the change: 7/7 passing.

Shell commands run, in order:

```text
git status --short && ls -la && find . -maxdepth 3 \( -name AGENTS.md -o -name CLAUDE.md -o -name copilot-instructions.md \) -print
ls -la src test && git --no-pager log -5 --oneline
node --version && git remote -v
npm test -- --test-name-pattern='coalesces|failed lookups|full TTL'
npm test -- --test-name-pattern='a failed lookup is not cached'
npm test && git --no-pager diff --check && git --no-pager diff --stat
git --no-pager diff -- src/catalog-cache.ts test/catalog-cache.test.ts README.md
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index 46f1335..590083a 100644
--- a/README.md
+++ b/README.md
@@ -4,4 +4,6 @@ A small read-through cache for product catalog lookups. `CatalogCache` wraps an
 
 Repeated reads for a fresh item should use the cached result. Once an entry expires, the next read should ask upstream again. Different item ids are independent, and `getMany` returns results in the same order as the input ids.
 
+Concurrent requests for the same id share one upstream lookup. Successful results expire `ttlMs` after the lookup completes. Failed lookups are not cached, so the next request retries upstream.
+
 Run `npm test` with Node 24.
diff --git a/src/catalog-cache.ts b/src/catalog-cache.ts
index 78a06a1..be93fce 100644
--- a/src/catalog-cache.ts
+++ b/src/catalog-cache.ts
@@ -16,6 +16,7 @@ export class CatalogCache {
   private readonly fetchItem: FetchCatalogItem;
   private readonly now: () => number;
   private readonly entries = new Map<string, CacheEntry>();
+  private readonly inFlight = new Map<string, Promise<CatalogItem>>();
 
   constructor(options: CatalogCacheOptions) {
     if (options.ttlMs <= 0) throw new RangeError("ttlMs must be positive");
@@ -30,15 +31,16 @@ export class CatalogCache {
       return cached.promise;
     }
 
+    const pending = this.inFlight.get(id);
+    if (pending) return pending;
+
     const promise = this.fetchItem(id);
-    try {
-      const item = await promise;
+    const load = promise.then((item) => {
       this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
       return item;
-    } catch (error) {
-      this.entries.set(id, { expiresAt: this.now() + this.ttlMs, promise });
-      throw error;
-    }
+    }).finally(() => this.inFlight.delete(id));
+    this.inFlight.set(id, load);
+    return load;
   }
 
   async getMany(ids: string[]): Promise<CatalogItem[]> {
diff --git a/test/catalog-cache.test.ts b/test/catalog-cache.test.ts
index 92421b7..25cc43e 100644
--- a/test/catalog-cache.test.ts
+++ b/test/catalog-cache.test.ts
@@ -47,3 +47,86 @@ test("getMany keeps input order and ids separate", async () => {
   assert.deepEqual(results.map((r) => r.id), ["pin", "mug", "pin"]);
   assert.equal(cache.size, 2);
 });
+
+test("coalesces simultaneous lookups, including duplicate ids in getMany", async () => {
+  let calls = 0;
+  let resolve!: (value: CatalogItem) => void;
+  const pending = new Promise<CatalogItem>((done) => { resolve = done; });
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async () => {
+      calls++;
+      return pending;
+    },
+  });
+
+  const first = cache.getItem("mug");
+  const batch = cache.getMany(["mug", "mug"]);
+  assert.equal(calls, 1);
+  resolve(item("mug"));
+  assert.deepEqual([await first, ...await batch], [item("mug"), item("mug"), item("mug")]);
+  assert.equal(calls, 1);
+});
+
+test("failed lookups are shared while pending but retried after rejection", async () => {
+  let calls = 0;
+  let reject!: (error: Error) => void;
+  const pending = new Promise<CatalogItem>((_, fail) => { reject = fail; });
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      calls++;
+      if (calls === 1) return pending;
+      return item(id);
+    },
+  });
+
+  const first = cache.getItem("mug");
+  const second = cache.getItem("mug");
+  assert.equal(calls, 1);
+  reject(new Error("upstream unavailable"));
+  const results = await Promise.allSettled([first, second]);
+  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
+  assert.equal((await cache.getItem("mug")).id, "mug");
+  assert.equal(calls, 2);
+});
+
+test("a failed lookup is not cached for the TTL", async () => {
+  let calls = 0;
+  const cache = new CatalogCache({
+    ttlMs: 1000,
+    fetchItem: async (id) => {
+      if (++calls === 1) throw new Error("upstream unavailable");
+      return item(id);
+    },
+  });
+
+  await assert.rejects(cache.getItem("mug"), /upstream unavailable/);
+  assert.equal((await cache.getItem("mug")).id, "mug");
+  assert.equal(calls, 2);
+});
+
+test("successful lookups retain a full TTL from completion, not request start", async () => {
+  let now = 10;
+  let calls = 0;
+  let resolve!: (value: CatalogItem) => void;
+  const pending = new Promise<CatalogItem>((done) => { resolve = done; });
+  const cache = new CatalogCache({
+    ttlMs: 5,
+    now: () => now,
+    fetchItem: async (id) => {
+      calls++;
+      return calls === 1 ? pending : item(id, `version-${calls}`);
+    },
+  });
+
+  const first = cache.getItem("mug");
+  now = 20;
+  resolve(item("mug", "version-1"));
+  await first;
+  now = 24;
+  assert.equal((await cache.getItem("mug")).title, "version-1");
+  now = 25;
+  assert.equal((await cache.getItem("mug")).title, "version-2");
+  assert.equal(calls, 2);
+});

```

## P7

Request:

> Finance reconciliation is flagging some payouts where the recipient parts do not add up to the amount we actually paid, usually off by a cent or two. Please fix the split calculation for integer cents while preserving refunds and the existing deterministic ordering rules.

### Submission 1

Project test suite after the change: 4/4 passing.

Shell commands run, in order:

```text
find . -type f -not -path "./node_modules/*" -not -path "./.git/*" | head -100
cd . && grep -rn "weight" --include=*.ts . | grep -v node_modules
cd . && cat package.json
cd . && npm test 2>&1
cd . && node --experimental-strip-types -e '
  import("./src/split.ts").then(({ splitPayout }) => {
    const r = [{id:"a",weight:1},{id:"b",weight:1},{id:"c",weight:1}];
    console.log(splitPayout(100, r)); // 33,33,34 sums to 100
    console.log(splitPayout(-100, r)); // refund, sums to -100
    console.log(splitPayout(10, [{id:"a",weight:1},{id:"b",weight:2},{id:"c",weight:3}]));
  });
  ' 2>&1
```

Diff against the starting commit:

```diff
diff --git a/src/split.ts b/src/split.ts
index d278c95..1e4423a 100644
--- a/src/split.ts
+++ b/src/split.ts
@@ -1,13 +1,57 @@
 import { assertValidRecipients, totalWeight } from "./recipients.ts";
 import type { Recipient, Share } from "./types.ts";
 
+// Floor division for BigInt that always rounds toward negative infinity, matching
+// Math.floor semantics (BigInt's native "/" truncates toward zero instead).
+function floorDivBigInt(numerator: bigint, denominator: bigint): bigint {
+  const quotient = numerator / denominator;
+  const remainder = numerator % denominator;
+  return remainder !== 0n && remainder < 0n !== denominator < 0n ? quotient - 1n : quotient;
+}
+
 export function splitPayout(amountCents: number, recipients: Recipient[]): Share[] {
   assertValidRecipients(recipients);
   const weight = totalWeight(recipients);
   if (weight === 0) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
 
-  return recipients.map((recipient) => ({
-    recipientId: recipient.id,
-    cents: Math.round((amountCents * recipient.weight) / weight),
+  // Use the largest-remainder method with exact BigInt arithmetic so per-recipient
+  // shares always sum to exactly amountCents (including negative amounts, i.e.
+  // refunds), instead of each share rounding independently and drifting off by a
+  // cent or two.
+  const total = BigInt(amountCents);
+  const denom = BigInt(weight);
+
+  const pieces = recipients.map((recipient, index) => {
+    // Weights are expected to be non-negative integers; guard against fractional
+    // input so BigInt conversion never throws.
+    if (!Number.isInteger(recipient.weight)) {
+      throw new RangeError(`Non-integer weight for ${recipient.id}`);
+    }
+    const numerator = total * BigInt(recipient.weight);
+    const base = floorDivBigInt(numerator, denom);
+    const remainder = numerator - base * denom;
+    return { recipient, index, base, remainder };
+  });
+
+  const distributed = pieces.reduce((sum, piece) => sum + piece.base, 0n);
+  let leftover = Number(total - distributed);
+
+  // Distribute the remaining cents to the recipients with the largest remainders
+  // first, breaking ties by original recipient order for deterministic results.
+  const order = [...pieces].sort((a, b) => {
+    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
+    return a.index - b.index;
+  });
+
+  const bonuses = new Map<number, bigint>();
+  for (const piece of order) {
+    if (leftover <= 0) break;
+    bonuses.set(piece.index, 1n);
+    leftover -= 1;
+  }
+
+  return pieces.map((piece) => ({
+    recipientId: piece.recipient.id,
+    cents: Number(piece.base + (bonuses.get(piece.index) ?? 0n)),
   }));
 }

```

### Submission 2

Project test suite after the change: 7/7 passing.

Shell commands run, in order:

```text
cd "." && cat package.json && git log --oneline -15
cd "." && node --experimental-strip-types -e '
  import("./src/split.ts").then(({splitPayout}) => {
    const recipients = [{id:"a",weight:1},{id:"b",weight:1},{id:"c",weight:1}];
    const shares = splitPayout(100, recipients);
    console.log(shares, shares.reduce((s,x)=>s+x.cents,0));
  });
  '
  
cd "." && npm test 2>&1
cd "." && git diff --stat && git add -A && git status --short
cd "." && git remote -v
cd "." && git commit -q -m "Fix splitPayout so shares always sum to the original amount
  
  splitPayout rounded each recipient's share independently with
  Math.round, so the per-recipient roundings didn't reconcile against
  the paid amount (e.g. 100 cents across 3 equal-weight recipients
  summed to 99). Replaced it with the largest-remainder method: floor
  each proportional share, then hand out the leftover cents to the
  recipients with the largest fractional remainder, breaking exact ties
  toward earlier recipients per the README spec. Clawbacks still
  allocate against the absolute amount and reapply the sign, so a
  negative payout is the exact negation of the same positive split.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git log --oneline -3
```

Diff against the starting commit:

```diff
diff --git a/src/split.ts b/src/split.ts
index d278c95..c814e5b 100644
--- a/src/split.ts
+++ b/src/split.ts
@@ -6,8 +6,31 @@ export function splitPayout(amountCents: number, recipients: Recipient[]): Share
   const weight = totalWeight(recipients);
   if (weight === 0) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
 
-  return recipients.map((recipient) => ({
+  // Clawbacks split as the exact negation of the same positive payout, so
+  // allocate against the absolute amount and reapply the sign at the end.
+  const sign = amountCents < 0 ? -1 : 1;
+  const absoluteCents = Math.abs(amountCents);
+
+  const allocations = recipients.map((recipient) => {
+    const exact = (absoluteCents * recipient.weight) / weight;
+    const base = Math.floor(exact);
+    return { base, remainder: exact - base };
+  });
+
+  // Largest-remainder method: hand out the cents floor() dropped, one at a
+  // time, to the recipients with the biggest fractional remainder. Exact
+  // ties keep the input order, since the sort below is stable and only
+  // reorders by remainder.
+  let leftoverCents = absoluteCents - allocations.reduce((sum, allocation) => sum + allocation.base, 0);
+  const byRemainder = [...allocations].sort((a, b) => b.remainder - a.remainder);
+  for (const allocation of byRemainder) {
+    if (leftoverCents <= 0) break;
+    allocation.base += 1;
+    leftoverCents -= 1;
+  }
+
+  return recipients.map((recipient, index) => ({
     recipientId: recipient.id,
-    cents: Math.round((amountCents * recipient.weight) / weight),
+    cents: sign * allocations[index].base,
   }));
 }
diff --git a/test/split.test.ts b/test/split.test.ts
index b182115..fdf2a55 100644
--- a/test/split.test.ts
+++ b/test/split.test.ts
@@ -26,3 +26,28 @@ test("rejects negative weights", () => {
 test("summary uses the split order", () => {
   assert.equal(summarizeSplit(400, recipients), "artist:300,label:100");
 });
+
+test("shares always sum to the original amount despite fractional remainders", () => {
+  const equalWeights = [{ id: "a", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 1 }];
+  const shares = splitPayout(100, equalWeights);
+  assert.equal(shares.reduce((sum, share) => sum + share.cents, 0), 100);
+});
+
+test("exact ties for the leftover cent go to earlier recipients", () => {
+  const equalWeights = [{ id: "a", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 1 }];
+  assert.deepEqual(splitPayout(100, equalWeights), [
+    { recipientId: "a", cents: 34 },
+    { recipientId: "b", cents: 33 },
+    { recipientId: "c", cents: 33 },
+  ]);
+});
+
+test("refund clawbacks are the exact negation of the same positive payout", () => {
+  const equalWeights = [{ id: "a", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 1 }];
+  const payout = splitPayout(100, equalWeights);
+  const clawback = splitPayout(-100, equalWeights);
+  assert.deepEqual(
+    clawback.map((share) => share.cents),
+    payout.map((share) => -share.cents),
+  );
+});

```

## P8

Request:

> Finance reconciliation is flagging some payouts where the recipient parts do not add up to the amount we actually paid, usually off by a cent or two. Please fix the split calculation for integer cents while preserving refunds and the existing deterministic ordering rules.

### Submission 1

Project test suite after the change: 4/4 passing.

Shell commands run, in order:

```text
grep -rn "split" --include=*.* -l . | grep -v node_modules | grep -v test
cd . && npm test 2>&1
cd . && node --experimental-strip-types -e '
  import("./src/split.ts").then(({splitPayout}) => {
    const recipients = [{id:"a",weight:3},{id:"b",weight:1},{id:"c",weight:1}];
    for (const amt of [1000, 1001, 999, -1001, 7, -7]) {
      const shares = splitPayout(amt, recipients);
      const sum = shares.reduce((s,x)=>s+x.cents,0);
      console.log(amt, JSON.stringify(shares), "sum=",sum, sum===amt?"OK":"MISMATCH");
    }
  });
  ' 2>&1
```

Diff against the starting commit:

```diff
diff --git a/src/split.ts b/src/split.ts
index d278c95..9dbc016 100644
--- a/src/split.ts
+++ b/src/split.ts
@@ -6,8 +6,34 @@ export function splitPayout(amountCents: number, recipients: Recipient[]): Share
   const weight = totalWeight(recipients);
   if (weight === 0) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
 
-  return recipients.map((recipient) => ({
+  // Refunds are the exact negation of the same positive payout's split, so
+  // allocate against the absolute amount and re-apply the sign at the end.
+  const sign = amountCents < 0 ? -1 : 1;
+  const absAmount = Math.abs(amountCents);
+
+  const allocations = recipients.map((recipient, index) => {
+    const product = absAmount * recipient.weight;
+    return {
+      index,
+      base: Math.floor(product / weight),
+      remainder: product % weight,
+    };
+  });
+
+  const allocated = allocations.reduce((sum, allocation) => sum + allocation.base, 0);
+  let leftover = absAmount - allocated;
+
+  // Distribute remaining cents to the largest fractional remainders; ties
+  // (including remainder 0 once leftover forces it) go to earlier recipients.
+  const byRemainder = [...allocations].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
+  for (const allocation of byRemainder) {
+    if (leftover <= 0) break;
+    allocation.base += 1;
+    leftover -= 1;
+  }
+
+  return recipients.map((recipient, index) => ({
     recipientId: recipient.id,
-    cents: Math.round((amountCents * recipient.weight) / weight),
+    cents: sign * allocations[index].base,
   }));
 }

```

### Submission 2

Project test suite after the change: 4/4 passing.

Shell commands run, in order:

```text
grep -rn "split" --include=*.* -il . --exclude-dir=node_modules 2>/dev/null | head -50
cd . && cat package.json | grep -A2 '"test"' && npm test 2>&1
cd . && node --experimental-strip-types -e '
  import { splitPayout } from "./src/split.ts";
  
  function check(amount, recipients) {
    const shares = splitPayout(amount, recipients);
    const sum = shares.reduce((s, x) => s + x.cents, 0);
    console.log(amount, JSON.stringify(shares), "sum=", sum, sum === amount ? "OK" : "MISMATCH");
  }
  
  // classic case that breaks naive rounding: 100 split 3 ways
  check(100, [{id:"a",weight:1},{id:"b",weight:1},{id:"c",weight:1}]);
  // refund / clawback
  check(-100, [{id:"a",weight:1},{id:"b",weight:1},{id:"c",weight:1}]);
  // tie-break: equal remainders, earlier recipient wins
  check(10, [{id:"a",weight:1},{id:"b",weight:1},{id:"c",weight:1},{id:"d",weight:1}]);
  // random stress test
  for (let i=0;i<2000;i++){
    const n = 1 + Math.floor(Math.random()*5);
    const recipients = Array.from({length:n},(_,i)=>({id:"r"+i, weight: Math.floor(Math.random()*10)}));
    const amount = Math.floor(Math.random()*100000) - 50000;
    const shares = splitPayout(amount, recipients);
    const sum = shares.reduce((s,x)=>s+x.cents,0);
    if (sum !== amount) { console.log("FAIL", amount, recipients, shares); process.exit(1); }
  }
  console.log("stress test passed");
  '
  
cd . && node --experimental-strip-types -e '
  import { splitPayout } from "./src/split.ts";
  for (let i=0;i<5000;i++){
    const n = 1 + Math.floor(Math.random()*5);
    const recipients = Array.from({length:n},(_,i)=>({id:"r"+i, weight: Math.floor(Math.random()*10)}));
    const totalW = recipients.reduce((s,r)=>s+r.weight,0);
    if (totalW === 0) continue;
    const amount = Math.floor(Math.random()*100000) - 50000;
    const shares = splitPayout(amount, recipients);
    const sum = shares.reduce((s,x)=>s+x.cents,0);
    if (sum !== amount) { console.log("FAIL", amount, recipients, shares); process.exit(1); }
  }
  console.log("stress test passed (non-zero weight totals)");
  '
  
```

Diff against the starting commit:

```diff
diff --git a/src/split.ts b/src/split.ts
index d278c95..600ec9c 100644
--- a/src/split.ts
+++ b/src/split.ts
@@ -6,8 +6,27 @@ export function splitPayout(amountCents: number, recipients: Recipient[]): Share
   const weight = totalWeight(recipients);
   if (weight === 0) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
 
-  return recipients.map((recipient) => ({
-    recipientId: recipient.id,
-    cents: Math.round((amountCents * recipient.weight) / weight),
-  }));
+  // A clawback (negative amount) is the exact negation of the same positive payout's split.
+  if (amountCents < 0) {
+    return splitPayout(-amountCents, recipients).map((share) => ({ ...share, cents: -share.cents }));
+  }
+
+  // Largest remainder method: allocate the integer floor to everyone first, then
+  // hand out the leftover cents one at a time to the largest fractional remainders,
+  // breaking ties in favor of earlier recipients so the result is deterministic.
+  const exact = recipients.map((recipient) => (amountCents * recipient.weight) / weight);
+  const base = exact.map(Math.floor);
+  let remainder = amountCents - base.reduce((sum, cents) => sum + cents, 0);
+
+  const order = recipients
+    .map((_, index) => index)
+    .toSorted((a, b) => exact[b] - base[b] - (exact[a] - base[a]) || a - b);
+
+  for (const index of order) {
+    if (remainder <= 0) break;
+    base[index] += 1;
+    remainder -= 1;
+  }
+
+  return recipients.map((recipient, index) => ({ recipientId: recipient.id, cents: base[index] }));
 }

```

## P9

Request:

> Finance reconciliation is flagging some payouts where the recipient parts do not add up to the amount we actually paid, usually off by a cent or two. Please fix the split calculation for integer cents while preserving refunds and the existing deterministic ordering rules.

### Submission 1

Project test suite after the change: 4/4 passing.

Shell commands run, in order:

```text
find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | head -200
cd . && cat package.json && npm test 2>&1 | tail -60
cd . && node --experimental-strip-types -e '
  import("./src/split.ts").then(({splitPayout}) => {
    const recipients = [{id:"a",weight:1},{id:"b",weight:1},{id:"c",weight:1}];
    console.log(JSON.stringify(splitPayout(100, recipients)));
    console.log(JSON.stringify(splitPayout(-100, recipients)));
    console.log(JSON.stringify(splitPayout(1, recipients)));
    const sum = splitPayout(100, recipients).reduce((s,x)=>s+x.cents,0);
    console.log("sum100=", sum);
  });
  '
  
```

Diff against the starting commit:

```diff
diff --git a/src/split.ts b/src/split.ts
index d278c95..b9d00ed 100644
--- a/src/split.ts
+++ b/src/split.ts
@@ -6,8 +6,31 @@ export function splitPayout(amountCents: number, recipients: Recipient[]): Share
   const weight = totalWeight(recipients);
   if (weight === 0) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
 
-  return recipients.map((recipient) => ({
-    recipientId: recipient.id,
-    cents: Math.round((amountCents * recipient.weight) / weight),
-  }));
+  // Refunds/clawbacks split as the exact negation of the same positive payout.
+  const sign = amountCents < 0 ? -1 : 1;
+  const absoluteAmount = Math.abs(amountCents);
+
+  const allocations = recipients.map((recipient, index) => {
+    const exact = (absoluteAmount * recipient.weight) / weight;
+    const base = Math.floor(exact);
+    return { index, recipient, base, remainder: exact - base };
+  });
+
+  const allocatedTotal = allocations.reduce((sum, allocation) => sum + allocation.base, 0);
+  let leftoverCents = absoluteAmount - allocatedTotal;
+
+  // Assign leftover cents to the largest fractional remainders; exact ties favor earlier recipients.
+  const byRemainder = allocations
+    .slice()
+    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
+
+  for (const allocation of byRemainder) {
+    if (leftoverCents <= 0) break;
+    allocation.base += 1;
+    leftoverCents -= 1;
+  }
+
+  return allocations
+    .sort((a, b) => a.index - b.index)
+    .map((allocation) => ({ recipientId: allocation.recipient.id, cents: sign * allocation.base }));
 }

```

### Submission 2

Project test suite after the change: 6/6 passing.

Shell commands run, in order:

```text
cd . && git log --oneline -5 && find . -type f -not -path './.git/*' | head -100
cd . && grep -rn "refund\|splitPayout\|order" src/ test/ README.md
cd . && cat package.json
cd . && npm test 2>&1 | tail -40
cd . && npm test 2>&1 | tail -20
cd . && node --input-type=module -e "
  import { splitPayout } from './src/split.ts';
  // stress: random weights/amounts always sum exactly
  for (let i = 0; i < 2000; i++) {
    const n = 1 + Math.floor(Math.random()*5);
    const recipients = Array.from({length:n}, (_,k)=>({id:String(k), weight: Math.floor(Math.random()*10)}));
    const amount = Math.floor(Math.random()*2000) - 1000;
    const shares = splitPayout(amount, recipients);
    const sum = shares.reduce((s,x)=>s+x.cents,0);
    if (sum !== amount) { console.log('FAIL', amount, recipients, shares); process.exit(1); }
  }
  console.log('OK: 2000 random cases all balanced');
  "
  
cd . && node --input-type=module -e "
  import { splitPayout } from './src/split.ts';
  for (let i = 0; i < 5000; i++) {
    const n = 1 + Math.floor(Math.random()*6);
    const recipients = Array.from({length:n}, (_,k)=>({id:String(k), weight: Math.floor(Math.random()*10)}));
    if (recipients.every(r=>r.weight===0)) continue;
    const amount = Math.floor(Math.random()*4000) - 2000;
    const shares = splitPayout(amount, recipients);
    const sum = shares.reduce((s,x)=>s+x.cents,0);
    if (sum !== amount) { console.log('FAIL', amount, recipients, shares); process.exit(1); }
    const zeroOk = shares.every((s,idx)=> recipients[idx].weight!==0 || s.cents===0);
    if (!zeroOk) { console.log('ZERO-WEIGHT FAIL', amount, recipients, shares); process.exit(1); }
  }
  console.log('OK: 5000 random cases all balanced, zero-weight respected');
  "
  
cd . && git diff --stat && git status --short
cd . && git remote -v && git branch -a
cd . && git add -A && git commit -q -m "Fix payout split to always sum to the exact amount
  
  Each recipient's share was rounded independently with Math.round,
  so rounding errors could make the shares miss the original amount
  by a cent or two (e.g. splitting 100 cents three ways gave 33+33+33=99).
  
  Switch to a largest-remainder method: floor each proportional share
  using integer arithmetic, then hand out the leftover cents to the
  recipients with the largest fractional remainder, breaking ties by
  earlier position in the input list (per README). Refund clawbacks
  split the positive magnitude and negate the result, so a clawback
  stays the exact negation of the matching payout.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git log --oneline -3
```

Diff against the starting commit:

```diff
diff --git a/src/split.ts b/src/split.ts
index d278c95..0da7cb0 100644
--- a/src/split.ts
+++ b/src/split.ts
@@ -6,8 +6,26 @@ export function splitPayout(amountCents: number, recipients: Recipient[]): Share
   const weight = totalWeight(recipients);
   if (weight === 0) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
 
-  return recipients.map((recipient) => ({
+  // Refunds are the exact negation of the same positive split, so split the
+  // magnitude and flip the sign back on afterward rather than rounding twice.
+  const sign = amountCents < 0 ? -1 : 1;
+  const magnitude = Math.abs(amountCents);
+
+  const shareCents = recipients.map((recipient) => Math.floor((magnitude * recipient.weight) / weight));
+  let leftoverCents = magnitude - shareCents.reduce((sum, cents) => sum + cents, 0);
+
+  const byRemainderDesc = recipients
+    .map((recipient, index) => ({ index, remainder: (magnitude * recipient.weight) % weight }))
+    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
+
+  for (const { index } of byRemainderDesc) {
+    if (leftoverCents === 0) break;
+    shareCents[index] += 1;
+    leftoverCents -= 1;
+  }
+
+  return recipients.map((recipient, index) => ({
     recipientId: recipient.id,
-    cents: Math.round((amountCents * recipient.weight) / weight),
+    cents: sign * shareCents[index],
   }));
 }
diff --git a/test/split.test.ts b/test/split.test.ts
index b182115..afe3e70 100644
--- a/test/split.test.ts
+++ b/test/split.test.ts
@@ -23,6 +23,38 @@ test("rejects negative weights", () => {
   assert.throws(() => splitPayout(100, [{ id: "bad", weight: -1 }]), RangeError);
 });
 
+test("shares always sum to the original amount, remainder to largest fractional part", () => {
+  const thirds = [
+    { id: "a", weight: 1 },
+    { id: "b", weight: 1 },
+    { id: "c", weight: 1 },
+  ];
+  const shares = splitPayout(100, thirds);
+  assert.equal(
+    shares.reduce((sum, share) => sum + share.cents, 0),
+    100,
+  );
+  assert.deepEqual(shares, [
+    { recipientId: "a", cents: 34 },
+    { recipientId: "b", cents: 33 },
+    { recipientId: "c", cents: 33 },
+  ]);
+});
+
+test("refund clawback is the exact negation of the positive split", () => {
+  const thirds = [
+    { id: "a", weight: 1 },
+    { id: "b", weight: 1 },
+    { id: "c", weight: 1 },
+  ];
+  const payout = splitPayout(100, thirds);
+  const clawback = splitPayout(-100, thirds);
+  assert.deepEqual(
+    clawback,
+    payout.map((share) => ({ recipientId: share.recipientId, cents: -share.cents })),
+  );
+});
+
 test("summary uses the split order", () => {
   assert.equal(summarizeSplit(400, recipients), "artist:300,label:100");
 });

```

## P10

Request:

> Finance reconciliation is flagging some payouts where the recipient parts do not add up to the amount we actually paid, usually off by a cent or two. Please fix the split calculation for integer cents while preserving refunds and the existing deterministic ordering rules.

### Submission 1

Project test suite after the change: 9/9 passing.

Shell commands run, in order:

```text
pwd && ls -la && git status --short && find . -maxdepth 2 -type f | head -80
node --version && npm test
npm test
node --input-type=module -e 'import {splitPayout} from "./src/split.ts"; for(let i=0;i<100000;i++){const rs=Array.from({length:1+Math.floor(Math.random()*12)},(_,j)=>({id:String(j),weight:Math.random()<.2?0:Math.random()*100}));const amount=Math.floor(Math.random()*1000000)*(Math.random()<.5?-1:1); const shares=splitPayout(amount,rs);const sum=shares.reduce((s,x)=>s+x.cents,0);if(sum!==(rs.every(x=>x.weight===0)?0:amount)||shares.some((x,j)=>rs[j].weight===0&&x.cents!==0)){console.error({amount,rs,shares,sum});process.exit(1)}} console.log("100000 randomized balance and zero-weight checks passed")'
git --no-pager diff --check && git --no-pager diff --stat
node --input-type=module -e 'import {splitPayout} from "./src/split.ts"; for(let i=0;i<100000;i++){const rs=Array.from({length:2+Math.floor(Math.random()*40)},(_,j)=>({id:String(j),weight:Math.random()<.15?0:Math.random()*100}));const amount=Number.MAX_SAFE_INTEGER-Math.floor(Math.random()*1000); const shares=splitPayout(amount,rs);const sum=shares.reduce((s,x)=>s+x.cents,0);if(sum!==amount||shares.some((x,j)=>rs[j].weight===0&&x.cents!==0)){console.error(JSON.stringify({amount,rs,shares,sum,diff:amount-sum}));process.exit(1)}} console.log("Large amount checks passed")'
npm test
node --input-type=module -e 'import {splitPayout} from "./src/split.ts"; for(let i=0;i<20000;i++){const rs=Array.from({length:1+Math.floor(Math.random()*30)},(_,j)=>({id:String(j),weight:Math.random()<.2?0:Math.random()*100}));const amount=(Math.random()<.5?1:-1)*(Number.MAX_SAFE_INTEGER-Math.floor(Math.random()*100000));const shares=splitPayout(amount,rs);const sum=shares.reduce((s,x)=>s+x.cents,0);if(sum!==(rs.every(x=>x.weight===0)?0:amount)||shares.some((x,j)=>rs[j].weight===0&&x.cents!==0)){console.error({amount,rs,shares,sum});process.exit(1)}} console.log("20000 large randomized payout/refund checks passed")'
git --no-pager diff --check && git --no-pager diff --stat
npm test && git --no-pager diff --check
node --input-type=module -e 'import {splitPayout} from "./src/split.ts"; for(const [amount,rs] of [[1,[{id:"a",weight:1e308},{id:"b",weight:1e308}]],[7,[{id:"a",weight:5e-324},{id:"b",weight:1e308}]],[Number.MAX_SAFE_INTEGER,[{id:"a",weight:1},{id:"b",weight:1},{id:"c",weight:1}]]]){const result=splitPayout(amount,rs);if(result.reduce((sum,x)=>sum+x.cents,0)!==amount)throw Error(JSON.stringify(result))} console.log("Extreme weights and large ties balanced")'
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index 9395ce6..9200f99 100644
--- a/README.md
+++ b/README.md
@@ -1,6 +1,7 @@
 # payout-split
 
 Splits integer-cent payouts across recipients by non-negative weight. The shares must always sum exactly to the original amount.
+Amounts must be safe integers in cents; weights must be finite, non-negative numbers.
 
 Rules:
 
diff --git a/src/split.ts b/src/split.ts
index d278c95..c93acb2 100644
--- a/src/split.ts
+++ b/src/split.ts
@@ -1,13 +1,51 @@
-import { assertValidRecipients, totalWeight } from "./recipients.ts";
+import { assertValidRecipients } from "./recipients.ts";
 import type { Recipient, Share } from "./types.ts";
 
+function decimalWeight(weight: number): { coefficient: bigint; exponent: number } {
+  const [mantissa, scientificExponent = "0"] = weight.toString().split("e");
+  const [whole, fraction = ""] = mantissa.split(".");
+  return {
+    coefficient: BigInt(whole + fraction),
+    exponent: Number(scientificExponent) - fraction.length,
+  };
+}
+
 export function splitPayout(amountCents: number, recipients: Recipient[]): Share[] {
   assertValidRecipients(recipients);
-  const weight = totalWeight(recipients);
-  if (weight === 0) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
+  if (!Number.isSafeInteger(amountCents)) {
+    throw new RangeError("Amount must be safe integer cents");
+  }
+  if (recipients.every((recipient) => recipient.weight === 0)) {
+    return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
+  }
+
+  const decimalWeights = recipients.map((recipient) => decimalWeight(recipient.weight));
+  const scale = decimalWeights.reduce((min, weight) => Math.min(min, weight.exponent), 0);
+  const weights = decimalWeights.map(
+    ({ coefficient, exponent }) => coefficient * 10n ** BigInt(exponent - scale),
+  );
+  const total = weights.reduce((sum, weight) => sum + weight, 0n);
+
+  const magnitude = Math.abs(amountCents);
+  const allocations = weights.map((weight, index) => {
+    const numerator = BigInt(magnitude) * weight;
+    return { index, cents: numerator / total, remainder: numerator % total };
+  });
+  let remaining = BigInt(magnitude) - allocations.reduce((sum, allocation) => sum + allocation.cents, 0n);
+  const ranked = allocations
+    .filter((allocation) => weights[allocation.index] > 0n)
+    .sort((a, b) =>
+      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
+    );
+
+  for (const allocation of ranked) {
+    if (remaining === 0n) break;
+    allocation.cents++;
+    remaining--;
+  }
 
-  return recipients.map((recipient) => ({
-    recipientId: recipient.id,
-    cents: Math.round((amountCents * recipient.weight) / weight),
+  return allocations.map((allocation) => ({
+    recipientId: recipients[allocation.index].id,
+    cents: Number(amountCents < 0 ? -allocation.cents : allocation.cents),
   }));
 }
diff --git a/test/split.test.ts b/test/split.test.ts
index b182115..f6deeda 100644
--- a/test/split.test.ts
+++ b/test/split.test.ts
@@ -15,14 +15,83 @@ test("splits an even proportional payout", () => {
   ]);
 });
 
+test("assigns leftover cents by fractional remainder while retaining input order", () => {
+  const weighted = [
+    { id: "small", weight: 1 },
+    { id: "large", weight: 3 },
+    { id: "medium", weight: 2 },
+  ];
+  assert.deepEqual(splitPayout(5, weighted), [
+    { recipientId: "small", cents: 1 },
+    { recipientId: "large", cents: 2 },
+    { recipientId: "medium", cents: 2 },
+  ]);
+});
+
+test("breaks equal fractional remainders by input position", () => {
+  const equal = [
+    { id: "first", weight: 1 },
+    { id: "second", weight: 1 },
+    { id: "third", weight: 1 },
+  ];
+  assert.deepEqual(splitPayout(2, equal), [
+    { recipientId: "first", cents: 1 },
+    { recipientId: "second", cents: 1 },
+    { recipientId: "third", cents: 0 },
+  ]);
+  assert.deepEqual(splitPayout(1, equal), [
+    { recipientId: "first", cents: 1 },
+    { recipientId: "second", cents: 0 },
+    { recipientId: "third", cents: 0 },
+  ]);
+});
+
+test("refunds negate the positive shares, including zero-weight recipients", () => {
+  const weighted = [
+    { id: "artist", weight: 3 },
+    { id: "inactive", weight: 0 },
+    { id: "label", weight: 1 },
+  ];
+  const payout = splitPayout(3, weighted);
+  assert.deepEqual(payout, [
+    { recipientId: "artist", cents: 2 },
+    { recipientId: "inactive", cents: 0 },
+    { recipientId: "label", cents: 1 },
+  ]);
+  assert.deepEqual(splitPayout(-3, weighted), payout.map(({ recipientId, cents }) => ({ recipientId, cents: -cents || 0 })));
+});
+
+test("large payouts and fractional weights retain exact cent totals", () => {
+  const weighted = [
+    { id: "first", weight: 0.1 },
+    { id: "second", weight: 0.2 },
+    { id: "third", weight: 0.3 },
+  ];
+  const amount = Number.MAX_SAFE_INTEGER;
+  const payout = splitPayout(amount, weighted);
+  assert.deepEqual(payout, [
+    { recipientId: "first", cents: 1501199875790165 },
+    { recipientId: "second", cents: 3002399751580330 },
+    { recipientId: "third", cents: 4503599627370496 },
+  ]);
+  assert.equal(payout.reduce((sum, share) => sum + share.cents, 0), amount);
+  assert.deepEqual(splitPayout(-amount, weighted), payout.map(({ recipientId, cents }) => ({ recipientId, cents: -cents })));
+});
+
 test("all zero weights receive zero", () => {
   assert.deepEqual(splitPayout(999, [{ id: "none", weight: 0 }]), [{ recipientId: "none", cents: 0 }]);
+  assert.deepEqual(splitPayout(-999, [{ id: "none", weight: 0 }]), [{ recipientId: "none", cents: 0 }]);
 });
 
 test("rejects negative weights", () => {
   assert.throws(() => splitPayout(100, [{ id: "bad", weight: -1 }]), RangeError);
 });
 
+test("rejects amounts outside safe integer cents", () => {
+  assert.throws(() => splitPayout(1.5, recipients), RangeError);
+  assert.throws(() => splitPayout(Number.MAX_SAFE_INTEGER + 1, recipients), RangeError);
+});
+
 test("summary uses the split order", () => {
   assert.equal(summarizeSplit(400, recipients), "artist:300,label:100");
 });

```

### Submission 2

Project test suite after the change: 6/6 passing.

Shell commands run, in order:

```text
git status --short && rg --files -g 'AGENTS.md' -g 'CLAUDE.md' -g '.github/copilot-instructions.md' -g 'package.json' -g 'README*' -g '*split*' -g '*payout*'
git status --short && ls -la && find . -name AGENTS.md -o -name CLAUDE.md -o -name copilot-instructions.md
git log -5 --oneline --all && git remote -v && node --version
node --input-type=module -e 'import {splitPayout} from "./src/split.ts"; import {reconcileShares} from "./src/reconciliation.ts"; for (const amount of [1,-1,2]) { const shares=splitPayout(amount,[{id:"first",weight:1},{id:"second",weight:1},{id:"third",weight:1}]); console.log(JSON.stringify({amount,shares,reconciliation:reconcileShares(amount,shares)})); }'
git show --format=fuller --stat HEAD && git branch --show-current && command -v gh || true
node --test test/split.test.ts
node --test test/split.test.ts | tail -54; git diff --check && git diff --stat
git add test/split.test.ts && git commit -m 'test(split): cover remainder allocation and refunds' -m 'Reproduce missing and excess cents with equal weights, and lock down refund symmetry and recipient order.' -m 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>' && git status --short
git --no-pager status --short; node --test test/split.test.ts
node --test test/split.test.ts
git --no-pager diff --check; git --no-pager diff -- src/split.ts; git --no-pager status --short
node --input-type=module -e 'import { splitPayout } from "./src/split.ts"; const r=[{id:"first",weight:1},{id:"second",weight:1},{id:"third",weight:1}]; for(const n of [1,2,-1,-2]) { const s=splitPayout(n,r); console.log(n, JSON.stringify(s), s.reduce((v,x)=>v+x.cents,0), s.some(x=>Object.is(x.cents,-0))); }'
node --input-type=module -e 'import assert from "node:assert/strict"; import { splitPayout } from "./src/split.ts"; const cases = [[1,[1,1,1]],[2,[1,1,1]],[7,[4,3,2]],[3,[3,0,2]],[999,[0,0]]]; for(const [amount,weights] of cases) { const recipients=weights.map((weight,i)=>({id:String(i),weight})); const plus=splitPayout(amount,recipients), minus=splitPayout(-amount,recipients); for(const [target,shares] of [[amount,plus],[-amount,minus]]) { assert.equal(shares.reduce((sum,share)=>sum+share.cents,0),weights.some(Boolean)?target:0); assert.equal(shares.some(share=>Object.is(share.cents,-0)),false); assert.deepEqual(shares.map(share=>share.recipientId),recipients.map(recipient=>recipient.id)); } for(let i=0;i<weights.length;i++) { assert.equal(minus[i].cents,plus[i].cents===0?0:-plus[i].cents); if(weights[i]===0) assert.equal(plus[i].cents,0); } } console.log("Direct split checks passed: sums, refunds, zero weights, order, and no negative zero.");'
git diff -- src/split.ts && git status --short && node --test test/split.test.ts 2>&1 | tail -45
npm test && node --input-type=module -e 'import {splitPayout} from "./src/split.ts"; import {reconcileShares} from "./src/reconciliation.ts"; let cases=0; for(let a=0;a<=25;a++) for(let x=0;x<=4;x++) for(let y=0;y<=4;y++) for(let z=0;z<=4;z++){const r=[x,y,z].map((weight,i)=>({id:String(i),weight})); const p=splitPayout(a,r), n=splitPayout(-a,r); if(x+y+z>0 && (!reconcileShares(a,p).balanced || !reconcileShares(-a,n).balanced)) throw Error(`unbalanced ${JSON.stringify({a,r,p,n})}`); if(p.some((s,i)=>s.cents!==-n[i].cents || Object.is(n[i].cents,-0) || (r[i].weight===0 && s.cents!==0))) throw Error(`invalid shares ${JSON.stringify({a,r,p,n})}`); cases++} console.log(`${cases} split and refund cases balanced`)' && git diff --check
node --input-type=module -e 'import {splitPayout} from "./src/split.ts"; for (const a of [1,2,7,100000000,Number.MAX_SAFE_INTEGER]) for (let t=0;t<5000;t++){let r=Array.from({length:2+t%18},(_,i)=>({id:String(i),weight:(t*31+i*8191)%49}));if(r.every(v=>!v.weight))continue;const s=splitPayout(a,r);if(s.reduce((sum,v)=>sum+v.cents,0)!==a)throw Error(JSON.stringify({a,t,r,s}));}console.log("50,000 large and varied splits balanced")'
git status --short; git --no-pager log --oneline -5; git --no-pager diff f61c469 -- src/split.ts test/split.test.ts
git --no-pager show --stat --oneline 7bc555e -- src/split.ts test/split.test.ts; git --no-pager show 7bc555e -- test/split.test.ts
sed -n '1,260p' src/split.ts; printf '\n--- TEST ---\n'; sed -n '1,320p' test/split.test.ts
node --input-type=module -e 'import {splitPayout} from "./src/split.ts"; import {reconcileShares} from "./src/reconciliation.ts"; const recipients=[{id:"first",weight:1},{id:"second",weight:1},{id:"third",weight:1}];for(const amount of [1,-1,2]) {const shares=splitPayout(amount,recipients);console.log(JSON.stringify({amount,shares,reconciliation:reconcileShares(amount,shares)}))}' && git diff --check && git diff --stat && git status --short
node --input-type=module -e 'import {splitPayout} from "./src/split.ts";for(let a=1;a<=100;a++)for(let t=0;t<1000;t++){const r=Array.from({length:2+t%12},(_,i)=>({id:String(i),weight:((t*31+i*8191)%49)/10}));if(!r.some(v=>v.weight))continue;const s=splitPayout(a,r);if(s.reduce((n,v)=>n+v.cents,0)!==a)throw Error(JSON.stringify({a,t,r,s}));}console.log("100,000 fractional-weight splits balanced")'
git add src/split.ts test/split.test.ts && git commit -m 'fix(split): allocate integer cents by largest remainder' -m 'Allocate whole cents before distributing the remainder in stable input order. Apply the same split to refunds with negative shares and preserve zero-weight recipients at zero.' -m 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>' && git status --short && git log -2 --oneline
npm test && git diff HEAD --check && git status --short
```

Diff against the starting commit:

```diff
diff --git a/src/split.ts b/src/split.ts
index d278c95..d6f7536 100644
--- a/src/split.ts
+++ b/src/split.ts
@@ -6,8 +6,20 @@ export function splitPayout(amountCents: number, recipients: Recipient[]): Share
   const weight = totalWeight(recipients);
   if (weight === 0) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
 
-  return recipients.map((recipient) => ({
-    recipientId: recipient.id,
-    cents: Math.round((amountCents * recipient.weight) / weight),
+  const magnitude = Math.abs(amountCents);
+  const allocations = recipients.map((recipient, index) => {
+    const exact = (magnitude * recipient.weight) / weight;
+    const cents = Math.floor(exact);
+    return { recipientId: recipient.id, index, cents, remainder: exact - cents };
+  });
+  const remaining = magnitude - allocations.reduce((sum, allocation) => sum + allocation.cents, 0);
+  const ranked = allocations
+    .filter((allocation) => recipients[allocation.index].weight > 0)
+    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
+  for (let i = 0; i < remaining; i++) ranked[i].cents++;
+
+  return allocations.map(({ recipientId, cents }) => ({
+    recipientId,
+    cents: cents === 0 ? 0 : cents * (amountCents < 0 ? -1 : 1),
   }));
 }
diff --git a/test/split.test.ts b/test/split.test.ts
index b182115..fe894f8 100644
--- a/test/split.test.ts
+++ b/test/split.test.ts
@@ -1,6 +1,7 @@
 import { test } from "node:test";
 import assert from "node:assert/strict";
 import { splitPayout } from "../src/split.ts";
+import { reconcileShares } from "../src/reconciliation.ts";
 import { summarizeSplit } from "../src/summary.ts";
 
 const recipients = [
@@ -15,6 +16,59 @@ test("splits an even proportional payout", () => {
   ]);
 });
 
+test("allocates remaining cents by descending remainder, breaking ties by input order", () => {
+  const equal = [
+    { id: "first", weight: 1 },
+    { id: "second", weight: 1 },
+    { id: "third", weight: 1 },
+  ];
+  assert.deepEqual(splitPayout(1, equal), [
+    { recipientId: "first", cents: 1 },
+    { recipientId: "second", cents: 0 },
+    { recipientId: "third", cents: 0 },
+  ]);
+  assert.deepEqual(splitPayout(2, equal), [
+    { recipientId: "first", cents: 1 },
+    { recipientId: "second", cents: 1 },
+    { recipientId: "third", cents: 0 },
+  ]);
+  assert.deepEqual(splitPayout(7, [
+    { id: "first", weight: 4 },
+    { id: "second", weight: 3 },
+    { id: "third", weight: 2 },
+  ]), [
+    { recipientId: "first", cents: 3 },
+    { recipientId: "second", cents: 2 },
+    { recipientId: "third", cents: 2 },
+  ]);
+});
+
+test("refunds negate the positive shares without changing remainder order", () => {
+  const weighted = [
+    { id: "first", weight: 3 },
+    { id: "zero", weight: 0 },
+    { id: "third", weight: 2 },
+  ];
+  const payout = splitPayout(3, weighted);
+  assert.deepEqual(payout, [
+    { recipientId: "first", cents: 2 },
+    { recipientId: "zero", cents: 0 },
+    { recipientId: "third", cents: 1 },
+  ]);
+  assert.deepEqual(splitPayout(-3, weighted), payout.map((share) => ({
+    ...share,
+    cents: share.cents === 0 ? 0 : -share.cents,
+  })));
+  assert.equal(reconcileShares(-3, splitPayout(-3, weighted)).balanced, true);
+  assert.deepEqual(splitPayout(-1, [
+    { id: "first", weight: 1 },
+    { id: "second", weight: 1 },
+  ]), [
+    { recipientId: "first", cents: -1 },
+    { recipientId: "second", cents: 0 },
+  ]);
+});
+
 test("all zero weights receive zero", () => {
   assert.deepEqual(splitPayout(999, [{ id: "none", weight: 0 }]), [{ recipientId: "none", cents: 0 }]);
 });

```

## P11

Request:

> Finance reconciliation is flagging some payouts where the recipient parts do not add up to the amount we actually paid, usually off by a cent or two. Please fix the split calculation for integer cents while preserving refunds and the existing deterministic ordering rules.

### Submission 1

Project test suite after the change: 7/7 passing.

Shell commands run, in order:

```text
git status --short && ls -la && find . -name AGENTS.md -o -name CLAUDE.md -o -path './.github/copilot-instructions.md'
node --version && npm test
node --input-type=module -e 'import { splitPayout } from "./src/split.ts"; import { reconcileShares } from "./src/reconciliation.ts"; const recipients = [{ id: "a", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 1 }]; for (const amount of [101, -101]) { const shares = splitPayout(amount, recipients); console.log(JSON.stringify({ amount, shares, reconciliation: reconcileShares(amount, shares) })); }'
node --test test/split.test.ts
npm test && node --input-type=module -e 'import { splitPayout } from "./src/split.ts"; import { reconcileShares } from "./src/reconciliation.ts"; const recipients = [{ id: "a", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 1 }]; for (const amount of [101, -101]) { const shares = splitPayout(amount, recipients); console.log(JSON.stringify({ amount, shares, reconciliation: reconcileShares(amount, shares) })); }'
node --input-type=module -e 'import { splitPayout } from "./src/split.ts"; for (const amount of [1, 101, 999999, Number.MAX_SAFE_INTEGER]) for (const weights of [[1,1,1], [0,1,3,2], [0.1,0.2,0.3], [1,2,3,4,5]]) { const recipients = weights.map((weight, i) => ({ id: String(i), weight })); try { const shares = splitPayout(amount, recipients); const sum = shares.reduce((s, x) => s + x.cents, 0); if (sum !== amount || shares.some((x, i) => weights[i] === 0 && x.cents !== 0)) console.log(JSON.stringify({amount,weights,sum,shares})); } catch (error) { console.log(JSON.stringify({amount,weights,error:String(error)})); } }' && git --no-pager diff --check && git --no-pager diff --stat
node --input-type=module -e 'import {splitPayout} from "./src/split.ts"; let seed=123456789; const next=()=>((seed=Math.imul(seed,1664525)+101390422|0)>>>0)/4294967296; for(let n=0;n<100000;n++){const count=1+Math.floor(next()*12);const recipients=Array.from({length:count},(_,i)=>({id:String(i),weight:next()<0.15?0:next()*1000}));const amount=Math.floor(next()*Number.MAX_SAFE_INTEGER);try{const shares=splitPayout(amount,recipients);const sum=shares.reduce((acc,x)=>acc+x.cents,0);if(sum!==amount && recipients.some(x=>x.weight)){console.log(JSON.stringify({n,amount,weights:recipients.map(x=>x.weight),sum,shares}));process.exit(1)}}catch(e){console.log(JSON.stringify({n,amount,weights:recipients.map(x=>x.weight),error:String(e)}));process.exit(1)}}console.log("100000 safe-integer allocations balanced")'
node --test test/split.test.ts 2>&1 | grep -A 29 'large integer-cent amounts still reconcile after floating-point quota rounding'
npm test && node --input-type=module -e 'import {splitPayout} from "./src/split.ts"; let seed=123456789; const next=()=>((seed=Math.imul(seed,1664525)+101390422|0)>>>0)/4294967296; for(let n=0;n<100000;n++){const count=1+Math.floor(next()*12);const recipients=Array.from({length:count},(_,i)=>({id:String(i),weight:next()<0.15?0:next()*1000}));const amount=Math.floor(next()*Number.MAX_SAFE_INTEGER);const shares=splitPayout(amount,recipients);const sum=shares.reduce((acc,x)=>acc+x.cents,0);if(recipients.some(x=>x.weight) && (sum!==amount || shares.some((x,i)=>x.cents<0 || recipients[i].weight===0 && x.cents!==0))){console.log(JSON.stringify({n,amount,weights:recipients.map(x=>x.weight),sum,shares}));process.exit(1)}}console.log("100000 safe-integer allocations balanced")'
git --no-pager diff --check && git --no-pager diff && git remote -v
```

Diff against the starting commit:

```diff
diff --git a/src/split.ts b/src/split.ts
index d278c95..a3db46b 100644
--- a/src/split.ts
+++ b/src/split.ts
@@ -6,8 +6,23 @@ export function splitPayout(amountCents: number, recipients: Recipient[]): Share
   const weight = totalWeight(recipients);
   if (weight === 0) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
 
-  return recipients.map((recipient) => ({
+  const magnitude = Math.abs(amountCents);
+  const quotas = recipients.map((recipient) => magnitude * (recipient.weight / weight));
+  const shares = recipients.map((recipient, index) => ({
     recipientId: recipient.id,
-    cents: Math.round((amountCents * recipient.weight) / weight),
+    cents: Math.floor(quotas[index]),
   }));
+  const remaining = magnitude - shares.reduce((sum, share) => sum + share.cents, 0);
+  const order = quotas
+    .map((quota, index) => ({ index, remainder: quota - Math.floor(quota) }))
+    .filter(({ index }) => recipients[index].weight > 0 && (remaining >= 0 || shares[index].cents > 0))
+    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
+  const ranked = remaining < 0 ? order.toReversed() : order;
+  for (let index = 0; index < Math.abs(remaining); index++) {
+    shares[ranked[index % ranked.length].index].cents += Math.sign(remaining);
+  }
+
+  return amountCents < 0
+    ? shares.map((share) => ({ ...share, cents: share.cents === 0 ? 0 : -share.cents }))
+    : shares;
 }
diff --git a/test/split.test.ts b/test/split.test.ts
index b182115..34660fe 100644
--- a/test/split.test.ts
+++ b/test/split.test.ts
@@ -2,6 +2,7 @@ import { test } from "node:test";
 import assert from "node:assert/strict";
 import { splitPayout } from "../src/split.ts";
 import { summarizeSplit } from "../src/summary.ts";
+import { reconcileShares } from "../src/reconciliation.ts";
 
 const recipients = [
   { id: "artist", weight: 3 },
@@ -19,6 +20,73 @@ test("all zero weights receive zero", () => {
   assert.deepEqual(splitPayout(999, [{ id: "none", weight: 0 }]), [{ recipientId: "none", cents: 0 }]);
 });
 
+test("allocates leftover cents by fractional remainder and input order", () => {
+  const equal = [
+    { id: "first", weight: 1 },
+    { id: "second", weight: 1 },
+    { id: "third", weight: 1 },
+  ];
+  const shares = splitPayout(101, equal);
+  assert.deepEqual(shares, [
+    { recipientId: "first", cents: 34 },
+    { recipientId: "second", cents: 34 },
+    { recipientId: "third", cents: 33 },
+  ]);
+  assert.deepEqual(reconcileShares(101, shares), {
+    expectedCents: 101,
+    actualCents: 101,
+    balanced: true,
+    differenceCents: 0,
+  });
+
+  assert.deepEqual(splitPayout(7, [
+    { id: "small", weight: 1 },
+    { id: "large", weight: 3 },
+    { id: "zero", weight: 0 },
+    { id: "middle", weight: 2 },
+  ]), [
+    { recipientId: "small", cents: 1 },
+    { recipientId: "large", cents: 4 },
+    { recipientId: "zero", cents: 0 },
+    { recipientId: "middle", cents: 2 },
+  ]);
+});
+
+test("refunds negate the same positive split without negative zero", () => {
+  const refundRecipients = [
+    { id: "first", weight: 1 },
+    { id: "second", weight: 1 },
+    { id: "third", weight: 1 },
+    { id: "zero", weight: 0 },
+  ];
+  const payout = splitPayout(101, refundRecipients);
+  const refund = splitPayout(-101, refundRecipients);
+  assert.deepEqual(refund, [
+    { recipientId: "first", cents: -34 },
+    { recipientId: "second", cents: -34 },
+    { recipientId: "third", cents: -33 },
+    { recipientId: "zero", cents: 0 },
+  ]);
+  assert.deepEqual(refund, payout.map(({ recipientId, cents }) => ({
+    recipientId,
+    cents: cents === 0 ? 0 : -cents,
+  })));
+  assert.equal(reconcileShares(-101, refund).balanced, true);
+});
+
+test("large integer-cent amounts still reconcile after floating-point quota rounding", () => {
+  const amount = 7735929064128511;
+  const largeRecipients = [
+    { id: "first", weight: 836.1964190844446 },
+    { id: "second", weight: 432.5238943565637 },
+  ];
+  for (const signedAmount of [amount, -amount]) {
+    const shares = splitPayout(signedAmount, largeRecipients);
+    assert.equal(reconcileShares(signedAmount, shares).differenceCents, 0);
+    assert.ok(shares.every((share) => Number.isSafeInteger(share.cents)));
+  }
+});
+
 test("rejects negative weights", () => {
   assert.throws(() => splitPayout(100, [{ id: "bad", weight: -1 }]), RangeError);
 });

```

### Submission 2

Project test suite after the change: 9/9 passing.

Shell commands run, in order:

```text
git status --short && ls -la
npm test
node --input-type=module <<'NODE'
  import { splitPayout } from './src/split.ts';
  for (const amount of [1, 2, 3, 101, 1000001, Number.MAX_SAFE_INTEGER, -1, -101, -Number.MAX_SAFE_INTEGER]) {
    for (const weights of [[1,1,1], [3,1], [0,1,2], [1e300,1e300], [0.1,0.2,0.3]]) {
      const shares = splitPayout(amount, weights.map((weight, i) => ({ id: String(i), weight })));
      const sum = shares.reduce((total, share) => total + share.cents, 0);
      if (sum !== amount) throw Error(`${amount},${weights}: ${sum}`);
    }
  }
  console.log('Boundary reconciliation checks passed');
  NODE
npm test
node --input-type=module <<'NODE'
  import { splitPayout } from './src/split.ts';
  let checked = 0;
  for (const amount of [1, 2, 3, 101, 1000001, Number.MAX_SAFE_INTEGER, -1, -101, -Number.MAX_SAFE_INTEGER]) {
    for (const weights of [[1,1,1], [3,1], [0,1,2], [1e300,1e300], [0.1,0.2,0.3], [1,1e-100,1e-200], [1000000000000,1,1]]) {
      const shares = splitPayout(amount, weights.map((weight, i) => ({ id: String(i), weight })));
      const sum = shares.reduce((total, share) => total + share.cents, 0);
      if (sum !== amount) throw Error(`${amount},${weights}: ${sum}`);
      if (shares.some(({cents}) => !Number.isSafeInteger(cents) || Object.is(cents, -0))) throw Error(`invalid share: ${amount},${weights}`);
      checked++;
    }
  }
  console.log(`${checked} boundary reconciliation checks passed`);
  NODE
node --input-type=module <<'NODE'
  import { splitPayout } from './src/split.ts';
  let seed = 42;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
  for (let caseIndex = 0; caseIndex < 100000; caseIndex++) {
    const amount = Math.floor(random() * Number.MAX_SAFE_INTEGER) * (random() < 0.5 ? -1 : 1);
    const weights = Array.from({length: 2 + Math.floor(random() * 15)}, (_, i) => ({ id: String(i), weight: random() ** (1 + Math.floor(random() * 20)) * (random() < 0.5 ? 1e200 : 1e-200) }));
    const shares = splitPayout(amount, weights);
    const total = shares.reduce((sum, share) => sum + share.cents, 0);
    if (total !== amount || shares.some(({cents}) => !Number.isSafeInteger(cents))) throw Error(`${caseIndex}: ${amount} ${total} ${JSON.stringify(weights)}`);
  }
  console.log('100000 randomized reconciliation checks passed');
  NODE
node --input-type=module <<'NODE'
  import { splitPayout } from './src/split.ts';
  for (const amount of [9007199254740991, 6720496961847295, 9007199254740990, 7781720352391149]) {
    for (const weights of [[1,1,1], [1,1,1,1,1,1,1], [1,2,3,4,5], [1,2,3,4,5,6,7,8,9]]) {
      const shares = splitPayout(amount, weights.map((weight, i) => ({id: String(i), weight})));
      const total = shares.reduce((sum, share) => sum + share.cents, 0);
      if (amount !== total) console.log({amount, weights, total, shares});
    }
  }
  NODE
node --input-type=module <<'NODE'
  import { splitPayout } from './src/split.ts';
  let seed = 42;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
  for (let i = 0; i <= 87; i++) {
   const amount = Math.floor(random() * Number.MAX_SAFE_INTEGER) * (random() < 0.5 ? -1 : 1);
   const weights = Array.from({length: 2 + Math.floor(random() * 15)}, (_, i) => ({ id: String(i), weight: random() ** (1 + Math.floor(random() * 20)) * (random() < 0.5 ? 1e200 : 1e-200) }));
   if(i === 87) {
    const shares = splitPayout(amount, weights);
    console.log(JSON.stringify({amount, weights, shares, sum: shares.reduce((sum, x) => sum + x.cents, 0), exactSum: String(shares.reduce((sum, x) => sum + BigInt(x.cents), 0n))}));
   }
  }
  NODE
node --input-type=module <<'NODE'
  let seed = 7;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
  for (let i = 0; i < 1000000; i++) {
   const amount = Math.floor(random() * Number.MAX_SAFE_INTEGER);
   const weights = Array.from({length: 2 + Math.floor(random() * 9)}, () => 1 + Math.floor(random()*100));
   const total = weights.reduce((sum,x)=>sum+x,0);
   const quotas = weights.map(w => amount * (w / total));
   const base = quotas.map(Math.floor);
   const delta = BigInt(amount) - base.reduce((sum,x)=>sum+BigInt(x),0n);
   if(delta < 0n) { console.log({amount,weights,delta:String(delta)}); break; }
   if(i === 999999) console.log('no negative base found');
  }
  NODE
npm test
node --input-type=module <<'NODE'
  import { splitPayout } from './src/split.ts';
  let seed = 42;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
  for (let caseIndex = 0; caseIndex < 100000; caseIndex++) {
    const amount = Math.floor(random() * Number.MAX_SAFE_INTEGER) * (random() < 0.5 ? -1 : 1);
    const weights = Array.from({length: 2 + Math.floor(random() * 15)}, (_, i) => ({ id: String(i), weight: random() ** (1 + Math.floor(random() * 20)) * (random() < 0.5 ? 1e200 : 1e-200) }));
    const shares = splitPayout(amount, weights);
    const total = shares.reduce((sum, share) => sum + BigInt(share.cents), 0n);
    if (total !== BigInt(amount) || shares.some(({cents}) => !Number.isSafeInteger(cents) || (amount >= 0 && cents < 0) || (amount < 0 && cents > 0))) throw Error(`${caseIndex}: ${amount} ${total} ${JSON.stringify(weights)}`);
  }
  console.log('100000 randomized exact reconciliation checks passed');
  NODE
git --no-pager diff --check && git --no-pager diff --stat
npm test && git --no-pager diff --check
git --no-pager diff -- src/split.ts test/split.test.ts README.md
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index 9395ce6..261e907 100644
--- a/README.md
+++ b/README.md
@@ -1,6 +1,6 @@
 # payout-split
 
-Splits integer-cent payouts across recipients by non-negative weight. The shares must always sum exactly to the original amount.
+Splits safe integer-cent payouts across recipients by non-negative weight. The shares must always sum exactly to the original amount.
 
 Rules:
 
diff --git a/src/split.ts b/src/split.ts
index d278c95..a45ab7c 100644
--- a/src/split.ts
+++ b/src/split.ts
@@ -2,12 +2,43 @@ import { assertValidRecipients, totalWeight } from "./recipients.ts";
 import type { Recipient, Share } from "./types.ts";
 
 export function splitPayout(amountCents: number, recipients: Recipient[]): Share[] {
+  if (!Number.isSafeInteger(amountCents)) {
+    throw new RangeError("Amount must be an integer number of cents");
+  }
   assertValidRecipients(recipients);
   const weight = totalWeight(recipients);
   if (weight === 0) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
 
-  return recipients.map((recipient) => ({
+  const absoluteAmount = Math.abs(amountCents);
+  let quotas: number[];
+  if (Number.isFinite(weight)) {
+    quotas = recipients.map((recipient) => absoluteAmount * (recipient.weight / weight));
+  } else {
+    const maximum = recipients.reduce((largest, recipient) => Math.max(largest, recipient.weight), 0);
+    const normalized = recipients.map((recipient) => recipient.weight / maximum);
+    const normalizedTotal = normalized.reduce((sum, share) => sum + share, 0);
+    quotas = normalized.map((share) => absoluteAmount * (share / normalizedTotal));
+  }
+  const cents = quotas.map((quota) => Math.floor(quota));
+  const remaining = Number(BigInt(absoluteAmount) - cents.reduce((sum, share) => sum + BigInt(share), 0n));
+  const byRemainder = recipients
+    .map((recipient, index) => index)
+    .filter((index) => recipients[index].weight > 0)
+    .sort((a, b) => (quotas[b] - cents[b]) - (quotas[a] - cents[a]) || a - b);
+
+  if (remaining >= 0) {
+    for (let index = 0; index < remaining; index++) {
+      cents[byRemainder[index % byRemainder.length]]++;
+    }
+  } else {
+    const funded = byRemainder.filter((index) => cents[index] > 0).reverse();
+    for (let index = 0; index < -remaining; index++) {
+      cents[funded[index % funded.length]]--;
+    }
+  }
+
+  return recipients.map((recipient, index) => ({
     recipientId: recipient.id,
-    cents: Math.round((amountCents * recipient.weight) / weight),
+    cents: amountCents < 0 && cents[index] !== 0 ? -cents[index] : cents[index],
   }));
 }
diff --git a/test/split.test.ts b/test/split.test.ts
index b182115..c8f0caf 100644
--- a/test/split.test.ts
+++ b/test/split.test.ts
@@ -15,10 +15,76 @@ test("splits an even proportional payout", () => {
   ]);
 });
 
+test("awards leftover cents to the largest remainders in input order on ties", () => {
+  const thirds = [
+    { id: "first", weight: 1 },
+    { id: "second", weight: 1 },
+    { id: "third", weight: 1 },
+  ];
+  assert.deepEqual(splitPayout(2, thirds), [
+    { recipientId: "first", cents: 1 },
+    { recipientId: "second", cents: 1 },
+    { recipientId: "third", cents: 0 },
+  ]);
+  assert.deepEqual(splitPayout(2, [
+    { id: "small", weight: 1 },
+    { id: "large", weight: 2 },
+    { id: "largest", weight: 3 },
+  ]), [
+    { recipientId: "small", cents: 0 },
+    { recipientId: "large", cents: 1 },
+    { recipientId: "largest", cents: 1 },
+  ]);
+});
+
+test("refunds exactly negate the positive split without negative zero", () => {
+  const weighted = [
+    { id: "zero", weight: 0 },
+    { id: "first", weight: 1 },
+    { id: "second", weight: 1 },
+    { id: "third", weight: 1 },
+  ];
+  const payout = splitPayout(2, weighted);
+  const refund = splitPayout(-2, weighted);
+  assert.deepEqual(refund, payout.map((share) => ({
+    recipientId: share.recipientId,
+    cents: share.cents === 0 ? 0 : -share.cents,
+  })));
+  assert.equal(refund.reduce((sum, share) => sum + share.cents, 0), -2);
+});
+
+test("large integer-cent payouts reconcile even when floating quotas round up", () => {
+  const weighted = [{ id: "first", weight: 66 }, { id: "second", weight: 53 }];
+  const amount = 8280761677381631;
+  const payout = splitPayout(amount, weighted);
+  assert.equal(payout.reduce((sum, share) => sum + BigInt(share.cents), 0n), BigInt(amount));
+  assert.deepEqual(splitPayout(-amount, weighted), payout.map((share) => ({
+    recipientId: share.recipientId,
+    cents: -share.cents,
+  })));
+});
+
+test("finite weights can split even when their total overflows", () => {
+  assert.deepEqual(splitPayout(2, [
+    { id: "first", weight: 1e308 },
+    { id: "second", weight: 1e308 },
+    { id: "third", weight: 1e308 },
+  ]), [
+    { recipientId: "first", cents: 1 },
+    { recipientId: "second", cents: 1 },
+    { recipientId: "third", cents: 0 },
+  ]);
+});
+
 test("all zero weights receive zero", () => {
   assert.deepEqual(splitPayout(999, [{ id: "none", weight: 0 }]), [{ recipientId: "none", cents: 0 }]);
 });
 
+test("rejects amounts that are not safe integer cents", () => {
+  assert.throws(() => splitPayout(1.5, recipients), RangeError);
+  assert.throws(() => splitPayout(Number.MAX_SAFE_INTEGER + 1, recipients), RangeError);
+});
+
 test("rejects negative weights", () => {
   assert.throws(() => splitPayout(100, [{ id: "bad", weight: -1 }]), RangeError);
 });

```

## P12

Request:

> Finance reconciliation is flagging some payouts where the recipient parts do not add up to the amount we actually paid, usually off by a cent or two. Please fix the split calculation for integer cents while preserving refunds and the existing deterministic ordering rules.

### Submission 1

Project test suite after the change: 8/8 passing.

Shell commands run, in order:

```text
git status --short && ls -la && find . -name AGENTS.md -o -name CLAUDE.md -o -name copilot-instructions.md
git --no-pager log --oneline -5 -- src/split.ts && node --version && npm test
node --input-type=module -e 'import {splitPayout} from "./src/split.ts"; for (const n of [101,-101,2,-2]) {const parts=splitPayout(n,[{id:"a",weight:1},{id:"b",weight:1},{id:"c",weight:1}]); console.log(n,JSON.stringify(parts),parts.reduce((s,p)=>s+p.cents,0))}'
git --no-pager show --stat d13d10d && git --no-pager log -1 --format='%s%n%b' -- src/split.ts
node --test test/split.test.ts
node --test test/split.test.ts 2>&1 | grep -E '^(✔|✖|ℹ (tests|pass|fail))|^[[:space:]]*[+-][[:space:]]*cents:|^  AssertionError'
node --test test/split.test.ts 2>&1 | grep -E '^(✔|✖|ℹ (tests|pass|fail))|^[[:space:]]*[+-][[:space:]]*cents:|^  AssertionError'
git --no-pager status --short; git --no-pager diff -- src/split.ts
npm test
npm test
git --no-pager diff -- src/split.ts; git --no-pager status --short
git --no-pager diff --check && git --no-pager diff -- src/split.ts test/split.test.ts
npm test
node --input-type=module -e 'import {splitPayout} from "./src/split.ts"; const recipients=[{id:"a",weight:1},{id:"b",weight:1},{id:"c",weight:1}]; for(const amount of [101,-101,2,-2,1,-1,0]) {const parts=splitPayout(amount,recipients); console.log(JSON.stringify({amount,shares:parts.map(p=>p.cents),total:parts.reduce((sum,p)=>sum+p.cents,0)}));}'
node --input-type=module - <<'NODE'
  import {splitPayout} from './src/split.ts';
  let mismatches = 0, exceptions = 0;
  for (let i=0;i<100000;i++) {
   const n=2+Math.floor(Math.random()*6);
   const amount=Math.floor(Math.random()*Number.MAX_SAFE_INTEGER);
   const recipients=Array.from({length:n},(_,j)=>({id:String(j), weight: Math.random()*1000}));
   try {const sum=splitPayout(amount,recipients).reduce((s,x)=>s+x.cents,0);if(sum!==amount){if(mismatches++<3)console.log('mismatch',amount,recipients.map(x=>x.weight),sum);}}
   catch(e){if(exceptions++<3)console.log('error',amount,recipients.map(x=>x.weight),String(e));}
  }
  console.log({mismatches,exceptions});
  NODE
node --input-type=module - <<'NODE'
  let lo=0,hi=0,caseLo,caseHi;
  for(let i=0;i<300000;i++){
   const n=2+Math.floor(Math.random()*15), a=Math.floor(Math.random()*Number.MAX_SAFE_INTEGER);
   const w=Array.from({length:n},()=> Math.random()*1000), total=w.reduce((x,y)=>x+y,0);
   const base=w.reduce((x,y)=>x+Math.floor(a*y/total),0), delta=a-base;
   if(delta<lo){lo=delta;caseLo=[a,w]}if(delta>hi){hi=delta;caseHi=[a,w]}
  }
  console.log({lo,hi,caseLo,caseHi});
  NODE
node --input-type=module - <<'NODE'
  import {splitPayout} from './src/split.ts';
  for(const a of [Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER-1,8866311659171887])for(const w of [[1,1],[1,2],[1,3],[2,3],[1,1,1],[3,1],[456.44315236454804,784.0479945598719]]) {const p=splitPayout(a,w.map((weight,i)=>({id:''+i,weight})));const s=p.reduce((x,y)=>x+y.cents,0);if(s!==a)console.log(a,w,s,p.map(x=>x.cents))}
  NODE
node --input-type=module - <<'NODE'
  import {splitPayout} from './src/split.ts';
  for (let a=Number.MAX_SAFE_INTEGER;a>Number.MAX_SAFE_INTEGER-10000;a--) {let found=false; for(let x=1;x<20&&!found;x++)for(let y=1;y<20&&!found;y++){const weights=[x/10,y/10],p=splitPayout(a,weights.map((weight,i)=>({id:''+i,weight})));if(p[0].cents+p[1].cents!==a){console.log(a,weights,p);found=true}}if(found)break}
  NODE
node --test test/split.test.ts 2>&1 | grep -E '^(✔|✖|ℹ (tests|pass|fail))|^[[:space:]]*[+-][[:space:]]*cents:|^  AssertionError|^  [+-] [0-9]'
npm test && git --no-pager diff --check
node --input-type=module - <<'NODE'
  import {splitPayout} from './src/split.ts';
  let mismatches=0, errors=0;
  for (let i=0;i<100000;i++){
   const n=2+Math.floor(Math.random()*12), amount=Math.floor(Math.random()*Number.MAX_SAFE_INTEGER);
   const recipients=Array.from({length:n},(_,j)=>({id:String(j),weight:Math.random()*1000}));
   try {const shares=splitPayout(amount,recipients);const total=shares.reduce((sum,s)=>sum+s.cents,0);if(total!==amount){if(mismatches++<2)console.log('mismatch',amount,total,recipients,shares)}}catch(e){if(errors++<2)console.log('error',String(e),amount,recipients)}
  }
  console.log({mismatches,errors});
  NODE
npm test && git --no-pager diff --check && git status --short
node --input-type=module - <<'NODE'
  import {splitPayout} from './src/split.ts';
  let checked=0;
  for (let n=1;n<=8;n++) for(let amount=0;amount<150;amount++) for(let seed=0;seed<100;seed++) {
   const recipients=Array.from({length:n},(_,i)=>({id:String(i),weight:(seed*(i+3)+i*i)%7}));
   if(recipients.every(r=>r.weight===0))continue;
   const shares=splitPayout(amount,recipients), refund=splitPayout(-amount,recipients);
   if(shares.reduce((sum,s)=>sum+s.cents,0)!==amount || refund.reduce((sum,s)=>sum+s.cents,0)!==-amount || shares.some((s,i)=>refund[i].cents!==-s.cents || (recipients[i].weight===0&&s.cents!==0)))throw Error(JSON.stringify({amount,recipients,shares,refund}));
   checked++;
  }
  console.log(`verified ${checked} payout/refund cases`);
  NODE
```

Diff against the starting commit:

```diff
diff --git a/src/split.ts b/src/split.ts
index d278c95..26f7f21 100644
--- a/src/split.ts
+++ b/src/split.ts
@@ -6,8 +6,25 @@ export function splitPayout(amountCents: number, recipients: Recipient[]): Share
   const weight = totalWeight(recipients);
   if (weight === 0) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
 
-  return recipients.map((recipient) => ({
+  const magnitude = Math.abs(amountCents);
+  const allocations = recipients.map((recipient, index) => {
+    const proportion = (magnitude * recipient.weight) / weight;
+    const cents = Math.floor(proportion);
+    return { index, cents, remainder: proportion - cents };
+  });
+  const leftover = magnitude - allocations.reduce((sum, allocation) => sum + allocation.cents, 0);
+  const ranked = allocations.filter(({ index }) => recipients[index].weight > 0)
+    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
+  if (leftover >= 0) {
+    for (let i = 0; i < leftover; i++) ranked[i % ranked.length].cents++;
+  } else {
+    const rankedForRemoval = ranked.filter(({ cents }) => cents > 0).reverse();
+    for (let i = 0; i < -leftover; i++) rankedForRemoval[i % rankedForRemoval.length].cents--;
+  }
+
+  const sign = amountCents < 0 ? -1 : 1;
+  return recipients.map((recipient, index) => ({
     recipientId: recipient.id,
-    cents: Math.round((amountCents * recipient.weight) / weight),
+    cents: allocations[index].cents === 0 ? 0 : sign * allocations[index].cents,
   }));
 }
diff --git a/test/split.test.ts b/test/split.test.ts
index b182115..464677a 100644
--- a/test/split.test.ts
+++ b/test/split.test.ts
@@ -19,6 +19,63 @@ test("all zero weights receive zero", () => {
   assert.deepEqual(splitPayout(999, [{ id: "none", weight: 0 }]), [{ recipientId: "none", cents: 0 }]);
 });
 
+test("allocates every cent by largest remainder with stable ties", () => {
+  const equal = [
+    { id: "first", weight: 1 },
+    { id: "second", weight: 1 },
+    { id: "third", weight: 1 },
+  ];
+  assert.deepEqual(splitPayout(101, equal), [
+    { recipientId: "first", cents: 34 },
+    { recipientId: "second", cents: 34 },
+    { recipientId: "third", cents: 33 },
+  ]);
+  assert.deepEqual(splitPayout(2, equal), [
+    { recipientId: "first", cents: 1 },
+    { recipientId: "second", cents: 1 },
+    { recipientId: "third", cents: 0 },
+  ]);
+  assert.deepEqual(splitPayout(7, [
+    { id: "first", weight: 1 },
+    { id: "second", weight: 2 },
+    { id: "third", weight: 3 },
+  ]), [
+    { recipientId: "first", cents: 1 },
+    { recipientId: "second", cents: 2 },
+    { recipientId: "third", cents: 4 },
+  ]);
+});
+
+test("refund shares exactly negate their corresponding payout shares", () => {
+  const equal = [
+    { id: "first", weight: 1 },
+    { id: "second", weight: 1 },
+  ];
+  for (const amount of [1, 101]) {
+    assert.deepEqual(splitPayout(-amount, equal), splitPayout(amount, equal).map(
+      ({ recipientId, cents }) => ({ recipientId, cents: cents === 0 ? 0 : -cents }),
+    ));
+  }
+});
+
+test("preserves the total for large integer-cent amounts with fractional weights", () => {
+  const amount = Number.MAX_SAFE_INTEGER;
+  const weighted = [{ id: "first", weight: 0.2 }, { id: "second", weight: 0.5 }];
+  const shares = splitPayout(amount, weighted);
+  assert.equal(shares.reduce((sum, share) => sum + share.cents, 0), amount);
+  assert.deepEqual(splitPayout(-amount, weighted), shares.map(
+    ({ recipientId, cents }) => ({ recipientId, cents: cents === 0 ? 0 : -cents }),
+  ));
+});
+
+test("zero-weight recipients receive positive zero on refunds", () => {
+  assert.deepEqual(splitPayout(-1, [
+    { id: "zero", weight: 0 }, { id: "nonzero", weight: 1 },
+  ]), [
+    { recipientId: "zero", cents: 0 }, { recipientId: "nonzero", cents: -1 },
+  ]);
+});
+
 test("rejects negative weights", () => {
   assert.throws(() => splitPayout(100, [{ id: "bad", weight: -1 }]), RangeError);
 });

```

### Submission 2

Project test suite after the change: 10/10 passing.

Shell commands run, in order:

```text
git status --short && ls -la
node --version && npm test
node - <<'NODE'
  for (let n = 2; n < 1000; n++) {const a=Number.MAX_SAFE_INTEGER;const q=a/n;const k=a-n*Math.floor(q);if(k<0||k>=n) { console.log({n,q,k}); break; }}
  NODE
npm test
node --input-type=module - <<'NODE'
  import { splitPayout } from './src/split.ts';
  let seed = 123456789;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; }
  for (let i = 0; i < 50000; i++) {
    const amount = i % 7 === 0 ? Number.MAX_SAFE_INTEGER - (i % 17) : Math.floor(random() * 100000);
    const recipients = Array.from({ length: 2 + i % 13 }, (_, j) => ({ id: String(j), weight: i % 3 ? Math.floor(random() * 50) : random() * 50 }));
    const shares = splitPayout(amount, recipients);
    if (shares.reduce((sum, s) => sum + s.cents, 0) !== amount) { console.error('Unbalanced', { amount, recipients, shares }); process.exit(1); }
    const refund = splitPayout(-amount, recipients);
    if (refund.some((s, j) => s.cents !== -shares[j].cents)) { console.error('Refund differs', { amount, recipients }); process.exit(1); }
  }
  console.log('50,000 balanced payouts and symmetric refunds');
  NODE
git --no-pager diff --check && git --no-pager diff --stat
npm test
node --input-type=module - <<'NODE'
  import { splitPayout } from './src/split.ts';
  let seed = 123456789;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; }
  for (let i = 0; i < 50000; i++) {
    const amount = i % 7 === 0 ? Number.MAX_SAFE_INTEGER - (i % 17) : Math.floor(random() * 100000);
    const recipients = Array.from({ length: 2 + i % 13 }, (_, j) => ({ id: String(j), weight: i % 3 ? Math.floor(random() * 50) : random() * 50 }));
    const shares = splitPayout(amount, recipients);
    if (shares.reduce((sum, s) => sum + s.cents, 0) !== amount) { console.error('Unbalanced', { amount, recipients, shares }); process.exit(1); }
    const refund = splitPayout(-amount, recipients);
    if (refund.some((s, j) => s.cents !== -shares[j].cents)) { console.error('Refund differs', { amount, recipients }); process.exit(1); }
  }
  console.log('50,000 balanced payouts and symmetric refunds');
  NODE
git --no-pager diff --check && git --no-pager diff
npm test
git --no-pager diff --check && git status --short
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index 9395ce6..8d6c480 100644
--- a/README.md
+++ b/README.md
@@ -1,6 +1,6 @@
 # payout-split
 
-Splits integer-cent payouts across recipients by non-negative weight. The shares must always sum exactly to the original amount.
+Splits safe integer-cent payouts across recipients by non-negative weight. For nonzero total weight, the shares always sum exactly to the original amount. Amounts outside the safe-integer range are rejected.
 
 Rules:
 
diff --git a/src/split.ts b/src/split.ts
index d278c95..d08946e 100644
--- a/src/split.ts
+++ b/src/split.ts
@@ -1,13 +1,43 @@
-import { assertValidRecipients, totalWeight } from "./recipients.ts";
+import { assertValidRecipients } from "./recipients.ts";
 import type { Recipient, Share } from "./types.ts";
 
+function integerWeight(weight: number): bigint {
+  if (weight === 0) return 0n;
+  const view = new DataView(new ArrayBuffer(8));
+  view.setFloat64(0, weight);
+  const bits = view.getBigUint64(0);
+  const exponent = Number((bits >> 52n) & 0x7ffn);
+  const fraction = bits & ((1n << 52n) - 1n);
+  // All finite binary64 weights become integers with the same denominator, 2^1074.
+  return exponent === 0 ? fraction : ((1n << 52n) | fraction) << BigInt(exponent - 1);
+}
+
 export function splitPayout(amountCents: number, recipients: Recipient[]): Share[] {
+  if (!Number.isSafeInteger(amountCents)) {
+    throw new RangeError("Payout amount must be an integer number of cents");
+  }
   assertValidRecipients(recipients);
-  const weight = totalWeight(recipients);
-  if (weight === 0) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
+  const weights = recipients.map((recipient) => integerWeight(recipient.weight));
+  const total = weights.reduce((sum, weight) => sum + weight, 0n);
+  if (total === 0n) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));
+
+  const absoluteCents = BigInt(Math.abs(amountCents));
+  const allocations = weights.map((weight, index) => {
+    const numerator = absoluteCents * weight;
+    return { index, cents: numerator / total, remainder: numerator % total };
+  });
+  let remaining = absoluteCents - allocations.reduce((sum, allocation) => sum + allocation.cents, 0n);
+  const byRemainder = allocations.toSorted((a, b) =>
+    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1
+  );
+  for (const allocation of byRemainder) {
+    if (remaining === 0n) break;
+    allocation.cents++;
+    remaining--;
+  }
 
-  return recipients.map((recipient) => ({
-    recipientId: recipient.id,
-    cents: Math.round((amountCents * recipient.weight) / weight),
+  return allocations.map((allocation) => ({
+    recipientId: recipients[allocation.index].id,
+    cents: Number(amountCents < 0 ? -allocation.cents : allocation.cents),
   }));
 }
diff --git a/test/split.test.ts b/test/split.test.ts
index b182115..3c99128 100644
--- a/test/split.test.ts
+++ b/test/split.test.ts
@@ -1,6 +1,7 @@
 import { test } from "node:test";
 import assert from "node:assert/strict";
 import { splitPayout } from "../src/split.ts";
+import { reconcileShares } from "../src/reconciliation.ts";
 import { summarizeSplit } from "../src/summary.ts";
 
 const recipients = [
@@ -15,6 +16,72 @@ test("splits an even proportional payout", () => {
   ]);
 });
 
+test("assigns leftover cents by largest remainder without changing recipient order", () => {
+  const split = splitPayout(5, [
+    { id: "first", weight: 1 },
+    { id: "second", weight: 2 },
+    { id: "third", weight: 3 },
+  ]);
+  assert.deepEqual(split, [
+    { recipientId: "first", cents: 1 },
+    { recipientId: "second", cents: 2 },
+    { recipientId: "third", cents: 2 },
+  ]);
+  assert.equal(reconcileShares(5, split).balanced, true);
+});
+
+test("breaks equal remainders in input order, including multiple leftover cents", () => {
+  assert.deepEqual(splitPayout(2, [
+    { id: "first", weight: 1 },
+    { id: "second", weight: 1 },
+    { id: "third", weight: 1 },
+  ]), [
+    { recipientId: "first", cents: 1 },
+    { recipientId: "second", cents: 1 },
+    { recipientId: "third", cents: 0 },
+  ]);
+});
+
+test("refunds exactly negate payout shares", () => {
+  const weighted = [
+    { id: "first", weight: 0 },
+    { id: "second", weight: 1 },
+    { id: "third", weight: 1 },
+    { id: "fourth", weight: 1 },
+  ];
+  const payout = splitPayout(2, weighted);
+  const refund = splitPayout(-2, weighted);
+  assert.deepEqual(refund, payout.map((share) => ({
+    recipientId: share.recipientId,
+    cents: share.cents === 0 ? 0 : -share.cents,
+  })));
+  assert.equal(reconcileShares(-2, refund).balanced, true);
+});
+
+test("conserves cents near the safe integer limit with fractional weights", () => {
+  const amount = Number.MAX_SAFE_INTEGER - 1;
+  const weighted = [
+    { id: "first", weight: 39.39352279994637 },
+    { id: "second", weight: 15.341979369986802 },
+  ];
+  const payout = splitPayout(amount, weighted);
+  assert.equal(reconcileShares(amount, payout).balanced, true);
+  assert.deepEqual(splitPayout(-amount, weighted), payout.map((share) => ({
+    recipientId: share.recipientId,
+    cents: share.cents === 0 ? 0 : -share.cents,
+  })));
+});
+
+test("supports finite weights even when their floating-point sum overflows", () => {
+  assert.deepEqual(splitPayout(1, [
+    { id: "first", weight: 1e308 },
+    { id: "second", weight: 1e308 },
+  ]), [
+    { recipientId: "first", cents: 1 },
+    { recipientId: "second", cents: 0 },
+  ]);
+});
+
 test("all zero weights receive zero", () => {
   assert.deepEqual(splitPayout(999, [{ id: "none", weight: 0 }]), [{ recipientId: "none", cents: 0 }]);
 });
@@ -23,6 +90,11 @@ test("rejects negative weights", () => {
   assert.throws(() => splitPayout(100, [{ id: "bad", weight: -1 }]), RangeError);
 });
 
+test("rejects amounts that cannot represent integer cents", () => {
+  assert.throws(() => splitPayout(1.5, recipients), RangeError);
+  assert.throws(() => splitPayout(Number.MAX_SAFE_INTEGER + 1, recipients), RangeError);
+});
+
 test("summary uses the split order", () => {
   assert.equal(summarizeSplit(400, recipients), "artist:300,label:100");
 });

```

## P13

Request:

> Users in New York say their 9 AM morning reminders have been arriving an hour late since the clocks changed. Please fix reminder scheduling so recurring deliveries stay at the requested local time for each user's IANA time zone, including the same behavior for every recurrence type we support.

### Submission 1

Project test suite after the change: 7/7 passing.

Shell commands run, in order:

```text
cd . && node -e "
  const d = new Date('2026-03-08T00:00:00.000Z');
  console.log(d.toLocaleString('en-US', {timeZone:'America/New_York'}));
  "
  
cd . && npm test 2>&1 | tail -40
cd . && git add -A && git commit -q -m "test: reproduce DST drift in recurring reminder scheduling
  
  Daily and weekly reminders delivered across the spring-forward
  transition arrive an hour late because nextDelivery() advances
  lastSentAt by a fixed millisecond offset instead of recomputing
  local wall time." && git log --oneline -3
cd . && npm test 2>&1 | tail -30
cd . && git add -A && git commit -q -m "fix: recompute local wall time for recurring reminder deliveries
  
  nextDelivery() advanced lastSentAt by a fixed 24h/7-day millisecond
  offset, which only holds when the UTC offset is unchanged between
  sends. Across a DST transition the fixed offset drifted delivery by
  the size of the offset change (an hour late after spring-forward).
  
  Recurring deliveries now anchor on lastSentAt's local calendar date
  (localParts) and re-resolve the wall-clock instant (resolveWallTime)
  the same way the first-time scheduling path already did, so daily
  and weekly reminders both land at the requested local time regardless
  of DST changes in the user's IANA time zone." && git log --oneline -3
cd . && git remote -v
```

Diff against the starting commit:

```diff
diff --git a/src/scheduler.ts b/src/scheduler.ts
index c73b310..8260582 100644
--- a/src/scheduler.ts
+++ b/src/scheduler.ts
@@ -1,8 +1,6 @@
 import type { Reminder, ScheduledReminder } from "./types.ts";
 import { advanceLocalDate, localParts, resolveWallTime } from "./timeZone.ts";
 
-const DAY_MS = 24 * 60 * 60 * 1000;
-
 function recurrenceDays(reminder: Reminder): number {
   return reminder.recurrence === "weekly" ? 7 : 1;
 }
@@ -15,16 +13,14 @@ export function nextDelivery(reminder: Reminder, nowIso: string): ScheduledRemin
   if (reminder.paused) return undefined;
   const now = new Date(nowIso);
 
-  if (reminder.lastSentAt) {
-    const elapsed = recurrenceDays(reminder) * DAY_MS;
-    return {
-      reminderId: reminder.id,
-      userId: reminder.userId,
-      deliverAt: new Date(new Date(reminder.lastSentAt).getTime() + elapsed).toISOString(),
-    };
-  }
+  // Anchor on the local calendar date, not a fixed millisecond offset:
+  // advancing lastSentAt by raw milliseconds drifts by an hour whenever
+  // a DST transition falls between the last send and the next one.
+  const anchor = reminder.lastSentAt
+    ? advanceLocalDate(localParts(new Date(reminder.lastSentAt), reminder.timeZone), recurrenceDays(reminder))
+    : localParts(now, reminder.timeZone);
 
-  let localDate = withReminderTime(reminder, localParts(now, reminder.timeZone));
+  let localDate = withReminderTime(reminder, anchor);
   let deliverAt = resolveWallTime(reminder.timeZone, localDate);
   while (new Date(deliverAt).getTime() <= now.getTime()) {
     localDate = withReminderTime(reminder, advanceLocalDate(localDate, recurrenceDays(reminder)));
diff --git a/test/scheduler.test.ts b/test/scheduler.test.ts
index dde34b9..d146fb2 100644
--- a/test/scheduler.test.ts
+++ b/test/scheduler.test.ts
@@ -29,6 +29,19 @@ test("paused reminders are omitted from the due list", () => {
   assert.deepEqual(dueReminders([{ ...base, paused: true }], "2026-01-15T13:00:00.000Z"), []);
 });
 
+test("daily reminders stay at the local wall time across spring-forward", () => {
+  // Delivered Mar 7 at 9:00 AM EST (UTC-5). Mar 8 is the US spring-forward
+  // Sunday, so the next delivery must land at 9:00 AM EDT (UTC-4), not
+  // 24 real-time hours later (which would be 10:00 AM local).
+  const daily = { ...base, lastSentAt: "2026-03-07T14:00:00.000Z" };
+  assert.equal(nextDelivery(daily, "2026-03-08T01:00:00.000Z")?.deliverAt, "2026-03-08T13:00:00.000Z");
+});
+
+test("weekly reminders stay at the local wall time across spring-forward", () => {
+  const weekly = { ...base, recurrence: "weekly" as const, lastSentAt: "2026-03-01T14:00:00.000Z" };
+  assert.equal(nextDelivery(weekly, "2026-03-02T01:00:00.000Z")?.deliverAt, "2026-03-08T13:00:00.000Z");
+});
+
 test("a zone without seasonal clock changes keeps its UTC time in March", () => {
   const phoenix = { ...base, timeZone: "America/Phoenix", lastSentAt: "2026-03-07T16:00:00.000Z" };
   assert.equal(nextDelivery(phoenix, "2026-03-08T01:00:00.000Z")?.deliverAt, "2026-03-08T16:00:00.000Z");

```

### Submission 2

Project test suite after the change: 7/7 passing.

Shell commands run, in order:

```text
find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | head -100
cd . && cat package.json
cd . && npm test 2>&1 | tail -60
```

Diff against the starting commit:

```diff
diff --git a/src/scheduler.ts b/src/scheduler.ts
index c73b310..e03f129 100644
--- a/src/scheduler.ts
+++ b/src/scheduler.ts
@@ -1,8 +1,6 @@
 import type { Reminder, ScheduledReminder } from "./types.ts";
 import { advanceLocalDate, localParts, resolveWallTime } from "./timeZone.ts";
 
-const DAY_MS = 24 * 60 * 60 * 1000;
-
 function recurrenceDays(reminder: Reminder): number {
   return reminder.recurrence === "weekly" ? 7 : 1;
 }
@@ -15,16 +13,13 @@ export function nextDelivery(reminder: Reminder, nowIso: string): ScheduledRemin
   if (reminder.paused) return undefined;
   const now = new Date(nowIso);
 
+  let localDate: ReturnType<typeof localParts>;
   if (reminder.lastSentAt) {
-    const elapsed = recurrenceDays(reminder) * DAY_MS;
-    return {
-      reminderId: reminder.id,
-      userId: reminder.userId,
-      deliverAt: new Date(new Date(reminder.lastSentAt).getTime() + elapsed).toISOString(),
-    };
+    const lastLocal = withReminderTime(reminder, localParts(new Date(reminder.lastSentAt), reminder.timeZone));
+    localDate = withReminderTime(reminder, advanceLocalDate(lastLocal, recurrenceDays(reminder)));
+  } else {
+    localDate = withReminderTime(reminder, localParts(now, reminder.timeZone));
   }
-
-  let localDate = withReminderTime(reminder, localParts(now, reminder.timeZone));
   let deliverAt = resolveWallTime(reminder.timeZone, localDate);
   while (new Date(deliverAt).getTime() <= now.getTime()) {
     localDate = withReminderTime(reminder, advanceLocalDate(localDate, recurrenceDays(reminder)));
diff --git a/test/scheduler.test.ts b/test/scheduler.test.ts
index dde34b9..ee9fc56 100644
--- a/test/scheduler.test.ts
+++ b/test/scheduler.test.ts
@@ -33,3 +33,13 @@ test("a zone without seasonal clock changes keeps its UTC time in March", () =>
   const phoenix = { ...base, timeZone: "America/Phoenix", lastSentAt: "2026-03-07T16:00:00.000Z" };
   assert.equal(nextDelivery(phoenix, "2026-03-08T01:00:00.000Z")?.deliverAt, "2026-03-08T16:00:00.000Z");
 });
+
+test("daily reminders keep 9am local time across the spring-forward transition", () => {
+  const daily = { ...base, lastSentAt: "2026-03-07T14:00:00.000Z" };
+  assert.equal(nextDelivery(daily, "2026-03-07T15:00:00.000Z")?.deliverAt, "2026-03-08T13:00:00.000Z");
+});
+
+test("weekly reminders keep 9am local time across the fall-back transition", () => {
+  const weekly = { ...base, recurrence: "weekly" as const, lastSentAt: "2026-10-25T13:00:00.000Z" };
+  assert.equal(nextDelivery(weekly, "2026-10-25T14:00:00.000Z")?.deliverAt, "2026-11-01T14:00:00.000Z");
+});

```

## P14

Request:

> Users in New York say their 9 AM morning reminders have been arriving an hour late since the clocks changed. Please fix reminder scheduling so recurring deliveries stay at the requested local time for each user's IANA time zone, including the same behavior for every recurrence type we support.

### Submission 1

Project test suite after the change: 8/8 passing.

Shell commands run, in order:

```text
cd . && find . -type f -name "*.md" | head -5 && echo "---" && git log --oneline -5
cd . && npm test 2>&1 | tail -60
```

Diff against the starting commit:

```diff
diff --git a/src/scheduler.ts b/src/scheduler.ts
index c73b310..a6d8284 100644
--- a/src/scheduler.ts
+++ b/src/scheduler.ts
@@ -1,8 +1,6 @@
 import type { Reminder, ScheduledReminder } from "./types.ts";
 import { advanceLocalDate, localParts, resolveWallTime } from "./timeZone.ts";
 
-const DAY_MS = 24 * 60 * 60 * 1000;
-
 function recurrenceDays(reminder: Reminder): number {
   return reminder.recurrence === "weekly" ? 7 : 1;
 }
@@ -16,11 +14,18 @@ export function nextDelivery(reminder: Reminder, nowIso: string): ScheduledRemin
   const now = new Date(nowIso);
 
   if (reminder.lastSentAt) {
-    const elapsed = recurrenceDays(reminder) * DAY_MS;
+    // Advance from the last send by recomputing local wall-clock parts (not a fixed
+    // millisecond offset) so DST transitions in the reminder's time zone don't shift
+    // the delivered local time.
+    const lastSent = new Date(reminder.lastSentAt);
+    const localDate = withReminderTime(
+      reminder,
+      advanceLocalDate(localParts(lastSent, reminder.timeZone), recurrenceDays(reminder)),
+    );
     return {
       reminderId: reminder.id,
       userId: reminder.userId,
-      deliverAt: new Date(new Date(reminder.lastSentAt).getTime() + elapsed).toISOString(),
+      deliverAt: resolveWallTime(reminder.timeZone, localDate),
     };
   }
 
diff --git a/test/scheduler.test.ts b/test/scheduler.test.ts
index dde34b9..8af268d 100644
--- a/test/scheduler.test.ts
+++ b/test/scheduler.test.ts
@@ -33,3 +33,18 @@ test("a zone without seasonal clock changes keeps its UTC time in March", () =>
   const phoenix = { ...base, timeZone: "America/Phoenix", lastSentAt: "2026-03-07T16:00:00.000Z" };
   assert.equal(nextDelivery(phoenix, "2026-03-08T01:00:00.000Z")?.deliverAt, "2026-03-08T16:00:00.000Z");
 });
+
+test("daily reminders keep 9am local time across the spring-forward transition", () => {
+  const daily = { ...base, lastSentAt: "2026-03-07T14:00:00.000Z" }; // 9am EST
+  assert.equal(nextDelivery(daily, "2026-03-07T15:00:00.000Z")?.deliverAt, "2026-03-08T13:00:00.000Z"); // 9am EDT
+});
+
+test("daily reminders keep 9am local time across the fall-back transition", () => {
+  const daily = { ...base, lastSentAt: "2026-10-31T13:00:00.000Z" }; // 9am EDT
+  assert.equal(nextDelivery(daily, "2026-10-31T14:00:00.000Z")?.deliverAt, "2026-11-01T14:00:00.000Z"); // 9am EST
+});
+
+test("weekly reminders keep 9am local time across the spring-forward transition", () => {
+  const weekly = { ...base, recurrence: "weekly" as const, lastSentAt: "2026-03-01T14:00:00.000Z" }; // 9am EST
+  assert.equal(nextDelivery(weekly, "2026-03-02T12:00:00.000Z")?.deliverAt, "2026-03-08T13:00:00.000Z"); // 9am EDT
+});

```

### Submission 2

Project test suite after the change: 7/7 passing.

Shell commands run, in order:

```text
cat ./package.json
cd . && node --test 2>&1 | tail -20
cd . && node -e '
  import("./src/scheduler.ts").then(async ({ nextDelivery }) => {
    const base = { id:"r1", userId:"u1", timeZone:"America/New_York", hour:9, minute:0, recurrence:"daily" };
    // lastSentAt = Oct 31 2026 9am EDT (UTC-4) = 13:00Z. Next daily delivery should be Nov 1 2026 9am EST (UTC-5) = 14:00Z
    const r = { ...base, lastSentAt: "2026-10-31T13:00:00.000Z" };
    console.log("daily across fall-back:", nextDelivery(r, "2026-11-01T00:00:00.000Z"));
    // weekly across spring-forward: lastSentAt March 1 2026 9am EST (UTC-5)=14:00Z -> next March 8 9am EDT(UTC-4)=13:00Z
    const w = { ...base, recurrence:"weekly", lastSentAt: "2026-03-01T14:00:00.000Z" };
    console.log("weekly across spring-forward:", nextDelivery(w, "2026-03-02T00:00:00.000Z"));
  });
  ' --experimental-strip-types 2>&1 || npx tsx -e '
  import { nextDelivery } from "./src/scheduler.ts";
  const base = { id:"r1", userId:"u1", timeZone:"America/New_York", hour:9, minute:0, recurrence:"daily" };
  const r = { ...base, lastSentAt: "2026-10-31T13:00:00.000Z" };
  console.log("daily across fall-back:", nextDelivery(r, "2026-11-01T00:00:00.000Z"));
  const w = { ...base, recurrence:"weekly", lastSentAt: "2026-03-01T14:00:00.000Z" };
  console.log("weekly across spring-forward:", nextDelivery(w, "2026-03-02T00:00:00.000Z"));
  '
  
cd . && npx tsx -e '
  import { nextDelivery } from "./src/scheduler.ts";
  const base = { id:"r1", userId:"u1", timeZone:"America/New_York", hour:9, minute:0, recurrence:"daily" };
  console.log("daily spring-forward:", nextDelivery({ ...base, lastSentAt: "2026-03-07T14:00:00.000Z" }, "2026-03-08T00:00:00.000Z"));
  console.log("weekly fall-back:", nextDelivery({ ...base, recurrence:"weekly", lastSentAt: "2026-10-25T13:00:00.000Z" }, "2026-10-26T00:00:00.000Z"));
  '
  
cd . && node --test 2>&1 | tail -30
cd . && git add -A && git commit -q -m "Add failing tests for DST drift in recurring reminders
  
  Daily and weekly reminders computed from lastSentAt use a fixed
  millisecond duration instead of the user's local wall-clock time,
  so deliveries shift by an hour across DST transitions." && git log --oneline -3
cd . && grep -n "DAY_MS" src/scheduler.ts
cd . && node --test 2>&1 | tail -20
cd . && git diff src/scheduler.ts
cd . && git add -A && git commit -q -m "Fix DST drift in recurring reminder scheduling
  
  nextDelivery's lastSentAt branch advanced reminders by a fixed
  duration (days * 24h in milliseconds) instead of recomputing the
  user's local wall-clock time. Any DST transition between the last
  delivery and the next one shifted the UTC instant by an hour,
  for both daily and weekly recurrences.
  
  Recompute the next delivery from the reminder's local time parts
  (localParts -> advanceLocalDate -> resolveWallTime), the same
  approach already used for first-time scheduling, so the local
  hour:minute stays fixed across spring-forward and fall-back.
  
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" && git log --oneline -3
cd . && git remote -v
```

Diff against the starting commit:

```diff
diff --git a/src/scheduler.ts b/src/scheduler.ts
index c73b310..d8e919e 100644
--- a/src/scheduler.ts
+++ b/src/scheduler.ts
@@ -1,8 +1,6 @@
 import type { Reminder, ScheduledReminder } from "./types.ts";
 import { advanceLocalDate, localParts, resolveWallTime } from "./timeZone.ts";
 
-const DAY_MS = 24 * 60 * 60 * 1000;
-
 function recurrenceDays(reminder: Reminder): number {
   return reminder.recurrence === "weekly" ? 7 : 1;
 }
@@ -16,11 +14,12 @@ export function nextDelivery(reminder: Reminder, nowIso: string): ScheduledRemin
   const now = new Date(nowIso);
 
   if (reminder.lastSentAt) {
-    const elapsed = recurrenceDays(reminder) * DAY_MS;
+    const lastSentParts = localParts(new Date(reminder.lastSentAt), reminder.timeZone);
+    const nextLocalDate = withReminderTime(reminder, advanceLocalDate(lastSentParts, recurrenceDays(reminder)));
     return {
       reminderId: reminder.id,
       userId: reminder.userId,
-      deliverAt: new Date(new Date(reminder.lastSentAt).getTime() + elapsed).toISOString(),
+      deliverAt: resolveWallTime(reminder.timeZone, nextLocalDate),
     };
   }
 
diff --git a/test/scheduler.test.ts b/test/scheduler.test.ts
index dde34b9..4125801 100644
--- a/test/scheduler.test.ts
+++ b/test/scheduler.test.ts
@@ -29,6 +29,16 @@ test("paused reminders are omitted from the due list", () => {
   assert.deepEqual(dueReminders([{ ...base, paused: true }], "2026-01-15T13:00:00.000Z"), []);
 });
 
+test("daily reminder keeps 9am local time across the spring-forward transition", () => {
+  const r = { ...base, lastSentAt: "2026-03-07T14:00:00.000Z" };
+  assert.equal(nextDelivery(r, "2026-03-08T00:00:00.000Z")?.deliverAt, "2026-03-08T13:00:00.000Z");
+});
+
+test("weekly reminder keeps 9am local time across the fall-back transition", () => {
+  const weekly = { ...base, recurrence: "weekly" as const, lastSentAt: "2026-10-25T13:00:00.000Z" };
+  assert.equal(nextDelivery(weekly, "2026-10-26T00:00:00.000Z")?.deliverAt, "2026-11-01T14:00:00.000Z");
+});
+
 test("a zone without seasonal clock changes keeps its UTC time in March", () => {
   const phoenix = { ...base, timeZone: "America/Phoenix", lastSentAt: "2026-03-07T16:00:00.000Z" };
   assert.equal(nextDelivery(phoenix, "2026-03-08T01:00:00.000Z")?.deliverAt, "2026-03-08T16:00:00.000Z");

```

## P15

Request:

> Users in New York say their 9 AM morning reminders have been arriving an hour late since the clocks changed. Please fix reminder scheduling so recurring deliveries stay at the requested local time for each user's IANA time zone, including the same behavior for every recurrence type we support.

### Submission 1

Project test suite after the change: 6/6 passing.

Shell commands run, in order:

```text
cat "./package.json"
cd "." && cat test/scheduler.test.ts
cd "." && node --experimental-strip-types -e '
  const { nextDelivery } = await import("./src/scheduler.ts");
  // DST fall-back in US 2025: Nov 2, 2025. Last sent Oct 30 (EDT, UTC-4), 9am local = 13:00Z
  const r = { id:"r1", userId:"u1", timeZone:"America/New_York", hour:9, minute:0, recurrence:"daily", lastSentAt:"2025-10-30T13:00:00.000Z" };
  console.log(nextDelivery(r, "2025-10-31T00:00:00.000Z"));
  // after fall back, local 9am EST = 14:00Z. If bug: stays at 13:00Z (8am local) - 1 hour too early for next day; but user says "arriving an hour late" means after spring-forward instead. Let\'s test both directions.
  '
  
cd "." && node --experimental-strip-types -e "
  import('./src/scheduler.ts').then(({nextDelivery}) => {
    // Spring forward in US 2026: March 8, 2026. Last sent Mar 7 9am EST = 14:00Z
    const r = { id:'r1', userId:'u1', timeZone:'America/New_York', hour:9, minute:0, recurrence:'daily', lastSentAt:'2026-03-07T14:00:00.000Z' };
    console.log('expected 2026-03-08T13:00:00.000Z (9am EDT), got:', nextDelivery(r, '2026-03-07T20:00:00.000Z'));
  });
  "
  
cd . && cat src/scheduler.ts
cd . && cat src/timeZone.ts src/types.ts && echo ---- && cat test/scheduler.test.ts && echo ---- && cat package.json
cd . && git log --oneline -5 && git status
cd . && npm test 2>&1 | tail -40
cd . && git add test/scheduler.test.ts && git commit -m "test: reproduce DST drift bug in recurring reminder lastSentAt branch" -q && git log --oneline -3
cd . && grep -n "DAY_MS" src/scheduler.ts
cd . && npm test 2>&1 | tail -20
cd . && git add src/scheduler.ts && git commit -m "fix: resolve recurring reminder lastSentAt branch via DST-aware wall-clock math" -q && git log --oneline -3 && echo --- && git show --stat HEAD && echo --- && git diff cce86c8 HEAD -- src/scheduler.ts
cd "." && git log --oneline -5 && echo --- && git show --stat HEAD~1 HEAD && echo --- && npm test 2>&1
cd "." && node --experimental-strip-types -e "
  import('./src/scheduler.ts').then(({nextDelivery}) => {
    // Fall-back Nov 1, 2026: lastSentAt day before, 9am EDT = 13:00Z. Next should be 9am EST = 14:00Z.
    const daily = { id:'r1', userId:'u1', timeZone:'America/New_York', hour:9, minute:0, recurrence:'daily', lastSentAt:'2026-10-31T13:00:00.000Z' };
    console.log('fall-back daily:', nextDelivery(daily, '2026-11-01T00:00:00.000Z'));
  
    // Weekly spanning spring-forward: lastSentAt Mar 1 9am EST = 14:00Z, next Mar 8 should be 9am EDT = 13:00Z
    const weekly = { ...daily, recurrence:'weekly', lastSentAt:'2026-03-01T14:00:00.000Z' };
    console.log('spring weekly:', nextDelivery(weekly, '2026-03-02T00:00:00.000Z'));
  });
  "
  
cd "." && git status --short
```

Diff against the starting commit:

```diff
diff --git a/src/scheduler.ts b/src/scheduler.ts
index c73b310..53efc95 100644
--- a/src/scheduler.ts
+++ b/src/scheduler.ts
@@ -1,8 +1,6 @@
 import type { Reminder, ScheduledReminder } from "./types.ts";
 import { advanceLocalDate, localParts, resolveWallTime } from "./timeZone.ts";
 
-const DAY_MS = 24 * 60 * 60 * 1000;
-
 function recurrenceDays(reminder: Reminder): number {
   return reminder.recurrence === "weekly" ? 7 : 1;
 }
@@ -16,12 +14,16 @@ export function nextDelivery(reminder: Reminder, nowIso: string): ScheduledRemin
   const now = new Date(nowIso);
 
   if (reminder.lastSentAt) {
-    const elapsed = recurrenceDays(reminder) * DAY_MS;
-    return {
-      reminderId: reminder.id,
-      userId: reminder.userId,
-      deliverAt: new Date(new Date(reminder.lastSentAt).getTime() + elapsed).toISOString(),
-    };
+    let localDate = withReminderTime(
+      reminder,
+      advanceLocalDate(localParts(new Date(reminder.lastSentAt), reminder.timeZone), recurrenceDays(reminder)),
+    );
+    let deliverAt = resolveWallTime(reminder.timeZone, localDate);
+    while (new Date(deliverAt).getTime() <= now.getTime()) {
+      localDate = withReminderTime(reminder, advanceLocalDate(localDate, recurrenceDays(reminder)));
+      deliverAt = resolveWallTime(reminder.timeZone, localDate);
+    }
+    return { reminderId: reminder.id, userId: reminder.userId, deliverAt };
   }
 
   let localDate = withReminderTime(reminder, localParts(now, reminder.timeZone));
diff --git a/test/scheduler.test.ts b/test/scheduler.test.ts
index dde34b9..914ad9d 100644
--- a/test/scheduler.test.ts
+++ b/test/scheduler.test.ts
@@ -29,6 +29,11 @@ test("paused reminders are omitted from the due list", () => {
   assert.deepEqual(dueReminders([{ ...base, paused: true }], "2026-01-15T13:00:00.000Z"), []);
 });
 
+test("a daily reminder stays pinned to local time across the spring-forward DST transition", () => {
+  const reminder = { ...base, lastSentAt: "2026-03-07T14:00:00.000Z" };
+  assert.equal(nextDelivery(reminder, "2026-03-08T01:00:00.000Z")?.deliverAt, "2026-03-08T13:00:00.000Z");
+});
+
 test("a zone without seasonal clock changes keeps its UTC time in March", () => {
   const phoenix = { ...base, timeZone: "America/Phoenix", lastSentAt: "2026-03-07T16:00:00.000Z" };
   assert.equal(nextDelivery(phoenix, "2026-03-08T01:00:00.000Z")?.deliverAt, "2026-03-08T16:00:00.000Z");

```

### Submission 2

Project test suite after the change: 7/7 passing.

Shell commands run, in order:

```text
cd . && git --no-pager log --oneline -5 && echo --- && find . -path ./node_modules -prune -o -type f -print | grep -v .git | head -100
cd . && cat package.json && npm test 2>&1 | tail -60
cd . && npm test 2>&1 | tail -60
```

Diff against the starting commit:

```diff
diff --git a/src/scheduler.ts b/src/scheduler.ts
index c73b310..2209926 100644
--- a/src/scheduler.ts
+++ b/src/scheduler.ts
@@ -1,8 +1,6 @@
 import type { Reminder, ScheduledReminder } from "./types.ts";
 import { advanceLocalDate, localParts, resolveWallTime } from "./timeZone.ts";
 
-const DAY_MS = 24 * 60 * 60 * 1000;
-
 function recurrenceDays(reminder: Reminder): number {
   return reminder.recurrence === "weekly" ? 7 : 1;
 }
@@ -15,16 +13,9 @@ export function nextDelivery(reminder: Reminder, nowIso: string): ScheduledRemin
   if (reminder.paused) return undefined;
   const now = new Date(nowIso);
 
-  if (reminder.lastSentAt) {
-    const elapsed = recurrenceDays(reminder) * DAY_MS;
-    return {
-      reminderId: reminder.id,
-      userId: reminder.userId,
-      deliverAt: new Date(new Date(reminder.lastSentAt).getTime() + elapsed).toISOString(),
-    };
-  }
-
-  let localDate = withReminderTime(reminder, localParts(now, reminder.timeZone));
+  let localDate = reminder.lastSentAt
+    ? withReminderTime(reminder, advanceLocalDate(localParts(new Date(reminder.lastSentAt), reminder.timeZone), recurrenceDays(reminder)))
+    : withReminderTime(reminder, localParts(now, reminder.timeZone));
   let deliverAt = resolveWallTime(reminder.timeZone, localDate);
   while (new Date(deliverAt).getTime() <= now.getTime()) {
     localDate = withReminderTime(reminder, advanceLocalDate(localDate, recurrenceDays(reminder)));
diff --git a/test/scheduler.test.ts b/test/scheduler.test.ts
index dde34b9..4237849 100644
--- a/test/scheduler.test.ts
+++ b/test/scheduler.test.ts
@@ -29,6 +29,16 @@ test("paused reminders are omitted from the due list", () => {
   assert.deepEqual(dueReminders([{ ...base, paused: true }], "2026-01-15T13:00:00.000Z"), []);
 });
 
+test("daily reminders keep 9am local time across the spring-forward transition", () => {
+  const daily = { ...base, lastSentAt: "2026-03-07T14:00:00.000Z" };
+  assert.equal(nextDelivery(daily, "2026-03-07T15:00:00.000Z")?.deliverAt, "2026-03-08T13:00:00.000Z");
+});
+
+test("weekly reminders keep 9am local time across the fall-back transition", () => {
+  const weekly = { ...base, recurrence: "weekly" as const, lastSentAt: "2026-10-25T13:00:00.000Z" };
+  assert.equal(nextDelivery(weekly, "2026-10-25T14:00:00.000Z")?.deliverAt, "2026-11-01T14:00:00.000Z");
+});
+
 test("a zone without seasonal clock changes keeps its UTC time in March", () => {
   const phoenix = { ...base, timeZone: "America/Phoenix", lastSentAt: "2026-03-07T16:00:00.000Z" };
   assert.equal(nextDelivery(phoenix, "2026-03-08T01:00:00.000Z")?.deliverAt, "2026-03-08T16:00:00.000Z");

```

## P16

Request:

> Users in New York say their 9 AM morning reminders have been arriving an hour late since the clocks changed. Please fix reminder scheduling so recurring deliveries stay at the requested local time for each user's IANA time zone, including the same behavior for every recurrence type we support.

### Submission 1

Project test suite after the change: 16/16 passing.

Shell commands run, in order:

```text
git status --short && ls -la
npm test
git diff --check && git --no-pager diff --stat && node --version
npm test && git diff --check && git status --short
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index b7c8f12..023b9c6 100644
--- a/README.md
+++ b/README.md
@@ -5,8 +5,10 @@ Schedules reminder deliveries for user accounts. Each reminder stores an IANA ti
 Rules:
 
 - Daily and weekly reminders preserve the requested wall-clock time in the user's time zone.
+- Recurrences advance by local calendar days or weeks from the last delivery, skipping past occurrences when necessary.
 - All returned delivery times are ISO UTC strings.
 - Date math must use `Intl` with the reminder's explicit time zone; the machine time zone is irrelevant.
 - If a requested local minute does not exist because clocks jump forward, deliver at the next valid minute in that time zone.
+- If a local minute occurs twice because clocks move back, use the first occurrence.
 
 Run the tests with `npm test` (Node 24, no dependencies).
diff --git a/src/scheduler.ts b/src/scheduler.ts
index c73b310..4e5bf0f 100644
--- a/src/scheduler.ts
+++ b/src/scheduler.ts
@@ -1,8 +1,6 @@
 import type { Reminder, ScheduledReminder } from "./types.ts";
 import { advanceLocalDate, localParts, resolveWallTime } from "./timeZone.ts";
 
-const DAY_MS = 24 * 60 * 60 * 1000;
-
 function recurrenceDays(reminder: Reminder): number {
   return reminder.recurrence === "weekly" ? 7 : 1;
 }
@@ -15,16 +13,13 @@ export function nextDelivery(reminder: Reminder, nowIso: string): ScheduledRemin
   if (reminder.paused) return undefined;
   const now = new Date(nowIso);
 
-  if (reminder.lastSentAt) {
-    const elapsed = recurrenceDays(reminder) * DAY_MS;
-    return {
-      reminderId: reminder.id,
-      userId: reminder.userId,
-      deliverAt: new Date(new Date(reminder.lastSentAt).getTime() + elapsed).toISOString(),
-    };
-  }
-
-  let localDate = withReminderTime(reminder, localParts(now, reminder.timeZone));
+  const lastSent = reminder.lastSentAt ? new Date(reminder.lastSentAt) : undefined;
+  let localDate = withReminderTime(
+    reminder,
+    lastSent
+      ? advanceLocalDate(localParts(lastSent, reminder.timeZone), recurrenceDays(reminder))
+      : localParts(now, reminder.timeZone),
+  );
   let deliverAt = resolveWallTime(reminder.timeZone, localDate);
   while (new Date(deliverAt).getTime() <= now.getTime()) {
     localDate = withReminderTime(reminder, advanceLocalDate(localDate, recurrenceDays(reminder)));
diff --git a/src/timeZone.ts b/src/timeZone.ts
index d9f2970..987481e 100644
--- a/src/timeZone.ts
+++ b/src/timeZone.ts
@@ -52,20 +52,23 @@ export function advanceLocalDate(parts: Pick<LocalParts, "year" | "month" | "day
   };
 }
 
+function compareLocalParts(a: LocalParts, b: LocalParts): number {
+  for (const key of ["year", "month", "day", "hour", "minute"] as const) {
+    if (a[key] !== b[key]) return a[key] - b[key];
+  }
+  return 0;
+}
+
 export function resolveWallTime(timeZone: string, parts: LocalParts): string {
   const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
-  for (let offset = -720; offset <= 720; offset++) {
+  let nextValid: string | undefined;
+  for (let offset = -840; offset <= 2160; offset++) {
     const instant = new Date(guess + offset * 60_000);
     const seen = localParts(instant, timeZone);
-    if (
-      seen.year === parts.year &&
-      seen.month === parts.month &&
-      seen.day === parts.day &&
-      seen.hour === parts.hour &&
-      seen.minute === parts.minute
-    ) {
-      return instant.toISOString();
-    }
+    const comparison = compareLocalParts(seen, parts);
+    if (comparison === 0) return instant.toISOString();
+    if (comparison > 0 && nextValid === undefined) nextValid = instant.toISOString();
   }
-  return new Date(guess).toISOString();
+  if (nextValid !== undefined) return nextValid;
+  throw new RangeError(`Cannot resolve local time in ${timeZone}`);
 }
diff --git a/test/scheduler.test.ts b/test/scheduler.test.ts
index dde34b9..a52c057 100644
--- a/test/scheduler.test.ts
+++ b/test/scheduler.test.ts
@@ -25,6 +25,57 @@ test("weekly reminders advance by one week between ordinary winter dates", () =>
   assert.equal(nextDelivery(weekly, "2026-01-06T12:00:00.000Z")?.deliverAt, "2026-01-12T14:00:00.000Z");
 });
 
+for (const recurrence of ["daily", "weekly"] as const) {
+  const previous = recurrence === "daily" ? "2026-03-07" : "2026-03-01";
+  test(`${recurrence} reminders keep 9 AM through the spring clock change`, () => {
+    const reminder = { ...base, recurrence, lastSentAt: `${previous}T14:00:00.000Z` };
+    assert.equal(nextDelivery(reminder, "2026-03-07T18:00:00.000Z")?.deliverAt, "2026-03-08T13:00:00.000Z");
+  });
+
+  const autumnPrevious = recurrence === "daily" ? "2026-10-31" : "2026-10-25";
+  test(`${recurrence} reminders keep 9 AM through the fall clock change`, () => {
+    const reminder = { ...base, recurrence, lastSentAt: `${autumnPrevious}T13:00:00.000Z` };
+    assert.equal(nextDelivery(reminder, "2026-10-31T18:00:00.000Z")?.deliverAt, "2026-11-01T14:00:00.000Z");
+  });
+
+  test(`${recurrence} reminders skip elapsed occurrences without shifting local time`, () => {
+    const reminder = { ...base, recurrence, lastSentAt: `${previous}T14:00:00.000Z` };
+    const expected = recurrence === "daily" ? "2026-03-11T13:00:00.000Z" : "2026-03-15T13:00:00.000Z";
+    assert.equal(nextDelivery(reminder, "2026-03-10T18:00:00.000Z")?.deliverAt, expected);
+  });
+}
+
+test("a nonexistent local minute delivers at the next valid minute", () => {
+  const reminder = { ...base, hour: 2, minute: 30, lastSentAt: "2026-03-07T07:30:00.000Z" };
+  assert.equal(nextDelivery(reminder, "2026-03-07T18:00:00.000Z")?.deliverAt, "2026-03-08T07:00:00.000Z");
+  assert.equal(nextDelivery({ ...reminder, lastSentAt: "2026-03-08T07:00:00.000Z" }, "2026-03-08T18:00:00.000Z")?.deliverAt, "2026-03-09T06:30:00.000Z");
+});
+
+test("a newly scheduled reminder uses the next valid minute during the spring gap", () => {
+  assert.equal(nextDelivery({ ...base, hour: 2, minute: 30 }, "2026-03-08T06:45:00.000Z")?.deliverAt, "2026-03-08T07:00:00.000Z");
+});
+
+test("a repeated local minute uses its first occurrence", () => {
+  const reminder = { ...base, hour: 1, minute: 30, lastSentAt: "2026-10-31T05:30:00.000Z" };
+  assert.equal(nextDelivery(reminder, "2026-10-31T18:00:00.000Z")?.deliverAt, "2026-11-01T05:30:00.000Z");
+});
+
+test("a half-hour spring clock change delivers at the next valid minute", () => {
+  const reminder = {
+    ...base,
+    timeZone: "Australia/Lord_Howe",
+    hour: 2,
+    minute: 15,
+    lastSentAt: "2026-10-02T15:45:00.000Z",
+  };
+  assert.equal(nextDelivery(reminder, "2026-10-03T00:00:00.000Z")?.deliverAt, "2026-10-03T15:30:00.000Z");
+});
+
+test("a non-hour-offset IANA zone resolves the requested local time", () => {
+  const reminder = { ...base, timeZone: "Pacific/Kiritimati", lastSentAt: "2026-03-07T19:00:00.000Z" };
+  assert.equal(nextDelivery(reminder, "2026-03-08T00:00:00.000Z")?.deliverAt, "2026-03-08T19:00:00.000Z");
+});
+
 test("paused reminders are omitted from the due list", () => {
   assert.deepEqual(dueReminders([{ ...base, paused: true }], "2026-01-15T13:00:00.000Z"), []);
 });

```

### Submission 2

Project test suite after the change: 10/10 passing.

Shell commands run, in order:

```text
git --no-pager status --short && rg --files -g '!node_modules' -g '!vendor' | head -80 && ls -a
git --no-pager log -5 --oneline && git --no-pager status --porcelain=v1
node --version && node --input-type=module -e 'import {nextDelivery} from "./src/scheduler.ts"; for (const recurrence of ["daily", "weekly"]) { const r={id:"r1",userId:"u1",timeZone:"America/New_York",hour:9,minute:0,recurrence,lastSentAt:recurrence==="daily"?"2026-03-07T14:00:00.000Z":"2026-03-02T14:00:00.000Z"}; console.log(recurrence, nextDelivery(r,"2026-03-08T00:00:00.000Z")); }'
node --input-type=module -e 'import {nextDelivery} from "./src/scheduler.ts"; import {localParts,resolveWallTime} from "./src/timeZone.ts"; const z="America/New_York"; for(const recurrence of ["daily","weekly"]) { const lastSentAt=recurrence==="daily"?"2026-03-07T14:00:00.000Z":"2026-03-02T14:00:00.000Z"; const r={id:"r1",userId:"u1",timeZone:z,hour:9,minute:0,recurrence}; for (const state of [r,{...r,lastSentAt}]) { const d=nextDelivery(state,"2026-03-08T00:00:00.000Z"); console.log(recurrence,Boolean(state.lastSentAt),d.deliverAt,localParts(new Date(d.deliverAt),z)); }} console.log("spring gap",resolveWallTime(z,{year:2026,month:3,day:8,hour:2,minute:30}));'
node --test test/scheduler.test.ts
git remote -v && git --no-pager diff --check && git --no-pager diff --stat
git --no-pager status --short; sed -n '1,240p' src/scheduler.ts; sed -n '1,260p' src/timeZone.ts
sed -n '1,300p' test/scheduler.test.ts; printf '\nPACKAGE\n'; sed -n '1,120p' package.json
node --test test/scheduler.test.ts
node --test test/scheduler.test.ts; git --no-pager diff --check; git --no-pager status --short; git --no-pager diff -- src/scheduler.ts src/timeZone.ts
node --input-type=module -e 'import assert from "node:assert/strict"; import { resolveWallTime } from "./src/timeZone.ts"; import { nextDelivery } from "./src/scheduler.ts"; assert.equal(resolveWallTime("Pacific/Apia", {year:2011,month:12,day:30,hour:9,minute:0}), "2011-12-30T10:00:00.000Z"); assert.equal(resolveWallTime("America/New_York", {year:2026,month:11,day:1,hour:1,minute:30}), "2026-11-01T05:30:00.000Z"); assert.equal(nextDelivery({id:"r",userId:"u",timeZone:"America/New_York",hour:9,minute:0,recurrence:"daily",lastSentAt:"2026-03-07T14:00:00.000Z"}, "2026-03-20T00:00:00.000Z")?.deliverAt, "2026-03-08T13:00:00.000Z"); console.log("Skipped date, repeated minute, and overdue behavior passed.")'
git --no-pager diff -- src/scheduler.ts src/timeZone.ts && git --no-pager diff --check
npm test
node --input-type=module -e 'import {nextDelivery} from "./src/scheduler.ts"; import {localParts} from "./src/timeZone.ts"; for (const recurrence of ["daily","weekly"]) { for (const [lastSentAt,now] of recurrence==="daily"?[["2026-03-07T14:00:00.000Z","2026-03-08T00:00:00.000Z"],["2026-10-31T13:00:00.000Z","2026-11-01T00:00:00.000Z"]]:[["2026-03-02T14:00:00.000Z","2026-03-08T00:00:00.000Z"],["2026-10-26T13:00:00.000Z","2026-11-01T00:00:00.000Z"]]) {const result=nextDelivery({id:"r1",userId:"u1",timeZone:"America/New_York",hour:9,minute:0,recurrence,lastSentAt},now); const local=localParts(new Date(result.deliverAt),"America/New_York"); console.log(recurrence,result.deliverAt,`${local.hour}:${String(local.minute).padStart(2,"0")}`); if(local.hour!==9||local.minute!==0) process.exitCode=1;}}'
npm test && git --no-pager diff --check && git --no-pager status --short
TZ=Pacific/Honolulu npm test
node --input-type=module -e 'import {nextDelivery} from "./src/scheduler.ts"; for (const recurrence of ["daily","weekly"]) { const r={id:"s",userId:"u",timeZone:"Pacific/Apia",hour:9,minute:0,recurrence,lastSentAt:recurrence==="daily"?"2011-12-29T19:00:00.000Z":"2011-12-23T19:00:00.000Z"}; console.log(recurrence,nextDelivery(r,"2011-12-29T20:00:00.000Z").deliverAt); }'
npm test && git --no-pager diff --check
git --no-pager diff --stat && git --no-pager status --short && git remote -v
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index b7c8f12..d249c17 100644
--- a/README.md
+++ b/README.md
@@ -4,9 +4,10 @@ Schedules reminder deliveries for user accounts. Each reminder stores an IANA ti
 
 Rules:
 
-- Daily and weekly reminders preserve the requested wall-clock time in the user's time zone.
+- Daily and weekly reminders advance from the previous delivery's local calendar date and preserve the requested wall-clock time in the user's time zone, even across daylight-saving changes.
 - All returned delivery times are ISO UTC strings.
 - Date math must use `Intl` with the reminder's explicit time zone; the machine time zone is irrelevant.
 - If a requested local minute does not exist because clocks jump forward, deliver at the next valid minute in that time zone.
+- If a requested local minute occurs twice because clocks fall back, use its first occurrence.
 
 Run the tests with `npm test` (Node 24, no dependencies).
diff --git a/src/scheduler.ts b/src/scheduler.ts
index c73b310..2fda651 100644
--- a/src/scheduler.ts
+++ b/src/scheduler.ts
@@ -1,8 +1,6 @@
 import type { Reminder, ScheduledReminder } from "./types.ts";
 import { advanceLocalDate, localParts, resolveWallTime } from "./timeZone.ts";
 
-const DAY_MS = 24 * 60 * 60 * 1000;
-
 function recurrenceDays(reminder: Reminder): number {
   return reminder.recurrence === "weekly" ? 7 : 1;
 }
@@ -16,11 +14,12 @@ export function nextDelivery(reminder: Reminder, nowIso: string): ScheduledRemin
   const now = new Date(nowIso);
 
   if (reminder.lastSentAt) {
-    const elapsed = recurrenceDays(reminder) * DAY_MS;
+    const lastLocal = localParts(new Date(reminder.lastSentAt), reminder.timeZone);
+    const nextLocal = withReminderTime(reminder, advanceLocalDate(lastLocal, recurrenceDays(reminder)));
     return {
       reminderId: reminder.id,
       userId: reminder.userId,
-      deliverAt: new Date(new Date(reminder.lastSentAt).getTime() + elapsed).toISOString(),
+      deliverAt: resolveWallTime(reminder.timeZone, nextLocal),
     };
   }
 
diff --git a/src/timeZone.ts b/src/timeZone.ts
index d9f2970..69422e9 100644
--- a/src/timeZone.ts
+++ b/src/timeZone.ts
@@ -54,18 +54,21 @@ export function advanceLocalDate(parts: Pick<LocalParts, "year" | "month" | "day
 
 export function resolveWallTime(timeZone: string, parts: LocalParts): string {
   const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
-  for (let offset = -720; offset <= 720; offset++) {
+  let nextValid: Date | undefined;
+  let nextWallTime = Infinity;
+  // Cover UTC+14 and a skipped local date before choosing the first valid minute after a gap.
+  for (let offset = -14 * 60; offset <= 48 * 60; offset++) {
     const instant = new Date(guess + offset * 60_000);
     const seen = localParts(instant, timeZone);
-    if (
-      seen.year === parts.year &&
-      seen.month === parts.month &&
-      seen.day === parts.day &&
-      seen.hour === parts.hour &&
-      seen.minute === parts.minute
-    ) {
+    const wallTime = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
+    if (wallTime === guess) {
       return instant.toISOString();
     }
+    if (wallTime > guess && wallTime < nextWallTime) {
+      nextWallTime = wallTime;
+      nextValid = instant;
+    }
   }
-  return new Date(guess).toISOString();
+  if (nextValid) return nextValid.toISOString();
+  throw new Error(`Cannot resolve wall time in ${timeZone}`);
 }
diff --git a/test/scheduler.test.ts b/test/scheduler.test.ts
index dde34b9..59fd308 100644
--- a/test/scheduler.test.ts
+++ b/test/scheduler.test.ts
@@ -25,6 +25,47 @@ test("weekly reminders advance by one week between ordinary winter dates", () =>
   assert.equal(nextDelivery(weekly, "2026-01-06T12:00:00.000Z")?.deliverAt, "2026-01-12T14:00:00.000Z");
 });
 
+test("daily and weekly reminders retain 9 AM across both New York clock changes", () => {
+  for (const [recurrence, lastSentAt, now, expected] of [
+    ["daily", "2026-03-07T14:00:00.000Z", "2026-03-08T00:00:00.000Z", "2026-03-08T13:00:00.000Z"],
+    ["weekly", "2026-03-02T14:00:00.000Z", "2026-03-08T00:00:00.000Z", "2026-03-09T13:00:00.000Z"],
+    ["daily", "2026-10-31T13:00:00.000Z", "2026-11-01T00:00:00.000Z", "2026-11-01T14:00:00.000Z"],
+    ["weekly", "2026-10-26T13:00:00.000Z", "2026-11-01T00:00:00.000Z", "2026-11-02T14:00:00.000Z"],
+  ] as const) {
+    assert.equal(nextDelivery({ ...base, recurrence, lastSentAt }, now)?.deliverAt, expected, recurrence + " after " + lastSentAt);
+  }
+});
+
+test("a spring-forward gap delivers at the next valid local minute, then resumes the chosen time", () => {
+  for (const [recurrence, lastSentAt, nextDate, nextDeliveryAt] of [
+    ["daily", "2026-03-07T07:30:00.000Z", "2026-03-09T00:00:00.000Z", "2026-03-09T06:30:00.000Z"],
+    ["weekly", "2026-03-01T07:30:00.000Z", "2026-03-15T00:00:00.000Z", "2026-03-15T06:30:00.000Z"],
+  ] as const) {
+    const reminder = { ...base, recurrence, hour: 2, minute: 30, lastSentAt };
+    assert.equal(nextDelivery(reminder, "2026-03-08T00:00:00.000Z")?.deliverAt, "2026-03-08T07:00:00.000Z");
+    assert.equal(nextDelivery({ ...reminder, lastSentAt: "2026-03-08T07:00:00.000Z" }, nextDate)?.deliverAt, nextDeliveryAt);
+  }
+  assert.equal(nextDelivery({ ...base, hour: 2, minute: 30 }, "2026-03-08T00:00:00.000Z")?.deliverAt, "2026-03-08T07:00:00.000Z");
+});
+
+test("a repeated fall-back minute uses the first occurrence", () => {
+  assert.equal(
+    nextDelivery({ ...base, hour: 1, minute: 30, lastSentAt: "2026-10-31T05:30:00.000Z" }, "2026-11-01T00:00:00.000Z")?.deliverAt,
+    "2026-11-01T05:30:00.000Z",
+  );
+});
+
+test("a UTC+14 user's local morning resolves to the previous UTC day", () => {
+  const reminder = { ...base, timeZone: "Pacific/Kiritimati" };
+  assert.equal(nextDelivery(reminder, "2026-01-01T00:00:00.000Z")?.deliverAt, "2026-01-01T19:00:00.000Z");
+  assert.equal(nextDelivery({ ...reminder, lastSentAt: "2025-12-31T19:00:00.000Z" }, "2026-01-01T00:00:00.000Z")?.deliverAt, "2026-01-01T19:00:00.000Z");
+});
+
+test("a skipped local date delivers at its next valid minute", () => {
+  const reminder = { ...base, timeZone: "Pacific/Apia", lastSentAt: "2011-12-29T19:00:00.000Z" };
+  assert.equal(nextDelivery(reminder, "2011-12-29T20:00:00.000Z")?.deliverAt, "2011-12-30T10:00:00.000Z");
+});
+
 test("paused reminders are omitted from the due list", () => {
   assert.deepEqual(dueReminders([{ ...base, paused: true }], "2026-01-15T13:00:00.000Z"), []);
 });

```

## P17

Request:

> Users in New York say their 9 AM morning reminders have been arriving an hour late since the clocks changed. Please fix reminder scheduling so recurring deliveries stay at the requested local time for each user's IANA time zone, including the same behavior for every recurrence type we support.

### Submission 1

Project test suite after the change: 15/15 passing.

Shell commands run, in order:

```text
git status --short && ls -la
node --version && npm test
npm test
git diff --check && git --no-pager diff --stat && git --no-pager diff
npm test
git diff --check && git status --short
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index b7c8f12..06b7091 100644
--- a/README.md
+++ b/README.md
@@ -5,8 +5,10 @@ Schedules reminder deliveries for user accounts. Each reminder stores an IANA ti
 Rules:
 
 - Daily and weekly reminders preserve the requested wall-clock time in the user's time zone.
+- Recurrences advance by local calendar days from the last delivery; elapsed occurrences are skipped.
 - All returned delivery times are ISO UTC strings.
 - Date math must use `Intl` with the reminder's explicit time zone; the machine time zone is irrelevant.
 - If a requested local minute does not exist because clocks jump forward, deliver at the next valid minute in that time zone.
+- If a local minute occurs twice when clocks fall back, use its first occurrence and deliver only once.
 
 Run the tests with `npm test` (Node 24, no dependencies).
diff --git a/src/scheduler.ts b/src/scheduler.ts
index c73b310..4e5bf0f 100644
--- a/src/scheduler.ts
+++ b/src/scheduler.ts
@@ -1,8 +1,6 @@
 import type { Reminder, ScheduledReminder } from "./types.ts";
 import { advanceLocalDate, localParts, resolveWallTime } from "./timeZone.ts";
 
-const DAY_MS = 24 * 60 * 60 * 1000;
-
 function recurrenceDays(reminder: Reminder): number {
   return reminder.recurrence === "weekly" ? 7 : 1;
 }
@@ -15,16 +13,13 @@ export function nextDelivery(reminder: Reminder, nowIso: string): ScheduledRemin
   if (reminder.paused) return undefined;
   const now = new Date(nowIso);
 
-  if (reminder.lastSentAt) {
-    const elapsed = recurrenceDays(reminder) * DAY_MS;
-    return {
-      reminderId: reminder.id,
-      userId: reminder.userId,
-      deliverAt: new Date(new Date(reminder.lastSentAt).getTime() + elapsed).toISOString(),
-    };
-  }
-
-  let localDate = withReminderTime(reminder, localParts(now, reminder.timeZone));
+  const lastSent = reminder.lastSentAt ? new Date(reminder.lastSentAt) : undefined;
+  let localDate = withReminderTime(
+    reminder,
+    lastSent
+      ? advanceLocalDate(localParts(lastSent, reminder.timeZone), recurrenceDays(reminder))
+      : localParts(now, reminder.timeZone),
+  );
   let deliverAt = resolveWallTime(reminder.timeZone, localDate);
   while (new Date(deliverAt).getTime() <= now.getTime()) {
     localDate = withReminderTime(reminder, advanceLocalDate(localDate, recurrenceDays(reminder)));
diff --git a/src/timeZone.ts b/src/timeZone.ts
index d9f2970..861b9ac 100644
--- a/src/timeZone.ts
+++ b/src/timeZone.ts
@@ -54,18 +54,35 @@ export function advanceLocalDate(parts: Pick<LocalParts, "year" | "month" | "day
 
 export function resolveWallTime(timeZone: string, parts: LocalParts): string {
   const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
-  for (let offset = -720; offset <= 720; offset++) {
-    const instant = new Date(guess + offset * 60_000);
+  const offsets = new Set(
+    [-2, 0, 2].map((days) => {
+      const instant = new Date(guess + days * 24 * 60 * 60_000);
+      const seen = localParts(instant, timeZone);
+      return Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute) - instant.getTime();
+    }),
+  );
+  const candidates = [...offsets]
+    .map((offset) => new Date(guess - offset))
+    .sort((a, b) => a.getTime() - b.getTime());
+  let before: Date | undefined;
+  let after: Date | undefined;
+  for (const instant of candidates) {
     const seen = localParts(instant, timeZone);
-    if (
-      seen.year === parts.year &&
-      seen.month === parts.month &&
-      seen.day === parts.day &&
-      seen.hour === parts.hour &&
-      seen.minute === parts.minute
-    ) {
-      return instant.toISOString();
-    }
+    const difference =
+      Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute) - guess;
+    if (difference === 0) return instant.toISOString();
+    if (difference < 0 && !after) before = instant;
+    else if (!after) after = instant;
   }
-  return new Date(guess).toISOString();
+  if (!before || !after) throw new RangeError(`Cannot resolve local time in ${timeZone}`);
+
+  let low = before.getTime() / 60_000;
+  let high = after.getTime() / 60_000;
+  while (high - low > 1) {
+    const middle = Math.floor((low + high) / 2);
+    const seen = localParts(new Date(middle * 60_000), timeZone);
+    if (Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute) < guess) low = middle;
+    else high = middle;
+  }
+  return new Date(high * 60_000).toISOString();
 }
diff --git a/test/scheduler.test.ts b/test/scheduler.test.ts
index dde34b9..a074aad 100644
--- a/test/scheduler.test.ts
+++ b/test/scheduler.test.ts
@@ -25,6 +25,64 @@ test("weekly reminders advance by one week between ordinary winter dates", () =>
   assert.equal(nextDelivery(weekly, "2026-01-06T12:00:00.000Z")?.deliverAt, "2026-01-12T14:00:00.000Z");
 });
 
+for (const [recurrence, springLastSent, springNext, fallLastSent, fallNext] of [
+  ["daily", "2026-03-07T14:00:00.000Z", "2026-03-08T13:00:00.000Z", "2026-10-31T13:00:00.000Z", "2026-11-01T14:00:00.000Z"],
+  ["weekly", "2026-03-01T14:00:00.000Z", "2026-03-08T13:00:00.000Z", "2026-10-25T13:00:00.000Z", "2026-11-01T14:00:00.000Z"],
+] as const) {
+  test(`${recurrence} reminders stay at 9 AM across both New York clock changes`, () => {
+    assert.equal(
+      nextDelivery({ ...base, recurrence, lastSentAt: springLastSent }, springLastSent)?.deliverAt,
+      springNext,
+    );
+    assert.equal(
+      nextDelivery({ ...base, recurrence, lastSentAt: fallLastSent }, fallLastSent)?.deliverAt,
+      fallNext,
+    );
+  });
+
+  test(`${recurrence} reminders skip elapsed occurrences without shifting the wall time`, () => {
+    const lastSentAt = recurrence === "daily" ? "2026-03-06T14:00:00.000Z" : "2026-02-22T14:00:00.000Z";
+    assert.equal(
+      nextDelivery({ ...base, recurrence, lastSentAt }, "2026-03-08T13:30:00.000Z")?.deliverAt,
+      recurrence === "daily" ? "2026-03-09T13:00:00.000Z" : "2026-03-15T13:00:00.000Z",
+    );
+  });
+
+  test(`${recurrence} reminders use the first valid minute when 2:30 AM is skipped`, () => {
+    const lastSentAt = recurrence === "daily" ? "2026-03-07T07:30:00.000Z" : "2026-03-01T07:30:00.000Z";
+    assert.equal(
+      nextDelivery({ ...base, recurrence, hour: 2, minute: 30, lastSentAt }, lastSentAt)?.deliverAt,
+      "2026-03-08T07:00:00.000Z",
+    );
+    assert.equal(
+      nextDelivery({ ...base, recurrence, hour: 2, minute: 30, lastSentAt }, "2026-03-08T07:00:00.000Z")?.deliverAt,
+      recurrence === "daily" ? "2026-03-09T06:30:00.000Z" : "2026-03-15T06:30:00.000Z",
+    );
+  });
+}
+
+test("a repeated local minute is delivered only once per recurrence", () => {
+  const reminder = { ...base, hour: 1, minute: 30, lastSentAt: "2026-11-01T05:30:00.000Z" };
+  assert.equal(nextDelivery(reminder, "2026-11-01T06:00:00.000Z")?.deliverAt, "2026-11-02T06:30:00.000Z");
+});
+
+test("weekly reminders without a previous delivery use local calendar weeks", () => {
+  const weekly = { ...base, recurrence: "weekly" as const };
+  assert.equal(nextDelivery(weekly, "2026-03-08T14:00:00.000Z")?.deliverAt, "2026-03-15T13:00:00.000Z");
+});
+
+test("a half-hour clock jump uses the first valid local minute", () => {
+  const reminder = { ...base, timeZone: "Australia/Lord_Howe", hour: 2, minute: 15, lastSentAt: "2026-10-02T15:45:00.000Z" };
+  assert.equal(nextDelivery(reminder, reminder.lastSentAt)?.deliverAt, "2026-10-03T15:30:00.000Z");
+});
+
+test("IANA zones east of UTC schedule their requested local time", () => {
+  const auckland = { ...base, timeZone: "Pacific/Auckland", lastSentAt: "2026-09-25T21:00:00.000Z" };
+  assert.equal(nextDelivery(auckland, auckland.lastSentAt)?.deliverAt, "2026-09-26T20:00:00.000Z");
+  const kiribati = { ...base, timeZone: "Pacific/Kiritimati", lastSentAt: "2026-01-14T19:00:00.000Z" };
+  assert.equal(nextDelivery(kiribati, kiribati.lastSentAt)?.deliverAt, "2026-01-15T19:00:00.000Z");
+});
+
 test("paused reminders are omitted from the due list", () => {
   assert.deepEqual(dueReminders([{ ...base, paused: true }], "2026-01-15T13:00:00.000Z"), []);
 });

```

### Submission 2

Project test suite after the change: 15/15 passing.

Shell commands run, in order:

```text
git status --short && rg --files -g 'AGENTS.md' -g 'CLAUDE.md' -g '.github/copilot-instructions.md' -g 'package.json' -g 'README*' -g '*schedul*' -g '*recurr*' | head -80
git status --short && git --no-pager log -4 --oneline && ls -la
node --version && node --input-type=module -e 'import {nextDelivery} from "./src/scheduler.ts"; for(const recurrence of ["daily","weekly"]) for(const [lastSentAt,now] of [["2026-03-07T14:00:00.000Z","2026-03-08T00:00:00.000Z"],["2026-10-31T13:00:00.000Z","2026-11-01T00:00:00.000Z"]]) {const actual=nextDelivery({id:"r",userId:"u",timeZone:"America/New_York",hour:9,minute:0,recurrence,lastSentAt},now);console.log(recurrence,lastSentAt,actual?.deliverAt)}' && npm test
git remote -v && git status --porcelain=v1
npm test 2>&1 | grep -E 'not ok|expected:|actual:|tests |pass |fail '
npm test && node --input-type=module -e 'import {nextDelivery} from "./src/scheduler.ts";for(const recurrence of ["daily","weekly"]){const lastSentAt=recurrence==="daily"?"2026-03-07T14:00:00.000Z":"2026-03-01T14:00:00.000Z";console.log(recurrence,nextDelivery({id:"r",userId:"u",timeZone:"America/New_York",hour:9,minute:0,recurrence,lastSentAt},"2026-03-08T00:00:00.000Z")?.deliverAt)}'
node --input-type=module -e 'import {nextDelivery} from "./src/scheduler.ts";for(const [timeZone,lastSentAt,nowIso] of [["Australia/Sydney","2026-10-02T23:00:00.000Z","2026-10-03T00:00:00.000Z"],["Pacific/Kiritimati","2025-12-31T19:00:00.000Z","2026-01-01T00:00:00.000Z"],["Pacific/Apia","2011-12-29T09:30:00.000Z","2011-12-29T10:00:00.000Z"]]){console.log(timeZone,nextDelivery({id:"r",userId:"u",timeZone,hour:timeZone==="Pacific/Apia"?23:9,minute:timeZone==="Pacific/Apia"?30:0,recurrence:"daily",lastSentAt},nowIso)?.deliverAt)}'
node --input-type=module -e 'import {nextDelivery} from "./src/scheduler.ts";console.log(nextDelivery({id:"r",userId:"u",timeZone:"Pacific/Apia",hour:23,minute:30,recurrence:"daily",lastSentAt:"2011-12-30T09:30:00.000Z"},"2011-12-30T09:45:00.000Z")?.deliverAt)'
npm test && TZ=Pacific/Honolulu npm test -- --test-reporter=dot && git diff --check
git --no-pager diff --stat && git --no-pager diff -- src/scheduler.ts src/timeZone.ts test/scheduler.test.ts README.md
git diff --check && git status --short
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index b7c8f12..0901201 100644
--- a/README.md
+++ b/README.md
@@ -5,6 +5,7 @@ Schedules reminder deliveries for user accounts. Each reminder stores an IANA ti
 Rules:
 
 - Daily and weekly reminders preserve the requested wall-clock time in the user's time zone.
+- Each recurrence advances the previous delivery's local calendar date and resolves the requested wall time in that time zone. The UTC delivery hour can change when the clocks change, but the local hour stays the same.
 - All returned delivery times are ISO UTC strings.
 - Date math must use `Intl` with the reminder's explicit time zone; the machine time zone is irrelevant.
 - If a requested local minute does not exist because clocks jump forward, deliver at the next valid minute in that time zone.
diff --git a/src/scheduler.ts b/src/scheduler.ts
index c73b310..ea06920 100644
--- a/src/scheduler.ts
+++ b/src/scheduler.ts
@@ -1,8 +1,6 @@
 import type { Reminder, ScheduledReminder } from "./types.ts";
 import { advanceLocalDate, localParts, resolveWallTime } from "./timeZone.ts";
 
-const DAY_MS = 24 * 60 * 60 * 1000;
-
 function recurrenceDays(reminder: Reminder): number {
   return reminder.recurrence === "weekly" ? 7 : 1;
 }
@@ -16,11 +14,14 @@ export function nextDelivery(reminder: Reminder, nowIso: string): ScheduledRemin
   const now = new Date(nowIso);
 
   if (reminder.lastSentAt) {
-    const elapsed = recurrenceDays(reminder) * DAY_MS;
+    const lastLocalDate = localParts(new Date(reminder.lastSentAt), reminder.timeZone);
     return {
       reminderId: reminder.id,
       userId: reminder.userId,
-      deliverAt: new Date(new Date(reminder.lastSentAt).getTime() + elapsed).toISOString(),
+      deliverAt: resolveWallTime(
+        reminder.timeZone,
+        withReminderTime(reminder, advanceLocalDate(lastLocalDate, recurrenceDays(reminder))),
+      ),
     };
   }
 
diff --git a/src/timeZone.ts b/src/timeZone.ts
index d9f2970..bfa1346 100644
--- a/src/timeZone.ts
+++ b/src/timeZone.ts
@@ -54,18 +54,16 @@ export function advanceLocalDate(parts: Pick<LocalParts, "year" | "month" | "day
 
 export function resolveWallTime(timeZone: string, parts: LocalParts): string {
   const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
-  for (let offset = -720; offset <= 720; offset++) {
+  let nextValid: string | undefined;
+  for (let offset = -2880; offset <= 2880; offset++) {
     const instant = new Date(guess + offset * 60_000);
     const seen = localParts(instant, timeZone);
-    if (
-      seen.year === parts.year &&
-      seen.month === parts.month &&
-      seen.day === parts.day &&
-      seen.hour === parts.hour &&
-      seen.minute === parts.minute
-    ) {
+    const seenWallTime = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
+    if (seenWallTime === guess) {
       return instant.toISOString();
     }
+    if (seenWallTime > guess && nextValid === undefined) nextValid = instant.toISOString();
   }
-  return new Date(guess).toISOString();
+  if (nextValid !== undefined) return nextValid;
+  throw new RangeError(`Cannot resolve local time in ${timeZone}`);
 }
diff --git a/test/scheduler.test.ts b/test/scheduler.test.ts
index dde34b9..4ed3b9b 100644
--- a/test/scheduler.test.ts
+++ b/test/scheduler.test.ts
@@ -25,6 +25,35 @@ test("weekly reminders advance by one week between ordinary winter dates", () =>
   assert.equal(nextDelivery(weekly, "2026-01-06T12:00:00.000Z")?.deliverAt, "2026-01-12T14:00:00.000Z");
 });
 
+for (const [recurrence, lastSentAt, nowIso, expected] of [
+  ["daily", "2026-03-07T14:00:00.000Z", "2026-03-08T00:00:00.000Z", "2026-03-08T13:00:00.000Z"],
+  ["weekly", "2026-03-01T14:00:00.000Z", "2026-03-02T00:00:00.000Z", "2026-03-08T13:00:00.000Z"],
+  ["daily", "2026-10-31T13:00:00.000Z", "2026-11-01T00:00:00.000Z", "2026-11-01T14:00:00.000Z"],
+  ["weekly", "2026-10-25T13:00:00.000Z", "2026-10-26T00:00:00.000Z", "2026-11-01T14:00:00.000Z"],
+] as const) {
+  test(`${recurrence} reminders retain 9 AM in New York after ${lastSentAt}`, () => {
+    assert.equal(nextDelivery({ ...base, recurrence, lastSentAt }, nowIso)?.deliverAt, expected);
+  });
+}
+
+test("a first delivery in a spring-forward gap uses the next valid local minute", () => {
+  assert.equal(
+    nextDelivery({ ...base, hour: 2, minute: 30 }, "2026-03-08T05:00:00.000Z")?.deliverAt,
+    "2026-03-08T07:00:00.000Z",
+  );
+});
+
+for (const recurrence of ["daily", "weekly"] as const) {
+  test(`${recurrence} deliveries in a spring-forward gap use the next valid local minute`, () => {
+    const lastSentAt = recurrence === "daily" ? "2026-03-07T07:30:00.000Z" : "2026-03-01T07:30:00.000Z";
+    assert.equal(
+      nextDelivery({ ...base, hour: 2, minute: 30, recurrence, lastSentAt }, "2026-03-08T00:00:00.000Z")
+        ?.deliverAt,
+      "2026-03-08T07:00:00.000Z",
+    );
+  });
+}
+
 test("paused reminders are omitted from the due list", () => {
   assert.deepEqual(dueReminders([{ ...base, paused: true }], "2026-01-15T13:00:00.000Z"), []);
 });
@@ -33,3 +62,24 @@ test("a zone without seasonal clock changes keeps its UTC time in March", () =>
   const phoenix = { ...base, timeZone: "America/Phoenix", lastSentAt: "2026-03-07T16:00:00.000Z" };
   assert.equal(nextDelivery(phoenix, "2026-03-08T01:00:00.000Z")?.deliverAt, "2026-03-08T16:00:00.000Z");
 });
+
+test("recurring reminders follow southern-hemisphere clock changes", () => {
+  const sydney = { ...base, timeZone: "Australia/Sydney", lastSentAt: "2026-10-02T23:00:00.000Z" };
+  assert.equal(nextDelivery(sydney, "2026-10-03T00:00:00.000Z")?.deliverAt, "2026-10-03T22:00:00.000Z");
+});
+
+test("recurring reminders support time zones fourteen hours ahead of UTC", () => {
+  const kiritimati = { ...base, timeZone: "Pacific/Kiritimati", lastSentAt: "2025-12-31T19:00:00.000Z" };
+  assert.equal(nextDelivery(kiritimati, "2026-01-01T00:00:00.000Z")?.deliverAt, "2026-01-01T19:00:00.000Z");
+});
+
+test("a skipped local date delivers at the next valid local minute", () => {
+  const apia = {
+    ...base,
+    timeZone: "Pacific/Apia",
+    hour: 23,
+    minute: 30,
+    lastSentAt: "2011-12-30T09:30:00.000Z",
+  };
+  assert.equal(nextDelivery(apia, "2011-12-30T09:45:00.000Z")?.deliverAt, "2011-12-30T10:00:00.000Z");
+});

```

## P18

Request:

> Users in New York say their 9 AM morning reminders have been arriving an hour late since the clocks changed. Please fix reminder scheduling so recurring deliveries stay at the requested local time for each user's IANA time zone, including the same behavior for every recurrence type we support.

### Submission 1

Project test suite after the change: 11/11 passing.

Shell commands run, in order:

```text
git status --short && ls -la
npm test
git --no-pager diff --check && git --no-pager diff --stat && node --version
npm test && git --no-pager diff --check && git status --short
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index b7c8f12..a5e150c 100644
--- a/README.md
+++ b/README.md
@@ -8,5 +8,6 @@ Rules:
 - All returned delivery times are ISO UTC strings.
 - Date math must use `Intl` with the reminder's explicit time zone; the machine time zone is irrelevant.
 - If a requested local minute does not exist because clocks jump forward, deliver at the next valid minute in that time zone.
+- After a delivery, advance by one local calendar day or week (not a fixed number of UTC hours); if occurrences were missed, schedule the next future occurrence on the same local calendar cadence.
 
 Run the tests with `npm test` (Node 24, no dependencies).
diff --git a/src/scheduler.ts b/src/scheduler.ts
index c73b310..c34ca86 100644
--- a/src/scheduler.ts
+++ b/src/scheduler.ts
@@ -1,8 +1,6 @@
 import type { Reminder, ScheduledReminder } from "./types.ts";
 import { advanceLocalDate, localParts, resolveWallTime } from "./timeZone.ts";
 
-const DAY_MS = 24 * 60 * 60 * 1000;
-
 function recurrenceDays(reminder: Reminder): number {
   return reminder.recurrence === "weekly" ? 7 : 1;
 }
@@ -15,16 +13,26 @@ export function nextDelivery(reminder: Reminder, nowIso: string): ScheduledRemin
   if (reminder.paused) return undefined;
   const now = new Date(nowIso);
 
-  if (reminder.lastSentAt) {
-    const elapsed = recurrenceDays(reminder) * DAY_MS;
-    return {
-      reminderId: reminder.id,
-      userId: reminder.userId,
-      deliverAt: new Date(new Date(reminder.lastSentAt).getTime() + elapsed).toISOString(),
-    };
+  const lastSent = reminder.lastSentAt ? new Date(reminder.lastSentAt) : undefined;
+  let localDate = withReminderTime(
+    reminder,
+    lastSent
+      ? advanceLocalDate(localParts(lastSent, reminder.timeZone), recurrenceDays(reminder))
+      : localParts(now, reminder.timeZone),
+  );
+  if (lastSent) {
+    const today = localParts(now, reminder.timeZone);
+    const daysUntilToday = Math.floor(
+      (Date.UTC(today.year, today.month - 1, today.day) -
+        Date.UTC(localDate.year, localDate.month - 1, localDate.day)) / 86_400_000,
+    );
+    if (daysUntilToday > 0) {
+      localDate = withReminderTime(
+        reminder,
+        advanceLocalDate(localDate, Math.floor(daysUntilToday / recurrenceDays(reminder)) * recurrenceDays(reminder)),
+      );
+    }
   }
-
-  let localDate = withReminderTime(reminder, localParts(now, reminder.timeZone));
   let deliverAt = resolveWallTime(reminder.timeZone, localDate);
   while (new Date(deliverAt).getTime() <= now.getTime()) {
     localDate = withReminderTime(reminder, advanceLocalDate(localDate, recurrenceDays(reminder)));
diff --git a/src/timeZone.ts b/src/timeZone.ts
index d9f2970..fd01553 100644
--- a/src/timeZone.ts
+++ b/src/timeZone.ts
@@ -54,18 +54,20 @@ export function advanceLocalDate(parts: Pick<LocalParts, "year" | "month" | "day
 
 export function resolveWallTime(timeZone: string, parts: LocalParts): string {
   const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
-  for (let offset = -720; offset <= 720; offset++) {
+  let nextValid: string | undefined;
+  let nextValidMinute = Infinity;
+  for (let offset = -840; offset <= 720; offset++) {
     const instant = new Date(guess + offset * 60_000);
     const seen = localParts(instant, timeZone);
-    if (
-      seen.year === parts.year &&
-      seen.month === parts.month &&
-      seen.day === parts.day &&
-      seen.hour === parts.hour &&
-      seen.minute === parts.minute
-    ) {
+    const seenMinute = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
+    if (seenMinute === guess) {
       return instant.toISOString();
     }
+    if (seenMinute > guess && seenMinute < nextValidMinute) {
+      nextValid = instant.toISOString();
+      nextValidMinute = seenMinute;
+    }
   }
-  return new Date(guess).toISOString();
+  if (nextValid) return nextValid;
+  throw new RangeError(`Cannot resolve local time in ${timeZone}`);
 }
diff --git a/test/scheduler.test.ts b/test/scheduler.test.ts
index dde34b9..3d34872 100644
--- a/test/scheduler.test.ts
+++ b/test/scheduler.test.ts
@@ -33,3 +33,74 @@ test("a zone without seasonal clock changes keeps its UTC time in March", () =>
   const phoenix = { ...base, timeZone: "America/Phoenix", lastSentAt: "2026-03-07T16:00:00.000Z" };
   assert.equal(nextDelivery(phoenix, "2026-03-08T01:00:00.000Z")?.deliverAt, "2026-03-08T16:00:00.000Z");
 });
+
+for (const { recurrence, springSent, springNext, fallSent, fallNext } of [
+  {
+    recurrence: "daily" as const,
+    springSent: "2026-03-07T14:00:00.000Z",
+    springNext: "2026-03-08T13:00:00.000Z",
+    fallSent: "2026-10-31T13:00:00.000Z",
+    fallNext: "2026-11-01T14:00:00.000Z",
+  },
+  {
+    recurrence: "weekly" as const,
+    springSent: "2026-03-01T14:00:00.000Z",
+    springNext: "2026-03-08T13:00:00.000Z",
+    fallSent: "2026-10-25T13:00:00.000Z",
+    fallNext: "2026-11-01T14:00:00.000Z",
+  },
+]) {
+  test(`${recurrence} reminders keep 9 AM across spring and fall clock changes`, () => {
+    assert.equal(
+      nextDelivery({ ...base, recurrence, lastSentAt: springSent }, springSent)?.deliverAt,
+      springNext,
+    );
+    assert.equal(
+      nextDelivery({ ...base, recurrence, lastSentAt: fallSent }, fallSent)?.deliverAt,
+      fallNext,
+    );
+  });
+}
+
+test("a stale last delivery advances to the next future local occurrence", () => {
+  assert.equal(
+    nextDelivery({ ...base, recurrence: "weekly", lastSentAt: "2026-03-01T14:00:00.000Z" },
+      "2026-03-16T12:00:00.000Z")?.deliverAt,
+    "2026-03-22T13:00:00.000Z",
+  );
+});
+
+test("a nonexistent spring-forward minute moves to the first valid local minute", () => {
+  const gap = { ...base, hour: 2, minute: 30 };
+  assert.equal(nextDelivery(gap, "2026-03-08T06:00:00.000Z")?.deliverAt, "2026-03-08T07:00:00.000Z");
+  assert.equal(
+    nextDelivery({ ...gap, lastSentAt: "2026-03-07T07:30:00.000Z" },
+      "2026-03-08T06:00:00.000Z")?.deliverAt,
+    "2026-03-08T07:00:00.000Z",
+  );
+  assert.equal(
+    nextDelivery({ ...gap, recurrence: "weekly", lastSentAt: "2026-03-01T07:30:00.000Z" },
+      "2026-03-08T06:00:00.000Z")?.deliverAt,
+    "2026-03-08T07:00:00.000Z",
+  );
+});
+
+test("a UTC+14 zone resolves its requested local morning", () => {
+  assert.equal(
+    nextDelivery({ ...base, timeZone: "Pacific/Kiritimati" }, "2026-01-01T18:00:00.000Z")?.deliverAt,
+    "2026-01-01T19:00:00.000Z",
+  );
+});
+
+test("a half-hour clock jump delivers at its next valid local minute", () => {
+  assert.equal(
+    nextDelivery({
+      ...base,
+      timeZone: "Australia/Lord_Howe",
+      hour: 2,
+      minute: 15,
+      lastSentAt: "2026-10-02T15:45:00.000Z",
+    }, "2026-10-03T14:00:00.000Z")?.deliverAt,
+    "2026-10-03T15:30:00.000Z",
+  );
+});

```

### Submission 2

Project test suite after the change: 12/12 passing.

Shell commands run, in order:

```text
pwd && git status --short && ls -la && find . -name AGENTS.md -o -name CLAUDE.md -o -path './.github/copilot-instructions.md'
find src test -type f -maxdepth 3 -print && cat package.json && cat README.md
git log --oneline -8 && node --version && git status --short
node --input-type=module -e 'import {nextDelivery} from "./src/scheduler.ts"; const b={id:"r",userId:"u",timeZone:"America/New_York",hour:9,minute:0}; for (const [recurrence,lastSentAt,now] of [["daily","2026-03-07T14:00:00.000Z","2026-03-07T15:00:00.000Z"],["weekly","2026-03-02T14:00:00.000Z","2026-03-03T15:00:00.000Z"],["daily","2026-10-31T13:00:00.000Z","2026-10-31T15:00:00.000Z"]]) console.log(recurrence,lastSentAt,nextDelivery({...b,recurrence,lastSentAt},now)?.deliverAt)'
git --no-pager show --stat cce86c8 && git --no-pager blame src/scheduler.ts | head -55
npm test
npm test && TZ=Pacific/Honolulu npm test && git --no-pager diff --check
node --input-type=module -e 'import {nextDelivery} from "./src/scheduler.ts"; const b={id:"r",userId:"u",timeZone:"America/New_York",hour:9,minute:0}; for(const [recurrence,lastSentAt,now] of [["daily","2026-03-07T14:00:00.000Z","2026-03-07T15:00:00.000Z"],["weekly","2026-03-02T14:00:00.000Z","2026-03-03T15:00:00.000Z"],["daily","2026-10-31T13:00:00.000Z","2026-10-31T15:00:00.000Z"]]) console.log(recurrence,nextDelivery({...b,recurrence,lastSentAt},now)?.deliverAt); const t=performance.now(); console.log("stale", nextDelivery({...b,recurrence:"daily",lastSentAt:"2025-01-01T14:00:00.000Z"},"2026-10-02T14:00:00.000Z")?.deliverAt,Math.round(performance.now()-t)+"ms")'
git --no-pager diff --stat && git --no-pager diff -- src/scheduler.ts src/timeZone.ts README.md test/scheduler.test.ts | head -220 && git status --short
npm test && node --input-type=module -e 'import {nextDelivery} from "./src/scheduler.ts"; const b={id:"r",userId:"u",timeZone:"America/New_York",hour:9,minute:0,recurrence:"daily",lastSentAt:"2025-01-01T14:00:00.000Z"}; console.log(nextDelivery(b,"2026-10-02T14:00:00.000Z")?.deliverAt)' && git --no-pager diff --check
node --input-type=module -e 'import {nextDelivery} from "./src/scheduler.ts"; for (const [timeZone,hour,minute,lastSentAt,now] of [["Australia/Lord_Howe",2,15,"2026-09-26T15:45:00.000Z","2026-09-27T00:00:00.000Z"],["Pacific/Apia",9,0,"2011-12-29T19:00:00.000Z","2011-12-29T20:00:00.000Z"]]) console.log(timeZone,nextDelivery({id:"r",userId:"u",timeZone,hour,minute,recurrence:"daily",lastSentAt},now)?.deliverAt)'
npm test && git --no-pager diff --check && git status --short
```

Diff against the starting commit:

```diff
diff --git a/README.md b/README.md
index b7c8f12..8cbfa3d 100644
--- a/README.md
+++ b/README.md
@@ -4,9 +4,10 @@ Schedules reminder deliveries for user accounts. Each reminder stores an IANA ti
 
 Rules:
 
-- Daily and weekly reminders preserve the requested wall-clock time in the user's time zone.
+- Daily and weekly reminders preserve the requested wall-clock time in the user's time zone, including after a previous delivery and across clock changes.
 - All returned delivery times are ISO UTC strings.
 - Date math must use `Intl` with the reminder's explicit time zone; the machine time zone is irrelevant.
 - If a requested local minute does not exist because clocks jump forward, deliver at the next valid minute in that time zone.
+- After a previous delivery, schedule the next future occurrence on the reminder's local daily or weekly calendar, even if earlier occurrences were missed.
 
 Run the tests with `npm test` (Node 24, no dependencies).
diff --git a/src/scheduler.ts b/src/scheduler.ts
index c73b310..7cd0b95 100644
--- a/src/scheduler.ts
+++ b/src/scheduler.ts
@@ -1,8 +1,6 @@
 import type { Reminder, ScheduledReminder } from "./types.ts";
 import { advanceLocalDate, localParts, resolveWallTime } from "./timeZone.ts";
 
-const DAY_MS = 24 * 60 * 60 * 1000;
-
 function recurrenceDays(reminder: Reminder): number {
   return reminder.recurrence === "weekly" ? 7 : 1;
 }
@@ -14,20 +12,24 @@ function withReminderTime(reminder: Reminder, parts: ReturnType<typeof localPart
 export function nextDelivery(reminder: Reminder, nowIso: string): ScheduledReminder | undefined {
   if (reminder.paused) return undefined;
   const now = new Date(nowIso);
-
-  if (reminder.lastSentAt) {
-    const elapsed = recurrenceDays(reminder) * DAY_MS;
-    return {
-      reminderId: reminder.id,
-      userId: reminder.userId,
-      deliverAt: new Date(new Date(reminder.lastSentAt).getTime() + elapsed).toISOString(),
-    };
-  }
-
-  let localDate = withReminderTime(reminder, localParts(now, reminder.timeZone));
+  const nowDate = localParts(now, reminder.timeZone);
+  const anchorDate = reminder.lastSentAt
+    ? localParts(new Date(reminder.lastSentAt), reminder.timeZone)
+    : nowDate;
+  const days = recurrenceDays(reminder);
+  const elapsedDays = Math.floor(
+    (Date.UTC(nowDate.year, nowDate.month - 1, nowDate.day) -
+      Date.UTC(anchorDate.year, anchorDate.month - 1, anchorDate.day)) /
+      (24 * 60 * 60 * 1000),
+  );
+  const advance = reminder.lastSentAt ? Math.max(days, Math.floor(elapsedDays / days) * days) : 0;
+  let localDate = withReminderTime(
+    reminder,
+    advanceLocalDate(anchorDate, advance),
+  );
   let deliverAt = resolveWallTime(reminder.timeZone, localDate);
   while (new Date(deliverAt).getTime() <= now.getTime()) {
-    localDate = withReminderTime(reminder, advanceLocalDate(localDate, recurrenceDays(reminder)));
+    localDate = withReminderTime(reminder, advanceLocalDate(localDate, days));
     deliverAt = resolveWallTime(reminder.timeZone, localDate);
   }
 
diff --git a/src/timeZone.ts b/src/timeZone.ts
index d9f2970..c96af25 100644
--- a/src/timeZone.ts
+++ b/src/timeZone.ts
@@ -54,7 +54,8 @@ export function advanceLocalDate(parts: Pick<LocalParts, "year" | "month" | "day
 
 export function resolveWallTime(timeZone: string, parts: LocalParts): string {
   const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
-  for (let offset = -720; offset <= 720; offset++) {
+  let nextValid: string | undefined;
+  for (let offset = -14 * 60; offset <= 38 * 60; offset++) {
     const instant = new Date(guess + offset * 60_000);
     const seen = localParts(instant, timeZone);
     if (
@@ -66,6 +67,13 @@ export function resolveWallTime(timeZone: string, parts: LocalParts): string {
     ) {
       return instant.toISOString();
     }
+    if (
+      nextValid === undefined &&
+      Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute) > guess
+    ) {
+      nextValid = instant.toISOString();
+    }
   }
-  return new Date(guess).toISOString();
+  if (nextValid !== undefined) return nextValid;
+  throw new RangeError(`Cannot resolve local time in ${timeZone}`);
 }
diff --git a/test/scheduler.test.ts b/test/scheduler.test.ts
index dde34b9..7122c9a 100644
--- a/test/scheduler.test.ts
+++ b/test/scheduler.test.ts
@@ -25,6 +25,88 @@ test("weekly reminders advance by one week between ordinary winter dates", () =>
   assert.equal(nextDelivery(weekly, "2026-01-06T12:00:00.000Z")?.deliverAt, "2026-01-12T14:00:00.000Z");
 });
 
+test("daily reminders retain their local time across spring and autumn clock changes", () => {
+  assert.equal(
+    nextDelivery({ ...base, lastSentAt: "2026-03-07T14:00:00.000Z" }, "2026-03-07T15:00:00.000Z")?.deliverAt,
+    "2026-03-08T13:00:00.000Z",
+  );
+  assert.equal(
+    nextDelivery({ ...base, lastSentAt: "2026-10-31T13:00:00.000Z" }, "2026-10-31T15:00:00.000Z")?.deliverAt,
+    "2026-11-01T14:00:00.000Z",
+  );
+});
+
+test("weekly reminders retain their local time across clock changes", () => {
+  assert.equal(
+    nextDelivery({ ...base, recurrence: "weekly", lastSentAt: "2026-03-02T14:00:00.000Z" }, "2026-03-03T15:00:00.000Z")?.deliverAt,
+    "2026-03-09T13:00:00.000Z",
+  );
+  assert.equal(
+    nextDelivery({ ...base, recurrence: "weekly", lastSentAt: "2026-10-26T13:00:00.000Z" }, "2026-10-27T15:00:00.000Z")?.deliverAt,
+    "2026-11-02T14:00:00.000Z",
+  );
+});
+
+test("recurring schedules skip elapsed occurrences without drifting", () => {
+  assert.equal(
+    nextDelivery({ ...base, lastSentAt: "2026-03-07T14:00:00.000Z" }, "2026-03-10T15:00:00.000Z")?.deliverAt,
+    "2026-03-11T13:00:00.000Z",
+  );
+  assert.equal(
+    nextDelivery({ ...base, recurrence: "weekly", lastSentAt: "2026-03-02T14:00:00.000Z" }, "2026-03-17T15:00:00.000Z")?.deliverAt,
+    "2026-03-23T13:00:00.000Z",
+  );
+});
+
+test("a delayed delivery does not change the requested local hour", () => {
+  assert.equal(
+    nextDelivery({ ...base, lastSentAt: "2026-03-07T14:17:00.000Z" }, "2026-03-07T15:00:00.000Z")?.deliverAt,
+    "2026-03-08T13:00:00.000Z",
+  );
+});
+
+test("nonexistent spring minutes deliver at the next valid local minute", () => {
+  const gap = { ...base, hour: 2, minute: 30 };
+  assert.equal(
+    nextDelivery({ ...gap, lastSentAt: "2026-03-07T07:30:00.000Z" }, "2026-03-07T08:00:00.000Z")?.deliverAt,
+    "2026-03-08T07:00:00.000Z",
+  );
+  assert.equal(
+    nextDelivery({ ...gap, recurrence: "weekly", lastSentAt: "2026-03-01T07:30:00.000Z" }, "2026-03-02T08:00:00.000Z")?.deliverAt,
+    "2026-03-08T07:00:00.000Z",
+  );
+  assert.equal(nextDelivery(gap, "2026-03-08T06:00:00.000Z")?.deliverAt, "2026-03-08T07:00:00.000Z");
+});
+
+test("half-hour clock jumps and skipped dates use the next valid local minute", () => {
+  assert.equal(
+    nextDelivery({
+      ...base,
+      timeZone: "Australia/Lord_Howe",
+      hour: 2,
+      minute: 15,
+      recurrence: "weekly",
+      lastSentAt: "2026-09-26T15:45:00.000Z",
+    }, "2026-09-27T00:00:00.000Z")?.deliverAt,
+    "2026-10-03T15:30:00.000Z",
+  );
+  assert.equal(
+    nextDelivery({
+      ...base,
+      timeZone: "Pacific/Apia",
+      lastSentAt: "2011-12-29T19:00:00.000Z",
+    }, "2011-12-29T20:00:00.000Z")?.deliverAt,
+    "2011-12-30T10:00:00.000Z",
+  );
+});
+
+test("zones beyond a twelve-hour UTC offset retain their local time", () => {
+  const auckland = { ...base, timeZone: "Pacific/Auckland", lastSentAt: "2026-03-07T20:00:00.000Z" };
+  assert.equal(nextDelivery(auckland, "2026-03-07T21:00:00.000Z")?.deliverAt, "2026-03-08T20:00:00.000Z");
+  const kiribati = { ...base, timeZone: "Pacific/Kiritimati" };
+  assert.equal(nextDelivery(kiribati, "2026-01-01T18:00:00.000Z")?.deliverAt, "2026-01-01T19:00:00.000Z");
+});
+
 test("paused reminders are omitted from the due list", () => {
   assert.deepEqual(dueReminders([{ ...base, paused: true }], "2026-01-15T13:00:00.000Z"), []);
 });

```
