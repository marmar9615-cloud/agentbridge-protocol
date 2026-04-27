// Optional Playwright probe. Imports lazily so that the scanner works even
// when Playwright (and its browsers) aren't installed. Failures are caught by
// the caller and surfaced as a non-fatal note in the readiness report.

export interface PageProbeResult {
  title: string;
  buttonCount: number;
  formCount: number;
  linkCount: number;
}

export async function probePage(url: string): Promise<PageProbeResult> {
  // Dynamic import keeps Playwright off the critical path for scans that
  // don't want to spin up a browser. If it isn't installed, the catch in
  // scanner.ts records a friendly note instead of a hard failure.
  const playwright = await import("playwright").catch(() => null);
  if (!playwright) {
    throw new Error("playwright not installed");
  }
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 8000 });
    const [title, buttonCount, formCount, linkCount] = await Promise.all([
      page.title(),
      page.locator("button").count(),
      page.locator("form").count(),
      page.locator("a[href]").count(),
    ]);
    return { title, buttonCount, formCount, linkCount };
  } finally {
    await browser.close();
  }
}
