import type { FixGenerator, FixGeneratorInput, FixInput } from "../FixGenerator.js";

interface FixTemplate {
  key: string;
  severity: "critical" | "high" | "medium";
  problem: string;
  likelyCause: string;
  suggestedFix: string;
  /** Matched against each failed attempt's stuck_reason (case-insensitive). */
  matches: RegExp;
}

/**
 * Purely template-based — no LLM call. Matches the spec's own examples
 * (JS-rendered price, cookie modal blocking CTA, missing structured stock
 * data) against real stuck_reason text from this run's attempts. A pattern
 * with no matching attempt simply never fires — this only ever reports
 * problems the run's own data actually shows, never a generic guess for an
 * unmatched failure. This is also the fallback DeepSeekFixGenerator uses
 * when no key is configured or the live call fails, so it must stay correct
 * on its own, not just as a stub placeholder.
 */
const FIX_TEMPLATES: FixTemplate[] = [
  {
    key: "cookie_banner",
    severity: "critical",
    problem: "Your cookie banner blocks the buy button",
    likelyCause:
      "The banner sits above the purchase button and only closes on a click an agent can't identify or locate.",
    suggestedFix: '<button aria-label="Dismiss cookie notice">\n  Accept\n</button>\n/* and: .cookie-bar { position: static } below 900px */',
    matches: /cookie/i,
  },
  {
    key: "price_latency",
    severity: "high",
    problem: "Price arrives too late to be read",
    likelyCause: "The price is fetched client-side after the initial page load, and agents move on before it renders.",
    suggestedFix: '<meta itemprop="price" content="128.00">\n<meta itemprop="priceCurrency" content="USD">',
    matches: /price.*(late|slow|render|wait)|render.*price/i,
  },
  {
    key: "stock_ambiguous",
    severity: "medium",
    problem: "Stock is implied, never stated",
    likelyCause: "Nothing on the page says in text whether the item is available — an agent has no reliable signal to read.",
    suggestedFix: '<link itemprop="availability" href="https://schema.org/InStock">',
    matches: /tell whether|purchased right now|stock/i,
  },
  {
    key: "ambiguous_button",
    severity: "medium",
    problem: "A key button has no accessible label",
    likelyCause: "The control an agent needed to act on has no text, aria-label, or title an agent can use to identify its purpose.",
    suggestedFix: '<button aria-label="Add to cart">\n  <svg aria-hidden="true">...</svg>\n</button>',
    matches: /unlabeled|ambiguous|unclear (which|what) button|no accessible label/i,
  },
];

export class TemplateFixGenerator implements FixGenerator {
  readonly name = "template";

  async generate(input: FixGeneratorInput): Promise<FixInput[]> {
    const matched = FIX_TEMPLATES.filter((t) => input.stuckReasons.some((r) => t.matches.test(r)));
    return matched.map((t) => ({
      severity: t.severity,
      problem: t.problem,
      likelyCause: t.likelyCause,
      suggestedFix: t.suggestedFix,
    }));
  }
}
